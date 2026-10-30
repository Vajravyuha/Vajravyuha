import React, { useEffect, useState } from 'react';
import { appError, repoError, repoName } from '../lib/validate';
import { Icon } from './Icons';
import { useReveal } from '../hooks/useReveal';

const emptyEnv = () => [{ key: '', value: '' }];
export default function DeployForm({ onDeploy, loading, error, onClearError, initialValues }) {
  const [repoUrl, setRepoUrl] = useState(initialValues?.repoUrl || '');
  const [branch, setBranch] = useState(initialValues?.branch || 'main');
  const [appName, setAppName] = useState(initialValues?.appName || '');
  const [nameEdited, setNameEdited] = useState(Boolean(initialValues?.appName));
  const [environment, setEnvironment] = useState(initialValues?.environment || 'development');
  const [requestedBy, setRequestedBy] = useState('console');
  const [envVars, setEnvVars] = useState(emptyEnv);
  const [useSecrets, setUseSecrets] = useState(false);
  const [touched, setTouched] = useState(false);
  const { ref: revealRef, visible } = useReveal();
  useEffect(() => {
    if (!initialValues) return;
    setRepoUrl(initialValues.repoUrl || ''); setBranch(initialValues.branch || 'main'); setAppName(initialValues.appName || '');
    setNameEdited(Boolean(initialValues.appName)); setEnvironment(initialValues.environment || 'development'); setTouched(false);
  }, [initialValues]);
  const repoValidation = repoError(repoUrl);
  const nameValidation = appError(appName);
  const repoMessage = (touched || repoUrl) ? repoValidation : '';
  const nameMessage = (touched || appName) ? nameValidation : '';
  const canSubmit = !loading && !repoValidation && !nameValidation;
  const changeRepo = (value) => { setRepoUrl(value); if (!nameEdited) setAppName(repoName(value)); onClearError(); };
  const setEnv = (index, key, value) => setEnvVars((rows) => rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
  const submit = (event) => {
    event.preventDefault(); setTouched(true);
    if (!canSubmit) return;
    const filtered = Object.fromEntries(envVars.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value]));
    onDeploy({ repoUrl: repoUrl.trim(), branch: branch.trim() || 'main', appName, environment, requestedBy: requestedBy.trim() || 'console', envVars: filtered, useSecrets });
  };
  return <section ref={revealRef} className={`panel deploy-panel reveal ${visible ? 'is-visible' : ''}`} aria-labelledby="deploy-title">
    <div className="panel-heading"><div><div className="eyebrow">NEW DEPLOYMENT <span className="heading-index">01</span></div><h1 id="deploy-title">Deploy from repository</h1></div><span className="panel-mark"><Icon name="shield" size={18}/></span></div>
    <p className="panel-intro">Submit a source repository. Nexus builds and security-scans the image before it can run.</p>
    <form onSubmit={submit} noValidate>
      <label className="field-label" htmlFor="repo-url">Repository URL <span className="required-mark">Required</span></label>
      <div className={`input-wrap ${repoMessage ? 'has-error' : ''}`}><input id="repo-url" className="mono-input" value={repoUrl} onChange={(e) => changeRepo(e.target.value)} onBlur={() => setTouched(true)} placeholder="https://github.com/owner/repository" autoComplete="url" aria-invalid={Boolean(repoMessage)} aria-describedby={repoMessage ? 'repo-error' : undefined}/></div>
      {repoMessage && <p className="field-error" id="repo-error">{repoMessage}</p>}
      <div className="form-grid two-up">
        <div><label className="field-label" htmlFor="branch">Branch</label><input id="branch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" /></div>
        <div><label className="field-label" htmlFor="app-name">Application name</label><input id="app-name" value={appName} onChange={(e) => { setAppName(e.target.value); setNameEdited(true); }} onBlur={() => setTouched(true)} placeholder="my-app" aria-invalid={Boolean(nameMessage)}/>{nameMessage && <p className="field-error">{nameMessage}</p>}</div>
      </div>
      <fieldset className="segmented-field"><legend className="field-label">Environment</legend><div className="segmented-control" role="group" aria-label="Deployment environment">{['development', 'staging', 'production'].map((item) => <button type="button" key={item} className={environment === item ? 'selected' : ''} aria-pressed={environment === item} onClick={() => setEnvironment(item)}>{item}</button>)}</div></fieldset>
      <div className="form-grid two-up compact-gap"><div><label className="field-label" htmlFor="requested-by">Requested by</label><input id="requested-by" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} /></div><div className="secret-toggle-row"><div><span className="field-label">Atlas secrets</span><span className="field-hint">Use secrets stored in Atlas</span></div><button type="button" role="switch" aria-checked={useSecrets} className={`switch ${useSecrets ? 'on' : ''}`} onClick={() => setUseSecrets((value) => !value)} aria-label="Use secrets stored in Atlas"><span /></button></div></div>
      <div className="env-heading"><div><span className="field-label">Environment variables</span><span className="field-hint">Not for secrets</span></div><button type="button" className="text-button" onClick={() => setEnvVars((rows) => [...rows, { key: '', value: '' }])}><Icon name="plus" size={14}/> Add row</button></div>
      <div className="env-list">{envVars.map((row, index) => <div className="env-row" key={index}><input aria-label={`Variable ${index + 1} key`} value={row.key} onChange={(e) => setEnv(index, 'key', e.target.value)} placeholder="KEY"/><span className="env-equals">=</span><input aria-label={`Variable ${index + 1} value`} value={row.value} onChange={(e) => setEnv(index, 'value', e.target.value)} placeholder="value"/><button type="button" className="remove-row" aria-label="Remove variable" disabled={envVars.length === 1} onClick={() => setEnvVars((rows) => rows.filter((_, i) => i !== index))}>×</button></div>)}</div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="deploy-submit"><button className="button primary deploy-button" type="submit" disabled={!canSubmit}>{loading ? <>Submitting request</> : <><Icon name="shield" size={16}/> Deploy</>}</button><span className="submit-note">Atlas scan required before start</span></div>
    </form>
  </section>;
}
