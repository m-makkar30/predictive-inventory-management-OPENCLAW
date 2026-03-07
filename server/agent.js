import { getSnapshot, getDemandHistory, placeProcurementOrder, getEventLog } from './inventory.js';
import { broadcast } from './websocket.js';
import { logDecision, buildMemoryContext } from './agentMemory.js';
import { fileLog } from './fileLogger.js';

// ── Configuration ────────────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const PRIMARY_MODEL = 'llama-3.3-70b-versatile';
const FALLBACK_MODEL = 'llama-3.1-8b-instant';
const AGENT_INTERVAL_MS = 20 * 1000; // 20 seconds between agent calls

const OPENCLAW_GATEWAY = 'http://127.0.0.1:18789';
const WEBHOOK_TOKEN = 'inventory-agent-secret';

let agentTimer = null;
let agentEnabled = true;
let lastAgentCall = 0;
let consecutiveFailures = 0;

// Track previous decisions to give LLM context continuity
let previousDecisions = [];

// ── System prompt ────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a highly skilled inventory management AI for a real-time grocery warehouse simulation.
You are called every 20 seconds. Your goal is to keep ALL items in stock while minimizing waste from expiry.

## TWO TYPES OF ORDERING:

### A) DEMAND-DRIVEN ORDERING (when peakVelocity > 0):
For items with active demand, order based on consumption rate:
- target_stock = peakVelocity × leadTime × 2.5
- order_qty = target_stock - currentStock - pendingTotal
- HARD CAP: never order more than peakVelocity × expiryTime × 0.5 (prevents over-ordering that causes waste)
- For short-expiry items (expiryTime < 5min): cap at peakVelocity × expiryTime × 0.3
- If demand is DECELERATING (trend < 0), reduce order by 30%
- If order_qty <= 0, skip — stock is sufficient

### B) BASELINE MAINTENANCE (when peakVelocity = 0):
Even when no one is currently buying an item, a grocery store must keep it stocked.
- Every item must maintain a MINIMUM BASELINE of 5 units at all times
- If currentStock + pendingTotal < 5, order enough to reach 5
- This applies to ALL items regardless of demand — empty shelves are unacceptable
- For long-expiry items (>10min), baseline can be up to 8 units
- Order quantity = max(0, baseline - currentStock - pendingTotal)

## CRITICAL RULES:

1. **WASTE PREVENTION**: If an item has totalExpired > 0 and peakVelocity is low, ORDER LESS not more.
   - Check the ratio: if totalExpired > totalSold for an item, you are over-ordering it. Reduce to baseline only.
   - nearExpiry count tells you how many units will expire within 2 minutes — if nearExpiry > 0 and demand is low, do NOT add more stock.

2. **STOCKOUT RECOVERY**: If currentStock=0 AND pendingTotal=0, order the baseline (5 units) immediately. Even if demand is 0, shelves must not be empty.

3. **DON'T DOUBLE-ORDER**: Always subtract pendingTotal. If pending orders will bring stock above target, skip.

4. **DEMAND TREND**: demandTrend > 0 means accelerating (order more). demandTrend < 0 means decelerating (order less, risk of waste).

5. **SMALL BATCHES FOR PERISHABLES**: Items with expiryTime < 5min should never receive orders larger than 5 units at once when demand is low (<1/min).

6. **LEARN FROM MEMORY**: You will receive your past decision outcomes (units ordered, sold, expired per item).
   - If your AGENT MEMORY shows high waste_rate (>30%) for an item, CUT your order size for that item by 50%.
   - If efficiency is >80%, your sizing is good — maintain current approach.
   - If you see repeated "full_waste" outcomes for an item, switch to baseline-only ordering for it.
   - Your memory tracks what actually happened after your decisions. USE IT to improve.

## RESPONSE FORMAT:
Return ONLY valid JSON. No markdown fences. No text outside JSON.
{"reasoning":"brief analysis","orders":[{"itemId":"id","quantity":N,"reason":"why"}]}

