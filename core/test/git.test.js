const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createGitService } = require('../src/services/git');

const CLONED_SHA = 'c0ffee1234567890abcdef1234567890abcdef12';

// Create a throwaway workspaces directory so no test writes into the repository.
async function makeWorkspacesDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'vajravyuha-git-'));
}

// Build a fake execFile that records calls and delegates to a small async handler.
function makeFakeExecFile(handler) {
  const calls = [];
  const execFile = (file, args, options, callback) => {
    calls.push({ file, args, options });
    Promise.resolve()
      .then(() => handler({ file, args, options }))
      .then(
        (result = {}) => callback(null, result.stdout || '', result.stderr || ''),
        (error) => callback(error)
      );
  };
  return { execFile, calls };
}

// Fake a successful clone that writes a Dockerfile, plus a rev-parse answer.
function successfulGitHandler({ dockerfile = 'FROM node:20-alpine\n' } = {}) {
  return async ({ args }) => {
    if (args[0] === 'clone') {
      const directory = args[args.length - 1];
      await fs.mkdir(directory, { recursive: true });
      if (dockerfile !== null) await fs.writeFile(path.join(directory, 'Dockerfile'), dockerfile);
      return { stdout: '' };
    }
    return { stdout: `${CLONED_SHA}\n` };
  };
}

// Create a git service that uses a fake execFile and a temporary workspaces directory.
async function makeService(fakeExecFile, options = {}) {
  const workspacesDir = await makeWorkspacesDir();
  const git = createGitService({ execFile: fakeExecFile.execFile, workspacesDir, ...options });
  return { git, workspacesDir };
}

// Verify a valid GitHub URL is cloned with a fixed argument list and returns the real SHA.
test('cloneRepo clones a GitHub URL into workspaces/<deployId>', async () => {
  const fake = makeFakeExecFile(successfulGitHandler());
  const { git, workspacesDir } = await makeService(fake);

  const result = await git.cloneRepo('https://github.com/example/app.git', 'main', 'dep_abc123');
  const expectedDir = path.join(workspacesDir, 'dep_abc123');

  assert.equal(result.dir, expectedDir);
  assert.equal(result.commitSha, CLONED_SHA);
  assert.equal(fake.calls[0].file, 'git');
  assert.deepEqual(fake.calls[0].args, [
    'clone', '--depth', '1', '--branch', 'main', '--',
    'https://github.com/example/app.git', expectedDir
  ]);
  assert.equal(fake.calls[0].options.env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(fake.calls[0].options.timeout, 120000);
  assert.deepEqual(fake.calls[1].args, ['-C', expectedDir, 'rev-parse', 'HEAD']);
});

// Verify only plain GitHub HTTPS URLs are accepted and git is never started otherwise.
test('cloneRepo rejects non-GitHub and credential-bearing URLs', async () => {
  const fake = makeFakeExecFile(successfulGitHandler());
  const { git } = await makeService(fake);

  for (const repoUrl of [
    'https://gitlab.com/example/app.git',
    'https://user:token@github.com/example/app.git',
    'https://github.com/example/app?token=abc',
    'https://github.com/example/app#readme',
    'ssh://git@github.com/example/app.git'
  ]) {
    await assert.rejects(
      () => git.cloneRepo(repoUrl, 'main', 'dep_abc123'),
      (error) => error.reason === 'INVALID_REPO_URL'
    );
  }
  assert.equal(fake.calls.length, 0);
});

// Verify unsafe branch names are rejected before any command runs.
test('cloneRepo rejects a branch starting with "-" and a branch containing ".."', async () => {
  const fake = makeFakeExecFile(successfulGitHandler());
  const { git } = await makeService(fake);

  await assert.rejects(
    () => git.cloneRepo('https://github.com/example/app.git', '--upload-pack=evil', 'dep_abc123'),
    (error) => error.reason === 'INVALID_BRANCH'
  );
  await assert.rejects(
    () => git.cloneRepo('https://github.com/example/app.git', 'release/../../etc', 'dep_abc123'),
    (error) => error.reason === 'INVALID_BRANCH'
  );
  assert.equal(fake.calls.length, 0);
});

// Verify a killed clone call is reported as CLONE_TIMEOUT.
test('cloneRepo maps a git timeout to CLONE_TIMEOUT', async () => {
  const fake = makeFakeExecFile(async () => {
    const error = new Error('Command failed: git clone');
    error.killed = true;
    error.signal = 'SIGTERM';
    error.stderr = '';
    throw error;
  });
  const { git } = await makeService(fake, { timeoutMs: 120000 });

  await assert.rejects(
    () => git.cloneRepo('https://github.com/example/app.git', 'main', 'dep_abc123'),
    (error) => error.reason === 'CLONE_TIMEOUT' && /timed out/.test(error.message)
  );
});

// Verify a checkout without a root Dockerfile is reported and cleaned up.
test('cloneRepo reports NO_DOCKERFILE and removes the checkout', async () => {
  const fake = makeFakeExecFile(successfulGitHandler({ dockerfile: null }));
  const { git, workspacesDir } = await makeService(fake);

  await assert.rejects(
    () => git.cloneRepo('https://github.com/example/app.git', 'main', 'dep_abc123'),
    (error) => error.reason === 'NO_DOCKERFILE'
  );
  await assert.rejects(() => fs.access(path.join(workspacesDir, 'dep_abc123')));
});

// Verify an oversized checkout is reported before Docker or Atlas ever see it.
test('cloneRepo reports REPO_TOO_LARGE', async () => {
  const fake = makeFakeExecFile(async ({ args }) => {
    if (args[0] === 'clone') {
      const directory = args[args.length - 1];
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'Dockerfile'), 'FROM node:20-alpine\n');
      await fs.writeFile(path.join(directory, 'big.bin'), Buffer.alloc(4096));
      return { stdout: '' };
    }
    return { stdout: `${CLONED_SHA}\n` };
  });
  const { git } = await makeService(fake, { maxRepoBytes: 1024 });

  await assert.rejects(
    () => git.cloneRepo('https://github.com/example/app.git', 'main', 'dep_abc123'),
    (error) => error.reason === 'REPO_TOO_LARGE'
  );
});

