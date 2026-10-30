const crypto = require('node:crypto');
const express = require('express');
const {
  deployRequestSchema,
  secretsRequestSchema,
  appNameSchema,
  toDeploymentResponse
} = require('./schemas');
const { redact } = require('../utils/redact');

// Compare API keys in constant time using fixed-length SHA-256 digests.
function matchesApiKey(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || expected.length === 0) return false;
  const providedDigest = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest) && provided.length > 0;
}

// Map Atlas contract error codes to the matching Core HTTP response status.
function atlasErrorHttpStatus(code) {
  const statuses = {
    INVALID_REQUEST: 400,
    UNAUTHORIZED: 401,
    IMAGE_NOT_FOUND: 404,
    APPLICATION_NOT_FOUND: 404,
    SCAN_TIMEOUT: 504,
    INTERNAL_ERROR: 500
  };
  return statuses[code] || 502;
}

// Turn an async Express handler into one that forwards errors to middleware.
function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

// Create all Core routes, with API-key authorization on every route except health.
function createRoutes({ store, orchestrator, atlasClient, config }) {
  const router = express.Router();

  router.get('/health', asyncRoute(async (request, response) => {
    const atlas = await atlasClient.checkStatus().catch(() => false);
    response.json({ ok: true, atlas: atlas ? 'up' : 'down' });
  }));

  router.use((request, response, next) => {
    if (!matchesApiKey(request.get('X-API-Key'), config.coreApiKey)) {
      response.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    next();
  });
  router.use(express.json({ limit: '1mb' }));

  router.post('/deployments', asyncRoute(async (request, response) => {
    const parsed = deployRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: 'INVALID_REQUEST',
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      });
      return;
    }

    const created = orchestrator.createDeployment(parsed.data);
    if (!created.allowed) {
      response.status(403).json({ error: 'APP_NOT_ALLOWED' });
      return;
    }
    response.status(202).json({ id: created.id });
  }));

  router.get('/deployments/:id', (request, response) => {
    const deployment = store.getDeployment(request.params.id);
    if (!deployment) {
      response.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    response.json(toDeploymentResponse(deployment));
  });

  router.post('/deployments/:id/stop', asyncRoute(async (request, response) => {
    const deployment = store.getDeployment(request.params.id);
    if (!deployment) {
      response.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const stopped = await orchestrator.stop(request.params.id);
    response.json({ id: stopped.id, status: stopped.status });
  }));

  router.get('/deployments/:id/logs', asyncRoute(async (request, response) => {
    const deployment = store.getDeployment(request.params.id);
    if (!deployment) {
      response.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const logs = await orchestrator.getLogs(request.params.id);
    response.json({ id: request.params.id, logs: logs || [] });
  }));

  router.put('/applications/:appName/secrets', asyncRoute(async (request, response) => {
    const name = appNameSchema.safeParse(request.params.appName);
    if (!name.success) {
      response.status(400).json({ error: 'INVALID_REQUEST' });
      return;
    }
    const parsed = secretsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'INVALID_REQUEST' });
      return;
    }

    const result = await atlasClient.putSecrets(name.data, parsed.data.secrets);
    if (!result.ok) {
      const secretValues = Object.values(parsed.data.secrets);
      response.status(atlasErrorHttpStatus(result.code)).json({
        error: redact(result.code, secretValues),
        message: redact(result.message, secretValues)
      });
      return;
    }
    response.json({ appName: name.data, secretCount: result.secretCount });
  }));

  router.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = error && error.status === 400 ? 400 : 500;
    response.status(status).json({ error: status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR' });
  });

  return router;
}

module.exports = { createRoutes, matchesApiKey };
