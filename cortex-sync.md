# Cortex Gmail Sync

Sync your Gmail contact history to Cortex. Find everyone you've emailed
since the last sync and update their `last_meaningful_contact` date.

---

## Step 1 — Get last sync date

Read the file `~/.cortex-sync-state.json`.

- If the file exists, use the `last_run` value as your start date.
- If the file does not exist, use 30 days ago as the start date and tell
  me this is a first run.

---

## Step 2 — Get Cortex contacts

Make this HTTP request:

  GET https://personal-brain-two.vercel.app/api/sync

You'll get back a list of contacts with their names, email addresses, and
current `last_meaningful_contact` dates. Keep this in memory.

---

## Step 3 — Search Gmail

Search Gmail for all emails sent or received since the start date from Step 1.

For each email, collect:
- The other person's email address and display name
- The date of the email

Group by person — keep only the **most recent date** per person.

Exclude: no-reply addresses, newsletters, mailing lists, automated
notifications, and anyone whose email contains "noreply", "newsletter",
"notifications", "support", "hello@", "info@", or "donotreply".

---

## Step 4 — Match Gmail contacts to Cortex contacts

For each person found in Gmail:

1. Match by **email address** first (exact match, case-insensitive)
2. If no email match, try matching by **name** (fuzzy — "Jon" matches
   "Jonathan", last name alone counts)
3. Only include a match if the Gmail date is **more recent** than their
   current `last_meaningful_contact` in Cortex

Build a list of updates:
```
[{ "id": "<cortex contact id>", "last_meaningful_contact": "YYYY-MM-DD" }]
```

---

## Step 5 — Post updates to Cortex

Make this HTTP request:

  POST https://personal-brain-two.vercel.app/api/sync
  Content-Type: application/json

  { "updates": [ ...your list from Step 4... ] }

---

## Step 6 — Save state

Write the current timestamp to `~/.cortex-sync-state.json`:

  { "last_run": "<current ISO timestamp>" }

Create the file if it doesn't exist.

---

## Step 7 — Report

Tell me:
- How many contacts were updated, and list each one with old date → new date
- How many Gmail senders had no match in Cortex — list their names and
  emails so I can decide whether to add them
