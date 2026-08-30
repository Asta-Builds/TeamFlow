from django.conf import settings

# Attempt to import stripe, fall back to mock if not installed or keys missing
try:
    import stripe
    stripe.api_key = getattr(settings, "STRIPE_SECRET_KEY", None)
except ImportError:
    stripe = None


def is_stripe_configured():
    return bool(stripe is not None and stripe.api_key)


def create_checkout_session(org, tier, success_url, cancel_url):
    """
    Creates a Stripe Checkout Session for subscription, or returns a mock session URL
    if Stripe is not configured for development.
    """
    if not is_stripe_configured():
        # Dev mock mode
        import uuid
        mock_session_id = f"cs_test_{uuid.uuid4().hex[:12]}"
        # Direct redirect to success URL for demo convenience
        demo_success_url = f"{success_url}?session_id={mock_session_id}&tier={tier}"
        return {
            "id": mock_session_id,
            "url": demo_success_url,
            "mock": True
        }

    # Retrieve price IDs from settings
    price_id = getattr(settings, "STRIPE_PRICES", {}).get(tier)
    if not price_id:
        raise ValueError(f"No Stripe Price ID configured for tier: {tier}")

    # Create Stripe customer if not already present
    customer_id = org.stripe_customer_id
    if not customer_id:
        customer = stripe.Customer.create(
            name=org.name,
            metadata={"org_id": org.id}
        )
        customer_id = customer.id
        org.stripe_customer_id = customer_id
        org.save()

    session = stripe.checkout.Session.create(
        customer=customer_id,
        payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        mode="subscription",
        success_url=success_url + "?session_id={CHECKOUT_SESSION_ID}&tier=" + tier,
        cancel_url=cancel_url,
        metadata={"org_id": org.id, "tier": tier}
    )
    return {
        "id": session.id,
        "url": session.url,
        "mock": False
    }


def create_portal_session(org, return_url):
    """
    Creates a Stripe Billing Customer Portal session, or a mock redirect in dev mode.
    """
    if not is_stripe_configured() or not org.stripe_customer_id:
        # Dev mock mode portal
        mock_portal_url = f"{return_url}?portal_mock=true"
        return {
            "url": mock_portal_url,
            "mock": True
        }

    session = stripe.billing_portal.Session.create(
        customer=org.stripe_customer_id,
        return_url=return_url,
    )
    return {
        "url": session.url,
        "mock": False
    }
