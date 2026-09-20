from dataclasses import dataclass, field, asdict
from typing import List, Optional, Tuple


@dataclass
class PlanStep:
    name: str            # human label, e.g. "npm run build (frontend)"
    phase: str           # "install" | "check"
    cwd: str             # project root relative to the repo root; "." for the root
    toolchain: str       # "node" | "python"
    argv: List[str]      # the exact command, never built from strings taken out of the repo


@dataclass
class VerificationPlan:
    steps: List[PlanStep] = field(default_factory=list)
    roots: List[Tuple[str, str]] = field(default_factory=list)   # (cwd, toolchain)
    errors: List[str] = field(default_factory=list)

    @property
    def empty(self) -> bool:
        return not self.steps


@dataclass
class StepResult:
    name: str
    command: str                 # the exact command that ran, or the CI step name
    cwd: str
    exit_code: Optional[int]     # None when the executor does not report one (GitHub steps)
    conclusion: str              # "success" | "failure" | "timed_out" | "skipped" | "error"
    duration_s: float
    output_tail: str = ""        # last AGENT_VERIFY_OUTPUT_LIMIT characters of stdout+stderr


@dataclass
class VerificationResult:
    status: str                  # "passed" | "failed" | "unverified"
    executor: str                # "docker" | "github_actions" | "static" | "none"
    reason: str                  # one plain sentence; required for "failed" and "unverified"
    steps: List[StepResult] = field(default_factory=list)
    duration_s: float = 0.0
    details_url: str = ""        # e.g. the GitHub Actions run URL

    @property
    def failed_steps(self) -> List[StepResult]:
        return [s for s in self.steps if s.conclusion != "success" and s.conclusion != "skipped"]

    def to_dict(self) -> dict:
        return asdict(self)
