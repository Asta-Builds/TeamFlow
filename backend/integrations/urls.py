from django.urls import path
from .views import (
    SlackIntegrationView,
    SlackTestView,
    SlackEventsWebhookView,
    GitHubIntegrationView,
    GitHubTestView,
)

urlpatterns = [
    path("slack/", SlackIntegrationView.as_view(), name="slack-integration-detail"),
    path("slack/connect/", SlackIntegrationView.as_view(), name="slack-integration-connect"),
    path("slack/test/", SlackTestView.as_view(), name="slack-integration-test"),
    path("slack/events/", SlackEventsWebhookView.as_view(), name="slack-events-webhook"),
    path("github/", GitHubIntegrationView.as_view(), name="github-integration-detail"),
    path("github/connect/", GitHubIntegrationView.as_view(), name="github-integration-connect"),
    path("github/test/", GitHubTestView.as_view(), name="github-integration-test"),
]
