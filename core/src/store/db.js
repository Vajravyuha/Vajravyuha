const Database = require('better-sqlite3');
const { STATUS } = require('../domain/states');

const COLUMN_NAMES = Object.freeze({
  appName: 'app_name',
  environment: 'environment',
  commitSha: 'commit_sha',
  requestedBy: 'requested_by',
  status: 'status',
  image: 'image',
  imageId: 'image_id',
  scanImageRef: 'scan_image_ref',
  port: 'port',
  containerId: 'container_id',
  reason: 'reason',
  criticalCount: 'critical_count',
  highCount: 'high_count',
  mediumCount: 'medium_count',
  lowCount: 'low_count',
  restartCount: 'restart_count',
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

// Convert a database row to the camel-case shape used by Core services.
function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    appName: row.app_name,
    environment: row.environment,
    commitSha: row.commit_sha,
    requestedBy: row.requested_by,
    status: row.status,
    image: row.image,
    imageId: row.image_id,
    scanImageRef: row.scan_image_ref,
    port: row.port,
    containerId: row.container_id,
    reason: row.reason,
    criticalCount: row.critical_count,
    highCount: row.high_count,
    mediumCount: row.medium_count,
    lowCount: row.low_count,
    restartCount: row.restart_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Open SQLite and expose the small set of deployment-store operations Core needs.
function createStore(dbPath) {
  const database = new Database(dbPath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY,
      app_name TEXT NOT NULL,
      environment TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      requested_by TEXT NOT NULL DEFAULT 'core',
      status TEXT NOT NULL CHECK (status IN (
        '${STATUS.PENDING}', '${STATUS.BUILDING}', '${STATUS.SCANNING}',
        '${STATUS.STARTING}', '${STATUS.RUNNING}', '${STATUS.BLOCKED}',
        '${STATUS.FAILED}', '${STATUS.STOPPED}'
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

  const insert = database.prepare(`
    INSERT INTO deployments (
      id, app_name, environment, commit_sha, requested_by, status,
      restart_count, created_at, updated_at
    ) VALUES (
      @id, @appName, @environment, @commitSha, @requestedBy, @status,
      0, @createdAt, @updatedAt
    )
  `);
  const selectById = database.prepare('SELECT * FROM deployments WHERE id = ?');
  const selectRunning = database.prepare(
    "SELECT * FROM deployments WHERE status = 'RUNNING' ORDER BY created_at DESC, rowid DESC LIMIT 1"
  );
  const selectInProgress = database.prepare(
    "SELECT * FROM deployments WHERE status IN ('PENDING', 'BUILDING', 'SCANNING', 'STARTING', 'RUNNING')"
  );
  const selectByStatus = database.prepare('SELECT * FROM deployments WHERE status = ?');

  // Insert a new deployment in PENDING before its pipeline is started.
  function createDeployment(deployment) {
    const now = new Date().toISOString();
    insert.run({
      id: deployment.id,
      appName: deployment.appName,
      environment: deployment.environment,
      commitSha: deployment.commitSha,
      requestedBy: deployment.requestedBy || 'core',
      status: STATUS.PENDING,
      createdAt: now,
      updatedAt: now
    });
    return getDeployment(deployment.id);
  }

  // Read one deployment by ID without exposing any request environment variables.
  function getDeployment(id) {
    return mapRow(selectById.get(id));
  }

  // Update only known deployment columns and always refresh updated_at.
  function updateDeployment(id, changes) {
    const entries = Object.entries(changes || {})
      .filter(([key]) => key !== 'id' && key !== 'createdAt' && COLUMN_NAMES[key]);
    const values = new Map(entries);
    values.set('updatedAt', new Date().toISOString());
    const assignments = [...values.keys()]
      .map((key) => `${COLUMN_NAMES[key]} = @${key}`)
      .join(', ');
    const parameters = Object.fromEntries(values);
    parameters.id = id;
    database.prepare(`UPDATE deployments SET ${assignments} WHERE id = @id`).run(parameters);
    return getDeployment(id);
  }

  // Return the most recently created deployment that is currently RUNNING.
  function getLatestRunningDeployment() {
    return mapRow(selectRunning.get());
  }

  // Return deployments that need boot recovery or supervisor checks.
  function getInProgressDeployments() {
    return selectInProgress.all().map(mapRow);
  }

  // Return all deployments with one status for supervisor processing.
  function getDeploymentsByStatus(status) {
    return selectByStatus.all(status).map(mapRow);
  }

  // Close the SQLite connection during a graceful Core shutdown.
  function close() {
    database.close();
  }

  return {
    createDeployment,
    getDeployment,
    updateDeployment,
    getLatestRunningDeployment,
    getInProgressDeployments,
    getDeploymentsByStatus,
    close
  };
}

module.exports = { createStore };
