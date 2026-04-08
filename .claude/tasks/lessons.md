# lessons.md — What We Learned

## 2026-04-07

**L1 — Read before assuming something is missing**
We planned to add a nav bar and edit/delete. When I read the files first, the nav bar
was already in layout.tsx and the API already had PUT + DELETE. Reading first saved
building something twice. Rule: always read the file before proposing to add something to it.

**L2 — Don't use DOM tricks when you can extract logic**
First attempt at the preset query buttons used `setTimeout + form.requestSubmit()` — a
fragile DOM hack. The correct fix was to extract `runQuery(text)` as a standalone function
so the button could call it directly without touching the DOM. Rule: if you need to
trigger a form submission programmatically, extract the handler logic instead.

**L3 — Claude model IDs go stale fast**
The project had `claude-sonnet-4-20250514` hardcoded. That ID became outdated.
Use the major model alias (`claude-sonnet-4-6`) so it stays current without changes.

**L4 — Pure logic belongs in utils.ts, not inside route handlers**
CSV topic parsing, filter JSON fallback, and strength validation were all embedded in
route handlers — untestable. Extracting them to `src/lib/utils.ts` made all three
instantly testable with Vitest, no mocking required.
