# exceptions.md — Proactive Catches

## Format
- [DATE] | [FILE] | [WHAT WAS CAUGHT] | [RESOLUTION]

## Log
- 2026-04-07 | src/app/page.tsx | Used setTimeout + DOM requestSubmit() to trigger form from preset button — fragile pattern | Extracted runQuery(text) function so button calls it directly, no DOM needed
- 2026-04-07 | src/app/api/query/route.ts | Hardcoded snapshot model ID claude-sonnet-4-20250514 would become stale | Updated to alias claude-sonnet-4-6
