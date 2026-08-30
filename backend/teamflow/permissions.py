from django.db.models import Q
from rest_framework import permissions


class IsPrivilegedOrReadOnly(permissions.BasePermission):
    """Read for any authenticated user; writes require Tech Lead / CEO / staff."""

    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return request.user and request.user.is_authenticated
        return bool(request.user and request.user.is_authenticated and request.user.is_privileged)


class IsOwnerOrPrivileged(permissions.BasePermission):
    """Object-level: the owner/assignee/author, or a privileged user, may write."""

    owner_fields = ("owner", "assignee", "author", "triggered_by", "created_by")

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        if request.user.is_privileged:
            return True
        for field in self.owner_fields:
            if getattr(obj, field, None) == request.user:
                return True
        return False


def visible_projects_for(user):
    """Return projects the user may access within their workspace."""
    from projects.models import Project

    if not user.is_authenticated or user.organization_id is None:
        return Project.objects.none()

    projects = Project.objects.filter(organization_id=user.organization_id)
    if user.is_privileged:
        return projects

    return projects.filter(Q(owner=user) | Q(members=user)).distinct()


def visible_tasks_for(user):
    """Return tickets the user may access within visible workspace projects."""
    from tasks.models import Task

    if not user.is_authenticated or user.organization_id is None:
        return Task.objects.none()

    tasks = Task.objects.filter(organization_id=user.organization_id)
    if user.is_privileged:
        return tasks

    return tasks.filter(
        Q(project__owner=user) | Q(project__members=user)
    ).distinct()


def user_can_access_project(user, project):
    """Check a concrete project without leaking cross-workspace membership."""
    if not user.is_authenticated or user.organization_id != project.organization_id:
        return False
    if user.is_privileged or project.owner_id == user.id:
        return True
    return project.members.filter(pk=user.pk).exists()
