# Cortex — Task Board

## Session State
- **Branch:** `youtube-qa` (worktree at `/Users/danporter/Desktop/Personal-brain-youtube-qa`, off main)
- **Last test result:** `npx tsc --noEmit` clean, `npm run lint` clean (only 2 pre-existing unused-fn warnings) — confirmed 2026-05-08
- **Deployed:** Not yet — feature branch, not merged to main, not on Vercel
- **Blockers:** None — streaming verified locally (user said "result is great")
- **Pending decisions:**
  - **Merge `youtube-qa` → `main`**: feature is working locally, ready to commit + merge + deploy.
  - YouTube transcript fallback (youtube-transcript pkg) likely won't work on Vercel data-center IPs. Supadata is primary; if Supadata fails in prod, transcript will be null and Q&A panel hides itself (intended behavior).
  - Google Calendar sync needs one-time auth: run `npm run auth:gcal`, add GCAL_REFRESH_TOKEN to Vercel, hit `/api/calendar-sync?full=1` for first sweep. Instructions in SETUP-SYNC.md.
  - iMessage import needs: (1) run schema SQL to add phone column, (2) grant Full Disk Access to terminal, (3) `npm run import:imessage`. Instructions in SETUP-SYNC.md.
  - Newsletter cron (7am UTC daily) is live — verify first overnight run produced signals.
  - `/rank` page: ~2000 unrated contacts. Rating improves combined query quality.

---

## Active Tasks (next up)

1. **Commit + merge `youtube-qa` → `main` + deploy** — uncommitted changes on the worktree (route.ts, page.tsx, enrich.ts, schema.sql, types.ts, package.json, package-lock.json, migrations/005, src/app/api/signals/[id]/ask/). Migration 005 is already applied in Supabase. After merge, push to main → Vercel deploys.
2. **Run Google Calendar auth** — `npm run auth:gcal`, add token to Vercel, redeploy, hit `?full=1`. See SETUP-SYNC.md.
3. **Run iMessage import** — Add phone column to Supabase, grant Full Disk Access, `npm run import:imessage --dry-run` first. See SETUP-SYNC.md.
4. **Verify newsletter cron** — Check Vercel logs or hit `/api/newsletter-sync` to confirm signals from 4 senders are landing.
5. **Spend time on /rank** — Rate contacts (1/2/3, S to skip). Populates contact_quality for better search ranking.
6. **Signal page nav link** — Add Signal to the nav bar (currently only reachable via `/signal`).
7. **Delete signal** — Add a delete button on saved signals.

---

## Completed ✅

### Session — 2026-05-08 (YouTube Q&A feature, Path A)
- [x] Migration 005: added `signals.transcript`, `signals.source_type`, `signal_questions` table (FK CASCADE, RLS off) — applied in Supabase
- [x] `src/lib/types.ts`: added transcript/source_type to Signal, added `SignalQuestion` interface
- [x] `src/lib/enrich.ts`: Supadata primary, `youtube-transcript` scraper fallback, returns transcript + source_type
- [x] `src/app/api/unified/route.ts`: rewrote `handle_ingest_signal` to take `send` callback and run TWO parallel Claude calls — streaming summary (markdown only, max_tokens 4000) + non-streaming metadata extractor — emitting `ingest_delta` events
- [x] Refactored `handle_add_contact` to also accept `send` (its fallback calls handle_ingest_signal)
- [x] `src/app/api/signals/[id]/ask/route.ts`: GET history + POST ask, transcript-grounded ("Not in the transcript." for off-topic)
- [x] `src/app/page.tsx`: `render_youtube_summary` helper for `# headline` + `## section` markdown, `YoutubeIngestCard` self-contained component, Q&A panel with auto-loaded history, transcript-null UI gate, error message gate
- [x] Streaming UI: `streaming_summary` state, SSE handler appends `ingest_delta` text, progressive card renders before final result
- [x] Reviewer pass + fix agent: 3 blockers + 4 importants resolved (source_url prompt injection, empty-answer guard, transcript-null UI gate, error key mismatch, max_tokens, magic-number constants, console.warn vs error)
- [x] User added SUPADATA_API_KEY to .env.local (.env.local symlinked from main repo into worktree)
- [x] Live tested end-to-end: paste URL → progressive summary → ask question → answer grounded in transcript ("result is great")

### Session — 2026-04-12
- [x] Replace hardcoded alias maps with Claude query expansion (ba84c1d)
  - "recruiting" now finds HR/talent people, "Brooklyn" finds NYC contacts, "deal flow" finds investors
  - Removed 223 lines of SEARCH_ALIASES, CITY_ALIASES, ROLE_TERMS, STRUCTURED_PATTERNS
  - One fast Claude call (~200ms) replaces all of them
- [x] Route role/industry queries through Claude semantic ranking (522de23)
  - Fixed "human resources" returning Human Rights Watch board members
  - Fixed "HR" returning nothing (2-char abbreviation was filtered out)
  - max_tokens 2048→4096 fixed silent truncation that caused empty results
- [x] Built Google Calendar cloud sync route — nightly cron at 7:15 UTC (af12660)
  - Separate GCAL_REFRESH_TOKEN, reuses same Google Cloud project
  - Filters to ≤6 attendee meetings, skips declined, auto-upgrades quality=3 for 5+ meetings
  - Auth helper script: `npm run auth:gcal`
- [x] Built iMessage importer — local script reads chat.db (0a4ce1f)
  - Matches by phone (E.164 normalized) or email
  - Auto-upgrades quality=3 for 100+ message threads
  - Added phone column to schema + Contact type
- [x] Extended /api/sync to paginate past 1000 cap, accept phone backfill + quality upgrade
- [x] Created SETUP-SYNC.md — step-by-step guide for all three sync sources (b506a68)

### Session — 2026-04-10/11
- [x] Fix follow-up never applied — clarify click applies by ID (dd06069)
- [x] Bulk contact add — paste a list (afe58b3)
- [x] Skip duplicate emails on bulk add (6c4a37b)
- [x] Bulk update — paste list with directive (55cc604)
- [x] Fix bulk add truncation — max_tokens + partial JSON recovery (8092539)
- [x] Fix bulk follow-up routing (4c86bbd)
- [x] Broaden search across all contact fields + category aliases (ffd4680)
- [x] Clean up follow_up_note (beeec3e)
- [x] Fix contacts capped at 1000 — paginate (c95b42c)
- [x] Add combined query — synthesize research + contacts (b8aaa03)
- [x] Rewrite combined query as brain not library (b83abc9)
- [x] Add nightly newsletter sync cron (83ac7ad)
- [x] Adopt full synthesis prompt — thesis, POV, tensions, gaps, hot take (3e87c52)
- [x] Bulk marked 16 contacts for follow-up
- [x] Added Don Cornwall, Rich Greenfield with phone numbers

### Session — 2026-04-09 (evening)
- [x] Fast DB-direct paths for structured queries (94d13d2)
- [x] City alias expansion (560d7cc)
- [x] Fix follow-up queries (9f0fcca)
- [x] Screenshot + follow-up caption (384a268)
- [x] Gmail MCP + first sync — 49 contacts updated
- [x] /review pass — 7 bugs fixed (c8efc7e)
- [x] Edit button on search cards, /rank keyboard shortcuts

### Prior sessions
- [x] All prior work (see git log for full history)
