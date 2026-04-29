-- Migration: add signal_contacts join table
-- Run date: 2026-04-28
-- Why: signals often mention specific people but we had no structured way to
--      query "which signals reference this contact" or "who is mentioned in
--      this signal". This join table unlocks both directions of that query.
--
-- To apply: paste this into Supabase SQL Editor and click Run.
-- Safe: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS are no-ops
--       if the table/index already exists.

CREATE TABLE IF NOT EXISTS signal_contacts (
  signal_id  uuid NOT NULL REFERENCES signals(id)  ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (signal_id, contact_id)
);

-- Supports the "signals mentioning this person" query path
CREATE INDEX IF NOT EXISTS idx_signal_contacts_contact_id
  ON signal_contacts (contact_id);

-- This is a personal local-use app with no auth — anon key writes everything.
-- Match the other tables (contacts, signals, interactions) which all have RLS off.
ALTER TABLE signal_contacts DISABLE ROW LEVEL SECURITY;
