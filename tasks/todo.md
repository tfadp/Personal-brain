# Cortex — Task Board

## Session State
- **Branch:** `main`
- **Last test result:** 12/12 Vitest pass, `npm run build` clean — confirmed 2026-04-09
- **Deployed:** Yes — personal-brain-two.vercel.app, all commits pushed and live
- **Blockers:** None
- **Pending decisions:**
  - City data inconsistency — contacts have city=LA vs city=Los Angeles. Run normalization SQL from `schema.sql` comments to fix.
  - `/rank` page: ~2000 unrated contacts. Spend time rating — `contact_quality` scores make search results significantly better.

---

## Active Tasks (next up)

1. **Run city normalization SQL** — Copy the UPDATE statements from bottom of `src/lib/schema.sql` into Supabase SQL editor and run. Fixes LA/NYC/SF/DC abbreviations so location queries return complete results.
2. **Spend time on /rank** — Rate contacts using keyboard shortcuts (1/2/3 to rate, S to skip). Gets contact_quality populated so search quality improves.
3. **Second Gmail account sync** — Run `npx @gongrzhe/server-gmail-autoauth-mcp auth`, sign in with juddporter@gmail.com, then run `claude` → `run the cortex sync using cortex-sync.md`.
4. **Signal page nav link** — Add Signal to the nav bar (currently only reachable by typing `/signal`).
5. **Delete signal** — Add a delete button on saved signals.

---

## Completed ✅

### Session — 2026-04-09 (evening)
- [x] Fast DB-direct paths for structured queries (city/role/topic) — no Claude round-trip (94d13d2)
- [x] Expand city aliases: "los angeles" matches city=LA and vice versa (560d7cc)
- [x] Fix follow-up queries returning random contacts — now queries follow_up=true directly (9f0fcca)
- [x] Fix follow-up intent enforced in code, not relying on Claude parse
- [x] Clear follow-up: "done/spoke/caught up" sets follow_up=false
- [x] Screenshot + "follow up" caption sets follow_up=true on created/updated contact (384a268)
- [x] Gmail MCP installed, authenticated, first sync run — 49 contacts updated (c37767c area)
- [x] Review pass — 7 bugs fixed (c8efc7e):
  - clarify response rendered in page.tsx
  - rate() in /rank checks res.ok before advancing queue
  - variable shadowing fixed in unified route
  - contact_quality ORDER BY nullsFirst: false
  - screenshot caps contacts at 500
  - topic stop-word list expanded
  - total_unrated shown in /rank progress counter
- [x] Edit button on search result cards → /contacts?edit=<id>
- [x] /contacts reads ?edit param, opens that contact's form on load
- [x] /rank keyboard shortcuts: 1/2/3 to rate, S or → to skip

### Session — 2026-04-09 (earlier)
- [x] Screenshot creates contact when no match found (06542da)
- [x] /rank page — bulk star flashcard UI for rating unrated contacts (81737cd)
- [x] Harden data model — schema constraints, partial unique indexes, perf indexes, trigram indexes (9ab1324)
- [x] Extract shared libs: `src/lib/enrich.ts`, `src/lib/contact_update.ts`
- [x] Pre-filter contacts in DB (≤100-200 candidates) before Claude
- [x] Validate enum fields at API boundary
- [x] Ambiguous matches return clarify response
- [x] Supabase migrations run — constraints + indexes active
- [x] Dedup contacts — kept most complete row per name

### Prior sessions
- [x] PDF/document upload on Signal page
- [x] Fixed location query bug
- [x] UX cleanup — main page Go button, example prompts, clear-on-type
- [x] Gmail sync endpoint + cortex-sync.md prompt file
- [x] Text/iMessage screenshot → update last_meaningful_contact
- [x] Performance: 3 Claude calls → 1
- [x] SSE streaming — live status updates
- [x] Inline tappable star rating on contact cards
- [x] Fix contacts truncating at 1000
- [x] CSV import LinkedIn auto-detect + smart column mapping
- [x] Signal page URL/YouTube/article ingestion
