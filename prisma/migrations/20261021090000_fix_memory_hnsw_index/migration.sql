-- M1: fix the HNSW index name collision (docs/03 §7.2, audit §5.1).
--
-- 20260825055921 created `memories_embedding_idx` with IF NOT EXISTS. On a
-- database that was previously migrated by Drizzle, that name already
-- belonged to the legacy "memories" table, so the statement was a silent
-- no-op and "Memory" never got a vector index.

DO $$
BEGIN
  -- Fresh DB: the index exists on "Memory" under the legacy name → rename it.
  IF EXISTS (SELECT 1 FROM pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'memories_embedding_idx'
               AND tablename = 'Memory') THEN
    ALTER INDEX "memories_embedding_idx" RENAME TO "Memory_embedding_hnsw_idx";
  END IF;
END $$;

-- Drizzle-era DB: the legacy name is owned by "memories"; create the real one.
CREATE INDEX IF NOT EXISTS "Memory_embedding_hnsw_idx"
  ON "Memory" USING hnsw ("embedding" vector_cosine_ops);
