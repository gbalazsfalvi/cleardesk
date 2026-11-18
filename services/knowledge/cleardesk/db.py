"""A thread-owned DuckDB connection with additive, checksum-checked migrations."""

from __future__ import annotations

import hashlib
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

import duckdb


class Database:
    """Only the creating thread may access this connection or its transactions."""

    def __init__(self, path: Path | str, *, clock: Callable[[], datetime] | None = None):
        self._owner = threading.get_ident()
        self._clock = clock or (lambda: datetime.now(UTC))
        self._in_transaction = False
        name = str(path)
        if name != ":memory:":
            Path(name).parent.mkdir(parents=True, exist_ok=True)
        self._connection = duckdb.connect(
            name,
            config={
                "enable_external_access": False,
                "allow_unsigned_extensions": False,
                "threads": 2,
                "memory_limit": "256MB",
            },
        )
        try:
            self._migrate()
        except BaseException:
            self._connection.close()
            raise

    def assert_owner(self) -> None:
        """Prevent an accidental second thread from bypassing the service executor."""
        if threading.get_ident() != self._owner:
            raise RuntimeError("DATABASE_OWNER_THREAD_REQUIRED")

    @property
    def connection(self) -> duckdb.DuckDBPyConnection:
        self.assert_owner()
        return self._connection

    def now(self) -> datetime:
        value = self._clock()
        if value.tzinfo is None:
            raise RuntimeError("SERVER_CLOCK_MUST_BE_TIMEZONE_AWARE")
        return value.astimezone(UTC)

    @contextmanager
    def transaction(self) -> Iterator[duckdb.DuckDBPyConnection]:
        """Expose one explicit transaction; nesting is a caller error, not an implicit commit."""
        self.assert_owner()
        if self._in_transaction:
            raise RuntimeError("NESTED_TRANSACTION_NOT_SUPPORTED")
        self._in_transaction = True
        self._connection.execute("BEGIN TRANSACTION")
        try:
            yield self._connection
        except BaseException:
            self._connection.execute("ROLLBACK")
            raise
        else:
            self._connection.execute("COMMIT")
        finally:
            self._in_transaction = False

    def _migrate(self) -> None:
        self._connection.execute("""CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY, sha256 VARCHAR NOT NULL,
            installed_at TIMESTAMPTZ NOT NULL)""")
        for path in sorted(Path(__file__).with_name("migrations").glob("*.sql")):
            version = int(path.name.split("_", 1)[0])
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            current = self._connection.execute(
                "SELECT sha256 FROM schema_migrations WHERE version = ?", [version]
            ).fetchone()
            if current:
                if current[0] != digest:
                    raise RuntimeError("MIGRATION_CHECKSUM_MISMATCH")
                continue
            with self.transaction() as connection:
                connection.execute(path.read_text(encoding="utf-8"))
                connection.execute(
                    "INSERT INTO schema_migrations VALUES (?, ?, ?)", [version, digest, self.now()]
                )

    def close(self) -> None:
        self.assert_owner()
        self._connection.close()
