import React, { useCallback, useEffect, useRef, useState } from 'react';
import { coreClient } from '../api/coreClient';
import { mockApi } from '../api/mock';
import { compact, duration, exactTime, relativeTime, shortSha } from '../lib/format';
import { useReveal } from '../hooks/useReveal';
import { Icon } from './Icons';

const stages = ['Queued', 'Build', 'Scan', 'Start', 'Live'];
const stageFor = (deployment) => {
  if (!deployment) return -1;
  const status = deployment.status;
  if (status === 'PENDING') return 0;
  if (status === 'BUILDING') return 1;
  if (status === 'SCANNING' || status === 'BLOCKED') return 2;
  if (status === 'STARTING') return 3;
  if (status === 'RUNNING') return 4;
  if (status === 'FAILED') {
    if (['CLONE_FAILED', 'NO_DOCKERFILE', 'BUILD_FAILED'].includes(deployment.reason)) return 1;
    if (deployment.reason === 'IMAGE_NOT_FOUND') return 3;
    return 2;
  }
  if (status === 'STOPPED') return 4;
  return -1;
};
function useCount(target, active) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active || target == null) { setValue(0); return; }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setValue(target); return; }
    const start = performance.now();
    const frame = (now) => { const p = Math.min(1, (now - start) / 180); setValue(Math.round(target * (1 - (1 - p) ** 3))); if (p < 1) requestAnimationFrame(frame); };
    const id = requestAnimationFrame(frame); return () => cancelAnimationFrame(id);
  }, [target, active]);
  return value;
}
function ScanReport({ deployment }) {
  const { ref, visible } = useReveal();
  const counts = [deployment.criticalCount, deployment.highCount, deployment.mediumCount, deployment.lowCount];
  const labels = ['Critical', 'High', 'Medium', 'Low'];
  const colors = ['critical', 'high', 'medium', 'low'];
  const present = counts.some((n) => n != null);
  const max = Math.max(1, ...counts.filter((n) => n != null));
  const blocked = deployment.status === 'BLOCKED' || Number(deployment.criticalCount) > 0;
  if (!present) return <section className={`subsection report-pending reveal ${visible ? 'is-visible' : ''}`} ref={ref}><SectionHeading label="Scan report" index="03"/><p className="quiet-copy">Scan results will appear when Atlas completes its review.</p></section>;
  return <section className={`subsection scan-report reveal ${visible ? 'is-visible' : ''}`} ref={ref}>
    <SectionHeading label="Scan report" index="03"/>
    <div className={`verdict ${blocked ? 'verdict-blocked' : 'verdict-passed'}`} aria-live="polite"><span className="verdict-icon"><Icon name={blocked ? 'stop' : 'check'} size={16}/></span><div><strong>{blocked ? 'Scan blocked the deploy.' : 'Passed. No critical findings.'}</strong><span>{blocked ? `${deployment.criticalCount || 0} critical finding${Number(deployment.criticalCount) === 1 ? '' : 's'}. No container was started.` : 'No critical findings. The image passed the deployment gate.'}</span></div></div>
    <div className="severity-list">{labels.map((label, i) => <SeverityRow key={label} label={label} count={counts[i]} max={max} color={colors[i]} visible={visible}/>)}</div>
  </section>;
}
function SeverityRow({ label, count, max, color, visible }) {
  const countValue = useCount(count, visible);
  return <div className={`severity-row ${color}`}><span className="severity-label">{label}</span><span className="mono severity-count">{count == null ? '—' : countValue}</span><div className="severity-track" aria-label={`${label}: ${count ?? 'not scanned'}`}><span style={{ width: visible && count != null ? `${Math.max(count > 0 ? 2 : 0, count / max * 100)}%` : '0%' }}/></div></div>;
}
function SectionHeading({ label, index }) { return <div className="section-heading"><span className="eyebrow">{label}</span><span className="heading-index">{index}</span></div>; }
function Pipeline({ deployment }) {
  const { ref, visible } = useReveal();
  const active = stageFor(deployment);
  const prev = useRef({ stage: active, at: Date.now() });
  const [durations, setDurations] = useState({});
  useEffect(() => {
    if (prev.current.stage !== active) {
      const elapsed = Math.max(0, Date.now() - prev.current.at);
      if (prev.current.stage >= 0) setDurations((current) => ({ ...current, [prev.current.stage]: elapsed }));
      prev.current = { stage: active, at: Date.now() };
    }
  }, [active]);
  const terminal = ['BLOCKED', 'FAILED', 'STOPPED'].includes(deployment.status);
  return <section ref={ref} className={`subsection pipeline reveal ${visible ? 'is-visible' : ''}`}>
    <SectionHeading label="Deployment pipeline" index="02"/>
    <ol className="pipeline-track" aria-label={`Deployment status ${deployment.status}`}>
      {stages.map((step, index) => {
        const done = index < active || (deployment.status === 'RUNNING' && index <= active);
        const current = index === active && !terminal;
        const stopped = deployment.status === 'STOPPED' && index === active;
        const blocked = deployment.status === 'BLOCKED' && index === active;
        const failed = deployment.status === 'FAILED' && index === active;
        const hiddenAfterBlock = deployment.status === 'BLOCKED' && index > active;
        const hiddenAfterFail = deployment.status === 'FAILED' && index > active;
        return <li key={step} className={`pipeline-step ${done ? 'done' : ''} ${current ? 'current' : ''} ${stopped ? 'stopped' : ''} ${blocked ? 'blocked' : ''} ${failed ? 'failed' : ''} ${hiddenAfterBlock || hiddenAfterFail ? 'not-reached' : ''}`} aria-current={current ? 'step' : undefined}>
          <span className="step-node">{done ? <Icon name="check" size={13}/> : stopped ? <Icon name="stop" size={12}/> : blocked || failed ? <span>!</span> : <span>{String(index + 1).padStart(2, '0')}</span>}</span><span className="step-text">{step}{current && <span className="step-state">{deployment.status.toLowerCase()}</span>}{stopped && <span className="step-state">stopped</span>}{blocked && <span className="step-state">blocked</span>}{failed && <span className="step-state">failed</span>}</span>
          <span className="step-time mono">{durations[index] != null ? duration(durations[index]) : current ? 'active' : ''}</span>
          <span className="step-progress" aria-hidden="true"><span/></span>
        </li>;
      })}
    </ol>
    {deployment.status === 'BLOCKED' && <p className="pipeline-note danger-text">Blocked at scan. No container was started.</p>}
    {deployment.status === 'FAILED' && <p className="pipeline-note danger-text">Stopped at {deployment.reason === 'IMAGE_NOT_FOUND' ? 'start' : ['CLONE_FAILED', 'NO_DOCKERFILE', 'BUILD_FAILED'].includes(deployment.reason) ? 'build' : 'scan'}. {deployment.reason || 'Deployment failed'}.</p>}
    {deployment.status === 'STOPPED' && <p className="pipeline-note">Deployment stopped by request.</p>}
  </section>;
}
function Facts({ deployment }) {
  const { ref, visible } = useReveal();
  const facts = [
    ['Image', deployment.image || '—', true], ['Port', deployment.port == null ? '—' : String(deployment.port), true], ['Restarts', deployment.restartCount ?? '—', true],
    ['Created', relativeTime(deployment.createdAt), false, deployment.createdAt], ['Updated', relativeTime(deployment.updatedAt), false, deployment.updatedAt],
    ...(deployment.reason ? [['Reason', deployment.reason, true]] : []),
  ];
  return <section className={`subsection reveal ${visible ? 'is-visible' : ''}`} ref={ref}><SectionHeading label="Deployment facts" index="04"/><dl className="facts-grid">{facts.map(([label, value, mono, time]) => <div className="fact" key={label}><dt>{label}</dt><dd className={mono ? 'mono' : ''} title={time ? exactTime(time) : String(value)}>{value}</dd></div>)}</dl></section>;
}
function LogViewer({ id, status }) {
  const [lines, setLines] = useState(null);
  const [error, setError] = useState('');
  const [wrap, setWrap] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const pane = useRef(null);
  const requestController = useRef(null);
  const { ref, visible } = useReveal();
  const refresh = useCallback(async (signal) => {
    const controller = signal ? null : new AbortController();
    if (controller) { requestController.current?.abort(); requestController.current = controller; }
    const requestSignal = signal || controller.signal;
    setRefreshing(true);
    try { const result = await (import.meta.env.VITE_USE_MOCK === 'true' ? mockApi.getLogs(id) : coreClient.getLogs(id, requestSignal)); setLines(result); setError(''); }
    catch (e) { if (e.name !== 'AbortError') { setError(e.message); setLines([]); } }
    finally { setRefreshing(false); }
  }, [id]);
  useEffect(() => { const controller = new AbortController(); requestController.current = controller; refresh(controller.signal); return () => { controller.abort(); requestController.current?.abort(); }; }, [refresh]);
  useEffect(() => { if (!['RUNNING', 'STARTING'].includes(status)) return undefined; const timer = setInterval(() => { if (document.visibilityState !== 'hidden') refresh(); }, 5000); return () => clearInterval(timer); }, [status, refresh]);
  useEffect(() => { if (autoScroll && pane.current) pane.current.scrollTop = pane.current.scrollHeight; }, [lines, autoScroll]);
  return <section className={`subsection log-section reveal ${visible ? 'is-visible' : ''}`} ref={ref}>
    <div className="section-heading log-heading"><span className="eyebrow">Runtime logs</span><div className="log-controls"><button type="button" className="icon-button" aria-label="Refresh logs" onClick={() => refresh()} disabled={refreshing}><Icon name="refresh" size={15}/></button><label className="check-toggle"><input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)}/> Wrap</label><label className="check-toggle"><input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)}/> Auto-scroll</label></div></div>
    <div className={`log-pane ${wrap ? 'wrap' : ''}`} ref={pane} role="log" aria-live="polite" aria-label="Deployment logs">
      {error ? <div className="log-message error-text">{error}</div> : lines === null ? <div className="log-message">Loading logs…</div> : lines.length ? lines.map((line, index) => <div className="log-line" key={`${index}-${line}`}><span className="line-number">{String(index + 1).padStart(2, '0')}</span><span>{line}</span></div>) : <div className="log-message">No log lines are available yet.</div>}
    </div><p className="log-footnote">Secrets are never shown here.</p>
  </section>;
}
export default function LiveDeployment({ deployment, loading, error, onStop, onRedeploy, stopLoading }) {
  const [confirmStop, setConfirmStop] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cursor, setCursor] = useState({ x: 50, y: 10 });
  const panel = useRef(null);
  useEffect(() => { setConfirmStop(false); setCopied(false); }, [deployment?.id]);
  const copyId = async () => { try { await navigator.clipboard.writeText(deployment.id); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); } };
  const onPointerMove = (event) => { if (event.pointerType === 'touch' || !panel.current) return; const rect = panel.current.getBoundingClientRect(); setCursor({ x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 }); };
  if (loading) return <section className="panel live-panel state-panel"><div className="eyebrow">LIVE DEPLOYMENT <span className="heading-index">02</span></div><p className="quiet-copy">Loading deployment details…</p></section>;
  if (error) return <section className="panel live-panel state-panel"><div className="eyebrow">LIVE DEPLOYMENT <span className="heading-index">02</span></div><div className="empty-state error-state"><span className="state-mark">!</span><h2>Deployment details unavailable</h2><p>{error}</p></div></section>;
  if (!deployment) return <section className="panel live-panel state-panel"><div className="eyebrow">LIVE DEPLOYMENT <span className="heading-index">02</span></div><div className="empty-state"><span className="state-mark"><Icon name="shield" size={21}/></span><h2>No deployment selected</h2><p>Submit a repository to follow its build and security scan here. Existing deployments will appear in history.</p></div></section>;
  const running = deployment.status === 'RUNNING';
  const stopped = deployment.status === 'STOPPED';
  const repoTitle = `${deployment.repoUrl || ''} · ${deployment.branch || ''}`;
  const proxy = (import.meta.env.VITE_PROXY_URL || 'http://localhost:3000').replace(/\/$/, '');
  const statusLower = deployment.status.toLowerCase();
  return <section className={`panel live-panel status-${statusLower}`} ref={panel} onPointerMove={onPointerMove} style={{ '--cursor-x': `${cursor.x}%`, '--cursor-y': `${cursor.y}%` }}>
    <header className="deployment-header"><div className="deploy-title-row"><div className="deployment-identity"><div className="eyebrow">LIVE DEPLOYMENT <span className="heading-index">02</span></div><div className="deployment-title"><span className="mono deployment-id">{deployment.id}</span><button className="icon-button copy-button" onClick={copyId} aria-label="Copy deployment ID" title="Copy deployment ID"><Icon name={copied ? 'check' : 'copy'} size={15}/>{copied && <span className="copy-feedback">Copied</span>}</button><span className="app-name">{deployment.appName || 'Unnamed app'}</span><span className="environment-tag">{deployment.environment || 'development'}</span></div></div><span className={`status-label status-${statusLower}`}><i className="status-dot"/>{deployment.status}</span></div>
      <div className="deployment-meta"><span title={repoTitle} className="repo-value mono">{compact(deployment.repoUrl, 48)} <span className="meta-separator">/</span> {deployment.branch || 'main'}</span><span className="commit-value mono" title={deployment.commitSha || 'Commit unavailable'}>commit {shortSha(deployment.commitSha)}</span></div>
    </header>
    <Pipeline key={deployment.id} deployment={deployment}/>
    <ScanReport deployment={deployment}/>
    <Facts deployment={deployment}/>
    <div className="action-row"><div className="action-buttons">{running && <a className="button open-button" href={proxy} target="_blank" rel="noreferrer"><Icon name="external" size={15}/> Open app</a>}{running && (confirmStop ? <><button className="button danger-button" onClick={() => onStop(deployment.id)} disabled={stopLoading}>{stopLoading ? 'Stopping…' : 'Confirm stop'}</button><button className="button secondary" onClick={() => setConfirmStop(false)}>Cancel</button></> : <button className="button secondary" onClick={() => setConfirmStop(true)}><Icon name="stop" size={14}/> Stop</button>)}{!running && !stopped && <button className="button secondary" onClick={() => onRedeploy(deployment)}><Icon name="refresh" size={14}/> Redeploy</button>}{stopped && <button className="button secondary" onClick={() => onRedeploy(deployment)}><Icon name="refresh" size={14}/> Redeploy</button>}</div><span className="action-status">{running ? 'Serving latest running deployment' : stopped ? 'Stopped' : 'Scan gate enforced'}</span></div>
    <LogViewer key={`logs-${deployment.id}`} id={deployment.id} status={deployment.status}/>
  </section>;
}
