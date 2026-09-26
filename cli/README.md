# TeamFlow CLI

`teamflow` runs TeamFlow from the terminal. It talks to the same API gateway as the web app, so the same accounts, roles and workspaces apply.

With it you can:

- create projects and tickets,
- put the agent swarm on a ticket and watch the agents work live,
- approve or reject the release they produce,
- follow and roll back deployments.

Run `teamflow` on its own for an interactive prompt with slash commands. Run `teamflow <command>` for one-shot commands in scripts.

## Install

It needs Python 3.10 or newer. From the repository root:

```bash
uv tool install ./cli        # or: pipx install ./cli
```

For development, install it in editable mode instead:

```bash
cd cli
uv venv && uv pip install -e .
```

## Interactive mode

```console
$ teamflow
╭─────────────────────────────────────────────────────────────────────────────────╮
│                                                                                 │
│  TeamFlow 0.1.0                                                                 │
│                                                                                 │
│  Ada Founder (ceo) in Acme Labs                                                 │
│  https://teamflow.example.com                                                   │
│                                                                                 │
│  Type / to see the commands. Pick a ticket with /task <id>, then write to       │
│  comment on it; @mention an agent (like @backend or @all) to put it to work.    │
│                                                                                 │
╰─────────────────────────────────────────────────────────────────────────────────╯
> /project 12
> /task 57
> @backend add rate limiting to the reset endpoint
Commented on task #57.
Queued the swarm chain on task #57 (session chain-task-57-9b1e4c7d2a).
[14:02:11] TeamFlow: The sequential swarm run is queued and waiting for an agent worker.
[14:02:15] Marcus Aurelius (AI): Committed 2 files on feature/57-rate-limit
[14:03:06] Joan of Arc (AI): blocked: The release is waiting for approval by a workspace owner or admin.
  Approve with: /approve 8  (or reject: /reject 8 <reason>)
> /approve 8
```

- **Commands.** Type `/` and a menu lists every command with what it does. Keep typing to narrow it, and pick with Tab or the arrow keys. The up arrow recalls earlier lines, including ones from past sessions.
- **Status bar.** The bar under the prompt shows your account, the selected project and ticket, and the server.
- **Selection.** `/project` and `/task` select what later commands apply to, and `/new` selects the ticket it creates.
- **Plain text.** Text without a `/` is posted on the selected ticket as a comment, like in the web app's comment box. If it mentions an agent (`@pm`, `@tech_lead`, `@backend`, `@frontend`, `@qa`, `@devops`, `@designer`, `@seo` or `@all`), the swarm chain also starts, with your text as its instruction, and its events stream into the prompt.
- **Stopping.** Ctrl+C stops a running command. At the prompt, press it twice, or use `/exit` or Ctrl+D, to leave.

| Command | What it does |
|---|---|
| `/login [url]`, `/logout`, `/whoami` | Manage your session. |
| `/projects`, `/project [id]` | List projects, or select one. |
| `/tasks [status]`, `/task [id]` | List the selected project's tickets, or select one. |
| `/new <title>` | Create a ticket in the selected project and select it. |
| `/move [#id] <status>`, `/comment <text>` | Update the ticket. |
| `/run [#id] [instruction]` | Put the swarm on the ticket and follow it. With an instruction, it runs the swarm chain. |
| `/watch [#id \| session]` | Follow agent activity: one run, a ticket, the project, or the whole workspace. |
| `/traces`, `/status` | Recent runs, and the agent runtime's health. |
| `/approvals [status]`, `/approve <id> [note]`, `/reject <id> <reason>` | The release gate. |
| `/deployments`, `/deploy [env]`, `/rollback <id>` | The selected project's deployments. |
| `/help [command]`, `/clear`, `/exit` | Help, clear the screen, leave. |

List commands also take the options of their one-shot command, as in `/tasks --priority urgent`. `/help tasks` lists them.

The prompt needs a real console. In Git Bash, run `winpty teamflow`. When standard input is not a terminal, `teamflow` reads slash commands from it one line at a time, so `teamflow < script.txt` runs a script.

## Log in

```bash
teamflow login https://teamflow.example.com      # or /login https://teamflow.example.com in the prompt
```

