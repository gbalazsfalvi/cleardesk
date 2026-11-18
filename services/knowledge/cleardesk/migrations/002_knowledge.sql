CREATE TABLE documents (
    id VARCHAR PRIMARY KEY,
    workspace_id VARCHAR NOT NULL REFERENCES workspaces(id),
    title VARCHAR NOT NULL,
    filename VARCHAR NOT NULL,
    visibility VARCHAR NOT NULL CHECK (visibility IN ('WORKSPACE', 'HR')),
    content VARCHAR NOT NULL,
    content_sha256 VARCHAR NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    deleted BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE chunks (
    id VARCHAR PRIMARY KEY,
    document_id VARCHAR NOT NULL REFERENCES documents(id),
    ordinal INTEGER NOT NULL,
    content VARCHAR NOT NULL,
    embedding FLOAT[384] NOT NULL,
    UNIQUE(document_id, ordinal)
);
CREATE INDEX documents_workspace ON documents(workspace_id);
CREATE INDEX chunks_document ON chunks(document_id);
