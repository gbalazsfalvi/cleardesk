"""The owner queue stays bounded even when an HTTP caller cancels its await."""

import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from cleardesk.db import Database
from cleardesk.owner import DataOwner


def test_database_rejects_direct_use_from_another_thread(tmp_path):
    db = Database(tmp_path / "thread.duckdb")
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(lambda: db.connection.execute("SELECT 1"))
            with pytest.raises(RuntimeError, match="DATABASE_OWNER_THREAD_REQUIRED"):
                future.result(timeout=3)
    finally:
        db.close()


def test_owner_initializes_and_executes_on_one_dedicated_thread(tmp_path):
    async def check():
        owner = DataOwner(tmp_path / "owner.duckdb", factory=lambda db: db)
        try:
            identities = await asyncio.gather(
                *[owner.run(lambda db: threading.get_ident()) for _ in range(12)]
            )
            assert len(set(identities)) == 1
            assert identities[0] != threading.get_ident()
            assert (
                await owner.run(lambda db: db.connection.execute("SELECT 42").fetchone()[0]) == 42
            )
        finally:
            await owner.close()

    asyncio.run(check())


def test_cancelled_await_does_not_open_unbounded_executor_capacity(tmp_path):
    async def check():
        started = threading.Event()
        release = threading.Event()
        owner = DataOwner(tmp_path / "bounded.duckdb", factory=lambda db: db, max_pending=1)

        def blocked(db):
            started.set()
            release.wait(timeout=3)
            return 1

        task = asyncio.create_task(owner.run(blocked))
        try:
            assert await asyncio.to_thread(started.wait, 2)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            with pytest.raises(OverflowError, match="BUSY"):
                await owner.run(lambda db: 2)
        finally:
            release.set()
            await owner.close()
        with pytest.raises(RuntimeError, match="DATA_SERVICE_CLOSED"):
            await owner.run(lambda db: 3)

    asyncio.run(check())
