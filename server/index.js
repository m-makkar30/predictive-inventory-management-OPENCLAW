import express from 'express';
import cors from 'cors';
import http from 'http';
import { initWebSocket } from './websocket.js';
import {
  initializeInventory,
  setDbReady,
  placeCustomerOrder,
  placeProcurementOrder,
  getSnapshot,
  getDemandHistory,
  getEventLog,
  checkPendingOrders,
  checkExpiredItems,
} from './inventory.js';
import { startAgentLoop, triggerAgentAnalysis } from './agent.js';
import { initDB } from './db.js';
import { getRecentDecisions, getLatestPerformance, computePerformanceScores } from './agentMemory.js';

const PORT = 3001;
const app = express();
const server = http.createServer(app);

// ── Middleware ────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── REST API Endpoints ───────────────────────────────────────────────

// Customer order - sell item(s) from stock
app.post('/api/order', (req, res) => {
  const { itemId, quantity = 1 } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId required' });

  const result = placeCustomerOrder(itemId, quantity);
  res.json(result);
});

// Procurement order - from agent
app.post('/api/procure', (req, res) => {
  const { itemId, quantity, source = 'agent' } = req.body;
  if (!itemId || !quantity) return res.status(400).json({ error: 'itemId and quantity required' });

  const result = placeProcurementOrder(itemId, quantity, source);
  res.json(result);
});

// Manual procurement - from user via dashboard
app.post('/api/manual-procure', (req, res) => {
  const { itemId, quantity } = req.body;
  if (!itemId || !quantity) return res.status(400).json({ error: 'itemId and quantity required' });

  const result = placeProcurementOrder(itemId, quantity, 'manual');
  res.json(result);
});

// Full inventory snapshot
app.get('/api/inventory', (req, res) => {
  res.json(getSnapshot());
});

// Demand history for charts
app.get('/api/demand-history', (req, res) => {
  const minutes = parseInt(req.query.minutes) || 10;
  res.json(getDemandHistory(minutes));
});

// Event log
app.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json(getEventLog(limit));
});

// Manually trigger agent analysis
app.post('/api/trigger-agent', (req, res) => {
  triggerAgentAnalysis();
  res.json({ success: true, message: 'Agent analysis triggered' });
});

// Agent decision history
app.get('/api/agent/decisions', async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const decisions = await getRecentDecisions(limit);
  res.json(decisions);
});

// Agent performance scores per item
app.get('/api/agent/performance', async (req, res) => {
  const performance = await getLatestPerformance();
  res.json(performance);
});

// ── Initialize ───────────────────────────────────────────────────────
initWebSocket(server);
initializeInventory();

// Initialize DB (non-blocking — system works without it)
initDB().then(() => {
  setDbReady(true);
  console.log('[Server] Database connected — agent memory active');

  // Compute performance scores every 60 seconds
  setInterval(() => {
    computePerformanceScores(10).catch(() => {});
  }, 60000);
}).catch(err => {
  console.warn('[Server] Database unavailable — agent memory disabled:', err.message);
  console.warn('[Server] System will run normally without persistent memory');
});

// Run inventory tick every second (check expiry + pending orders)
setInterval(() => {
  checkExpiredItems();
  checkPendingOrders();
}, 1000);

// Start the AI agent loop
startAgentLoop();

server.listen(PORT, () => {
  console.log(`[Server] Inventory server running on http://localhost:${PORT}`);
  console.log(`[Server] WebSocket available on ws://localhost:${PORT}`);
});
