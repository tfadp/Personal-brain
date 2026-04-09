// Canonical contact update logic — used by update route and unified route.
// Handles fuzzy name matching, topic merging, note appending, and DB apply.

import { getSupabase } from "@/lib/supabase";
import { Contact } from "@/lib/types";

export type UpdatePayload = Partial<Contact> & { topics?: string[] };

export type UpdateResult =
  | { ok: true; contact: Contact; action: string }
  | { ok: false; clarify: true; candidates: Pick<Contact, "id" | "name" | "company" | "city">[] }
  | { ok: false; clarify: false; error: string };

/**
 * Find, merge, and apply a contact update by name.
 *
 * - If multiple contacts match, returns clarify=true with candidates so the
 *   caller can ask the user which one they meant.
 * - Topics are merged (additive), notes are appended with a date prefix.
 */
export async function apply_contact_update(
  contact_name: string,
  updates: UpdatePayload,
  action: string,
): Promise<UpdateResult> {
  const supabase = getSupabase();

  // Prefer email match when available — stable, unambiguous
  let matches: Contact[] | null = null;

  if (updates.email) {
    const { data } = await supabase
      .from("contacts")
      .select("*")
      .ilike("email", updates.email);
    if (data && data.length > 0) matches = data;
  }

  if (!matches) {
    const { data } = await supabase
      .from("contacts")
      .select("*")
      .ilike("name", `%${contact_name}%`);
    matches = data ?? [];
  }

  if (matches.length === 0) {
    return { ok: false, clarify: false, error: `No contact found matching "${contact_name}".` };
  }

  // Multiple plausible matches — ask the caller to clarify rather than mutating the wrong person
  if (matches.length > 1) {
    return {
      ok: false,
      clarify: true,
      candidates: matches.map((c) => ({
        id: c.id,
        name: c.name,
        company: c.company,
        city: c.city,
      })),
    };
  }

  const contact = matches[0];

  // Merge updates
  const final: Partial<Contact> = { ...updates };

  // Topics are additive — union with existing
  if (updates.topics && updates.topics.length > 0) {
    final.topics = Array.from(new Set([...(contact.topics ?? []), ...updates.topics]));
  }

  // Notes are appended with a date stamp
  if (updates.notes) {
    const prefix = new Date().toISOString().split("T")[0];
    final.notes = contact.notes
      ? `${contact.notes}\n[${prefix}] ${updates.notes}`
      : `[${prefix}] ${updates.notes}`;
  }

  const { data: updated, error } = await supabase
    .from("contacts")
    .update({ ...final, updated_at: new Date().toISOString() })
    .eq("id", contact.id)
    .select()
    .single();

  if (error) {
    return { ok: false, clarify: false, error: error.message };
  }

  return { ok: true, contact: updated, action };
}
