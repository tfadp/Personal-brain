# Cortex — Task Board

## Session State
- **Branch:** `main`
- **Last test result:** 12/12 Vitest pass, `npm run build` clean — confirmed 2026-04-12
- **Deployed:** Yes — personal-brain-two.vercel.app, all commits pushed and live
- **Blockers:** None
- **Pending decisions:**
  - Google Calendar sync needs one-time auth: run `npm run auth:gcal`, add GCAL_REFRESH_TOKEN to Vercel, hit `/api/calendar-sync?full=1` for first sweep. Instructions in SETUP-SYNC.md.
  - iMessage import needs: (1) run schema SQL to add phone column, (2) grant Full Disk Access to terminal, (3) `npm run import:imessage`. Instructions in SETUP-SYNC.md.
  - Newsletter cron (7am UTC daily) is live — verify first overnight run produced signals.
  - `/rank` page: ~2000 unrated contacts. Rating improves combined query quality.

---

## Active Tasks (next up)

1. **Run Google Calendar auth** — `npm run auth:gcal`, add token to Vercel, redeploy, hit `?full=1`. See SETUP-SYNC.md.
2. **Run iMessage import** — Add phone column to Supabase, grant Full Disk Access, `npm run import:imessage --dry-run` first. See SETUP-SYNC.md.
3. **Verify newsletter cron** — Check Vercel logs or hit `/api/newsletter-sync` to confirm signals from 4 senders are landing.
4. **Spend time on /rank** — Rate contacts (1/2/3, S to skip). Populates contact_quality for better search ranking.
5. **Signal page nav link** — Add Signal to the nav bar (currently only reachable via `/signal`).
6. **Delete signal** — Add a delete button on saved signals.

---

## Completed ✅

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
