"""Retrieval tests use deliberately adversarial vectors, not the production policy oracle."""

from uuid import uuid4

import pytest

from cleardesk.db import Database
from cleardesk.documents import DocumentStore, split_text
from cleardesk.identity import IdentityStore
from cleardesk.policy import Role


def vector(axis=0):
    result = [0.0] * 384
    result[axis] = 1.0
    return result


@pytest.fixture
def library(tmp_path):
    db = Database(tmp_path / "library.duckdb")
    identity = IdentityStore(db)
    north = identity.create_workspace("Northstar")
    harbor = identity.create_workspace("Harbor")
    tokens = {}
    for name, role in [("member", Role.MEMBER), ("hr", Role.HR), ("admin", Role.ADMIN)]:
        user = identity.create_user(name, name.title(), "test-only-password")
        identity.set_membership(user, north, role)
        identity.set_membership(user, harbor, role)
        anonymous = identity.create_anonymous_session()
        tokens[name] = identity.login(
            anonymous["token"], anonymous["csrfToken"], name, "test-only-password"
        )["token"]
    store = DocumentStore(db, identity)
    yield store, identity, tokens, north, harbor
    db.close()


def ingest(
    store,
    token,
    workspace,
    title,
    text="Synthetic public knowledge.",
    visibility="WORKSPACE",
    axis=0,
):
    chunks = split_text(text)
    return store.ingest(
        token,
        workspace,
        {"title": title, "filename": "source.md", "text": text, "visibility": visibility},
        [vector(axis)] * len(chunks),
    )


def test_scope_is_applied_before_top_k_even_for_a_dual_workspace_user(library):
    store, _, tokens, north, harbor = library
    safe = ingest(store, tokens["admin"], north, "North handbook", axis=1)
    ingest(store, tokens["admin"], harbor, "FOREIGN-CANARY", axis=0)
    ingest(store, tokens["admin"], north, "HR-CANARY", visibility="HR", axis=0)
    hits = store.search(tokens["member"], north, vector(), 1)
    assert [hit["documentId"] for hit in hits] == [safe["id"]]
    assert "CANARY" not in str(hits)


def test_hr_and_admin_can_read_hr_but_member_cannot(library):
    store, _, tokens, north, _ = library
    doc = ingest(store, tokens["admin"], north, "People policy", visibility="HR")
    for account in ["hr", "admin"]:
        assert store.source(tokens[account], north, doc["id"])["title"] == "People policy"
    with pytest.raises(LookupError, match="NOT_FOUND"):
        store.source(tokens["member"], north, doc["id"])
    assert store.list(tokens["member"], north) == []


def test_source_and_chunk_ids_cannot_cross_workspace_or_document(library):
    store, _, tokens, north, harbor = library
    one = ingest(store, tokens["admin"], north, "First")
    two = ingest(store, tokens["admin"], north, "Second")
    chunk = store.search(tokens["member"], north, vector(), 6)[1]["chunkId"]
    with pytest.raises(LookupError):
        store.source(tokens["member"], harbor, one["id"])
    own_chunks = store.document_chunks(tokens["member"], north, one["id"])
    foreign_chunk = next(
        h["chunkId"]
        for h in store.search(tokens["member"], north, vector(), 6)
        if h["documentId"] == two["id"]
    )
    assert own_chunks and chunk
    with pytest.raises(LookupError):
        store.source(tokens["member"], north, one["id"], foreign_chunk)


def test_only_admin_can_ingest_change_acl_or_delete(library):
    store, _, tokens, north, _ = library
    doc = ingest(store, tokens["admin"], north, "Handbook")
    for account in ["member", "hr"]:
        with pytest.raises(PermissionError, match="FORBIDDEN"):
            ingest(store, tokens[account], north, "Forbidden")
        with pytest.raises(PermissionError):
            store.set_acl(tokens[account], north, doc["id"], "HR")
        with pytest.raises(PermissionError):
            store.delete(tokens[account], north, doc["id"])


def test_acl_and_deletion_increment_revision_and_remove_access(library):
    store, identity, tokens, north, _ = library
    doc = ingest(store, tokens["admin"], north, "Mutable access")
    before = identity.actor_context(tokens["member"], north).revision
    store.set_acl(tokens["admin"], north, doc["id"], "HR")
    assert identity.actor_context(tokens["member"], north).revision == before + 1
    assert store.search(tokens["member"], north, vector(), 6) == []
    store.delete(tokens["admin"], north, doc["id"])
    with pytest.raises(LookupError):
        store.source(tokens["admin"], north, doc["id"])


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), 1e40])
def test_bad_embeddings_fail_without_partial_ingestion(library, bad):
    store, _, tokens, north, _ = library
    invalid = vector()
    invalid[0] = bad
    with pytest.raises(ValueError):
        store.ingest(
            tokens["admin"],
            north,
            {"title": "Bad", "filename": "bad.txt", "text": "text", "visibility": "WORKSPACE"},
            [invalid],
        )
    assert store.list(tokens["admin"], north) == []


@pytest.mark.parametrize(
    "field,value",
    [
        ("filename", "../escape.md"),
        ("text", "x" * 65537),
        ("visibility", "PUBLIC"),
        ("text", "\0"),
        ("role", "ADMIN"),
    ],
)
def test_private_ingest_revalidates_inputs(library, field, value):
    store, _, tokens, north, _ = library
    data = {"title": "Safe", "filename": "safe.md", "text": "text", "visibility": "WORKSPACE"}
    data[field] = value
    with pytest.raises(ValueError):
        store.ingest(tokens["admin"], north, data, [vector()])


def test_sql_payload_is_a_literal_title_and_unknown_ids_fail_closed(library):
    store, _, tokens, north, _ = library
    title = "Robert'); DROP TABLE documents;--"
    doc = ingest(store, tokens["admin"], north, title)
    assert store.source(tokens["member"], north, doc["id"])["title"] == title
    with pytest.raises(LookupError):
        store.source(tokens["member"], north, str(uuid4()))


def test_chunking_is_bounded_and_preserves_overlaps():
    chunks = split_text("a" * 2100)
    assert [len(chunk) for chunk in chunks] == [1000, 1000, 400]
    assert chunks[0][-150:] == chunks[1][:150]


def test_document_mutations_leave_safe_metadata_events(library):
    store, _, tokens, north, _ = library
    document = ingest(store, tokens["admin"], north, "Audit source", "DO-NOT-LOG-THIS-CONTENT")
    store.set_acl(tokens["admin"], north, document["id"], "HR")
    store.delete(tokens["admin"], north, document["id"])
    rows = store.db.connection.execute(
        "SELECT code,resource_id FROM activity WHERE workspace_id=? ORDER BY created_at", [north]
    ).fetchall()
    assert [row[0] for row in rows] == [
        "DOCUMENT_INGESTED",
        "DOCUMENT_ACL_CHANGED",
        "DOCUMENT_DELETED",
    ]
    assert all(row[1] == document["id"] for row in rows)
    assert "DO-NOT-LOG" not in str(rows)
