# Nexus deployment console

A dark, responsive React console for submitting GitHub repositories to Core and following their build, Atlas scan, and runtime status.

## Local setup

```sh
cd frontend
npm install
cp .env.example .env
npm run dev
```

Set `VITE_CORE_URL`, `VITE_CORE_API_KEY`, and `VITE_PROXY_URL` in `.env` for a connected Core/proxy instance. The API key is visible in browser code and is acceptable for a local demo only; do not use a privileged key in a public deployment.

### Try the console without Core

Set `VITE_USE_MOCK=true` in `.env`, then restart `npm run dev`. The persistent MOCK badge identifies simulated results. Submit a repository URL containing `vulnerable` to see a blocked scan, `missing` to see a failed clone, or any other valid repository URL to watch a deployment progress to RUNNING. Mock records are held in memory and reset when the page reloads.

## Notes

The browser calls Core directly. Configure Core CORS for the Vite origin when using a separate local service. The Open app link points to `VITE_PROXY_URL`.
