const Docker = require('dockerode');
const tar = require('tar-fs');
const fs = require('node:fs');

// Decode Docker's multiplexed stdout and stderr frames into ordinary text.
function decodeDockerLogBuffer(buffer) {
  const chunks = [];
  let offset = 0;
  let foundFrame = false;

  while (offset + 8 <= buffer.length) {
    const streamType = buffer[offset];
    const headerIsValid = [0, 1, 2].includes(streamType) &&
      buffer[offset + 1] === 0 && buffer[offset + 2] === 0 && buffer[offset + 3] === 0;
    if (!headerIsValid) break;
    const size = buffer.readUInt32BE(offset + 4);
    if (offset + 8 + size > buffer.length) break;
    foundFrame = true;
    chunks.push(buffer.subarray(offset + 8, offset + 8 + size).toString('utf8'));
    offset += 8 + size;
  }

  return foundFrame ? chunks.join('') : buffer.toString('utf8');
}

// Collect a readable Docker log stream into a single buffer.
function readStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.once('error', reject);
    stream.once('end', () => resolve(Buffer.concat(chunks)));
  });
}

// Create the only adapter that communicates with the Docker daemon.
function createDockerRunner({ docker, dockerOptions } = {}) {
  const client = docker || new Docker(dockerOptions || {});

  // Build an image from a directory and reject both stream and progress errors.
  async function buildImage(directory, tag) {
    if (!fs.existsSync(directory)) throw new Error(`Build context does not exist: ${directory}`);
    const stream = await client.buildImage(tar.pack(directory), { t: tag });
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, output) => {
        if (settled) return;
        settled = true;
        if (error) {
          reject(error);
          return;
        }
        const failed = Array.isArray(output)
          ? output.find((item) => item && (item.error || item.errorDetail))
          : null;
        if (failed) {
          reject(new Error(
            (failed.errorDetail && failed.errorDetail.message) || failed.error || 'Docker image build failed'
          ));
          return;
        }
        resolve(output);
      };
      stream.once('error', (error) => finish(error));
      client.modem.followProgress(stream, (error, output) => finish(error, output));
    });
  }

  // Resolve a Docker tag to its immutable image ID.
  async function getImageId(tag) {
    const details = await client.getImage(tag).inspect();
    return details.Id;
  }

  // Tag an image for a registry, push it, and return the digest from Docker's response.
  async function pushImage(localTag, registryTag = localTag) {
    if (registryTag !== localTag) {
      const colon = registryTag.lastIndexOf(':');
      if (colon <= registryTag.lastIndexOf('/')) {
        throw new Error('Registry image tag must include a tag name');
      }
      const repository = registryTag.slice(0, colon);
      const tag = registryTag.slice(colon + 1);
      await client.getImage(localTag).tag({ repo: repository, tag });
    }

    const stream = await client.getImage(registryTag).push({});
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, output) => {
        if (settled) return;
        settled = true;
        if (error) {
          reject(error);
          return;
        }
        const items = Array.isArray(output) ? output : [];
        let digest = null;
        for (const item of items) {
          if (item && item.aux && typeof item.aux.Digest === 'string') digest = item.aux.Digest;
          if (item && typeof item.digest === 'string') digest = item.digest;
          if (item && typeof item.status === 'string') {
            const match = item.status.match(/digest:\s*(sha256:[a-fA-F0-9]{64})/);
            if (match) digest = match[1];
          }
          if (item && typeof item.progress === 'string') {
            const match = item.progress.match(/sha256:[a-fA-F0-9]{64}/);
            if (match) digest = match[0];
          }
        }
        if (!digest) {
          reject(new Error('Docker registry push completed without an image digest'));
          return;
        }
        resolve(digest);
      };
      stream.once('error', (error) => finish(error));
      client.modem.followProgress(stream, (error, output) => finish(error, output));
    });
  }

  // Start a hardened container from an immutable image reference.
  async function runContainer({ imageRef, port, labels = {}, env = {} }) {
    const container = await client.createContainer({
      Image: imageRef,
      Labels: { ...labels, vajravyuha: 'true' },
      Env: Object.entries(env).map(([name, value]) => `${name}=${String(value)}`),
      ExposedPorts: { '3000/tcp': {} },
      HostConfig: {
        Memory: 256 * 1024 * 1024,
        CapDrop: ['ALL'],
        ReadonlyRootfs: true,
        Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=64m' },
        SecurityOpt: ['no-new-privileges:true'],
        PortBindings: {
          '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }]
        }
      }
    });

    try {
      await container.start();
      return container.id;
    } catch (error) {
      await container.remove({ force: true }).catch(() => {});
      throw error;
    }
  }

  // Return a limited inspection record without exposing Docker's full response.
  async function inspect(containerId) {
    const details = await client.getContainer(containerId).inspect();
    const portBindings = details.NetworkSettings && details.NetworkSettings.Ports
      ? details.NetworkSettings.Ports['3000/tcp']
      : null;
    const hostPort = portBindings && portBindings[0]
      ? Number(portBindings[0].HostPort)
      : null;
    return {
      id: details.Id,
      running: Boolean(details.State && details.State.Running),
      state: details.State ? details.State.Status : 'unknown',
      labels: (details.Config && details.Config.Labels) || {},
      imageId: details.Image,
      port: Number.isInteger(hostPort) ? hostPort : null
    };
  }

  // Read container environment values only when a log request needs redaction.
  async function getEnvironment(containerId) {
    const details = await client.getContainer(containerId).inspect();
    return (details.Config && details.Config.Env) || [];
  }

  // Stop and remove a container, treating an already-removed container as stopped.
  async function stop(containerId) {
    const container = client.getContainer(containerId);
    let details;
    try {
      details = await container.inspect();
    } catch (error) {
      if (error.statusCode === 404 || error.status === 404) return;
      throw error;
    }

    if (details.State && details.State.Running) {
      try {
        await container.stop({ t: 10 });
      } catch (error) {
        if (error.statusCode !== 304 && error.statusCode !== 404 && error.status !== 304 && error.status !== 404) {
          throw error;
        }
      }
    }
    try {
      await container.remove({ force: true });
    } catch (error) {
      if (error.statusCode !== 404 && error.status !== 404) throw error;
    }
  }

  // Start an existing stopped container while keeping its original environment.
  async function startContainer(containerId) {
    const container = client.getContainer(containerId);
    const details = await container.inspect();
    if (!details.State || !details.State.Running) await container.start();
  }

  // Restart an existing container so its original environment is preserved.
  async function restartContainer(containerId) {
    const container = client.getContainer(containerId);
    const details = await container.inspect();
    if (details.State && details.State.Running) {
      await container.restart({ t: 10 });
    } else {
      await container.start();
    }
  }

  // Read up to the most recent one hundred combined stdout and stderr lines.
  async function getLogs(containerId) {
    const result = await client.getContainer(containerId).logs({
      stdout: true,
      stderr: true,
      follow: false,
      tail: 100,
      timestamps: false
    });
    let buffer;
    if (Buffer.isBuffer(result)) buffer = result;
    else if (typeof result === 'string') buffer = Buffer.from(result);
    else if (result && typeof result.on === 'function') buffer = await readStream(result);
    else buffer = Buffer.alloc(0);

    return decodeDockerLogBuffer(buffer)
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .slice(-100);
  }

  // Find every Core-labeled Docker container, including stopped containers for recovery.
  async function findOurContainers() {
    const listed = await client.listContainers({
      all: true,
      filters: { label: ['vajravyuha=true'] }
    });
    const found = [];
    for (const item of listed) {
      try {
        const details = await inspect(item.Id);
        found.push(details);
      } catch (error) {
        if (error.statusCode !== 404 && error.status !== 404) throw error;
      }
    }
    return found;
  }

  return {
    buildImage,
    getImageId,
    pushImage,
    runContainer,
    inspect,
    getEnvironment,
    stop,
    startContainer,
    restartContainer,
    getLogs,
    findOurContainers
  };
}

module.exports = { createDockerRunner, decodeDockerLogBuffer };
