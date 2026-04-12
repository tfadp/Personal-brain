# Cortex
Personal brain — contact intelligence + knowledge signal layer.

## Tech Stack
- Next.js 16 (App Router) — frontend + API routes
- Supabase — Postgres database
- Anthropic Claude API — query ranking + knowledge extraction
- Tailwind CSS — styling
- Vercel — hosting
- Vitest — unit tests
- youtube-transcript — YouTube caption extraction
- @mozilla/readability + jsdom — article text extraction

## Commands
npm run dev        # start local dev server (http://localhost:3000)
npm run build      # production build
npm run lint       # run ESLint
npm test           # run Vitest unit tests (must pass before declaring done)

## Key Files
src/app/page.tsx                 — unified query interface (SSE streaming)
src/app/signal/page.tsx          — paste anything, Claude digests it
src/app/contacts/page.tsx        — browse/filter/add/edit/delete/export contacts
src/app/rank/page.tsx            — flashcard bulk star-rating UI for unrated contacts
src/app/import/page.tsx          — CSV upload UI (smart column mapping)
src/app/api/unified/route.ts     — single SSE route: intent → contacts/signals/ingest/update/add
src/app/api/signal/route.ts      — POST ingest + GET query for Signal layer
src/app/api/update/route.ts      — natural language contact update parser
src/app/api/import/route.ts      — Claude-mapped CSV import + LinkedIn auto-detect
src/app/api/contacts/route.ts    — CRUD + GET-by-ID for contacts
src/app/api/sync/route.ts        — Gmail sync: GET contacts list, POST bulk date updates
src/lib/supabase.ts              — Supabase client singleton
src/lib/types.ts                 — Contact + Signal interfaces
src/lib/enrich.ts                — canonical URL enrichment (Jina + Supadata)
src/lib/contact_update.ts        — canonical contact find/merge/apply with clarify support
src/lib/utils.ts                 — pure helpers (parse_topics, parse_filters, is_valid_strength)
src/lib/utils.test.ts            — Vitest unit tests for utils
src/lib/schema.sql               — Postgres table definitions + all indexes
cortex-sync.md                   — prompt file for Gmail MCP sync (`claude -p cortex-sync.md`)
env.example                      — required environment variables

## Project Rules
- Check .claude/SPECS.md ONLY when modifying naming, schemas, or contracts.
  Do NOT load SPECS.md at session start.
- No authentication — this is personal, local use only.
- All contact searches use Claude query expansion first (expand_query): "recruiting" → HR, talent, staffing; "Brooklyn" → NYC. No hardcoded alias maps.
- Role/industry queries always go through Claude semantic ranking. Pure location queries can use direct DB results.
- Pre-filter to ≤250 candidates in Postgres before any Claude ranking call.
- Results always show: name, role, company, city, strength, topics, last contact, notes.
- READ the file before proposing to add something to it — it may already exist.
- Extract shared business logic to src/lib/ — never duplicate across route handlers.
- Use model alias `claude-sonnet-4-6` not a dated snapshot ID.
- Always strip Claude JSON responses of markdown fences before JSON.parse().
- When adding DB columns: always end session with the exact ALTER TABLE SQL the user must run.
- Never hide action buttons — show them disabled rather than hidden.
- For follow_up and contact_quality mutations: enforce the value in code after LLM parse — never trust the LLM alone.
- Every fetch() that mutates data must check res.ok before updating UI state.
- ORDER BY contact_quality DESC always needs nullsFirst: false — nulls must sort last.
