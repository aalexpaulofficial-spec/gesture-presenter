"""Short-lived storage for uploaded presentations."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

TTL_SECONDS = 60 * 60 * 6


@dataclass
class DeckRecord:
    name: str
    payload: bytes
    plan: str
    created_at: float = field(default_factory=time.time)


class DeckStore:
    """In-memory store. Swap for object storage in a multi-instance deployment."""

    def __init__(self) -> None:
        self._items: dict[str, DeckRecord] = {}
        self._lock = threading.Lock()

    def put(self, deck_id: str, *, name: str, payload: bytes, plan: str = "MASTER HAND") -> None:
        with self._lock:
            self._prune()
            self._items[deck_id] = DeckRecord(name=name, payload=payload, plan=plan)

    def get(self, deck_id: str) -> DeckRecord | None:
        with self._lock:
            self._prune()
            return self._items.get(deck_id)

    def delete(self, deck_id: str) -> None:
        with self._lock:
            self._items.pop(deck_id, None)

    def _prune(self) -> None:
        cutoff = time.time() - TTL_SECONDS
        for key in [k for k, v in self._items.items() if v.created_at < cutoff]:
            self._items.pop(key, None)
