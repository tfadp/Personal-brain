# lessons.md — What We Learned

## 2026-04-07

**L1 — Read before assuming something is missing**
We planned to add a nav bar and edit/delete. When I read the files first, the nav bar
was already in layout.tsx and the API already had PUT + DELETE. Reading first saved
building something twice. Rule: always read the file before proposing to add something to it.

**L2 — Don't use DOM tricks when you can extract logic**
First attempt at the preset query buttons used `setTimeout + form.requestSubmit()` — a
fragile DOM hack. The correct fix was to extract `runQuery(text)` as a standalone function
so the button could call it directly without touching the DOM.

**L3 — Claude model IDs go stale fast**
Use the major model alias (`claude-sonnet-4-6`) not a dated snapshot ID like `claude-sonnet-4-20250514`.

**L4 — Pure logic belongs in utils.ts, not inside route handlers**
Extracting to `src/lib/utils.ts` makes logic instantly testable with Vitest, no mocking required.

## 2026-04-08

**L5 — Claude sometimes wraps JSON in markdown code fences**
When parsing Claude responses, always strip ` ```json ... ``` ` fences before JSON.parse().
Pattern: `raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim()`
This appeared in import route, signal route, and update route — apply everywhere Claude returns JSON.

**L6 — Import button hidden = user confusion**
The original import button only appeared after file selection. Users couldn't find it.
Rule: always show action buttons (disabled state is fine) — never hide them conditionally.

**L7 — URL fetching needs a browser User-Agent**
Plain fetch() to article URLs often returns 403 or bot-block pages.
Must set User-Agent to a real browser string + Accept header to get readable HTML back.

**L8 — Schema migrations need explicit user action**
When we add new DB columns, the app breaks silently until the user runs ALTER TABLE in Supabase.
Always end a schema-change session with the exact SQL the user needs to run, prominently.
