export function shortSha(value) { return value ? String(value).slice(0, 7) : '—'; }
export function compact(value, max = 38) { const s = String(value || '—'); return s.length > max ? `${s.slice(0, max - 1)}…` : s; }
export function relativeTime(value) {
  if (!value) return '—';
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  if (!Number.isFinite(diff)) return '—';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
export function exactTime(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}
export function duration(ms) {
  if (ms == null || ms < 0) return '—';
  const seconds = Math.floor(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
export function errorMessage(error) { return error?.message || 'The request could not be completed.'; }
