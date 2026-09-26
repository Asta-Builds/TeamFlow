"""HTTP access to the TeamFlow API gateway, with session refresh."""

from __future__ import annotations

import contextlib
import signal
import threading
from typing import Any, Iterator, Optional

import httpx

from . import __version__
from .config import HostStore, Session
from .errors import ApiError, CliError, ConnectionFailedError, NotLoggedInError

API_PREFIX = "/api"
# The event stream sends a keep-alive every 300 ms, so a long silence means a dead connection.
STREAM_TIMEOUT = httpx.Timeout(10.0, read=30.0)


@contextlib.contextmanager
def _deferred_interrupt() -> Iterator[None]:
    """Hold back Ctrl+C until the block has finished."""
    if threading.current_thread() is not threading.main_thread():
        yield
        return
    received: list[int] = []
    previous = signal.signal(signal.SIGINT, lambda signum, frame: received.append(signum))
    try:
        yield
    finally:
        signal.signal(signal.SIGINT, previous if previous is not None else signal.SIG_DFL)
    if received:
        raise KeyboardInterrupt


def error_detail(response: httpx.Response) -> str:
    """The reason in an error body: NestJS `message`, DRF `detail`, or field errors."""
    try:
        data = response.json()
    except ValueError:
        data = None
    if isinstance(data, dict):
        message = data.get("message")
        if isinstance(message, list):
            message = ", ".join(str(item) for item in message)
        for candidate in (message, data.get("detail"), data.get("error")):
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        fields = [
            f"{field}: {' '.join(map(str, value)) if isinstance(value, list) else value}"
            for field, value in data.items()
            if field != "statusCode"
        ]
        if fields:
            return "; ".join(fields)
    text = response.text.strip()
    if text and len(text) <= 300 and not text.startswith("<"):
        return text
    return response.reason_phrase or "Request failed"


class TeamflowClient:
    """Calls the API of one TeamFlow server with the session saved for it."""

    def __init__(
        self,
        url: str,
        store: HostStore,
        *,
        transport: Optional[httpx.BaseTransport] = None,
        timeout: float = 30.0,
    ):
        self.url = url
        self.store = store
        self._http = httpx.Client(
            base_url=url + API_PREFIX,
            timeout=timeout,
            transport=transport,
            headers={"User-Agent": f"teamflow-cli/{__version__}", "Accept": "application/json"},
        )

    def __enter__(self) -> TeamflowClient:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def close(self) -> None:
        self._http.close()

    def get(self, path: str, *, params: Optional[dict[str, Any]] = None) -> Any:
        return self.request("GET", path, params=params)

    def post(self, path: str, *, json: Any = None, auth: bool = True) -> Any:
        return self.request("POST", path, json=json, auth=auth)

    def patch(self, path: str, *, json: Any = None) -> Any:
        return self.request("PATCH", path, json=json)

    def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json: Any = None,
        auth: bool = True,
    ) -> Any:
        token = self._access_token() if auth else None
        response = self._send(method, path, token, params=params, json=json)
        if response.status_code == 401 and token is not None:
            token = self.refresh_session(token)
            response = self._send(method, path, token, params=params, json=json)
        if response.is_error:
            raise ApiError(response.status_code, error_detail(response))
        if not response.content:
            return None
        try:
            return response.json()
        except ValueError as exc:
            raise CliError(f"{self.url} returned a response that is not JSON for {path}.") from exc

    @contextlib.contextmanager
    def stream(self, path: str, *, params: Optional[dict[str, Any]] = None) -> Iterator[httpx.Response]:
        """Open a streaming GET, refreshing the session once if the token is rejected."""
        token = self._access_token()
        for attempt in range(2):
            request = self._http.build_request(
                "GET",
                path,
                params=params,
                headers={"Authorization": f"Bearer {token}", "Accept": "text/event-stream"},
                timeout=STREAM_TIMEOUT,
            )
            try:
                response = self._http.send(request, stream=True)
            except httpx.HTTPError as exc:
                raise self._connection_error(exc, "GET") from exc
            if response.status_code == 401 and attempt == 0:
                response.close()
                token = self.refresh_session(token)
                continue
            try:
                if response.is_error:
                    response.read()
                    raise ApiError(response.status_code, error_detail(response))
                yield response
            finally:
                response.close()
            return

    def refresh_session(self, rejected_access: str) -> str:
        """Return a working access token after `rejected_access` was refused."""
        with self.store.lock():
            session = self.store.session(self.url)
            if session is None:
                raise NotLoggedInError(self.url)
            if session.access != rejected_access:
                return session.access  # Another teamflow process already refreshed.
            # Once the server rotates the token, the old one is spent. Stopping before the new
            # pair is saved would leave only a spent token, which signs the user out everywhere.
            with _deferred_interrupt():
                response = self._send("POST", "/auth/refresh", None, json={"refresh": session.refresh})
                if response.status_code in (400, 401, 403):
                    self.store.clear_session(self.url)
                    raise NotLoggedInError(self.url, expired=True)
                if response.is_error:
                    raise ApiError(response.status_code, error_detail(response))
                data = response.json()
                renewed = Session(
                    access=data["access"],
                    refresh=data.get("refresh") or session.refresh,
                    email=session.email,
                )
                self.store.save_session(self.url, renewed, make_current=False)
            return renewed.access

    def revoke(self, session: Session) -> bool:
        """End a session on the server. False when its access token is no longer accepted."""
        response = self._send("POST", "/auth/logout", session.access, json={"refresh": session.refresh})
        if response.status_code == 401:
            return False
        if response.is_error:
            raise ApiError(response.status_code, error_detail(response))
        return True

    def _access_token(self) -> str:
        session = self.store.session(self.url)
        if session is None:
            raise NotLoggedInError(self.url)
        return session.access

    def _send(
        self,
        method: str,
        path: str,
        token: Optional[str],
        *,
        params: Optional[dict[str, Any]] = None,
        json: Any = None,
    ) -> httpx.Response:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        try:
            return self._http.request(method, path, params=params, json=json, headers=headers)
        except httpx.HTTPError as exc:
            raise self._connection_error(exc, method) from exc

    def _connection_error(self, exc: httpx.HTTPError, method: str) -> ConnectionFailedError:
        if isinstance(exc, httpx.TimeoutException):
            message = f"TeamFlow at {self.url} did not answer in time."
        else:
            message = f"Cannot reach TeamFlow at {self.url} ({type(exc).__name__})."
        if method != "GET":
            message += " The change may still have been applied; check before retrying."
        else:
            message += " Check the server, or pass --url / set TEAMFLOW_URL."
        return ConnectionFailedError(message)
