# Cortex — Task Board

## Session State
- **Branch:** `main`
- **Last test result:** 12/12 Vitest pass, `npm run build` clean — confirmed 2026-04-11
- **Deployed:** Yes — personal-brain-two.vercel.app, all commits pushed and live
- **Blockers:** None
- **Pending decisions:**
  - Nightly newsletter cron fires at 07:00 UTC — verify first live run dropped signals for the 4 configured senders
  - `/rank` page: ~2000 unrated contacts. Rating improves search quality significantly
  - Alias/category search is still heuristic — long-term improvement is embeddings-based retrieval

---

## Active Tasks (next up)

1. **Verify newsletter-sync cron fired overnight** — Hit `GET /api/newsletter-sync` manually via browser or check Vercel logs. Confirm signals from afterschool@substack.com, list@ben-evans.com, hi@www.garbageday.email, portfolio@juddporter.com landed in the DB.
2. **Add more newsletter senders as they come up** — User will paste sender emails into chat; edit `SENDERS` array in `src/app/api/newsletter-sync/route.ts` and deploy.
3. **Spend time on /rank** — Rate contacts using keyboard shortcuts (1/2/3 to rate, S to skip). Populates contact_quality so combined queries can prioritize strong ties.
4. **Second Gmail account sync** — Run `claude -p cortex-sync.md` against juddporter@gmail.com auth to sync last_meaningful_contact dates.
5. **Signal page nav link** — Add Signal to the nav bar (currently only reachable by typing `/signal`).
6. **Delete signal** — Add a delete button on saved signals.
7. **City normalization SQL** — Already ran and returned 0 rows; data was clean. No action needed unless new city inconsistencies appear.

---

## Completed ✅

### Session — 2026-04-10/11
- [x] Fix follow-up never applied bug — clarify click now applies update by contact ID (dd06069)
- [x] Bulk contact add — paste a list and they all get created (afe58b3)
- [x] Skip duplicate emails on bulk add instead of crashing (6c4a37b)
- [x] Bulk update — paste list with directive, applies to all (55cc604)
- [x] Fix bulk add truncation — raise max_tokens 2048→8192, recover partial JSON (8092539)
- [x] Fix bulk follow-up routing — multi-line + follow-up always routes to update, not add (4c86bbd)
- [x] Broaden natural-language search across all contact fields + category aliases (ffd4680)
- [x] Clean up follow_up_note — stores "Marked for follow-up" not raw input (beeec3e)
- [x] Fix contacts capped at 1000 — paginate via range() to bypass Supabase max-rows (c95b42c)
- [x] Add combined query intent — synthesize research + contacts in one answer (b8aaa03)
- [x] Rewrite combined query as brain not library — opinion, non-obvious connection, next move (b83abc9)
- [x] Add nightly newsletter sync cron — 4 senders, dedup by gmail message ID, podcast multi-signal (83ac7ad)
- [x] Adopt full synthesis prompt — thesis, POV, implications, tensions, gaps, hot take (3e87c52)
- [x] Gmail env vars added to Vercel and redeployed (user action)
- [x] Bulk marked 16 contacts for follow-up via new bulk update flow
- [x] Added Don Cornwall, Rich Greenfield with phone numbers
- [x] Smoke tested combined query — returns opinionated synthesis with ranked contacts

### Session — 2026-04-09 (evening)
- [x] Fast DB-direct paths for structured queries (94d13d2)
- [x] City alias expansion (560d7cc)
- [x] Fix follow-up queries returning random contacts (9f0fcca)
- [x] Screenshot + follow-up caption (384a268)
- [x] Gmail MCP installed and first sync run — 49 contacts updated
- [x] /review pass — 7 bugs fixed (c8efc7e)
- [x] Edit button on search cards → /contacts?edit=<id>
- [x] /rank keyboard shortcuts

### Session — 2026-04-09 (earlier)
- [x] Screenshot creates contact when no match (06542da)
- [x] /rank page (81737cd)
- [x] Harden data model — constraints, indexes, trigram (9ab1324)
- [x] Extract shared libs to src/lib/
- [x] Pre-filter candidates before Claude
- [x] Enum validation at API boundary
- [x] Clarify response on ambiguous matches
- [x] Dedup contacts

### Prior sessions
- [x] PDF/document upload on Signal page
- [x] Location query bug fix
- [x] UX cleanup — Go button, examples, clear-on-type
- [x] Gmail sync endpoint + cortex-sync.md
- [x] Text/iMessage screenshot → update last_meaningful_contact
- [x] 3 Claude calls → 1
- [x] SSE streaming
- [x] Inline tappable star rating
- [x] Fix contacts truncating at 1000 (original attempt)
- [x] CSV import LinkedIn auto-detect
- [x] Signal page URL/YouTube/article ingestion
