from datetime import date as date_type, timedelta

from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework import decorators, permissions, response, status, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.views import APIView

from tasks.models import Task
from teamflow.permissions import visible_tasks_for
from .models import PulseFocusSession, PulseNote, PulsePlanItem
from .serializers import (
    PulseFocusSessionSerializer,
    PulseNoteSerializer,
    PulsePlanItemSerializer,
)


def requested_date(request):
    value = request.query_params.get("date") or request.data.get("date")
    if not value:
        return timezone.localdate()
    try:
        return date_type.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError({"date": "Use an ISO date in YYYY-MM-DD format."}) from exc


def require_organization(user):
    if not user.organization_id:
        raise PermissionDenied("An active workspace is required to use Pulse.")
    return user.organization


def elapsed_with_running_time(session, now=None):
    elapsed = session.elapsed_seconds
    if session.status == PulseFocusSession.Status.ACTIVE and session.last_resumed_at:
        now = now or timezone.now()
        elapsed += max(0, int((now - session.last_resumed_at).total_seconds()))
    return elapsed


class PulsePlanItemViewSet(viewsets.ModelViewSet):
    serializer_class = PulsePlanItemSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["date", "time_block"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return PulsePlanItem.objects.none()
        user = self.request.user
        if not user.is_authenticated or not user.organization_id:
            return PulsePlanItem.objects.none()
        return (
            PulsePlanItem.objects.filter(user=user, organization=user.organization)
            .select_related("task", "task__project", "task__assignee", "task__created_by")
        )

    def perform_create(self, serializer):
        user = self.request.user
        serializer.save(user=user, organization=require_organization(user))


class PulseNoteView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        selected_date = requested_date(request)
        note = PulseNote.objects.filter(
            user=user,
            organization=require_organization(user),
            date=selected_date,
        ).first()
        if note is None:
            return response.Response({"date": selected_date, "body": ""})
        return response.Response(PulseNoteSerializer(note).data)

    def put(self, request):
        user = request.user
        selected_date = requested_date(request)
        organization = require_organization(user)
        note, _ = PulseNote.objects.get_or_create(
            user=user,
            organization=organization,
            date=selected_date,
        )
        serializer = PulseNoteSerializer(note, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return response.Response(serializer.data)


class PulseFocusSessionViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PulseFocusSessionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return PulseFocusSession.objects.none()
        user = self.request.user
        if not user.is_authenticated or not user.organization_id:
            return PulseFocusSession.objects.none()
        return PulseFocusSession.objects.filter(
            user=user,
            organization=user.organization,
        ).select_related("plan_item", "plan_item__task", "plan_item__task__project")

    def _current(self, request, pk):
        return self.get_object()

    def _serialized(self, session):
        payload = PulseFocusSessionSerializer(session, context={"request": self.request}).data
        payload["elapsed_seconds"] = elapsed_with_running_time(session)
        return payload

    @decorators.action(detail=False, methods=["post"])
    def start(self, request):
        user = request.user
        organization = require_organization(user)
        active = self.get_queryset().filter(
            status__in=[PulseFocusSession.Status.ACTIVE, PulseFocusSession.Status.PAUSED]
        ).first()
        if active:
            return response.Response(
                {"detail": "Finish or resume your existing focus session first."},
                status=status.HTTP_409_CONFLICT,
            )

        plan_item = None
        plan_item_id = request.data.get("plan_item")
        if plan_item_id is not None:
            plan_item = PulsePlanItem.objects.filter(
                pk=plan_item_id,
                user=user,
                organization=organization,
            ).select_related("task", "task__project").first()
            if plan_item is None:
                raise ValidationError({"plan_item": "Plan item is not available in your Pulse plan."})

        now = timezone.now()
        session = PulseFocusSession.objects.create(
            user=user,
            organization=organization,
            plan_item=plan_item,
            status=PulseFocusSession.Status.ACTIVE,
            started_at=now,
            last_resumed_at=now,
        )
        return response.Response(self._serialized(session), status=status.HTTP_201_CREATED)

    @decorators.action(detail=True, methods=["post"])
    def pause(self, request, pk=None):
        session = self._current(request, pk)
        if session.status != PulseFocusSession.Status.ACTIVE:
            return response.Response(
                {"detail": "Only an active focus session can be paused."},
                status=status.HTTP_409_CONFLICT,
            )
        session.elapsed_seconds = elapsed_with_running_time(session)
        session.last_resumed_at = None
        session.status = PulseFocusSession.Status.PAUSED
        session.save(update_fields=["elapsed_seconds", "last_resumed_at", "status", "updated_at"])
        return response.Response(self._serialized(session))

    @decorators.action(detail=True, methods=["post"])
    def resume(self, request, pk=None):
        session = self._current(request, pk)
        if session.status != PulseFocusSession.Status.PAUSED:
            return response.Response(
                {"detail": "Only a paused focus session can be resumed."},
                status=status.HTTP_409_CONFLICT,
            )
        session.status = PulseFocusSession.Status.ACTIVE
        session.last_resumed_at = timezone.now()
        session.save(update_fields=["status", "last_resumed_at", "updated_at"])
        return response.Response(self._serialized(session))

    @decorators.action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        session = self._current(request, pk)
        if session.status not in [PulseFocusSession.Status.ACTIVE, PulseFocusSession.Status.PAUSED]:
            return response.Response(
                {"detail": "This focus session is already completed."},
                status=status.HTTP_409_CONFLICT,
            )
        now = timezone.now()
        session.elapsed_seconds = elapsed_with_running_time(session, now)
        session.last_resumed_at = None
        session.status = PulseFocusSession.Status.COMPLETED
        session.ended_at = now
        session.save(
            update_fields=[
                "elapsed_seconds",
                "last_resumed_at",
                "status",
                "ended_at",
                "updated_at",
            ]
        )
        return response.Response(self._serialized(session))


class PulseDashboardView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        organization = require_organization(user)
        selected_date = requested_date(request)
        week_start = selected_date - timedelta(days=6)

        plan_items = (
            PulsePlanItem.objects.filter(
                user=user,
                organization=organization,
                date=selected_date,
            )
            .select_related("task", "task__project", "task__assignee", "task__created_by")
            .order_by("time_block", "position", "created_at")
        )
        planned_task_ids = plan_items.values_list("task_id", flat=True)
        candidate_tasks = (
            visible_tasks_for(user)
            .filter(~Q(status=Task.Status.DONE))
            .filter(Q(assignee=user) | Q(created_by=user) | Q(due_date=selected_date))
            .exclude(pk__in=planned_task_ids)
            .select_related("project")
            .order_by("due_date", "priority", "created_at")[:12]
        )

        note = PulseNote.objects.filter(
            user=user,
            organization=organization,
            date=selected_date,
        ).first()
        sessions = PulseFocusSession.objects.filter(
            user=user,
            organization=organization,
            started_at__date=selected_date,
        )
        current_session = sessions.filter(
            status__in=[PulseFocusSession.Status.ACTIVE, PulseFocusSession.Status.PAUSED]
        ).select_related("plan_item", "plan_item__task", "plan_item__task__project").first()

        weekly = (
            PulsePlanItem.objects.filter(
                user=user,
                organization=organization,
                date__range=(week_start, selected_date),
            )
            .values("date")
            .annotate(total=Count("id"), completed=Count("id", filter=Q(task__status=Task.Status.DONE)))
        )
        weekly_by_date = {entry["date"]: entry for entry in weekly}
        weekly_progress = []
        for offset in range(7):
            day = week_start + timedelta(days=offset)
            entry = weekly_by_date.get(day, {"total": 0, "completed": 0})
            weekly_progress.append(
                {
                    "date": day,
                    "total": entry["total"],
                    "completed": entry["completed"],
                }
            )

        total = plan_items.count()
        completed = plan_items.filter(task__status=Task.Status.DONE).count()
        focused_seconds = sessions.aggregate(total=Sum("elapsed_seconds"))["total"] or 0
        if current_session:
            focused_seconds += elapsed_with_running_time(current_session) - current_session.elapsed_seconds

        return response.Response(
            {
                "date": selected_date,
                "plan_items": PulsePlanItemSerializer(plan_items, many=True, context={"request": request}).data,
                "candidate_tasks": [
                    {
                        "id": task.id,
                        "title": task.title,
                        "project_id": task.project_id,
                        "project_name": task.project.name,
                        "priority": task.priority,
                        "status": task.status,
                        "due_date": task.due_date,
                    }
                    for task in candidate_tasks
                ],
                "note": PulseNoteSerializer(note).data if note else {"date": selected_date, "body": ""},
                "current_session": self._session_payload(current_session, request),
                "summary": {
                    "planned": total,
                    "completed": completed,
                    "completion_percentage": round((completed / total) * 100) if total else 0,
                    "focused_seconds": focused_seconds,
                },
                "weekly_progress": weekly_progress,
            }
        )

    @staticmethod
    def _session_payload(session, request):
        if not session:
            return None
        payload = PulseFocusSessionSerializer(session, context={"request": request}).data
        payload["elapsed_seconds"] = elapsed_with_running_time(session)
        return payload
