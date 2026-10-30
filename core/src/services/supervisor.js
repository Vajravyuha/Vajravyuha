const { STATUS, IN_PROGRESS, transitionDeployment } = require('../domain/states');
const { redact } = require('../utils/redact');
const { checkHealth } = require('./health');

// Create the boot recovery and periodic container supervisor for running deployments.
function createSupervisor({
  store,
  dockerRunner,
  atlasClient,
  proxy,
  healthCheck = checkHealth,
  intervalMs = 3000,
  restartHealthTimeoutMs = 30000,
  restartHealthPollMs = 1000,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
}) {
  const healthFailures = new Map();
  const failedRestarts = new Map();
  const restarting = new Set();
  let interval = null;

  // Wait for a restarted application to become healthy without blocking other deployments.
  async function waitForHealthy(port) {
    const deadline = Date.now() + restartHealthTimeoutMs;
    do {
      try {
        if (await healthCheck(port)) return true;
      } catch {
        // A failed health request is handled as an unhealthy result.
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(restartHealthPollMs, remaining));
    } while (Date.now() <= deadline);
    return false;
  }

  // Adopt known containers and fail deployments that lost their container during a Core restart.
  async function recover() {
    const containers = await dockerRunner.findOurContainers();
    const adopted = new Set();

    for (const container of containers) {
      const deploymentId = container.labels && container.labels.deployId;
      const deployment = deploymentId ? store.getDeployment(deploymentId) : null;
      if (!deployment || !IN_PROGRESS.includes(deployment.status)) {
        await dockerRunner.stop(container.id).catch(() => {});
        continue;
      }

      adopted.add(deploymentId);
      const port = container.port || deployment.port;
      const updates = {
        containerId: container.id,
        port: port || null,
        imageId: container.imageId || deployment.imageId
      };
      if (deployment.status === STATUS.RUNNING) {
        store.updateDeployment(deploymentId, updates);
      } else {
        transitionDeployment(store, deploymentId, STATUS.RUNNING, updates, { recovery: true });
      }

      const healthy = Boolean(container.running && port && await healthCheck(port));
      proxy.markHealthy(deploymentId, healthy);
    }

    for (const deployment of store.getInProgressDeployments()) {
      if (adopted.has(deployment.id)) continue;
      transitionDeployment(store, deployment.id, STATUS.FAILED, {
        reason: redact('CORE_RESTARTED_LOST_CONTAINER')
      });
      proxy.forget(deployment.id);
    }
    proxy.refreshTarget();
  }

  // Restart an unhealthy existing container with bounded exponential backoff.
  async function restartDeployment(deploymentId) {
    if (restarting.has(deploymentId)) return;
    restarting.add(deploymentId);
    proxy.markHealthy(deploymentId, false);

    try {
      let deployment = store.getDeployment(deploymentId);
      if (!deployment || deployment.status !== STATUS.RUNNING) return;
      let failedAttempts = failedRestarts.get(deploymentId) || 0;
      let restartCount = deployment.restartCount || 0;

      while (failedAttempts < 5) {
        deployment = store.getDeployment(deploymentId);
        if (!deployment || deployment.status !== STATUS.RUNNING) return;
        const backoffMs = Math.min(1000 * (2 ** failedAttempts), 30000);
        await sleep(backoffMs);
        deployment = store.getDeployment(deploymentId);
        if (!deployment || deployment.status !== STATUS.RUNNING) return;

        restartCount += 1;
        store.updateDeployment(deploymentId, { restartCount });
        try {
          await dockerRunner.restartContainer(deployment.containerId);
          if (await waitForHealthy(deployment.port)) {
            healthFailures.delete(deploymentId);
            failedRestarts.delete(deploymentId);
            proxy.markHealthy(deploymentId, true);
            return;
          }
        } catch {
          // A failed Docker restart counts toward the same five-attempt limit.
        }

        failedAttempts += 1;
        failedRestarts.set(deploymentId, failedAttempts);
        if (failedAttempts >= 5) {
          const current = store.getDeployment(deploymentId);
          if (current && current.status === STATUS.RUNNING) {
            transitionDeployment(store, deploymentId, STATUS.FAILED, {
              reason: redact('RESTART_LIMIT_EXCEEDED')
            });
          }
          failedRestarts.delete(deploymentId);
          proxy.forget(deploymentId);
          return;
        }
      }
    } finally {
      restarting.delete(deploymentId);
    }
  }

  // Inspect all RUNNING deployments and restart those that are stopped or repeatedly unhealthy.
  async function runCycle() {
    const deployments = store.getDeploymentsByStatus(STATUS.RUNNING);
    await Promise.all(deployments.map(async (deployment) => {
      if (restarting.has(deployment.id)) return;
      let inspection;
      try {
        inspection = await dockerRunner.inspect(deployment.containerId);
      } catch {
        await restartDeployment(deployment.id);
        return;
      }
      if (!inspection.running) {
        await restartDeployment(deployment.id);
        return;
      }

      let healthy = false;
      try {
        healthy = await healthCheck(deployment.port);
      } catch {
        healthy = false;
      }
      if (healthy) {
        healthFailures.delete(deployment.id);
        proxy.markHealthy(deployment.id, true);
        return;
      }

      const failures = (healthFailures.get(deployment.id) || 0) + 1;
      healthFailures.set(deployment.id, failures);
      if (failures >= 3) await restartDeployment(deployment.id);
    }));
  }

  // Start the required three-second supervisor interval.
  function start() {
    if (interval) return;
    interval = setInterval(() => {
      void runCycle().catch(() => {});
    }, intervalMs);
    if (typeof interval.unref === 'function') interval.unref();
  }

  // Stop the interval during graceful shutdown and tests.
  function stop() {
    if (interval) clearInterval(interval);
    interval = null;
  }

  return { recover, runCycle, restartDeployment, start, stop };
}

module.exports = { createSupervisor };
