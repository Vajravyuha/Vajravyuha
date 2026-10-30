const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STATUS,
  canTransition,
  assertTransition,
  transitionDeployment
} = require('../src/domain/states');

// Verify that the normal deployment path contains only legal transitions.
test('states allow the deployment pipeline transitions', () => {
  assert.equal(canTransition(STATUS.PENDING, STATUS.BUILDING), true);
  assert.equal(canTransition(STATUS.BUILDING, STATUS.SCANNING), true);
  assert.equal(canTransition(STATUS.SCANNING, STATUS.STARTING), true);
  assert.equal(canTransition(STATUS.STARTING, STATUS.RUNNING), true);
  assert.equal(canTransition(STATUS.SCANNING, STATUS.BLOCKED), true);
  assert.equal(canTransition(STATUS.STARTING, STATUS.FAILED), true);
  assert.equal(canTransition(STATUS.RUNNING, STATUS.STOPPED), true);
});

// Verify that impossible transitions throw instead of silently changing status.
test('states reject illegal and terminal transitions', () => {
  assert.equal(canTransition(STATUS.PENDING, STATUS.RUNNING), false);
  assert.equal(canTransition(STATUS.BLOCKED, STATUS.RUNNING), false);
  assert.equal(canTransition(STATUS.STOPPED, STATUS.BUILDING), false);
  assert.throws(() => assertTransition(STATUS.PENDING, STATUS.RUNNING), /Illegal deployment status transition/);
});

// Verify that only explicit recovery can adopt an in-progress row as RUNNING.
test('states allow RUNNING adoption only during recovery', () => {
  assert.equal(canTransition(STATUS.SCANNING, STATUS.RUNNING), false);
  assert.equal(canTransition(STATUS.SCANNING, STATUS.RUNNING, { recovery: true }), true);
  assert.equal(canTransition(STATUS.FAILED, STATUS.RUNNING, { recovery: true }), false);
});

// Verify the state helper persists status and metadata through the injected store.
test('transitionDeployment writes the new status through the store', () => {
  let row = { id: 'dep_abcdef', status: STATUS.PENDING };
  const store = {
    getDeployment: () => ({ ...row }),
    updateDeployment: (id, changes) => { row = { ...row, ...changes }; }
  };
  const updated = transitionDeployment(store, row.id, STATUS.BUILDING, { image: 'local:tag' });
  assert.equal(updated.status, STATUS.BUILDING);
  assert.equal(updated.image, 'local:tag');
});
