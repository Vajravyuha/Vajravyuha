const CORE_URL = (
  import.meta.env.VITE_CORE_URL || "http://localhost:8090"
).replace(/\/+$/, "");
const API_KEY = import.meta.env.VITE_CORE_API_KEY || "";
console.log("CORE_URL:", CORE_URL);
console.log("API_KEY configured:", Boolean(API_KEY));
async function request(
  path,
  { signal, method = "GET", body, health = false } = {},
) {
  let response;
  try {
    response = await fetch(`${CORE_URL}${path}`, {
      method,
      signal,
      headers: {
        ...(health ? {} : { "X-API-Key": API_KEY }),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(`Core unreachable at ${CORE_URL}.`);
  }
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!response.ok) {
    const msg =
      response.status === 401
        ? "Core rejected the API key"
        : data?.message ||
          data?.error ||
          `Request failed with status ${response.status}`;
    const error = new Error(`${msg} (HTTP ${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export const coreClient = {
  health: (signal) => request("/health", { signal, health: true }),
  listDeployments: (signal) => request("/deployments?limit=20", { signal }),
  getDeployment: (id, signal) =>
    request(`/deployments/${encodeURIComponent(id)}`, { signal }),
  createDeployment: (payload, signal) =>
    request("/deployments", { method: "POST", body: payload, signal }),
  stopDeployment: (id, signal) =>
    request(`/deployments/${encodeURIComponent(id)}/stop`, {
      method: "POST",
      signal,
    }),
  getLogs: async (id, signal) => {
    const result = await request(
      `/deployments/${encodeURIComponent(id)}/logs`,
      { signal },
    );
    if (Array.isArray(result)) return result.map(String);
    if (typeof result === "string") return result.split(/\r?\n/);
    if (
      typeof result?.message === "string" &&
      result.lines == null &&
      result.logs == null
    )
      return result.message.split(/\r?\n/);
    const lines = result?.lines ?? result?.logs ?? [];
    if (Array.isArray(lines)) return lines.map(String);
    const text = String(lines || "");
    return text ? text.split(/\r?\n/) : [];
  },
};
export { CORE_URL };
