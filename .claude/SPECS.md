# SPECS.md — Source of Truth (Contracts + Decisions)

## A) Naming Conventions (LOCKED)
- Variables: snake_case (project convention — matches global CLAUDE.md)
- Functions: snake_case
- Classes / Interfaces: PascalCase
- Files: lowercase-with-dashes (e.g. `route.ts`, `supabase.ts`)
- Folders: lowercase
- Database columns: snake_case (Postgres convention)
RULE: Do not change unless you follow Change Control in CLAUDE.md.

## B) Data Shapes / Schemas (LOCKED)

### contacts table (Supabase / Postgres)
| column                  | type        | nullable | notes                        |
|-------------------------|-------------|----------|------------------------------|
| id                      | uuid        | NO       | gen_random_uuid() primary key|
| name                    | text        | NO       |                              |
| company                 | text        | YES      |                              |
| role                    | text        | YES      |                              |
| city                    | text        | YES      |                              |
| country                 | text        | YES      |                              |
| relationship_strength   | text        | YES      | "strong" / "medium" / "light"|
| how_you_know_them       | text        | YES      |                              |
| topics                  | text[]      | YES      | array of tags                |
| last_meaningful_contact | text        | YES      | ISO date string (YYYY-MM-DD) |
| notes                   | text        | YES      |                              |
| email                   | text        | YES      |                              |
| linkedin_url            | text        | YES      |                              |
| contact_quality         | integer     | YES      | 1=noise, 2=weak tie, 3=real  |
| follow_up               | boolean     | YES      | default false                |
| follow_up_note          | text        | YES      | context for follow-up        |
| created_at              | timestamp   | YES      | default now()                |
| updated_at              | timestamp   | YES      | default now()                |

### Contact TypeScript interface (src/lib/types.ts)
Mirrors the table above. All nullable columns typed `string | null`.
`topics` typed `string[] | null`.

RULE: Any schema change requires before/after + impact + tests.

## C) Invariants (LOCKED)
- `relationship_strength` must be one of: "strong", "medium", "light", or null.
- `id` is always a UUID string.
- `topics` is always an array of trimmed, non-empty strings (or null).
- CSV import normalizes headers to snake_case before mapping to schema.
RULE: Add invariants early and treat them like law.

## D) Domain Rules (LOCKED)
- No authentication. This is a personal, local-use app.
- Every natural language query runs a two-step Claude call:
    1. Extract structured filters (city, country, topics, relationship_strength, intent)
    2. Rank candidates by relevance, returning up to 10 results with a `relevance` explanation.
- If fewer than 5 candidates match DB filters, fall back to all contacts for ranking.
- Results always surface: name, role, company, city, strength, topics, last contact, notes, relevance.
RULE: Treat like invariants. Do not change without Change Control.

## E) Decisions Log (editable)
- 2026-04-07: Project initialized; Claude OS sidecar installed.
- 2026-04-07: Stack confirmed — Next.js 16, Supabase, Anthropic SDK, Tailwind, Vercel.
- 2026-04-07: File naming convention confirmed as lowercase-with-dashes.
- 2026-04-07: Vitest added for unit tests (`npm test`). Pure logic lives in src/lib/utils.ts.
- 2026-04-07: Claude model ID updated to claude-sonnet-4-6 (was claude-sonnet-4-20250514).
- 2026-04-07: last_meaningful_contact input changed to date picker (ISO YYYY-MM-DD format).
- 2026-04-07: GET /api/contacts now accepts ?id= param to return a single contact.
- 2026-04-08: Signal layer added — signals table, /api/signal, /signal page.
- 2026-04-08: contact_quality (int 1-3), follow_up (bool), follow_up_note (text) added to contacts.
- 2026-04-08: LinkedIn import auto-detected by first_name+last_name+connected_on headers.
- 2026-04-08: youtube-transcript + @mozilla/readability added for URL content extraction.
