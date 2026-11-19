"""The service and seed must resolve the same owned state directory as the TypeScript side."""

from pathlib import Path

import pytest

from cleardesk.state import state_directory

ROOT = Path("C:/synthetic/cleardesk")


def test_owner_state_is_dot_local_by_default():
    assert state_directory(ROOT, None) == ROOT / ".local"
    assert state_directory(ROOT, "") == ROOT / ".local"


def test_acceptance_state_maps_to_its_own_directory():
    assert state_directory(ROOT, ".local/acceptance/run-1") == ROOT / ".local/acceptance/run-1"
    assert state_directory(ROOT, ".local\\acceptance\\run-2") == ROOT / ".local/acceptance/run-2"


@pytest.mark.parametrize(
    "value",
    [
        ".local",
        ".local/private",
        ".local/acceptance/",
        ".local/acceptance/..",
        ".local/acceptance/../private",
        ".local/acceptance/a/b",
        ".local/acceptance/.hidden",
        "/tmp/cleardesk",
        "C:/Users/example/state",
    ],
)
def test_other_locations_are_refused(value):
    with pytest.raises(ValueError, match="STATE_DIRECTORY_INVALID"):
        state_directory(ROOT, value)


def test_environment_selects_the_state(monkeypatch):
    monkeypatch.setenv("CLEARDESK_STATE", ".local/acceptance/run-3")
    assert state_directory(ROOT) == ROOT / ".local/acceptance/run-3"
    monkeypatch.delenv("CLEARDESK_STATE")
    assert state_directory(ROOT) == ROOT / ".local"
