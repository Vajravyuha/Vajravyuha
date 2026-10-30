import React, { useCallback, useEffect, useRef, useState } from 'react';
import { coreClient } from './api/coreClient';
import { mockApi } from './api/mock';
import DeployForm from './components/DeployForm';
import HealthChip from './components/HealthChip';
import History from './components/History';
import LiveDeployment from './components/LiveDeployment';
import { Icon } from './components/Icons';
import { useHealth } from './hooks/useHealth';
import { usePolling } from './hooks/usePolling';

const mocked = import.meta.env.VITE_USE_MOCK === 'true';
const api = mocked ? mockApi : coreClient;
const terminal = new Set(['BLOCKED', 'FAILED', 'STOPPED']);
const ongoing = new Set(['PENDING', 'BUILDING', 'SCANNING', 'STARTING']);
function readSelection() { try { return localStorage.getItem('nexus.selectedDeployment') || ''; } catch { return ''; } }
function saveSelection(id) { try { if (id) localStorage.setItem('nexus.selectedDeployment', id); else localStorage.removeItem('nexus.selectedDeployment'); } catch { /* Storage can be disabled. */ } }

export default function App() {
  const health = useHealth();
  const [deployments, setDeployments] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [selectedId, setSelectedId] = useState(readSelection);
  const [deployment, setDeployment] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [deployLoading, setDeployLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [stopLoading, setStopLoading] = useState(false);
  const [initialValues, setInitialValues] = useState(null);
  const previousStatus = useRef('');
  const historyController = useRef(null);

  const refreshHistory = useCallback(async (signal) => {
    setHistoryLoading(true);
    try {
      const result = await api.listDeployments(signal);
      const list = Array.isArray(result) ? result : [];
      setDeployments(list); setHistoryError('');
      if (list.length && (!selectedId || !list.some((item) => item.id === selectedId))) { setSelectedId(list[0].id); saveSelection(list[0].id); }
      if (!list.length && selectedId) { setSelectedId(''); saveSelection(''); }
    } catch (error) {
      if (error.name !== 'AbortError') setHistoryError(error.message);
    } finally { setHistoryLoading(false); }
  }, [selectedId]);
  useEffect(() => { const controller = new AbortController(); refreshHistory(controller.signal); return () => { controller.abort(); historyController.current?.abort(); }; }, [refreshHistory]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      controller.abort();
      const next = new AbortController(); historyController.current = next;
      refreshHistory(next.signal);
    }, 15000);
    historyController.current = controller;
    return () => { window.clearInterval(timer); controller.abort(); historyController.current?.abort(); };
  }, [refreshHistory]);

  useEffect(() => {
    saveSelection(selectedId);
    if (!selectedId) { setDeployment(null); setDetailError(''); setDetailLoading(false); previousStatus.current = ''; return undefined; }
    setDeployment(null); setDetailLoading(true); setDetailError(''); previousStatus.current = '';
    const controller = new AbortController();
    api.getDeployment(selectedId, controller.signal).then((next) => { setDeployment(next); setDetailError(''); previousStatus.current = next.status; }).catch((error) => { if (error.name !== 'AbortError') setDetailError(error.message); }).finally(() => setDetailLoading(false));
    return () => controller.abort();
  }, [selectedId]);

  const pollingInterval = deployment && ongoing.has(deployment.status) ? 2000 : deployment?.status === 'RUNNING' ? 5000 : 0;
  const pollDetail = useCallback(async (signal) => {
    if (!selectedId) return;
    try {
      const next = await api.getDeployment(selectedId, signal);
      setDeployment(next);
      setDetailError('');
      if (terminal.has(next.status) && previousStatus.current !== next.status) refreshHistory();
      previousStatus.current = next.status;
    } catch (error) { if (error.name !== 'AbortError') setDetailError(error.message); }
  }, [selectedId, refreshHistory]);
  usePolling(pollDetail, pollingInterval, Boolean(selectedId), [selectedId, pollingInterval, pollDetail]);

  const deploy = async (payload) => {
    setDeployLoading(true); setFormError('');
    try {
      const result = await api.createDeployment(payload);
      if (!result?.id) throw new Error('Core accepted the request but did not return a deployment ID.');
      setSelectedId(result.id); saveSelection(result.id); setInitialValues(null); refreshHistory();
    } catch (error) { setFormError(error.message); }
    finally { setDeployLoading(false); }
  };
  const stop = async (id) => {
    setStopLoading(true);
    try { await api.stopDeployment(id); await pollDetail(new AbortController().signal); await refreshHistory(); }
    catch (error) { setDetailError(error.message); }
    finally { setStopLoading(false); }
  };
  const redeploy = (item) => {
    setInitialValues({ repoUrl: item.repoUrl || '', branch: item.branch || 'main', appName: item.appName || '', environment: item.environment || 'development' });
    setFormError('');
    document.getElementById('deploy-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const select = (id) => { if (id !== selectedId) { setSelectedId(id); setDetailLoading(true); } };
  const statusText = deployment ? `${deployment.appName || deployment.id} · ${deployment.status}` : 'No deployment selected';
  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#top" aria-label="Nexus home"><span className="brand-shield"><Icon name="shield" size={17}/></span><span>NEXUS</span></a><div className="topbar-context"><span className="topbar-environment"><span className="context-dot"/>Self-hosted</span>{mocked && <span className="mock-badge" title="Deployment responses are simulated">MOCK</span>}</div><div className="health-group"><HealthChip name="CORE" state={health.core} checkedAt={health.checkedAt} error={health.error}/><HealthChip name="ATLAS" state={health.atlas} checkedAt={health.checkedAt}/></div></header>
    <main id="top" className="main-content">
      <div className="page-kicker"><span>DEPLOYMENT CONTROL PLANE</span><span className="kicker-rule"/><span>LOCAL CONSOLE</span></div>
      <div className="work-grid"><DeployForm onDeploy={deploy} loading={deployLoading} error={formError} onClearError={() => setFormError('')} initialValues={initialValues}/><LiveDeployment key={selectedId || 'empty'} deployment={deployment} loading={detailLoading} error={detailError} onStop={stop} onRedeploy={redeploy} stopLoading={stopLoading}/></div>
      <History deployments={deployments} selectedId={selectedId} loading={historyLoading} error={historyError} onSelect={select} onRetry={() => refreshHistory()}/>
    </main>
    <footer className="footer"><span><Icon name="shield" size={13}/> Nexus <span className="footer-separator">/</span> deploys pass through Atlas</span><span className="footer-live" aria-live="polite"><i className={`status-dot ${deployment?.status === 'RUNNING' ? 'dot-good' : ''}`}/>{statusText}</span></footer>
  </div>;
}
