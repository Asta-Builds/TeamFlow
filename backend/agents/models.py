from django.db import models
from django.utils import timezone
from organizations.models import Organization
from projects.models import Project
from tasks.models import Task

try:
    from pgvector.django import VectorField
    HAS_PGVECTOR = True
except ImportError:
    HAS_PGVECTOR = False


class CodebaseEmbedding(models.Model):
    """
    RAG Vector Store chunk stored in PostgreSQL.
    Stores chunked code, ADRs, documentation, and API specs.
    """
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="codebase_embeddings",
        null=True,
        blank=True,
    )
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name="embeddings",
        null=True,
        blank=True,
    )
    file_path = models.CharField(max_length=500)
    chunk_index = models.PositiveIntegerField(default=0)
    content = models.TextField()
    
    # Store 384 or 1536 dimensional embedding vector
    if HAS_PGVECTOR:
        embedding = VectorField(dimensions=384, null=True, blank=True)
    else:
        embedding = models.JSONField(null=True, blank=True)

    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["file_path", "chunk_index"]
        indexes = [
            models.Index(fields=["file_path"]),
            models.Index(fields=["project"]),
        ]

    def __str__(self):
        return f"{self.file_path} (chunk {self.chunk_index})"


class AgentExecutionTrace(models.Model):
    """
    Observability record for a LangGraph multi-agent run.
    Traced to Langfuse with session_id = task_id.
    """
    class Status(models.TextChoices):
        RUNNING = "running", "Running"
        AWAITING_APPROVAL = "awaiting_approval", "Awaiting Approval"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    task = models.ForeignKey(
        Task,
        on_delete=models.CASCADE,
        related_name="agent_traces",
    )
    session_id = models.CharField(max_length=128, db_index=True)
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.RUNNING,
    )
    graph_state = models.JSONField(default=dict, blank=True)
    steps = models.JSONField(default=list, blank=True)
    tokens_used = models.PositiveIntegerField(default=0)
    cost_usd = models.DecimalField(max_digits=10, decimal_places=4, default=0.0)
    duration_seconds = models.FloatField(default=0.0)
    langfuse_url = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Agent Trace #{self.id} — Task #{self.task_id} ({self.status})"


class AgentEvent(models.Model):
    """Persistent, tenant-scoped lifecycle and conversation event for an agent run."""

    class Type(models.TextChoices):
        QUEUED = "queued", "Queued"
        STARTED = "started", "Started"
        PROGRESS = "progress", "Progress"
        HANDOFF = "handoff", "Handoff"
        BLOCKED = "blocked", "Blocked"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="agent_events",
    )
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name="agent_events",
    )
    task = models.ForeignKey(
        Task,
        on_delete=models.CASCADE,
        related_name="agent_events",
    )
    trace = models.ForeignKey(
        AgentExecutionTrace,
        on_delete=models.CASCADE,
        related_name="events",
        null=True,
        blank=True,
    )
    session_id = models.CharField(max_length=128, db_index=True)
    event_type = models.CharField(max_length=20, choices=Type.choices)
    sender = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        related_name="agent_events",
        null=True,
        blank=True,
    )
    sender_key = models.CharField(max_length=64, blank=True)
    recipient_key = models.CharField(max_length=64, blank=True)
    message = models.TextField()
    current_work = models.TextField(blank=True)
    remaining_work = models.JSONField(default=list, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        indexes = [
            models.Index(
                fields=["organization", "project", "id"],
                name="agents_agen_organiz_0ca188_idx",
            ),
            models.Index(
                fields=["task", "session_id", "id"],
                name="agents_agen_task_id_f80b84_idx",
            ),
        ]

    def __str__(self):
        return f"{self.session_id}: {self.event_type} ({self.sender_key or 'system'})"


class ApprovalRequest(models.Model):
    """
    Release gate approval request pinning an exact commit SHA.
    """

    class Kind(models.TextChoices):
        RELEASE = "release", "Release"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        SUPERSEDED = "superseded", "Superseded"
        EXECUTED = "executed", "Executed"
        FAILED = "failed", "Failed"

    class Engine(models.TextChoices):
        GRAPH = "graph", "Graph"
        CHAIN = "chain", "Chain"

    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="approval_requests",
    )
    task = models.ForeignKey(
        Task,
        on_delete=models.CASCADE,
        related_name="approval_requests",
    )
    trace = models.ForeignKey(
        AgentExecutionTrace,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="approval_requests",
    )
    kind = models.CharField(
        max_length=32,
        choices=Kind.choices,
        default=Kind.RELEASE,
    )
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.PENDING,
    )
    branch = models.CharField(max_length=255)
    head_sha = models.CharField(max_length=40)
    repo = models.CharField(max_length=255, blank=True, default="")
    pr_url = models.CharField(max_length=500, blank=True, default="")
    engine = models.CharField(
        max_length=32,
        choices=Engine.choices,
        default=Engine.GRAPH,
    )
    requested_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    decided_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="decided_approvals",
    )
    decision_reason = models.TextField(blank=True, default="")
    result = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["-requested_at"]
        indexes = [
            models.Index(
                fields=["organization", "task", "status"],
                name="agents_appr_org_task_stat_idx",
            ),
        ]

    def __str__(self):
        return f"ApprovalRequest #{self.id} — Task #{self.task_id} ({self.status})"

