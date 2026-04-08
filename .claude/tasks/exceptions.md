# exceptions.md — Proactive Catches

## Format
- [DATE] | [FILE] | [WHAT WAS CAUGHT] | [RESOLUTION]

## Log
- 2026-04-07 | src/app/page.tsx | Used setTimeout + DOM requestSubmit() to trigger form from preset button — fragile pattern | Extracted runQuery(text) function so button calls it directly, no DOM needed
- 2026-04-07 | src/app/api/query/route.ts | Hardcoded snapshot model ID claude-sonnet-4-20250514 would become stale | Updated to alias claude-sonnet-4-6
- 2026-04-08 | src/app/api/signal/route.ts | Duplicate source_title key in insert object — TypeScript silent overwrite | Removed the first instance, kept the enriched version
- 2026-04-08 | src/app/api/import/route.ts | Claude JSON response sometimes wrapped in markdown fences causing JSON.parse failure | Added fence-stripping regex before all Claude JSON parses
- 2026-04-08 | src/lib/schema.sql | Added 3 new contact columns (contact_quality, follow_up, follow_up_note) — Supabase table NOT yet migrated | UNRESOLVED — user must run ALTER TABLE before these fields work
