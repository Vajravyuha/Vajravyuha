const test = require('node:test');
const assert = require('node:assert/strict');
const { STATUS, IN_PROGRESS } = require('../src/domain/states');
const { createOrchestrator } = require('../src/services/orchestrator');

// Create a small in-memory deployment store for service-level tests.
function makeStore() {
  let row = {
    id: 'dep_abcdef',
    appName: 'sample-app',
    environment: 'test',
    commitSha: 'a1b2c3d',
    requestedBy: 'test-suite',
    status: STATUS.PENDING,
    image: null,
    imageId: null,
    scanImageRef: null,
    port: null,
    containerId: null,
    reason: null,
    criticalCount: null,
    highCount: null,
    mediumCount: null,
    lowCount: null,
    restartCount: 0
  };
  return {
    getDeployment: () => ({ ...row }),
    updateDeployment: (id, changes) => {
      assert.equal(id, row.id);
      row = { ...row, ...changes };
      return { ...row };
    }
  };
}

// Create fake Docker and Atlas adapters with optional test overrides.
function makeDependencies(overrides = {}) {
  const calls = { build: 0, imageId: 0, run: 0, stop: 0, secrets: 0, env: null };
  const store = overrides.store || makeStore();
  const dockerRunner = {
    async buildImage() { calls.build += 1; },
    async getImageId() { calls.imageId += 1; return 'sha256:immutable-image-id'; },
    async pushImage() { return `${'a'.repeat(64)}`; },
    async runContainer(options) {
      calls.run += 1;
      calls.env = options.env;
      if (overrides.runContainer) return overrides.runContainer(options);
      return 'container-123';
    },
    async stop() { calls.stop += 1; },
    async inspect() { return { running: true }; },
    async getEnvironment() { return []; },
    async getLogs() { return []; },
    ...overrides.dockerRunner
  };
  const atlasClient = {
    async scan() { return { verdict: 'PASSED' }; },
    async getSecrets() {
      calls.secrets += 1;
      return { ok: true, secrets: {} };
    },
    ...overrides.atlasClient
  };
  const proxy = { markHealthy() {}, forget() {} };
  const orchestrator = createOrchestrator({
    store,
    dockerRunner,
    atlasClient,
    config: { registryEnabled: false },
    healthCheck: async () => true,
    findPort: async () => 4001,
    healthTimeoutMs: 0,
    healthPollIntervalMs: 1,
    sleep: async () => {},
    proxy,
    ...overrides.orchestratorOptions
  });
  return { store, dockerRunner, atlasClient, orchestrator, calls };
}

// Verify a successful scan builds and starts the immutable image as RUNNING.
test('PASSED scan leads to RUNNING', async () => {
  const { store, orchestrator, calls } = makeDependencies();
  await orchestrator.runPipeline('dep_abcdef', { envVars: { GREETING: 'hello' } });
  const row = store.getDeployment('dep_abcdef');
  assert.equal(row.status, STATUS.RUNNING);
  assert.equal(row.image, 'vajravyuha/sample-app:dep_abcdef');
  assert.equal(row.imageId, 'sha256:immutable-image-id');
  assert.equal(row.port, 4001);
  assert.equal(row.containerId, 'container-123');
  assert.equal(calls.build, 1);
  assert.equal(calls.imageId, 2);
  assert.equal(calls.run, 1);
  assert.equal(calls.env.GREETING, 'hello');
});

// Verify a BLOCKED verdict is stored and never starts a container.
test('BLOCKED scan stops before container start', async () => {
  const { store, orchestrator, calls } = makeDependencies({
    atlasClient: {
      async scan() {
        return {
          verdict: 'BLOCKED',
          counts: { criticalCount: 1, highCount: 2, mediumCount: 3, lowCount: 5 },
          message: 'Policy blocked this deployment'
        };
      }
    }
  });
  await orchestrator.runPipeline('dep_abcdef');
  const row = store.getDeployment('dep_abcdef');
  assert.equal(row.status, STATUS.BLOCKED);
  assert.equal(row.criticalCount, 1);
  assert.equal(row.lowCount, 5);
  assert.equal(calls.run, 0);
});

// Verify an Atlas ERROR stores its code and never starts a container.
test('Atlas ERROR gives FAILED', async () => {
  const { store, orchestrator, calls } = makeDependencies({
    atlasClient: { async scan() { return { verdict: 'ERROR', code: 'IMAGE_UNSCANNABLE' }; } }
  });
  await orchestrator.runPipeline('dep_abcdef');
  assert.equal(store.getDeployment('dep_abcdef').status, STATUS.FAILED);
  assert.equal(store.getDeployment('dep_abcdef').reason, 'IMAGE_UNSCANNABLE');
  assert.equal(calls.run, 0);
});