// Verify a clone failure keeps only one short stderr line with tokens removed.
test('cloneRepo reduces a clone failure to one sanitized line', async () => {
  const fake = makeFakeExecFile(async () => {
    const error = new Error('Command failed: git clone');
    error.stderr = [
      'fatal: Authentication failed for https://x-access-token:ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/example/app.git',
      'second line is dropped'
    ].join('\n');
    throw error;
  });
  const { git } = await makeService(fake);

  await assert.rejects(
    () => git.cloneRepo('https://github.com/example/app.git', 'main', 'dep_abc123'),
    (error) => {
      assert.equal(error.reason, 'CLONE_FAILED');
      assert.equal(error.message.includes('\n'), false);
      assert.equal(error.message.includes('ghp_'), false);
      assert.equal(error.message.includes('x-access-token'), false);
      assert.equal(error.message.includes('second line'), false);
      assert.ok(error.message.length <= 200);
      return true;
    }
  );
});

// Verify removeWorkspace deletes a checkout and tolerates a missing one.
test('removeWorkspace deletes the deployment workspace', async () => {
  const fake = makeFakeExecFile(successfulGitHandler());
  const { git, workspacesDir } = await makeService(fake);
  const created = await git.cloneRepo('https://github.com/example/app.git', 'main', 'dep_abc123');

  assert.equal(await git.removeWorkspace('dep_abc123'), true);
  await assert.rejects(() => fs.access(created.dir));
  assert.equal(workspacesDir.startsWith(path.join(os.tmpdir(), 'vajravyuha-git-')), true);
  assert.equal(await git.removeWorkspace('dep_abc123'), true);
});
