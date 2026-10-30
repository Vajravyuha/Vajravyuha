const http = require('node:http');
const express = require('express');
const { loadConfig } = require('./config');
const { createRoutes } = require('./api/routes');
const { createAtlasClient } = require('./adapters/atlasClient');
const { createDockerRunner } = require('./adapters/dockerRunner');
const { createStore } = require('./store/db');
const { createOrchestrator } = require('./services/orchestrator');
const { createProxyService } = require('./services/proxy');
const { createSupervisor } = require('./services/supervisor');
const { createRedactingLogger, redact } = require('./utils/redact');

// Wait until an HTTP server is listening on all interfaces.
function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

// Create Core services, recover containers, and start the API and proxy listeners.
async function startServer() {
  const config = loadConfig();
  const startupLogger = createRedactingLogger(
    console,
    new Set([config.atlasServiceToken, config.coreApiKey])
  );
  const store = createStore(config.dbPath);
  const atlasClient = createAtlasClient({
    url: config.atlasUrl,
    token: config.atlasServiceToken
  });
  const dockerRunner = createDockerRunner();
  const proxy = createProxyService({ store, port: config.proxyPort });
  const orchestrator = createOrchestrator({
    store,
    dockerRunner,
    atlasClient,
    config,
    proxy
  });
  const supervisor = createSupervisor({
    store,
    dockerRunner,
    atlasClient,
    proxy
  });

  const app = express();
  app.disable('x-powered-by');
  app.use('/', createRoutes({ store, orchestrator, atlasClient, config }));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = error && error.status === 400 ? 400 : 500;
    response.status(status).json({ error: status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR' });
  });
  const apiServer = http.createServer(app);

  await supervisor.recover();
  proxy.refreshTarget();
  supervisor.start();
  await Promise.all([
    listen(apiServer, config.port),
    listen(proxy.server, config.proxyPort)
  ]);
  startupLogger.info(`Vajravyuha Core API listening on ${config.port}`);
  startupLogger.info(`Vajravyuha Core proxy listening on ${config.proxyPort}`);

  // Stop timers and close all resources when the process receives a shutdown signal.
  const shutdown = () => {
    supervisor.stop();
    Promise.all([
      new Promise((resolve) => apiServer.close(() => resolve())),
      proxy.close()
    ]).finally(() => store.close());
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return { app, apiServer, proxy, supervisor, store };
}

if (require.main === module) {
  startServer().catch((error) => {
    const safeMessage = error instanceof Error ? error.message : String(error);
    console.error(redact(`Core startup failed: ${safeMessage}`));
    process.exitCode = 1;
  });
}

module.exports = { startServer, listen };
