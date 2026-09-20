# TeamFlow Deployment Receiver

A lightweight HTTP service deployed on Railway that receives deployment and rollback webhook requests from TeamFlow, triggers and tracks builds via the Railway GraphQL API, and reports status and logs back to TeamFlow via signed callbacks.

The service is implemented using Python standard library components only (`http.server.ThreadingHTTPServer`, `urllib.request`, `hmac`, `hashlib`, `json`, `threading`, `logging`) with zero external runtime dependencies.

## What It Does

1. Listens for signed deployment webhooks at `POST /hooks/deploy`.
2. Verifies the request signature (`X-TeamFlow-Signature`) using HMAC-SHA256 and the shared `DEPLOY_HOOK_SECRET`.
3. Validates that the requested project and environment map to a configured Railway service and environment in `RAILWAY_SERVICE_MAP`.
4. Returns HTTP 202 Accepted immediately and launches a background job thread.
5. Interacts with the Railway GraphQL API:
   - For `deploy`: calls `serviceInstanceDeploy`, finds the newly created deployment, and tracks it until completion.
   - For `rollback`: locates the most recent successful deployment older than the current one, calls `deploymentRedeploy`, and tracks it until completion.
6. Collects build and runtime logs (up to 200 lines each, capped to the final 15,000 characters).
7. Sends a signed callback (`POST <callback_url>`) with final status (`success`, `failed`, or `rolled_back`), logs, and the deployed `commit_sha` (reported only if Railway confirms the commit hash via `meta`).

## Deploying on Railway

Deploy this service as its own independent Railway service:

1. In the Railway dashboard, create a new service from the repository.
2. Set the service **Root Directory** to `deploy-receiver`.
3. Railway automatically detects `railway.json` and builds via `Dockerfile`.
4. The service exposes health checks at `GET /healthz`.

Each generated application must also exist as its own Railway service connected to its GitHub repository and mapped in `RAILWAY_SERVICE_MAP`.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DEPLOY_HOOK_SECRET` | Yes | — | Shared secret with TeamFlow (minimum 32 characters). |
| `TEAMFLOW_CALLBACK_BASE_URL` | Yes | — | Base URL of TeamFlow (e.g. `https://teamflow.example.com`). Callbacks are strictly restricted to this scheme and host. |
| `RAILWAY_PROJECT_TOKEN` or `RAILWAY_API_TOKEN` | Yes (at least one) | — | Railway authentication token. `RAILWAY_PROJECT_TOKEN` is preferred. |
| `RAILWAY_SERVICE_MAP` | Yes | — | JSON object mapping project IDs and environments to Railway service and environment IDs. |
| `RAILWAY_API_URL` | No | `https://backboard.railway.com/graphql/v2` | Railway GraphQL API endpoint. |
| `DEPLOY_TIMEOUT_SECONDS` | No | `1200` | Maximum tracking duration before marking a deployment timed out. |
| `POLL_INTERVAL_SECONDS` | No | `10.0` | Polling interval in seconds when checking deployment status. |
| `PORT` | No | `8080` | Port on which the HTTP server listens (configured by Railway). |

### Example `RAILWAY_SERVICE_MAP`

```json
{
  "1": {
    "staging": {
      "service_id": "srv_staging_abc123",
      "environment_id": "env_staging_xyz789"
    },
    "production": {
      "service_id": "srv_prod_abc123",
      "environment_id": "env_prod_xyz789"
    }
  }
}
```

## TeamFlow Configuration

Configure the corresponding environment variables in TeamFlow:

- `DEPLOY_HOOK_URL_STAGING=https://<receiver-host>/hooks/deploy`
- `DEPLOY_HOOK_URL_PRODUCTION=https://<receiver-host>/hooks/deploy`
- `DEPLOY_HOOK_SECRET=<same secret, >= 32 characters>`
- `DEPLOY_CALLBACK_BASE_URL=https://<teamflow-host>`

## Known Limitations

- **In-flight jobs are lost on restart**: In-flight deployments are tracked in memory. If the receiver restarts while a deployment is running, the tracking job is lost, and the TeamFlow deployment record remains `in_progress` until manually updated or resolved by an operator.
- **No request timestamp / replay protection**: Webhook requests carry HMAC signatures over the payload but no timestamp or nonce. A valid signed request could technically be replayed after its initial job finishes.
- **Source commit alignment**: `serviceInstanceDeploy` triggers a build of the service's current source on Railway, which may be newer than the commit SHA requested in TeamFlow if pushes occurred in the interim. The receiver inspects `meta` on the Railway deployment and reports what Railway actually built, noting any mismatch in the logs.
