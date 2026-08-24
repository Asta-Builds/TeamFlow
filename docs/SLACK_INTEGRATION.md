# TeamFlow: Slack Integration Architecture & API Specification

This document details the Slack integration design for the TeamFlow virtual company workspace, covering Webhooks, the Web API, the Events API, and Slack Bolt SDK handlers.

---

## 1. Architectural Options Overview

### 1. Incoming Webhooks (One-Way Notifications)
- **Mechanism:** HTTP POST with JSON payloads directly to designated Slack Webhook URLs.
- **Use Cases:**
  - Automated ticket assignment alerts
  - CI/CD container build and deployment status
  - QA Decision Gate approvals / rejections
  - Technical SEO score drops (< 80)
  - Autonomous AI agent reply summaries

### 2. Slack Web API (Two-Way Messaging & Rich Formatting)
- **Mechanism:** Bot User OAuth Token (`xoxb-...`) communicating with `chat.postMessage`, `chat.update`, `reactions.add`.
- **Use Cases:**
  - Dynamic Block Kit cards with interactive buttons
  - Direct Messages (DMs) to specific team member Slack IDs
  - Automatic thread replies grouped by `ticket_id`

### 3. Events API & Interactive Webhooks
- **Mechanism:** Ingress webhook endpoint `POST /api/integrations/slack/events/` receiving Slack event subscriptions.
- **Use Cases:**
  - CEO emojis or button clicks in Slack (e.g. `[Approve Deployment]`, `[Reject QA]`) trigger automated state transitions in TeamFlow.

### 4. Slack Bolt Framework
- **Mechanism:** High-level app runtime handling `/teamflow create-ticket` slash commands and modals.

---

## 2. Event Mapping Matrix

| TeamFlow Event | Target Slack Channel | Color Token | Action / Payload |
|---|---|---|---|
| **Ticket Assigned** | `#general` or Assignee DM | `#6366F1` (Indigo) | Card with priority, assignee badge, link to ticket |
| **Deployment Succeeded / Failed** | `#devops` | `#10B981` / `#EF4444` | Live environment, commit SHA, build duration, rollback link |
| **QA Decision Gate Rejection** | `#qa` | `#EF4444` (Rose) | Mandatory rejection reason, regression test summary |
| **SEO Core Web Vitals Drop** | `#seo` | `#F59E0B` (Amber) | LCP / FID / CLS anomaly report + auto-generated ticket link |
| **CEO Agent Prompt Response** | `#general` | `#8B5CF6` (Purple) | Antigravity AI Agent thought trace and PR link |

---

## 3. Backend API Endpoints

### `GET /api/integrations/slack/`
Retrieves current workspace Slack configuration.

### `POST /api/integrations/slack/connect/`
Updates Slack webhook URL, channel routing, and notification event toggles.

**Payload Schema:**
```json
{
  "webhook_url": "https://hooks.slack.com/services/T000/B000/XXXXXX",
  "default_channel": "#general",
  "devops_channel": "#devops",
  "qa_channel": "#qa",
  "seo_channel": "#seo",
  "notify_on_ticket_assigned": true,
  "notify_on_deployment": true,
  "notify_on_qa_rejection": true,
  "notify_on_seo_drop": true,
  "is_enabled": true
}
```

### `POST /api/integrations/slack/test/`
Dispatches an immediate diagnostic test message to verify the webhook connectivity.

### `POST /api/integrations/slack/events/`
Slack Events API receiver supporting challenge handshakes (`url_verification`) and interactive callbacks.

---

## 4. Asynchronous Celery Dispatch Flow

```
   TeamFlow Event (e.g., QA Reject / Deploy)
                       │
                       ▼
         Django Signal / Service Hook
                       │
                       ▼
      Celery Task: dispatch_slack_notification
                       │
                       ▼
            Slack Incoming Webhook
                       │
                       ▼
          #devops / #qa / #general
```
