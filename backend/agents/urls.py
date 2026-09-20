from django.urls import path
from .views import (
    AgentDispatchView,
    AgentEventStreamView,
    AgentEventsView,
    AgentIngestRAGView,
    AgentStatusView,
    AgentTracesView,
    AntigravityAgentRunView,
    ApprovalRequestApproveView,
    ApprovalRequestDetailView,
    ApprovalRequestRejectView,
    ApprovalRequestsView,
    SwarmChainExecuteView,
    SwarmLiveFeedView,
)

urlpatterns = [
    path("dispatch/<int:task_id>/", AgentDispatchView.as_view(), name="agent-dispatch"),
    path("traces/", AgentTracesView.as_view(), name="agent-traces-list"),
    path("traces/<int:task_id>/", AgentTracesView.as_view(), name="agent-traces-detail"),
    path("ingest-rag/", AgentIngestRAGView.as_view(), name="agent-ingest-rag"),
    path("status/", AgentStatusView.as_view(), name="agent-status"),
    path("antigravity/run/", AntigravityAgentRunView.as_view(), name="agent-antigravity-run"),
    path("swarm-chain/<int:task_id>/", SwarmChainExecuteView.as_view(), name="agent-swarm-chain"),
    path("swarm-feed/", SwarmLiveFeedView.as_view(), name="agent-swarm-feed"),
    path("events/", AgentEventsView.as_view(), name="agent-events"),
    path("events/stream/", AgentEventStreamView.as_view(), name="agent-events-stream"),
    path("approvals/", ApprovalRequestsView.as_view(), name="agent-approvals-list"),
    path("approvals/<int:approval_id>/", ApprovalRequestDetailView.as_view(), name="agent-approvals-detail"),
    path("approvals/<int:approval_id>/approve/", ApprovalRequestApproveView.as_view(), name="agent-approvals-approve"),
    path("approvals/<int:approval_id>/reject/", ApprovalRequestRejectView.as_view(), name="agent-approvals-reject"),
]

