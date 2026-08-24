from django.core.management.base import BaseCommand
from tasks.models import Task
from agents.observability.langfuse_client import log_agent_execution_to_langfuse, get_langfuse_client


class Command(BaseCommand):
    help = "Seed sample multi-agent traces into Langfuse dashboard"

    def handle(self, *args, **options):
        client = get_langfuse_client()
        self.stdout.write("Testing Langfuse connection...")

        task = Task.objects.first()
        if not task:
            self.stdout.write(self.style.WARNING("No tasks found in database. Run seed_demo first."))
            return

        roles = [
            ("pm", "Decompose user roadmap into sprint tickets", "Created 3 engineering tickets for sprint"),
            ("tech_lead", "Analyze architecture and concurrency locks", "Decomposed into backend and frontend tasks"),
            ("backend", "Scaffold Django REST endpoints and database schema", "Opened PR feat/ticket-1"),
            ("qa", "Run integration tests with concurrency > 50 req/s", "14 tests passed, 0 failures"),
        ]

        for role, prompt, resp in roles:
            url = log_agent_execution_to_langfuse(
                task=task,
                agent_role=role,
                prompt=prompt,
                response_text=resp,
                thoughts=[
                    f"[Antigravity SDK: Thinking] Analyzing scope for {role}",
                    "[Antigravity SDK: Planning] Formulating technical execution plan",
                ],
                tool_calls=[],
                tokens=420,
                cost=0.0042,
                session_id=f"ticket-{task.id}",
            )
            self.stdout.write(self.style.SUCCESS(f"Logged trace for agent [{role}] -> {url}"))

        self.stdout.write(self.style.SUCCESS("All traces sent to Langfuse!"))
