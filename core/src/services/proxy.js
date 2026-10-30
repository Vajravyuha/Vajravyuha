const http = require('node:http');
const httpProxy = require('http-proxy');

// Create the HTTP proxy that forwards traffic to the latest RUNNING deployment.
function createProxyService({ store, port = 3000, queueTimeoutMs = 30000, retryIntervalMs = 200 }) {
  const proxy = httpProxy.createProxyServer({});
  const healthByDeployment = new Map();
  const state = { healthy: false, target: null, deploymentId: null };

  // Select the latest running deployment and restore its last known health state.
  function refreshTarget() {
    const latest = store.getLatestRunningDeployment();
    if (!latest || !latest.port) {
      state.healthy = false;
      state.target = null;
      state.deploymentId = null;
      return;
    }
    state.deploymentId = latest.id;
    state.target = `http://127.0.0.1:${latest.port}`;
    state.healthy = healthByDeployment.get(latest.id) === true;
  }

  // Mark one deployment healthy or unhealthy and update the active proxy target.
  function markHealthy(deploymentId, healthy) {
    healthByDeployment.set(deploymentId, Boolean(healthy));
    refreshTarget();
  }

  // Forget a stopped or failed deployment and choose the next latest RUNNING one.
  function forget(deploymentId) {
    healthByDeployment.delete(deploymentId);
    refreshTarget();
  }

  // Keep an incoming request queued until the latest application is healthy or times out.
  function forwardWhenHealthy(request, response, started = Date.now()) {
    if (response.destroyed) return;
    refreshTarget();
    if (state.healthy && state.target) {
      proxy.web(request, response, { target: state.target });
      return;
    }
    if (Date.now() - started > queueTimeoutMs) {
      response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('App unavailable');
      return;
    }
    setTimeout(() => forwardWhenHealthy(request, response, started), retryIntervalMs);
  }

  proxy.on('error', (error, request, response) => {
    if (!response || response.destroyed) return;
    if (response.headersSent) {
      response.end();
      return;
    }
    response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Bad gateway');
  });

  const server = http.createServer((request, response) => {
    forwardWhenHealthy(request, response);
  });

  // Close the proxy HTTP server when Core shuts down.
  function close() {
    return new Promise((resolve) => server.close(() => resolve()));
  }

  return { server, state, refreshTarget, markHealthy, forget, forwardWhenHealthy, close, port };
}

module.exports = { createProxyService };
