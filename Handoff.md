# Handoff — Cortex Morning Brain Dump Feature

## What we were building

A "morning brain dump" layer on top of Cortex. The core idea:

> The command bar should feel like dropping thoughts into your own brain, not filing records into a CRM. You type (or eventually speak, or paste a screenshot), and Cortex figures out who you mean, what happened, and appends it to that person's history — without you navigating to a contact page or filling out a form.

Two principles driving the design:
1. **Frictionless input** — text, voice, image all feed the same pipeline
2. **Structured data is output, not input** — you say "today Anamitra and I talked about the overtime board" and the system extracts person, topic, date, and stores it

This is what separates Cortex from LinkedIn (snapshot) and Salesforce (form-filling). It builds a longitudinal, evidence-based memory of your relationships.

---

## What was actually designed (spec)

Full product spec was discussed and agreed before coding started. Key elements:

- **Single command bar** — text, mic, camera, screenshot all feed one surface
- **Session chips** — each input fragment accumulates as a chip; the next input refines the same person lookup without starting over
- **Best match block** — one prominent result with a plain-language confidence explanation ("Matched by name, Afore, and a recent email mention")
- **Interaction log** — chronological history of every touchpoint per contact (logged manually, via email sync, or via screenshot)
- **Brain line** — one short model-generated sentence grounded in actual context ("You have not closed the loop here")
- **Contextual actions** — Log note, Draft reply, Edit — generated from evidence, not a fixed global menu
- **Brain dump mode** — paste "Anamitra, owe him follow-up, AI media, founder dinner, maybe email this week" and the system structures it

---

## What was built (code complete)

### 1. `src/lib/schema.sql`
Added the `interactions` table:
```sql
create table if not exists interactions (
  id uuid default gen_random_uuid() primary key,
  contact_id uuid not null references contacts(id) on delete cascade,
  date date not null default current_date,
  source text not null default 'manual', -- manual | email | voice | screenshot
  raw_content text not null,
  summary text,
  topics text[],
  created_at timestamptz default now()
);
```
With indexes on `contact_id`, `date desc`, and `topics` (gin).

**You still need to run this SQL in Supabase** — it has not been applied to the live database yet.

### 2. `src/lib/types.ts`
Added `Interaction` interface matching the table schema.

### 3. `src/app/api/interactions/route.ts` *(new file)*
- **GET** `?contact_id=xxx` — returns all interactions for a contact, newest first, limit 20
- **POST** `{ raw_content, contact_id, source? }` — Claude extracts summary/topics/date, inserts interaction row, bumps `last_meaningful_contact` on the contact if this date is more recent

### 4. `src/app/api/unified/route.ts`
Added `log_interaction` as a new intent:
- Added to `Intent` type and `VALID_INTENTS`
- Fast heuristic patterns in `fast_intent()` — matches "talked about X", "had coffee with X", "today I spoke with X", etc. — these run **before** the `update_contact` patterns they previously matched
- Updated `classify_intent()` Claude prompt to include `log_interaction` with disambiguation guidance vs `update_contact`
- New `handle_log_interaction(input, contact_id?)` handler:
  - Parses contact name, summary, topics, date from natural language
  - Finds/updates contact via `apply_contact_update` (handles clarify flow if multiple matches)
  - Inserts interaction row
  - Returns `{ type: "logged", interaction, contact, action }`
- Added to `INTENT_STATUS` and the main switch

---

## What was NOT built (interrupted mid-task)

### `src/app/page.tsx` — the morning UI
This is the most visible piece and was next in the queue when work stopped. It was not touched.

What needs to change in `page.tsx`:

1. **Import `useEffect` and `Interaction`** from `@/lib/types`

2. **Add `logged` to `ResultType`**:
   ```typescript
   | { type: "logged"; action: string; contact: Contact; interaction: Interaction }
   ```

3. **Session chips state**:
   ```typescript
   const [chips, setChips] = useState<string[]>([]);
   const [interactions, setInteractions] = useState<Interaction[]>([]);
   const [logNote, setLogNote] = useState("");
   const [logNoteContactId, setLogNoteContactId] = useState<string | null>(null);
   const [loggingNote, setLoggingNote] = useState(false);
   ```

4. **In `handleSubmit`**: when chips are active, prepend them as context:
   ```typescript
   const full_input = chips.length > 0
     ? `${chips.join("\n")}\n${input.trim()}`
     : input.trim();
   ```
   After result arrives: if result is `contacts`, push `input` onto `chips`. If result is something other than `contacts` or `logged`, clear chips.

5. **`useEffect` to fetch interactions** when a contact result is shown:
   ```typescript
   useEffect(() => {
     if (result?.type === "contacts" && result.results.length > 0) {
       fetch(`/api/interactions?contact_id=${result.results[0].id}`)
         .then(r => r.ok ? r.json() : [])
         .then(d => setInteractions(Array.isArray(d) ? d : []));
     } else if (result?.type === "logged") {
       fetch(`/api/interactions?contact_id=${result.contact.id}`)
         .then(r => r.ok ? r.json() : [])
         .then(d => setInteractions(Array.isArray(d) ? d : []));
     }
   }, [result]);
   ```

6. **Chip rendering** — below the textarea, before examples, with individual × buttons and a "New" button to clear session

7. **"Morning mode" contact display** — when `chips.length > 0` and result is `contacts`:
   - Show first result as **Best match** (large, prominent)
   - Show interaction log beneath it (from `interactions` state)
   - Show **Log note** inline form (calls `POST /api/interactions` directly)
   - Collapse secondary matches under "N other possible matches"
   - Normal list view when no chips (existing behavior unchanged)

8. **`logged` result display** — simple confirmation card: "✓ Logged · [summary] · [contact name]"

9. **`handleLogNote`** function — calls `POST /api/interactions`, appends to `interactions` state on success

---

## What's left after the UI

- **Run the SQL** in Supabase to create the interactions table (SQL is in `schema.sql`)
- **Tests** — `npm test` was not run after the backend changes
- **Commit and push** to `claude/code-review-feedback-b10vQ`
- **Voice input** — deferred. Web Speech API or Whisper. Same pipeline, different capture method.
- **Camera / OCR enrichment** — the existing screenshot handler updates `last_meaningful_contact` but does not create an interaction row. It should. The fix is one call to `POST /api/interactions` at the end of `handle_screenshot`.
- **Brain line** — the single model-generated sentence shown at the bottom of the best match block. Not yet designed or implemented.
- **External enrichment** — LinkedIn, Twitter, Google as artifact sources. Same extraction pipeline, different input source.
- **Email sync → interactions** — the Gmail sync currently updates `last_meaningful_contact`. Each synced email should also write an interaction row with `source: "email"`.

---

## Files changed (uncommitted)

```
M  src/app/api/unified/route.ts
M  src/lib/schema.sql
M  src/lib/types.ts
?? src/app/api/interactions/route.ts   (new, untracked)
```

`src/app/page.tsx` — untouched, work was interrupted before this step.

---

## One-line summary for next session

> Backend is done (interactions table, API route, log_interaction intent). Only `page.tsx` needs the morning UI: session chips, best match block, interaction log, quick log note form, and the `logged` result type display.
