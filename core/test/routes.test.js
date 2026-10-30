const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createRoutes } = require('../src/api/routes');

// Start an Express app on a temporary loopback port for HTTP route tests.
async function startTestServer(router) {
  const app = express();
  app.use('/', router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

// Close a test HTTP server after a route assertion completes.
async function closeTestServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

// Create the minimal dependencies required by the Core route layer.
function routeDependencies(overrides = {}) {
  const rows = new Map();
  const store = {
    createDeployment(row) {
      rows.set(row.id, {
        status: 'PENDING',
        restartCount: 0,
        port: null,
        reason: null,
        criticalCount: null,
        highCount: null,
        mediumCount: null,
        lowCount: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...row
      });
      return rows.get(row.id);
    },
    getDeployment(id) { return rows.get(id) || null; },
    listDeployments(limit = 20) {
      return [...rows.values()].reverse().slice(0, Math.min(limit, 100));
    }
  };
  const config = {
    coreApiKey: 'test-api-key',
    allowedApps: null,
    frontendOrigin: 'http://localhost:5173',
    ...(overrides.config || {})
  };
  const orchestrator = {
    async runPipeline() {},
    async stop(id) {
      const row = rows.get(id);
      row.status = 'STOPPED';
      return row;
    },
    async getLogs() { return []; },
    ...overrides.orchestrator
  };
  orchestrator.createDeployment = (deploymentRequest) => {
    if (config.allowedApps && !config.allowedApps.includes(deploymentRequest.appName)) {
      return { allowed: false };
    }
    const id = 'dep_abcdef';
    store.createDeployment({ id, ...deploymentRequest });
    void orchestrator.runPipeline(id, deploymentRequest).catch(() => {});
    return { allowed: true, id };
  };
  const atlasClient = {
    async checkStatus() { return true; },
    async putSecrets(appName, secrets) {
      return { ok: true, secretCount: Object.keys(secrets).length };
    }
  };
  return {
    ...overrides,
    store,
    orchestrator,
    atlasClient,
    config
  };
}

// Verify missing and incorrect API keys are rejected while public health stays available.
test('malformed JSON is a 400 only after API-key authentication', async () => {
  const server = await startTestServer(createRoutes(routeDependencies()));
  try {
    const unauthorized = await fetch(`${server.baseUrl}/deployments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{'
    });
    assert.equal(unauthorized.status, 401);

    const invalid = await fetch(`${server.baseUrl}/deployments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-api-key' },
      body: '{'
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: 'INVALID_REQUEST' });
  } finally {
    await closeTestServer(server.server);
  }
});

// Verify application-not-found errors from Atlas map to the documented Core HTTP status.
test('application secret errors preserve Atlas error codes and HTTP mappings', async () => {
  const dependencies = routeDependencies();
  dependencies.atlasClient.putSecrets = async () => ({
    ok: false,
    code: 'APPLICATION_NOT_FOUND',
    message: 'Application not found'
  });
  const server = await startTestServer(createRoutes(dependencies));
  try {
    const response = await fetch(`${server.baseUrl}/applications/missing-app/secrets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-api-key' },
      body: JSON.stringify({ secrets: { PASSWORD: 'local-demo-value' } })
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: 'APPLICATION_NOT_FOUND',
      message: 'Application not found'
    });
  } finally {
    await closeTestServer(server.server);
  }
});

// Verify missing and incorrect API keys are rejected while public health stays available.
test('routes require X-API-Key except GET /health', async (t) => {
  const dependencies = routeDependencies();
  const server = await startTestServer(createRoutes(dependencies));
  try {
    await t.test('missing key', async () => {
      const response = await fetch(`${server.baseUrl}/deployments/dep_missing`);
      assert.equal(response.status, 401);
    });
    await t.test('wrong key', async () => {
      const response = await fetch(`${server.baseUrl}/deployments/dep_missing`, {
        headers: { 'X-API-Key': 'wrong-key' }
      });
      assert.equal(response.status, 401);
    });
    await t.test('public health', async () => {
      const response = await fetch(`${server.baseUrl}/health`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, atlas: 'up' });
    });
  } finally {
    await closeTestServer(server.server);
  }
});

// Verify ALLOWED_APPS rejects a deploy without creating a database row.
test('ALLOWED_APPS blocks unknown applications', async () => {
  let createCalls = 0;
  const dependencies = routeDependencies({
    config: { coreApiKey: 'test-api-key', allowedApps: ['allowed-app'] }
  });
  const originalCreate = dependencies.store.createDeployment;
  dependencies.store.createDeployment = (...args) => {
    createCalls += 1;
    return originalCreate(...args);
  };
  const server = await startTestServer(createRoutes(dependencies));
  try {
    const response = await fetch(`${server.baseUrl}/deployments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-api-key' },
      body: JSON.stringify({
        appName: 'unknown-app',
        environment: 'test',
        commitSha: 'a1b2c3d'
      })
    });
    assert.equal(response.status, 403);
    assert.equal(createCalls, 0);
  } finally {
    await closeTestServer(server.server);
  }
});

