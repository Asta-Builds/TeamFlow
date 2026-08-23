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
