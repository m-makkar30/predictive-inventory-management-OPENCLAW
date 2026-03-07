const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

export function getInventory() {
  return request('/inventory');
}

export function getLogs(limit = 200) {
  return request(`/logs?limit=${limit}`);
}

export function getDemandHistory(minutes = 10) {
  return request(`/demand-history?minutes=${minutes}`);
}

export function placeOrder(itemId, quantity = 1) {
  return request('/order', {
    method: 'POST',
    body: JSON.stringify({ itemId, quantity }),
  });
}

export function manualProcure(itemId, quantity) {
  return request('/manual-procure', {
    method: 'POST',
    body: JSON.stringify({ itemId, quantity }),
  });
}

export function triggerAgent() {
  return request('/trigger-agent', { method: 'POST' });
}

export function getAgentDecisions(limit = 20) {
  return request(`/agent/decisions?limit=${limit}`);
}

export function getAgentPerformance() {
  return request('/agent/performance');
}
