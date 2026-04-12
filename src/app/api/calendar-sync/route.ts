import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getSupabase } from "@/lib/supabase";

// ── Config ────────────────────────────────────────────────────────────────────

// Only use meetings with this many attendees or fewer — everything larger
// is noise for tie inference (all-hands, webinars, conferences).
const MAX_ATTENDEES = 6;

// A contact with this many qualifying meetings in the window gets auto-upgraded
// to contact_quality = 3 (if currently null).
const STRONG_TIE_MEETING_COUNT = 5;

// Look-back window. Cron runs nightly; using 2 days with overlap so we never
// miss a day, and the POST endpoint is idempotent (date-only-forward semantics).
const LOOKBACK_DAYS = 2;

// First-run override: when triggered manually with ?full=1, sweep 1 year
const FULL_SWEEP_DAYS = 365;

// ── Calendar auth ────────────────────────────────────────────────────────────

function get_calendar_client() {
  const client_id     = process.env.GMAIL_CLIENT_ID;
  const client_secret = process.env.GMAIL_CLIENT_SECRET;
  // Separate refresh token so the Gmail newsletter sync is unaffected
  const refresh_token = process.env.GCAL_REFRESH_TOKEN;

  if (!client_id || !client_secret || !refresh_token) {
    throw new Error("Missing GCAL credentials. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GCAL_REFRESH_TOKEN.");
  }

  const auth = new google.auth.OAuth2(client_id, client_secret);
  auth.setCredentials({ refresh_token });
  return google.calendar({ version: "v3", auth });
}

// ── Types ────────────────────────────────────────────────────────────────────

interface AttendeeStats {
  email: string;
  name: string;
  latest_date: string;       // YYYY-MM-DD
  meeting_count: number;
}

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

function normalize_name(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production" && !process.env.CRON_SECRET) {
    console.warn("CRON_SECRET not set — calendar-sync is open. Set it in Vercel env vars.");
  }

  const url = new URL(request.url);
  const full_sweep = url.searchParams.get("full") === "1";
  const lookback_days = full_sweep ? FULL_SWEEP_DAYS : LOOKBACK_DAYS;

  let calendar;
  try {
    calendar = get_calendar_client();
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  const time_min = new Date(Date.now() - lookback_days * 24 * 60 * 60 * 1000).toISOString();
  const time_max = new Date().toISOString();

  // 1. List calendars the user has access to (primary + any shared)
  const cal_list = await calendar.calendarList.list();
  const calendars = cal_list.data.items ?? [];

  // 2. Walk every calendar, collect events in the window
  const stats_map = new Map<string, AttendeeStats>();
  let events_scanned = 0;
  let events_qualifying = 0;

  for (const cal of calendars) {
    if (!cal.id) continue;

    // Page through events
    let page_token: string | undefined;
    do {
      const res = await calendar.events.list({
        calendarId: cal.id,
        timeMin: time_min,
        timeMax: time_max,
        singleEvents: true,   // expand recurring events into instances
        showDeleted: false,
        maxResults: 2500,
        pageToken: page_token,
      });

      const events = res.data.items ?? [];
      events_scanned += events.length;

      for (const ev of events) {
        const attendees = ev.attendees ?? [];
        if (attendees.length === 0 || attendees.length > MAX_ATTENDEES) continue;

        // Need a date — some all-day events only have start.date
        const start_iso = ev.start?.dateTime ?? ev.start?.date;
        if (!start_iso) continue;
        const date_str = start_iso.split("T")[0];

        events_qualifying++;

        for (const att of attendees) {
          // Skip the user themselves and resources (rooms)
          if (att.self) continue;
          if (att.resource) continue;
          // Skip declined meetings — if they said no, it's not a real interaction
          if (att.responseStatus === "declined") continue;

          const email = (att.email ?? "").toLowerCase().trim();
          const name  = (att.displayName ?? "").trim();
          if (!email && !name) continue;

          const key = email || `name:${normalize_name(name)}`;
          const existing = stats_map.get(key);
          if (existing) {
            existing.meeting_count++;
            if (date_str > existing.latest_date) existing.latest_date = date_str;
            if (!existing.email && email) existing.email = email;
            if (!existing.name && name) existing.name = name;
          } else {
            stats_map.set(key, {
              email,
              name,
              latest_date: date_str,
              meeting_count: 1,
            });
          }
        }
      }

      page_token = res.data.nextPageToken ?? undefined;
    } while (page_token);
  }

  const attendees = Array.from(stats_map.values());

  // 3. Fetch Cortex contacts (paginate past the 1000 cap like /api/sync GET does)
  const supabase = getSupabase();
  const PAGE = 1000;
  let all_contacts: CortexContact[] = [];
  for (let page = 0; ; page++) {
    const { data: chunk, error } = await supabase
      .from("contacts")
      .select("id, name, email, phone, last_meaningful_contact")
      .order("name")
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!chunk || chunk.length === 0) break;
    all_contacts = all_contacts.concat(chunk as CortexContact[]);
    if (chunk.length < PAGE) break;
  }

  // 4. Match and build update payloads
  const by_email = new Map<string, CortexContact>();
  const by_name = new Map<string, CortexContact>();
  for (const c of all_contacts) {
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

  // 5. Apply updates directly (same logic as /api/sync POST: forward-only)
  let updated_count = 0;
  let skipped_count = 0;
  for (const update of updates) {
    const { data: current } = await supabase
      .from("contacts")
      .select("id, last_meaningful_contact, contact_quality")
      .eq("id", update.id)
      .single();
    if (!current) { skipped_count++; continue; }

    const patch: Record<string, string | number> = { updated_at: new Date().toISOString() };
    if (update.last_meaningful_contact && (!current.last_meaningful_contact || current.last_meaningful_contact < update.last_meaningful_contact)) {
      patch.last_meaningful_contact = update.last_meaningful_contact;
    }
    if (update.contact_quality && !current.contact_quality) {
      patch.contact_quality = update.contact_quality;
    }
    if (Object.keys(patch).length === 1) { skipped_count++; continue; }

    const { error } = await supabase.from("contacts").update(patch).eq("id", update.id);
    if (error) { skipped_count++; continue; }
    updated_count++;
  }

  // Top unmatched by meeting count — the strongest ties missing from Cortex
  const top_unmatched = [...unmatched]
    .sort((a, b) => b.meeting_count - a.meeting_count)
    .slice(0, 20)
    .map((u) => ({
      name: u.name || null,
      email: u.email || null,
      meetings: u.meeting_count,
      last: u.latest_date,
    }));

  return NextResponse.json({
    ok: true,
    window_days: lookback_days,
    full_sweep,
    calendars_scanned: calendars.length,
    events_scanned,
    events_qualifying,
    attendees_found: attendees.length,
    updated: updated_count,
    skipped: skipped_count,
    unmatched_count: unmatched.length,
    top_unmatched,
    run_at: new Date().toISOString(),
  });
}