Valid item IDs: eggs, milk, bread, tomatoes, chicken, rice, bananas, yogurt, lettuce, cheese`;

// ── Start the agent loop ─────────────────────────────────────────────
export function startAgentLoop() {
  console.log(`[Agent] Starting analysis loop (every ${AGENT_INTERVAL_MS / 1000}s)`);
  agentTimer = setInterval(() => {
    if (agentEnabled) triggerAgentAnalysis();
  }, AGENT_INTERVAL_MS);

  // First call after short delay
  setTimeout(() => {
    if (agentEnabled) triggerAgentAnalysis();
  }, 10000);
}

export function stopAgentLoop() {
  if (agentTimer) {
    clearInterval(agentTimer);
    agentTimer = null;
  }
}

// ── Main trigger ─────────────────────────────────────────────────────
async function triggerAgentAnalysis() {
  const now = Date.now();
  if (now - lastAgentCall < 10000) return; // min 10s between calls
  lastAgentCall = now;

  const snapshot = getSnapshot();
  const demandHist = getDemandHistory(10);
  const recentLogs = getEventLog(30);

  // Fetch agent's memory of past decisions and outcomes
  let memoryContext = '';
  try {
    memoryContext = await buildMemoryContext();
  } catch (err) {
    console.warn('[Agent] Memory context unavailable:', err.message);
  }

  const userPrompt = buildUserPrompt(snapshot, demandHist, recentLogs, memoryContext);

  // Try direct Groq API
  const success = await callGroqDirect(userPrompt, snapshot);

  if (!success) {
    const openclawSuccess = await callOpenClawWebhook(userPrompt);
    if (!openclawSuccess) {
      consecutiveFailures++;
      // Immediately use fallback - don't wait for 2 failures
      addAgentLog('warn', '🔧 FALLBACK: Using rule-based logic');
      await runFallbackLogic(snapshot);
    } else {
      consecutiveFailures = 0;
    }
  } else {
    consecutiveFailures = 0;
  }
}

// ── Direct Groq API call ─────────────────────────────────────────────
async function callGroqDirect(userPrompt, snapshot) {
  if (!GROQ_API_KEY) return false;

  try {
    console.log('[Agent] Calling Groq API...');
    addAgentLog('info', '🤖 AGENT: Analyzing inventory state...');

    const model = consecutiveFailures > 0 ? FALLBACK_MODEL : PRIMARY_MODEL;

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 1500,
      }),
    });

    if (response.status === 429) {
      console.warn('[Agent] Groq rate limited');
      addAgentLog('warn', `🤖 AGENT: Rate limited, using fallback`);
      return false;
    }

    if (!response.ok) {
      const text = await response.text();
      console.error(`[Agent] Groq error ${response.status}: ${text.substring(0, 200)}`);
      return false;
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (!content) return false;

    console.log('[Agent] Response:', content.substring(0, 300));

    const { orders, reasoning } = parseAgentDecision(content);
    if (orders.length > 0) {
      const ordersWithIds = await executeAgentOrders(orders);
      previousDecisions = orders.map(o => ({ ...o, time: Date.now() }));

      // Log decision to DB
      const decisionId = await logDecision({
        tier: 'groq',
        reasoning,
        snapshot,
        orders: ordersWithIds,
      });
      if (decisionId) {
        broadcast('agent-decision', { decisionId, tier: 'groq', orders: ordersWithIds, reasoning });
      }
    } else {
      addAgentLog('info', '🤖 AGENT: Stock levels adequate, no orders needed');
      // Log empty decision too
      await logDecision({ tier: 'groq', reasoning, snapshot, orders: [] });
    }

    return true;
  } catch (err) {
    console.error('[Agent] Groq call failed:', err.message);
    return false;
  }
}

// ── OpenClaw webhook ─────────────────────────────────────────────────
async function callOpenClawWebhook(userPrompt) {
  try {
    const message = `${userPrompt}\n\nIMPORTANT: After analyzing, place orders by running curl commands:\ncurl -s -X POST http://localhost:3001/api/procure -H "Content-Type: application/json" -d '{"itemId":"<id>","quantity":<N>,"source":"agent"}'`;

    const response = await fetch(`${OPENCLAW_GATEWAY}/hooks/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WEBHOOK_TOKEN}`,
      },
      body: JSON.stringify({
        message,
        name: 'inventory-analysis',
        agentId: 'main',
        timeoutSeconds: 25,
      }),
    });

    if (!response.ok) return false;
    console.log('[Agent] OpenClaw webhook triggered');
    return true;
  } catch (err) {
    console.warn('[Agent] OpenClaw unreachable:', err.message);
    return false;
  }
}

