const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');

// Only a plain public GitHub HTTPS URL is accepted: no credentials, query or fragment.
const GITHUB_URL_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/;

// A branch name must be safe to hand straight to git as one argument.
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

// Keep every checkout below core/workspaces and never let git wait for input.
const WORKSPACES_DIR = path.resolve(__dirname, '..', '..', 'workspaces');
const CLONE_TIMEOUT_MS = 120000;
const MAX_REPO_BYTES = 200 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 200;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

// Build an Error that carries the short failure reason stored on the deployment.
function createGitError(reason, message) {
  const error = new Error(message);
  error.reason = reason;
  error.code = reason;
  return error;
}

// Shorten text to one trimmed line and remove anything that looks like a credential.
function sanitizeMessage(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return '';
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0) || '';
  const cleaned = firstLine
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,})\b/g, '[REDACTED]')
    .replace(/([?&](?:access_token|token|key|secret|password)=)[^&\s]*/gi, '$1[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1')
    .trim();
  return cleaned.slice(0, MAX_MESSAGE_LENGTH);
}

// Resolve a workspace path for one deployment and assert it stays inside workspaces/.
function workspacePathFor(workspacesDir, deployId) {
  if (typeof deployId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(deployId)) {
    throw createGitError('INVALID_DEPLOY_ID', 'Deployment ID is not safe for a workspace path');
  }
  const root = path.resolve(workspacesDir);
  const resolved = path.resolve(root, deployId);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw createGitError('INVALID_DEPLOY_ID', 'Workspace path escapes the workspaces directory');
  }
  return resolved;
}

// Remove a directory tree without ever throwing.
async function removeDirectory(directory) {
  await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
}

// Check whether a path exists without throwing.
async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

// Return false when a checkout has no Dockerfile at its root.
async function hasDockerfile(directory) {
  return pathExists(path.join(directory, 'Dockerfile'));
}

// Add up the size of a directory tree, stopping early once the limit is exceeded.
async function directorySize(directory, limit) {
  let total = 0;
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      total += await directorySize(entryPath, limit);
    } else if (entry.isFile()) {
      const details = await fs.stat(entryPath);
      total += details.size;
    }
    if (total > limit) return total;
  }
  return total;
}

// Run one command with an argument list and no shell, resolving to its output.
function runCommand(execFileImpl, file, args, options) {
  return new Promise((resolve, reject) => {
    execFileImpl(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// Convert a failed or killed git call into CLONE_TIMEOUT or CLONE_FAILED.
function cloneFailure(error, timeoutMs) {
  const timedOut = Boolean(
    error && (error.killed === true || error.signal === 'SIGTERM' || error.code === 'ETIMEDOUT')
  );
  if (timedOut) {
    return createGitError('CLONE_TIMEOUT', `git clone timed out after ${Math.round(timeoutMs / 1000)} seconds`);
  }
  const detail = sanitizeMessage(error && (error.stderr || error.stdout || error.message));
  return createGitError('CLONE_FAILED', detail || 'git clone failed');
}

// Create the only module that runs git, with injectable execFile for tests.
function createGitService({
  execFile: execFileImpl = execFile,
  workspacesDir = WORKSPACES_DIR,
  timeoutMs = CLONE_TIMEOUT_MS,
  maxRepoBytes = MAX_REPO_BYTES
} = {}) {
  // Throw unless the URL is a credential-free GitHub HTTPS repository URL.
  function assertRepoUrl(repoUrl) {
    const value = typeof repoUrl === 'string' ? repoUrl.trim() : '';
    if (!GITHUB_URL_PATTERN.test(value)) {
      throw createGitError(
        'INVALID_REPO_URL',
        'repoUrl must be https://github.com/<owner>/<repo> without credentials, query or fragment'
      );
    }
    return value;
  }

  // Throw unless the branch name is short, simple and free of characters git misreads.
  function assertBranch(branch) {
    const value = typeof branch === 'string' && branch.length > 0 ? branch : 'main';
    if (!BRANCH_PATTERN.test(value) || value.includes('..')) {
      throw createGitError('INVALID_BRANCH', 'branch must match ^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$ and must not contain ".."');
    }
    return value;
  }

  // Shallow-clone one branch into core/workspaces/<deployId> and return its real commit SHA.
  async function cloneRepo(repoUrl, branch, deployId) {
    const url = assertRepoUrl(repoUrl);
    const branchName = assertBranch(branch);
    const directory = workspacePathFor(workspacesDir, deployId);

    await fs.mkdir(path.dirname(directory), { recursive: true });
    await removeDirectory(directory);

    try {
      await runCommand(
        execFileImpl,
        'git',
        ['clone', '--depth', '1', '--branch', branchName, '--', url, directory],
        {
          cwd: path.dirname(directory),
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          timeout: timeoutMs,
          maxBuffer: MAX_BUFFER_BYTES
        }
      );

      const size = await directorySize(directory, maxRepoBytes);
      if (size > maxRepoBytes) {
        throw createGitError(
          'REPO_TOO_LARGE',
          `Repository is larger than ${Math.round(maxRepoBytes / (1024 * 1024))} MB`
        );
      }
      if (!(await hasDockerfile(directory))) {
        throw createGitError('NO_DOCKERFILE', 'Repository has no Dockerfile at its root');
      }

      const revParse = await runCommand(
        execFileImpl,
        'git',
        ['-C', directory, 'rev-parse', 'HEAD'],
        {
          cwd: path.dirname(directory),
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          timeout: timeoutMs,
          maxBuffer: MAX_BUFFER_BYTES
        }
      );
      const commitSha = revParse.stdout.trim();
      if (!/^[a-fA-F0-9]{7,64}$/.test(commitSha)) {
        throw createGitError('CLONE_FAILED', 'git rev-parse HEAD did not return a commit SHA');
      }
      return { dir: directory, commitSha };
    } catch (error) {
      await removeDirectory(directory);
      if (error && error.reason) throw error;
      throw cloneFailure(error, timeoutMs);
    }
  }

  // Delete a deployment's workspace, treating a missing directory as already clean.
  async function removeWorkspace(deployId) {
    try {
      await removeDirectory(workspacePathFor(workspacesDir, deployId));
      return true;
    } catch {
      return false;
    }
  }

  return { cloneRepo, removeWorkspace };
}

module.exports = {
  createGitService,
  sanitizeMessage,
  WORKSPACES_DIR,
  CLONE_TIMEOUT_MS,
  MAX_REPO_BYTES
};