// Verify deploy validation requires a SHA and defaults requestedBy and useSecrets.
test('deploy validates commitSha and starts the pipeline without awaiting it', async () => {
  let pipelineArgs;
  const dependencies = routeDependencies({
    orchestrator: {
      runPipeline(id, options) {
        pipelineArgs = { id, options };
        return new Promise(() => {});
      },
      async stop() {},
      async getLogs() { return []; }
    }
  });
  const server = await startTestServer(createRoutes(dependencies));
  try {
    const invalid = await fetch(`${server.baseUrl}/deployments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-api-key' },
      body: JSON.stringify({ appName: 'sample-app', environment: 'test' })
    });
    assert.equal(invalid.status, 400);

    const response = await fetch(`${server.baseUrl}/deployments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-api-key' },
      body: JSON.stringify({
        appName: 'sample-app',
        environment: 'test',
        commitSha: 'a1b2c3d'
      })
    });
    assert.equal(response.status, 202);
    const result = await response.json();
    assert.match(result.id, /^dep_[a-f0-9]{6}$/);
    assert.equal(pipelineArgs.id, result.id);
    assert.equal(pipelineArgs.options.useSecrets, false);
  } finally {
    await closeTestServer(server.server);
  }
});

// Verify the Core secrets route never echoes submitted values.
test('PUT application secrets returns only the app name and secret count', async () => {
  const dependencies = routeDependencies();
  const server = await startTestServer(createRoutes(dependencies));
  try {
    const response = await fetch(`${server.baseUrl}/applications/sample-app/secrets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-api-key' },
      body: JSON.stringify({ secrets: { PASSWORD: 'local-demo-value' } })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { appName: 'sample-app', secretCount: 1 });
  } finally {
    await closeTestServer(server.server);
  }
});

// Verify a deployment can be created from a GitHub URL alone, with branch defaulted to main.
test('deploy accepts a repoUrl instead of commitSha and contextDir', async () => {
  let pipelineArgs;
  const dependencies = routeDependencies({
    orchestrator: {
      runPipeline(id, options) {
        pipelineArgs = { id, options };
        return new Promise(() => {});
      },
      async stop() {},
      async getLogs() { return []; }
    }
  });
  const server = await startTestServer(createRoutes(dependencies));
  try {
    const response = await fetch(`${server.baseUrl}/deployments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-api-key' },
      body: JSON.stringify({
        appName: 'sample-app',
        environment: 'test',
        repoUrl: 'https://github.com/example/app.git'
      })
    });
    assert.equal(response.status, 202);
    const result = await response.json();
    assert.equal(pipelineArgs.id, result.id);
    assert.equal(pipelineArgs.options.repoUrl, 'https://github.com/example/app.git');
    assert.equal(pipelineArgs.options.branch, 'main');

    const row = dependencies.store.getDeployment(result.id);
    assert.equal(row.repoUrl, 'https://github.com/example/app.git');
    assert.equal(row.branch, 'main');
  } finally {
    await closeTestServer(server.server);
  }
});

