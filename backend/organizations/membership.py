"""
Workspace membership rules.

People hold one of three workspace roles (``Membership.Role``). Specialist roles
such as ``tech_lead`` or ``devops`` belong to AI agent seats, which are tied to a
single workspace through ``User.organization`` and never have memberships.
"""

import re

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Q

from .models import Membership

HUMAN_ROLES = frozenset(Membership.Role.values)


def human_role_for(role):
    """Map a stored or identity-provider role onto a role a person can hold."""
    if role in HUMAN_ROLES:
        return role
    if role == "tech_lead":
        return Membership.Role.ADMIN
    return Membership.Role.MEMBER


def add_member(user, organization, role, *, status=Membership.Status.ACTIVE, invited_by=None):
    """Give a person a seat in a workspace, or update the seat they already have."""
    if user.agent_key:
        raise ValueError("AI agent accounts cannot hold workspace memberships.")
    if role not in HUMAN_ROLES:
        raise ValueError(f"People cannot hold the {role!r} role.")
    membership, _created = Membership.objects.update_or_create(
        user=user,
        organization=organization,
        defaults={"role": role, "status": status, "invited_by": invited_by},
    )
    return membership


def workspace_people_filter(organization):
    """Users that belong to a workspace: people with an active seat and its agents."""
    return Q(
        agent_key="",
        memberships__organization=organization,
        memberships__status=Membership.Status.ACTIVE,
    ) | (~Q(agent_key="") & Q(organization=organization))


def workspace_people(organization):
    return get_user_model().objects.filter(workspace_people_filter(organization)).distinct()


def is_reserved_agent_email(email):
    """Agent seats use ``<key>+organization-<id>@<AGENT_EMAIL_DOMAIN>``; people cannot."""
    domain = (getattr(settings, "AGENT_EMAIL_DOMAIN", "") or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9.-]+", domain):
        domain = "teamflow.dev"
    local, _, email_domain = (email or "").strip().lower().rpartition("@")
    return email_domain == domain and bool(re.fullmatch(r"[a-z0-9_.-]+\+organization-\d+", local))
