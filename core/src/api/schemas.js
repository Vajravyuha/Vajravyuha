const { z } = require('zod');

// Validate a lower-case Docker-safe application name used by the deployment pipeline.
const appNameSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'appName must be a lower-case Docker-safe name');

// Validate and normalize the public deployment request without accepting extra fields.
const deployRequestSchema = z.object({
  appName: appNameSchema,
  environment: z.string().trim().min(1).max(64),
  commitSha: z.string()
    .trim()
    .regex(/^[a-fA-F0-9]{7,64}$/, 'commitSha must be a non-blank Git commit SHA'),
  requestedBy: z.string().min(1).max(128).refine(
    (value) => value.trim().length > 0,
    { message: 'requestedBy must not be blank' }
  ).default('core'),
  envVars: z.record(z.string(), z.string()).optional().default({}),
  contextDir: z.string().trim().min(1).default('samples/hello-app'),
  useSecrets: z.boolean().default(false)
}).strict();

// Validate the secret-management request and enforce the Atlas contract's key limit.
const secretsRequestSchema = z.object({
  secrets: z.record(z.string().min(1), z.string()).refine(
    (secrets) => Object.keys(secrets).length <= 50,
    { message: 'At most 50 secrets may be supplied' }
  )
}).strict();

// Return only deployment fields that are safe and useful to API clients.
function toDeploymentResponse(row) {
  return {
    id: row.id,
    appName: row.appName,
    environment: row.environment,
    commitSha: row.commitSha,
    requestedBy: row.requestedBy,
    status: row.status,
    image: row.image,
    port: row.port,
    reason: row.reason,
    criticalCount: row.criticalCount,
    highCount: row.highCount,
    mediumCount: row.mediumCount,
    lowCount: row.lowCount,
    restartCount: row.restartCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

module.exports = {
  appNameSchema,
  deployRequestSchema,
  secretsRequestSchema,
  toDeploymentResponse
};
