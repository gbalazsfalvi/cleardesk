CREATE TABLE users (
    id VARCHAR PRIMARY KEY,
    username VARCHAR NOT NULL UNIQUE,
    display_name VARCHAR NOT NULL,
    password_hash VARCHAR NOT NULL,
    disabled BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE workspaces (
    id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL
);
CREATE TABLE workspace_revisions (
    workspace_id VARCHAR PRIMARY KEY REFERENCES workspaces(id),
    revision BIGINT NOT NULL CHECK (revision > 0)
);
CREATE TABLE memberships (
    user_id VARCHAR NOT NULL REFERENCES users(id),
    workspace_id VARCHAR NOT NULL REFERENCES workspaces(id),
    role VARCHAR NOT NULL CHECK (role IN ('MEMBER', 'HR', 'ADMIN')),
    PRIMARY KEY (user_id, workspace_id)
);
CREATE TABLE sessions (
    token_hash VARCHAR PRIMARY KEY,
    user_id VARCHAR REFERENCES users(id),
    csrf_token VARCHAR NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
