"""
Task Repository (Repository Pattern).
Abstracts persistence and query optimizations (eliminating N+1 query patterns
with select_related and prefetch_related projection queries).
"""

from typing import Optional, Protocol, Sequence
from django.db.models import QuerySet
from tasks.models import Task


class TaskRepositoryInterface(Protocol):
    """ISP-compliant interface for Task persistence and query projections."""

    def get_by_id(self, task_id: int) -> Optional[Task]:
        """Fetch a single task by ID."""
        ...

    def get_with_details(self, task_id: int) -> Optional[Task]:
        """Fetch a task with relations prefetched to avoid N+1 queries."""
        ...

    def save(self, task: Task) -> Task:
        """Persist a task entity."""
        ...

    def list_board_tasks(self, project_id: int) -> QuerySet[Task]:
        """Return optimized QuerySet for the Kanban board projection."""
        ...


class DjangoTaskRepository:
    """Concrete Django ORM implementation of TaskRepositoryInterface."""

    def get_by_id(self, task_id: int) -> Optional[Task]:
        try:
            return Task.objects.get(id=task_id)
        except Task.DoesNotExist:
            return None

    def get_with_details(self, task_id: int) -> Optional[Task]:
        try:
            return (
                Task.objects.select_related("project", "assignee", "created_by", "organization")
                .prefetch_related("comments__author", "activities__actor")
                .get(id=task_id)
            )
        except Task.DoesNotExist:
            return None

    def save(self, task: Task) -> Task:
        task.save()
        return task

    def list_board_tasks(self, project_id: int) -> QuerySet[Task]:
        """
        High-performance board projection:
        Pre-fetches assignee, created_by, and project in a single JOIN to prevent N+1 hits
        when rendering Kanban columns.
        """
        return (
            Task.objects.filter(project_id=project_id)
            .select_related("assignee", "created_by", "project")
            .order_by("order", "-created_at")
        )
