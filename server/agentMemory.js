import { query } from './db.js';
import { v4 as uuidv4 } from 'uuid';

// ── Log a full agent decision cycle ──────────────────────────────────
// Called right after the agent produces orders (from any tier)
export async function logDecision({ tier, reasoning, snapshot, orders }) {
  const decisionId = uuidv4();

  try {
    await query(
      `INSERT INTO agent_decisions (decision_id, tier, reasoning, snapshot_json, orders_json)
       VALUES ($1, $2, $3, $4, $5)`,
      [decisionId, tier, reasoning || null, JSON.stringify(snapshot), JSON.stringify(orders)]
    );

    // Insert individual order rows — one per item ordered
    for (const order of orders) {
      await query(
        `INSERT INTO decision_orders (decision_id, item_id, quantity_ordered, procurement_id, outcome)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [decisionId, order.itemId, order.quantity, order.procurementId || null]
      );
    }

    return decisionId;
  } catch (err) {
    console.error('[AgentMemory] Failed to log decision:', err.message);
    return null;
  }
}

// ── Record delivery of a procurement order ───────────────────────────
// Called from inventory.js when a pending order arrives
export async function recordDelivery(procurementId, quantityArrived) {
  try {
    await query(
      `UPDATE decision_orders
       SET quantity_arrived = $1, arrived_at = NOW(), outcome = 'delivered'
       WHERE procurement_id = $2`,
      [quantityArrived, procurementId]
    );
  } catch (err) {
    console.error('[AgentMemory] recordDelivery:', err.message);
  }
}

// ── Track when units from a specific procurement order are sold ──────
export async function recordUnitSold(procurementId, count = 1) {
  try {
    await query(
      `UPDATE decision_orders
       SET quantity_sold = COALESCE(quantity_sold, 0) + $1
       WHERE procurement_id = $2`,
      [count, procurementId]
    );
  } catch (err) {
    console.error('[AgentMemory] recordUnitSold:', err.message);
  }
}

// ── Track when units from a specific procurement order expire ────────
export async function recordUnitExpired(procurementId, count = 1) {
  try {
    await query(
      `UPDATE decision_orders
       SET quantity_expired = COALESCE(quantity_expired, 0) + $1
       WHERE procurement_id = $2`,
      [count, procurementId]
    );
  } catch (err) {
    console.error('[AgentMemory] recordUnitExpired:', err.message);
  }
}

// ── Resolve fully consumed orders (all units either sold or expired) ─
export async function resolveCompletedOrders() {
  try {
    await query(`
      UPDATE decision_orders
      SET resolved_at = NOW(),
          outcome = CASE
            WHEN quantity_expired = 0 THEN 'fully_sold'
            WHEN quantity_sold = 0 THEN 'full_waste'
            ELSE 'partial_waste'
          END
      WHERE resolved_at IS NULL
        AND quantity_arrived IS NOT NULL
        AND (COALESCE(quantity_sold, 0) + COALESCE(quantity_expired, 0)) >= quantity_arrived
    `);
  } catch (err) {
    console.error('[AgentMemory] resolveCompletedOrders:', err.message);
  }
}

// ── Compute per-item performance scores ──────────────────────────────
// Called periodically (e.g., every 60s) to build performance history
export async function computePerformanceScores(windowMinutes = 10) {
  try {
    const { rows } = await query(`
      SELECT
        item_id,
        SUM(quantity_ordered) AS total_ordered,
        SUM(COALESCE(quantity_arrived, 0)) AS total_arrived,
        SUM(COALESCE(quantity_sold, 0)) AS total_sold,
        SUM(COALESCE(quantity_expired, 0)) AS total_expired,
        CASE WHEN SUM(COALESCE(quantity_arrived, 0)) > 0
          THEN SUM(COALESCE(quantity_sold, 0))::real / SUM(COALESCE(quantity_arrived, 0))::real
          ELSE NULL END AS efficiency,
        CASE WHEN SUM(COALESCE(quantity_arrived, 0)) > 0
          THEN SUM(COALESCE(quantity_expired, 0))::real / SUM(COALESCE(quantity_arrived, 0))::real
          ELSE NULL END AS waste_rate,
        AVG(quantity_ordered)::real AS avg_order_size
      FROM decision_orders
      WHERE ordered_at >= NOW() - make_interval(mins := $1)
      GROUP BY item_id
    `, [windowMinutes]);

    for (const row of rows) {
      await query(
        `INSERT INTO agent_performance
         (item_id, window_min, total_ordered, total_arrived, total_sold, total_expired, efficiency, waste_rate, avg_order_size)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [row.item_id, windowMinutes, row.total_ordered, row.total_arrived,
         row.total_sold, row.total_expired, row.efficiency, row.waste_rate, row.avg_order_size]
      );
    }

    return rows;
  } catch (err) {
    console.error('[AgentMemory] computePerformanceScores:', err.message);
    return [];
  }
}

