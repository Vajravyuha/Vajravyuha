# Atlas HTTP contract used by Vajravyuha Core

Core calls Atlas over HTTP only. The scan endpoint below is the agreed contract. The secrets endpoints are **proposed, pending Atlas OpenAPI** and are not assumed to exist in the Java service yet.

## Scan request

Endpoint: `POST {ATLAS_URL}/api/v1/scans`

Headers: `Authorization: Bearer {ATLAS_SERVICE_TOKEN}`, `Content-Type: application/json`

Request:

```json
{
  "deployId": "dep_8f3a21",
  "appName": "payment-gateway",
  "environment": "production",
  "image": "registry.local/payment-gateway:v1.0@sha256:9f86d0...",
  "commitSha": "a1b2c3d",
  "requestedBy": "core"
}
```

Core requires a non-blank Git commit SHA and does not default it. `requestedBy` is optional on Core requests, defaults to `core`, is stored with the deployment, and is sent to Atlas as supplied. Atlas accepts any image reference.

## Scan success response (HTTP 200)

```json
{
  "deployId": "dep_8f3a21",
  "appName": "payment-gateway",
  "environment": "production",
  "status": "BLOCKED",
  "criticalCount": 1,
  "highCount": 2,
  "mediumCount": 3,
  "lowCount": 5,
  "message": "Deployment blocked due to critical vulnerabilities"
}
```

`status` is either `PASSED` or `BLOCKED`. Core accepts `PASSED` only when the HTTP status is 200, the response `deployId` matches the request, and `criticalCount` is exactly zero. `BLOCKED` responses must also match the request `deployId` and contain non-negative integer vulnerability counts.

## Scan error response

```json
{
  "error": "IMAGE_NOT_FOUND",
  "message": "Could not retrieve the requested container image",
  "deployId": "dep_8f3a21"
}
```

Error codes: `INVALID_REQUEST`, `UNAUTHORIZED`, `IMAGE_NOT_FOUND`, `IMAGE_UNSCANNABLE`, `SCAN_TIMEOUT`, `INTERNAL_ERROR`.

HTTP mapping: 400 invalid request, 401 bad/missing token, 404 not found (image or application, depending on endpoint), 504 scan timeout, 500 internal. Any other status is an error and Core fails closed. Unknown error codes are preserved in the deployment reason. Error response `deployId` may be `null`; Core checks deploy ID matching only on successful scan responses.

`GET {ATLAS_URL}/atlas/status` needs no token and is used for Core's `/health`. Atlas waits up to about 130 seconds for Trivy, so Core gives scan requests a 150-second timeout and retries once only for a network error or HTTP 5xx response (never for 4xx).

## Proposed application secrets endpoints (proposed, pending Atlas OpenAPI)

Both endpoints require `Authorization: Bearer {ATLAS_SERVICE_TOKEN}`. Core URL-encodes `appName` with `encodeURIComponent`.

### Store secrets

`PUT {ATLAS_URL}/api/v1/applications/{appName}/secrets`

Request:

```json
{
  "secrets": {
    "DATABASE_PASSWORD": "x",
    "JWT_SECRET": "y"
  }
}
```

HTTP 200:

```json
{
  "appName": "payment-gateway",
  "status": "SUCCESS",
  "message": "Secrets saved",
  "secretCount": 2
}
```

### Retrieve secrets

`GET {ATLAS_URL}/api/v1/applications/{appName}/secrets`

HTTP 200 is a flat map of secret names to string values:

```json
{
  "DATABASE_PASSWORD": "x",
  "JWT_SECRET": "y"
}
```

Error response (the `deployId` may be `null`):

```json
{
  "error": "APPLICATION_NOT_FOUND",
  "message": "Application not found",
  "deployId": null
}
```

Core treats a successful secrets response as valid only when the HTTP status is 200 and its body is a plain object whose values are all strings. Secret endpoint requests use a 10-second timeout and retry once only on a network error or HTTP 5xx response. Core never logs a secrets request body, secret value, or Atlas token.
