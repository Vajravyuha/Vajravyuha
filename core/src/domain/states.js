const STATUS = Object.freeze({
  PENDING: 'PENDING',
  BUILDING: 'BUILDING',
  SCANNING: 'SCANNING',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  BLOCKED: 'BLOCKED',
  FAILED: 'FAILED',
  STOPPED: 'STOPPED'
});

const IN_PROGRESS = Object.freeze([
  STATUS.PENDING,
  STATUS.BUILDING,
  STATUS.SCANNING,
  STATUS.STARTING,
  STATUS.RUNNING
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  [STATUS.PENDING]: Object.freeze([STATUS.BUILDING, STATUS.FAILED, STATUS.STOPPED]),
  [STATUS.BUILDING]: Object.freeze([STATUS.SCANNING, STATUS.FAILED, STATUS.STOPPED]),
  [STATUS.SCANNING]: Object.freeze([STATUS.STARTING, STATUS.BLOCKED, STATUS.FAILED, STATUS.STOPPED]),
  [STATUS.STARTING]: Object.freeze([STATUS.RUNNING, STATUS.FAILED, STATUS.STOPPED]),
  [STATUS.RUNNING]: Object.freeze([STATUS.FAILED, STATUS.STOPPED]),
  [STATUS.BLOCKED]: Object.freeze([STATUS.STOPPED]),
  [STATUS.FAILED]: Object.freeze([STATUS.STOPPED]),
  [STATUS.STOPPED]: Object.freeze([])
});

// Check whether a status change is allowed, including explicit boot recovery.
function canTransition(from, to, options = {}) {
  if (from === to) return false;
  if (options.recovery && to === STATUS.RUNNING && IN_PROGRESS.includes(from)) return true;
  return Boolean(ALLOWED_TRANSITIONS[from] && ALLOWED_TRANSITIONS[from].includes(to));
}

// Throw a clear error when a caller attempts an illegal deployment state change.
function assertTransition(from, to, options = {}) {
  if (!canTransition(from, to, options)) {
    throw new Error(`Illegal deployment status transition: ${from} -> ${to}`);
  }
}

// Persist a legal state transition through the SQLite store before the next step runs.
function transitionDeployment(store, id, nextStatus, changes = {}, options = {}) {
  const current = store.getDeployment(id);
  if (!current) throw new Error(`Deployment ${id} was not found`);

  if (current.status === nextStatus) {
    if (Object.keys(changes).length > 0) store.updateDeployment(id, changes);
    return store.getDeployment(id);
  }

  assertTransition(current.status, nextStatus, options);
  store.updateDeployment(id, { ...changes, status: nextStatus });
  return store.getDeployment(id);
}

module.exports = {
  STATUS,
  IN_PROGRESS,
  ALLOWED_TRANSITIONS,
  canTransition,
  assertTransition,
  transitionDeployment
};
