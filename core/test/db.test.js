const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createStore } = require('../src/store/db');

// Create a temporary directory that holds one throwaway SQLite file.
function makeTempDatabasePath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vajravyuha-db-'));
  return { directory, dbPath: path.join(directory, 'core.db') };
}

// Recreate the deployments table exactly as an older Core created it, with one row.
function createLegacyDatabase(dbPath) {
  const database = new Database(dbPath);
  database.exec(`
    CREATE TABLE deployments (
      id TEXT PRIMARY KEY,
      app_name TEXT NOT NULL,
      environment TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      requested_by TEXT NOT NULL DEFAULT 'core',
      status TEXT NOT NULL CHECK (status IN (
        'PENDING', 'BUILDING', 'SCANNING',
        'STARTING', 'RUNNING', 'BLOCKED',
        'FAILED', 'STOPPED'
      )),
      image TEXT,
      image_id TEXT,
      scan_image_ref TEXT,
      port INTEGER,
      container_id TEXT,
      reason TEXT,
      critical_count INTEGER,
      high_count INTEGER,
      medium_count INTEGER,
      low_count INTEGER,
      restart_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS deployments_status_created_idx
      ON deployments(status, created_at);
  `);
  database.prepare(`
    INSERT INTO deployments (
      id, app_name, environment, commit_sha, requested_by, status,
      restart_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'dep_legacy',
    'sample-app',
    'test',
    'a1b2c3d',
    'test-suite',
    'RUNNING',
    0,
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z'
  );
  database.close();
}

// Verify an existing core.db keeps working and gains the repo_url and branch columns.
test('startup migration adds repo_url and branch to an existing database', () => {
  const { directory, dbPath } = makeTempDatabasePath();
  createLegacyDatabase(dbPath);
  const store = createStore(dbPath);
  try {
    const legacy = store.getDeployment('dep_legacy');
    assert.equal(legacy.appName, 'sample-app');
    assert.equal(legacy.status, 'RUNNING');
    assert.equal(legacy.repoUrl, null);
    assert.equal(legacy.branch, null);

    store.createDeployment({
      id: 'dep_repo1',
      appName: 'sample-app',
      environment: 'test',
      commitSha: '',
      repoUrl: 'https://github.com/example/app.git',
      branch: 'main',
      requestedBy: 'test-suite'
    });
    const created = store.getDeployment('dep_repo1');
    assert.equal(created.repoUrl, 'https://github.com/example/app.git');
    assert.equal(created.branch, 'main');

    const updated = store.updateDeployment('dep_repo1', { commitSha: 'deadbeef1234' });
    assert.equal(updated.commitSha, 'deadbeef1234');

    const listed = store.listDeployments(20);
    assert.equal(listed.length, 2);
    assert.equal(listed[0].id, 'dep_repo1');
    assert.equal(listed[1].id, 'dep_legacy');
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// Verify the list helper clamps the requested limit to the documented range.
test('listDeployments clamps the limit', () => {
  const { directory, dbPath } = makeTempDatabasePath();
  const store = createStore(dbPath);
  try {
    for (const id of ['dep_one', 'dep_two', 'dep_three']) {
      store.createDeployment({
        id,
        appName: 'sample-app',
        environment: 'test',
        commitSha: 'a1b2c3d',
        requestedBy: 'test-suite'
      });
    }
    assert.equal(store.listDeployments(2).length, 2);
    assert.equal(store.listDeployments(0).length, 1);
    assert.equal(store.listDeployments(1000).length, 3);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
