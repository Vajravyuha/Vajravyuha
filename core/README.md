# Vajravyuha Core

Vajravyuha Core is a small Node.js deployment engine. It builds a Docker image, asks Atlas to scan that image, starts a hardened container only after a `PASSED` verdict, checks `/health`, supervises restarts, and proxies traffic to the latest healthy deployment.

Core requires Node.js 20 or newer, a running Docker daemon, and an Atlas-compatible HTTP service. The local fake Atlas runs on port 9000 and uses the local-only demo token `local-atlas-token`.

## Install and configure

Run these commands from the repository's `core/` directory:

```sh
npm install
cp .env.example .env
sed -i 's/^ATLAS_SERVICE_TOKEN=.*/ATLAS_SERVICE_TOKEN=local-atlas-token/' .env
sed -i 's/^CORE_API_KEY=.*/CORE_API_KEY=local-core-api-key/' .env
```

The values above are for local testing only. Replace them with separately managed credentials before using a real Atlas service. Never commit `.env`.

## Run locally

Use separate terminals, both from `core/`:

```sh
npm run fake-atlas
```

```sh
npm start
```

Run the test suite without Docker or an Atlas network call:

```sh
npm test
```

The API listens on port 8080 and the application proxy listens on port 3000. `/health` is public; every other Core route requires `X-API-Key`. If `ALLOWED_APPS` is non-empty, only listed app names can be deployed. The proxy serves the newest deployment whose status is `RUNNING`; requests wait up to 30 seconds while it is unhealthy.

## Create and poll a deployment

Use a real, non-blank Git commit SHA in `commitSha`. The following sample uses a commit already present in the supplied repository history:

```sh
DEPLOY_ID=$(curl -sS -X POST http://localhost:8080/deployments \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: local-core-api-key' \
  -d '{"appName":"hello-app","environment":"development","commitSha":"77dd994b839ec47e5e572de5fca1e16291a88caa","contextDir":"samples/hello-app","envVars":{"GREETING":"hello"}}' \
  | node -e "let body='';process.stdin.on('data',chunk=>body+=chunk).on('end',()=>process.stdout.write(JSON.parse(body).id))")
```

```sh
curl -sS -H 'X-API-Key: local-core-api-key' "http://localhost:8080/deployments/${DEPLOY_ID}"
```

When the deployment is `RUNNING`, visit `http://localhost:3000/`. Use `GET /deployments/{id}/logs` to fetch up to 100 redacted lines.

## Optional Atlas-managed secrets

The Core route `PUT /applications/{appName}/secrets` forwards up to 50 string secrets to Atlas and returns only the app name and secret count. Deploy with `"useSecrets": true` to fetch that app's secrets after a passed scan and pass them to its container. Atlas must implement the proposed secrets endpoints described in `docs/contracts/atlas.md`; until then such a deployment fails closed. Core does not store secret values in SQLite or include them in deployment API responses.

## Registry mode

Set `REGISTRY_ENABLED=true`, `REGISTRY_PUSH_HOST` and `REGISTRY_PULL_HOST` to the reachable registry hostnames. The local Docker daemon must be able to push to the push host, and Atlas must be able to pull from the pull host. Core scans a digest-pinned registry reference and runs the locally recorded immutable image ID.

## Notes

- SQLite is stored at `DB_PATH` (default `core.db`, relative to the working directory).
- Container ports bind only to `127.0.0.1`; the public proxy is the only intended entry point.
- The sample app listens on container port 3000 and has a JSON `/health` endpoint.
- Core never writes request `envVars` or Atlas secrets to SQLite.
