import json
import os
from typing import List, Tuple
from .result import VerificationPlan, PlanStep

SKIP_DIRS = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "__pycache__",
    "dist",
    "build",
    ".next",
}


def _is_npm_test_placeholder(test_cmd: str) -> bool:
    clean = test_cmd.strip()
    if clean in {
        'echo "Error: no test specified" && exit 1',
        "echo 'Error: no test specified' && exit 1",
        'echo \\"Error: no test specified\\" && exit 1',
    }:
        return True
    lower = clean.lower()
    if "no test specified" in lower and "exit 1" in lower:
        return True
    return False


def _has_python_tests(root_dir: str) -> bool:
    tests_dir = os.path.join(root_dir, "tests")
    if os.path.isdir(tests_dir):
        return True
    for current, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f.endswith(".py") and (f.startswith("test_") or f.endswith("_test.py")):
                return True
    return False


def detect_plan(workspace: str) -> VerificationPlan:
    plan = VerificationPlan()
    if not os.path.isdir(workspace):
        return plan

    candidate_roots: List[Tuple[str, str]] = []

    for root, dirs, files in os.walk(workspace):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        rel = os.path.relpath(root, workspace)
        if rel == ".":
            depth = 0
            cwd = "."
        else:
            rel_posix = rel.replace("\\", "/")
            parts = [p for p in rel_posix.split("/") if p and p != "."]
            depth = len(parts)
            cwd = rel_posix

        if depth > 2:
            dirs.clear()
            continue
        if depth == 2:
            dirs.clear()

        candidate_roots.append((cwd, root))

    candidate_roots.sort(key=lambda item: item[0])

    for cwd, abs_path in candidate_roots:
        root_install_steps: List[PlanStep] = []
        root_check_steps: List[PlanStep] = []

        # Check Node manifest
        pkg_json_path = os.path.join(abs_path, "package.json")
        if os.path.isfile(pkg_json_path):
            try:
                with open(pkg_json_path, "r", encoding="utf-8") as f:
                    pkg_data = json.load(f)
                if not isinstance(pkg_data, dict):
                    raise ValueError("package.json root is not an object")
            except Exception:
                plan.errors.append(f"package.json in {cwd} is not valid JSON")
                continue

            plan.roots.append((cwd, "node"))

            lock_exists = os.path.isfile(os.path.join(abs_path, "package-lock.json"))
            if lock_exists:
                install_argv = ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"]
                install_name = "npm ci" if cwd == "." else f"npm ci ({cwd})"
            else:
                install_argv = ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"]
                install_name = "npm install" if cwd == "." else f"npm install ({cwd})"

            root_install_steps.append(
                PlanStep(
                    name=install_name,
                    phase="install",
                    cwd=cwd,
                    toolchain="node",
                    argv=install_argv,
                )
            )

            scripts = pkg_data.get("scripts")
            if not isinstance(scripts, dict):
                scripts = {}

            build_script = scripts.get("build")
            has_build = bool(build_script)
            if has_build:
                build_name = "npm run build" if cwd == "." else f"npm run build ({cwd})"
                root_check_steps.append(
                    PlanStep(
                        name=build_name,
                        phase="check",
                        cwd=cwd,
                        toolchain="node",
                        argv=["npm", "run", "build"],
                    )
                )

            test_script = scripts.get("test")
            if test_script and not _is_npm_test_placeholder(str(test_script)):
                test_name = "npm test" if cwd == "." else f"npm test ({cwd})"
                root_check_steps.append(
                    PlanStep(
                        name=test_name,
                        phase="check",
                        cwd=cwd,
                        toolchain="node",
                        argv=["npm", "test"],
                    )
                )

            tsconfig_exists = os.path.isfile(os.path.join(abs_path, "tsconfig.json"))
            deps = pkg_data.get("dependencies") or {}
            dev_deps = pkg_data.get("devDependencies") or {}
            has_ts = ("typescript" in deps) or ("typescript" in dev_deps)
            if tsconfig_exists and has_ts and not has_build:
                tsc_name = "npx --no-install tsc --noEmit" if cwd == "." else f"npx --no-install tsc --noEmit ({cwd})"
                root_check_steps.append(
                    PlanStep(
                        name=tsc_name,
                        phase="check",
                        cwd=cwd,
                        toolchain="node",
                        argv=["npx", "--no-install", "tsc", "--noEmit"],
                    )
                )

        # Check Python manifest
        reqs_path = os.path.join(abs_path, "requirements.txt")
        pyproj_path = os.path.join(abs_path, "pyproject.toml")
        has_reqs = os.path.isfile(reqs_path)
        has_pyproj = os.path.isfile(pyproj_path)

        if has_reqs or has_pyproj:
            plan.roots.append((cwd, "python"))

            venv_name = "python -m venv .venv" if cwd == "." else f"python -m venv .venv ({cwd})"
            root_install_steps.append(
                PlanStep(
                    name=venv_name,
                    phase="install",
                    cwd=cwd,
                    toolchain="python",
                    argv=["python", "-m", "venv", ".venv"],
                )
            )

            if has_reqs:
                pip_argv = [".venv/bin/pip", "install", "-r", "requirements.txt"]
                pip_name = ".venv/bin/pip install -r requirements.txt" if cwd == "." else f".venv/bin/pip install -r requirements.txt ({cwd})"
            else:
                pip_argv = [".venv/bin/pip", "install", "."]
                pip_name = ".venv/bin/pip install ." if cwd == "." else f".venv/bin/pip install . ({cwd})"

            root_install_steps.append(
                PlanStep(
                    name=pip_name,
                    phase="install",
                    cwd=cwd,
                    toolchain="python",
                    argv=pip_argv,
                )
            )

            comp_argv = [".venv/bin/python", "-m", "compileall", "-q", "-x", r"[/\\]\.venv", "."]
            comp_name = ".venv/bin/python -m compileall -q ." if cwd == "." else f".venv/bin/python -m compileall -q . ({cwd})"
            root_check_steps.append(
                PlanStep(
                    name=comp_name,
                    phase="check",
                    cwd=cwd,
                    toolchain="python",
                    argv=comp_argv,
                )
            )

            if _has_python_tests(abs_path):
                pytest_argv = [".venv/bin/python", "-m", "pytest", "-q"]
                pytest_name = ".venv/bin/python -m pytest -q" if cwd == "." else f".venv/bin/python -m pytest -q ({cwd})"
                root_check_steps.append(
                    PlanStep(
                        name=pytest_name,
                        phase="check",
                        cwd=cwd,
                        toolchain="python",
                        argv=pytest_argv,
                    )
                )

        plan.steps.extend(root_install_steps)
        plan.steps.extend(root_check_steps)

    return plan
