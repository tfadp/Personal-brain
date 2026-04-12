/**
 * iMessage importer for Cortex.
 *
 * Reads ~/Library/Messages/chat.db (local SQLite) and updates Cortex with:
 *   - last_meaningful_contact (moves forward only, never backward)
 *   - phone backfill when a contact matches by email but we now know their number
 *   - contact_quality = 3 for high-frequency handles currently unrated
 *
 * Usage:
 *   npx tsx scripts/import-imessage.ts [--api-url https://...] [--dry-run]
 *
 * One-time setup:
 *   Grant Full Disk Access to your terminal in
 *   System Settings → Privacy & Security → Full Disk Access.
 *   Otherwise macOS will refuse to open chat.db.
 */

import Database from "better-sqlite3";
import { homedir } from "os";
import { existsSync } from "fs";
import { join } from "path";

// ── Config ──────────────────────────────────────────────────────────────────

const CHAT_DB_PATH = join(homedir(), "Library/Messages/chat.db");

// Flags
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const API_URL = extract_flag("--api-url") ?? process.env.CORTEX_API_URL ?? "http://localhost:3000";

// Quality thresholds
const STRONG_TIE_MSG_COUNT = 100;  // 100+ messages → contact_quality 3
const MIN_MSG_COUNT = 3;           // fewer than this = not worth importing

function extract_flag(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

// ── Phone normalization ────────────────────────────────────────────────────

/**
 * Normalize a phone number or email to a matching key.
 * Phones → E.164-ish: strip non-digits, prepend +1 if US 10-digit, else +<digits>.
 * Emails → lowercased unchanged.
 */
function normalize_handle(handle: string): string {
  const h = handle.trim().toLowerCase();
  if (h.includes("@")) return h;
  // Phone path
  const digits = h.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 10) return `+${digits}`;
  return h; // too short to be useful
}

function is_email(handle: string): boolean {
  return handle.includes("@");
}

// ── Mac Absolute Time → ISO date ───────────────────────────────────────────

// iMessage dates are nanoseconds since 2001-01-01 UTC (Mac Absolute Time)
const MAC_EPOCH_OFFSET = 978307200; // seconds from Unix epoch to 2001-01-01 UTC

function mac_date_to_iso(mac_date: number): string {
  const unix_seconds = mac_date / 1_000_000_000 + MAC_EPOCH_OFFSET;
  return new Date(unix_seconds * 1000).toISOString().split("T")[0]; // YYYY-MM-DD
}

// ── Read chat.db ───────────────────────────────────────────────────────────

interface HandleStats {
  handle: string;           // raw from chat.db
  normalized: string;       // matching key
  is_email: boolean;
  last_message_date: string; // YYYY-MM-DD
  message_count: number;
}

function read_imessage_stats(): HandleStats[] {
  if (!existsSync(CHAT_DB_PATH)) {
    console.error(`chat.db not found at ${CHAT_DB_PATH}`);
    process.exit(1);
  }

  let db: Database.Database;
  try {
    db = new Database(CHAT_DB_PATH, { readonly: true, fileMustExist: true });
  } catch (err) {
    console.error("\n❌ Cannot open chat.db — macOS is blocking access.\n");
    console.error("Fix: System Settings → Privacy & Security → Full Disk Access");
    console.error("     Add your terminal app (Terminal, iTerm2, etc) and restart it.\n");
    console.error("Underlying error:", String(err));
    process.exit(1);
  }

  // Aggregate messages per handle. Counts messages in both directions for a
  // given handle in 1:1 threads; group-chat counts will slightly inflate but
  // the relative ordering is still meaningful.
  const rows = db.prepare(`
    SELECT
      h.id          AS handle,
      MAX(m.date)   AS last_date,
      COUNT(*)      AS msg_count
    FROM handle h
    JOIN message m ON m.handle_id = h.ROWID
    WHERE h.id IS NOT NULL AND h.id != ''
    GROUP BY h.id
    ORDER BY last_date DESC
  `).all() as { handle: string; last_date: number; msg_count: number }[];

  db.close();

  return rows
    .filter((r) => r.msg_count >= MIN_MSG_COUNT)
    .map((r) => ({
      handle: r.handle,
      normalized: normalize_handle(r.handle),
      is_email: is_email(r.handle),
      last_message_date: mac_date_to_iso(r.last_date),
      message_count: r.msg_count,
    }));
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
  phone?: string;
  contact_quality?: number;
  note?: string;
}

async function fetch_contacts(): Promise<CortexContact[]> {
  const res = await fetch(`${API_URL}/api/sync`);
  if (!res.ok) {
    throw new Error(`GET /api/sync failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.contacts as CortexContact[];
}

async function post_updates(updates: UpdatePayload[]) {
  const res = await fetch(`${API_URL}/api/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  });
  if (!res.ok) {
    throw new Error(`POST /api/sync failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n📱 Cortex iMessage Import\n");
  console.log(`Source:   ${CHAT_DB_PATH}`);
  console.log(`Target:   ${API_URL}${DRY_RUN ? "  (dry run)" : ""}`);
  console.log();

  // 1. Read iMessage
  const stats = read_imessage_stats();
  console.log(`Found ${stats.length} handles with ≥${MIN_MSG_COUNT} messages.`);

  // 2. Fetch Cortex contacts
  const contacts = await fetch_contacts();
  console.log(`Cortex has ${contacts.length} contacts.\n`);

  // Build lookup maps — phone and email keyed by normalized value
  const by_phone = new Map<string, CortexContact>();
  const by_email = new Map<string, CortexContact>();
  for (const c of contacts) {
    if (c.phone) by_phone.set(normalize_handle(c.phone), c);
    if (c.email) by_email.set(c.email.toLowerCase(), c);
  }

  // 3. Match and build updates
  const updates: UpdatePayload[] = [];
  const unmatched: HandleStats[] = [];

  for (const s of stats) {
    const contact = s.is_email ? by_email.get(s.normalized) : by_phone.get(s.normalized);

    if (!contact) {
      unmatched.push(s);
      continue;
    }

    const patch: UpdatePayload = { id: contact.id };

    // Always include date — API decides whether to apply
    patch.last_meaningful_contact = s.last_message_date;

    // Backfill phone if this is a phone match and contact has no phone yet
    // (Actually already guaranteed by the match path, but keep it safe)
    if (!s.is_email && !contact.phone) {
      patch.phone = s.normalized;
    }

    // Upgrade quality for strong ties
    if (s.message_count >= STRONG_TIE_MSG_COUNT) {
      patch.contact_quality = 3;
    }

    updates.push(patch);
  }

  // 4. Report
  console.log(`Matched:   ${updates.length}`);
  console.log(`Unmatched: ${unmatched.length}`);
  console.log();

  // Show top 10 unmatched by message count — these are likely real people
  // missing from Cortex
  if (unmatched.length > 0) {
    const top_unmatched = [...unmatched]
      .sort((a, b) => b.message_count - a.message_count)
      .slice(0, 10);
    console.log("Top unmatched handles (may be worth adding to Cortex):");
    for (const u of top_unmatched) {
      console.log(`  ${u.normalized.padEnd(20)}  ${u.message_count.toString().padStart(5)} msgs  last: ${u.last_message_date}`);
    }
    console.log();
  }

  if (DRY_RUN) {
    console.log("Dry run — no updates posted.");
    console.log(`Would have posted ${updates.length} updates.`);
    return;
  }

  // 5. Post in batches of 100 to keep request size sane
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
