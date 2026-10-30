const test = require('node:test');
const assert = require('node:assert/strict');
const { createAtlasClient } = require('../src/adapters/atlasClient');

// Create a small fetch-style response for adapter tests.
function mockResponse(status, body, invalidJson = false) {
  return {
    status,
    async json() {
      if (invalidJson) throw new SyntaxError('invalid JSON');
      return body;
    }
  };
}

// Create an Atlas client with a test-only fetch implementation.
function clientFor(fetchImpl, options = {}) {
  return createAtlasClient({
    url: 'http://atlas.test',
    token: 'test-token',
    fetchImpl,
    ...options
  });
}

const scanRequest = {
  deployId: 'dep_abcdef',
  appName: 'sample-app',
  environment: 'test',
  image: 'sample-app:dep_abcdef',
  commitSha: 'a1b2c3d',
  requestedBy: 'core'
};

// Verify an ordinary matching zero-critical HTTP 200 response passes.
test('scan returns PASSED only for a matching zero-critical response', async () => {
  const client = clientFor(async () => mockResponse(200, {
    deployId: scanRequest.deployId,
    status: 'PASSED',
    criticalCount: 0
  }));
  assert.deepEqual(await client.scan(scanRequest), { verdict: 'PASSED' });
});

// Verify a matching BLOCKED response keeps all four vulnerability counts.
test('scan returns BLOCKED with validated counts', async () => {
  const client = clientFor(async () => mockResponse(200, {
    deployId: scanRequest.deployId,
    status: 'BLOCKED',
    criticalCount: 1,
    highCount: 2,
    mediumCount: 3,
    lowCount: 5,
    message: 'Policy blocked the image'
  }));
  assert.deepEqual(await client.scan(scanRequest), {
    verdict: 'BLOCKED',
    counts: { criticalCount: 1, highCount: 2, mediumCount: 3, lowCount: 5 },
    message: 'Policy blocked the image'
  });
});

// Verify every documented and common HTTP error code is returned fail-closed.
for (const [code, status] of [
  ['INVALID_REQUEST', 400],
  ['UNAUTHORIZED', 401],
  ['IMAGE_NOT_FOUND', 404],
  ['IMAGE_UNSCANNABLE', 422],
  ['SCAN_TIMEOUT', 504],
  ['INTERNAL_ERROR', 500]
]) {
  test(`scan preserves Atlas error code ${code}`, async () => {
    let calls = 0;
    const client = clientFor(async () => {
      calls += 1;
      return mockResponse(status, { error: code, message: 'Atlas rejected the scan' });
    });
    const result = await client.scan(scanRequest);
    assert.equal(result.verdict, 'ERROR');
    assert.equal(result.code, code);
    assert.equal(calls, status >= 500 ? 2 : 1);
  });
}

// Verify a timeout is not retried and is reported as Atlas unreachable.
test('scan maps a timeout to ATLAS_UNREACHABLE', async () => {
  let calls = 0;
  const timeout = new Error('timed out');
  timeout.name = 'TimeoutError';
  const client = clientFor(async () => {
    calls += 1;
    throw timeout;
  });
  const result = await client.scan(scanRequest);
  assert.equal(result.code, 'ATLAS_UNREACHABLE');
  assert.equal(calls, 1);
});

// Verify a connection refusal retries once and then fails closed.
test('scan retries a connection refusal once', async () => {
  let calls = 0;
  const refused = new Error('connection refused');
  refused.code = 'ECONNREFUSED';
  const client = clientFor(async () => {
    calls += 1;
    throw refused;
  });
  const result = await client.scan(scanRequest);
  assert.equal(result.code, 'ATLAS_UNREACHABLE');
  assert.equal(calls, 2);
});

// Verify invalid JSON and unknown response statuses are not accepted.
test('scan rejects bad JSON and unknown status', async (t) => {
  await t.test('bad JSON', async () => {
    const client = clientFor(async () => mockResponse(200, null, true));
    const result = await client.scan(scanRequest);
    assert.equal(result.code, 'ATLAS_BAD_RESPONSE');
  });
  await t.test('unknown status', async () => {
    const client = clientFor(async () => mockResponse(200, {
      deployId: scanRequest.deployId,
      status: 'UNKNOWN'
    }));
    const result = await client.scan(scanRequest);
    assert.equal(result.code, 'ATLAS_BAD_RESPONSE');
  });
});

// Verify a successful scan response cannot be replayed for another deployment.
test('scan rejects a mismatched deployId', async () => {
  const client = clientFor(async () => mockResponse(200, {
    deployId: 'dep_000000',
    status: 'PASSED',
    criticalCount: 0
  }));
  const result = await client.scan(scanRequest);
  assert.equal(result.code, 'ATLAS_BAD_RESPONSE');
  assert.match(result.message, /mismatched deployId/);
});

