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
 * Apply a contact update by exact ID — used after the user resolves a clarify prompt.
 * Same merge logic as apply_contact_update (topics additive, notes appended).
 */
export async function apply_contact_update_by_id(
  contact_id: string,
  updates: UpdatePayload,
  action: string,
): Promise<UpdateResult> {
  const supabase = getSupabase();

  const { data: contact, error: fetch_error } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", contact_id)
    .single();

  if (fetch_error || !contact) {
    return { ok: false, clarify: false, error: "Contact not found." };
  }

  const final: Partial<Contact> = { ...updates };

  if (updates.topics && updates.topics.length > 0) {
    final.topics = Array.from(new Set([...(contact.topics ?? []), ...updates.topics]));
  }

  if (updates.notes) {
    const prefix = new Date().toISOString().split("T")[0];
    final.notes = contact.notes
      ? `${contact.notes}\n[${prefix}] ${updates.notes}`
      : `[${prefix}] ${updates.notes}`;
  }

  const { data: updated, error } = await supabase
    .from("contacts")
    .update({ ...final, updated_at: new Date().toISOString() })
    .eq("id", contact_id)
    .select()
    .single();

  if (error) return { ok: false, clarify: false, error: error.message };
  return { ok: true, contact: updated, action };
}

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

  if (!matches || matches.length === 0) {
    return { ok: false, clarify: false, error: `No contact found matching "${contact_name}".` };
  }

  // From here, matches is guaranteed non-null with ≥1 element
  let resolved_matches: Contact[] = matches;

  // Multiple matches — but if they're clearly the same person, pick the most complete record
  if (resolved_matches.length > 1) {
    const first = resolved_matches[0];
    const same_person = resolved_matches.every((m) => {
      const name_a = first.name.toLowerCase().split(/\s+/);
      const name_b = m.name.toLowerCase().split(/\s+/);
      // Same first name, and companies overlap or one is a substring of the other
      const same_first = name_a[0] === name_b[0];
      const company_a = (first.company ?? "").toLowerCase();
      const company_b = (m.company ?? "").toLowerCase();
      // Only auto-merge when BOTH have a company and they overlap — if either is blank,
      // fall through to clarify (two "Sarah"s with no company could be different people)
      const same_company = !!company_a && !!company_b && (company_a.includes(company_b) || company_b.includes(company_a));
      return same_first && same_company;
    });

    if (same_person) {
      // Pick the record with the most filled-in fields
      const scored = resolved_matches.map((m) => ({
        contact: m,
        score: Object.values(m).filter((v) => v !== null && v !== undefined && v !== "").length,
      }));
      scored.sort((a, b) => b.score - a.score);
      resolved_matches = [scored[0].contact];
    } else {
      return {
        ok: false,
        clarify: true,
        candidates: resolved_matches.map((c) => ({
          id: c.id,
          name: c.name,
          company: c.company,
          city: c.city,
        })),
      };
    }
  }

  const contact = resolved_matches[0];

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
