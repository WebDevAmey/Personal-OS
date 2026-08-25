CREATE INDEX IF NOT EXISTS memories_embedding_idx ON "Memory" USING hnsw (embedding vector_cosine_ops);
