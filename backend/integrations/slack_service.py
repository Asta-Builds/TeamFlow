import logging
import requests
from typing import Dict, Any, Optional
from django.conf import settings

logger = logging.getLogger(__name__)


def send_slack_notification(
    organization,
    event_type: str,
    title: str,
    message: str,
    details: Optional[Dict[str, Any]] = None,
    action_url: Optional[str] = None
) -> Dict[str, Any]:
    """
    Dispatches a formatted Slack notification using the organization's Slack configuration.
    Supports Block Kit formatting, channel routing, and toggle verification.
    """
    from .models import SlackIntegration

    integration = SlackIntegration.objects.filter(organization=organization, is_enabled=True).first()
    if not integration or not integration.webhook_url:
        logger.info(f"Slack notification skipped: No active webhook for org '{organization.name}'.")
        return {"ok": False, "reason": "No webhook configured"}

    # Verify event toggles
    toggle_map = {
        "ticket_assigned": integration.notify_on_ticket_assigned,
        "deployment": integration.notify_on_deployment,
        "qa_rejection": integration.notify_on_qa_rejection,
        "seo_drop": integration.notify_on_seo_drop,
        "agent_response": integration.notify_on_agent_response,
    }
    if not toggle_map.get(event_type, True):
        logger.info(f"Slack notification skipped: Event '{event_type}' disabled in settings.")
        return {"ok": False, "reason": "Event type disabled"}

    # Route channel
    channel_map = {
        "deployment": integration.devops_channel,
        "qa_rejection": integration.qa_channel,
        "seo_drop": integration.seo_channel,
    }
    target_channel = channel_map.get(event_type, integration.default_channel)

    # Format Block Kit Payload
    color_map = {
        "ticket_assigned": "#6366F1",  # Indigo
        "deployment": "#10B981",       # Emerald
        "qa_rejection": "#EF4444",     # Rose/Red
        "seo_drop": "#F59E0B",         # Amber
        "agent_response": "#8B5CF6",   # Purple
    }

    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"TeamFlow Alert · {title}",
                "emoji": False
            }
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*{title}*\n{message}"
            }
        }
    ]

    if details:
        fields = [
            {"type": "mrkdwn", "text": f"*{k.replace('_', ' ').title()}:*\n`{v}`"}
            for k, v in list(details.items())[:6]
        ]
        blocks.append({
            "type": "section",
            "fields": fields
        })

    if action_url:
        blocks.append({
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {
                        "type": "plain_text",
                        "text": "View in TeamFlow",
                        "emoji": False
                    },
                    "url": action_url,
                    "style": "primary"
                }
            ]
        })

    payload = {
        "channel": target_channel,
        "username": "TeamFlow Swarm Bot",
        "attachments": [
            {
                "color": color_map.get(event_type, "#6366F1"),
                "blocks": blocks
            }
        ]
    }

    try:
        res = requests.post(integration.webhook_url, json=payload, timeout=8)
        return {
            "ok": res.status_code == 200,
            "status_code": res.status_code,
            "response": res.text,
            "target_channel": target_channel,
        }
    except Exception as e:
        logger.error(f"Failed to post Slack notification: {e}")
        return {"ok": False, "error": str(e)}
