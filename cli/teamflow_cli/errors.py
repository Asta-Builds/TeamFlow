"""Errors shown to the user as a message instead of a traceback."""

from __future__ import annotations

from .hints import suggest


class CliError(Exception):
    """A failure the user can act on. The CLI prints the message and exits with `exit_code`."""

    exit_code = 1

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class UsageError(CliError):
    """The command was called with options that do not fit together."""

    exit_code = 2


class ConnectionFailedError(CliError):
    """The server could not be reached."""


class NotLoggedInError(CliError):
    def __init__(self, url: str, *, expired: bool = False):
        reason = "Your session has expired" if expired else "You are not logged in"
        super().__init__(f"{reason} on {url}. Run: {suggest(f'login {url}', f'/login {url}')}")
        self.url = url


class ApiError(CliError):
    """The API answered with an error status."""

    def __init__(self, status: int, detail: str):
        super().__init__(f"{detail} (HTTP {status})")
        self.status = status
        self.detail = detail
