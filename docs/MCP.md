# TeamFlow MCP Server

TeamFlow exposes a remote, OAuth-protected Model Context Protocol endpoint for approved external AI clients.

## Endpoint

Use the public HTTPS endpoint:

```text
https://teamflow.example.com/mcp
```

The following public discovery endpoints are served by the same host:

```text
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
```

The server uses stateless Streamable HTTP. It does not require an MCP session to be stored in TeamFlow.

## Configuration

Apply the Django migration before enabling the endpoint. It adds the nullable, unique `clerk_id` link used to bind a verified Clerk OAuth subject to an existing TeamFlow user.

Set these environment variables for the NestJS service:

```ini
MCP_ENABLED=true
MCP_CORS_ALLOWED_ORIGINS=https://approved-client.example
CLERK_SECRET_KEY=...
CLERK_PUBLISHABLE_KEY=...
```

`MCP_CORS_ALLOWED_ORIGINS` is only required for browser-originating clients. Non-browser MCP clients send no `Origin` header. Do not use a wildcard for this setting.

When `MCP_ENABLED` is not `true`, TeamFlow does not mount MCP routes. When it is enabled, both Clerk keys are required.

## Clerk setup

In Clerk, configure TeamFlow as an OAuth resource server for MCP clients:

1. Enable CIMD / pre-registered client support.
2. Enable only approved client metadata URLs; do not enable unrestricted dynamic registration.
3. Configure default scopes `openid profile email teamflow.read`.
4. Permit `teamflow.write` only for clients that require safe write tools.

The MCP middleware validates Clerk-issued OAuth tokens. TeamFlow then resolves the Clerk user ID to an active TeamFlow account in the current database. The first verified connection may link an existing matching email address; MCP never creates a user, organization, or privileged role.

## Tools and permissions

`teamflow.read` permits workspace, project, task, activity-feed, and private Pulse read tools. `teamflow.write` permits these non-destructive actions:

- Create or update projects and tasks.
- Add task comments.
- Update a private Pulse note.
- Add or remove items from the caller's private Pulse plan.

Existing TeamFlow role and tenant checks always apply. The MCP surface intentionally excludes project/task deletion, organization administration, agent runs, QA decisions, GitHub provisioning, and deployment actions.

Every MCP tool call is logged with the TeamFlow user ID, tool name, and result only; inputs and OAuth tokens are not logged.

## Deploying

`docker-compose.prod.yml` includes `backend_nest`, and nginx proxies `/mcp` plus the two discovery paths to that service. Ensure the public proxy terminates TLS and preserves the forwarded HTTPS host/protocol headers. Do not expose port 8001 directly in production.

For validation without starting containers:

```powershell
cd backend-nest
npx prisma generate
npm test
npm run lint
npm run build
```
