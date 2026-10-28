# Vajravyuha

Self-hostable backend deployment platform with security built in (formerly Nexus).

## Layers

| Layer | What it does | Status |
|---|---|---|
| Core | Deployment engine: supervisor, proxy, container runner, API | In progress |
| Atlas | CVE gating and secrets vault | In progress |
| Heimdall | eBPF-based runtime anomaly detection | Planned |
| Shadow | Covert-channel detection | Planned |
| Platform | GitHub webhooks, canary deployments | Planned |

## Atlas — Security Layer

Atlas provides container image vulnerability scanning and secure application secret management for Vajravyuha.

### Prerequisites

- Java 21
- PostgreSQL
- Trivy vulnerability scanner

### Configuration

Configure the following environment variables before starting Atlas.

| Variable | Purpose |
|---|---|
| `ATLAS_SERVICE_TOKEN` | Authenticates requests to Atlas |
| `ATLAS_DB_PASSWORD` | PostgreSQL database password |
| `ATLAS_ENCRYPTION_KEY` | Key used to encrypt and decrypt application secrets |

**Security:** Keep credentials and encryption keys private. Never commit their actual values to GitHub. The encryption key must remain stable because stored secrets depend on it for decryption.

### API Endpoints

All endpoints require a valid Bearer service token.

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/v1/scans` | Scan a container image for vulnerabilities |
| `PUT` | `/api/v1/applications/{appName}/secrets` | Store or update application secrets |
| `GET` | `/api/v1/applications/{appName}/secrets` | Retrieve stored application secrets |

Refer to [`openapi.yaml`](openapi.yaml) for request schemas, response formats, and error details.

### Running Atlas Locally

1. Install the prerequisites listed above.
2. Start PostgreSQL and create/configure the Atlas database.
3. Set the required environment variables.
4. Ensure the Trivy executable path is configured for your environment.
5. From the project root, run:

   ```powershell
   .\mvnw.cmd spring-boot:run
   ```

### Running Tests

From the project root, run:

```powershell
.\mvnw.cmd clean test
```