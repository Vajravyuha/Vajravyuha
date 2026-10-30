// Replace known environment values and secrets before text is logged or stored.
function redact(value, knownValues = []) {
  let output = value === undefined || value === null ? '' : String(value);
  const values = knownValues instanceof Set
    ? [...knownValues]
    : Array.isArray(knownValues)
      ? knownValues
      : [knownValues];
  const uniqueValues = [...new Set(values
    .filter((item) => typeof item === 'string' || typeof item === 'number')
    .map(String)
    .filter((item) => item.length > 0))]
    .sort((left, right) => right.length - left.length);

  for (const sensitiveValue of uniqueValues) {
    output = output.split(sensitiveValue).join('[REDACTED]');
  }
  return output;
}

// Collect environment variable names and values so neither can leak in output.
function collectEnvironmentValues(environment = {}) {
  const values = [];
  for (const [name, value] of Object.entries(environment)) {
    values.push(name);
    if (typeof value === 'string' || typeof value === 'number') {
      values.push(String(value));
    }
  }
  return [...new Set(values.filter((value) => value.length > 0))];
}

// Collect names and values from Docker's KEY=value environment representation.
function collectDockerEnvironmentValues(environment = []) {
  const values = [];
  for (const entry of environment) {
    if (typeof entry !== 'string') continue;
    const separator = entry.indexOf('=');
    if (separator < 0) {
      values.push(entry);
      continue;
    }
    values.push(entry.slice(0, separator), entry.slice(separator + 1));
  }
  return [...new Set(values.filter((value) => value.length > 0))];
}

// Return logger methods that redact every message using the current secret set.
function createRedactingLogger(logger = console, knownValues = new Set()) {
  const write = (level, message) => {
    const method = typeof logger[level] === 'function' ? logger[level] : logger.log;
    if (typeof method === 'function') {
      method.call(logger, redact(message, knownValues));
    }
  };
  return {
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message)
  };
}

// Convert an exception to safe text without exposing known secret values.
function safeErrorMessage(error, knownValues = []) {
  const message = error instanceof Error ? error.message : String(error);
  return redact(message || 'Unknown error', knownValues);
}

module.exports = {
  redact,
  collectEnvironmentValues,
  collectDockerEnvironmentValues,
  createRedactingLogger,
  safeErrorMessage
};
