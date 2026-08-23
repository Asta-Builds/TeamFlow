from typing import TypedDict, Literal, Optional, List, Dict, Any


class TicketState(TypedDict, total=False):
    """
    Shared state that flows through the LangGraph Multi-Agent Orchestration Graph.
    Corresponds to Section 5 in Multi_Agent_Architecture_LangChain.md.
    """
    ticket_id: int
    project_id: int
    project_name: str
    title: str
    description: str
    status: Literal["todo", "in_progress", "in_review", "qa", "done", "blocked"]
    assigned_agent: str
    priority: Literal["low", "medium", "high", "urgent"]
    task_type: Literal["feature", "bug", "task"]
    pr_url: Optional[str]
    qa_result: Optional[Literal["passed", "failed"]]
    qa_rejection_reason: Optional[str]
    retrieved_context: List[str]
    history: List[Dict[str, Any]]
    subtasks: List[Dict[str, Any]]
    code_changes: Dict[str, str]
    errors: List[str]
    deployment_status: Optional[str]
    deployment_logs: Optional[str]
    langfuse_session_id: Optional[str]
    total_tokens: int
    total_cost_usd: float
