import { v4 as uuidv4 } from 'uuid';
import ITEMS, { ITEMS_MAP } from './items.js';
import { broadcast } from './websocket.js';
import { recordDelivery, recordUnitSold, recordUnitExpired, resolveCompletedOrders } from './agentMemory.js';
import { fileLog } from './fileLogger.js';

// Flag to track if DB is available (set from index.js after DB init)
let dbReady = false;
export function setDbReady(ready) { dbReady = ready; }

// ── Per-unit stock tracking ──────────────────────────────────────────
// Each unit in stock: { unitId, itemId, arrivedAt, expiresAt }
let stock = [];

// ── Pending procurement orders (in-transit) ─────────────────────────
// { orderId, itemId, quantity, orderedAt, arrivesAt, source: 'agent'|'manual' }
let pendingOrders = [];

// ── Demand history (rolling window) ─────────────────────────────────
// { itemId, quantity, timestamp }
let demandHistory = [];

// ── Event log ────────────────────────────────────────────────────────
let eventLog = [];
const MAX_LOG_SIZE = 500;

// ── Statistics ───────────────────────────────────────────────────────
const stats = {
  totalSold: {},
  totalExpired: {},
  totalProcured: {},
  totalStockouts: {},
  totalRevenue: 0,
  totalWaste: 0,
};

ITEMS.forEach(item => {
  stats.totalSold[item.id] = 0;
  stats.totalExpired[item.id] = 0;
  stats.totalProcured[item.id] = 0;
  stats.totalStockouts[item.id] = 0;
});

// ── Initialize stock ─────────────────────────────────────────────────
export function initializeInventory() {
  stock = [];
  pendingOrders = [];
  demandHistory = [];
  eventLog = [];

  const now = Date.now();
  for (const item of ITEMS) {
    for (let i = 0; i < item.initialStock; i++) {
      // Stagger arrival times slightly so expiry isn't all at once
      const stagger = Math.random() * item.expiryTime * 60000 * 0.3;
      const arrivedAt = now - stagger;
      stock.push({
        unitId: uuidv4(),
        itemId: item.id,
        arrivedAt,
        expiresAt: arrivedAt + item.expiryTime * 60000,
      });
    }
  }

  addLog('system', 'info', 'Inventory system initialized with starting stock');
}

// ── Place a customer order (sell items) ──────────────────────────────
export function placeCustomerOrder(itemId, quantity = 1) {
  const item = ITEMS_MAP[itemId];
  if (!item) return { success: false, error: 'Unknown item' };

  // Get available stock for this item, sorted FIFO (oldest first / nearest expiry)
  const available = stock
    .filter(u => u.itemId === itemId)
    .sort((a, b) => a.expiresAt - b.expiresAt);

  if (available.length === 0) {
    stats.totalStockouts[itemId]++;
    addLog('stockout', 'error', `STOCKOUT: ${item.emoji} ${item.name} - customer order rejected (0 in stock)`);
    return { success: false, error: 'Out of stock', stockout: true };
  }

  const actualQty = Math.min(quantity, available.length);
  const sold = available.slice(0, actualQty);
  const soldIds = new Set(sold.map(u => u.unitId));

  // Remove sold units from stock
  stock = stock.filter(u => !soldIds.has(u.unitId));

  stats.totalSold[itemId] += actualQty;
  stats.totalRevenue += actualQty * item.price;

  // Track sold units back to their procurement orders in DB
  if (dbReady) {
    const byProcurement = {};
    for (const u of sold) {
      if (u.procurementId) {
        byProcurement[u.procurementId] = (byProcurement[u.procurementId] || 0) + 1;
      }
    }
    for (const [procId, count] of Object.entries(byProcurement)) {
      recordUnitSold(procId, count).catch(() => {});
    }
  }

  // Record demand
  demandHistory.push({ itemId, quantity: actualQty, timestamp: Date.now() });

  const remaining = stock.filter(u => u.itemId === itemId).length;
  addLog('sale', 'info', `SOLD: ${actualQty}x ${item.emoji} ${item.name} (${remaining} remaining)`);

  if (actualQty < quantity) {
    const shortfall = quantity - actualQty;
    stats.totalStockouts[itemId]++;
    addLog('stockout', 'error', `PARTIAL STOCKOUT: ${item.emoji} ${item.name} - could only fulfill ${actualQty}/${quantity} (short ${shortfall})`);
  }

  broadcastState();
  return { success: true, sold: actualQty, remaining };
}

