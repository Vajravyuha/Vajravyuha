import React from 'react';
import { compact, relativeTime, shortSha } from '../lib/format';
import { useReveal } from '../hooks/useReveal';

const statuses = ['PENDING', 'BUILDING', 'SCANNING', 'STARTING', 'RUNNING', 'BLOCKED', 'FAILED', 'STOPPED'];
export default function History({ deployments, selectedId, loading, error, onSelect, onRetry }) {
  const { ref, visible } = useReveal();
  const counts = statuses.reduce((acc, status) => ({ ...acc, [status]: deployments.filter((d) => d.status === status).length }), {});
  return <section className={`panel history-panel reveal ${visible ? 'is-visible' : ''}`} ref={ref}>
    <div className="history-top"><div><div className="eyebrow">DEPLOYMENT HISTORY <span className="heading-index">03</span></div><h2>Recent deployments</h2></div><span className="history-window">Latest 20</span></div>
    <div className="summary-strip" aria-label="Deployment counts by status">{statuses.filter((status) => counts[status] > 0).map((status) => <span className={`summary-item status-${status.toLowerCase()}`} key={status}><i className="status-dot"/><span>{status.toLowerCase()}</span><b className="mono">{counts[status]}</b></span>)}{!deployments.length && <span className="summary-empty">No deployment counts yet</span>}</div>
    {error ? <div className="history-state error-state"><span>{error}</span><button className="text-button" onClick={onRetry}>Retry</button></div> : loading && !deployments.length ? <div className="history-state">Loading recent deployments…</div> : !deployments.length ? <div className="history-state"><span>No deployments yet. Submit a repository above to create the first record.</span></div> : <div className="history-table-wrap"><table><thead><tr><th>Status</th><th>Application</th><th>Environment</th><th>Repository</th><th>Commit</th><th>Age</th></tr></thead><tbody>{deployments.map((item) => <tr key={item.id} className={`${selectedId === item.id ? 'selected' : ''}`} onClick={() => onSelect(item.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(item.id); } }} tabIndex={0} aria-selected={selectedId === item.id}>
      <td data-label="Status"><span className={`history-status status-${(item.status || 'pending').toLowerCase()}`}><i className="status-dot"/>{item.status || 'UNKNOWN'}</span></td><td data-label="Application" className="history-app">{item.appName || 'Unnamed app'}</td><td data-label="Environment"><span className="environment-tag">{item.environment || '—'}</span></td><td data-label="Repository" className="mono history-repo" title={item.repoUrl}>{compact(item.repoUrl, 42)}</td><td data-label="Commit" className="mono">{shortSha(item.commitSha)}</td><td data-label="Age" title={item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}>{relativeTime(item.createdAt)}</td>
    </tr>)}</tbody></table></div>}
  </section>;
}
