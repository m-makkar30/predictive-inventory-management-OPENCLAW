# Smart Inventory Agent

AI-powered real-time inventory management for a grocery warehouse. An LLM agent ([OpenClaw](https://github.com/openclaw/openclaw) + Groq) watches demand, forecasts stock depletion, and places procurement orders autonomously — minimizing both stockouts and expiry waste.

**Stack**: React 19 / Vite / TailwindCSS | Express / Node 22 / WebSocket | OpenClaw | Groq (`llama-3.3-70b-versatile`)

## Setup

**Prerequisites:** Node >= 22, npm, a [Groq API key](https://console.groq.com) (free tier works)

```bash
# Install dependencies
cd server && npm install && cd ../client && npm install && cd ..

# Install & configure OpenClaw
npm install -g openclaw@latest
openclaw config set gateway.mode local

# Add your Groq key
echo "GROQ_API_KEY=your_key_here" > .env

# Run everything
bash start.sh
```

Open **http://localhost:5173**. Press `Ctrl+C` to stop.

`start.sh` launches three services: OpenClaw Gateway (:18789), Express server (:3001), and Vite dev server (:5173).

## How It Works

The system manages 10 grocery items, each with its own lead time (1–2 min to procure) and expiry time (1–15 min shelf life). Every stock unit is tracked individually with its own expiry timestamp.

### Inventory Engine (`server/inventory.js`)

All state lives in memory. The core loop runs on a **1-second tick** that:
- Removes expired units and logs waste
- Delivers arrived procurement orders (each unit gets a fresh expiry timer)

**Selling uses FIFO** — stock is sorted by expiry date ascending, so the oldest units always sell first. This naturally clears items about to expire before they become waste.

**Demand analytics** are computed across multiple time windows (1min, 2min, 5min, 10min) to capture both sustained patterns and sudden surges. Key derived metrics:
- **Peak velocity** — highest consumption rate across all windows (guards against surge blindness from averaging)
- **Demand trend** — is velocity accelerating or decelerating?
- **Depletion forecast** — minutes until stock hits zero at peak rate
- **Stockout prediction** — will stock run out before a new order can physically arrive?

### AI Agent (`server/agent.js`)

Runs every **30 seconds** with a three-tier fallback:

1. **Groq Direct API** — synchronous LLM call with structured JSON response
2. **OpenClaw Webhook** — async agent that calls back to our API using tools
3. **Rule-based fallback** — deterministic algorithm using the same demand math

The agent uses a **dual ordering strategy**:

- **Demand-driven**: When items are actively selling, order `peakVelocity * leadTime * 2.5` units minus what's already in stock/transit. Hard-capped at `peakVelocity * expiryTime * 0.5` to prevent over-ordering that causes waste. Decelerating demand reduces orders by 30%.

- **Baseline maintenance**: When demand drops to zero, every item still maintains a minimum of 5 units. Empty shelves are never acceptable — demand can return at any time.

**Waste awareness**: The agent tracks a waste ratio (`totalExpired / totalSold`) per item. High ratios signal over-ordering, and the prompt instructs the LLM to cut back to baseline-only ordering for wasteful items.

The LLM receives **exact formulas** (not vague instructions), **urgency flags** per item (EMPTY / WILL STOCKOUT / BELOW BASELINE / LOW / OK), and **previous order context** to prevent double-ordering.

### Web UI (`client/`)

Single-page dark-themed dashboard with three sections:
- **Order Panel** (left top) — 10 item buttons to simulate customer demand in real time
- **Activity Log** (left bottom) — color-coded event feed, auto-scrolls to latest, red highlights for stockouts/expirations
- **Inventory Dashboard** (right) — stock levels, pending orders, demand velocity, waste stats. Click any item for detailed view with per-unit expiry bars, demand charts, and manual procurement controls.

All updates are pushed via WebSocket — no polling.

### OpenClaw

The gateway runs locally and hosts a custom `inventory-manager` skill (`~/.openclaw/skills/inventory-manager/SKILL.md`) that teaches the agent to analyze snapshots and place orders via the Express API. Config lives in `~/.openclaw/openclaw.json`.

## Project Structure

```
server/
  index.js        — Express API + background ticks
  inventory.js    — Stock engine, FIFO, expiry, demand analytics
  agent.js        — LLM agent loop, Groq/OpenClaw/fallback
  websocket.js    — Real-time broadcast to clients
  items.js        — 10 item configs (lead time, expiry, cost, price)

client/src/
  App.jsx                    — Layout, WebSocket, state
  components/OrderPanel.jsx  — Customer order buttons
  components/LogPanel.jsx    — Auto-scrolling activity log
  components/InventoryDashboard.jsx — Overview + stats
  components/ItemDetail.jsx  — Per-item detail + charts
```
