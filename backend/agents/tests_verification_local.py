import io
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, override_settings

from agents.verification import (
    PlanStep,
    StepResult,
    VerificationPlan,
    VerificationResult,
    detect_plan,
    verify_workspace,
)
from agents.verification.docker_executor import DockerExecutor, safe_extract_tar
from agents.verification.static import run_static_checks


def _make_tar_bytes(members: dict) -> bytes:
    """Helper to create tar archive bytes from a mapping of name -> str/bytes content."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        for name, content in members.items():
            if isinstance(content, str):
                data = content.encode("utf-8")
            else:
                data = content
            ti = tarfile.TarInfo(name=name)
            ti.size = len(data)
            ti.mtime = 0
            tar.addfile(ti, io.BytesIO(data))
    return buf.getvalue()


class StaticCheckTests(SimpleTestCase):
    """Test exact static checks (ast.parse on Python only, no JSON/TS heuristic vetoes)."""

    def setUp(self):
        self.workspace = tempfile.mkdtemp(prefix="test-static-")

    def tearDown(self):
        shutil.rmtree(self.workspace, ignore_errors=True)

    def test_commented_tsconfig_and_bracket_regex_tsx_not_rejected(self):
        # tsconfig with // comments (which fails json.load)
        with open(os.path.join(self.workspace, "tsconfig.json"), "w", encoding="utf-8") as f:
            f.write('// TypeScript config with comments\n{\n  "compilerOptions": {\n    "target": "ES2022"\n  }\n}\n')

        # tsx with regex literal that would break naive brace counting
        src_dir = os.path.join(self.workspace, "src")
        os.makedirs(src_dir, exist_ok=True)
        with open(os.path.join(src_dir, "Component.tsx"), "w", encoding="utf-8") as f:
            f.write("const r = /[{(]/;\nexport const Comp = () => <div>{r.source}</div>;\n")

        # valid python file
        with open(os.path.join(self.workspace, "service.py"), "w", encoding="utf-8") as f:
            f.write("def compute():\n    return 42\n")

        res = run_static_checks(self.workspace)
        self.assertEqual(res.status, "unverified")
        self.assertEqual(res.executor, "static")
        self.assertEqual(res.reason, "static checks found no errors, but static checks cannot approve code")
        self.assertEqual(res.steps, [])

    def test_python_syntax_error_is_rejected(self):
        with open(os.path.join(self.workspace, "broken.py"), "w", encoding="utf-8") as f:
            f.write("def syntax_error(:\n    pass\n")

        res = run_static_checks(self.workspace)
        self.assertEqual(res.status, "failed")
        self.assertEqual(res.executor, "static")
        self.assertIn("Python SyntaxError in broken.py:1", res.reason)
        self.assertEqual(len(res.steps), 1)
        self.assertEqual(res.steps[0].conclusion, "failure")
        self.assertEqual(res.steps[0].command, "static analysis")
        self.assertIn("Python SyntaxError in broken.py:1", res.steps[0].output_tail)


class ToolchainDetectionTests(SimpleTestCase):
    """Test toolchain detection rules across Node and Python repositories."""

    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="test-detect-")

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_node_with_lockfile_build_and_real_test(self):
        pkg = {
            "name": "sample-node",
            "scripts": {
                "build": "next build",
                "test": "jest --coverage",
            },
        }
        with open(os.path.join(self.test_dir, "package.json"), "w", encoding="utf-8") as f:
            json.dump(pkg, f)
        with open(os.path.join(self.test_dir, "package-lock.json"), "w", encoding="utf-8") as f:
            f.write("{}")

        plan = detect_plan(self.test_dir)
        self.assertFalse(plan.empty)
        self.assertEqual(plan.roots, [(".", "node")])
        self.assertEqual(len(plan.steps), 3)

        self.assertEqual(plan.steps[0].name, "npm ci")
        self.assertEqual(plan.steps[0].phase, "install")
        self.assertEqual(plan.steps[0].argv, ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"])

        self.assertEqual(plan.steps[1].name, "npm run build")
        self.assertEqual(plan.steps[1].phase, "check")
        self.assertEqual(plan.steps[1].argv, ["npm", "run", "build"])

        self.assertEqual(plan.steps[2].name, "npm test")
        self.assertEqual(plan.steps[2].phase, "check")
        self.assertEqual(plan.steps[2].argv, ["npm", "test"])

    def test_node_without_lockfile_uses_npm_install(self):
        pkg = {"name": "sample-node"}
        with open(os.path.join(self.test_dir, "package.json"), "w", encoding="utf-8") as f:
            json.dump(pkg, f)

        plan = detect_plan(self.test_dir)
        self.assertEqual(len(plan.steps), 1)
        self.assertEqual(plan.steps[0].name, "npm install")
        self.assertEqual(plan.steps[0].argv, ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"])

    def test_npm_placeholder_test_script_is_not_run(self):
        pkg = {
            "name": "sample-node",
            "scripts": {
                "test": 'echo "Error: no test specified" && exit 1',
            },
        }
        with open(os.path.join(self.test_dir, "package.json"), "w", encoding="utf-8") as f:
            json.dump(pkg, f)

        plan = detect_plan(self.test_dir)
        check_steps = [s for s in plan.steps if s.phase == "check"]
        self.assertEqual(check_steps, [])

    def test_tsc_no_emit_only_when_no_build_script_and_typescript_present(self):
        # Case A: tsconfig + typescript dependency + NO build script -> tsc check present
        pkg_a = {
            "dependencies": {"typescript": "^5.0.0"},
        }
        with open(os.path.join(self.test_dir, "package.json"), "w", encoding="utf-8") as f:
            json.dump(pkg_a, f)
        with open(os.path.join(self.test_dir, "tsconfig.json"), "w", encoding="utf-8") as f:
            f.write("{}")

        plan_a = detect_plan(self.test_dir)
        check_steps_a = [s for s in plan_a.steps if s.phase == "check"]
        self.assertEqual(len(check_steps_a), 1)
        self.assertEqual(check_steps_a[0].name, "npx --no-install tsc --noEmit")
        self.assertEqual(check_steps_a[0].argv, ["npx", "--no-install", "tsc", "--noEmit"])

        # Case B: tsconfig + typescript devDependency + build script present -> only build script
        pkg_b = {
            "devDependencies": {"typescript": "^5.0.0"},
            "scripts": {"build": "webpack --mode production"},
        }
        with open(os.path.join(self.test_dir, "package.json"), "w", encoding="utf-8") as f:
            json.dump(pkg_b, f)

        plan_b = detect_plan(self.test_dir)
        check_steps_b = [s for s in plan_b.steps if s.phase == "check"]
        self.assertEqual(len(check_steps_b), 1)
        self.assertEqual(check_steps_b[0].name, "npm run build")

    def test_python_root_with_tests_directory(self):
        with open(os.path.join(self.test_dir, "requirements.txt"), "w", encoding="utf-8") as f:
            f.write("django>=5.1\n")
        tests_dir = os.path.join(self.test_dir, "tests")
        os.makedirs(tests_dir, exist_ok=True)
        with open(os.path.join(tests_dir, "test_app.py"), "w", encoding="utf-8") as f:
            f.write("def test_ok(): pass\n")

        plan = detect_plan(self.test_dir)
        self.assertEqual(plan.roots, [(".", "python")])
        self.assertEqual(len(plan.steps), 4)

        self.assertEqual(plan.steps[0].argv, ["python", "-m", "venv", ".venv"])
        self.assertEqual(plan.steps[0].phase, "install")

        self.assertEqual(plan.steps[1].argv, [".venv/bin/pip", "install", "-r", "requirements.txt"])
        self.assertEqual(plan.steps[1].phase, "install")

        self.assertEqual(plan.steps[2].argv, [".venv/bin/python", "-m", "compileall", "-q", "-x", r"[/\\]\.venv", "."])
        self.assertEqual(plan.steps[2].phase, "check")

        self.assertEqual(plan.steps[3].argv, [".venv/bin/python", "-m", "pytest", "-q"])
        self.assertEqual(plan.steps[3].phase, "check")

    def test_python_root_with_pyproject_without_requirements(self):
        with open(os.path.join(self.test_dir, "pyproject.toml"), "w", encoding="utf-8") as f:
            f.write("[project]\nname = 'demo'\n")

        plan = detect_plan(self.test_dir)
        pip_step = plan.steps[1]
        self.assertEqual(pip_step.argv, [".venv/bin/pip", "install", "."])

    def test_roots_found_one_and_two_levels_deep_and_not_three(self):
        # Level 1: frontend
        frontend_dir = os.path.join(self.test_dir, "frontend")
        os.makedirs(frontend_dir)
        with open(os.path.join(frontend_dir, "package.json"), "w", encoding="utf-8") as f:
            json.dump({"name": "fe"}, f)

        # Level 2: services/auth
        auth_dir = os.path.join(self.test_dir, "services", "auth")
        os.makedirs(auth_dir)
        with open(os.path.join(auth_dir, "requirements.txt"), "w", encoding="utf-8") as f:
            f.write("flask\n")

        # Level 3: a/b/c
        deep_dir = os.path.join(self.test_dir, "a", "b", "c")
        os.makedirs(deep_dir)
        with open(os.path.join(deep_dir, "package.json"), "w", encoding="utf-8") as f:
            json.dump({"name": "deep"}, f)

        plan = detect_plan(self.test_dir)
        roots = plan.roots
        self.assertIn(("frontend", "node"), roots)
        self.assertIn(("services/auth", "python"), roots)
        self.assertNotIn(("a/b/c", "node"), roots)

    def test_node_modules_and_venv_are_skipped(self):
        nm_dir = os.path.join(self.test_dir, "node_modules", "some-dep")
        os.makedirs(nm_dir)
        with open(os.path.join(nm_dir, "package.json"), "w", encoding="utf-8") as f:
            json.dump({"name": "skipped-dep"}, f)

        venv_dir = os.path.join(self.test_dir, ".venv")
        os.makedirs(venv_dir)
        with open(os.path.join(venv_dir, "pyproject.toml"), "w", encoding="utf-8") as f:
            f.write("[project]\nname = 'skipped-venv'\n")

        plan = detect_plan(self.test_dir)
        self.assertTrue(plan.empty)
        self.assertEqual(plan.roots, [])

    def test_malformed_package_json_records_error_without_crash(self):
        with open(os.path.join(self.test_dir, "package.json"), "w", encoding="utf-8") as f:
            f.write("{invalid json content")

        plan = detect_plan(self.test_dir)
        self.assertTrue(plan.empty)
        self.assertEqual(len(plan.errors), 1)
        self.assertIn("package.json in . is not valid JSON", plan.errors[0])

    def test_no_manifest_yields_empty_plan(self):
        plan = detect_plan(self.test_dir)
        self.assertTrue(plan.empty)
        self.assertEqual(plan.roots, [])
        self.assertEqual(plan.errors, [])


class GateOrderTests(SimpleTestCase):
    """Test gate execution sequence and rejection short-circuiting."""

    @patch("agents.verification.run_static_checks")
    @patch("agents.verification._docker_executor")
    @patch("agents.verification._github_executor")
    def test_empty_files_modified_fails_and_constructs_no_executor(
        self, mock_gh_factory, mock_doc_factory, mock_static
    ):
        result = verify_workspace("/workspace", files_modified=[])
        self.assertEqual(result.status, "failed")
        self.assertEqual(result.executor, "none")
        self.assertEqual(result.reason, "nothing was produced to verify")
        mock_static.assert_not_called()
        mock_doc_factory.assert_not_called()
        mock_gh_factory.assert_not_called()

    @patch("agents.verification.run_static_checks")
    @patch("agents.verification._docker_executor")
    @patch("agents.verification._github_executor")
    def test_static_errors_fail_before_executor_selection(
        self, mock_gh_factory, mock_doc_factory, mock_static
    ):
        mock_static.return_value = VerificationResult(
            status="failed",
            executor="static",
            reason="static checks failed with 1 error(s)",
            steps=[StepResult(name="check", command="static analysis", cwd=".", exit_code=1, conclusion="failure", duration_s=0.1)],
        )

        result = verify_workspace("/workspace", files_modified=["main.py"])
        self.assertEqual(result.status, "failed")
        self.assertEqual(result.executor, "static")
        self.assertEqual(result.reason, "static checks failed with 1 error(s)")
        mock_doc_factory.assert_not_called()
        mock_gh_factory.assert_not_called()

    @patch("agents.verification.run_static_checks")
    @patch("agents.verification.detect_plan")
    @patch("agents.verification._docker_executor")
    @patch("agents.verification._github_executor")
    def test_empty_plan_yields_unverified(
        self, mock_gh_factory, mock_doc_factory, mock_detect, mock_static
    ):
        mock_static.return_value = VerificationResult(
            status="unverified",
            executor="static",
            reason="static checks found no errors, but static checks cannot approve code",
        )
        mock_detect.return_value = VerificationPlan(steps=[], roots=[])

        result = verify_workspace("/workspace", files_modified=["README.md"])
        self.assertEqual(result.status, "unverified")
        self.assertEqual(result.executor, "static")
        self.assertEqual(result.reason, "no build toolchain was detected; static checks cannot approve code")
        mock_doc_factory.assert_not_called()
        mock_gh_factory.assert_not_called()

    @override_settings(AGENT_VERIFY_EXECUTOR="none")
    @patch("agents.verification.run_static_checks")
    @patch("agents.verification.detect_plan")
    @patch("agents.verification._docker_executor")
    def test_executor_none_yields_unverified(
        self, mock_doc_factory, mock_detect, mock_static
    ):
        mock_static.return_value = VerificationResult(status="unverified", executor="static", reason="ok")
        mock_detect.return_value = VerificationPlan(steps=[PlanStep(name="test", phase="check", cwd=".", toolchain="node", argv=["npm", "test"])])

        result = verify_workspace("/workspace", files_modified=["index.js"])
        self.assertEqual(result.status, "unverified")
        self.assertEqual(result.executor, "none")
        self.assertEqual(result.reason, "verification is disabled (AGENT_VERIFY_EXECUTOR=none)")
        mock_doc_factory.assert_not_called()

    @override_settings(AGENT_VERIFY_EXECUTOR="auto")
    @patch("agents.verification.run_static_checks")
    @patch("agents.verification.detect_plan")
    @patch("agents.verification._docker_executor")
    @patch("agents.verification._github_executor")
    def test_auto_with_repo_and_token_chooses_github_when_available(
        self, mock_gh_factory, mock_doc_factory, mock_detect, mock_static
    ):
        mock_static.return_value = VerificationResult(status="unverified", executor="static", reason="ok")
        mock_detect.return_value = VerificationPlan(steps=[PlanStep(name="build", phase="check", cwd=".", toolchain="node", argv=["npm", "run", "build"])])

        mock_gh = MagicMock()
        mock_gh.available.return_value = (True, "")
        mock_gh.run.return_value = VerificationResult(status="passed", executor="github_actions", reason="")
        mock_gh_factory.return_value = mock_gh

        result = verify_workspace(
            "/workspace",
            files_modified=["src/app.tsx"],
            repo="org/project",
            token="ghp_dummytoken",
        )
        self.assertEqual(result.status, "passed")
        self.assertEqual(result.executor, "github_actions")
        mock_gh_factory.assert_called_once_with("org/project", "ghp_dummytoken", "/workspace", "HEAD")
        mock_doc_factory.assert_not_called()

    @override_settings(AGENT_VERIFY_EXECUTOR="github_actions")
    @patch("agents.verification.run_static_checks")
    @patch("agents.verification.detect_plan")
    @patch("agents.verification._github_executor")
    def test_github_executor_constructed_with_workspace_and_ref(
        self, mock_gh_factory, mock_detect, mock_static
    ):
        mock_static.return_value = VerificationResult(status="unverified", executor="static", reason="ok")
        mock_detect.return_value = VerificationPlan(steps=[PlanStep(name="build", phase="check", cwd=".", toolchain="node", argv=["npm", "run", "build"])])

        mock_gh = MagicMock()
        mock_gh.available.return_value = (True, "")
        mock_gh.run.return_value = VerificationResult(status="passed", executor="github_actions", reason="")
        mock_gh_factory.return_value = mock_gh

        ws = "/path/to/project"
        result = verify_workspace(
            ws,
            files_modified=["src/app.tsx"],
            ref="feat/x",
            repo="o/r",
            token="t",
        )
        self.assertEqual(result.status, "passed")
        self.assertEqual(result.executor, "github_actions")
        mock_gh_factory.assert_called_once_with("o/r", "t", ws, "feat/x")

    @override_settings(AGENT_VERIFY_EXECUTOR="auto")
    @patch("agents.verification.run_static_checks")
    @patch("agents.verification.detect_plan")
    @patch("agents.verification._docker_executor")
    @patch("agents.verification._github_executor")
    def test_auto_without_repo_chooses_docker_when_available(
        self, mock_gh_factory, mock_doc_factory, mock_detect, mock_static
    ):
        mock_static.return_value = VerificationResult(status="unverified", executor="static", reason="ok")
        mock_detect.return_value = VerificationPlan(steps=[PlanStep(name="build", phase="check", cwd=".", toolchain="node", argv=["npm", "run", "build"])])

        mock_docker = MagicMock()
        mock_docker.available.return_value = (True, "")
        mock_docker.run.return_value = VerificationResult(status="passed", executor="docker", reason="")
        mock_doc_factory.return_value = mock_docker

        result = verify_workspace("/workspace", files_modified=["src/app.tsx"])
        self.assertEqual(result.status, "passed")
        self.assertEqual(result.executor, "docker")
        mock_gh_factory.assert_not_called()
        mock_doc_factory.assert_called_once()

    @override_settings(AGENT_VERIFY_EXECUTOR="auto")
    @patch("agents.verification.run_static_checks")
    @patch("agents.verification.detect_plan")
    @patch("agents.verification._docker_executor")
    @patch("agents.verification._github_executor")
    def test_auto_neither_available_yields_unverified_with_both_reasons(
        self, mock_gh_factory, mock_doc_factory, mock_detect, mock_static
    ):
        mock_static.return_value = VerificationResult(status="unverified", executor="static", reason="ok")
        mock_detect.return_value = VerificationPlan(steps=[PlanStep(name="build", phase="check", cwd=".", toolchain="node", argv=["npm", "run", "build"])])

        mock_gh = MagicMock()
        mock_gh.available.return_value = (False, "github rate limited")
        mock_gh_factory.return_value = mock_gh

        mock_docker = MagicMock()
        mock_docker.available.return_value = (False, "docker daemon is not running")
        mock_doc_factory.return_value = mock_docker

        result = verify_workspace(
            "/workspace",
            files_modified=["src/app.tsx"],
            repo="org/project",
            token="ghp_dummytoken",
        )
        self.assertEqual(result.status, "unverified")
        self.assertEqual(result.executor, "none")
        self.assertIn("github rate limited", result.reason)
        self.assertIn("docker daemon is not running", result.reason)
        mock_gh_factory.assert_called_once_with("org/project", "ghp_dummytoken", "/workspace", "HEAD")


class DockerExecutorCommandConstructionTests(SimpleTestCase):
    """Test Docker command generation, security flags, environment isolation, and network sandboxing."""

    @patch("subprocess.run")
    def test_docker_security_flags_and_command_construction(self, mock_run):
        tar_bytes = _make_tar_bytes({"package.json": "{}"})

        def fake_run(cmd, *args, **kwargs):
            if cmd[0] == "git":
                return subprocess.CompletedProcess(cmd, returncode=0, stdout=tar_bytes, stderr=b"")
            elif cmd[0] == "docker":
                return subprocess.CompletedProcess(cmd, returncode=0, stdout="Success\n", stderr="")
            raise ValueError(f"Unexpected command: {cmd}")

        mock_run.side_effect = fake_run

        plan = VerificationPlan(
            steps=[
                PlanStep(
                    name="npm install",
                    phase="install",
                    cwd=".",
                    toolchain="node",
                    argv=["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"],
                ),
                PlanStep(
                    name="npm test",
                    phase="check",
                    cwd=".",
                    toolchain="node",
                    argv=["npm", "test"],
                ),
            ]
        )

        executor = DockerExecutor()
        live_workspace = "F:\\TeamFlow\\backend\\generated_projects\\p1_proj"
        res = executor.run(live_workspace, plan)
        self.assertEqual(res.status, "passed")

        # Inspect docker calls (calls 1 and 2, after git archive at call 0)
        docker_calls = [c.args[0] for c in mock_run.call_args_list if c.args[0][0] == "docker"]
        self.assertEqual(len(docker_calls), 2)

        install_cmd = docker_calls[0]
        check_cmd = docker_calls[1]

        for cmd in (install_cmd, check_cmd):
            # Assert exact security flags are present on every docker run
            self.assertEqual(cmd[0:2], ["docker", "run"])
            self.assertIn("--rm", cmd)
            self.assertIn("--user", cmd)
            self.assertEqual(cmd[cmd.index("--user") + 1], "1000:1000")
            self.assertIn("--cap-drop", cmd)
            self.assertEqual(cmd[cmd.index("--cap-drop") + 1], "ALL")
            self.assertIn("--security-opt", cmd)
            self.assertEqual(cmd[cmd.index("--security-opt") + 1], "no-new-privileges")
            self.assertIn("--pids-limit", cmd)
            self.assertEqual(cmd[cmd.index("--pids-limit") + 1], "512")
            self.assertIn("--cpus", cmd)
            self.assertIn("--memory", cmd)
            self.assertIn("--read-only", cmd)
            self.assertIn("--tmpfs", cmd)
            self.assertEqual(cmd[cmd.index("--tmpfs") + 1], "/tmp:rw,exec,size=512m")

            # Environment variables: exactly HOME, CI, npm_config_cache
            e_indices = [i for i, val in enumerate(cmd) if val == "-e"]
            self.assertEqual(len(e_indices), 3)
            e_values = {cmd[i + 1] for i in e_indices}
            self.assertEqual(e_values, {"HOME=/tmp", "CI=true", "npm_config_cache=/tmp/.npm"})

            # Live workspace path NEVER appears as a -v source
            v_idx = cmd.index("-v")
            volume_mount = cmd[v_idx + 1]
            source_dir = volume_mount.split(":/work")[0]
            self.assertNotEqual(source_dir, live_workspace)
            self.assertIn("teamflow-verify-", source_dir)

            # Argv passed as list of strings
            self.assertTrue(isinstance(cmd, list))
            self.assertTrue(all(isinstance(arg, str) for arg in cmd))

        # Install step has NO --network none
        self.assertNotIn("--network", install_cmd)

        # Check step DOES have --network none
        self.assertIn("--network", check_cmd)
        self.assertEqual(check_cmd[check_cmd.index("--network") + 1], "none")


class DockerExecutorOutcomesTests(SimpleTestCase):
    """Test DockerExecutor failure modes, timeouts, exit codes, and containment."""

    @patch("subprocess.run")
    def test_first_failing_step_stops_run_and_yields_failed_with_exit_code(self, mock_run):
        tar_bytes = _make_tar_bytes({"package.json": "{}"})

        def fake_run(cmd, *args, **kwargs):
            if cmd[0] == "git":
                return subprocess.CompletedProcess(cmd, returncode=0, stdout=tar_bytes, stderr=b"")
            elif cmd[0] == "docker":
                # Step 1 fails with standard user exit code
                return subprocess.CompletedProcess(cmd, returncode=2, stdout="", stderr="npm ERR! build failed")
            raise ValueError(f"Unexpected command: {cmd}")

        mock_run.side_effect = fake_run

        plan = VerificationPlan(
            steps=[
                PlanStep(name="npm run build", phase="check", cwd=".", toolchain="node", argv=["npm", "run", "build"]),
                PlanStep(name="npm test", phase="check", cwd=".", toolchain="node", argv=["npm", "test"]),
            ]
        )

        res = DockerExecutor().run("/workspace", plan)
        self.assertEqual(res.status, "failed")
        self.assertEqual(res.executor, "docker")
        self.assertEqual(res.reason, "npm run build exited with code 2")
        self.assertEqual(len(res.steps), 1)
        self.assertEqual(res.steps[0].exit_code, 2)
        self.assertEqual(res.steps[0].conclusion, "failure")

        # Second step was never executed
        docker_calls = [c.args[0] for c in mock_run.call_args_list if c.args[0][0] == "docker"]
        self.assertEqual(len(docker_calls), 1)

    @patch("subprocess.run")
    def test_docker_exit_125_yields_unverified_with_error_conclusion(self, mock_run):
        tar_bytes = _make_tar_bytes({"package.json": "{}"})

        def fake_run(cmd, *args, **kwargs):
            if cmd[0] == "git":
                return subprocess.CompletedProcess(cmd, returncode=0, stdout=tar_bytes, stderr=b"")
            elif cmd[0] == "docker":
                return subprocess.CompletedProcess(
                    cmd,
                    returncode=125,
                    stdout="",
                    stderr="docker: Error response from daemon: pull rate limit reached",
                )
            raise ValueError(f"Unexpected command: {cmd}")

        mock_run.side_effect = fake_run

        plan = VerificationPlan(
            steps=[
                PlanStep(name="npm ci", phase="install", cwd=".", toolchain="node", argv=["npm", "ci"]),
            ]
        )

        res = DockerExecutor().run("/workspace", plan)
        self.assertEqual(res.status, "unverified")
        self.assertEqual(res.executor, "docker")
        self.assertIn("the container could not run npm ci (docker exit 125)", res.reason)
        self.assertEqual(len(res.steps), 1)
        self.assertEqual(res.steps[0].exit_code, 125)
        self.assertEqual(res.steps[0].conclusion, "error")
        self.assertIn("pull rate limit reached", res.steps[0].output_tail)

    @patch("subprocess.run")
    def test_docker_exit_127_yields_unverified_with_error_conclusion(self, mock_run):
        tar_bytes = _make_tar_bytes({"package.json": "{}"})

        def fake_run(cmd, *args, **kwargs):
            if cmd[0] == "git":
                return subprocess.CompletedProcess(cmd, returncode=0, stdout=tar_bytes, stderr=b"")
            elif cmd[0] == "docker":
                return subprocess.CompletedProcess(
                    cmd,
                    returncode=127,
                    stdout="",
                    stderr="docker: executable file not found in $PATH",
                )
            raise ValueError(f"Unexpected command: {cmd}")

        mock_run.side_effect = fake_run

        plan = VerificationPlan(
            steps=[
                PlanStep(name="npm test", phase="check", cwd=".", toolchain="node", argv=["npm", "test"]),
            ]
        )

        res = DockerExecutor().run("/workspace", plan)
        self.assertEqual(res.status, "unverified")
        self.assertEqual(res.executor, "docker")
        self.assertIn("the container could not run npm test (docker exit 127)", res.reason)
        self.assertEqual(len(res.steps), 1)
        self.assertEqual(res.steps[0].exit_code, 127)
        self.assertEqual(res.steps[0].conclusion, "error")
        self.assertIn("executable file not found in $PATH", res.steps[0].output_tail)

    @patch("subprocess.run")
    def test_timeout_expired_yields_unverified_and_triggers_docker_kill(self, mock_run):
        tar_bytes = _make_tar_bytes({"package.json": "{}"})
        killed_containers = []

        def fake_run(cmd, *args, **kwargs):
            if cmd[0] == "git":
                return subprocess.CompletedProcess(cmd, returncode=0, stdout=tar_bytes, stderr=b"")
            elif cmd[0] == "docker":
                if cmd[1] == "kill":
                    killed_containers.append(cmd[2])
                    return subprocess.CompletedProcess(cmd, returncode=0, stdout="", stderr="")
                raise subprocess.TimeoutExpired(cmd=cmd, timeout=10, output="slow download...", stderr="")
            raise ValueError(f"Unexpected command: {cmd}")

        mock_run.side_effect = fake_run

        plan = VerificationPlan(
            steps=[
                PlanStep(name="npm install", phase="install", cwd=".", toolchain="node", argv=["npm", "install"]),
            ]
        )

        res = DockerExecutor().run("/workspace", plan, timeout=10)
        self.assertEqual(res.status, "unverified")
        self.assertEqual(res.executor, "docker")
        self.assertIn("npm install timed out", res.reason)
        self.assertEqual(len(res.steps), 1)
        self.assertEqual(res.steps[0].conclusion, "timed_out")
        self.assertEqual(len(killed_containers), 1)
        self.assertTrue(killed_containers[0].startswith("teamflow-verify-"))

    @patch("subprocess.run")
    def test_git_archive_failure_yields_unverified(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess(
            ["git", "-C", "/workspace", "archive"],
            returncode=128,
            stdout=b"",
            stderr=b"fatal: not a git repository",
        )

        plan = VerificationPlan(
            steps=[
                PlanStep(name="npm test", phase="check", cwd=".", toolchain="node", argv=["npm", "test"]),
            ]
        )

        res = DockerExecutor().run("/workspace", plan)
        self.assertEqual(res.status, "unverified")
        self.assertEqual(res.executor, "docker")
        self.assertIn("git archive failed", res.reason)
        self.assertIn("fatal: not a git repository", res.reason)

        # Docker was never run
        docker_calls = [c.args[0] for c in mock_run.call_args_list if c.args[0][0] == "docker"]
        self.assertEqual(len(docker_calls), 0)

    @patch("subprocess.run")
    def test_output_truncated_to_output_limit(self, mock_run):
        tar_bytes = _make_tar_bytes({"package.json": "{}"})
        long_output = "A" * 30000 + "END_MARKER"

        def fake_run(cmd, *args, **kwargs):
            if cmd[0] == "git":
                return subprocess.CompletedProcess(cmd, returncode=0, stdout=tar_bytes, stderr=b"")
            elif cmd[0] == "docker":
                return subprocess.CompletedProcess(cmd, returncode=0, stdout=long_output, stderr="")
            raise ValueError(f"Unexpected command: {cmd}")

        mock_run.side_effect = fake_run

        plan = VerificationPlan(
            steps=[
                PlanStep(name="npm test", phase="check", cwd=".", toolchain="node", argv=["npm", "test"]),
            ]
        )

        with override_settings(AGENT_VERIFY_OUTPUT_LIMIT=1000):
            res = DockerExecutor().run("/workspace", plan)
            self.assertEqual(res.status, "passed")
            self.assertEqual(len(res.steps[0].output_tail), 1000)
            self.assertTrue(res.steps[0].output_tail.endswith("END_MARKER"))

    @patch("tempfile.mkdtemp")
    def test_exception_inside_run_never_escapes(self, mock_mkdtemp):
        mock_mkdtemp.side_effect = RuntimeError("Disk full error")

        plan = VerificationPlan(
            steps=[
                PlanStep(name="npm test", phase="check", cwd=".", toolchain="node", argv=["npm", "test"]),
            ]
        )

        res = DockerExecutor().run("/workspace", plan)
        self.assertEqual(res.status, "unverified")
        self.assertEqual(res.executor, "docker")
        self.assertIn("docker executor error", res.reason)
        self.assertIn("Disk full error", res.reason)


class TarExtractionSafetyTests(SimpleTestCase):
    """Test that tar extraction rejects absolute paths, parent traversals, and symlinks."""

    def test_tar_extraction_rejects_parent_traversal(self):
        tar_bytes = _make_tar_bytes({"../escape.txt": "host compromise attempt"})
        target_dir = tempfile.mkdtemp(prefix="tar-test-")
        try:
            with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r") as tar:
                with self.assertRaises(ValueError) as ctx:
                    safe_extract_tar(tar, target_dir)
                self.assertIn("parent traversal", str(ctx.exception).lower())
        finally:
            shutil.rmtree(target_dir, ignore_errors=True)

    def test_tar_extraction_rejects_absolute_path(self):
        tar_bytes = _make_tar_bytes({"/root/evil.txt": "absolute root attempt"})
        target_dir = tempfile.mkdtemp(prefix="tar-test-")
        try:
            with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r") as tar:
                with self.assertRaises(ValueError) as ctx:
                    safe_extract_tar(tar, target_dir)
                self.assertIn("absolute", str(ctx.exception).lower())
        finally:
            shutil.rmtree(target_dir, ignore_errors=True)

    def test_tar_extraction_rejects_symlink_pointing_to_etc_passwd(self):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w") as tar:
            ti = tarfile.TarInfo(name="passwd_symlink")
            ti.type = tarfile.SYMTYPE
            ti.linkname = "/etc/passwd"
            tar.addfile(ti)
        tar_bytes = buf.getvalue()

        target_dir = tempfile.mkdtemp(prefix="tar-test-")
        try:
            with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r") as tar:
                with self.assertRaises(ValueError) as ctx:
                    safe_extract_tar(tar, target_dir)
                self.assertTrue(
                    "absolute" in str(ctx.exception).lower() or "link" in str(ctx.exception).lower()
                )
        finally:
            shutil.rmtree(target_dir, ignore_errors=True)

    def test_tar_fallback_extractor_rejects_links(self):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w") as tar:
            ti = tarfile.TarInfo(name="rel_link")
            ti.type = tarfile.SYMTYPE
            ti.linkname = "target_file.txt"
            tar.addfile(ti)
        tar_bytes = buf.getvalue()

        target_dir = tempfile.mkdtemp(prefix="tar-test-")
        try:
            with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r") as tar:
                had_filter = hasattr(tarfile, "data_filter")
                saved_filter = getattr(tarfile, "data_filter", None)
                try:
                    if had_filter:
                        delattr(tarfile, "data_filter")
                    with self.assertRaises(ValueError) as ctx:
                        safe_extract_tar(tar, target_dir)
                    self.assertIn("fallback extractor", str(ctx.exception))
                finally:
                    if had_filter and saved_filter is not None:
                        setattr(tarfile, "data_filter", saved_filter)
        finally:
            shutil.rmtree(target_dir, ignore_errors=True)


class TokenSanitizationTests(SimpleTestCase):
    """Test token sanitization in StepResult and DockerExecutor output."""

    @patch("subprocess.run")
    def test_ghp_token_does_not_survive_into_output_tail(self, mock_run):
        tar_bytes = _make_tar_bytes({"package.json": "{}"})
        token = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
        raw_output = f"Connecting with token: {token} to registry\nDone.\n"

        def fake_run(cmd, *args, **kwargs):
            if cmd[0] == "git":
                return subprocess.CompletedProcess(cmd, returncode=0, stdout=tar_bytes, stderr=b"")
            elif cmd[0] == "docker":
                return subprocess.CompletedProcess(cmd, returncode=0, stdout=raw_output, stderr="")
            raise ValueError(f"Unexpected command: {cmd}")

        mock_run.side_effect = fake_run

        plan = VerificationPlan(
            steps=[
                PlanStep(name="npm test", phase="check", cwd=".", toolchain="node", argv=["npm", "test"]),
            ]
        )

        res = DockerExecutor().run("/workspace", plan)
        self.assertEqual(res.status, "passed")
        output = res.steps[0].output_tail
        self.assertNotIn(token, output)
        self.assertIn("***TOKEN***", output)
