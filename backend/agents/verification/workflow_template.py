import os

WORKFLOW_PATH = ".github/workflows/teamflow-verify.yml"

WORKFLOW_TEMPLATE = r"""name: TeamFlow Verification

on:
  push:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  verify:
    name: TeamFlow Verification
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: TeamFlow Verification
        run: |
          set -euo pipefail

          manifest_count=0
          dirs=()
          while IFS= read -r line; do
            [ -n "$line" ] && dirs+=("$line")
          done < <(find . -maxdepth 2 \
            \( -name '.git' -o -name 'node_modules' -o -name '.venv' -o -name 'venv' -o -name '__pycache__' -o -name 'dist' -o -name 'build' -o -name '.next' \) -prune \
            -o -type d -print | sort)

          for dir in "${dirs[@]}"; do
            d="${dir#./}"
            [ "$d" = "." ] || [ -z "$d" ] && d="."

            if [ -f "$dir/package.json" ]; then
              manifest_count=$((manifest_count + 1))
              pushd "$dir" > /dev/null
              if [ -f "package-lock.json" ]; then
                echo "::group::$d npm ci --ignore-scripts --no-audit --no-fund"
                npm ci --ignore-scripts --no-audit --no-fund
                echo "::endgroup::"
              else
                echo "::group::$d npm install --ignore-scripts --no-audit --no-fund"
                npm install --ignore-scripts --no-audit --no-fund
                echo "::endgroup::"
              fi

              has_build=$(jq -r '.scripts.build // empty' package.json)
              if [ -n "$has_build" ]; then
                echo "::group::$d npm run build"
                npm run build
                echo "::endgroup::"
              fi

              test_cmd=$(jq -r '.scripts.test // empty' package.json)
              if [ -n "$test_cmd" ]; then
                test_lower=$(printf '%s' "$test_cmd" | tr '[:upper:]' '[:lower:]')
                case "$test_lower" in
                  *"no test specified"*"exit 1"*|*"exit 1"*"no test specified"*)
                    ;;
                  *)
                    echo "::group::$d npm test"
                    npm test
                    echo "::endgroup::"
                    ;;
                esac
              fi

              if [ -f "tsconfig.json" ] && [ -z "$has_build" ]; then
                has_ts=$(jq -r '(.dependencies.typescript // empty), (.devDependencies.typescript // empty)' package.json)
                if [ -n "$has_ts" ]; then
                  echo "::group::$d npx --no-install tsc --noEmit"
                  npx --no-install tsc --noEmit
                  echo "::endgroup::"
                fi
              fi
              popd > /dev/null
            fi

            if [ -f "$dir/requirements.txt" ] || [ -f "$dir/pyproject.toml" ]; then
              manifest_count=$((manifest_count + 1))
              pushd "$dir" > /dev/null
              echo "::group::$d python -m venv .venv"
              python -m venv .venv
              echo "::endgroup::"

              if [ -f "requirements.txt" ]; then
                echo "::group::$d .venv/bin/pip install -r requirements.txt"
                .venv/bin/pip install -r requirements.txt
                echo "::endgroup::"
              else
                echo "::group::$d .venv/bin/pip install ."
                .venv/bin/pip install .
                echo "::endgroup::"
              fi

              echo "::group::$d .venv/bin/python -m compileall -q -x '[/\]\.venv' ."
              .venv/bin/python -m compileall -q -x '[/\\]\.venv' .
              echo "::endgroup::"

              has_tests=0
              if [ -d "tests" ]; then
                has_tests=1
              elif [ -n "$(find . \( -name '.git' -o -name 'node_modules' -o -name '.venv' -o -name 'venv' -o -name '__pycache__' -o -name 'dist' -o -name 'build' -o -name '.next' \) -prune -o \( -name 'test_*.py' -o -name '*_test.py' \) -print -quit)" ]; then
                has_tests=1
              fi

              if [ "$has_tests" -eq 1 ]; then
                echo "::group::$d .venv/bin/python -m pytest -q"
                .venv/bin/python -m pytest -q
                echo "::endgroup::"
              fi
              popd > /dev/null
            fi
          done

          if [ "$manifest_count" -eq 0 ]; then
            echo "No build toolchain was detected" >&2
            exit 1
          fi
"""


def ensure_verification_workflow(workspace: str) -> bool:
    """Write the workflow if it is missing. Returns True when the file was created."""
    target_path = os.path.join(workspace, WORKFLOW_PATH)
    if os.path.exists(target_path):
        return False
    os.makedirs(os.path.dirname(target_path), exist_ok=True)
    with open(target_path, "w", encoding="utf-8") as f:
        f.write(WORKFLOW_TEMPLATE)
    return True
