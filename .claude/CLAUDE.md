# Cortex Contacts
Personal contact intelligence app — store your network as structured data and query it in natural language.

## Tech Stack
- Next.js 16 (App Router) — frontend + API routes
- Supabase — Postgres database
- Anthropic Claude API — natural language query ranking
- Tailwind CSS — styling
- Vercel — hosting

## Commands
npm run dev        # start local dev server (http://localhost:3000)
npm run build      # production build
npm run lint       # run ESLint
npm test           # run Vitest unit tests (must pass before declaring done)

## Key Files
src/app/page.tsx                 — query interface (natural language search)
src/app/contacts/page.tsx        — browse/filter/add/edit/delete/export contacts
src/app/import/page.tsx          — CSV upload UI
src/app/api/query/route.ts       — two-step: Claude extracts filters → ranks results
src/app/api/import/route.ts      — CSV parser → Supabase insert
src/app/api/contacts/route.ts    — CRUD + GET-by-ID for contacts
src/lib/supabase.ts              — Supabase client singleton
src/lib/types.ts                 — Contact interface
src/lib/utils.ts                 — pure helpers (parse_topics, parse_filters, is_valid_strength)
src/lib/utils.test.ts            — Vitest unit tests for utils
src/lib/schema.sql               — Postgres table definition
env.example                      — required environment variables

## Project Rules
- Check .claude/SPECS.md ONLY when modifying naming, schemas, or contracts.
  Do NOT load SPECS.md at session start.
- No authentication — this is personal, local use only.
- Every query goes through Claude for ranking (not raw SQL filtering alone).
- Results always show: name, role, company, city, strength, topics, last contact, notes.
- READ the file before proposing to add something to it — it may already exist.
- Extract testable logic to src/lib/utils.ts rather than embedding in route handlers.
- Use model alias `claude-sonnet-4-6` not a dated snapshot ID.
