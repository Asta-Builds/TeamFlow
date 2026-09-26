"""Saved servers and login sessions."""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterator, Optional

import typer
from filelock import FileLock, Timeout

from .errors import CliError

DEFAULT_URL = "http://localhost:8001"
CONFIG_DIR_ENV = "TEAMFLOW_CONFIG_DIR"


def config_dir() -> Path:
    override = os.environ.get(CONFIG_DIR_ENV)
    return Path(override) if override else Path(typer.get_app_dir("teamflow"))


def normalize_url(url: str) -> str:
    """Return the server root, without a trailing slash or /api suffix."""
    cleaned = url.strip().rstrip("/")
    if cleaned.endswith("/api"):
        cleaned = cleaned[: -len("/api")]
    if not cleaned.startswith(("http://", "https://")):
        raise CliError(f"The server URL must start with http:// or https:// (got {url!r}).")
    return cleaned


@dataclass
class Session:
    access: str
    refresh: str
    email: str = ""


class HostStore:
    """hosts.json in the config directory: the current server and one session per server.

    Every read and write holds a file lock. The API treats a reused refresh token as
    theft and signs the user out everywhere, so a refresh must re-read the file under
    the lock in case another teamflow process has already rotated the tokens.
    """

    def __init__(self, directory: Optional[Path] = None):
        self.directory = directory or config_dir()
        self.path = self.directory / "hosts.json"
        self._lock = FileLock(str(self.directory / "hosts.lock"), timeout=30)

    @contextlib.contextmanager
    def lock(self) -> Iterator[None]:
        self.directory.mkdir(parents=True, exist_ok=True)
        try:
            self._lock.acquire()
        except Timeout as exc:
            raise CliError(
                f"Another teamflow process is holding {self._lock.lock_file}. Try again."
            ) from exc
        try:
            yield
        finally:
            self._lock.release()

    def current_url(self) -> Optional[str]:
        with self.lock():
            current = self._read().get("current")
        return current if isinstance(current, str) and current else None

    def session(self, url: str) -> Optional[Session]:
        with self.lock():
            entry = self._read().get("hosts", {}).get(url)
        if not isinstance(entry, dict) or not entry.get("access") or not entry.get("refresh"):
            return None
        return Session(access=entry["access"], refresh=entry["refresh"], email=entry.get("email", ""))

    def save_session(self, url: str, session: Session, *, make_current: bool) -> None:
        with self.lock():
            data = self._read()
            data.setdefault("hosts", {})[url] = asdict(session)
            if make_current:
                data["current"] = url
            self._write(data)

    def clear_session(self, url: str) -> None:
        with self.lock():
            data = self._read()
            if data.get("hosts", {}).pop(url, None) is not None:
                self._write(data)

    def _read(self) -> dict[str, Any]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as exc:
            raise CliError(f"Cannot read {self.path}: {exc}") from exc
        if not isinstance(data, dict):
            return {}
        if not isinstance(data.get("hosts"), dict):
            data["hosts"] = {}
        return data

    def _write(self, data: dict[str, Any]) -> None:
        # mkstemp creates the file readable by the owner only, which the tokens need.
        fd, tmp = tempfile.mkstemp(dir=self.directory, prefix=".hosts-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(data, handle, indent=2)
            _replace(tmp, self.path)
        except BaseException:
            with contextlib.suppress(OSError):
                os.unlink(tmp)
            raise


def _replace(source: str, target: Path, attempts: int = 10) -> None:
    # On Windows a virus scanner or indexer can briefly hold the target open.
    for attempt in range(attempts):
        try:
            os.replace(source, target)
            return
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(0.05)
