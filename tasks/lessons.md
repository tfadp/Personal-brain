# Cortex — Lessons Learned

## 2026-04-12

### L26 — Hardcoded alias maps can never be complete — use LLM expansion
**Problem:** The search system maintained 200+ lines of hardcoded alias maps (SEARCH_ALIASES, CITY_ALIASES, ROLE_TERMS). "Recruiting" didn't map to HR. "Brooklyn" didn't map to NYC. "Deal flow" didn't map to investing. Every new concept required manual additions.
**Fix:** Replaced all alias maps with a single Claude call (`expand_query`) that thinks like a human. "Recruiting" → HR, talent, staffing, headhunter. "Brooklyn" → NYC, New York. One function, ~100 tokens, ~200ms. Removed 223 lines of code.
**Rule:** When the enumeration of relationships between concepts is unbounded, don't try to hardcode it. Ask an LLM to do the expansion. A fast classification/expansion call is cheap and eliminates an entire class of bugs.

### L27 — max_tokens truncation returns valid-looking empty results
**Problem:** The semantic contact ranker (2048 max_tokens) was returning `[]` for "sports media" — looked like no results, but actually the response was truncated (`stop_reason: max_tokens`) mid-JSON. The parse fallback couldn't recover the partial array, so it returned empty. Diagnosed by logging `stop_reason`.
**Fix:** Raised to 4096. Also trimmed the candidate payload to essential fields (id, name, role, company, city, topics, quality) to reduce input token count.
**Rule:** Same as L20 — always check `stop_reason` when debugging empty LLM responses. "No results" and "truncated response" look identical from the outside.

---

## 2026-04-10/11

### L20 — max_tokens silently truncates bulk LLM output
**Problem:** Pasting 20 contacts into bulk add returned only 9 — Claude's JSON response was cut off mid-array at 2048 tokens. `JSON.parse` failed silently, the partial array was dropped, user saw nothing.
**Fix:** Raised max_tokens to 8192. Added a partial-recovery fallback: if JSON.parse fails, regex-extract every complete `{...}` object so nothing is silently lost. Also trimmed the prompt to omit null fields and halve output size.
**Rule:** When an LLM call returns a variable-length array, size max_tokens for the worst case and always provide a partial-parse fallback. Never let a truncation turn into a silent drop.

### L21 — Pattern order in fast_intent matters when patterns share keywords
**Problem:** "mark these for follow up [list of names with emails]" routed to add_contact because the 2+ email heuristic fired before the follow-up pattern could match. User got "All 12 contacts already exist" instead of the follow-up being applied.
**Fix:** Moved the multi-line-with-follow-up pattern above the email-list pattern.
**Rule:** Same as L9 — order matters. When adding new fast_intent patterns, check that patterns with broader shared vocabulary come first. Write explicit tests or smoke tests for the new phrasing.

### L22 — Clarify-then-apply requires ID passthrough, not re-search
**Problem:** When two Tony Grillos matched, the clarify UI let the user pick one — but clicking re-sent the original text ("follow up with Tony Grillo") which re-ran the name search, found both again, returned clarify again. Infinite loop, update never applied.
**Fix:** Added `apply_contact_update_by_id()` and passed the resolved contact_id from the clarify button directly to the API, bypassing name-matching entirely.
**Rule:** When a UI step resolves ambiguity, the resolution must carry a stable ID forward — never re-run the ambiguous search a second time and expect a different outcome.

### L23 — Supabase client `.limit()` is overridden by PostgREST max-rows project setting
**Problem:** `.limit(5000)` in the contacts API still returned 1000 rows because the Supabase project has a max-rows cap of 1000. The client cannot override it.
**Fix:** Replaced single query with a paginated loop — fetch 1000 rows at a time using `.range(offset, offset+999)` until the chunk is smaller than the page size.
**Rule:** When a Supabase `.limit()` call doesn't raise the ceiling, suspect PostgREST max-rows. Fix at the project level (dashboard → Settings → API → Max Rows) OR paginate in code. Don't assume client options override project settings.

### L24 — A brain output is not a library output
**Problem:** The combined-query feature returned a neat breakdown of "here are relevant signals" and "here are relevant contacts" — cataloguing, not thinking. User called it a "library not a brain."
**Fix:** Rewrote the Claude prompt to demand a direct opinion, a non-obvious connection, a concrete next move, and synthesis (thesis, POV bullets, tensions, gaps, hot take). UI demotes sources to collapsible footnotes so the opinion leads.
**Rule:** When building a synthesis feature, judge the output by whether it forms a view, not whether it covers the material. A useful brain response has an opinion at the top and evidence at the bottom. A useless one is a reading list with citations.

### L25 — Read the file before committing it
**Problem:** Committed HANDOFF.md after it was modified without reading it. Global CLAUDE.md says "read the file before proposing to add something to it" — same principle applies to commits.
**Fix:** Read after the user pointed it out. Nothing was wrong, but the rule was violated.
**Rule:** Before `git add`ing a file you didn't write in this session, read it. Even if the user described the changes, verify before committing.

---

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
