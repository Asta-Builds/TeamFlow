#!/usr/bin/env python3
"""
Pre-production smoke test for a running TeamFlow stack.

Exercises the public entry point (nginx) end to end: routing, sign-up, session
rotation and revocation, tenant isolation, and the capabilities that must refuse
to simulate work when their provider is not configured.

Usage:
    python scripts/smoke_preprod.py --base-url http://localhost:18080

Only the Python standard library is used. The script creates two throwaway
workspaces with random e-mail addresses; it does not delete them.
"""

from __future__ import annotations

import argparse
import json
import secrets
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Optional


class Client:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def request(
        self,
        method: str,
        path: str,
        body: Optional[dict] = None,
        token: Optional[str] = None,
        headers: Optional[dict] = None,
    ) -> tuple[int, Any, dict]:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{self.base_url}{path}", data=data, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("Origin", self.base_url)
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        for key, value in (headers or {}).items():
            req.add_header(key, value)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode()
                return resp.status, _json(raw), dict(resp.headers)
        except urllib.error.HTTPError as err:
            raw = err.read().decode()
            return err.code, _json(raw), dict(err.headers)


def _json(raw: str) -> Any:
    try:
        return json.loads(raw) if raw else None
    except json.JSONDecodeError:
        return raw


RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: Any = "") -> bool:
    RESULTS.append((name, ok, "" if ok else str(detail)[:300]))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f" -> {str(detail)[:300]}"))
    return ok


def wait_until_ready(client: Client, timeout: int) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            status, body, _ = client.request("GET", "/api/health")
            if status == 200 and isinstance(body, dict) and body.get("status") == "ok":
                return
        except Exception:
            pass
        time.sleep(3)
    raise SystemExit("Stack did not become ready in time")


