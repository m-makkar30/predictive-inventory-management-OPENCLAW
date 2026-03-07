#!/usr/bin/env node

// ── Demand Simulator ─────────────────────────────────────────────────
// Standalone script that simulates customer demand patterns against
// the running inventory system. Run in a separate terminal while the
// main application is up (bash start.sh).
//
// Usage: node simulate.js

const API = process.env.API_URL || 'http://localhost:3001';

const ITEMS = ['eggs', 'milk', 'bread', 'tomatoes', 'chicken', 'rice', 'bananas', 'yogurt', 'lettuce', 'cheese'];
const SHORT_EXPIRY = ['yogurt', 'lettuce', 'cheese', 'bread', 'bananas'];
const LONG_EXPIRY = ['rice', 'eggs', 'tomatoes', 'milk', 'chicken'];

// ── Helpers ──────────────────────────────────────────────────────────

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function placeOrder(itemId, quantity) {
  try {
    const res = await fetch(`${API}/api/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId, quantity }),
    });
    const data = await res.json();
    const status = data.success ? `sold ${data.sold}` : data.error;
    log(`  ${itemId} x${quantity} -> ${status}`);
    return data;
  } catch (err) {
    log(`  ERROR: ${err.message}`);
    return { success: false };
  }
}

let startTime = Date.now();

function log(msg) {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  const ts = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  console.log(`[${ts}] ${msg}`);
}

// ── Mode Definitions ─────────────────────────────────────────────────

const MODES = {
  steady: {
    name: 'Steady Burn',
    duration: '5 min',
    description:
      'Consistent moderate demand on 4 items (eggs, milk, bread, chicken).\n' +
      '  Every 3-5 seconds, 1-2 units of a random item from the set are ordered.\n' +
      '  The remaining 6 items get zero demand.',
    expect:
      'The agent should learn stable order sizes for the 4 active items and\n' +
      '  achieve high efficiency (>80%). It should maintain baseline stock for\n' +
      '  the 6 idle items without over-ordering them. Watch the Agent Memory\n' +
      '  panel — after ~2 min, decision outcomes should show mostly "fully_sold"\n' +
      '  for the active items. Waste rate should stay below 20%.',
    async run(signal) {
      const active = ['eggs', 'milk', 'bread', 'chicken'];
      while (!signal.stopped) {
        await placeOrder(pick(active), randInt(1, 2));
        await sleep(randInt(3000, 5000));
      }
    },
  },

  surge: {
    name: 'Surge & Vanish',
    duration: '7 min (3 min surge + 4 min silence)',
    description:
      'Phase 1 (0:00-3:00): Heavy demand on tomatoes and bananas.\n' +
      '  Orders every 1-2 seconds, 2-4 units each. Simulates a rush.\n' +
      'Phase 2 (3:00-7:00): Complete silence. No orders at all.\n' +
      '  All demand drops to zero instantly.',
    expect:
      'During Phase 1, the agent should ramp up ordering for tomatoes and\n' +
      '  bananas aggressively. When Phase 2 hits, the key test begins:\n' +
      '  the agent should STOP ordering these items once it sees demand vanish.\n' +
      '  If memory works, by ~4:00 the agent should recognize waste building\n' +
      '  and cut back to baseline-only. Watch for "partial_waste" or "full_waste"\n' +
      '  outcomes appearing in the decision timeline — the agent should learn\n' +
      '  from these and reduce subsequent order sizes.',
    async run(signal) {
      const surgeItems = ['tomatoes', 'bananas'];
      const surgeEnd = Date.now() + 3 * 60 * 1000;

      // Phase 1: Surge
      log('PHASE 1: Surge on tomatoes + bananas');
      while (!signal.stopped && Date.now() < surgeEnd) {
        await placeOrder(pick(surgeItems), randInt(2, 4));
        await sleep(randInt(1000, 2000));
      }

      if (signal.stopped) return;

      // Phase 2: Silence
      log('PHASE 2: Demand vanished. Watching agent adapt...');
      while (!signal.stopped) {
        await sleep(5000);
      }
    },
  },

  wave: {
    name: 'Rolling Wave',
    duration: '12 min (4 waves of 3 min each)',
    description:
      'Demand rotates across item groups in 3-minute cycles:\n' +
      '  Wave 1 (0:00-3:00): eggs + milk + bread (breakfast rush)\n' +
      '  Wave 2 (3:00-6:00): chicken + tomatoes + lettuce (lunch prep)\n' +
      '  Wave 3 (6:00-9:00): yogurt + bananas + cheese (snack time)\n' +
      '  Wave 4 (9:00-12:00): rice + eggs + chicken (dinner)\n' +
      '  Each wave: orders every 2-3s, 1-3 units.',
    expect:
      'This tests whether the agent adapts to SHIFTING demand. Each 3-min wave\n' +
      '  gives the agent ~9 decision cycles with near-instant delivery (~18-30s\n' +
      '  lead times). After Wave 1 ends, the agent should stop over-ordering\n' +
      '  breakfast items. By Wave 3-4, the agent should show lower waste rates\n' +
      '  because it learned from Wave 1-2 outcomes. Watch for items from previous\n' +
      '  waves accumulating "partial_waste" outcomes — later waves should have\n' +
      '  fewer waste outcomes than earlier ones.',
    async run(signal) {
      const waves = [
        { label: 'Wave 1: Breakfast rush', items: ['eggs', 'milk', 'bread'] },
        { label: 'Wave 2: Lunch prep', items: ['chicken', 'tomatoes', 'lettuce'] },
        { label: 'Wave 3: Snack time', items: ['yogurt', 'bananas', 'cheese'] },
        { label: 'Wave 4: Dinner', items: ['rice', 'eggs', 'chicken'] },
      ];
      const waveDuration = 180 * 1000;

      for (const wave of waves) {
        if (signal.stopped) return;
        log(wave.label);
        const waveEnd = Date.now() + waveDuration;
        while (!signal.stopped && Date.now() < waveEnd) {
          await placeOrder(pick(wave.items), randInt(1, 3));
          await sleep(randInt(2000, 3000));
        }
      }

      if (!signal.stopped) {
        log('All waves complete. Observing...');
        while (!signal.stopped) await sleep(5000);
      }
    },
  },

  perishable: {
    name: 'Perishable Pressure',
    duration: '5 min',
    description:
      'Targets only short-expiry items: yogurt (1m), lettuce (2m), cheese (4m),\n' +
      '  bread (5m), bananas (5m). Moderate demand: every 3-4s, 1-2 units.\n' +
      '  These items expire fast, so the agent must learn precise batch sizing.',
    expect:
      'This is the hardest mode for the agent. Short-expiry items punish over-\n' +
      '  ordering severely — units expire before they can be sold. The agent\n' +
      '  should learn to use SMALL batches (2-4 units) instead of large ones.\n' +
      '  Watch the performance tab: waste_rate for yogurt and lettuce will likely\n' +
      '  start high (>50%) but should decrease over time as memory kicks in.\n' +
      '  After ~3 min, the agent should show efficiency improving cycle over\n' +
      '  cycle. If avg_order_size trends downward for these items, learning works.',
    async run(signal) {
      while (!signal.stopped) {
        await placeOrder(pick(SHORT_EXPIRY), randInt(1, 2));
        await sleep(randInt(3000, 4000));
      }
    },
  },

  chaos: {
    name: 'Chaos',
    duration: '5 min',
    description:
      'Completely random: any item, 1-5 units, every 1-6 seconds.\n' +
      '  Includes random bursts (5-8 rapid orders in a row) and random\n' +
      '  quiet periods (10-20s gaps). Unpredictable by design.',
    expect:
      'Stress test for robustness. The agent cannot predict this pattern,\n' +
      '  so it should fall back on reactive ordering and baseline maintenance.\n' +
      '  Key metric: no item should stay at 0 stock for more than ~2 minutes.\n' +
      '  The agent should maintain reasonable efficiency (>50%) despite chaos.\n' +
      '  Watch for the fallback tier activating if Groq gets rate-limited\n' +
      '  under the rapid event stream.',
    async run(signal) {
      while (!signal.stopped) {
        // Random burst or single order
        if (Math.random() < 0.2) {
          // Burst: 5-8 rapid orders
          const burstSize = randInt(5, 8);
          log(`BURST: ${burstSize} rapid orders`);
          for (let i = 0; i < burstSize && !signal.stopped; i++) {
            await placeOrder(pick(ITEMS), randInt(1, 5));
            await sleep(randInt(300, 800));
          }
        } else {
          await placeOrder(pick(ITEMS), randInt(1, 3));
        }

        // Random gap
        if (Math.random() < 0.15) {
          const gap = randInt(10000, 20000);
          log(`Quiet period: ${Math.round(gap / 1000)}s`);
          await sleep(gap);
        } else {
          await sleep(randInt(1000, 6000));
        }
      }
    },
  },
};

// ── Interactive Mode Selection ───────────────────────────────────────

async function checkServer() {
  try {
    const res = await fetch(`${API}/api/inventory`);
    const data = await res.json();
    return data.items?.length === 10;
  } catch {
    return false;
  }
}

async function main() {
  console.log('\n========================================');
  console.log('  DEMAND SIMULATOR');
  console.log('  Stress-test the AI inventory agent');
  console.log('========================================\n');

  // Check server
  const serverUp = await checkServer();
  if (!serverUp) {
    console.log('ERROR: Cannot reach the inventory server at ' + API);
    console.log('Make sure the main application is running (bash start.sh)\n');
    process.exit(1);
  }
  console.log('Server connected at ' + API + '\n');

  // Display modes
  const modeKeys = Object.keys(MODES);
  console.log('Available modes:\n');

  modeKeys.forEach((key, i) => {
    const mode = MODES[key];
    console.log(`  [${i + 1}] ${mode.name} (${mode.duration})`);
    console.log(`      ${mode.description.split('\n').join('\n      ')}`);
    console.log('');
    console.log(`      EXPECTED AGENT BEHAVIOR:`);
    console.log(`      ${mode.expect.split('\n').join('\n      ')}`);
    console.log('');
  });

  // Read selection
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const answer = await new Promise(resolve => {
    rl.question(`Select mode [1-${modeKeys.length}]: `, resolve);
  });
  rl.close();

  const idx = parseInt(answer) - 1;
  if (isNaN(idx) || idx < 0 || idx >= modeKeys.length) {
    console.log('Invalid selection.\n');
    process.exit(1);
  }

  const selectedKey = modeKeys[idx];
  const mode = MODES[selectedKey];

  console.log(`\n--- Starting: ${mode.name} ---`);
  console.log('Press Ctrl+C to stop at any time.\n');

  const signal = { stopped: false };

  process.on('SIGINT', () => {
    console.log('\n\nStopping simulator...');
    signal.stopped = true;
    setTimeout(() => process.exit(0), 1000);
  });

  startTime = Date.now();
  await mode.run(signal);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
