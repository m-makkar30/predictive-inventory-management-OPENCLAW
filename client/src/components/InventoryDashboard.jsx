import { useState } from 'react';
import { BarChart3, Warehouse, DollarSign, Trash2, AlertOctagon, Bot } from 'lucide-react';
import { triggerAgent } from '../utils/api';
import ItemDetail from './ItemDetail';

function StockBar({ current, initial, expiry }) {
  const maxDisplay = Math.max(initial * 1.5, current, 1);
  const pct = Math.min(100, (current / maxDisplay) * 100);
  const color = current === 0 ? 'bg-red-500' : current <= 5 ? 'bg-yellow-500' : 'bg-green-500';
  return (
    <div className="w-full h-2 bg-[#2e3344] rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function InventoryDashboard({ inventory, demandHistory }) {
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [triggeringAgent, setTriggeringAgent] = useState(false);

  if (!inventory) {
    return (
      <div className="flex items-center justify-center h-full text-[#555]">
        Loading inventory...
      </div>
    );
  }

  const selectedItem = selectedItemId
    ? inventory.items.find(i => i.id === selectedItemId)
    : null;

  if (selectedItem) {
    return (
      <ItemDetail
        item={selectedItem}
        demandHistory={demandHistory}
        onClose={() => setSelectedItemId(null)}
      />
    );
  }

  const handleTriggerAgent = async () => {
    setTriggeringAgent(true);
    await triggerAgent();
    setTimeout(() => setTriggeringAgent(false), 2000);
  };

  const totalStock = inventory.items.reduce((sum, i) => sum + i.currentStock, 0);
  const totalPending = inventory.items.reduce((sum, i) => sum + i.pendingTotal, 0);
  const outOfStock = inventory.items.filter(i => i.currentStock === 0).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-[#2e3344]">
        <Warehouse size={16} className="text-green-400" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#8b8fa3]">
          Inventory Dashboard
        </h2>
        <span className="ml-auto text-xs text-[#555]">
          Updated: {new Date(inventory.timestamp).toLocaleTimeString('en-US', { hour12: false })}
        </span>
        <button
          onClick={handleTriggerAgent}
          disabled={triggeringAgent}
          className="ml-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 text-xs font-medium transition-colors border border-purple-600/30 disabled:opacity-50"
        >
          <Bot size={12} />
          {triggeringAgent ? 'Analyzing...' : 'Trigger Agent'}
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-5 gap-3 p-4">
        {[
          { label: 'Total Stock', value: totalStock, icon: BarChart3, color: 'text-green-400' },
          { label: 'In Transit', value: totalPending, icon: Warehouse, color: 'text-blue-400' },
          { label: 'Out of Stock', value: outOfStock, icon: AlertOctagon, color: outOfStock > 0 ? 'text-red-400' : 'text-green-400' },
          { label: 'Revenue', value: `$${inventory.stats.totalRevenue}`, icon: DollarSign, color: 'text-emerald-400' },
          { label: 'Waste Cost', value: `$${inventory.stats.totalWaste}`, icon: Trash2, color: 'text-red-400' },
        ].map(s => (
          <div key={s.label} className="bg-[#1a1d27] rounded-lg p-3 border border-[#2e3344]">
            <div className="flex items-center gap-1.5 text-[#8b8fa3] text-xs mb-1">
              <s.icon size={12} />
              {s.label}
            </div>
            <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Items Grid */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          {inventory.items.map(item => {
            const stockColor = item.currentStock === 0 ? 'text-red-400' : item.currentStock <= 5 ? 'text-yellow-400' : 'text-green-400';
            const nearExpiry = item.units?.filter(u => parseFloat(u.timeToExpiryMin) < 2).length || 0;

            return (
              <div
                key={item.id}
                onClick={() => setSelectedItemId(item.id)}
                className="bg-[#1a1d27] rounded-xl p-4 border border-[#2e3344] hover:border-[#3b82f6]/50 cursor-pointer transition-all hover:bg-[#1e2130]"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{item.emoji}</span>
                    <div>
                      <h3 className="text-sm font-semibold">{item.name}</h3>
                      <p className="text-xs text-[#8b8fa3]">
                        Lead: {item.leadTime}m · Expiry: {item.expiryTime}m
                      </p>
                    </div>
                  </div>
                  <div className={`text-xl font-bold ${stockColor}`}>
                    {item.currentStock}
                  </div>
                </div>

                <StockBar current={item.currentStock} initial={item.initialStock} />

                <div className="flex items-center justify-between mt-2 text-xs text-[#8b8fa3]">
                  <span>Demand: {item.demandVelocity}/min</span>
                  {item.pendingTotal > 0 && (
                    <span className="text-blue-400">+{item.pendingTotal} incoming</span>
                  )}
                  {nearExpiry > 0 && (
                    <span className="text-orange-400">{nearExpiry} expiring soon</span>
                  )}
                </div>

                <div className="flex items-center gap-3 mt-2 text-xs text-[#555]">
                  <span>Sold: {item.totalSold}</span>
                  <span>Expired: {item.totalExpired}</span>
                  <span>Stockouts: {item.totalStockouts}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
