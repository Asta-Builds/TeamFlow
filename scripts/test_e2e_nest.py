import time
import json
import urllib.request
import urllib.error
import sys

BASE_URL = "http://localhost:8001/api"
FRONTEND_URL = "http://localhost:3000"

def request(url, method="GET", data=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            resp_body = response.read().decode("utf-8")
            return response.status, json.loads(resp_body) if resp_body else {}
    except urllib.error.HTTPError as e:
        resp_body = e.read().decode("utf-8")
        try:
            parsed = json.loads(resp_body)
        except Exception:
            parsed = {"raw": resp_body}
        return e.code, parsed

def run_suite():
    print("==================================================")
    print(" TeamFlow End-to-End Test Suite (NestJS :8001)")
    print("==================================================")
    
    # 1. Health Check
    print("\n[1/13] Testing Health Check...")
    status, health = request(f"{BASE_URL}/health")
    assert status == 200, f"Health check failed with status {status}"
    assert health.get("status") == "ok", f"Health status not ok: {health}"
    print(f"  PASS: {health}")

    # 2. User Registration (Founder / CEO)
    timestamp = int(time.time())
    email = f"founder_{timestamp}@teamflow.dev"
    password = f"P@ssword_{timestamp}!"
    print(f"\n[2/13] Registering Founder: {email}...")
    reg_payload = {
        "email": email,
        "password": password,
        "name": "Founder Automated Tester",
        "organization_name": f"Enterprise Org {timestamp}"
    }
    status, reg_data = request(f"{BASE_URL}/auth/register", method="POST", data=reg_payload)
    assert status in (200, 201), f"Registration failed ({status}): {reg_data}"
    assert "access" in reg_data, "No access token in registration response"
    print(f"  PASS: Founder registered. Org: {reg_data['user'].get('organization_name')} (ID: {reg_data['user'].get('organization')})")

    # 3. User Login
    print(f"\n[3/13] Logging in with {email}...")
    status, login_data = request(f"{BASE_URL}/auth/login", method="POST", data={"email": email, "password": password})
    assert status == 200, f"Login failed ({status}): {login_data}"
    access_token = login_data["access"]
    refresh_token = login_data["refresh"]
    print(f"  PASS: Received access and refresh JWTs.")

    # 4. Authenticated Profile /me
    print("\n[4/13] Checking /auth/me...")
    status, me_data = request(f"{BASE_URL}/auth/me", token=access_token)
    assert status == 200, f"/auth/me failed ({status}): {me_data}"
    assert me_data["email"] == email.lower(), f"Email mismatch: {me_data}"
    user_id = me_data["id"]
    org_id = me_data["organization"]
    print(f"  PASS: Authenticated as User ID {user_id}, Org ID {org_id}, Role: {me_data['role']}")

    # 5. Token Refresh
    print("\n[5/13] Testing Token Refresh...")
    status, refresh_data = request(f"{BASE_URL}/auth/refresh", method="POST", data={"refresh": refresh_token})
    assert status == 200, f"Refresh failed ({status}): {refresh_data}"
    assert "access" in refresh_data, "No new access token returned"
    access_token = refresh_data["access"]
    print(f"  PASS: Successfully rotated access token.")

    # 6. Create Project
    print("\n[6/13] Creating Project...")
    proj_payload = {
        "name": f"E2E Swarm Project {timestamp}",
        "description": "Validating multi-agent integration and 5-stage Kanban flow",
        "github_repo": "Asta-Builds/TeamFlow"
    }
    status, proj_data = request(f"{BASE_URL}/projects", method="POST", data=proj_payload, token=access_token)
    assert status in (200, 201), f"Project creation failed ({status}): {proj_data}"
    proj_id = proj_data["id"]
    print(f"  PASS: Created Project #{proj_id}: '{proj_data['name']}'")

    # 7. List Projects
    print("\n[7/13] Listing Projects...")
    status, proj_list = request(f"{BASE_URL}/projects", token=access_token)
    assert status == 200, f"Project listing failed ({status}): {proj_list}"
    matching = [p for p in proj_list if p["id"] == proj_id]
    assert len(matching) == 1, f"Project #{proj_id} not found in project listing"
    print(f"  PASS: Retrieved {len(proj_list)} project(s). Project #{proj_id} verified.")

    # 8. Create Task
    print(f"\n[8/13] Creating Task under Project #{proj_id}...")
    task_payload = {
        "project": proj_id,
        "title": "Architect Swarm Agent Communication Protocol",
        "description": "Configure WebSocket / REST bridge for multi-agent dispatch",
        "status": "todo",
        "priority": "high",
        "task_type": "feature",
        "assignee": user_id
    }
    status, task_data = request(f"{BASE_URL}/tasks", method="POST", data=task_payload, token=access_token)
    assert status in (200, 201), f"Task creation failed ({status}): {task_data}"
    task_id = task_data["id"]
    print(f"  PASS: Created Task #{task_id}: '{task_data['title']}' (status: {task_data['status']})")

    # 9. Kanban Workflow: todo -> in_progress -> in_review -> qa
    print(f"\n[9/13] Moving Task #{task_id} through 5-Stage Kanban...")
    stages = ["in_progress", "in_review", "qa"]
    for st in stages:
        status, updated = request(f"{BASE_URL}/tasks/{task_id}", method="PATCH", data={"status": st}, token=access_token)
        assert status == 200, f"Failed updating task to {st} ({status}): {updated}"
        assert updated["status"] == st, f"Task status was not updated to {st}"
        print(f"  -> Advanced to: {st}")
    print(f"  PASS: Kanban stage advancement verified.")

    # 10. QA Validation Gate
    print(f"\n[10/13] Validating QA Gate on Task #{task_id}...")
    status, qa_res = request(f"{BASE_URL}/tasks/{task_id}/qa_validate", method="POST", token=access_token)
    assert status in (200, 201), f"QA validation failed ({status}): {qa_res}"
    assert qa_res["status"] == "done", f"Task should be done after QA validation, got {qa_res['status']}"
    print(f"  PASS: QA gate validated task to '{qa_res['status']}'.")

    # 11. Add Comment
    print(f"\n[11/13] Adding Comment to Task #{task_id}...")
    comment_payload = {"body": "Automated E2E validation test comment."}
    status, comment_data = request(f"{BASE_URL}/tasks/{task_id}/comments", method="POST", data=comment_payload, token=access_token)
    assert status in (200, 201), f"Adding comment failed ({status}): {comment_data}"
    print(f"  PASS: Comment recorded (ID: {comment_data['id']})")

    # 12. Pulse Daily Cockpit
    print("\n[12/13] Testing Pulse Cockpit (Dashboard & Private Scratchpad)...")
    status, pulse_dash = request(f"{BASE_URL}/pulse/dashboard", token=access_token)
    assert status == 200, f"Pulse dashboard failed ({status}): {pulse_dash}"
    
    note_payload = {"body": f"Focus for today {timestamp}: Complete NestJS cutover."}
    status, note_data = request(f"{BASE_URL}/pulse/note", method="PUT", data=note_payload, token=access_token)
    assert status == 200, f"Pulse note update failed ({status}): {note_data}"
    print(f"  PASS: Pulse dashboard and scratchpad verified.")

    # 13. Multi-Agent Swarm Dispatch Bridge (NestJS -> Django -> Celery)
    print("\n[13/13] Testing Agent Swarm Dispatch Bridge (NestJS :8001 -> Django :8000)...")
    # Reset task to in_progress so it can be dispatched
    request(f"{BASE_URL}/tasks/{task_id}", method="PATCH", data={"status": "in_progress"}, token=access_token)
    status, dispatch_res = request(f"{BASE_URL}/agents/dispatch/{task_id}", method="POST", token=access_token)
    assert status == 202, f"Expected 202 Accepted for CEO dispatch, got {status}: {dispatch_res}"
    print(f"  PASS: Agent Swarm dispatch succeeded (HTTP 202): {dispatch_res.get('message')}")

    # Check Frontend is serving
    print("\n[*] Checking Frontend UI on Port 3000...")
    req = urllib.request.Request(FRONTEND_URL)
    with urllib.request.urlopen(req) as resp:
        assert resp.status == 200, f"Frontend returned {resp.status}"
        html = resp.read().decode("utf-8")
        assert len(html) > 1000, "Frontend response too small"
    print(f"  PASS: Frontend UI is live and accessible on port 3000.")

    print("\n==================================================")
    print(" ALL 13 END-TO-END TEST STAGES PASSED SUCCESSFULLY!")
    print("==================================================")

if __name__ == "__main__":
    try:
        run_suite()
    except AssertionError as ae:
        print(f"\n[FAIL] Assertion failed: {ae}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"\n[ERROR] Unexpected error: {e}", file=sys.stderr)
        sys.exit(1)
