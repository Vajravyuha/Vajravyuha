const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const {
  STATUS,
  IN_PROGRESS,
  transitionDeployment
} = require('../domain/states');
const {
  redact,
  collectEnvironmentValues,
  collectDockerEnvironmentValues,
  createRedactingLogger,
  safeErrorMessage
} = require('../utils/redact');
const { checkHealth } = require('./health');
const { createGitService } = require('./git');

// Find the first currently unused local TCP port at or above the requested start.
async function findFreePort(startPort = 4001) {
  for (let port = startPort; port <= 65535; port += 1) {
    const available = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', (error) => {
        if (error.code === 'EADDRINUSE') resolve(false);
        else reject(error);
      });
      server.listen(port, '127.0.0.1', () => {
        server.close((error) => error ? reject(error) : resolve(true));
      });
    });
    if (available) return port;
  }
  throw new Error('No free host port is available');
}

// Poll an application health endpoint until it succeeds or the deadline expires.
async function waitForHealth(port, healthCheck, timeoutMs, pollIntervalMs, sleep) {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      if (await healthCheck(port)) return true;
    } catch {
      // A thrown health check is treated like an unhealthy response.
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollIntervalMs, remaining));
  } while (Date.now() <= deadline);
  return false;
}

// Choose the single Atlas image reference, optionally pushing to the configured registry.
async function getScanImageRef(deployment, imageTag, config, dockerRunner) {
  if (!config.registryEnabled) return imageTag;

  const registryTag = `${config.registryPushHost}/${deployment.appName}:${deployment.id}`;
  const pushedDigest = await dockerRunner.pushImage(imageTag, registryTag);
  const digest = String(pushedDigest || '').replace(/^sha256:/i, '');
  if (!/^[a-fA-F0-9]{64}$/.test(digest)) {
    throw new Error('Registry push did not return a valid SHA-256 digest');
  }
  return `${config.registryPullHost}/${deployment.appName}:${deployment.id}@sha256:${digest}`;
}

