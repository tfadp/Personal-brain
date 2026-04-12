import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// GET — return contacts list so clients can match against external sources
// (Gmail senders, iMessage handles, Calendar attendees). Paginates past the
// PostgREST max-rows cap so we return the full network.
export async function GET() {
  const supabase = getSupabase();
  const PAGE = 1000;
  type SyncContact = { id: string; name: string; email: string | null; phone: string | null; last_meaningful_contact: string | null };
  let all: SyncContact[] = [];
  for (let page = 0; ; page++) {
    const { data: chunk, error } = await supabase
      .from("contacts")
      .select("id, name, email, phone, last_meaningful_contact")
      .order("name")
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!chunk || chunk.length === 0) break;
    all = all.concat(chunk as SyncContact[]);
    if (chunk.length < PAGE) break;
  }
  return NextResponse.json({ contacts: all });
}

// POST — bulk update last_meaningful_contact after Gmail sync
// Only updates a contact if the new date is more recent than the current one
export async function POST(request: NextRequest) {
  try {
    const { updates } = await request.json();

    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ error: "updates array required" }, { status: 400 });
    }

    const supabase = getSupabase();
    const updated: { id: string; name: string; last_meaningful_contact: string }[] = [];
    const skipped: { id: string; reason: string }[] = [];

    for (const update of updates) {
      const { id, last_meaningful_contact, note, phone, contact_quality } = update;
      if (!id) continue;

      // Fetch current record to compare dates and append notes safely
      const { data: current } = await supabase
        .from("contacts")
        .select("id, name, last_meaningful_contact, notes, phone, contact_quality")
        .eq("id", id)
        .single();

      if (!current) {
        skipped.push({ id, reason: "not found" });
        continue;
      }

      const patch: Record<string, string | number> = { updated_at: new Date().toISOString() };

      // Date update — only move forward, never backward
      if (last_meaningful_contact) {
        if (!current.last_meaningful_contact || current.last_meaningful_contact < last_meaningful_contact) {
          patch.last_meaningful_contact = last_meaningful_contact;
        }
      }

      // Phone backfill — only set if currently null (never overwrite user-entered data)
      if (phone && !current.phone) {
        patch.phone = phone;
      }

      // Quality upgrade — only move upward from null, never downgrade
      if (contact_quality && !current.contact_quality) {
        patch.contact_quality = contact_quality;
      }

      // Append note if provided
      if (note && last_meaningful_contact) {
        patch.notes = current.notes
          ? `${current.notes}\n[${last_meaningful_contact}] ${note}`
          : `[${last_meaningful_contact}] ${note}`;
      }

      // Skip if nothing would change
      if (Object.keys(patch).length === 1) {
        skipped.push({ id, reason: "already up to date" });
        continue;
      }

      const { data, error } = await supabase
        .from("contacts")
        .update(patch)
        .eq("id", id)
        .select("id, name, last_meaningful_contact")
        .single();

      if (error) {
        skipped.push({ id, reason: error.message });
      } else {
        updated.push(data);
      }
    }

    return NextResponse.json({ updated, skipped });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
