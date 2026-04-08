import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "@/lib/supabase";
import { Contact } from "@/lib/types";

const anthropic = new Anthropic();

export async function POST(request: NextRequest) {
  try {
    const { command } = await request.json();

    if (!command) {
      return NextResponse.json({ error: "Command is required" }, { status: 400 });
    }

    // Step 1: Ask Claude to parse the command into a structured update
    const parseResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `You are a personal CRM assistant. Parse this natural language update command and return ONLY valid JSON, no other text.

Command: "${command}"

Today's date: ${new Date().toISOString().split("T")[0]}
Yesterday's date: ${new Date(Date.now() - 86400000).toISOString().split("T")[0]}

Return JSON with:
{
  "contact_name": "the name of the person to update",
  "updates": {
    "notes": "new or appended note text (only if mentioned)",
    "last_meaningful_contact": "YYYY-MM-DD (only if mentioned or if user says 'today'/'yesterday')",
    "relationship_strength": "strong|medium|light (only if mentioned)",
    "contact_quality": 1|2|3 (only if mentioned — 3=real relationship, 2=weak tie, 1=noise),
    "topics": ["array of NEW topics to add (only if mentioned)"],
    "follow_up": true|false (set true if user says 'follow up', 'catch up', 'reach out', 'ping'; set false if user says 'done', 'spoke', 'followed up', 'clear follow-up'),
    "follow_up_note": "what they said or context for the follow-up (only if follow_up is true and context is given)"
  },
  "action": "short description of what you're doing, e.g. 'Marked Sarah Chen for follow-up'"
}

Only include fields in "updates" that are explicitly mentioned. Omit the rest entirely.`,
        },
      ],
    });

    const parseText =
      parseResponse.content[0].type === "text"
        ? parseResponse.content[0].text
        : "";

    let parsed: {
      contact_name: string;
      updates: Partial<Contact> & { topics?: string[] };
      action: string;
    };

    try {
      parsed = JSON.parse(parseText);
    } catch {
      return NextResponse.json(
        { error: "Could not understand that command. Try: 'add note to [name] — [text]'" },
        { status: 400 }
      );
    }

    if (!parsed.contact_name) {
      return NextResponse.json(
        { error: "Could not identify a contact name in that command." },
        { status: 400 }
      );
    }

    // Step 2: Find the contact by name (fuzzy — ilike)
    const supabase = getSupabase();
    const { data: matches } = await supabase
      .from("contacts")
      .select("*")
      .ilike("name", `%${parsed.contact_name}%`);

    if (!matches || matches.length === 0) {
      return NextResponse.json(
        { error: `No contact found matching "${parsed.contact_name}".` },
        { status: 404 }
      );
    }

    // Use the closest name match
    const contact: Contact = matches[0];

    // Step 3: Merge updates — topics are additive, not replaced
    const final_updates: Partial<Contact> = { ...parsed.updates };

    if (parsed.updates.topics && parsed.updates.topics.length > 0) {
      const existing = contact.topics ?? [];
      const merged = Array.from(new Set([...existing, ...parsed.updates.topics]));
      final_updates.topics = merged;
    }

    // Append notes rather than replace
    if (parsed.updates.notes) {
      const existing_notes = contact.notes ?? "";
      const date_prefix = new Date().toISOString().split("T")[0];
      final_updates.notes = existing_notes
        ? `${existing_notes}\n[${date_prefix}] ${parsed.updates.notes}`
        : `[${date_prefix}] ${parsed.updates.notes}`;
    }

    // Step 4: Apply the update
    const { data: updated, error } = await supabase
      .from("contacts")
      .update({ ...final_updates, updated_at: new Date().toISOString() })
      .eq("id", contact.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      action: parsed.action,
      contact: updated,
    });
  } catch (err) {
    console.error("Update error:", err);
    return NextResponse.json(
      { error: "Update failed", details: String(err) },
      { status: 500 }
    );
  }
}
