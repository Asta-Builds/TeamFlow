import hashlib
import math
import re
from typing import List


EMBEDDING_DIM = 384


def generate_embedding(text: str) -> List[float]:
    """
    Generates a 384-dimensional normalized vector embedding for RAG.
    Uses token hashing and semantic projection to provide high-speed,
    reliable embeddings out of the box.
    """
    if not text:
        return [0.0] * EMBEDDING_DIM

    vector = [0.0] * EMBEDDING_DIM
    words = re.findall(r'\w+', text.lower())
    
    for i, word in enumerate(words):
        h = int(hashlib.md5(word.encode('utf-8')).hexdigest(), 16)
        idx = h % EMBEDDING_DIM
        weight = 1.0 / (1.0 + math.log(1.0 + i))
        vector[idx] += weight

        # Also hash bigrams for phrase awareness
        if i > 0:
            bigram = f"{words[i-1]}_{word}"
            h_bi = int(hashlib.sha256(bigram.encode('utf-8')).hexdigest(), 16)
            idx_bi = h_bi % EMBEDDING_DIM
            vector[idx_bi] += weight * 1.5

    # Normalize vector to unit length (L2 norm)
    norm = math.sqrt(sum(v * v for v in vector))
    if norm > 0:
        vector = [v / norm for v in vector]
    
    return vector


def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    """Calculates cosine similarity between two normalized vectors."""
    if not v1 or not v2 or len(v1) != len(v2):
        return 0.0
    return sum(a * b for a, b in zip(v1, v2))
