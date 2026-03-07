import { useState, useEffect, useCallback } from 'react';
import { Brain, TrendingUp, AlertTriangle, CheckCircle, Clock, ChevronDown, ChevronUp, BarChart3 } from 'lucide-react';
import { getAgentDecisions, getAgentPerformance } from '../utils/api';

function OutcomeBadge({ outcome }) {
  const styles = {
    pending: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    delivered: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    fully_sold: 'bg-green-500/20 text-green-300 border-green-500/30',
    partial_waste: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    full_waste: 'bg-red-500/20 text-red-300 border-red-500/30',
  };
  const labels = {
    pending: 'Pending',
    delivered: 'Delivered',
    fully_sold: 'Fully Sold',
    partial_waste: 'Partial Waste',
    full_waste: 'Full Waste',
  };
  const style = styles[outcome] || styles.pending;
  const label = labels[outcome] || outcome;

  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${style}`}>
      {label}
    </span>
  );
}

function EfficiencyBar({ value, label }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500';
  const textColor = pct >= 80 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-[#8b8fa3] w-14">{label}</span>
      <div className="flex-1 h-1.5 bg-[#2e3344] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[10px] font-medium w-8 text-right ${textColor}`}>{pct}%</span>
    </div>
  );
}

function DecisionCard({ decision }) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(decision.created_at).toLocaleTimeString('en-US', { hour12: false });
  const orders = (decision.orders || []).filter(o => o.itemId);
  const totalOrdered = orders.reduce((sum, o) => sum + (o.quantityOrdered || 0), 0);
  const totalSold = orders.reduce((sum, o) => sum + (o.quantitySold || 0), 0);
  const totalExpired = orders.reduce((sum, o) => sum + (o.quantityExpired || 0), 0);

  const tierColor = {
    groq: 'text-purple-400',
    openclaw: 'text-blue-400',
    fallback: 'text-yellow-400',
  }[decision.tier] || 'text-[#8b8fa3]';

  const tierLabel = {
    groq: 'Groq LLM',
    openclaw: 'OpenClaw',
    fallback: 'Rule-based',
  }[decision.tier] || decision.tier;

  return (
    <div className="bg-[#1a1d27] rounded-lg border border-[#2e3344] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#1e2130] transition-colors"
      >
        <Clock size={11} className="text-[#555] shrink-0" />
        <span className="text-[11px] text-[#8b8fa3]">{time}</span>
        <span className={`text-[10px] font-medium ${tierColor}`}>{tierLabel}</span>
        <span className="text-[11px] text-[#8b8fa3] ml-auto">
          {orders.length === 0 ? 'No orders' : `${orders.length} items, ${totalOrdered} units`}
        </span>
        {totalSold > 0 && <span className="text-[10px] text-green-400">{totalSold} sold</span>}
        {totalExpired > 0 && <span className="text-[10px] text-red-400">{totalExpired} wasted</span>}
        {expanded ? <ChevronUp size={12} className="text-[#555]" /> : <ChevronDown size={12} className="text-[#555]" />}
      </button>

      {expanded && (
        <div className="px-3 pb-2 space-y-1.5 border-t border-[#2e3344]">
          {decision.reasoning && (
            <p className="text-[11px] text-[#8b8fa3] italic pt-1.5">{decision.reasoning}</p>
          )}
          {orders.map((order, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] bg-[#232733] rounded px-2 py-1.5">
              <span className="font-medium text-white">{order.itemId}</span>
              <span className="text-[#8b8fa3]">ordered {order.quantityOrdered}</span>
              {order.quantityArrived != null && (
                <>
                  <span className="text-green-400">{order.quantitySold || 0} sold</span>
                  <span className="text-red-400">{order.quantityExpired || 0} expired</span>
                </>
              )}
              <span className="ml-auto">
                <OutcomeBadge outcome={order.outcome} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgentInsights({ wsOn }) {
  const [decisions, setDecisions] = useState([]);
  const [performance, setPerformance] = useState([]);
  const [tab, setTab] = useState('decisions');

  const loadData = useCallback(async () => {
    try {
      const [d, p] = await Promise.all([
        getAgentDecisions(15),
        getAgentPerformance(),
      ]);
      setDecisions(d);
      setPerformance(p);
    } catch {
      // DB might not be ready yet
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Refresh on new agent decisions via WebSocket
  useEffect(() => {
    if (!wsOn) return;
    const unsub = wsOn('agent-decision', () => {
      setTimeout(loadData, 1000);
    });
    return unsub;
  }, [wsOn, loadData]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#2e3344]">
        <Brain size={14} className="text-purple-400" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#8b8fa3]">
          Agent Memory
        </h2>
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => setTab('decisions')}
            className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
              tab === 'decisions'
                ? 'bg-purple-600/20 text-purple-300 border border-purple-600/30'
                : 'text-[#555] hover:text-[#8b8fa3]'
            }`}
          >
            Decisions
          </button>
          <button
            onClick={() => setTab('performance')}
            className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
              tab === 'performance'
                ? 'bg-purple-600/20 text-purple-300 border border-purple-600/30'
                : 'text-[#555] hover:text-[#8b8fa3]'
            }`}
          >
            Performance
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {tab === 'decisions' && (
          decisions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[#555] text-xs gap-2">
              <Brain size={24} />
              <p>No decisions recorded yet</p>
              <p className="text-[10px]">Agent memory builds as decisions are made</p>
            </div>
          ) : (
            decisions.map(d => (
              <DecisionCard key={d.decision_id} decision={d} />
            ))
          )
        )}

        {tab === 'performance' && (
          performance.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[#555] text-xs gap-2">
              <BarChart3 size={24} />
              <p>Performance data builds over time</p>
              <p className="text-[10px]">Scores computed every 60 seconds</p>
            </div>
          ) : (
            <div className="space-y-2">
              {performance.map(p => {
                const efficiency = p.efficiency != null ? p.efficiency : null;
                const wasteRate = p.waste_rate != null ? p.waste_rate : null;
                return (
                  <div key={p.item_id} className="bg-[#1a1d27] rounded-lg p-3 border border-[#2e3344]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold capitalize">{p.item_id}</span>
                      <div className="flex items-center gap-3 text-[10px] text-[#8b8fa3]">
                        <span>Ordered: {p.total_ordered}</span>
                        <span className="text-green-400">Sold: {p.total_sold}</span>
                        <span className="text-red-400">Expired: {p.total_expired}</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <EfficiencyBar value={efficiency} label="Efficiency" />
                      <EfficiencyBar value={wasteRate != null ? 1 - wasteRate : null} label="Anti-waste" />
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}
