"""Real transaction and migration checks never edit the committed migration files."""

import pytest

from cleardesk.db import Database


def test_failed_operation_rolls_back_all_changes(tmp_path):
    db = Database(tmp_path / "rollback.duckdb")
    try:
        db.connection.execute("CREATE TABLE rollback_probe(value INTEGER)")
        with pytest.raises(ValueError, match="SIMULATED_FAILURE"):
            with db.transaction() as connection:
                connection.execute("INSERT INTO rollback_probe VALUES (1)")
                raise ValueError("SIMULATED_FAILURE")
        assert db.connection.execute("SELECT count(*) FROM rollback_probe").fetchone()[0] == 0
    finally:
        db.close()


def test_rejected_nested_transaction_leaves_the_outer_transaction_usable(tmp_path):
    db = Database(tmp_path / "nested.duckdb")
    try:
        db.connection.execute("CREATE TABLE nested_probe(value INTEGER)")
        with db.transaction() as connection:
            connection.execute("INSERT INTO nested_probe VALUES (1)")
            with pytest.raises(RuntimeError, match="NESTED_TRANSACTION_NOT_SUPPORTED"):
                with db.transaction():
                    pass
            connection.execute("INSERT INTO nested_probe VALUES (2)")
        assert db.connection.execute("SELECT sum(value) FROM nested_probe").fetchone()[0] == 3
    finally:
        db.close()


def test_a_corrupt_migration_checksum_refuses_reconstruction(tmp_path):
    path = tmp_path / "checksum.duckdb"
    db = Database(path)
    db.connection.execute("UPDATE schema_migrations SET sha256='invalid' WHERE version=1")
    db.close()
    with pytest.raises(RuntimeError, match="MIGRATION_CHECKSUM_MISMATCH"):
        Database(path)
