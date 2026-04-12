/**
 * macOS Calendar importer for Cortex.
 *
 * Reads the macOS Calendar.app event database via AppleScript and updates
 * Cortex with the last_meaningful_contact date inferred from real meetings.
 *
 * Design choices:
 *   - Only counts events with ≤ MAX_ATTENDEES attendees. Large events
 *     (all-hands, webinars, conferences) are noise for tie inference.
 *   - Only uses events from the last LOOKBACK_DAYS days.
 *   - Matches attendees by email (primary) or display name (fallback).
 *   - Recurring 1:1 meetings trigger contact_quality=3 upgrade.
 *
 * Usage:
 *   npx tsx scripts/import-calendar.ts [--api-url https://...] [--dry-run] [--days 365]
 *
 * One-time setup:
 *   macOS will prompt for Calendar access on first run — approve it.
 *   If you decline, run: tccutil reset Calendar
 */

import { execFile } from "child_process";
import { promisify } from "util";

const exec_file = promisify(execFile);

// ── Config ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const API_URL = extract_flag("--api-url") ?? process.env.CORTEX_API_URL ?? "http://localhost:3000";
const LOOKBACK_DAYS = parseInt(extract_flag("--days") ?? "365", 10);

const MAX_ATTENDEES = 6;          // meetings larger than this are noise
const STRONG_TIE_MEETING_COUNT = 5; // 5+ meetings in window → quality 3

function extract_flag(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

// ── AppleScript ────────────────────────────────────────────────────────────

/**
 * AppleScript that walks every Calendar and emits TSV lines:
 *   <event start YYYY-MM-DD>\t<attendee email>\t<attendee name>
 *
 * One line per (event, attendee) pair. Events with more than MAX_ATTENDEES
 * attendees are skipped in AppleScript to avoid pulling huge all-hands data.
 */
const APPLE_SCRIPT = `
on run argv
  set lookback_days to (item 1 of argv) as integer
  set max_attendees to (item 2 of argv) as integer

  set cutoff_date to (current date) - (lookback_days * days)
  set output to ""

  tell application "Calendar"
    set all_calendars to every calendar
    repeat with cal in all_calendars
      try
        set events_in_range to (every event of cal whose start date ≥ cutoff_date)
        repeat with ev in events_in_range
          try
            set attendee_list to attendees of ev
            set attendee_count to count of attendee_list
            if attendee_count > 0 and attendee_count ≤ max_attendees then
              set ev_start to start date of ev
              set date_str to (year of ev_start as string) & "-" & text -2 thru -1 of ("0" & ((month of ev_start as integer) as string)) & "-" & text -2 thru -1 of ("0" & (day of ev_start as string))
              repeat with att in attendee_list
                try
                  set att_email to email of att
                  set att_name to display name of att
                  if att_email is missing value then set att_email to ""
                  if att_name is missing value then set att_name to ""
                  set output to output & date_str & tab & att_email & tab & att_name & linefeed
                end try
              end repeat
            end if
          end try
        end repeat
      end try
    end repeat
  end tell

  return output
end run
`.trim();

// ── Read Calendar via AppleScript ──────────────────────────────────────────

interface AttendanceRow {
  date: string;          // YYYY-MM-DD
  email: string;         // may be empty
  name: string;          // may be empty
}

async function read_calendar_events(): Promise<AttendanceRow[]> {
  try {
    const { stdout } = await exec_file(
      "osascript",
      ["-e", APPLE_SCRIPT, String(LOOKBACK_DAYS), String(MAX_ATTENDEES)],
      { maxBuffer: 50 * 1024 * 1024 }, // 50 MB — big calendars
    );
    const rows: AttendanceRow[] = [];
    for (const line of stdout.split("\n")) {
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const [date, email, name] = parts;
      if (!date || (!email && !name)) continue;
      rows.push({ date: date.trim(), email: email.trim().toLowerCase(), name: name.trim() });
    }
    return rows;
  } catch (err) {
    console.error("\n❌ AppleScript failed — Calendar access may be denied.\n");
    console.error("Fix: System Settings → Privacy & Security → Calendar");
    console.error("     Allow your terminal to access Calendar, then re-run.\n");
    console.error("Underlying error:", String(err));
    process.exit(1);
  }
}

// ── Cortex API ─────────────────────────────────────────────────────────────

interface CortexContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  last_meaningful_contact: string | null;
}

interface UpdatePayload {
  id: string;
  last_meaningful_contact?: string;
  contact_quality?: number;
}

