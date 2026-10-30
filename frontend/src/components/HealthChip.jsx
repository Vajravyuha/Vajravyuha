import React from 'react';
export default function HealthChip({ name, state, checkedAt, error }) {
  const status = state === true ? 'up' : state === false ? 'down' : 'checking';
  const title = `${name}: ${status}${checkedAt ? ` · checked ${checkedAt.toLocaleTimeString()}` : ''}${error ? ` · ${error}` : ''}`;
  return <span className={`health-chip ${status}`} title={title} aria-label={title}><i className="status-dot" /> <span className="health-name">{name}</span><span className="health-state">{status === 'checking' ? 'checking' : status}</span></span>;
}
