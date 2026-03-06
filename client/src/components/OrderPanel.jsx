import { useState } from 'react';
import { ShoppingCart, Minus, Plus } from 'lucide-react';
import { placeOrder } from '../utils/api';

export default function OrderPanel({ items }) {
  const [quantities, setQuantities] = useState({});
  const [feedback, setFeedback] = useState({});

  const getQty = (id) => quantities[id] || 1;

  const setQty = (id, val) => {
    setQuantities(prev => ({ ...prev, [id]: Math.max(1, Math.min(10, val)) }));
  };

  const handleOrder = async (itemId) => {
    const qty = getQty(itemId);
    const result = await placeOrder(itemId, qty);

    if (result.success) {
      setFeedback(prev => ({ ...prev, [itemId]: { type: 'success', msg: `Sold ${result.sold}` } }));
    } else if (result.stockout) {
      setFeedback(prev => ({ ...prev, [itemId]: { type: 'error', msg: 'Out of stock!' } }));
    } else {
      setFeedback(prev => ({ ...prev, [itemId]: { type: 'error', msg: result.error } }));
    }

    setTimeout(() => {
      setFeedback(prev => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
    }, 1500);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2e3344]">
        <ShoppingCart size={16} className="text-blue-400" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#8b8fa3]">
          Customer Orders
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {items.map(item => {
          const fb = feedback[item.id];
          const stock = item.currentStock;
          const stockColor = stock === 0 ? 'text-red-400' : stock <= 5 ? 'text-yellow-400' : 'text-green-400';

          return (
            <div
              key={item.id}
              className="flex items-center gap-2 bg-[#1a1d27] rounded-lg px-3 py-2 hover:bg-[#232733] transition-colors"
            >
              <span className="text-lg w-7 shrink-0">{item.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{item.name}</div>
                <div className={`text-xs ${stockColor}`}>
                  {stock} in stock
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setQty(item.id, getQty(item.id) - 1)}
                  className="w-6 h-6 flex items-center justify-center rounded bg-[#232733] hover:bg-[#2e3344] text-[#8b8fa3] text-xs"
                >
                  <Minus size={12} />
                </button>
                <span className="w-5 text-center text-sm">{getQty(item.id)}</span>
                <button
                  onClick={() => setQty(item.id, getQty(item.id) + 1)}
                  className="w-6 h-6 flex items-center justify-center rounded bg-[#232733] hover:bg-[#2e3344] text-[#8b8fa3] text-xs"
                >
                  <Plus size={12} />
                </button>
              </div>

              <button
                onClick={() => handleOrder(item.id)}
                disabled={stock === 0}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  fb?.type === 'success' ? 'bg-green-600 text-white' :
                  fb?.type === 'error' ? 'bg-red-600 text-white' :
                  stock === 0 ? 'bg-[#232733] text-[#555] cursor-not-allowed' :
                  'bg-blue-600 hover:bg-blue-500 text-white'
                }`}
              >
                {fb ? fb.msg : 'Buy'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
