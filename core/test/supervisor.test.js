const test = require('node:test');
const assert = require('node:assert/strict');
const { STATUS } = require('../src/domain/states');
const { createSupervisor } = require('../src/services/supervisor');

// Create an in-memory RUNNING deployment that records supervisor updates.
function makeStore(restartCount = 0) {
  let row = {
    id: 'dep_abcdef',
    status: STATUS.RUNNING,
    containerId: 'container-123',
    port: 4001,
    restartCount,
    reason: null
  };
  return {
    getDeployment: () => ({ ...row }),
    updateDeployment: (id, changes) => {
      assert.equal(id, row.id);
      row = { ...row, ...changes };
      return { ...row };
    },
    getDeploymentsByStatus: (status) => row.status === status ? [{ ...row }] : []
  };
}

// Verify five consecutive failed restarts mark the deployment FAILED.
test('supervisor fails after five restart attempts with exponential backoff', async () => {
  const store = makeStore();
  const delays = [];
  let attempts = 0;
  let forgotten = false;
  const supervisor = createSupervisor({
    store,
    dockerRunner: {
      async restartContainer() { attempts += 1; throw new Error('restart failed'); }
    },
    atlasClient: {},
    proxy: { markHealthy() {}, forget() { forgotten = true; } },
    healthCheck: async () => false,
    restartHealthTimeoutMs: 0,
    sleep: async (milliseconds) => { delays.push(milliseconds); }
  });

  await supervisor.restartDeployment('dep_abcdef');
  const deployment = store.getDeployment('dep_abcdef');
  assert.equal(attempts, 5);
  assert.equal(deployment.restartCount, 5);
  assert.equal(deployment.status, STATUS.FAILED);
  assert.equal(deployment.reason, 'RESTART_LIMIT_EXCEEDED');
  assert.equal(forgotten, true);
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000]);
});

// Verify a successful restart resets the failure streak but preserves cumulative restartCount.
test('supervisor retries after earlier successful restarts', async () => {
  const store = makeStore(3);
  const delays = [];
  let attempts = 0;
  const healthy = [];
  const supervisor = createSupervisor({
    store,
    dockerRunner: {
      async restartContainer() { attempts += 1; }
    },
    atlasClient: {},
    proxy: { markHealthy(id, value) { healthy.push([id, value]); }, forget() {} },
    healthCheck: async () => true,
    restartHealthTimeoutMs: 0,
    sleep: async (milliseconds) => { delays.push(milliseconds); }
  });

  await supervisor.restartDeployment('dep_abcdef');
  await supervisor.restartDeployment('dep_abcdef');
  const deployment = store.getDeployment('dep_abcdef');
  assert.equal(attempts, 2);
  assert.equal(deployment.restartCount, 5);
  assert.equal(deployment.status, STATUS.RUNNING);
  assert.deepEqual(delays, [1000, 1000]);
  assert.deepEqual(healthy, [
    ['dep_abcdef', false],
    ['dep_abcdef', true],
    ['dep_abcdef', false],
    ['dep_abcdef', true]
  ]);
});
