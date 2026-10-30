const test = require('node:test');
const assert = require('node:assert/strict');
const {
  redact,
  collectEnvironmentValues,
  collectDockerEnvironmentValues
} = require('../src/utils/redact');

// Verify known sensitive values are masked in arbitrary text.
test('redact masks values and longer matches first', () => {
  assert.equal(redact('password=super-secret', ['secret', 'super-secret']), 'password=[REDACTED]');
});

// Verify environment names and values are both included in the redaction set.
test('environment collectors include names and values', () => {
  assert.deepEqual(collectEnvironmentValues({ PASSWORD: 'demo-value' }), ['PASSWORD', 'demo-value']);
  assert.deepEqual(collectDockerEnvironmentValues(['PASSWORD=demo-value']), ['PASSWORD', 'demo-value']);
});
