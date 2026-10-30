const path = require('node:path');
const { z } = require('zod');

// core/samples is the only directory Core will ever build from when no repository is given.
const CORE_ROOT = path.resolve(__dirname, '..', '..');
const SAMPLES_ROOT = path.join(CORE_ROOT, 'samples');

// Only credential-free GitHub HTTPS URLs are accepted for repository deployments.
const REPO_URL_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/;

// Branch names must be one safe argument and must not contain a ".." path segment.
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

// Check that a requested build context resolves inside core/samples.
function resolvesInsideSamples(contextDir) {
  const candidate = path.isAbsolute(contextDir)
    ? path.resolve(contextDir)
    : path.resolve(CORE_ROOT, contextDir);
  const relative = path.relative(SAMPLES_ROOT, candidate);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

// Validate a lower-case Docker-safe application name used by the deployment pipeline.
const appNameSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'appName must be a lower-case Docker-safe name');

// Validate a GitHub repository URL without credentials, query string or fragment.
const repoUrlSchema = z.string()
  .trim()
  .regex(
    REPO_URL_PATTERN,
    'repoUrl must be https://github.com/<owner>/<repo> without credentials, query or fragment'
  );

// Validate a git branch name that is safe to pass as a single argument.
const branchSchema = z.string()
  .trim()
  .regex(BRANCH_PATTERN, 'branch must match ^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$')
  .refine((value) => !value.includes('..'), { message: 'branch must not contain ".."' });

// Validate a non-blank Git commit SHA when the caller supplies one directly.
const commitShaSchema = z.string()
  .trim()
  .regex(/^[a-fA-F0-9]{7,64}$/, 'commitSha must be a non-blank Git commit SHA');

// Validate a build context that stays inside core/samples.
const contextDirSchema = z.string()
  .trim()
  .min(1)
  .max(512)
  .refine(resolvesInsideSamples, { message: 'contextDir must resolve inside core/samples' });

// Validate and normalize the public deployment request without accepting extra fields.
const deployRequestSchema = z.object({
  appName: appNameSchema,
  environment: z.string().trim().min(1).max(64),
  commitSha: commitShaSchema.optional(),
  repoUrl: repoUrlSchema.optional(),
  branch: branchSchema.default('main'),
  requestedBy: z.string().min(1).max(128).refine(
    (value) => value.trim().length > 0,
    { message: 'requestedBy must not be blank' }
  ).default('core'),
  envVars: z.record(z.string(), z.string()).optional().default({}),
  contextDir: contextDirSchema.optional(),
  useSecrets: z.boolean().default(false)
}).strict().superRefine((value, issues) => {
  // A repository and a local sample directory are mutually exclusive sources.
  if (value.repoUrl !== undefined && value.contextDir !== undefined) {
    issues.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['contextDir'],
      message: 'contextDir and repoUrl cannot be combined'
    });
    return;
  }
  // Core reads the real SHA from the clone, so it is only optional for repository deployments.
  if (value.repoUrl === undefined && value.commitSha === undefined) {
    issues.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['commitSha'],
      message: 'commitSha is required unless repoUrl is given'
    });
  }
}).transform((value) => ({
  ...value,
  contextDir: value.contextDir || 'samples/hello-app'
}));

// Validate the optional limit of the deployment list endpoint.
const deploymentListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

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
    repoUrl: row.repoUrl,
    branch: row.branch,
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

// Return the compact row shape used by the deployment list endpoint.
function toDeploymentSummary(row) {
  return {
    id: row.id,
    appName: row.appName,
    environment: row.environment,
    status: row.status,
    repoUrl: row.repoUrl,
    branch: row.branch,
    commitSha: row.commitSha,
    port: row.port,
    criticalCount: row.criticalCount,
    highCount: row.highCount,
    mediumCount: row.mediumCount,
    lowCount: row.lowCount,
    restartCount: row.restartCount,
    reason: row.reason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

module.exports = {
  appNameSchema,
  repoUrlSchema,
  branchSchema,
  deployRequestSchema,
  deploymentListQuerySchema,
  secretsRequestSchema,
  resolvesInsideSamples,
  toDeploymentResponse,
  toDeploymentSummary
};
