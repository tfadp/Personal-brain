# Cortex — Lessons Learned

## 2026-04-09 (evening)

### L9 — Intent heuristics must cover the full query vocabulary
**Problem:** "who do I need to follow up with" was misclassified as `update_contact` because the regex matched "follow up" before the query pattern matched "who do I need to".
**Fix:** Added explicit `query_contacts` patterns for follow-up queries before the `update_contact` pattern runs.
**Rule:** When adding a new heuristic pattern, check it doesn't shadow an existing one. Order matters in the fast_intent switch.

### L10 — DB data inconsistency kills structured queries
**Problem:** "who do I know in Los Angeles" returned 1 person (Lakers employee) because 6 more had city=LA. The query `ilike '%los angeles%'` missed them.
**Fix:** Added city alias expansion — "los angeles" searches for both "los angeles" and "la" in DB.
**Rule:** After any bulk import, check for abbreviation inconsistencies in city/location fields before relying on structured queries.

### L11 — Follow-up flag must be enforced in code, not trusted to Claude
**Problem:** "follow up with Tony Grillo" routed to update_contact but Claude sometimes omitted `follow_up: true` from the parsed JSON because of the "only include fields explicitly mentioned" instruction.
**Fix:** After Claude parses, code checks raw input with regex and enforces follow_up=true/false regardless.
**Rule:** For mutations that affect core workflow state (follow_up, contact_quality), enforce the value in code after the LLM parse — don't rely on the LLM to always include it.

### L12 — ORDER BY with nullable columns needs NULLS LAST on DESC
**Problem:** `order("contact_quality", { ascending: false })` in Postgres puts NULLs first on DESC — so unrated contacts (null) surfaced above rated ones.
**Fix:** Added `nullsFirst: false` to all contact_quality ORDER BY calls.
**Rule:** Any DESC sort on a nullable column needs `nullsFirst: false` explicitly, or null rows flood the top.

### L13 — res.ok check before JSON.parse() prevents silent data loss
**Problem:** `/rank` rate() advanced the queue and incremented rated_count even when the PUT request failed, silently losing the rating.
**Fix:** Check `res.ok` before advancing; show error message and stay on current contact if it fails.
**Rule:** Every `fetch()` that mutates data must check `res.ok` before trusting the response or updating UI state.

---

## 2026-04-09 (earlier)

### L1 — Pre-filter before sending to Claude
**Problem:** The unified route was loading the full contacts table and passing all rows to Claude for ranking.
**Fix:** Added DB-level pre-filtering (city, country, topic keywords) to narrow to ≤200 candidates before the LLM call.
**Rule:** Always pre-filter in Postgres before handing data to Claude. SQL is cheap; LLM context is expensive.

### L2 — Shared libs prevent duplicated logic
**Problem:** `unified/route.ts` and `signal/route.ts` both had copies of URL enrichment and contact find/merge logic.
**Fix:** Extracted to `src/lib/enrich.ts` and `src/lib/contact_update.ts`.
**Rule:** If the same business logic appears in two route handlers, extract it immediately.

### L3 — Ambiguous matches need a clarify response, not a silent mutation
**Problem:** When a name wasn't unique, the first match was used silently.
**Fix:** `contact_update.ts` returns `{clarify: true, candidates}` when multiple contacts match.
**Rule:** Never silently pick a record when a name is ambiguous. Return candidates and ask.

### L4 — Schema constraints belong in the database, not just the app
**Problem:** Enum fields were only validated in TypeScript. Invalid values could be written via SQL directly.
**Fix:** Added CHECK constraints in schema.sql; added boundary validation in CRUD route.
**Rule:** Validate enums at both the API boundary AND the DB constraint level.

### L5 — Screenshot "no match" should create, not error
**Problem:** Screenshot of unknown person returned an error instead of creating them.
**Fix:** Create a minimal contact with name + last_meaningful_contact + how_you_know_them.
**Rule:** For passive capture flows, prefer creating a minimal contact over blocking with an error.

---

## Prior sessions

### L6 — Supabase default row limit is 1000
A `.select()` without `.limit()` silently caps at 1000 rows. Always pass `.limit(5000)` or paginate when you need the full table.

### L7 — Always strip markdown fences from Claude JSON responses
Claude wraps JSON in ```json ... ``` blocks even when instructed not to. Strip with regex before `JSON.parse()`.

### L8 — Location filter fallback was masking query precision
A "< 5 results" fallback that added all contacts was overriding explicit city filters. Never add a catch-all fallback that ignores active filters.
