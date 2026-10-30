const path = require('node:path');
const dotenv = require('dotenv');

// Load only Core's local environment file before reading the process environment.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

// Read and validate a TCP port from the environment.
function readPort(name, fallback) {
  const raw = process.env[name] || String(fallback);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer from 1 to 65535`);
  }
  return port;
}

// Build immutable runtime configuration and reject missing security settings early.
function loadConfig() {
  const atlasUrl = (process.env.ATLAS_URL || '').trim();
  const atlasServiceToken = (process.env.ATLAS_SERVICE_TOKEN || '').trim();
  const coreApiKey = (process.env.CORE_API_KEY || '').trim();

  if (!atlasUrl || !atlasServiceToken) {
    throw new Error('ATLAS_URL and ATLAS_SERVICE_TOKEN must be set in core/.env');
  }
  if (!coreApiKey) {
    throw new Error('CORE_API_KEY must be set in core/.env');
  }

  let parsedAtlasUrl;
  try {
    parsedAtlasUrl = new URL(atlasUrl);
  } catch {
    throw new Error('ATLAS_URL must be an absolute HTTP or HTTPS URL');
  }
  if (!['http:', 'https:'].includes(parsedAtlasUrl.protocol)) {
    throw new Error('ATLAS_URL must be an absolute HTTP or HTTPS URL');
  }

  const allowedAppsValue = (process.env.ALLOWED_APPS || '').trim();
  const allowedApps = allowedAppsValue
    ? allowedAppsValue.split(',').map((name) => name.trim()).filter(Boolean)
    : null;

  return Object.freeze({
    port: readPort('PORT', 8080),
    proxyPort: readPort('PROXY_PORT', 3000),
    atlasUrl: parsedAtlasUrl.toString().replace(/\/$/, ''),
    atlasServiceToken,
    coreApiKey,
    registryEnabled: (process.env.REGISTRY_ENABLED || 'false').toLowerCase() === 'true',
    registryPushHost: (process.env.REGISTRY_PUSH_HOST || 'localhost:5000').trim(),
    registryPullHost: (process.env.REGISTRY_PULL_HOST || 'localhost:5000').trim(),
    dbPath: (process.env.DB_PATH || 'core.db').trim(),
    allowedApps: allowedApps ? Object.freeze(allowedApps) : null
  });
}

module.exports = { loadConfig };
