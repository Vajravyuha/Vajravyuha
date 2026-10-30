// Check an application's health endpoint and return false for every fetch failure.
async function checkHealth(port, fetchImpl = globalThis.fetch, timeoutMs = 1000) {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs)
    });
    return response.ok;
  } catch {
    return false;
  }
}

module.exports = { checkHealth };
