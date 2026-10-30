const express = require('express');
const { redact } = require('../src/utils/redact');

const SERVICE_TOKEN = 'local-atlas-token';
const savedSecrets = new Map();

// Create a small in-memory Atlas mock for local development and manual testing.
function createFakeAtlas() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Check the fake service token without printing any request header.
  function hasValidToken(request) {
    return request.get('Authorization') === `Bearer ${SERVICE_TOKEN}`;
  }

  app.get('/atlas/status', (request, response) => {
    response.json({ status: 'UP' });
  });

  app.post('/api/v1/scans', (request, response) => {
    if (!hasValidToken(request)) {
      response.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'A valid service token is required',
        deployId: request.body && request.body.deployId ? request.body.deployId : null
      });
      return;
    }
    const body = request.body || {};
    if (!body.deployId || !body.appName || !body.commitSha || !body.image) {
      response.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'Required scan fields are missing',
        deployId: body.deployId || null
      });
      return;
    }
    if (String(body.image).includes('missing')) {
      response.status(404).json({
        error: 'IMAGE_NOT_FOUND',
        message: 'Could not retrieve the requested container image',
        deployId: body.deployId
      });
      return;
    }
    const blocked = String(body.image).includes('vulnerable');
    response.status(200).json({
      deployId: body.deployId,
      appName: body.appName,
      environment: body.environment,
      status: blocked ? 'BLOCKED' : 'PASSED',
      criticalCount: blocked ? 1 : 0,
      highCount: blocked ? 2 : 0,
      mediumCount: blocked ? 3 : 0,
      lowCount: blocked ? 5 : 0,
      message: blocked
        ? 'Deployment blocked due to critical vulnerabilities'
        : 'No critical vulnerabilities found'
    });
  });

  app.put('/api/v1/applications/:appName/secrets', (request, response) => {
    if (!hasValidToken(request)) {
      response.status(401).json({ error: 'UNAUTHORIZED', message: 'A valid service token is required', deployId: null });
      return;
    }
    const secrets = request.body && request.body.secrets;
    if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets) ||
        !Object.values(secrets).every((value) => typeof value === 'string') ||
        Object.keys(secrets).length > 50) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'A valid secrets map is required', deployId: null });
      return;
    }
    const appName = request.params.appName;
    savedSecrets.set(appName, { ...secrets });
    response.json({
      appName,
      status: 'SUCCESS',
      message: 'Secrets saved',
      secretCount: Object.keys(secrets).length
    });
  });

  app.get('/api/v1/applications/:appName/secrets', (request, response) => {
    if (!hasValidToken(request)) {
      response.status(401).json({ error: 'UNAUTHORIZED', message: 'A valid service token is required', deployId: null });
      return;
    }
    const secrets = savedSecrets.get(request.params.appName);
    if (!secrets) {
      response.status(404).json({
        error: 'APPLICATION_NOT_FOUND',
        message: 'Application not found',
        deployId: null
      });
      return;
    }
    response.json({ ...secrets });
  });

  return app;
}

// Start the fake Atlas service on port 9000 for local integration testing.
function startFakeAtlas() {
  const app = createFakeAtlas();
  return app.listen(9000, '0.0.0.0', () => {
    console.log(redact('Fake Atlas listening on port 9000'));
  });
}

if (require.main === module) startFakeAtlas();

module.exports = { createFakeAtlas, startFakeAtlas, SERVICE_TOKEN };