// Verify a 5xx response is retried exactly once before a valid scan result.
test('scan retries HTTP 5xx once', async () => {
  let calls = 0;
  const client = clientFor(async () => {
    calls += 1;
    if (calls === 1) return mockResponse(503, { error: 'TEMPORARY' });
    return mockResponse(200, {
      deployId: scanRequest.deployId,
      status: 'PASSED',
      criticalCount: 0
    });
  });
  assert.deepEqual(await client.scan(scanRequest), { verdict: 'PASSED' });
  assert.equal(calls, 2);
});

// Verify a 4xx response is never retried.
test('scan does not retry HTTP 4xx', async () => {
  let calls = 0;
  const client = clientFor(async () => {
    calls += 1;
    return mockResponse(401, { error: 'UNAUTHORIZED' });
  });
  assert.equal((await client.scan(scanRequest)).code, 'UNAUTHORIZED');
  assert.equal(calls, 1);
});

// Verify the secrets endpoint returns a flat map and URL-encodes its app name.
test('getSecrets accepts a flat string map and encodes appName', async () => {
  let requestedUrl = '';
  const client = clientFor(async (url) => {
    requestedUrl = url;
    return mockResponse(200, { DATABASE_PASSWORD: 'example-value' });
  });
  const result = await client.getSecrets('sample app');
  assert.deepEqual(result, { ok: true, secrets: { DATABASE_PASSWORD: 'example-value' } });
  assert.equal(requestedUrl, 'http://atlas.test/api/v1/applications/sample%20app/secrets');
});

// Verify secrets errors map authorization and missing-application responses.
test('getSecrets maps 401 and APPLICATION_NOT_FOUND', async (t) => {
  await t.test('401', async () => {
    const client = clientFor(async () => mockResponse(401, { error: 'UNAUTHORIZED', deployId: null }));
    assert.equal((await client.getSecrets('sample-app')).code, 'UNAUTHORIZED');
  });
  await t.test('404', async () => {
    const client = clientFor(async () => mockResponse(404, {
      error: 'APPLICATION_NOT_FOUND',
      message: 'Application not found',
      deployId: null
    }));
    assert.equal((await client.getSecrets('sample-app')).code, 'APPLICATION_NOT_FOUND');
  });
});

// Verify a secrets 5xx response is retried once before returning the secret map.
test('getSecrets retries HTTP 500 once', async () => {
  let calls = 0;
  const client = clientFor(async () => {
    calls += 1;
    if (calls === 1) return mockResponse(500, { error: 'INTERNAL_ERROR' });
    return mockResponse(200, { TOKEN: 'not-a-real-token' });
  });
  assert.deepEqual(await client.getSecrets('sample-app'), {
    ok: true,
    secrets: { TOKEN: 'not-a-real-token' }
  });
  assert.equal(calls, 2);
});

// Verify Atlas error codes and messages cannot expose the service token.
test('scan redacts the Atlas service token from error responses', async () => {
  const token = 'private-atlas-service-token';
  const client = createAtlasClient({
    url: 'http://atlas.test',
    token,
    fetchImpl: async () => mockResponse(400, {
      error: token,
      message: `Atlas rejected token ${token}`
    })
  });
  const result = await client.scan(scanRequest);
  assert.equal(result.verdict, 'ERROR');
  assert.equal(JSON.stringify(result).includes(token), false);
});

// Verify secrets reads fail closed on malformed JSON, non-string values, and timeouts.
test('getSecrets rejects malformed responses and timeouts', async (t) => {
  await t.test('bad JSON', async () => {
    const client = clientFor(async () => mockResponse(200, null, true));
    assert.equal((await client.getSecrets('sample-app')).code, 'ATLAS_BAD_RESPONSE');
  });
  await t.test('non-string value', async () => {
    const client = clientFor(async () => mockResponse(200, { TOKEN: 12 }));
    assert.equal((await client.getSecrets('sample-app')).code, 'ATLAS_BAD_RESPONSE');
  });
  await t.test('timeout', async () => {
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    const client = clientFor(async () => { throw timeout; });
    assert.equal((await client.getSecrets('sample-app')).code, 'ATLAS_UNREACHABLE');
  });
});

// Verify secret write failures never echo secret values in returned error text.
test('putSecrets redacts submitted values from Atlas errors', async () => {
  const secret = 'local-test-secret-value';
  let sentBody;
  const client = clientFor(async (url, options) => {
    sentBody = options.body;
    return mockResponse(400, { error: 'INVALID_REQUEST', message: `Rejected ${secret}` });
  });
  const result = await client.putSecrets('sample-app', { PASSWORD: secret });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(JSON.parse(sentBody), { secrets: { PASSWORD: secret } });
});
