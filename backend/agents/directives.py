"""
Explicit workspace directives recognised in human prompts.

Directives trigger real git or build work, so matching is deliberately strict:
whole phrases only, and never for questions. "Add push notifications" or
"pull request feedback" must not pull or push anything.
"""

from __future__ import annotations

import re

PULL_DIRECTIVE = re.compile(
    r"\b(git pull|pull (the )?latest( changes| code)?|pull code|sync(hroni[sz]e)? (the workspace )?with main|"
    r"synchronise le code|fetch main)\b",
    re.IGNORECASE,
)
BUILD_DIRECTIVE = re.compile(
    r"\b(run (the )?build|build the project|run (the )?(static )?checks|compile the project|"
    r"lance le build|tester le projet)\b",
    re.IGNORECASE,
)
PUSH_DIRECTIVE = re.compile(
    r"\b(git push|push (the |this |your |my )?(feature )?branch)\b",
    re.IGNORECASE,
)
_QUESTION = re.compile(r"^\s*(how|what|why|when|should|can|could|would|est-ce que|comment)\b", re.IGNORECASE)

# Seats allowed to push feature branches from a prompt. Nobody pushes main from a prompt.
PUSH_ROLES = {"backend", "frontend", "tech_lead"}


def is_question(prompt: str) -> bool:
    text = (prompt or "").strip()
    return text.endswith("?") or bool(_QUESTION.match(text))


def detect_directives(prompt: str) -> set[str]:
    """Return the subset of {"pull", "build", "push"} explicitly requested by the prompt."""
    text = prompt or ""
    if not text.strip() or is_question(text):
        return set()
    found = set()
    if PULL_DIRECTIVE.search(text):
        found.add("pull")
    if BUILD_DIRECTIVE.search(text):
        found.add("build")
    if PUSH_DIRECTIVE.search(text):
        found.add("push")
    return found
