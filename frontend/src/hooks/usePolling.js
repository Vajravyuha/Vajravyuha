import { useEffect, useState } from 'react';

export function usePolling(task, interval, enabled = true, dependencies = []) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || !interval) return undefined;
    let timer;
    let controller;
    let disposed = false;
    const run = async () => {
      if (document.visibilityState === 'hidden') return;
      controller?.abort();
      controller = new AbortController();
      try { await task(controller.signal); } catch (error) { if (error.name !== 'AbortError' && !disposed) setTick((n) => n + 1); }
    };
    run();
    timer = window.setInterval(run, interval);
    return () => { disposed = true; window.clearInterval(timer); controller?.abort(); };
  // task is intentionally supplied by the caller as a stable callback
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, interval, ...dependencies]);
  return tick;
}
