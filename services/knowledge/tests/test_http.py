"""The loopback service still requires its credential and independently checked session."""

from fastapi.testclient import TestClient

from cleardesk.main import create_app


class FixtureEmbeddings:
    ready = True

    def embed(self, texts):
        return [[1.0] + [0.0] * 383 for _ in texts]


def test_private_service_requires_credential_and_rejects_extra_authority(tmp_path):
    app = create_app(
        tmp_path / "http.duckdb", "private-test-service-credential", FixtureEmbeddings()
    )
    with TestClient(app) as client:
        assert client.get("/v1/status").status_code == 401
        headers = {"x-cleardesk-service": "private-test-service-credential"}
        assert client.get("/v1/status", headers=headers).status_code == 200
        anonymous = client.post("/v1/session", headers=headers, json={}).json()
        headers["x-cleardesk-session"] = anonymous["token"]
        response = client.post(
            "/v1/login",
            headers=headers,
            json={
                "username": "alice",
                "password": "test",
                "csrfToken": anonymous["csrfToken"],
                "role": "ADMIN",
            },
        )
        assert response.status_code == 400
        path = "/v1/workspaces/00000000-0000-4000-8000-000000000001/documents"
        assert client.get(path, headers=headers).status_code == 401


def test_private_body_bound_and_missing_session_fail_before_effects(tmp_path):
    app = create_app(
        tmp_path / "http.duckdb", "private-test-service-credential", FixtureEmbeddings()
    )
    with TestClient(app) as client:
        headers = {"x-cleardesk-service": "private-test-service-credential"}
        assert client.post("/v1/login", headers=headers, content="x" * 262145).status_code == 413
        assert client.get("/v1/session", headers=headers).status_code == 401
