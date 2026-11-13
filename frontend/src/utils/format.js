export const formatDate = (iso) =>
  new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export const formatDateTime = (iso) =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export const formatCurrency = (n) => '₹' + Number(n).toLocaleString('en-IN');

// 1500 -> "1.5 s", 90000 -> "1 min 30 s", 7200000 -> "2 h"
export const formatDuration = (ms) => {
  const n = Math.max(0, Math.round(Number(ms)));
  if (n < 1000) return `${n} ms`;
  const s = n / 1000;
  if (s < 60) return `${Number.isInteger(s) ? s : s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  if (m < 60) return rest ? `${m} min ${rest} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
};

// Same formula as the server: min(initialDelay * multiplier ^ retryCount, maxDelay)
export const retryDelay = (retryCount, cfg) => Math.round(Math.min(cfg.initialDelayMs * Math.pow(cfg.backoffMultiplier, retryCount), cfg.maxDelayMs));
