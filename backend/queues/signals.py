import logging
import traceback
from typing import Any, Optional
from celery.signals import task_failure
from django.utils import timezone

logger = logging.getLogger(__name__)


@task_failure.connect
def handle_celery_task_failure(
    sender: Any = None,
    task_id: Optional[str] = None,
    exception: Optional[Exception] = None,
    args: Optional[list] = None,
    kwargs: Optional[dict] = None,
    traceback_obj: Optional[Any] = None,
    einfo: Optional[Any] = None,
    **extra: Any,
) -> None:
    """
    Celery signal receiver triggered whenever an asynchronous task raises an unhandled exception.
    Persists the failure metadata into the DeadLetterMessage model for administrative review and replay.
    """
    from .models import DeadLetterMessage

    task_name = getattr(sender, "name", str(sender)) if sender else "unknown_task"
    exc_class = exception.__class__.__name__ if exception else "UnknownException"
    exc_msg = str(exception) if exception else ""

    tb_str = ""
    if einfo:
        tb_str = str(einfo)
    elif traceback_obj:
        tb_str = "".join(traceback.format_tb(traceback_obj))

    clean_args = []
    if args:
        try:
            # Test JSON serializability
            import json
            json.dumps(args)
            clean_args = list(args)
        except Exception:
            clean_args = [repr(a) for a in args]

    clean_kwargs = {}
    if kwargs:
        try:
            import json
            json.dumps(kwargs)
            clean_kwargs = dict(kwargs)
        except Exception:
            clean_kwargs = {str(k): repr(v) for k, v in kwargs.items()}

    try:
        DeadLetterMessage.objects.create(
            task_id=task_id or f"untracked-{timezone.now().timestamp()}",
            task_name=task_name,
            queue_name="teamflow.tasks",
            routing_key="tasks",
            exchange="teamflow",
            args=clean_args,
            kwargs=clean_kwargs,
            exception_class=exc_class,
            exception_message=exc_msg,
            traceback=tb_str,
            status=DeadLetterMessage.Status.PENDING,
        )
        logger.warning(
            "Captured failed Celery task into DLQ table: Task=%s ID=%s Exception=%s: %s",
            task_name,
            task_id,
            exc_class,
            exc_msg,
        )
    except Exception as save_err:
        logger.error("Failed to persist DeadLetterMessage for task %s: %s", task_id, save_err)
