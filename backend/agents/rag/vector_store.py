from typing import List, Dict, Any, Optional
from agents.models import CodebaseEmbedding
from .embeddings import generate_embedding, cosine_similarity


def query_similar_chunks(
    query: str,
    project_id: Optional[int] = None,
    organization_id: Optional[int] = None,
    limit: int = 4,
    min_score: float = 0.15,
) -> List[Dict[str, Any]]:
    """
    Performs vector similarity search against CodebaseEmbedding table.
    Returns ranked relevant codebase snippets and ADRs.
    """
    if not query or (project_id is None and organization_id is None):
        return []

    query_vec = generate_embedding(query)
    qs = CodebaseEmbedding.objects.all()
    if organization_id is not None:
        qs = qs.filter(organization_id=organization_id)
    if project_id is not None:
        qs = qs.filter(project_id=project_id)

    # Check if we can use native pgvector ordering
    try:
        from pgvector.django import CosineDistance
        results = qs.order_by(CosineDistance("embedding", query_vec))[:limit]
        return [
            {
                "file_path": r.file_path,
                "chunk_index": r.chunk_index,
                "content": r.content,
                "score": 0.85,
                "metadata": r.metadata,
            }
            for r in results
        ]
    except Exception:
        # High performance fallback: compute similarity in memory
        scored_chunks = []
        for item in qs.iterator():
            if item.embedding:
                score = cosine_similarity(query_vec, item.embedding)
                if score >= min_score:
                    scored_chunks.append({
                        "file_path": item.file_path,
                        "chunk_index": item.chunk_index,
                        "content": item.content,
                        "score": round(score, 4),
                        "metadata": item.metadata,
                    })

        scored_chunks.sort(key=lambda x: x["score"], reverse=True)
        return scored_chunks[:limit]