// Build, scan, and start one deployment without persisting request environment values.
function createOrchestrator({
  store,
  dockerRunner,
  atlasClient,
  config,
  gitService = createGitService(),
  healthCheck = checkHealth,
  findPort = findFreePort,
  proxy = null,
  logger = console,
  healthTimeoutMs = 30000,
  healthPollIntervalMs = 1000,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
}) {
  const cancelled = new Set();
  const activePipelines = new Set();

  // Persist a safe failure reason unless the deployment was already stopped or terminal.
  function failDeployment(id, reason, sensitiveValues) {
    const current = store.getDeployment(id);
    if (!current || !IN_PROGRESS.includes(current.status)) return current;
    const safeReason = redact(reason || 'Deployment failed', sensitiveValues);
    return transitionDeployment(store, id, STATUS.FAILED, { reason: safeReason });
  }

  // Create a deployment row, enforce the app allowlist, and start its pipeline immediately.
  function createDeployment(deploymentRequest) {
    if (config.allowedApps && !config.allowedApps.includes(deploymentRequest.appName)) {
      return { allowed: false };
    }
    const id = `dep_${crypto.randomBytes(3).toString('hex')}`;
    store.createDeployment({
      id,
      appName: deploymentRequest.appName,
      environment: deploymentRequest.environment,
      commitSha: deploymentRequest.commitSha,
      repoUrl: deploymentRequest.repoUrl || null,
      branch: deploymentRequest.branch || null,
      requestedBy: deploymentRequest.requestedBy
    });
    void runPipeline(id, {
      repoUrl: deploymentRequest.repoUrl || null,
      branch: deploymentRequest.branch || 'main',
      contextDir: deploymentRequest.contextDir,
      envVars: deploymentRequest.envVars,
      useSecrets: deploymentRequest.useSecrets
    }).catch(() => {});
    return { allowed: true, id };
  }

  // Run all deployment stages and convert every uncaught failure into FAILED.
  async function runPipeline(id, requestOptions = {}) {
    activePipelines.add(id);
    const sensitiveValues = new Set(collectEnvironmentValues(requestOptions.envVars || {}));
    const safeLogger = createRedactingLogger(logger, sensitiveValues);
    // Remember whether this run cloned a repository so the workspace is always cleaned up.
    const isRepoDeployment = Boolean(requestOptions.repoUrl);
    let workspaceRemoved = false;
    // Remove the cloned workspace exactly once, on success and on every failure path.
    async function cleanupWorkspace() {
      if (!isRepoDeployment || workspaceRemoved) return;
      workspaceRemoved = true;
      await gitService.removeWorkspace(id);
    }
    let secrets = null;
    let runEnvironment = null;
    let containerId = null;

    try {
      let deployment = store.getDeployment(id);
      if (!deployment) return null;
      if (cancelled.has(id) || deployment.status === STATUS.STOPPED) return deployment;

      transitionDeployment(store, id, STATUS.BUILDING);
      safeLogger.info(`Deployment ${id} is building`);

      // Clone the requested repository, or fall back to a local sample directory.
      let contextDirectory;
      if (isRepoDeployment) {
        const clone = await gitService.cloneRepo(requestOptions.repoUrl, requestOptions.branch, id);
        contextDirectory = clone.dir;
        deployment = store.updateDeployment(id, { commitSha: clone.commitSha });
        safeLogger.info(`Deployment ${id} checked out ${clone.commitSha}`);
      } else {
        contextDirectory = path.isAbsolute(requestOptions.contextDir || '')
          ? requestOptions.contextDir
          : path.resolve(__dirname, '..', '..', requestOptions.contextDir || 'samples/hello-app');
      }

      const imageTag = `vajravyuha/${deployment.appName}:${deployment.id}`;
      await dockerRunner.buildImage(contextDirectory, imageTag);
      // The checkout is only needed while Docker builds the image.
      await cleanupWorkspace();
      if (cancelled.has(id)) return store.getDeployment(id);

      const imageId = await dockerRunner.getImageId(imageTag);
      store.updateDeployment(id, { image: imageTag, imageId });
      const scanImageRef = await getScanImageRef(deployment, imageTag, config, dockerRunner);
      store.updateDeployment(id, { scanImageRef });
      if (cancelled.has(id)) return store.getDeployment(id);

      transitionDeployment(store, id, STATUS.SCANNING);
      safeLogger.info(`Deployment ${id} is scanning`);
      const scan = await atlasClient.scan({
        deployId: deployment.id,
        appName: deployment.appName,
        environment: deployment.environment,
        image: scanImageRef,
        commitSha: deployment.commitSha,
        requestedBy: deployment.requestedBy || 'core'
      });
      if (cancelled.has(id)) return store.getDeployment(id);

      if (scan && scan.verdict === 'BLOCKED') {
        const counts = scan.counts || {};
        return transitionDeployment(store, id, STATUS.BLOCKED, {
          criticalCount: counts.criticalCount ?? 0,
          highCount: counts.highCount ?? 0,
          mediumCount: counts.mediumCount ?? 0,
          lowCount: counts.lowCount ?? 0,
          reason: redact(scan.message || 'Deployment blocked by Atlas', sensitiveValues)
        });
      }
      if (!scan || scan.verdict !== 'PASSED') {
        return failDeployment(id, scan && scan.code ? scan.code : 'ATLAS_BAD_RESPONSE', sensitiveValues);
      }

      const currentImageId = await dockerRunner.getImageId(imageTag);
      if (currentImageId !== imageId) {
        return failDeployment(id, 'IMAGE_CHANGED_AFTER_SCAN', sensitiveValues);
      }
      if (cancelled.has(id)) return store.getDeployment(id);

      if (requestOptions.useSecrets === true) {
        const secretsResult = await atlasClient.getSecrets(deployment.appName);
        if (!secretsResult || secretsResult.ok !== true) {
          const code = secretsResult && secretsResult.code ? secretsResult.code : 'ATLAS_BAD_RESPONSE';
          return failDeployment(id, `SECRETS_${code}`, sensitiveValues);
        }
        secrets = secretsResult.secrets || {};
        for (const value of collectEnvironmentValues(secrets)) sensitiveValues.add(value);
      }
      if (cancelled.has(id)) return store.getDeployment(id);

      runEnvironment = {
        ...(requestOptions.envVars || {}),
        ...(secrets || {})
      };
      transitionDeployment(store, id, STATUS.STARTING);
      safeLogger.info(`Deployment ${id} is starting`);
      const port = await findPort(4001);
      if (cancelled.has(id)) return store.getDeployment(id);
      store.updateDeployment(id, { port });
      const startedContainer = await dockerRunner.runContainer({
        imageRef: imageId,
        port,
        labels: { vajravyuha: 'true', deployId: id },
        env: runEnvironment
      });
      containerId = typeof startedContainer === 'string' ? startedContainer : startedContainer.id;
      runEnvironment = null;
      secrets = null;
      sensitiveValues.clear();
      requestOptions = null;
      store.updateDeployment(id, { containerId });

      if (cancelled.has(id)) {
        await dockerRunner.stop(containerId).catch(() => {});
        return store.getDeployment(id);
      }

      const healthy = await waitForHealth(
        port,
        healthCheck,
        healthTimeoutMs,
        healthPollIntervalMs,
        sleep
      );
      if (!healthy) {
        let lines = [];
        try {
          lines = await getLogs(id) || [];
        } catch {
          lines = [];
        }
        const reason = redact(`Health check failed after 30 seconds. Container logs: ${lines.join('\n')}`, sensitiveValues);
        await dockerRunner.stop(containerId).catch(() => {});
        return failDeployment(id, reason, sensitiveValues);
      }
      if (cancelled.has(id)) {
        await dockerRunner.stop(containerId).catch(() => {});
        return store.getDeployment(id);
      }

      deployment = transitionDeployment(store, id, STATUS.RUNNING);
      if (proxy) proxy.markHealthy(id, true);
      safeLogger.info(`Deployment ${id} is running on port ${port}`);
      return deployment;
    } catch (error) {
      // Git and checkout failures carry a short deployment reason such as CLONE_FAILED.
      const reason = error && typeof error.reason === 'string' && error.reason
        ? error.reason
        : safeErrorMessage(error, sensitiveValues);
      const failed = failDeployment(id, reason, sensitiveValues);
      if (containerId) await dockerRunner.stop(containerId).catch(() => {});
      if (failed && failed.status === STATUS.FAILED && proxy) proxy.forget(id);
      safeLogger.error(`Deployment ${id} failed: ${reason}`);
      return failed;
    } finally {
      await cleanupWorkspace();
      secrets = null;
      runEnvironment = null;
      sensitiveValues.clear();
      requestOptions = null;
      activePipelines.delete(id);
      cancelled.delete(id);
    }
  }

  // Stop a deployment, remove its container, and prevent an active pipeline from reviving it.
  async function stop(id) {
    cancelled.add(id);
    const deployment = store.getDeployment(id);
    if (!deployment) {
      cancelled.delete(id);
      return null;
    }
    if (deployment.status === STATUS.STOPPED) {
      if (!activePipelines.has(id)) cancelled.delete(id);
      return deployment;
    }

    let stopError = null;
    if (deployment.containerId) {
      try {
        await dockerRunner.stop(deployment.containerId);
      } catch {
        stopError = new Error('Container could not be stopped cleanly');
      }
    }
    const current = store.getDeployment(id);
    if (current && current.status !== STATUS.STOPPED) {
      transitionDeployment(store, id, STATUS.STOPPED, { reason: null });
    }
    if (proxy) proxy.forget(id);
    if (!activePipelines.has(id)) cancelled.delete(id);
    if (stopError) throw stopError;
    return store.getDeployment(id);
  }

  // Return the latest one hundred container log lines with environment values redacted.
  async function getLogs(id) {
    const deployment = store.getDeployment(id);
    if (!deployment) return null;
    if (!deployment.containerId) return [];

    let environment;
    try {
      environment = await dockerRunner.getEnvironment(deployment.containerId);
    } catch {
      return [];
    }
    const sensitiveValues = collectDockerEnvironmentValues(environment || []);
    let logLines;
    try {
      logLines = await dockerRunner.getLogs(deployment.containerId);
      const lines = Array.isArray(logLines)
        ? logLines
        : String(logLines || '').split(/\r?\n/);
      return lines.slice(-100).map((line) => redact(line, sensitiveValues));
    } finally {
      sensitiveValues.length = 0;
      environment = null;
      logLines = null;
    }
  }

  return { createDeployment, runPipeline, stop, getLogs };
}

module.exports = { createOrchestrator, getScanImageRef, findFreePort, waitForHealth };
