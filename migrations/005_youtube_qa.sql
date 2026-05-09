-- Migration: YouTube transcripts + per-signal Q&A persistence
-- Run date: 2026-05-08
-- Why: enables a paste-a-YouTube-link workflow where Cortex stores the full
--      transcript on the signal row, generates a structured TL;DR-style
--      summary, and lets the user ask grounded questions about the video.
--      Q&A history persists so revisiting a signal shows prior questions.
--
-- To apply: paste this into Supabase SQL Editor and click Run.
-- Safe: every statement uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so
--       running it twice is a no-op.

-- Step 1 — extend signals with transcript + source_type
ALTER TABLE signals ADD COLUMN IF NOT EXISTS transcript text;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS source_type text; -- 'youtube' | 'article' | null

CREATE INDEX IF NOT EXISTS idx_signals_source_type
  ON signals (source_type)
  WHERE source_type IS NOT NULL;

-- Step 2 — Q&A history table (one row per question asked)
CREATE TABLE IF NOT EXISTS signal_questions (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_id  uuid        NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  question   text        NOT NULL,
  answer     text        NOT NULL,
  asked_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signal_questions_signal_id
  ON signal_questions (signal_id, asked_at DESC);

-- Personal local-use app, no auth — match other tables (RLS off)
ALTER TABLE signal_questions DISABLE ROW LEVEL SECURITY;
