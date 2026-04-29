-- Migration: add notes table for markdown wiki / prose memory
-- Run date: 2026-04-28
-- Why: signals hold raw inputs and contacts hold CRM data, but there was
--      no layer for short distilled prose notes that survive across sessions.
--      Notes fill that gap — a lightweight personal wiki.
--
-- To apply: paste this into Supabase SQL Editor and click Run.
-- Safe: all statements use IF NOT EXISTS; trigger function uses
--       CREATE OR REPLACE so it is idempotent on re-run.

-- Step 1 — trigger function to auto-stamp updated_at on any UPDATE
-- OR REPLACE makes this safe to re-run; it will not error if it exists.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Step 2 — notes table
CREATE TABLE IF NOT EXISTS notes (
  id         uuid      DEFAULT gen_random_uuid() PRIMARY KEY,
  title      text      NOT NULL,
  body       text      NOT NULL,  -- markdown content
  topics     text[]    DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Step 3 — indexes
CREATE INDEX IF NOT EXISTS idx_notes_topics
  ON notes USING GIN (topics);

CREATE INDEX IF NOT EXISTS idx_notes_updated_at
  ON notes (updated_at DESC);

-- Step 4 — trigger: fire set_updated_at() before every UPDATE on notes
-- The DO $$ block makes this idempotent — no error if the trigger exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_notes_updated_at'
      AND tgrelid = 'notes'::regclass
  ) THEN
    CREATE TRIGGER trg_notes_updated_at
      BEFORE UPDATE ON notes
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

-- Step 5 — disable RLS to match the other tables in this project
-- This is a personal local-use app with no auth — anon key writes everything.
ALTER TABLE notes DISABLE ROW LEVEL SECURITY;
