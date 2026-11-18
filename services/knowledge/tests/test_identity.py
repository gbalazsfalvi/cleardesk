"""Real DuckDB/session tests use independent actors and an injectable server clock."""

from datetime import UTC, datetime, timedelta

import pytest

from cleardesk.db import Database
from cleardesk.identity import IdentityStore
from cleardesk.policy import Role


@pytest.fixture
def identity(tmp_path):
    clock = [datetime(2026, 11, 18, 10, 0, tzinfo=UTC)]
    database = Database(tmp_path / "identity.duckdb", clock=lambda: clock[0])
    store = IdentityStore(database)
    alex = store.create_user("alex", "Alex", "a-generated-demo-password")
    workspace = store.create_workspace("Northstar")
    store.set_membership(alex, workspace, Role.MEMBER)
    yield store, database, clock, alex, workspace
    database.close()


def test_login_rotates_the_anonymous_session_and_csrf(identity):
    store, _, _, alex, workspace = identity
    old = store.create_anonymous_session()
    new = store.login(old["token"], old["csrfToken"], "alex", "a-generated-demo-password")
    assert new["token"] != old["token"]
    assert new["csrfToken"] != old["csrfToken"]
    with pytest.raises(LookupError, match="AUTH_REQUIRED"):
        store.lookup_session(old["token"])
    session = store.lookup_session(new["token"])
    assert session["actor"]["id"] == alex
    assert session["workspaces"] == [{"id": workspace, "name": "Northstar", "role": "MEMBER"}]


def test_bad_password_and_unknown_account_have_the_same_public_error(identity):
    store, _, _, _, _ = identity
    session = store.create_anonymous_session()
    for username, password in [("alex", "incorrect"), ("missing", "incorrect")]:
        with pytest.raises(PermissionError, match="INVALID_CREDENTIALS"):
            store.login(session["token"], session["csrfToken"], username, password)


def test_login_requires_the_existing_sessions_csrf(identity):
    store, _, _, _, _ = identity
    session = store.create_anonymous_session()
    with pytest.raises(PermissionError, match="CSRF_REJECTED"):
        store.login(session["token"], "forged", "alex", "a-generated-demo-password")


def test_logout_invalidates_persisted_session(identity):
    store, _, _, _, _ = identity
    initial = store.create_anonymous_session()
    signed = store.login(
        initial["token"], initial["csrfToken"], "alex", "a-generated-demo-password"
    )
    store.logout(signed["token"], signed["csrfToken"])
    with pytest.raises(LookupError, match="AUTH_REQUIRED"):
        store.lookup_session(signed["token"])


def test_idle_expiry_is_server_owned(identity):
    store, _, clock, _, _ = identity
    initial = store.create_anonymous_session()
    signed = store.login(
        initial["token"], initial["csrfToken"], "alex", "a-generated-demo-password"
    )
    clock[0] += timedelta(minutes=31)
    with pytest.raises(LookupError, match="AUTH_REQUIRED"):
        store.lookup_session(signed["token"])


def test_session_reads_current_membership_instead_of_cached_role(identity):
    store, _, _, alex, workspace = identity
    initial = store.create_anonymous_session()
    signed = store.login(
        initial["token"], initial["csrfToken"], "alex", "a-generated-demo-password"
    )
    first = store.actor_context(signed["token"], workspace)
    store.set_membership(alex, workspace, Role.HR)
    second = store.actor_context(signed["token"], workspace)
    assert first.role == Role.MEMBER
    assert second.role == Role.HR
    assert second.revision > first.revision


def test_foreign_workspace_has_no_authority(identity):
    store, _, _, _, _ = identity
    other = store.create_workspace("Harbor")
    initial = store.create_anonymous_session()
    signed = store.login(
        initial["token"], initial["csrfToken"], "alex", "a-generated-demo-password"
    )
    with pytest.raises(LookupError, match="NOT_FOUND"):
        store.actor_context(signed["token"], other)


def test_database_persists_only_the_session_token_hash(identity):
    store, database, _, _, _ = identity
    session = store.create_anonymous_session()
    rows = database.connection.execute("SELECT token_hash FROM sessions").fetchall()
    assert len(rows) == 1
    assert rows[0][0] != session["token"]
    assert len(rows[0][0]) == 64


def test_committed_identity_survives_reconstruction(tmp_path):
    path = tmp_path / "restart.duckdb"
    database = Database(path)
    store = IdentityStore(database)
    store.create_user("alex", "Alex", "a-generated-demo-password")
    initial = store.create_anonymous_session()
    signed = store.login(
        initial["token"], initial["csrfToken"], "alex", "a-generated-demo-password"
    )
    database.close()
    restored_database = Database(path)
    try:
        restored = IdentityStore(restored_database)
        assert restored.lookup_session(signed["token"])["actor"]["username"] == "alex"
    finally:
        restored_database.close()