// Verify repoUrl and contextDir are mutually exclusive and neither leaks into other routes.
test('deploy rejects repoUrl combined with contextDir', async () => {
  const dependencies = routeDependencies();
  const server = await startTestServer(createRoutes(dependencies));
  try {
    const response = await fetch(`${server.baseUrl}/deployments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-api-key' },
      body: JSON.stringify({
        appName: 'sample-app',
        environment: 'test',
        repoUrl: 'https://github.com/example/app.git',
        contextDir: 'samples/hello-app'
      })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'INVALID_REQUEST');
  } finally {
    await closeTestServer(server.server);
  }
});

// Verify a contextDir outside core/samples is rejected instead of being built.
test('deploy rejects a contextDir outside core/samples', async () => {
  const dependencies = routeDependencies();
  const server = await startTestServer(createRoutes(dependencies));
  try {
    for (const contextDir of ['../', '../../etc', '/etc', 'samples/../..']) {
      const response = await fetch(`${server.baseUrl}/deployments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-api-key' },
        body: JSON.stringify({
          appName: 'sample-app',
          environment: 'test',
          commitSha: 'a1b2c3d',
          contextDir
        })
      });
      assert.equal(response.status, 400, `contextDir ${contextDir} must be rejected`);
    }
  } finally {
    await closeTestServer(server.server);
  }
});

// Verify the browser preflight succeeds before the API-key check.
test('CORS preflight succeeds without an API key', async () => {
  const server = await startTestServer(createRoutes(routeDependencies()));
  try {
    const response = await fetch(`${server.baseUrl}/deployments`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-api-key'
      }
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    const allowedHeaders = response.headers.get('access-control-allow-headers').toLowerCase();
    assert.equal(allowedHeaders.includes('x-api-key'), true);
    assert.equal(allowedHeaders.includes('content-type'), true);
    assert.match(response.headers.get('access-control-allow-methods'), /POST/);
  } finally {
    await closeTestServer(server.server);
  }
});

// Verify the deployment list needs the API key and never returns environment values.
test('GET /deployments lists newest deployments and requires X-API-Key', async () => {
  const dependencies = routeDependencies();
  dependencies.store.createDeployment({
    id: 'dep_first',
    appName: 'sample-app',
    environment: 'test',
    commitSha: 'a1b2c3d',
    repoUrl: null,
    branch: null,
    requestedBy: 'test-suite',
    envVars: { PRIVATE_SETTING: 'list-only-secret-value' }
  });
  dependencies.store.createDeployment({
    id: 'dep_second',
    appName: 'sample-app',
    environment: 'test',
    commitSha: 'd4e5f6a',
    repoUrl: 'https://github.com/example/app.git',
    branch: 'main',
    requestedBy: 'test-suite'
  });
  const server = await startTestServer(createRoutes(dependencies));
  try {
    const unauthorized = await fetch(`${server.baseUrl}/deployments`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${server.baseUrl}/deployments?limit=10`, {
      headers: { 'X-API-Key': 'test-api-key' }
    });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.equal(body.includes('list-only-secret-value'), false);

    const deployments = JSON.parse(body);
    assert.equal(Array.isArray(deployments), true);
    assert.equal(deployments.length, 2);
    assert.equal(deployments[0].id, 'dep_second');
    assert.equal(deployments[0].repoUrl, 'https://github.com/example/app.git');
    assert.equal(deployments[0].branch, 'main');
    assert.deepEqual(Object.keys(deployments[0]).sort(), [
      'appName', 'branch', 'commitSha', 'createdAt', 'criticalCount', 'environment',
      'highCount', 'id', 'lowCount', 'mediumCount', 'port', 'reason', 'repoUrl',
      'restartCount', 'status', 'updatedAt'
    ]);
  } finally {
    await closeTestServer(server.server);
  }
});
