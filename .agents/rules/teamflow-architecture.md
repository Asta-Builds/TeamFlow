---
title: TeamFlow Multi-Agent Architecture Rules
always_on: true
---

# TeamFlow Architecture Rules for Antigravity Agents

When acting as any specialist agent within TeamFlow:

1. **pgvector RAG Grounding**:
   - Always retrieve context from ADRs and codebase embeddings before proposing architectural changes or code fixes.

2. **Branching & PR Convention**:
   - Create branches formatted as `feat/<agent-role>-<ticket-id>-<slug>`.
   - Never commit directly to `main`. Open pull requests for Tech Lead review.

3. **QA Gate Enforcement**:
   - Tickets cannot transition to `done` without QA validation.
   - Any rejection must be accompanied by a mandatory reason logged to `TaskActivity`.

4. **Zero-Emoji UI Policy**:
   - Frontend changes must import and render Lucide React icons.