def register(client: Client, label: str) -> dict:
    email = f"smoke-{label}-{secrets.token_hex(4)}@example.com"
    password = secrets.token_urlsafe(18)
    status, body, _ = client.request(
        "POST",
        "/api/auth/register/",
        {"email": email, "password": password, "name": f"Smoke {label}", "organization_name": f"Smoke {label}"},
    )
    check(f"register workspace {label}", status in (200, 201) and "access" in (body or {}), body)
    return {"email": email, "password": password, **(body or {})}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:18080")
    parser.add_argument("--wait", type=int, default=240)
    args = parser.parse_args()
    client = Client(args.base_url)

    wait_until_ready(client, args.wait)

    # --- Routing -----------------------------------------------------------------
    status, _, headers = client.request("GET", "/")
    check("web app served through nginx", status == 200, status)
    check("proxy hides server version", "nginx/" not in headers.get("Server", ""), headers.get("Server"))
    status, body, _ = client.request("GET", "/api/health")
    check("NestJS health reports ok", status == 200 and isinstance(body, dict) and body.get("status") == "ok", body)
    status, _, _ = client.request("GET", "/api/docs")
    check("API docs are not public in production", status == 404, status)
    status, _, _ = client.request("GET", "/static/admin/css/base.css")
    check("Django static files served", status == 200, status)
    status, _, _ = client.request("GET", "/admin/login/")
    check("Django admin reachable", status == 200, status)

    # --- Sign-up and sessions ------------------------------------------------------
    alice = register(client, "alice")
    bob = register(client, "bob")

    status, me, _ = client.request("GET", "/api/auth/me", token=alice["access"])
    check("authenticated profile", status == 200 and me.get("email") == alice["email"], me)

    status, rotated, _ = client.request("POST", "/api/auth/refresh/", {"refresh": alice["refresh"]})
    check("refresh rotates the session", status == 200 and rotated.get("refresh") != alice["refresh"], rotated)
    status, _, _ = client.request("POST", "/api/auth/refresh/", {"refresh": alice["refresh"]})
    check("reused refresh token is rejected", status == 401, status)
    status, _, _ = client.request("GET", "/api/auth/me", token=rotated.get("access"))
    check("token reuse ends every session", status == 401, status)

    status, fresh, _ = client.request("POST", "/api/auth/login/", {"email": alice["email"], "password": alice["password"]})
    check("login after reuse detection", status == 200, fresh)
    alice.update(fresh or {})

    status, _, _ = client.request("POST", "/api/auth/clerk/", {"email": bob["email"], "clerk_id": "user_spoofed"})
    check("Clerk exchange requires a verified session token", status == 401, status)

    # --- Workspace data and isolation -------------------------------------------------
    status, project, _ = client.request("POST", "/api/projects/", {"name": "Smoke project"}, token=alice["access"])
    check("create project", status in (200, 201) and project.get("id"), project)
    project_id = (project or {}).get("id")

    status, task, _ = client.request("POST", "/api/tasks/", {"project": project_id, "title": "Smoke task"}, token=alice["access"])
    check("create task", status in (200, 201) and task.get("id"), task)
    task_id = (task or {}).get("id")

    status, _, _ = client.request("POST", f"/api/tasks/{task_id}/comments/", {"body": "hello"}, token=alice["access"])
    check("comment on task", status in (200, 201), status)

    status, _, _ = client.request("GET", f"/api/projects/{project_id}/", token=bob["access"])
    check("other workspace cannot read the project", status in (403, 404), status)
    status, _, _ = client.request("GET", f"/api/tasks/{task_id}/", token=bob["access"])
    check("other workspace cannot read the task", status in (403, 404), status)

    status, orgs, _ = client.request("GET", "/api/organizations/", token=bob["access"])
    check("workspace list shows only the caller's workspace", status == 200 and len(orgs) == 1, orgs)
    alice_org = (me or {}).get("organization")
    status, _, _ = client.request("POST", f"/api/organizations/switch/{alice_org}/", token=bob["access"])
    check("cannot switch into another workspace", status == 403, status)

    status, _, _ = client.request("POST", "/api/organizations/invite/", {"email": alice["email"], "role": "backend"}, token=bob["access"])
    check("people cannot be given AI agent roles", status == 400, status)
    status, invite, _ = client.request("POST", "/api/organizations/invite/", {"email": alice["email"], "role": "member"}, token=bob["access"])
    check("inviting another workspace's member creates a pending invitation", status == 201 and invite.get("membership_status") == "invited", invite)
    status, me_after, _ = client.request("GET", "/api/auth/me", token=alice["access"])
    check("an invitation does not move anyone", status == 200 and me_after.get("organization") == alice_org, me_after)
    status, orgs, _ = client.request("GET", "/api/organizations/", token=alice["access"])
    pending = [org for org in (orgs or []) if org.get("membership_status") == "invited"]
    check("the invitation is listed for the invitee", status == 200 and len(pending) == 1, orgs)
    bob_org = pending[0]["id"] if pending else None
    status, _, _ = client.request("POST", f"/api/organizations/{bob_org}/leave/", token=alice["access"])
    check("the invitee can decline", status == 200, status)
    status, orgs, _ = client.request("GET", "/api/organizations/", token=alice["access"])
    check("a declined invitation is gone", status == 200 and len(orgs) == 1, orgs)

    status, _, _ = client.request("POST", "/api/notifications/read_all/", token=alice["access"])
    check("notifications read-all route", status in (200, 201), status)

    # --- Capabilities without providers must not simulate work ----------------------
    status, body, _ = client.request("POST", "/api/deployments/", {"project": project_id, "environment": "staging"}, token=alice["access"])
    _, deployments, _ = client.request("GET", "/api/deployments/", token=alice["access"])
    if status == 503:
        check("deployment without a provider returns 503", True)
        check("no deployment was recorded", deployments == [], deployments)
    else:
        # A staging deploy hook is configured: the request is handed over, never marked successful here.
        recorded = deployments[0] if isinstance(deployments, list) and deployments else {}
        check("deployment is handed to the provider (202) or refused by it (502)", status in (202, 502), body)
        recorded_status = recorded.get("status")
        if status == 502:
            reflects_provider = recorded_status == "failed"
        elif recorded_status == "in_progress":
            reflects_provider = True
        else:
            # The provider may already have called back; a final status must come from that callback.
            reflects_provider = f"Provider reported status '{recorded_status}'" in (recorded.get("logs") or "")
        check("recorded deployment reflects the provider response", reflects_provider, recorded)

    status, body, _ = client.request("POST", "/api/seo/audits/", {"url": "http://169.254.169.254/latest/meta-data/"}, token=alice["access"])
    check("SEO audit refuses internal targets", status == 400, body)

    status, body, _ = client.request("POST", "/api/billing/mock-confirm/", {"tier": "enterprise"}, token=alice["access"])
    check("mock billing is disabled", status == 503, body)

    status, body, _ = client.request(
        "POST",
        f"/api/projects/{project_id}/devops_create_repo/",
        {"repo_name": "smoke"},
        token=alice["access"],
    )
    check("repository provisioning without GitHub returns 503", status == 503, body)

    status, body, _ = client.request("GET", "/api/integrations/github/", token=alice["access"])
    check("integrations are served through the bridge", status == 200 and "github_token_configured" in (body or {}), body)
    check("operator GitHub token is not exposed", not (body or {}).get("github_token_preview"), body)

    status, body, _ = client.request("GET", "/api/agents/status/", token=alice["access"])
    check("agent runtime status is reachable", status in (200, 503), body)

    # --- Public webhooks are signed ----------------------------------------------------
    status, _, _ = client.request("POST", "/api/deployments/1/provider_callback/", {"status": "success"})
    check("unsigned deployment callback is rejected", status == 401, status)
    status, _, _ = client.request("POST", "/api/billing/webhook/", {"type": "checkout.session.completed"})
    check("unsigned Stripe webhook is rejected", status == 400, status)

    # --- Logout revokes the session ---------------------------------------------------------
    status, _, _ = client.request("POST", "/api/auth/logout/", {"refresh": alice["refresh"]}, token=alice["access"])
    check("logout", status == 200, status)
    status, _, _ = client.request("GET", "/api/auth/me", token=alice["access"])
    check("access token stops working after logout", status == 401, status)
    status, _, _ = client.request("POST", "/api/auth/refresh/", {"refresh": alice["refresh"]})
    check("refresh token stops working after logout", status == 401, status)

    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
