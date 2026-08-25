import json
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings
from .stripe_utils import verify_webhook_signature, handle_invoice_payment_succeeded, handle_customer_subscription_deleted

@csrf_exempt
def stripe_webhook(request):
    if request.method == 'POST':
        payload = request.body
        sig_header = request.META.get('HTTP_STRIPE_SIGNATURE')

        try:
            event = verify_webhook_signature(payload, sig_header, settings.STRIPE_WEBHOOK_SECRET)
        except ValueError as e:
            return HttpResponse(status=400, content=str(e))

        event_type = event['type']

        if event_type == 'invoice.payment_succeeded':
            handle_invoice_payment_succeeded(event['data']['object'])
        elif event_type == 'customer.subscription.deleted':
            handle_customer_subscription_deleted(event['data']['object'])

        return HttpResponse(status=200)
    else:
        return HttpResponse(status=405, content='Method Not Allowed')

def verify_webhook_signature(payload, sig_header, secret):
    import stripe
    stripe.api_key = secret
    return stripe.Webhook.construct_event(
        payload, sig_header, secret
    )

def handle_invoice_payment_succeeded(invoice):
    # Implement logic to handle invoice payment succeeded event
    print(f"Invoice payment succeeded: {invoice['id']}")

def handle_customer_subscription_deleted(subscription):
    # Implement logic to handle customer subscription deleted event
    print(f"Customer subscription deleted: {subscription['id']}")