// ── Build prompt with rich demand data ───────────────────────────────
function buildUserPrompt(snapshot, demandHist, recentLogs, memoryContext = '') {
  const BASELINE = 5;
  const itemSummaries = snapshot.items.map(item => {
    const nearExpiry = item.units.filter(u => parseFloat(u.timeToExpiryMin) < 2).length;
    const effective = item.currentStock + item.pendingTotal;
    const wasteRatio = item.totalSold > 0 ? (item.totalExpired / item.totalSold).toFixed(2) : (item.totalExpired > 0 ? 'INF' : '0');
    const belowBaseline = effective < BASELINE;

    const urgency = item.currentStock === 0 && item.pendingTotal === 0 ? '🔴 EMPTY (needs baseline order!)' :
      item.willStockout ? '⚠️ WILL STOCKOUT' :
      belowBaseline ? '🟠 BELOW BASELINE' :
      item.currentStock <= 3 ? '🟡 LOW' : '🟢 OK';

    return `- ${item.name} (${item.id}) [${urgency}]:
    stock=${item.currentStock}, pending=${item.pendingTotal}, effective=${effective}, nearExpiry(<2m)=${nearExpiry}
    demand: 1min=${item.demand1min}, 2min=${item.demand2min}, 5min=${item.demand5min}, peak=${item.peakVelocity}/min
    trend=${item.demandTrend > 0 ? 'ACCELERATING' : item.demandTrend < 0 ? 'DECELERATING' : 'STABLE'}
    depletionTime=${item.depletionTimeMin}min, lead=${item.leadTime}min, expiry=${item.expiryTime}min
    history: sold=${item.totalSold}, expired=${item.totalExpired}, wasteRatio=${wasteRatio}, stockouts=${item.totalStockouts}`;
  }).join('\n');

  const recentEvents = recentLogs
    .filter(l => ['expired', 'stockout', 'sale', 'arrival', 'agent-order'].includes(l.type))
    .slice(-15)
    .map(l => `  [${new Date(l.timestamp).toLocaleTimeString('en-US', { hour12: false })}] ${l.message}`)
    .join('\n');

  const prevOrdersSummary = previousDecisions.length > 0
    ? `\nPREVIOUS AGENT ORDERS (${Math.round((Date.now() - previousDecisions[0].time) / 1000)}s ago):\n` +
      previousDecisions.map(o => `  - ${o.itemId}: ${o.quantity} units`).join('\n')
    : '';

  return `CURRENT TIME: ${new Date().toISOString()}
ANALYSIS INTERVAL: Every 20 seconds

INVENTORY STATUS (sorted by urgency):
${itemSummaries}
${prevOrdersSummary}
${memoryContext}
RECENT EVENTS:
${recentEvents || '  No recent events'}

⚡ Items marked EMPTY or BELOW BASELINE need orders even if demand is 0 — keep shelves stocked!
⚡ Items marked WILL STOCKOUT need demand-driven orders immediately.
⚡ If wasteRatio is high (>0.5), order SMALLER batches — you're over-ordering that item.
⚡ LEARN FROM YOUR MEMORY: Check your past decision outcomes above. If waste_rate is high for an item, reduce order sizes. If efficiency is high, keep current strategy.
⚡ Use the formulas from your instructions. Apply the hard caps strictly.

Decide procurement orders now.`;
}

