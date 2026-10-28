# Vajravyuha

Self-hostable backend deployment platform with security built in. (formerly Nexus)

## Layers

| Layer | What it does | Status |
|---|---|---|
| Core | Deployment engine: supervisor, proxy, container runner, API | In progress |
| Atlas | CVE gating and secrets vault | Planned |
| Heimdall | eBPF-based runtime anomaly detection | Planned |
| Shadow | Covert-channel detection | Planned |
| Platform | GitHub webhooks, canary deployments | Planned |

Atlas — Security Layer

Atlas provides container image vulnerability scanning and secure application secret management for Vajravyuha.

Prerequisites

- Java 21
- PostgreSQL
- Trivy vulnerability scanner

Configuration

Configure these environment variables before starting Atlas:

Variable| Purpose
"ATLAS_SERVICE_TOKEN"| Authenticates requests to Atlas
"ATLAS_DB_PASSWORD"| PostgreSQL database password
"ATLAS_ENCRYPTION_KEY"| Key used to encrypt and decrypt application secrets

Keep credentials and encryption keys private. Never commit their actual values to GitHub.

API Endpoints

Method| Endpoint| Purpose
POST| "/api/v1/scans"| Scan a container image for vulnerabilities
PUT| "/api/v1/applications/{appName}/secrets"| Store or update application secrets
GET| "/api/v1/applications/{appName}/secrets"| Retrieve stored application secrets

All three endpoints require a valid Bearer service token.