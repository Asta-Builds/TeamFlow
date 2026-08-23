from typing import List, Dict, Any, Optional
from agents.rag.vector_store import query_similar_chunks


def retrieve_context(query: str, project_id: Optional[int] = None, limit: int = 3) -> List[str]:
    """
    RAG Retrieval Tool:
    Pulls relevant codebase chunks, ADRs, and architecture patterns from PostgreSQL + pgvector.
    Used by all specialist agents to ground decisions and code generation.
    """
    results = query_similar_chunks(query, project_id=project_id, limit=limit)
    if not results:
        # Fallback context if no embeddings ingested yet
        return [
            f"Context for query '{query}': TeamFlow SaaS platform with Django backend (JWT auth, PostgreSQL) and Next.js 16 frontend (Tailwind CSS, TypeScript)."
        ]
    return [
        f"[{r['file_path']}] {r['content']}"
        for r in results
    ]