The CLI asks for your email and password, the same ones you use on the web. The server you log in to becomes the default for later commands. Without a URL, `login` uses `--url`, then `TEAMFLOW_URL`, then the last server, then `http://localhost:8001` (the NestJS API of the local Docker stack).

In a script, pass the password on standard input:

```bash
echo "$TEAMFLOW_PASSWORD" | teamflow login https://teamflow.example.com -e ceo@example.com --password-stdin
```

`teamflow whoami` shows the account and workspace in use. `teamflow logout` ends the session on the server too.

Only email and password accounts can log in for now. Workspaces that sign in only through Clerk or Keycloak SSO are not supported yet.

## One-shot commands

```console
$ teamflow projects list
$ teamflow tasks create "Add password reset" -p 12 --priority high
Created task #57 in Storefront: Add password reset
$ teamflow agents run 57
Queued the agent swarm on task #57 (session graph-task-57-3f9c2a1b7e).
Following the run. Ctrl+C stops watching, not the run.
[14:02:11] TeamFlow: The autonomous graph run is queued and waiting for an agent worker.
[14:02:15] Sarah Jenkins (AI) -> backend_core: Backend plan ready
[14:02:40] Marcus Aurelius (AI): Committed 3 files on feature/57-password-reset
[14:03:05] Alan Turing (AI): Validation contract 5/5 passed
[14:03:06] Joan of Arc (AI): blocked: The release is waiting for approval by a workspace owner or admin.
  Approve with: teamflow approvals approve 8  (or reject: teamflow approvals reject 8 --reason ...)
Run finished (2m 55s, 48,211 tokens). The release now waits for a workspace owner or admin.
  Approve: teamflow approvals approve 8
  Reject:  teamflow approvals reject 8 --reason ...
Ticket        #57 Add password reset  qa
Pull request  https://github.com/acme/shop/pull/42
$ teamflow approvals approve 8
```

`agents run` follows the run until it ends. Ctrl+C stops watching, but the run keeps going on the server. `teamflow agents watch --session <id>` picks it up again. Use `--no-watch` to queue a run and return at once. Use `--chain -m "instruction"` to run the sequential swarm chain with an instruction instead of the planning graph.

| Command | What it does |
|---|---|
| `login`, `logout`, `whoami` | Manage your session. |
| `projects list / show / create` | Projects and where their tickets stand. |
| `tasks list / show / create / move / update / comment` | Tickets on the board. `show` includes the validation contract. |
| `agents run TASK` | Queue the swarm on a ticket and follow it. |
| `agents watch` | Follow agent events: `--session` for one run, `--task`, `--project`, or the whole workspace. |
| `agents status` | Model, worker, and event-bus health, plus the agent seats. |
| `agents traces` | Recent runs, with their sessions. |
| `approvals list / show / approve / reject` | The release gate. `approve` asks for confirmation unless you pass `--yes`. |
| `deployments list / show / create / rollback` | Deployments. Production deploys and rollbacks ask for confirmation. |

Every command has `--help`. Read commands take `--json` to print the raw API response, for use with `jq` and scripts.

Exit codes: `0` on success, `1` on an error, a failed or rejected run, or a release that was not merged, `2` on a usage error, and `130` when you stop watching a run with Ctrl+C. A script run through the prompt exits with `1` if any of its commands failed.

## Where the session is stored

Tokens live in `hosts.json` in the user config directory: `%APPDATA%\teamflow` on Windows, `~/Library/Application Support/teamflow` on macOS, `~/.config/teamflow` on Linux. On macOS and Linux only your user can read the file. The prompt's history is kept next to it, in `history`. Set `TEAMFLOW_CONFIG_DIR` to use another directory.

The API accepts each refresh token only once. If a token is used twice, the API signs the account out everywhere, including the browser. The CLI refreshes under a file lock, so several `teamflow` processes can run at the same time safely.

## Tests

```bash
cd cli
.venv/Scripts/python -m unittest discover -s tests -t .     # Windows
.venv/bin/python -m unittest discover -s tests -t .         # macOS and Linux
```

The tests replace the network with `httpx.MockTransport` and need no running server.
