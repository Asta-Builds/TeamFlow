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