// Verify a thrown build error becomes a redacted FAILED reason rather than a stuck status.
test('exceptions become FAILED and redact request environment values', async () => {
  const privateValue = 'failure-message-secret-value';
  const { store, orchestrator } = makeDependencies({
    dockerRunner: {
      async buildImage() { throw new Error(`build failed: ${privateValue}`); }
    }
  });
  await orchestrator.runPipeline('dep_abcdef', { envVars: { PRIVATE_SETTING: privateValue } });
  const row = store.getDeployment('dep_abcdef');
  assert.equal(row.status, STATUS.FAILED);
  assert.equal(row.reason.includes(privateValue), false);
  assert.equal(IN_PROGRESS.includes(row.status), false);
});

// Verify a secrets lookup failure blocks container creation with the required reason prefix.
test('useSecrets failure gives FAILED and never starts the container', async () => {
  const { store, orchestrator, calls } = makeDependencies({
    atlasClient: {
      async getSecrets() {
        calls.secrets += 1;
        return { ok: false, code: 'APPLICATION_NOT_FOUND', message: 'Not found' };
      }
    }
  });
  await orchestrator.runPipeline('dep_abcdef', { useSecrets: true });
  assert.equal(store.getDeployment('dep_abcdef').status, STATUS.FAILED);
  assert.equal(store.getDeployment('dep_abcdef').reason, 'SECRETS_APPLICATION_NOT_FOUND');
  assert.equal(calls.run, 0);
});

// Verify the pipeline never calls Atlas secrets when useSecrets is false.
test('useSecrets false never calls getSecrets', async () => {
  const { store, orchestrator, calls } = makeDependencies();
  await orchestrator.runPipeline('dep_abcdef', { useSecrets: false });
  assert.equal(store.getDeployment('dep_abcdef').status, STATUS.RUNNING);
  assert.equal(calls.secrets, 0);
});

// Verify Atlas secrets override same-named envVars and are not persisted in the row or logs.
test('secrets win env clashes and are redacted from reasons and console output', async () => {
  const secretValue = 'private-atlas-secret-value';
  const original = {
    info: console.info,
    warn: console.warn,
    error: console.error,
    log: console.log
  };
  const captured = [];
  console.info = (...args) => captured.push(args.join(' '));
  console.warn = (...args) => captured.push(args.join(' '));
  console.error = (...args) => captured.push(args.join(' '));
  console.log = (...args) => captured.push(args.join(' '));

  try {
    const { store, orchestrator, calls } = makeDependencies({
      atlasClient: {
        async getSecrets() {
          calls.secrets += 1;
          return { ok: true, secrets: { COLLISION: secretValue, DATABASE_PASSWORD: secretValue } };
        }
      },
      dockerRunner: {
        async runContainer(options) {
          calls.run += 1;
          calls.env = options.env;
          throw new Error(`container failure: ${secretValue}`);
        }
      }
    });
    await orchestrator.runPipeline('dep_abcdef', {
      useSecrets: true,
      envVars: { COLLISION: 'non-secret-value', VISIBLE_SETTING: 'hello' }
    });
    assert.equal(calls.env.COLLISION, secretValue);
    assert.equal(calls.env.VISIBLE_SETTING, 'hello');
    assert.equal(store.getDeployment('dep_abcdef').status, STATUS.FAILED);
    assert.equal(JSON.stringify(store.getDeployment('dep_abcdef')).includes(secretValue), false);
    assert.equal(captured.join('\n').includes(secretValue), false);
  } finally {
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
    console.log = original.log;
  }
});

// Verify logs redact Docker environment names and values and return only the last one hundred lines.
test('getLogs redacts container environment values', async () => {
  const secretValue = 'log-only-secret-value';
  const { store, orchestrator, dockerRunner } = makeDependencies();
  store.updateDeployment('dep_abcdef', { containerId: 'container-123' });
  dockerRunner.getEnvironment = async () => [`PASSWORD=${secretValue}`];
  dockerRunner.getLogs = async () => [
    ...Array.from({ length: 104 }, (_, index) => `line-${index}`),
    `PASSWORD=${secretValue}`
  ];
  const lines = await orchestrator.getLogs('dep_abcdef');
  assert.equal(lines.length, 100);
  assert.equal(lines.at(-1), '[REDACTED]=[REDACTED]');
  assert.equal(lines.join('\\n').includes(secretValue), false);
});

// Verify a changed tag after scanning fails before any container is created.
test('mutable tag changes after scan fail closed', async () => {
  let imageIdCall = 0;
  const { store, orchestrator, calls } = makeDependencies({
    dockerRunner: {
      async getImageId() {
        imageIdCall += 1;
        return imageIdCall === 1 ? 'sha256:first' : 'sha256:changed';
      }
    }
  });
  await orchestrator.runPipeline('dep_abcdef');
  assert.equal(store.getDeployment('dep_abcdef').status, STATUS.FAILED);
  assert.equal(store.getDeployment('dep_abcdef').reason, 'IMAGE_CHANGED_AFTER_SCAN');
  assert.equal(calls.run, 0);
});
