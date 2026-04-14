-- Migration: enable pgvector and add contact_embedding column
-- Run date: 2026-04-14
-- Why: keyword DB pre-filter misses semantically-relevant contacts
--      ("who do I know in sports media" doesn't match ESPN via keyword alone).
--      Embeddings turn contacts into vectors so we pre-filter by meaning.
--
-- To apply: paste this into Supabase SQL Editor and click Run.
-- Safe: adding a nullable column never locks writes. The extension enable
-- is a no-op if already on.

-- Step 1 — enable the pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Step 2 — add an embedding column to contacts
-- Dimension 1536 matches OpenAI's text-embedding-3-small model.
-- Nullable because existing rows need a backfill pass before they have values.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS contact_embedding vector(1536);

-- Step 3 — add an approximate-nearest-neighbor index
-- HNSW is the standard choice for pgvector; cosine distance matches the
-- distance metric we'll use at query time.
-- This index speeds up ORDER BY contact_embedding <=> $1 LIMIT N.
CREATE INDEX IF NOT EXISTS idx_contacts_embedding_hnsw
  ON contacts
  USING hnsw (contact_embedding vector_cosine_ops);

-- Step 4 — RPC function for similarity search
-- Supabase clients can't call pgvector operators directly; a SQL function
-- wraps it so we can invoke it via supabase.rpc('match_contacts', ...).
CREATE OR REPLACE FUNCTION match_contacts(
  query_embedding vector(1536),
  match_count int DEFAULT 50
)
RETURNS TABLE (id uuid, similarity float)
LANGUAGE sql
AS $$
  SELECT
    c.id,
    1 - (c.contact_embedding <=> query_embedding) AS similarity
  FROM contacts c
  WHERE c.contact_embedding IS NOT NULL
  ORDER BY c.contact_embedding <=> query_embedding
  LIMIT match_count;
$$;

-- After running this, run the backfill script locally:
--   npm run embed:contacts
--
-- That will generate an embedding for every existing contact.
