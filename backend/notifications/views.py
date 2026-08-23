from rest_framework import permissions, response, viewsets, decorators
from .models import Notification
from .serializers import NotificationSerializer


class NotificationViewSet(viewsets.ModelViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Notification.objects.none()
        user = self.request.user
        if not user.is_authenticated:
            return Notification.objects.none()
        return Notification.objects.filter(recipient=user).select_related("actor")

    @decorators.action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        """Mark single notification as read."""
        notif = self.get_object()
        notif.is_read = True
        notif.save(update_fields=["is_read"])
        return response.Response({"status": "ok", "is_read": True})

    @decorators.action(detail=False, methods=["post"])
    def read_all(self, request):
        """Mark all notifications for current user as read."""
        self.get_queryset().filter(is_read=False).update(is_read=True)
        return response.Response({"status": "ok", "message": "All notifications marked as read"})
