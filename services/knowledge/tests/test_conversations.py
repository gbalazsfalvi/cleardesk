"""Conversation provenance is enforced by storage, including uncited model context."""

from uuid import uuid4

import pytest
from test_documents import ingest, vector

from cleardesk.conversations import ConversationStore


@pytest.fixture
def chat(library):
    docs, identity, tokens, north, harbor = library
    conversations = ConversationStore(docs.db, identity, docs)
    return conversations, docs, tokens, north, harbor


def prepare(chat, account="member", question="What is the policy?"):
    store, _, tokens, north, _ = chat
    thread = store.create(tokens[account], north, {})
    turn = store.prepare(tokens[account], north, thread["id"], question, str(uuid4()))
    return thread, turn


def answer(chat, thread, turn, hits):
    store, _, tokens, north, _ = chat
    store.register_context(tokens["member"], north, thread["id"], turn["turnId"], hits)
    return store.finalize(
        tokens["member"],
        north,
        thread["id"],
        turn["turnId"],
        {
            "kind": "answer",
            "answer": "A synthetic answer.",
            "citations": [{"documentId": hits[0]["documentId"], "chunkId": hits[0]["chunkId"]}],
        },
        {"mode": "fixture", "id": "test", "version": "1"},
    )


def test_foreign_owner_and_same_actor_other_workspace_cannot_open_thread(chat):
    store, _, tokens, north, harbor = chat
    thread, _ = prepare(chat)
    for token, workspace in [(tokens["hr"], north), (tokens["member"], harbor)]:
        with pytest.raises(LookupError, match="NOT_FOUND"):
            store.messages(token, workspace, thread["id"])
    assert store.list(tokens["member"], harbor) == []


def test_idempotency_does_not_create_a_second_turn_and_changed_input_conflicts(chat):
    store, _, tokens, north, _ = chat
    thread = store.create(tokens["member"], north, {})
    key = str(uuid4())
    first = store.prepare(tokens["member"], north, thread["id"], "Question", key)
    replay = store.prepare(tokens["member"], north, thread["id"], "Question", key)
    assert first["isNew"] is True and replay["isNew"] is False
    assert first["turnId"] == replay["turnId"]
    with pytest.raises(ValueError, match="REQUEST_CONFLICT"):
        store.prepare(tokens["member"], north, thread["id"], "Different", key)


def test_only_registry_citations_can_be_finalized(chat):
    store, docs, tokens, north, _ = chat
    doc = ingest(docs, tokens["admin"], north, "Handbook")
    thread, turn = prepare(chat)
    hit = docs.search(tokens["member"], north, vector(), 1)[0]
    fabricated = {
        "kind": "answer",
        "answer": "Invented citation",
        "citations": [{"documentId": doc["id"], "chunkId": hit["chunkId"]}],
    }
    result = store.finalize(
        tokens["member"],
        north,
        thread["id"],
        turn["turnId"],
        fabricated,
        {"mode": "fixture", "id": "test", "version": "1"},
    )
    assert result["status"] == "UNVERIFIED_RESPONSE" and result["answer"] is None


def test_in_flight_revision_change_discards_answer(chat):
    store, docs, tokens, north, _ = chat
    doc = ingest(docs, tokens["admin"], north, "Changing")
    thread, turn = prepare(chat)
    hits = docs.search(tokens["member"], north, vector(), 1)
    store.register_context(tokens["member"], north, thread["id"], turn["turnId"], hits)
    docs.set_acl(tokens["admin"], north, doc["id"], "HR")
    result = store.finalize(
        tokens["member"],
        north,
        thread["id"],
        turn["turnId"],
        {
            "kind": "answer",
            "answer": "Must never be saved",
            "citations": [{"documentId": hits[0]["documentId"], "chunkId": hits[0]["chunkId"]}],
        },
        {"mode": "fixture", "id": "test", "version": "1"},
    )
    assert result["status"] == "ACCESS_CHANGED" and result["answer"] is None
    assert "Must never be saved" not in str(store.messages(tokens["member"], north, thread["id"]))


def test_revocation_of_uncited_context_redacts_history_and_future_context(chat):
    store, docs, tokens, north, _ = chat
    ingest(docs, tokens["admin"], north, "Cited")
    ingest(docs, tokens["admin"], north, "Uncited but model-visible")
    hits = docs.search(tokens["member"], north, vector(), 6)
    thread, turn = prepare(chat)
    assert answer(chat, thread, turn, hits)["status"] == "ANSWERED"
    docs.set_acl(tokens["admin"], north, hits[1]["documentId"], "HR")
    messages = store.messages(tokens["member"], north, thread["id"])
    assert messages[-1]["status"] == "ACCESS_REVOKED"
    assert "A synthetic answer" not in str(messages)
    later = store.prepare(tokens["member"], north, thread["id"], "Follow up", str(uuid4()))
    assert "A synthetic answer" not in str(later["history"])


def test_history_dependencies_propagate_even_when_new_answer_has_no_new_sources(chat):
    store, docs, tokens, north, _ = chat
    doc = ingest(docs, tokens["admin"], north, "Original context")
    hits = docs.search(tokens["member"], north, vector(), 6)
    thread, turn = prepare(chat)
    answer(chat, thread, turn, hits)
    second = store.prepare(tokens["member"], north, thread["id"], "Summarize again", str(uuid4()))
    assert second["history"]
    result = store.finalize(
        tokens["member"],
        north,
        thread["id"],
        second["turnId"],
        {"kind": "insufficient", "answer": "Not enough knowledge.", "citations": []},
        {"mode": "fixture", "id": "test", "version": "1"},
    )
    assert result["status"] == "INSUFFICIENT_KNOWLEDGE"
    docs.delete(tokens["admin"], north, doc["id"])
    assistant = [
        m for m in store.messages(tokens["member"], north, thread["id"]) if m["role"] == "assistant"
    ]
    assert all(m["status"] == "ACCESS_REVOKED" for m in assistant)


def test_cancel_is_terminal_and_other_actor_cannot_cancel(chat):
    store, _, tokens, north, _ = chat
    thread, turn = prepare(chat)
    with pytest.raises(LookupError):
        store.cancel(tokens["hr"], north, thread["id"], turn["turnId"])
    assert (
        store.cancel(tokens["member"], north, thread["id"], turn["turnId"])["status"] == "CANCELLED"
    )
    result = store.finalize(
        tokens["member"],
        north,
        thread["id"],
        turn["turnId"],
        {"kind": "insufficient", "answer": "Late", "citations": []},
        {"mode": "fixture", "id": "test", "version": "1"},
    )
    assert result["status"] == "CANCELLED" and result["answer"] is None


def test_registry_rejects_foreign_chunks_despite_dual_membership(chat):
    store, docs, tokens, north, harbor = chat
    ingest(docs, tokens["admin"], harbor, "Foreign context")
    foreign = docs.search(tokens["member"], harbor, vector(), 1)
    thread, turn = prepare(chat)
    with pytest.raises(LookupError):
        store.register_context(tokens["member"], north, thread["id"], turn["turnId"], foreign)
