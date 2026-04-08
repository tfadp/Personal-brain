import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// GET — return contacts list so Claude can match against Gmail senders/recipients
export async function GET() {
  const { data, error } = await getSupabase()
    .from("contacts")
    .select("id, name, email, last_meaningful_contact")
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contacts: data });
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
      const { id, last_meaningful_contact, note } = update;
      if (!id || !last_meaningful_contact) continue;

      // Fetch current record to compare dates and append notes safely
      const { data: current } = await supabase
        .from("contacts")
        .select("id, name, last_meaningful_contact, notes")
        .eq("id", id)
        .single();

      if (!current) {
        skipped.push({ id, reason: "not found" });
        continue;
      }

      // Skip if existing date is already the same or more recent
      if (current.last_meaningful_contact >= last_meaningful_contact) {
        skipped.push({ id, reason: "already up to date" });
        continue;
      }

      const patch: Record<string, string> = {
        last_meaningful_contact,
        updated_at: new Date().toISOString(),
      };

      if (note) {
        patch.notes = current.notes
          ? `${current.notes}\n[${last_meaningful_contact}] ${note}`
          : `[${last_meaningful_contact}] ${note}`;
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
