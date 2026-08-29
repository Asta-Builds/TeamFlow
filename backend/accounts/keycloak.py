"""Verified Keycloak token handling for the TeamFlow SSO bridge."""

from __future__ import annotations

import jwt
from django.conf import settings
from jwt import PyJWKClient
from jwt.exceptions import PyJWTError


class KeycloakTokenError(ValueError):
    """Raised when a Keycloak token cannot be trusted."""


def verify_keycloak_token(token: str) -> dict:
    """Verify signature, issuer, audience, expiry, and required identity claims."""
    if not token:
        raise KeycloakTokenError("A Keycloak token is required.")

    try:
        signing_key = PyJWKClient(
            settings.KEYCLOAK_JWKS_URL,
            timeout=settings.KEYCLOAK_HTTP_TIMEOUT_SECONDS,
        ).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.KEYCLOAK_CLIENT_ID,
            issuer=settings.KEYCLOAK_ISSUER_URL,
            options={"require": ["exp", "iat", "iss", "sub"]},
        )
    except PyJWTError as exc:
        raise KeycloakTokenError("The Keycloak token is invalid or expired.") from exc
    except Exception as exc:
        raise KeycloakTokenError("Keycloak signing keys could not be verified.") from exc

    email = claims.get("email") or claims.get("preferred_username")
    if not email or "@" not in email:
        raise KeycloakTokenError("The verified Keycloak token does not contain an email address.")
    return claims


def role_from_claims(claims: dict, allowed_roles: set[str]) -> str | None:
    """Return the first supported role from verified realm or client claims."""
    realm_roles = claims.get("realm_access", {}).get("roles", [])
    client_roles = (
        claims.get("resource_access", {})
        .get(settings.KEYCLOAK_CLIENT_ID, {})
        .get("roles", [])
    )
    for role in [*realm_roles, *client_roles]:
        if role in allowed_roles:
            return role
    return None
