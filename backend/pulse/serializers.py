from rest_framework import serializers

from teamflow.permissions import visible_tasks_for
from .models import PulseFocusSession, PulseNote, PulsePlanItem


class PulsePlanItemSerializer(serializers.ModelSerializer):
    task_title = serializers.CharField(source="task.title", read_only=True)
    project_id = serializers.IntegerField(source="task.project_id", read_only=True)
    project_name = serializers.CharField(source="task.project.name", read_only=True)
    task_status = serializers.CharField(source="task.status", read_only=True)
    task_priority = serializers.CharField(source="task.priority", read_only=True)
    task_type = serializers.CharField(source="task.task_type", read_only=True)
    due_date = serializers.DateField(source="task.due_date", read_only=True)
    can_complete_task = serializers.SerializerMethodField()

    class Meta:
        model = PulsePlanItem
        fields = [
            "id",
            "task",
            "task_title",
            "project_id",
            "project_name",
            "task_status",
            "task_priority",
            "task_type",
            "due_date",
            "date",
            "time_block",
            "position",
            "can_complete_task",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "can_complete_task"]

    def get_can_complete_task(self, item):
        request = self.context.get("request")
        if not request:
            return False
        user = request.user
        return bool(
            user.is_privileged
            or item.task.assignee_id == user.id
            or item.task.created_by_id == user.id
        )

    def validate_task(self, task):
        request = self.context.get("request")
        if not request or not visible_tasks_for(request.user).filter(pk=task.pk).exists():
            raise serializers.ValidationError("Task is not available in your workspace.")
        if self.instance and task.pk != self.instance.task_id:
            raise serializers.ValidationError("A planned task cannot be replaced. Create a new plan item instead.")
        return task

    def validate(self, attrs):
        request = self.context.get("request")
        if not request or self.instance:
            return attrs
        selected_date = attrs.get("date")
        task = attrs.get("task")
        if selected_date and task and PulsePlanItem.objects.filter(
            user=request.user,
            date=selected_date,
            task=task,
        ).exists():
            raise serializers.ValidationError(
                {"task": "This task is already in your plan for that day."}
            )
        return attrs


class PulseNoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = PulseNote
        fields = ["id", "date", "body", "created_at", "updated_at"]
        read_only_fields = ["id", "date", "created_at", "updated_at"]


class PulseFocusSessionSerializer(serializers.ModelSerializer):
    task_title = serializers.CharField(source="plan_item.task.title", read_only=True)
    project_name = serializers.CharField(source="plan_item.task.project.name", read_only=True)
    running_since = serializers.DateTimeField(source="last_resumed_at", read_only=True)

    class Meta:
        model = PulseFocusSession
        fields = [
            "id",
            "plan_item",
            "task_title",
            "project_name",
            "status",
            "started_at",
            "running_since",
            "elapsed_seconds",
            "ended_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields
