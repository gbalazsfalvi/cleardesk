CREATE TABLE conversations (
    id VARCHAR PRIMARY KEY,
    user_id VARCHAR NOT NULL REFERENCES users(id),
    workspace_id VARCHAR NOT NULL REFERENCES workspaces(id),
    title VARCHAR NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE turns (
    id VARCHAR PRIMARY KEY,
    conversation_id VARCHAR NOT NULL REFERENCES conversations(id),
    request_key VARCHAR NOT NULL,
    question VARCHAR NOT NULL,
    revision BIGINT NOT NULL,
    status VARCHAR NOT NULL,
    answer VARCHAR,
    citations_json VARCHAR NOT NULL,
    model_json VARCHAR NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE(conversation_id, request_key)
);
CREATE TABLE turn_context (
    turn_id VARCHAR NOT NULL REFERENCES turns(id),
    chunk_id VARCHAR NOT NULL REFERENCES chunks(id),
    PRIMARY KEY(turn_id, chunk_id)
);
CREATE TABLE activity (
    id VARCHAR PRIMARY KEY,
    workspace_id VARCHAR NOT NULL,
    actor_id VARCHAR NOT NULL,
    code VARCHAR NOT NULL,
    resource_id VARCHAR NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
