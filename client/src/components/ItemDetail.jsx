import { useState } from 'react';
import { X, Package, Clock, TrendingUp, AlertTriangle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { manualProcure } from '../utils/api';

function formatTimeRemaining(ms) {
  if (ms <= 0) return 'EXPIRED';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

function ExpiryBar({ unit, expiryTime }) {
  const now = Date.now();
  const total = expiryTime * 60000;
  const remaining = Math.max(0, unit.expiresAt - now);
  const pct = (remaining / total) * 100;

  const color = pct > 50 ? 'bg-green-500' : pct > 25 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="flex-1 h-1.5 bg-[#2e3344] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`w-16 text-right ${pct < 25 ? 'text-red-400' : 'text-[#8b8fa3]'}`}>
        {formatTimeRemaining(remaining)}
      </span>
    </div>
  );
}

export default function ItemDetail({ item, demandHistory, onClose }) {
  const [procureQty, setProcureQty] = useState(5);
  const [procuring, setProcuring] = useState(false);

  if (!item) return null;

  const handleProcure = async () => {
    setProcuring(true);
    await manualProcure(item.id, procureQty);
    setProcuring(false);
  };

  // Build demand chart data from history (group by 30-second intervals)
  const demandChartData = (() => {
    const itemDemand = demandHistory.filter(d => d.itemId === item.id);
    if (itemDemand.length === 0) return [];

    const now = Date.now();
    const buckets = [];
    for (let i = 10; i >= 0; i--) {
      const start = now - (i + 1) * 30000;
      const end = now - i * 30000;
      const qty = itemDemand
        .filter(d => d.timestamp >= start && d.timestamp < end)
        .reduce((sum, d) => sum + d.quantity, 0);
      buckets.push({
        time: new Date(end).toLocaleTimeString('en-US', { hour12: false, minute: '2-digit', second: '2-digit' }),
        demand: qty,
      });
    }
    return buckets;
  })();

  return (
    <div className="flex flex-col h-full bg-[#0f1117]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[#2e3344]">
        <span className="text-2xl">{item.emoji}</span>
        <div className="flex-1">
          <h2 className="text-lg font-bold">{item.name}</h2>
          <p className="text-xs text-[#8b8fa3]">
            Lead: {item.leadTime}min | Expiry: {item.expiryTime}min | Cost: ${item.cost} | Price: ${item.price}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-[#232733] text-[#8b8fa3] hover:text-white transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'In Stock', value: item.currentStock, icon: Package, color: item.currentStock === 0 ? 'text-red-400' : item.currentStock <= 5 ? 'text-yellow-400' : 'text-green-400' },
            { label: 'Pending', value: item.pendingTotal, icon: Clock, color: 'text-blue-400' },
            { label: 'Sold', value: item.totalSold, icon: TrendingUp, color: 'text-purple-400' },
            { label: 'Wasted', value: item.totalExpired, icon: AlertTriangle, color: 'text-red-400' },
          ].map(s => (
            <div key={s.label} className="bg-[#1a1d27] rounded-lg p-3 border border-[#2e3344]">
              <div className="flex items-center gap-1.5 text-[#8b8fa3] text-xs mb-1">
                <s.icon size={12} />
                {s.label}
              </div>
              <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Demand Chart */}
        <div className="bg-[#1a1d27] rounded-lg p-4 border border-[#2e3344]">
          <h3 className="text-sm font-semibold text-[#8b8fa3] mb-3">Demand (last 5 min, 30s intervals)</h3>
          {demandChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={demandChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2e3344" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#8b8fa3' }} />
                <YAxis tick={{ fontSize: 10, fill: '#8b8fa3' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#232733', border: '1px solid #2e3344', borderRadius: '8px', fontSize: '12px' }}
                  labelStyle={{ color: '#8b8fa3' }}
                />
                <Bar dataKey="demand" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-40 flex items-center justify-center text-[#555] text-sm">No demand data yet</div>
          )}
        </div>

        {/* Stock Expiry Timeline */}
        <div className="bg-[#1a1d27] rounded-lg p-4 border border-[#2e3344]">
          <h3 className="text-sm font-semibold text-[#8b8fa3] mb-3">
            Stock Units ({item.units?.length || 0}) - Expiry Timeline
          </h3>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {(!item.units || item.units.length === 0) ? (
              <div className="text-[#555] text-sm py-4 text-center">No stock</div>
            ) : (
              item.units.map((unit, i) => (
                <ExpiryBar key={unit.unitId} unit={unit} expiryTime={item.expiryTime} />
              ))
            )}
          </div>
        </div>

        {/* Pending Orders */}
        {item.pendingOrders?.length > 0 && (
          <div className="bg-[#1a1d27] rounded-lg p-4 border border-[#2e3344]">
            <h3 className="text-sm font-semibold text-[#8b8fa3] mb-3">Pending Orders</h3>
            <div className="space-y-2">
              {item.pendingOrders.map(o => (
                <div key={o.orderId} className="flex items-center justify-between text-sm bg-[#232733] rounded px-3 py-2">
                  <span>{o.quantity}x — {o.source === 'agent' ? '🤖 Agent' : '👤 Manual'}</span>
                  <span className="text-[#8b8fa3]">Arrives in {o.timeToArrivalMin}m</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Manual Procurement */}
        <div className="bg-[#1a1d27] rounded-lg p-4 border border-[#2e3344]">
          <h3 className="text-sm font-semibold text-[#8b8fa3] mb-3">Manual Procurement</h3>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={50}
              value={procureQty}
              onChange={e => setProcureQty(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-20 bg-[#232733] border border-[#2e3344] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={handleProcure}
              disabled={procuring}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
            >
              {procuring ? 'Ordering...' : `Order ${procureQty} units`}
            </button>
            <span className="text-xs text-[#8b8fa3]">
              Arrives in {item.leadTime}min • Cost: ${(procureQty * item.cost).toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
