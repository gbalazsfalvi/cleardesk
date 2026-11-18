"""Independent examples for workspace/document authority, not an LLM refusal test."""

import pytest

from cleardesk.policy import ActorContext, DocumentAccess, Role, allowed_document, require_document


@pytest.mark.parametrize(
    ("role", "visibility", "expected"),
    [
        (Role.MEMBER, "WORKSPACE", True),
        (Role.MEMBER, "HR", False),
        (Role.HR, "WORKSPACE", True),
        (Role.HR, "HR", True),
        (Role.ADMIN, "WORKSPACE", True),
        (Role.ADMIN, "HR", True),
    ],
)
def test_role_policy_examples(role, visibility, expected):
    actor = ActorContext(user_id="alex", workspace_id="northstar", role=role, revision=1)
    document = DocumentAccess(document_id="doc", workspace_id="northstar", visibility=visibility)
    assert allowed_document(actor, document) is expected


@pytest.mark.parametrize("role", list(Role))
def test_no_role_grants_another_workspace(role):
    actor = ActorContext(user_id="alex", workspace_id="northstar", role=role, revision=1)
    document = DocumentAccess(document_id="foreign", workspace_id="harbor", visibility="WORKSPACE")
    assert allowed_document(actor, document) is False
    with pytest.raises(LookupError, match="NOT_FOUND"):
        require_document(actor, document)


def test_deleted_document_is_unavailable_even_for_admin():
    actor = ActorContext(user_id="admin", workspace_id="northstar", role=Role.ADMIN, revision=1)
    document = DocumentAccess(
        document_id="deleted", workspace_id="northstar", visibility="WORKSPACE", deleted=True
    )
    assert allowed_document(actor, document) is False


def test_dual_workspace_membership_does_not_merge_current_scope():
    northstar = ActorContext(user_id="alex", workspace_id="northstar", role=Role.MEMBER, revision=1)
    harbor = ActorContext(user_id="alex", workspace_id="harbor", role=Role.MEMBER, revision=1)
    document = DocumentAccess(
        document_id="harbor-doc", workspace_id="harbor", visibility="WORKSPACE"
    )
    assert allowed_document(northstar, document) is False
    assert allowed_document(harbor, document) is True


@pytest.mark.parametrize("role", list(Role))
def test_unknown_visibility_fails_closed(role):
    actor = ActorContext(user_id="alex", workspace_id="northstar", role=role, revision=1)
    document = DocumentAccess(
        document_id="bad", workspace_id="northstar", visibility="UNRECOGNIZED"
    )
    assert allowed_document(actor, document) is False
