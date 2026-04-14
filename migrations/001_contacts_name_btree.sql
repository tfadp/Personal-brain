-- Migration: Add B-tree index on contacts.name for alphabetical sort performance
-- Run date: 2026-04-14
-- Why: trigram index is great for ilike searches but slow for ORDER BY.
--      The contacts page loads 2000+ rows sorted by name — this index
--      makes that sort use the index directly instead of table scan + sort.
--
-- To apply: paste this into Supabase SQL Editor and click Run.
-- Safe: adding a nullable B-tree index never locks writes on the table.

CREATE INDEX IF NOT EXISTS idx_contacts_name_btree ON contacts(name);
