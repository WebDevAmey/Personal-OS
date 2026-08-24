-- Custom SQL migration file, put your code below! -----
-- HNSW index for memories.embedding cosine-distance search, used by
-- lib/memory/queries.ts's searchMemory (`ORDER BY embedding <=> ...`).
-- Previously applied by hand to the dev database only and documented as a
-- manual step in the deployment checklist - anyone provisioning a fresh
-- database via `pnpm run db:migrate` (a new preview branch, a rebuilt prod
-- DB, a new contributor) silently got no index. IF NOT EXISTS makes this
-- a safe no-op against a database where it was already applied by hand.
CREATE INDEX IF NOT EXISTS "memories_embedding_idx" ON "memories" USING hnsw ("embedding" vector_cosine_ops);