// ── Parse decision ───────────────────────────────────────────────────
function parseAgentDecision(text) {
  try {
    if (typeof text !== 'string') text = JSON.stringify(text);
    text = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '');

    const jsonMatch = text.match(/\{[\s\S]*?"orders"\s*:\s*\[[\s\S]*?\]\s*\}/);
    if (!jsonMatch) {
      console.warn('[Agent] No JSON found in response');
      return { orders: [], reasoning: null };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const reasoning = parsed.reasoning || null;

    if (reasoning) {
      addAgentLog('info', `🤖 AGENT: ${reasoning}`);
    }

    if (!Array.isArray(parsed.orders)) return { orders: [], reasoning };

    const orders = parsed.orders.filter(o =>
      o.itemId && typeof o.quantity === 'number' && o.quantity > 0 && o.quantity <= 50
    );
    return { orders, reasoning };
  } catch (err) {
    console.error('[Agent] Parse error:', err.message);
    return { orders: [], reasoning: null };
  }
}

// ── Execute orders ───────────────────────────────────────────────────
async function executeAgentOrders(orders) {
  const results = [];
  for (const order of orders) {
    const result = placeProcurementOrder(order.itemId, order.quantity, 'agent');
    if (result.success) {
      results.push({ ...order, procurementId: result.orderId });
    } else {
      console.warn(`[Agent] Order failed for ${order.itemId}: ${result.error}`);
      results.push({ ...order, procurementId: null });
    }
  }
  return results;
}

// ── Fallback rule-based logic (smarter version) ──────────────────────
async function runFallbackLogic(snapshot) {
  const orders = [];
  const BASELINE = 5;

  for (const item of snapshot.items) {
    const effectiveStock = item.currentStock + item.pendingTotal;
    const peakV = item.peakVelocity || 0;
    const isWasteful = item.totalExpired > item.totalSold && item.totalExpired > 0;

    // A) Baseline maintenance: every item must have at least BASELINE units
    if (effectiveStock < BASELINE && peakV === 0) {
      // No demand — just top up to baseline, but use small batch if item wastes a lot
      const qty = isWasteful ? Math.max(2, BASELINE - effectiveStock) : BASELINE - effectiveStock;
      if (qty > 0) {
        orders.push({
          itemId: item.id,
          quantity: qty,
          reason: `Baseline maintenance: ${effectiveStock} < ${BASELINE}`,
        });
      }
      continue;
    }

    // B) Demand-driven ordering
    if (peakV > 0) {
      const targetStock = Math.ceil(peakV * item.leadTime * 2.5);
      const expiryCapFactor = item.expiryTime < 5 ? 0.3 : 0.5;
      const maxOrder = Math.max(3, Math.ceil(peakV * item.expiryTime * expiryCapFactor));
      let needed = targetStock - effectiveStock;

      // Reduce if decelerating
      if (item.demandTrend < 0) {
        needed = Math.ceil(needed * 0.7);
      }

      // Ensure at least baseline
      if (effectiveStock < BASELINE && needed < BASELINE - effectiveStock) {
        needed = BASELINE - effectiveStock;
      }

      if (needed > 0) {
        needed = Math.min(needed, maxOrder);
        orders.push({
          itemId: item.id,
          quantity: Math.ceil(needed),
          reason: `Target ${targetStock}, have ${effectiveStock}, peak=${peakV}/min`,
        });
      }
    }
  }

  if (orders.length > 0) {
    addAgentLog('info', `🔧 FALLBACK: Placing ${orders.length} rule-based orders`);
    const ordersWithIds = await executeAgentOrders(orders);

    const decisionId = await logDecision({
      tier: 'fallback',
      reasoning: `Rule-based: ${orders.length} orders placed`,
      snapshot,
      orders: ordersWithIds,
    });
    if (decisionId) {
      broadcast('agent-decision', { decisionId, tier: 'fallback', orders: ordersWithIds });
    }
  }
}

// ── Broadcast agent log ──────────────────────────────────────────────
function addAgentLog(level, message) {
  const entry = {
    id: `agent-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    type: 'agent-reasoning',
    level,
    message,
    timestamp: Date.now(),
  };
  broadcast('log-event', entry);
  fileLog(entry);
}

export { triggerAgentAnalysis };
