from urllib.parse import urlparse

from django.conf import settings

try:
    import stripe
except ImportError:  # pragma: no cover - dependency is pinned in requirements.txt
    stripe = None


class BillingNotConfigured(Exception):
    """Raised when neither Stripe nor development mock billing is available."""


class InvalidRedirect(ValueError):
    """Raised when a checkout redirect does not point back to this application."""


def is_stripe_configured():
    return bool(stripe is not None and getattr(settings, "STRIPE_SECRET_KEY", ""))


def mock_billing_enabled():
    return bool(getattr(settings, "MOCK_BILLING_ENABLED", False))


def _stripe():
    stripe.api_key = settings.STRIPE_SECRET_KEY
    return stripe


def validate_redirect_url(url):
    """Only allow redirects to the application's own origins."""
    parsed = urlparse(url or "")
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise InvalidRedirect("Redirect URLs must be absolute http(s) URLs.")
    origin = f"{parsed.scheme}://{parsed.netloc}".lower()
    allowed = {
        o.rstrip("/").lower()
        for o in list(getattr(settings, "CORS_ALLOWED_ORIGINS", [])) + list(getattr(settings, "CSRF_TRUSTED_ORIGINS", []))
        if o
    }
    if origin not in allowed:
        raise InvalidRedirect("Redirect URLs must point to this application.")
    return url


def _append_query(url, query):
    return f"{url}{'&' if '?' in url else '?'}{query}"


def create_checkout_session(org, tier, success_url, cancel_url):
    """Create a Stripe Checkout Session, or a development mock session when explicitly enabled."""
    validate_redirect_url(success_url)
    validate_redirect_url(cancel_url)

    if not is_stripe_configured():
        if not mock_billing_enabled():
            raise BillingNotConfigured("Billing is not configured.")
        import uuid

        mock_session_id = f"cs_mock_{uuid.uuid4().hex[:12]}"
        return {
            "id": mock_session_id,
            "url": _append_query(success_url, f"session_id={mock_session_id}&tier={tier}"),
            "mock": True,
        }

    price_id = getattr(settings, "STRIPE_PRICES", {}).get(tier)
    if not price_id:
        raise BillingNotConfigured(f"No Stripe price is configured for tier: {tier}")

    client = _stripe()
    customer_id = org.stripe_customer_id
    if not customer_id or customer_id.startswith("cus_mock_"):
        customer = client.Customer.create(name=org.name, metadata={"org_id": org.id})
        customer_id = customer.id
        org.stripe_customer_id = customer_id
        org.save(update_fields=["stripe_customer_id"])

    session = client.checkout.Session.create(
        customer=customer_id,
        payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        mode="subscription",
        success_url=_append_query(success_url, "session_id={CHECKOUT_SESSION_ID}&tier=" + tier),
        cancel_url=cancel_url,
        metadata={"org_id": org.id, "tier": tier},
        subscription_data={"metadata": {"org_id": org.id, "tier": tier}},
    )
    return {"id": session.id, "url": session.url, "mock": False}


def create_portal_session(org, return_url):
    """Create a Stripe Billing Portal session, or a development mock redirect when explicitly enabled."""
    validate_redirect_url(return_url)

    if not is_stripe_configured():
        if not mock_billing_enabled():
            raise BillingNotConfigured("Billing is not configured.")
        return {"url": _append_query(return_url, "portal_mock=true"), "mock": True}

    if not org.stripe_customer_id or org.stripe_customer_id.startswith("cus_mock_"):
        raise BillingNotConfigured("This workspace has no billing account yet.")

    session = _stripe().billing_portal.Session.create(
        customer=org.stripe_customer_id,
        return_url=return_url,
    )
    return {"url": session.url, "mock": False}
