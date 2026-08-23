from rest_framework import views, permissions, response, status
from django.conf import settings
from .models import Organization
from teamflow.stripe_utils import create_checkout_session, create_portal_session, is_stripe_configured
try:
    import stripe
except ImportError:
    stripe = None


class CreateCheckoutSessionView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        user = request.user
        if not user.is_privileged:
            return response.Response({"detail": "Only HR admins can manage subscriptions."}, status=403)

        tier = request.data.get("tier", "growth")
        if tier not in [Organization.Tier.GROWTH, Organization.Tier.ENTERPRISE]:
            return response.Response({"detail": "Invalid tier requested."}, status=400)

        success_url = request.data.get("success_url", "http://localhost:3000/settings/billing")
        cancel_url = request.data.get("cancel_url", "http://localhost:3000/settings/billing")

        try:
            session = create_checkout_session(user.organization, tier, success_url, cancel_url)
            return response.Response(session, status=200)
        except Exception as e:
            return response.Response({"detail": str(e)}, status=400)


class CreatePortalSessionView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        user = request.user
        if not user.is_privileged:
            return response.Response({"detail": "Only HR admins can manage subscriptions."}, status=403)

        return_url = request.data.get("return_url", "http://localhost:3000/settings/billing")

        try:
            session = create_portal_session(user.organization, return_url)
            return response.Response(session, status=200)
        except Exception as e:
            return response.Response({"detail": str(e)}, status=400)


class StripeWebhookView(views.APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        payload = request.body
        sig_header = request.META.get("HTTP_STRIPE_SIGNATURE")
        endpoint_secret = getattr(settings, "STRIPE_WEBHOOK_SECRET", None)

        if not sig_header or not endpoint_secret:
            return response.Response({"detail": "Stripe webhook signature not configured."}, status=400)

        if stripe is None:
            return response.Response({"detail": "Stripe library is not installed."}, status=501)

        try:
            event = stripe.Webhook.construct_event(
                payload, sig_header, endpoint_secret
            )
        except ValueError:
            return response.Response({"detail": "Invalid payload"}, status=400)
        except stripe.error.SignatureVerificationError:
            return response.Response({"detail": "Invalid signature"}, status=400)

        event_type = event.get("type")
        data = event.get("data", {})
        obj = data.get("object", {})

        if event_type in ["checkout.session.completed", "invoice.payment_succeeded"]:
            org_id = obj.get("metadata", {}).get("org_id")
            tier = obj.get("metadata", {}).get("tier", "growth")
            subscription_id = obj.get("subscription")
            customer_id = obj.get("customer")

            if org_id:
                try:
                    org = Organization.objects.get(id=org_id)
                    org.stripe_customer_id = customer_id
                    org.stripe_subscription_id = subscription_id
                    org.subscription_tier = tier
                    org.subscription_status = Organization.Status.ACTIVE
                    org.save()
                except Organization.DoesNotExist:
                    pass

        elif event_type == "customer.subscription.updated":
            subscription_id = obj.get("id")
            status_val = obj.get("status")

            try:
                org = Organization.objects.get(stripe_subscription_id=subscription_id)
                if status_val in ["active", "trialing"]:
                    org.subscription_status = Organization.Status.ACTIVE
                elif status_val in ["past_due", "unpaid"]:
                    org.subscription_status = Organization.Status.PAST_DUE
                elif status_val in ["canceled", "incomplete_expired"]:
                    org.subscription_status = Organization.Status.CANCELED
                org.save()
            except Organization.DoesNotExist:
                pass

        elif event_type == "customer.subscription.deleted":
            subscription_id = obj.get("id")
            try:
                org = Organization.objects.get(stripe_subscription_id=subscription_id)
                org.subscription_status = Organization.Status.CANCELED
                org.subscription_tier = Organization.Tier.STARTER
                org.save()
            except Organization.DoesNotExist:
                pass

        return response.Response({"status": "success"}, status=200)


class MockConfirmSubscriptionView(views.APIView):
    """
    Updates the organization subscription details immediately in developer mock mode.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        user = request.user
        if not user.is_privileged:
            return response.Response({"detail": "Only HR admins can manage subscriptions."}, status=403)

        tier = request.data.get("tier", "growth")
        if tier not in [Organization.Tier.STARTER, Organization.Tier.GROWTH, Organization.Tier.ENTERPRISE]:
            return response.Response({"detail": "Invalid tier requested."}, status=400)

        org = user.organization
        if org:
            org.subscription_tier = tier
            org.subscription_status = Organization.Status.ACTIVE
            org.stripe_customer_id = f"cus_mock_{org.id}"
            org.stripe_subscription_id = f"sub_mock_{org.id}"
            org.save()
            return response.Response({
                "status": "success",
                "tier": org.subscription_tier,
                "subscription_status": org.subscription_status
            }, status=200)
        return response.Response({"detail": "No organization found."}, status=404)
