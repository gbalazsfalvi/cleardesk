"""Owned runtime state, mirroring apps/api/src/state.ts and scripts/state.mjs.

The owner's state is `.local`. An acceptance run may select exactly one isolated directory
`.local/acceptance/<name>`; every other value is refused.
"""

import os
import re
from pathlib import Path

_PREFIX = ".local/acceptance/"
_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}")


def state_directory(root: Path, value: str | None = ...) -> Path:
    if value is ...:
        value = os.environ.get("CLEARDESK_STATE")
    if not value:
        return root / ".local"
    normalized = value.replace("\\", "/")
    name = normalized[len(_PREFIX) :] if normalized.startswith(_PREFIX) else ""
    if not _NAME.fullmatch(name):
        raise ValueError("STATE_DIRECTORY_INVALID")
    return root / ".local" / "acceptance" / name
