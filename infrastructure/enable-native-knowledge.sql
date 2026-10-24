-- Opt-in only on a database backed by the matching pgvector PostgreSQL image.
-- Plain PostgreSQL deployments can still migrate and use RAGFlow without this extension.
CREATE EXTENSION IF NOT EXISTS vector;
