# todo.md — Roadmap

## Session State
- branch: claude/import-cortex-contacts-U7I4o
- last_test: PASS — `npm test` — 12/12 (2026-04-08)
- last_commit: 953dc68
- blocked: none
- pending_decisions:
    - Run ALTER TABLE SQL in Supabase for new contact fields (see action plan below)

## Active Tasks (resume here)
1) **YOU MUST DO THIS FIRST**: Run the ALTER TABLE SQL in Supabase (see action plan)
2) Import LinkedIn CSV — 2,000 contacts auto-detected + weighted as light/unreviewed
3) Start scoring contacts: set contact_quality=3 for your real relationships
4) Create `src/app/contacts/[id]/page.tsx` — contact detail page (API already ready)
5) Write smoke test for `/api/query` route

## Completed This Session
- [x] Claude OS sidecar installed
- [x] Claude model ID fixed → claude-sonnet-4-6
- [x] Edit / delete contacts with inline form
- [x] Vitest + 12 unit tests passing
- [x] Stats bar, clickable topic tags, preset query pills
- [x] Add contact form (collapsible), date picker, CSV export
- [x] GET-by-ID in /api/contacts
- [x] Natural language contact update (/api/update)
- [x] Smart CSV import — Claude maps any headers automatically
- [x] LinkedIn auto-detect — first_name+last_name merge, defaults to light/unreviewed
- [x] contact_quality (1-3 stars) — schema, types, UI, query weighting
- [x] follow_up + follow_up_note — badge, FU toggle button, filter tab
- [x] Update command parser understands follow-up language
- [x] Signal layer — /signal page + /api/signal route
- [x] YouTube transcript extraction
- [x] Article URL fetching via Readability + jsdom
- [x] Signal query — Claude ranks saved knowledge by relevance
- [x] All pushed to GitHub (commit 953dc68)

## Backlog
- Contact detail page `/contacts/[id]`
- Smoke test for /api/query
- Reconnect logic using date math on last_meaningful_contact
- Email forwarding for newsletters (Level 2 Signal ingestion)
- Cross-layer query: "I'm meeting Sarah — what have I saved relevant to her work?"
- Vercel deployment
