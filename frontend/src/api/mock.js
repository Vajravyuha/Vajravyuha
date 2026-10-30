const records = new Map();
const createdOrder = [];
const now = () => new Date().toISOString();
function stateAt(record) {
  if (record.stopped) return 'STOPPED';
  const age = Date.now() - record.startedAt;
  if (record.outcome === 'blocked') return age >= 8500 ? 'BLOCKED' : age >= 6000 ? 'SCANNING' : age >= 2500 ? 'BUILDING' : 'PENDING';
  if (record.outcome === 'failed') return age >= 4300 ? 'FAILED' : age >= 2500 ? 'BUILDING' : 'PENDING';
  if (age >= 11500) return 'RUNNING';
  if (age >= 8500) return 'STARTING';
  if (age >= 5500) return 'SCANNING';
  if (age >= 2200) return 'BUILDING';
  return 'PENDING';
}
function snapshot(record) {
  const status = stateAt(record);
  record.status = status;
  record.updatedAt = status === 'RUNNING' ? new Date(record.startedAt + 11500).toISOString() : now();
  const scanned = ['SCANNING', 'STARTING', 'RUNNING', 'BLOCKED'].includes(status);
  return { id: record.id, appName: record.appName, environment: record.environment, repoUrl: record.repoUrl, branch: record.branch, commitSha: record.commitSha, requestedBy: record.requestedBy, status, image: status === 'RUNNING' ? `ghcr.io/${record.appName}:latest` : null, port: status === 'RUNNING' ? 3000 : null, reason: status === 'FAILED' ? 'CLONE_FAILED' : null, criticalCount: record.outcome === 'blocked' && scanned ? 1 : scanned ? 0 : null, highCount: record.outcome === 'blocked' && scanned ? 25 : scanned ? 0 : null, mediumCount: record.outcome === 'blocked' && scanned ? 27 : scanned ? 0 : null, lowCount: record.outcome === 'blocked' && scanned ? 35 : scanned ? 0 : null, restartCount: 0, createdAt: record.createdAt, updatedAt: record.updatedAt };
}
export const mockApi = {
  async health() { return { ok: true, atlas: 'up' }; },
  async listDeployments() { return createdOrder.map((id) => snapshot(records.get(id))).reverse(); },
  async getDeployment(id) { const record = records.get(id); if (!record) throw new Error('Deployment not found (HTTP 404)'); return snapshot(record); },
  async createDeployment(payload) {
    const id = `dep_${Math.random().toString(36).slice(2, 8)}`;
    const outcome = payload.repoUrl.includes('vulnerable') ? 'blocked' : payload.repoUrl.includes('missing') ? 'failed' : 'normal';
    records.set(id, { ...payload, id, commitSha: Math.random().toString(16).slice(2, 10), status: 'PENDING', createdAt: now(), updatedAt: now(), startedAt: Date.now(), outcome, requestedBy: payload.requestedBy || 'console' });
    createdOrder.push(id);
    return { id };
  },
  async stopDeployment(id) { const record = records.get(id); if (record) { record.status = 'STOPPED'; record.stopped = true; record.updatedAt = now(); record.outcome = 'stopped'; record.startedAt = Date.now() - 20000; } return { ok: true }; },
  async getLogs(id) {
    const d = records.get(id); if (!d) return [];
    if (d.stopped) return [`${new Date(d.createdAt).toISOString()} deployment stopped by console`];
    const status = stateAt(d);
    const lines = [`${d.createdAt} deployment accepted: ${d.appName}`, `${new Date(d.startedAt + 1200).toISOString()} cloning repository ${d.repoUrl}`, `${new Date(d.startedAt + 2400).toISOString()} build context ready`];
    if (['SCANNING', 'STARTING', 'RUNNING', 'BLOCKED'].includes(status)) lines.push(`${new Date(d.startedAt + 5500).toISOString()} Atlas scan complete: ${d.outcome === 'blocked' ? 'critical findings detected' : 'no critical findings'}`);
    if (['STARTING', 'RUNNING'].includes(status)) lines.push(`${new Date(d.startedAt + 8500).toISOString()} starting container`);
    if (status === 'RUNNING') lines.push(`${new Date(d.startedAt + 11500).toISOString()} deployment is live`);
    if (status === 'BLOCKED') lines.push(`${new Date(d.startedAt + 8500).toISOString()} scan blocked the deploy`);
    if (status === 'FAILED') lines.push(`${new Date(d.startedAt + 4300).toISOString()} clone failed`);
    return lines;
  },
};
