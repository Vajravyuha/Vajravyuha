const { redact } = require("../utils/redact");

// Create the HTTP-only client that talks to the Atlas API.
function createAtlasClient({
  url,
  token,
  fetchImpl = globalThis.fetch,
  scanTimeoutMs = 150000,
  secretsTimeoutMs = 10000,
  healthTimeoutMs = 2000,
}) {
  const baseUrl = String(url).replace(/\/+$/, "");

  // Check that a parsed JSON value is an ordinary object, not null or an array.
  function isPlainObject(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  // Recognize AbortSignal timeouts so they are not retried as network failures.
  function isTimeoutError(error) {
    const code = error && (error.code || (error.cause && error.cause.code));
    return Boolean(
      (error &&
        (error.name === "TimeoutError" || error.name === "AbortError")) ||
      code === "ETIMEDOUT" ||
      code === "UND_ERR_CONNECT_TIMEOUT",
    );
  }

  // Recognize the network failures that are safe to retry once.
  function isNetworkError(error) {
    if (!error || isTimeoutError(error)) return false;
    const code = error.code || (error.cause && error.cause.code);
    return (
      error.name === "TypeError" ||
      [
        "ECONNREFUSED",
        "ECONNRESET",
        "EHOSTUNREACH",
        "ENETUNREACH",
        "ENOTFOUND",
        "EAI_AGAIN",
      ].includes(code) ||
      /fetch failed|connection refused|network error/i.test(
        String(error.message || ""),
      )
    );
  }

  // Return a generic safe error message after removing known sensitive values.
  function safeMessage(value, sensitiveValues, fallback) {
    const message =
      value && typeof value.message === "string" ? value.message : fallback;
    return redact(message || fallback, sensitiveValues);
  }

  // Map an Atlas HTTP error to its contract code without exposing raw response data.
  function errorFromResponse(status, body, endpoint, sensitiveValues = []) {
    const knownValues = [token, ...sensitiveValues];
    let code =
      body && typeof body.error === "string" && body.error.trim()
        ? body.error.trim()
        : null;
    if (!code) {
      if (status === 400) code = "INVALID_REQUEST";
      else if (status === 401) code = "UNAUTHORIZED";
      else if (status === 404)
        code =
          endpoint === "secrets" ? "APPLICATION_NOT_FOUND" : "IMAGE_NOT_FOUND";
      else if (status === 504) code = "SCAN_TIMEOUT";
      else if (status === 500) code = "INTERNAL_ERROR";
      else code = `ATLAS_HTTP_${status}`;
    }
    code = redact(code, knownValues);
    const fallback = `Atlas returned HTTP ${status}`;
    return {
      code,
      message:
        endpoint === "secrets"
          ? "Atlas secrets request failed"
          : safeMessage(body, knownValues, fallback),
    };
  }

  // Fetch and parse one JSON response, retrying one network error or server error.
  async function fetchJson(target, options, timeoutMs, sensitiveValues = []) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(target, {
          ...options,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (isTimeoutError(error)) {
          return {
            error: {
              code: "ATLAS_UNREACHABLE",
              message: "Atlas request timed out",
            },
          };
        }
        if (attempt === 0 && isNetworkError(error)) continue;
        return {
          error: { code: "ATLAS_UNREACHABLE", message: "Atlas is unreachable" },
        };
      }

      if (response.status >= 500 && attempt === 0) continue;

      let body;
      try {
        body = await response.json();
      } catch (error) {
        if (attempt === 0 && isNetworkError(error)) continue;
        return {
          error: {
            code: "ATLAS_BAD_RESPONSE",
            message: "Atlas returned invalid JSON",
          },
        };
      }
      return { response, body };
    }

    return {
      error: { code: "ATLAS_UNREACHABLE", message: "Atlas is unreachable" },
    };
  }

  // Build the common authenticated headers used by scan and secret endpoints.
  function authenticatedHeaders(includeJson = true) {
    const headers = { Authorization: `Bearer ${token}` };
    if (includeJson) headers["Content-Type"] = "application/json";
    return headers;
  }

  // Scan an image and return only a validated PASSED, BLOCKED, or ERROR verdict.
  async function scan(request) {
    const result = await fetchJson(
      `${baseUrl}/api/v1/scans`,
      {
        method: "POST",
        headers: authenticatedHeaders(),
        body: JSON.stringify({
          deployId: request.deployId,
          appName: request.appName,
          environment: request.environment,
          image: request.image,
          commitSha: request.commitSha,
          requestedBy: request.requestedBy ?? "core",
        }),
      },
      scanTimeoutMs,
    );

    if (result.error) {
      return {
        verdict: "ERROR",
        code: result.error.code,
        message: result.error.message,
      };
    }
    if (result.response.status !== 200) {
      const error = errorFromResponse(
        result.response.status,
        result.body,
        "scan",
      );
      return { verdict: "ERROR", code: error.code, message: error.message };
    }
    if (!isPlainObject(result.body)) {
      return {
        verdict: "ERROR",
        code: "ATLAS_BAD_RESPONSE",
        message: "Atlas returned an invalid scan response",
      };
    }
    if (typeof result.body.error === "string") {
      const error = errorFromResponse(200, result.body, "scan");
      return { verdict: "ERROR", code: error.code, message: error.message };
    }
    if (result.body.status !== "PASSED" && result.body.status !== "BLOCKED") {
      return {
        verdict: "ERROR",
        code: "ATLAS_BAD_RESPONSE",
        message: "Atlas returned an unknown scan status",
      };
    }
    if (result.body.deployId !== request.deployId) {
      return {
        verdict: "ERROR",
        code: "ATLAS_BAD_RESPONSE",
        message: "Atlas returned a mismatched deployId",
      };
    }

    if (result.body.status === "PASSED") {
      if (result.body.criticalCount !== 0) {
        return {
          verdict: "ERROR",
          code: "ATLAS_BAD_RESPONSE",
          message: "Atlas returned an invalid PASSED verdict",
        };
      }
      return { verdict: "PASSED" };
    }

    const countNames = [
      "criticalCount",
      "highCount",
      "mediumCount",
      "lowCount",
    ];
    if (
      !countNames.every(
        (name) => Number.isInteger(result.body[name]) && result.body[name] >= 0,
      )
    ) {
      return {
        verdict: "ERROR",
        code: "ATLAS_BAD_RESPONSE",
        message: "Atlas returned invalid vulnerability counts",
      };
    }
    return {
      verdict: "BLOCKED",
      counts: {
        criticalCount: result.body.criticalCount,
        highCount: result.body.highCount,
        mediumCount: result.body.mediumCount,
        lowCount: result.body.lowCount,
      },
      message: redact(
        typeof result.body.message === "string"
          ? result.body.message
          : "Deployment blocked by Atlas",
        [token],
      ),
    };
  }

  // Retrieve a flat map of secret strings for one encoded application name.
  async function getSecrets(appName) {
    const target = `${baseUrl}/api/v1/applications/${encodeURIComponent(appName)}/secrets`;
    const result = await fetchJson(
      target,
      { method: "GET", headers: authenticatedHeaders(false) },
      secretsTimeoutMs,
    );
    if (result.error)
      return {
        ok: false,
        code: result.error.code,
        message: result.error.message,
      };
    if (result.response.status !== 200) {
      const error = errorFromResponse(
        result.response.status,
        result.body,
        "secrets",
      );
      return { ok: false, code: error.code, message: error.message };
    }
    if (
      !isPlainObject(result.body) ||
      !Object.values(result.body).every((value) => typeof value === "string")
    ) {
      return {
        ok: false,
        code: "ATLAS_BAD_RESPONSE",
        message: "Atlas returned an invalid secrets response",
      };
    }
    return { ok: true, secrets: result.body };
  }

  // Store an application's secrets without logging or returning any secret values.
  async function putSecrets(appName, secrets) {
    const sensitiveValues = Object.values(secrets || {});
    const target = `${baseUrl}/api/v1/applications/${encodeURIComponent(appName)}/secrets`;
    const result = await fetchJson(
      target,
      {
        method: "PUT",
        headers: authenticatedHeaders(),
        body: JSON.stringify({ secrets }),
      },
      secretsTimeoutMs,
      sensitiveValues,
    );
    if (result.error) {
      return {
        ok: false,
        code: result.error.code,
        message: redact(result.error.message, sensitiveValues),
      };
    }
    if (result.response.status !== 200) {
      const error = errorFromResponse(
        result.response.status,
        result.body,
        "secrets",
        sensitiveValues,
      );
      return { ok: false, code: error.code, message: error.message };
    }
    if (
      !isPlainObject(result.body) ||
      result.body.appName !== appName ||
      result.body.status !== "SUCCESS" ||
      !Number.isInteger(result.body.secretCount) ||
      result.body.secretCount !== Object.keys(secrets || {}).length
    ) {
      return {
        ok: false,
        code: "ATLAS_BAD_RESPONSE",
        message: "Atlas returned an invalid secret write response",
      };
    }
    return { ok: true, secretCount: result.body.secretCount };
  }

  // Check Atlas availability without credentials for Core's public health endpoint.
  async function checkStatus() {
    try {
      const response = await fetchImpl(`${baseUrl}/atlas/status`, {
        method: "GET",
        signal: AbortSignal.timeout(healthTimeoutMs),
      });
      if (response.status !== 200) return false;
      const body = await response.json();
      return (
        isPlainObject(body) &&
        ["UP", "RUNNING"].includes(String(body.status).toUpperCase())
      );
    } catch {
      return false;
    }
  }

  return { scan, getSecrets, putSecrets, checkStatus };
}

module.exports = { createAtlasClient };