// ── Get recent decisions for API / UI ────────────────────────────────
export async function getRecentDecisions(limit = 20) {
  try {
    const { rows: decisions } = await query(`
      SELECT d.decision_id, d.created_at, d.tier, d.reasoning,
             json_agg(json_build_object(
               'itemId', o.item_id,
               'quantityOrdered', o.quantity_ordered,
               'quantityArrived', o.quantity_arrived,
               'quantitySold', o.quantity_sold,
               'quantityExpired', o.quantity_expired,
               'outcome', o.outcome,
               'orderedAt', o.ordered_at,
               'arrivedAt', o.arrived_at,
               'resolvedAt', o.resolved_at
             ) ORDER BY o.id) AS orders
      FROM agent_decisions d
      LEFT JOIN decision_orders o ON o.decision_id = d.decision_id
      GROUP BY d.id, d.decision_id, d.created_at, d.tier, d.reasoning
      ORDER BY d.created_at DESC
      LIMIT $1
    `, [limit]);

    return decisions;
  } catch (err) {
    console.error('[AgentMemory] getRecentDecisions:', err.message);
    return [];
  }
}

// ── Get latest performance scores per item ───────────────────────────
export async function getLatestPerformance() {
  try {
    const { rows } = await query(`
      SELECT DISTINCT ON (item_id)
        item_id, computed_at, total_ordered, total_arrived,
        total_sold, total_expired, efficiency, waste_rate, avg_order_size
      FROM agent_performance
      ORDER BY item_id, computed_at DESC
    `);
    return rows;
  } catch (err) {
    console.error('[AgentMemory] getLatestPerformance:', err.message);
    return [];
  }
}

// ── Build memory context string for the agent prompt ─────────────────
// This is the key function: the agent sees its own past performance
export async function buildMemoryContext() {
  try {
    // Get last 5 decisions with outcomes
    const decisions = await getRecentDecisions(5);

    // Get latest performance per item
    const performance = await getLatestPerformance();

    if (decisions.length === 0 && performance.length === 0) {
      return '\nAGENT MEMORY: No previous decisions recorded yet. This is your first run.\n';
    }

    let context = '\n## AGENT MEMORY (your past decisions & outcomes):\n';

    // Performance summary
    if (performance.length > 0) {
      context += '\nPER-ITEM PERFORMANCE (recent window):\n';
      for (const p of performance) {
        const eff = p.efficiency != null ? `${(p.efficiency * 100).toFixed(0)}%` : 'N/A';
        const waste = p.waste_rate != null ? `${(p.waste_rate * 100).toFixed(0)}%` : 'N/A';
        context += `  ${p.item_id}: ordered=${p.total_ordered}, arrived=${p.total_arrived}, sold=${p.total_sold}, expired=${p.total_expired} | efficiency=${eff}, waste=${waste}, avgOrder=${p.avg_order_size?.toFixed(1) || 'N/A'}\n`;
      }
    }

    // Recent decision outcomes
    if (decisions.length > 0) {
      context += '\nRECENT DECISIONS (newest first):\n';
      for (const d of decisions) {
        const time = new Date(d.created_at).toLocaleTimeString('en-US', { hour12: false });
        const orderSummaries = d.orders
          .filter(o => o.itemId)
          .map(o => {
            const outcome = o.outcome || 'pending';
            let detail = `${o.itemId}: ordered ${o.quantityOrdered}`;
            if (o.quantityArrived != null) {
              detail += ` -> ${o.quantitySold || 0} sold, ${o.quantityExpired || 0} expired (${outcome})`;
            } else {
              detail += ` (${outcome})`;
            }
            return detail;
          })
          .join('; ');
        context += `  [${time}] via ${d.tier}: ${orderSummaries}\n`;
      }
    }

    context += '\nUSE THIS MEMORY: If you see high waste rates for an item, reduce order sizes. If efficiency is high, your ordering is good. Adapt based on outcomes.\n';

    return context;
  } catch (err) {
    console.error('[AgentMemory] buildMemoryContext:', err.message);
    return '';
  }
}
