"""One bounded execution queue owns DuckDB, even across HTTP cancellation."""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

from .db import Database


class DataOwner[T]:
    """Construct the database and its state on one dedicated thread."""

    def __init__(
        self,
        path: Path | str,
        *,
        factory: Callable[[Database], T],
        max_pending: int = 32,
        clock: Callable[[], datetime] | None = None,
    ):
        if max_pending < 1:
            raise ValueError("max_pending must be positive")
        self._path = path
        self._factory = factory
        self._clock = clock
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="cleardesk-data")
        self._capacity = threading.BoundedSemaphore(max_pending)
        self._database: Database | None = None
        self._state: T | None = None
        self._closing = False

    def _invoke[R](self, operation: Callable[[T], R]) -> R:
        if self._database is None:
            self._database = Database(self._path, clock=self._clock)
            self._state = self._factory(self._database)
        if self._state is None:
            raise RuntimeError("DATA_SERVICE_INITIALIZATION_FAILED")
        return operation(self._state)

    async def run[R](self, operation: Callable[[T], R]) -> R:
        """Refuse excess work instead of filling an unbounded executor queue."""
        if self._closing:
            raise RuntimeError("DATA_SERVICE_CLOSED")
        if not self._capacity.acquire(blocking=False):
            raise OverflowError("BUSY")
        try:
            pending = self._executor.submit(self._invoke, operation)
        except BaseException:
            self._capacity.release()
            raise
        pending.add_done_callback(lambda _: self._capacity.release())
        wrapped = asyncio.wrap_future(pending)
        # A disconnected caller must not free admission while its queued work still exists.
        # Observe orphaned exceptions without preventing a current caller from receiving them.
        wrapped.add_done_callback(lambda done: None if done.cancelled() else done.exception())
        return await asyncio.shield(wrapped)

    def _close_database(self) -> None:
        if self._database is not None:
            self._database.close()
            self._database = None
            self._state = None

    async def close(self) -> None:
        """Drain previously admitted operations, then close on the owner thread."""
        if self._closing:
            return
        self._closing = True
        try:
            await asyncio.wrap_future(self._executor.submit(self._close_database))
        finally:
            self._executor.shutdown(wait=True, cancel_futures=False)
