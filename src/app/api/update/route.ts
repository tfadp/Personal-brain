import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { apply_contact_update, UpdatePayload } from "@/lib/contact_update";

const anthropic = new Anthropic();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { command } = body;
    if (!command?.trim()) {
      return NextResponse.json({ error: "command is required" }, { status: 400 });
    }
    if (command.length > 2000) {
      return NextResponse.json({ error: "Command too long (max 2000 characters)" }, { status: 400 });
    }

    const parse_res = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      messages: [{
        role: "user",
        content: `You are a personal CRM assistant. Parse this natural language update command and return ONLY valid JSON, no other text.

Command: "${command}"

Today's date: ${new Date().toISOString().split("T")[0]}
Yesterday's date: ${new Date(Date.now() - 86400000).toISOString().split("T")[0]}

Return JSON with:
{
  "contact_name": "the name of the person to update — just the name, ignore phone numbers, emails, or other details",
  "updates": {
    "notes": "if a phone number, email, or other contact detail is included, save it as a note. Also save any other note text mentioned.",
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
      }],
    });

    const raw = parse_res.content[0].type === "text" ? parse_res.content[0].text : "";
    const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();

    let parsed: { contact_name: string; updates: UpdatePayload; action: string };
    try {
      parsed = JSON.parse(clean);
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

    // Validate enum values if present
    if (parsed.updates.relationship_strength &&
        !["strong", "medium", "light"].includes(parsed.updates.relationship_strength)) {
      return NextResponse.json(
        { error: "relationship_strength must be 'strong', 'medium', or 'light'" },
        { status: 400 }
      );
    }
    if (parsed.updates.contact_quality !== undefined && parsed.updates.contact_quality !== null &&
        ![1, 2, 3].includes(parsed.updates.contact_quality)) {
      return NextResponse.json(
        { error: "contact_quality must be 1, 2, or 3" },
        { status: 400 }
      );
    }

    const result = await apply_contact_update(parsed.contact_name, parsed.updates, parsed.action);

    if (!result.ok && result.clarify) {
      return NextResponse.json(
        { error: `Multiple contacts match "${parsed.contact_name}". Did you mean one of these?`, candidates: result.candidates },
        { status: 409 }
      );
    }

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    return NextResponse.json({ success: true, action: result.action, contact: result.contact });
  } catch (err) {
    console.error("Update error:", err);
    return NextResponse.json({ error: "Update failed", details: String(err) }, { status: 500 });
  }
}
