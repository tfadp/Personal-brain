# Cortex — Exceptions Log

## Open

*(none)*

---

## Resolved

### EX-001 — Schema migrations from 9ab1324 ✅ RESOLVED (2026-04-09)
**What:** Commit 9ab1324 added schema constraints and indexes but they weren't applied to Supabase.
**Resolution:** Ran full migration in Supabase SQL editor — ALTER TABLE for date type, CHECK constraints, unique indexes, trigram indexes. All active.
