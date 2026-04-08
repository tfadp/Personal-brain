# todo.md — Roadmap

## Session State
- branch: claude/import-cortex-contacts-U7I4o
- last_test: PASS — `npm test` — 12/12 (2026-04-07)
- blocked: none — all changes uncommitted, nothing pushed yet
- pending_decisions: none

## Active Tasks (resume here)
1) Create `src/app/contacts/[id]/page.tsx` — contact detail page (GET-by-ID already in API)
2) Write smoke test for `/api/query` route (mock Claude + Supabase, assert response shape)
3) Commit everything and push to GitHub

## Completed This Session
- [x] Claude OS sidecar installed (.claude/ folder, SPECS.md, todos, lessons, exceptions)
- [x] Claude model ID fixed: claude-sonnet-4-20250514 → claude-sonnet-4-6
- [x] Nav bar confirmed already present in layout.tsx
- [x] Edit contact — inline expand form on contacts page
- [x] Delete contact — confirm() dialog + DELETE API call
- [x] Vitest installed, 12 unit tests written and passing (utils.ts)
- [x] Stats bar — count, strong, cities, top topics above contacts list
- [x] Clickable topic tags — clicking a tag filters the contacts list
- [x] Preset query pills on query page — 3 one-click queries
- [x] Add contact form — collapsible form at top of contacts page
- [x] Date picker for last contact — both add and edit forms
- [x] CSV export — client-side download button
- [x] GET-by-ID added to /api/contacts route

## Backlog
- Add contact detail page `/contacts/[id]` (C1 — partially done, API ready)
- Smoke test for /api/query (C2)
- Add "reconnect" logic that uses actual date math on last_meaningful_contact
