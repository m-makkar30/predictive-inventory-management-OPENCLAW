import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { getInventory, getLogs, getDemandHistory } from './utils/api';
import OrderPanel from './components/OrderPanel';
import LogPanel from './components/LogPanel';
import InventoryDashboard from './components/InventoryDashboard';
import { Wifi, WifiOff } from 'lucide-react';

const WS_URL = `ws://${window.location.hostname}:3001`;

function App() {
  const [inventory, setInventory] = useState(null);
  const [logs, setLogs] = useState([]);
  const [demandHistory, setDemandHistory] = useState([]);
  const { connected, on } = useWebSocket(WS_URL);

  // Initial data load
  useEffect(() => {
    async function loadInitial() {
      try {
        const [inv, logData, demand] = await Promise.all([
          getInventory(),
          getLogs(200),
          getDemandHistory(10),
        ]);
        setInventory(inv);
        setLogs(logData);
        setDemandHistory(demand);
      } catch (err) {
        console.error('Failed to load initial data:', err);
      }
    }
    loadInitial();
  }, []);

  // WebSocket event handlers
  const handleInventoryUpdate = useCallback((data) => {
    setInventory(data);
  }, []);

  const handleLogEvent = useCallback((data) => {
    setLogs(prev => {
      const next = [...prev, data];
      return next.length > 500 ? next.slice(-500) : next;
    });
    // Also refresh demand history
    if (data.type === 'sale') {
      getDemandHistory(10).then(setDemandHistory).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const unsub1 = on('inventory-update', handleInventoryUpdate);
    const unsub2 = on('log-event', handleLogEvent);
    return () => { unsub1(); unsub2(); };
  }, [on, handleInventoryUpdate, handleLogEvent]);

  // Periodic demand history refresh
  useEffect(() => {
    const interval = setInterval(() => {
      getDemandHistory(10).then(setDemandHistory).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const items = inventory?.items || [];

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0f1117] overflow-hidden">
      {/* Top Bar */}
      <header className="flex items-center justify-between px-5 py-2 bg-[#0d0f15] border-b border-[#2e3344] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-lg">🦞</span>
          <h1 className="text-sm font-bold tracking-wide">
            <span className="text-blue-400">OpenClaw</span>
            <span className="text-[#8b8fa3] ml-1">Smart Inventory Agent</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <div className="flex items-center gap-1.5 text-green-400 text-xs">
              <Wifi size={12} />
              <span>Live</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-red-400 text-xs">
              <WifiOff size={12} />
              <span>Disconnected</span>
            </div>
          )}
          <span className="text-[#555] text-xs ml-3">
            {new Date().toLocaleDateString()}
          </span>
        </div>
      </header>

      {/* Main Content - 3 sections */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Order + Logs (1/4 width) */}
        <div className="w-[25%] min-w-[280px] flex flex-col border-r border-[#2e3344]">
          {/* Order Panel - top half */}
          <div className="h-1/2 border-b border-[#2e3344] overflow-hidden">
            <OrderPanel items={items} />
          </div>
          {/* Log Panel - bottom half */}
          <div className="h-1/2 overflow-hidden">
            <LogPanel logs={logs} />
          </div>
        </div>

        {/* Right Panel - Inventory Dashboard (3/4 width) */}
        <div className="flex-1 overflow-hidden">
          <InventoryDashboard
            inventory={inventory}
            demandHistory={demandHistory}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
