import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "@/lib/supabase";

const anthropic = new Anthropic();

// GET /api/interactions?contact_id=xxx
// Returns all interactions for a contact, newest first.
export async function GET(request: NextRequest) {
  const contact_id = request.nextUrl.searchParams.get("contact_id");
  if (!contact_id) {
    return Response.json({ error: "contact_id required" }, { status: 400 });
  }

  const { data, error } = await getSupabase()
    .from("interactions")
    .select("*")
    .eq("contact_id", contact_id)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data ?? []);
}

// POST /api/interactions
// Body: { raw_content, contact_id, source? }
// Extracts summary + topics via Claude, writes the interaction row,
// and bumps contact.last_meaningful_contact if this date is more recent.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { raw_content, contact_id, source = "manual" } = body;

  if (!raw_content?.trim()) {
    return Response.json({ error: "raw_content required" }, { status: 400 });
  }
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!contact_id || !UUID_RE.test(contact_id)) {
    return Response.json({ error: "Valid contact_id required" }, { status: 400 });
  }

  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  const extract_res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    messages: [{
      role: "user",
      content: `Extract a summary of this personal note about an interaction with a contact.
Today: ${today}
Yesterday: ${yesterday}

Input: "${raw_content}"

Return ONLY valid JSON:
{
  "summary": "one sentence describing what happened",
  "topics": ["2-4 topic tags"],
  "date": "YYYY-MM-DD — infer from 'today', 'yesterday', etc. Default to today if unclear"
}`,
    }],
  });

  const raw = extract_res.content[0].type === "text" ? extract_res.content[0].text : "{}";
  const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();

  let parsed: { summary: string; topics: string[]; date: string };
  try {
    parsed = JSON.parse(clean);
  } catch {
    parsed = { summary: raw_content.slice(0, 200), topics: [], date: today };
  }

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const interaction_date = (parsed.date && DATE_RE.test(parsed.date)) ? parsed.date : today;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("interactions")
    .insert({
      contact_id,
      date: interaction_date,
      source,
      raw_content: raw_content.trim(),
      summary: parsed.summary ?? null,
      topics: parsed.topics ?? null,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Bump last_meaningful_contact on the contact if this date is more recent
  const { data: contact } = await supabase
    .from("contacts")
    .select("last_meaningful_contact")
    .eq("id", contact_id)
    .single();

  if (contact) {
    const should_update =
      !contact.last_meaningful_contact ||
      interaction_date >= contact.last_meaningful_contact;

    if (should_update) {
      await supabase
        .from("contacts")
        .update({ last_meaningful_contact: interaction_date, updated_at: new Date().toISOString() })
        .eq("id", contact_id);
    }
  }

  return Response.json(data);
}