async function fetch_contacts(): Promise<CortexContact[]> {
  const res = await fetch(`${API_URL}/api/sync`);
  if (!res.ok) throw new Error(`GET /api/sync failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return body.contacts as CortexContact[];
}

async function post_updates(updates: UpdatePayload[]) {
  const res = await fetch(`${API_URL}/api/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  });
  if (!res.ok) throw new Error(`POST /api/sync failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Matching ───────────────────────────────────────────────────────────────

function normalize_name(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

// ── Main ───────────────────────────────────────────────────────────────────

interface AttendeeStats {
  email: string;
  name: string;
  latest_date: string;
  meeting_count: number;
}

async function main() {
  console.log("\n📅 Cortex Calendar Import\n");
  console.log(`Source:   macOS Calendar (last ${LOOKBACK_DAYS} days, ≤${MAX_ATTENDEES} attendees)`);
  console.log(`Target:   ${API_URL}${DRY_RUN ? "  (dry run)" : ""}`);
  console.log();

  console.log("Reading Calendar via AppleScript (this can take 30-60s)...");
  const rows = await read_calendar_events();
  console.log(`Found ${rows.length} attendee rows across qualifying events.\n`);

  // Aggregate per attendee — keyed by email when available, else normalized name
  const stats_map = new Map<string, AttendeeStats>();
  for (const r of rows) {
    const key = r.email || `name:${normalize_name(r.name)}`;
    if (!key || key === "name:") continue;
    const existing = stats_map.get(key);
    if (existing) {
      existing.meeting_count++;
      if (r.date > existing.latest_date) existing.latest_date = r.date;
      if (!existing.email && r.email) existing.email = r.email;
      if (!existing.name && r.name) existing.name = r.name;
    } else {
      stats_map.set(key, {
        email: r.email,
        name: r.name,
        latest_date: r.date,
        meeting_count: 1,
      });
    }
  }
  const attendees = Array.from(stats_map.values());
  console.log(`Unique attendees: ${attendees.length}\n`);

  const contacts = await fetch_contacts();
  console.log(`Cortex has ${contacts.length} contacts.\n`);

  // Build lookup by email and normalized name
  const by_email = new Map<string, CortexContact>();
  const by_name = new Map<string, CortexContact>();
  for (const c of contacts) {
    if (c.email) by_email.set(c.email.toLowerCase(), c);
    if (c.name) by_name.set(normalize_name(c.name), c);
  }

  const updates: UpdatePayload[] = [];
  const unmatched: AttendeeStats[] = [];

  for (const a of attendees) {
    let contact: CortexContact | undefined;
    if (a.email) contact = by_email.get(a.email);
    if (!contact && a.name) contact = by_name.get(normalize_name(a.name));

    if (!contact) {
      unmatched.push(a);
      continue;
    }

    const patch: UpdatePayload = { id: contact.id, last_meaningful_contact: a.latest_date };
    if (a.meeting_count >= STRONG_TIE_MEETING_COUNT) {
      patch.contact_quality = 3;
    }
    updates.push(patch);
  }

  console.log(`Matched:   ${updates.length}`);
  console.log(`Unmatched: ${unmatched.length}`);
  console.log();

  if (unmatched.length > 0) {
    const top = [...unmatched].sort((a, b) => b.meeting_count - a.meeting_count).slice(0, 10);
    console.log("Top unmatched attendees (may be worth adding to Cortex):");
    for (const u of top) {
      const display = (u.name || u.email || "(unknown)").padEnd(30);
      console.log(`  ${display}  ${u.meeting_count.toString().padStart(3)} meetings  last: ${u.latest_date}`);
    }
    console.log();
  }

  if (DRY_RUN) {
    console.log("Dry run — no updates posted.");
    console.log(`Would have posted ${updates.length} updates.`);
    return;
  }

  console.log(`Posting ${updates.length} updates...`);
  let total_updated = 0;
  let total_skipped = 0;
  for (let i = 0; i < updates.length; i += 100) {
    const batch = updates.slice(i, i + 100);
    const result = await post_updates(batch);
    total_updated += result.updated?.length ?? 0;
    total_skipped += result.skipped?.length ?? 0;
  }

  console.log(`\n✅ Updated: ${total_updated}`);
  console.log(`   Skipped: ${total_skipped} (already up to date)\n`);
}

main().catch((err) => {
  console.error("\n❌ Import failed:", err);
  process.exit(1);
});