// ── Place a procurement order ────────────────────────────────────────
export function placeProcurementOrder(itemId, quantity, source = 'agent') {
  const item = ITEMS_MAP[itemId];
  if (!item) return { success: false, error: 'Unknown item' };
  if (quantity <= 0) return { success: false, error: 'Quantity must be positive' };

  const now = Date.now();
  const arrivesAt = now + item.leadTime * 60000;

  const order = {
    orderId: uuidv4(),
    itemId,
    quantity,
    orderedAt: now,
    arrivesAt,
    source,
  };

  pendingOrders.push(order);
  stats.totalProcured[itemId] += quantity;

  const sourceLabel = source === 'agent' ? '🤖 AGENT' : '👤 MANUAL';
  addLog(
    source === 'agent' ? 'agent-order' : 'manual-order',
    'info',
    `${sourceLabel} ORDER: ${quantity}x ${item.emoji} ${item.name} (arrives in ${item.leadTime} min)`
  );

  broadcastState();
  return { success: true, orderId: order.orderId, arrivesAt };
}

// ── Check and deliver pending orders ─────────────────────────────────
export function checkPendingOrders() {
  const now = Date.now();
  const arrived = [];
  const stillPending = [];

  for (const order of pendingOrders) {
    if (now >= order.arrivesAt) {
      arrived.push(order);
    } else {
      stillPending.push(order);
    }
  }

  pendingOrders = stillPending;

  for (const order of arrived) {
    const item = ITEMS_MAP[order.itemId];
    for (let i = 0; i < order.quantity; i++) {
      stock.push({
        unitId: uuidv4(),
        itemId: order.itemId,
        arrivedAt: now,
        expiresAt: now + item.expiryTime * 60000,
        procurementId: order.orderId,
      });
    }

    const sourceLabel = order.source === 'agent' ? '🤖' : '👤';
    addLog('arrival', 'success', `${sourceLabel} ARRIVED: ${order.quantity}x ${item.emoji} ${item.name} now in stock`);

    // Record delivery in agent memory
    if (dbReady && order.source === 'agent') {
      recordDelivery(order.orderId, order.quantity).catch(() => {});
    }
  }

  if (arrived.length > 0) broadcastState();
  return arrived;
}

// ── Check and remove expired items ───────────────────────────────────
export function checkExpiredItems() {
  const now = Date.now();
  const expired = stock.filter(u => now >= u.expiresAt);

  if (expired.length === 0) return [];

  const expiredIds = new Set(expired.map(u => u.unitId));
  stock = stock.filter(u => !expiredIds.has(u.unitId));

  // Group by item for logging
  const grouped = {};
  for (const u of expired) {
    grouped[u.itemId] = (grouped[u.itemId] || 0) + 1;
  }

  // Track expired units back to procurement orders in DB
  if (dbReady) {
    const byProcurement = {};
    for (const u of expired) {
      if (u.procurementId) {
        byProcurement[u.procurementId] = (byProcurement[u.procurementId] || 0) + 1;
      }
    }
    for (const [procId, count] of Object.entries(byProcurement)) {
      recordUnitExpired(procId, count).catch(() => {});
    }
    // Resolve any orders where all units are now accounted for
    resolveCompletedOrders().catch(() => {});
  }

  for (const [itemId, count] of Object.entries(grouped)) {
    const item = ITEMS_MAP[itemId];
    stats.totalExpired[itemId] += count;
    stats.totalWaste += count * item.cost;
    const remaining = stock.filter(u => u.itemId === itemId).length;
    addLog('expired', 'error', `EXPIRED: ${count}x ${item.emoji} ${item.name} removed from stock (${remaining} remaining)`);
  }

  broadcastState();
  return expired;
}

