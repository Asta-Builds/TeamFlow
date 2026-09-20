import ast
import os
import time
from typing import List

from .result import StepResult, VerificationResult
from .toolchain import SKIP_DIRS


def run_static_checks(workspace: str) -> VerificationResult:
    start_time = time.time()
    errors: List[str] = []

    if os.path.isdir(workspace):
        for root, dirs, files in os.walk(workspace):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for file in files:
                if file.endswith(".py"):
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, workspace).replace("\\", "/")
                    try:
                        with open(file_path, "r", encoding="utf-8", errors="replace") as fh:
                            content = fh.read()
                        ast.parse(content, filename=rel_path)
                    except SyntaxError as syn_err:
                        errors.append(
                            f"Python SyntaxError in {rel_path}:{syn_err.lineno} - {syn_err.msg}"
                        )

    duration_s = round(time.time() - start_time, 3)

    if errors:
        steps = [
            StepResult(
                name="static analysis",
                command="static analysis",
                cwd=".",
                exit_code=1,
                conclusion="failure",
                duration_s=0.0,
                output_tail=err,
            )
            for err in errors
        ]
        return VerificationResult(
            status="failed",
            executor="static",
            reason=f"static checks failed with {len(errors)} error(s): {errors[0]}",
            steps=steps,
            duration_s=duration_s,
        )

    return VerificationResult(
        status="unverified",
        executor="static",
        reason="static checks found no errors, but static checks cannot approve code",
        steps=[],
        duration_s=duration_s,
    )
