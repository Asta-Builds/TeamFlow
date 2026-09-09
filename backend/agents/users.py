"""Organization-scoped Django identities for autonomous agent seats."""

from __future__ import annotations

import re

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction

from .registry import AGENT_SEATS, get_agent_spec, resolve_agent_key

User = get_user_model()


def _scoped_email(agent_key: str, organization_id: int) -> str:
    domain = getattr(settings, "AGENT_EMAIL_DOMAIN", "").strip() or "teamflow.dev"
    if not re.fullmatch(r"[A-Za-z0-9.-]+", domain):
        domain = "teamflow.dev"
    return f"{agent_key}+organization-{organization_id}@{domain}"


@transaction.atomic
def get_or_create_agent_user(agent_key: str, organization):
    """Return one explicit agent seat owned by the supplied organization."""
    if organization is None:
        raise ValueError("Agent users require an organization.")

    canonical_key = resolve_agent_key(agent_key)
    spec = get_agent_spec(canonical_key)
    existing = User.objects.filter(
        organization=organization,
        agent_key=canonical_key,
    ).first()
    if existing:
        return existing

    email = _scoped_email(spec["email_local"], organization.id)
    user, _created = User.objects.get_or_create(
        email=email,
        defaults={"organization": organization},
    )

    user.organization = organization
    user.agent_key = canonical_key
    user.name = spec["name"]
    user.role = spec["role"]
    user.bio = f"Autonomous AI agent: {spec['title']}"
    user.user_status = User.Status.ACTIVE
    user.is_active = True
    user.set_unusable_password()
    user.save()
    return user


def agent_key_from_identifier(identifier: str) -> str:
    """Resolve a registry key from a canonical key, alias, or scoped agent email."""
    normalized = (identifier or "pm").strip().lower()
    for key, spec in AGENT_SEATS.items():
        email_local = spec["email_local"].lower()
        if normalized == email_local or normalized.split("@", 1)[0].split("+", 1)[0] == email_local:
            return key
    return resolve_agent_key(normalized)


def get_agent_user_for_task(task, identifier: str):
    return get_or_create_agent_user(agent_key_from_identifier(identifier), task.organization)
