from django.urls import path
from .views import (
    AgentDispatchView,
    AgentTracesView,
    AgentIngestRAGView,
    AgentStatusView,
)

urlpatterns = [
    path("dispatch/<int:task_id>/", AgentDispatchView.as_view(), name="agent-dispatch"),
    path("traces/", AgentTracesView.as_view(), name="agent-traces-list"),
    path("traces/<int:task_id>/", AgentTracesView.as_view(), name="agent-traces-detail"),
    path("ingest-rag/", AgentIngestRAGView.as_view(), name="agent-ingest-rag"),
    path("status/", AgentStatusView.as_view(), name="agent-status"),
]
