import { useRef, useEffect, useState } from 'react';
import { ScrollText, ArrowDown } from 'lucide-react';

const TYPE_STYLES = {
  'sale':            { color: 'text-blue-300',   bg: '' },
  'agent-order':     { color: 'text-purple-300', bg: '' },
  'manual-order':    { color: 'text-cyan-300',   bg: '' },
  'arrival':         { color: 'text-green-300',  bg: '' },
  'expired':         { color: 'text-red-400',    bg: 'bg-red-950/30' },
  'stockout':        { color: 'text-red-400',    bg: 'bg-red-950/30' },
  'agent-reasoning': { color: 'text-purple-300', bg: 'bg-purple-950/20' },
  'system':          { color: 'text-[#8b8fa3]',  bg: '' },
};

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
}

export default function LogPanel({ logs }) {
  const bottomRef = useRef(null);
  const containerRef = useRef(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const isAutoScrolling = useRef(false);

  // Detect if user has manually scrolled away from bottom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      if (isAutoScrolling.current) return;
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setUserScrolledUp(distFromBottom > 60);
    };

    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-scroll to bottom on new logs unless user scrolled up
  useEffect(() => {
    if (!userScrolledUp && containerRef.current) {
      isAutoScrolling.current = true;
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      // Reset flag after scroll event fires
      requestAnimationFrame(() => { isAutoScrolling.current = false; });
    }
  }, [logs, userScrolledUp]);

  const scrollToBottom = () => {
    setUserScrolledUp(false);
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  };

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2e3344]">
        <ScrollText size={16} className="text-purple-400" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#8b8fa3]">
          Activity Log
        </h2>
        <span className="ml-auto text-xs text-[#555]">{logs.length} events</span>
      </div>

      <div ref={containerRef} className="flex-1 overflow-y-auto p-2 space-y-0.5 font-mono text-xs">
        {logs.length === 0 && (
          <div className="text-[#555] text-center py-8">Waiting for events...</div>
        )}
        {logs.map((log) => {
          const style = TYPE_STYLES[log.type] || TYPE_STYLES.system;
          return (
            <div
              key={log.id}
              className={`px-2 py-1 rounded ${style.bg} ${style.color} leading-relaxed`}
            >
              <span className="text-[#555] mr-2">{formatTime(log.timestamp)}</span>
              {log.message}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Scroll-to-bottom button when user has scrolled up */}
      {userScrolledUp && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-3 right-3 p-1.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white shadow-lg transition-colors"
        >
          <ArrowDown size={14} />
        </button>
      )}
    </div>
  );
}