// ── Get full inventory snapshot ──────────────────────────────────────
export function getSnapshot() {
  const now = Date.now();
  const snapshot = ITEMS.map(item => {
    const units = stock
      .filter(u => u.itemId === item.id)
      .sort((a, b) => a.expiresAt - b.expiresAt)
      .map(u => ({
        unitId: u.unitId,
        arrivedAt: u.arrivedAt,
        expiresAt: u.expiresAt,
        timeToExpiry: Math.max(0, u.expiresAt - now),
        timeToExpiryMin: Math.max(0, (u.expiresAt - now) / 60000).toFixed(2),
      }));

    const pending = pendingOrders
      .filter(o => o.itemId === item.id)
      .map(o => ({
        orderId: o.orderId,
        quantity: o.quantity,
        orderedAt: o.orderedAt,
        arrivesAt: o.arrivesAt,
        timeToArrival: Math.max(0, o.arrivesAt - now),
        timeToArrivalMin: Math.max(0, (o.arrivesAt - now) / 60000).toFixed(2),
        source: o.source,
      }));

    const pendingTotal = pending.reduce((sum, o) => sum + o.quantity, 0);

    // Demand across multiple time windows for trend analysis
    const itemDemand = demandHistory.filter(d => d.itemId === item.id);

    const demandInWindow = (minutes) => {
      const cutoff = now - minutes * 60000;
      return itemDemand.filter(d => d.timestamp >= cutoff).reduce((sum, d) => sum + d.quantity, 0);
    };

    const demand1min = demandInWindow(1);
    const demand2min = demandInWindow(2);
    const demand5min = demandInWindow(5);
    const demand10min = demandInWindow(10);

    // Velocity (units/min) across windows
    const velocity1min = demand1min;
    const velocity2min = parseFloat((demand2min / 2).toFixed(2));
    const velocity5min = parseFloat((demand5min / 5).toFixed(2));

    // Peak velocity = max of all windows (captures surges)
    const peakVelocity = Math.max(velocity1min, velocity2min, velocity5min);

    // Trend: compare recent 1min rate vs longer 5min average
    const demandTrend = velocity5min > 0
      ? parseFloat(((velocity1min - velocity5min) / velocity5min).toFixed(2))
      : velocity1min > 0 ? 1 : 0;

    // Projected stock depletion time (minutes) at peak rate
    const depletionTimeMin = peakVelocity > 0
      ? parseFloat((units.length / peakVelocity).toFixed(2))
      : 999;

    // Will stock run out before a new order could arrive?
    const willStockout = depletionTimeMin <= item.leadTime;

    // Effective coverage: minutes of demand stock + pending can cover
    const effectiveCoverage = peakVelocity > 0
      ? parseFloat(((units.length + pendingTotal) / peakVelocity).toFixed(2))
      : 999;

    return {
      ...item,
      currentStock: units.length,
      units,
      pendingOrders: pending,
      pendingTotal,
      recentDemand: demand5min,
      demand1min,
      demand2min,
      demand5min,
      demand10min,
      demandVelocity: velocity5min,
      peakVelocity,
      velocity1min,
      velocity2min,
      velocity5min,
      demandTrend,
      depletionTimeMin,
      willStockout,
      effectiveCoverage,
      totalSold: stats.totalSold[item.id],
      totalExpired: stats.totalExpired[item.id],
      totalProcured: stats.totalProcured[item.id],
      totalStockouts: stats.totalStockouts[item.id],
    };
  });

  return {
    timestamp: now,
    items: snapshot,
    stats: {
      totalRevenue: parseFloat(stats.totalRevenue.toFixed(2)),
      totalWaste: parseFloat(stats.totalWaste.toFixed(2)),
    },
  };
}

// ── Get demand history for charts ────────────────────────────────────
export function getDemandHistory(minutes = 10) {
  const cutoff = Date.now() - minutes * 60000;
  return demandHistory.filter(d => d.timestamp >= cutoff);
}

// ── Get event log ────────────────────────────────────────────────────
export function getEventLog(limit = 100) {
  return eventLog.slice(-limit);
}

// ── Internal helpers ─────────────────────────────────────────────────
function addLog(type, level, message) {
  const entry = {
    id: uuidv4(),
    type,
    level,
    message,
    timestamp: Date.now(),
  };
  eventLog.push(entry);
  if (eventLog.length > MAX_LOG_SIZE) {
    eventLog = eventLog.slice(-MAX_LOG_SIZE);
  }
  broadcast('log-event', entry);
  fileLog(entry);
}

function broadcastState() {
  broadcast('inventory-update', getSnapshot());
}
