"""Session and membership storage; no model/browser authority is accepted here."""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import timedelta
from uuid import uuid4

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from argon2.low_level import Type

from .db import Database
from .policy import ActorContext, Role


class IdentityStore:
    """Persist hashed opaque sessions and resolve roles from current memberships."""

    def __init__(self, database: Database):
        self.db = database
        self.hasher = PasswordHasher(
            time_cost=2, memory_cost=19456, parallelism=1, salt_len=16, hash_len=32, type=Type.ID
        )
        self._dummy_hash = self.hasher.hash(secrets.token_urlsafe(24))

    @staticmethod
    def _token_hash(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    @staticmethod
    def _username(value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"[a-z0-9._-]{1,64}", value):
            raise ValueError("INVALID_INPUT")
        return value

    @staticmethod
    def _password(value: str) -> None:
        if not 1 <= len(value) <= 256:
            raise ValueError("INVALID_INPUT")
        try:
            value.encode("utf-8")
        except UnicodeEncodeError as error:
            raise ValueError("INVALID_INPUT") from error

    def create_user(self, username: str, display_name: str, password: str) -> str:
        """Bootstrap an owned synthetic account without resetting an existing password."""
        username = self._username(username)
        self._password(password)
        current = self.db.connection.execute(
            "SELECT id FROM users WHERE username = ?", [username]
        ).fetchone()
        if current:
            return current[0]
        user_id = str(uuid4())
        self.db.connection.execute(
            "INSERT INTO users VALUES (?, ?, ?, ?, FALSE)",
            [user_id, username, display_name, self.hasher.hash(password)],
        )
        return user_id

    def create_workspace(self, name: str) -> str:
        workspace_id = str(uuid4())
        with self.db.transaction() as connection:
            connection.execute("INSERT INTO workspaces VALUES (?, ?)", [workspace_id, name])
            connection.execute("INSERT INTO workspace_revisions VALUES (?, 1)", [workspace_id])
        return workspace_id

    def set_membership(self, user_id: str, workspace_id: str, role: Role) -> None:
        role = Role(role)
        with self.db.transaction() as connection:
            connection.execute(
                """INSERT INTO memberships VALUES (?, ?, ?)
                ON CONFLICT (user_id, workspace_id) DO UPDATE SET role = excluded.role""",
                [user_id, workspace_id, role.value],
            )
            connection.execute(
                "UPDATE workspace_revisions SET revision = revision + 1 WHERE workspace_id = ?",
                [workspace_id],
            )

    def _insert_session(self, user_id: str | None) -> dict:
        # Anonymous sessions are also bounded; expired rows never accumulate indefinitely.
        self.db.connection.execute("DELETE FROM sessions WHERE expires_at <= ?", [self.db.now()])
        if self.db.connection.execute("SELECT count(*) FROM sessions").fetchone()[0] >= 500:
            raise OverflowError("BUSY")
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(32)
        now = self.db.now()
        expires = now + timedelta(minutes=30)
        self.db.connection.execute(
            "INSERT INTO sessions VALUES (?, ?, ?, ?, ?)",
            [self._token_hash(token), user_id, csrf, now, expires],
        )
        return {"token": token, "csrfToken": csrf, "expiresAt": expires.isoformat()}

    def create_anonymous_session(self) -> dict:
        return self._insert_session(None)

    def _session(self, token: str) -> tuple:
        if not isinstance(token, str) or not 16 <= len(token) <= 128:
            raise LookupError("AUTH_REQUIRED")
        digest = self._token_hash(token)
        row = self.db.connection.execute(
            "SELECT user_id, csrf_token, expires_at FROM sessions WHERE token_hash = ?", [digest]
        ).fetchone()
        if not row or row[2] <= self.db.now():
            if row:
                self.db.connection.execute("DELETE FROM sessions WHERE token_hash = ?", [digest])
            raise LookupError("AUTH_REQUIRED")
        return row

    def require_csrf(self, token: str, supplied: str) -> None:
        row = self._session(token)
        if (
            not isinstance(supplied, str)
            or len(supplied) > 128
            or not hmac.compare_digest(
                supplied.encode("utf-8", errors="replace"), row[1].encode("ascii")
            )
        ):
            raise PermissionError("CSRF_REJECTED")

    def login(self, token: str, csrf_token: str, username: str, password: str) -> dict:
        self.require_csrf(token, csrf_token)
        username = self._username(username)
        self._password(password)
        row = self.db.connection.execute(
            "SELECT id, password_hash, disabled FROM users WHERE username = ?", [username]
        ).fetchone()
        valid = False
        try:
            valid = self.hasher.verify(row[1] if row else self._dummy_hash, password)
        except (VerificationError, InvalidHashError):
            pass
        if not row or not valid or row[2]:
            raise PermissionError("INVALID_CREDENTIALS")
        with self.db.transaction() as connection:
            connection.execute(
                "DELETE FROM sessions WHERE token_hash = ?", [self._token_hash(token)]
            )
            return self._insert_session(row[0])

    def lookup_session(self, token: str) -> dict:
        row = self._session(token)
        actor = None
        workspaces = []
        if row[0] is not None:
            user = self.db.connection.execute(
                "SELECT id, username, display_name FROM users WHERE id = ? AND NOT disabled",
                [row[0]],
            ).fetchone()
            if not user:
                self.db.connection.execute(
                    "DELETE FROM sessions WHERE token_hash = ?", [self._token_hash(token)]
                )
                raise LookupError("AUTH_REQUIRED")
            actor = {"id": user[0], "username": user[1], "displayName": user[2]}
            workspaces = [
                {"id": item[0], "name": item[1], "role": item[2]}
                for item in self.db.connection.execute(
                    """SELECT w.id, w.name, m.role
                              FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
                              WHERE m.user_id = ? ORDER BY w.name""",
                    [user[0]],
                ).fetchall()
            ]
        self.db.connection.execute(
            "UPDATE sessions SET expires_at = ? WHERE token_hash = ?",
            [self.db.now() + timedelta(minutes=30), self._token_hash(token)],
        )
        return {
            "authenticated": actor is not None,
            "actor": actor,
            "workspaces": workspaces,
            "csrfToken": row[1],
        }

    def actor_context(self, token: str, workspace_id: str) -> ActorContext:
        session = self.lookup_session(token)
        if not session["authenticated"]:
            raise LookupError("AUTH_REQUIRED")
        user_id = session["actor"]["id"]
        row = self.db.connection.execute(
            """SELECT m.role, r.revision FROM memberships m
            JOIN workspace_revisions r ON r.workspace_id = m.workspace_id
            WHERE m.user_id = ? AND m.workspace_id = ?""",
            [user_id, workspace_id],
        ).fetchone()
        if not row:
            raise LookupError("NOT_FOUND")
        return ActorContext(
            user_id=user_id, workspace_id=workspace_id, role=Role(row[0]), revision=row[1]
        )

    def logout(self, token: str, csrf_token: str) -> None:
        self.require_csrf(token, csrf_token)
        self.db.connection.execute(
            "DELETE FROM sessions WHERE token_hash = ?", [self._token_hash(token)]
        )
