# Cortex — Sync Setup Guide

Three automated sync sources keep Cortex up to date without manual work.

---

## 1. Newsletter Sync (already running)

**What it does:** Reads newsletters from Gmail every morning at 7am UTC, extracts insights, saves them as signals.

**Status:** Live. Configured senders:
- `afterschool@substack.com` (After School)
- `list@ben-evans.com` (Ben Evans)
- `hi@www.garbageday.email` (Garbage Day)
- `portfolio@juddporter.com` (podcast summaries only — ignores Eagles/stocks)

**To add a new newsletter:** Paste the sender email in a Claude Code session. The `SENDERS` array in `src/app/api/newsletter-sync/route.ts` gets updated and pushed.

**Env vars (already set in Vercel):**
```
GMAIL_CLIENT_ID
GMAIL_CLIENT_SECRET
GMAIL_REFRESH_TOKEN
```

**Manual trigger:** `https://personal-brain-two.vercel.app/api/newsletter-sync`

---

## 2. Google Calendar Sync

**What it does:** Reads your Google Calendar nightly at 7:15am UTC. Updates `last_meaningful_contact` for anyone you've had a real meeting with (≤6 attendees, skips all-hands). Auto-upgrades `contact_quality` to 3 for people you've had 5+ meetings with.

### Setup (one-time, ~3 minutes)

**Step 1 — Enable the Google Calendar API**

1. Go to https://console.cloud.google.com/apis/library/calendar-json.googleapis.com
2. Make sure the project selector shows your **Cortex** project (same one Gmail uses)
3. Click **Enable**

**Step 2 — Get the Calendar refresh token**

```bash
npm run auth:gcal
```

- Opens a URL → open it in your browser
- Pick the Google account whose calendar you want to sync
- Approve "Access your calendars (read-only)"
- Redirects to localhost — the script prints a `GCAL_REFRESH_TOKEN=...` line
- Copy that value

**Step 3 — Add the env var to Vercel**

1. vercel.com → personal-brain-two → Settings → Environment Variables
2. Add `GCAL_REFRESH_TOKEN` with the value from Step 2
3. Redeploy (Vercel needs a deploy to pick up new env vars + cron config)

**Step 4 — First-run sweep (365 days)**

After redeploy, open this URL once in your browser:

```
https://personal-brain-two.vercel.app/api/calendar-sync?full=1
```

This sweeps the last year of meetings. May take 30-60 seconds. Returns JSON showing how many contacts were updated and the top 20 unmatched attendees (people you meet with who aren't in Cortex yet — worth adding).

After this, the nightly cron handles everything automatically (2-day window, runs in seconds).

---

## 3. iMessage Import (manual, Mac only)

**What it does:** Reads `~/Library/Messages/chat.db` on your Mac. Updates `last_meaningful_contact` for anyone you text. Auto-upgrades `contact_quality` to 3 for people you've exchanged 100+ messages with.

**Requires:** Mac with iMessage signed in and syncing.

### Setup (one-time)

**Step 1 — Add the phone column to Supabase**

Run this in the Supabase SQL editor:

```sql
ALTER TABLE contacts ADD COLUMN phone TEXT;
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts (phone) WHERE phone IS NOT NULL;
```

**Step 2 — Grant Full Disk Access**

1. System Settings → Privacy & Security → Full Disk Access
2. Click **+** and add your terminal app (Terminal, iTerm2, VS Code, etc.)
3. **Quit and reopen your terminal** — the permission only takes effect on restart

**Step 3 — Enable SMS forwarding (optional but recommended)**

On your iPhone: Settings → Messages → Text Message Forwarding → toggle your Mac on. This makes green-bubble (SMS) texts show up in chat.db too, not just blue-bubble iMessages.

### Running it

Dry run first (shows what it would do without changing anything):

```bash
npm run import:imessage -- --dry-run
```

For real:

```bash
npm run import:imessage
```

Against production instead of localhost:

```bash
npm run import:imessage -- --api-url https://personal-brain-two.vercel.app
```

Safe to re-run anytime — dates only move forward, phone only backfills when null, quality only upgrades.

**Pay attention to the "Top unmatched handles" output** — these are the people you text the most who aren't in Cortex. Worth adding them.

---

## Safety guarantees (all three sources)

- **Dates only move forward** — a newer date wins, an older one is ignored
- **Phone/quality only backfill nulls** — never overwrites data you entered manually
- **Quality only upgrades, never downgrades** — if you rated someone 2, the importer won't change it
- **All three are idempotent** — safe to run as many times as you want
