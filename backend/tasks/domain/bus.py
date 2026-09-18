"""
Domain Event Dispatcher (Observer Pattern).
Enforces Single Responsibility (SRP) and Open/Closed (OCP) by decoupling
primary entity state transitions from secondary side-effects (audit logs,
notifications, cache eviction, and AI agent triggers).
"""

from collections import defaultdict
import logging
from typing import Callable, Dict, List, Type

from .events import DomainEvent

logger = logging.getLogger(__name__)

EventHandler = Callable[[DomainEvent], None]


class EventBus:
    """In-memory synchronous & transaction-aware domain event bus."""

    def __init__(self):
        self._subscribers: Dict[Type[DomainEvent], List[EventHandler]] = defaultdict(list)

    def subscribe(self, event_type: Type[DomainEvent], handler: EventHandler) -> None:
        """Register a handler for a specific domain event type."""
        if handler not in self._subscribers[event_type]:
            self._subscribers[event_type].append(handler)

    def unsubscribe(self, event_type: Type[DomainEvent], handler: EventHandler) -> None:
        """Remove a previously registered handler."""
        if handler in self._subscribers[event_type]:
            self._subscribers[event_type].remove(handler)

    def dispatch(self, event: DomainEvent) -> None:
        """
        Dispatch a domain event to all subscribed handlers.
        Handlers are executed resiliently; exceptions in secondary listeners
        are captured and logged so the primary business transaction is not aborted.
        """
        handlers = self._subscribers.get(type(event), [])
        for handler in handlers:
            try:
                handler(event)
            except Exception as exc:
                logger.error(
                    f"Error executing event handler {handler.__name__} for {type(event).__name__}: {exc}",
                    exc_info=True,
                )


# Global singleton instance for the domain
default_event_bus = EventBus()
