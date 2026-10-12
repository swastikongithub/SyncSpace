/** In-process counters and latency windows. Single-instance by design; see README limitations. */
export function createMetrics({ windowSize = 2000 } = {}) {
  const startedAt = Date.now();
  const counters = new Map();
  const windows = new Map();

  function inc(name, amount = 1) {
    counters.set(name, (counters.get(name) ?? 0) + amount);
  }

  function observe(name, value) {
    let window = windows.get(name);
    if (!window) {
      window = [];
      windows.set(name, window);
    }
    window.push(value);
    if (window.length > windowSize) window.shift();
  }

  function summarize(values) {
    if (values.length === 0) return { count: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const round = (n) => Math.round(n * 100) / 100;
    return { count: sorted.length, p50: round(at(0.5)), p95: round(at(0.95)), max: round(sorted.at(-1)) };
  }

  function snapshot() {
    return {
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      counters: Object.fromEntries([...counters.entries()].sort(([a], [b]) => a.localeCompare(b))),
      latencyMs: Object.fromEntries([...windows.entries()].map(([name, values]) => [name, summarize(values)])),
    };
  }

  return { inc, observe, snapshot };
}
