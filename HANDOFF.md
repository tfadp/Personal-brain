# Cortex — Handoff

**Date:** April 9, 2026  
**Live app:** personal-brain-two.vercel.app  
**Repo:** github.com/tfadp/Personal-brain  
**Branch:** `main` (all changes are here, Vercel deploys from this)  
**Note:** `main` didn't exist at the start of this session — work was done on `claude/check-last-github-push-p7kPw` and then `main` was created from it. The other open branch `claude/import-cortex-contacts-U7I4o` is stale and can be deleted.

---

## What we built this session

### 1. PDF and document upload (Signal page)
- "Attach file" button on the Signal page accepts PDF, .txt, .md (max 4 MB)
- PDFs go straight to Claude as native document blocks — no parsing library needed
- Text files decoded and processed like pasted text
- Optional context field to annotate the upload before saving
- **Files:** `src/app/signal/page.tsx`, `src/app/api/signal/route.ts`

### 2. Fixed location query bug
- "Who do I know in London" was returning contacts from Berlin and Doha
- Two bugs: (1) a fallback that added all contacts when <5 matched a city, (2) the ranker had no awareness of location filters
- Fix: fallback now skipped when a location filter is active; filters passed explicitly to ranking prompt
- **File:** `src/app/api/unified/route.ts`

### 3. UX cleanup — main page
- Go button moved to its own right-aligned row below the textarea
- Example prompts moved below as a clean vertical list with a "Try" label
- Examples hide once results are showing
- Input and results clear after each search; results also clear when you start typing
- **File:** `src/app/page.tsx`

### 4. Gmail sync
- New endpoint `GET/POST /api/sync` — Claude calls this to fetch contacts for matching and to post back updates
- `POST /api/sync` only updates `last_meaningful_contact` if the new date is more recent than the current one
- `cortex-sync.md` in the repo root — prompt file for Claude Code + Gmail MCP
- First run looks back 1 year; every run after only looks since `~/.cortex-sync-state.json` last recorded
- **To use:** `claude -p cortex-sync.md` (requires Gmail MCP setup — see below)
- **Files:** `src/app/api/sync/route.ts`, `cortex-sync.md`

### 5. Text/iMessage screenshot upload (main page)
- "Screenshot" button on the main page accepts any image (PNG, JPG, WebP; iOS HEIC auto-converts)
- Claude reads the screenshot, identifies the contact name and most recent message date
- Updates that contact's `last_meaningful_contact` automatically
- If the contact isn't in Cortex yet, returns a friendly error asking you to add them first
- **Files:** `src/app/page.tsx`, `src/app/api/unified/route.ts`

### 6. Performance — 3 Claude calls → 1
- Added `fast_intent()` heuristic: common patterns (URLs, "who do I know in...", "what have I saved...") are classified instantly without a Claude round-trip
- Contact queries: collapsed the separate filter-extraction call + ranking call into a single Claude call
- Result: most queries went from 3 sequential Claude calls (~10–15s) to 1 (~3–5s)
- **File:** `src/app/api/unified/route.ts`

### 7. SSE streaming
- Unified API now streams Server-Sent Events instead of waiting and returning JSON
- User sees "Thinking..." → "Searching your contacts..." → results, all within 1 second of hitting Go
- Frontend reads the stream progressively and updates status as events arrive
- **Files:** `src/app/api/unified/route.ts`, `src/app/page.tsx`

---

## What's not done yet

### Gmail MCP setup (ready to run, not yet configured)
Everything is built — the sync endpoint and prompt file exist. What's missing is the one-time MCP config:

1. Install a Gmail MCP server. Recommended: `@gptscript-ai/gmail` or `@modelcontextprotocol/server-gmail`
2. Add it to Claude Code's MCP config (`~/.claude/claude_desktop_config.json` or equivalent)
3. Authenticate with your Google account
4. Run `claude -p cortex-sync.md` for the first sync (goes back 1 year)
5. After that, run it whenever you want — or schedule with cron

### Small gaps in the app
- **Signal page not in nav** — you have to know `/signal` exists; should add a nav link
- **No way to delete a signal** — once saved, can't remove it from the UI
- **No contact detail view** — contacts appear in query results but there's no tap-in page to see/edit everything about one person

### Cold starts on Vercel
- First request after a period of inactivity takes an extra 2–3s (serverless function waking up)
- Not a blocker, just noticeable. Vercel Pro keeps functions warm. Deliberately not adding a cron ping.

---

## Key files to know

| File | What it does |
|------|-------------|
| `src/app/page.tsx` | Main unified interface — ask, save, update, screenshot |
| `src/app/api/unified/route.ts` | Intent routing + all handlers, SSE streaming |
| `src/app/signal/page.tsx` | Signal page — paste/upload anything to your brain |
| `src/app/api/signal/route.ts` | Signal ingest (text, URL, PDF, file) |
| `src/app/api/sync/route.ts` | Gmail sync endpoint (GET contacts, POST updates) |
| `src/app/api/contacts/route.ts` | Contacts CRUD |
| `cortex-sync.md` | Prompt file — run with `claude -p cortex-sync.md` |
| `src/lib/types.ts` | Contact + Signal TypeScript interfaces |
| `src/lib/schema.sql` | Postgres table definitions |

## Environment variables needed
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
ANTHROPIC_API_KEY
SUPADATA_API_KEY   # for YouTube transcripts
```
