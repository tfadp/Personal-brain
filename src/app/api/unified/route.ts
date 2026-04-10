import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources";
import { getSupabase } from "@/lib/supabase";
import { Contact, Signal } from "@/lib/types";
import { enrich_input } from "@/lib/enrich";
import { apply_contact_update, UpdatePayload } from "@/lib/contact_update";

const anthropic = new Anthropic();

// ── Intent classification ────────────────────────────────────────────────────

type Intent =
  | "query_contacts"
  | "query_signals"
  | "ingest_signal"
  | "update_contact"
  | "add_contact";

const VALID_INTENTS: Intent[] = [
  "query_contacts", "query_signals", "ingest_signal", "update_contact", "add_contact",
];

// Fast heuristic — handles the obvious cases without a Claude round-trip.
function fast_intent(input: string): Intent | null {
  const t = input.toLowerCase().trim();
  if (/^https?:\/\/\S+$/.test(input.trim())) return "ingest_signal";
  if (/\bwho (do i know|should i meet|to (meet|see|talk|catch up)|do i need to follow up)\b/.test(t)) return "query_contacts";
  if (/\b(who|what).{0,20}follow.?up\b/.test(t)) return "query_contacts";
  if (/\b(i('m| am)|i've) (going|headed|traveling|flying) to\b/.test(t)) return "query_contacts";
  if (/\b(find|show me|list) (contacts?|people|someone|connections?)\b/.test(t)) return "query_contacts";
  if (/\bwhat (do i know about|have i (saved|read)|did i save)\b/.test(t)) return "query_signals";
  if (/\bwhat.{0,30}\b(saved|in my brain)\b/.test(t)) return "query_signals";
  if (/\bfollow.?up with\b/.test(t)) return "update_contact";
  if (/\b(just (met|spoke|talked|texted|emailed|called)|caught up with)\b/.test(t)) return "update_contact";
  if (/\b(add|new) contact\b/.test(t)) return "add_contact";
  return null;
}

async function classify_intent(input: string): Promise<Intent> {
  const quick = fast_intent(input);
  if (quick) return quick;

  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 64,
    messages: [{
      role: "user",
      content: `Classify this input for a personal contacts + knowledge app. Return ONLY one of these exact strings:
query_contacts | query_signals | ingest_signal | update_contact | add_contact

Input: "${input}"`,
    }],
  });

  const raw = res.content[0].type === "text" ? res.content[0].text.trim() : "";
  return VALID_INTENTS.find((i) => raw.includes(i)) ?? "ingest_signal";
}

// ── Contact pre-filtering ────────────────────────────────────────────────────

// Stop words to skip when building keyword filters
const STOP_WORDS = new Set([
  "who", "what", "where", "when", "know", "with", "from", "that", "this",
  "have", "they", "should", "meet", "find", "show", "list", "people", "about",
  "like", "work", "works", "does",
]);

/**
 * Pulls ≤200 candidate contacts from the DB using keyword pre-filtering.
 * Claude then ranks only this smaller set — not the full table.
 *
 * Strategy:
 * 1. Extract non-trivial keywords from the query (>3 chars, not stop words)
 * 2. OR-filter across name, company, city, country, role in Postgres
 * 3. If no keyword matches, fall back to 200 most-recently-updated contacts
 */
async function get_contact_candidates(input: string): Promise<Contact[]> {
  const supabase = getSupabase();

  const keywords = input
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
    .slice(0, 6);

  if (keywords.length > 0) {
    const filters = keywords.flatMap((k) => [
      `name.ilike.%${k}%`,
      `company.ilike.%${k}%`,
      `city.ilike.%${k}%`,
      `country.ilike.%${k}%`,
      `role.ilike.%${k}%`,
    ]);

    const { data } = await supabase
      .from("contacts")
      .select("*")
      .or(filters.join(","))
      .limit(200);

    if (data && data.length > 0) return data as Contact[];
  }

  // Fallback — most recently updated 200
  const { data: fallback } = await supabase
    .from("contacts")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(200);

  return (fallback ?? []) as Contact[];
}

// ── Handlers ─────────────────────────────────────────────────────────────────

// Detect if a query is specifically asking for follow-up contacts
function is_follow_up_query(input: string): boolean {
  const t = input.toLowerCase();
  return /follow.?up|reach out|ping|remind me|need to call|need to email|should contact/.test(t);
}

async function handle_query_contacts(input: string) {
  const supabase = getSupabase();

  // Follow-up queries: fetch directly from DB — no LLM ranking needed
  if (is_follow_up_query(input)) {
    const { data } = await supabase
      .from("contacts")
      .select("*")
      .eq("follow_up", true)
      .order("updated_at", { ascending: false });

    if (!data || data.length === 0) {
      return { type: "contacts", results: [], message: "No contacts marked for follow-up." };
    }
    // Add relevance note from follow_up_note if present
    const results = data.map((c: Contact) => ({
      ...c,
      relevance: c.follow_up_note ?? "Marked for follow-up",
    }));
    return { type: "contacts", results };
  }

  const contacts = await get_contact_candidates(input);
  if (contacts.length === 0) return { type: "contacts", results: [] };

  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: `You are a personal network assistant. Find and rank the most relevant contacts for this query.

Query: "${input}"

RULES:
- If the query mentions a specific city or country, ONLY return contacts in that location
- contact_quality 3 = real relationship, prefer strongly; contact_quality 1 = noise, surface last
- Return an empty array if no contacts genuinely match

Contacts:
${JSON.stringify(contacts, null, 2)}

Return ONLY a valid JSON array, up to 10 results:
[{ "id": "...", "name": "...", "company": "...", "role": "...", "city": "...", "country": "...", "relationship_strength": "...", "how_you_know_them": "...", "topics": [...], "last_meaningful_contact": "...", "follow_up": false, "follow_up_note": "...", "relevance": "one sentence why relevant" }]`,
    }],
  });

  const raw = res.content[0].type === "text" ? res.content[0].text : "[]";
  const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  let results = [];
  try { results = JSON.parse(clean); } catch { const m = clean.match(/\[[\s\S]*\]/); results = m ? JSON.parse(m[0]) : []; }
  return { type: "contacts", results };
}

async function handle_query_signals(input: string) {
  const supabase = getSupabase();

  // Pre-filter: most recent 200 signals — Claude ranks from this candidate set
  const { data: all } = await supabase
    .from("signals")
    .select("id,summary,topics,source_title,captured_at")
    .order("captured_at", { ascending: false })
    .limit(200);

  if (!all || all.length === 0) return { type: "signals", results: [] };

  const rank_res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: `You are a personal knowledge assistant. Find the most relevant saved knowledge items.

Question: "${input}"

Saved knowledge: ${JSON.stringify(all, null, 2)}

Return ONLY a valid JSON array, up to 8 results:
[{ "id": "...", "summary": "...", "topics": [...], "source_title": "...", "captured_at": "...", "relevance": "one sentence why relevant" }]

Only include genuinely relevant items.`,
    }],
  });

  const rank_raw = rank_res.content[0].type === "text" ? rank_res.content[0].text : "[]";
  const rank_clean = rank_raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  let ranked: (Partial<Signal> & { relevance?: string })[] = [];
  try { ranked = JSON.parse(rank_clean); } catch { const m = rank_clean.match(/\[[\s\S]*\]/); ranked = m ? JSON.parse(m[0]) : []; }

  // Fetch full records for the matched IDs (source_url not included in candidate query)
  const ids = ranked.map((r) => r.id).filter(Boolean);
  const { data: full } = await supabase.from("signals").select("*").in("id", ids);
  const by_id = Object.fromEntries((full ?? []).map((s: Signal) => [s.id, s]));
  ranked = ranked.map((r) => ({ ...by_id[r.id as string], relevance: r.relevance }));

  return { type: "signals", results: ranked };
}

async function handle_ingest_signal(input: string) {
  if (input.length > 50000) {
    return { type: "error", message: "Input too long (max 50 000 characters)" };
  }

  const { content: enriched, source_url, source_title: detected_title } = await enrich_input(input);

  const extract_res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [{
      role: "user",
      content: `Extract the core knowledge from this input. Return ONLY valid JSON.

Input: ${enriched}

Return:
{ "summary": "2-3 sentences of the actual insight — what it says and why it matters", "topics": ["3-6 specific tags"], "source_title": "title if identifiable, else null", "source_url": "URL if present, else null" }`,
    }],
  });

  const raw = extract_res.content[0].type === "text" ? extract_res.content[0].text : "{}";
  const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  let parsed: { summary: string; topics: string[]; source_title: string | null; source_url: string | null };
  try { parsed = JSON.parse(clean); } catch { return { type: "error", message: "Could not process that input." }; }

  const { data, error } = await getSupabase().from("signals").insert({
    summary: parsed.summary,
    topics: parsed.topics,
    source_title: detected_title ?? parsed.source_title,
    source_url: parsed.source_url ?? source_url,
    raw_input: input.trim(),
  }).select().single();

  if (error) return { type: "error", message: error.message };
  return { type: "ingested", signal: data };
}

async function handle_update_contact(input: string) {
  const parse_res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [{
      role: "user",
      content: `Parse this contact update command. Return ONLY valid JSON.

Command: "${input}"
Today: ${new Date().toISOString().split("T")[0]}
Yesterday: ${new Date(Date.now() - 86400000).toISOString().split("T")[0]}

Return:
{
  "contact_name": "name only — ignore phone numbers or other details",
  "updates": {
    "notes": "include phone/email/details as note if mentioned",
    "last_meaningful_contact": "YYYY-MM-DD if mentioned",
    "relationship_strength": "strong|medium|light if mentioned",
    "contact_quality": 1|2|3 if mentioned,
    "topics": ["new topics if mentioned"],
    "follow_up": true if 'follow up/catch up/reach out/ping', false if 'done/spoke/followed up',
    "follow_up_note": "context if follow_up is true"
  },
  "action": "short confirmation e.g. 'Marked Sarah for follow-up'"
}
Only include fields explicitly mentioned.`,
    }],
  });

  const raw = parse_res.content[0].type === "text" ? parse_res.content[0].text : "{}";
  const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  let parsed: { contact_name: string; updates: UpdatePayload; action: string };
  try { parsed = JSON.parse(clean); } catch { return { type: "error", message: "Could not understand that command." }; }

  // If the raw input clearly signals follow-up intent, enforce it — don't trust Claude to infer it
  if (/\bfollow.?up\b|\breach out\b|\bping\b|\bneed to (call|email|text)\b/i.test(input)) {
    parsed.updates.follow_up = true;
    if (!parsed.updates.follow_up_note) {
      parsed.updates.follow_up_note = input;
    }
  }

  const result = await apply_contact_update(parsed.contact_name, parsed.updates, parsed.action);

  if (!result.ok && result.clarify) {
    // Multiple matches — ask the user to pick one
    return { type: "clarify", message: `Multiple contacts match "${parsed.contact_name}". Which one?`, candidates: result.candidates };
  }
  if (!result.ok) {
    return { type: "error", message: result.error };
  }
  return { type: "updated", action: result.action, contact: result.contact };
}

async function handle_add_contact(input: string) {
  const parse_res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [{
      role: "user",
      content: `Extract contact details from this input. Return ONLY valid JSON.

Input: "${input}"

Return:
{ "name": "required", "role": "or null", "company": "or null", "city": "or null", "country": "or null", "email": "or null", "topics": ["if mentioned"], "notes": "any other details including phone number", "relationship_strength": "strong|medium|light or null", "how_you_know_them": "or null" }`,
    }],
  });

  const raw = parse_res.content[0].type === "text" ? parse_res.content[0].text : "{}";
  const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  let parsed: Partial<Contact>;
  try { parsed = JSON.parse(clean); } catch { return { type: "error", message: "Could not parse contact details." }; }
  if (!parsed.name) return { type: "error", message: "Could not identify a name." };

  // Validate enums
  if (parsed.relationship_strength && !["strong", "medium", "light"].includes(parsed.relationship_strength)) {
    parsed.relationship_strength = null;
  }
  if (parsed.contact_quality !== undefined && parsed.contact_quality !== null &&
      ![1, 2, 3].includes(parsed.contact_quality)) {
    parsed.contact_quality = null;
  }

  const { data, error } = await getSupabase().from("contacts").insert({
    name: parsed.name,
    role: parsed.role ?? null,
    company: parsed.company ?? null,
    city: parsed.city ?? null,
    country: parsed.country ?? null,
    email: parsed.email ?? null,
    topics: parsed.topics ?? null,
    notes: parsed.notes ?? null,
    relationship_strength: parsed.relationship_strength ?? null,
    how_you_know_them: parsed.how_you_know_them ?? null,
    follow_up: false,
  }).select().single();

  if (error) return { type: "error", message: error.message };
  return { type: "added", contact: data };
}

// ── Screenshot handler ───────────────────────────────────────────────────────

function normalize_image_type(file_type: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  if (file_type.includes("png")) return "image/png";
  if (file_type.includes("gif")) return "image/gif";
  if (file_type.includes("webp")) return "image/webp";
  return "image/jpeg";
}

async function handle_screenshot(file_data: string, file_type: string, caption?: string) {
  const media_type = normalize_image_type(file_type);

  const { data: contacts } = await getSupabase()
    .from("contacts")
    .select("id, name, email")
    .order("name");

  if (!contacts || contacts.length === 0) {
    return { type: "error", message: "No contacts to match against." };
  }

  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type, data: file_data },
        } as ContentBlockParam,
        {
          type: "text",
          text: `Look at this screenshot. If it shows a text/iMessage/WhatsApp conversation:
1. Find the contact's name (shown at the top of the conversation)
2. Find the most recent message date
3. Match the name to this contacts list (fuzzy match — "Jon" can match "Jonathan Smith"):
${JSON.stringify(contacts.map((c) => ({ id: c.id, name: c.name })), null, 2)}

Return ONLY valid JSON:
{
  "is_text_screenshot": true,
  "contact_id": "matched uuid or null if no match",
  "contact_name": "name as shown in screenshot",
  "last_meaningful_contact": "YYYY-MM-DD"
}

If it is not a text/messaging screenshot, return:
{ "is_text_screenshot": false }`,
        },
      ] as ContentBlockParam[],
    }],
  });

  const raw = res.content[0].type === "text" ? res.content[0].text : "{}";
  const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();

  let parsed: {
    is_text_screenshot: boolean;
    contact_id: string | null;
    contact_name: string;
    last_meaningful_contact: string;
  };

  try { parsed = JSON.parse(clean); } catch { return { type: "error", message: "Could not read that screenshot." }; }

  if (!parsed.is_text_screenshot) {
    // Not a messaging screenshot — treat the caption as context if provided
    return { type: "error", message: caption
      ? `Not a text conversation screenshot. If you meant to add a contact, try: "add contact [name] [details]"`
      : "That doesn't look like a text conversation screenshot." };
  }

  // Detect follow-up intent from the caption the user typed alongside the screenshot
  const wants_follow_up = /follow.?up|reach out|ping|remind/i.test(caption ?? "");

  // No match — create the contact from the screenshot
  if (!parsed.contact_id) {
    const { data, error } = await getSupabase()
      .from("contacts")
      .insert({
        name: parsed.contact_name,
        last_meaningful_contact: parsed.last_meaningful_contact,
        how_you_know_them: "Text conversation",
        follow_up: wants_follow_up,
        follow_up_note: wants_follow_up ? (caption ?? null) : null,
      })
      .select()
      .single();

    if (error) return { type: "error", message: error.message };
    const action = wants_follow_up
      ? `Added ${data.name} and marked for follow-up`
      : `Added ${data.name} — last text ${parsed.last_meaningful_contact}`;
    return { type: "added", action, contact: data };
  }

  const patch: Record<string, unknown> = {
    last_meaningful_contact: parsed.last_meaningful_contact,
    updated_at: new Date().toISOString(),
  };
  if (wants_follow_up) {
    patch.follow_up = true;
    patch.follow_up_note = caption ?? null;
  }

  const { data, error } = await getSupabase()
    .from("contacts")
    .update(patch)
    .eq("id", parsed.contact_id)
    .select()
    .single();

  if (error) return { type: "error", message: error.message };
  const action = wants_follow_up
    ? `Updated ${data.name} and marked for follow-up`
    : `Updated ${data.name} — last text ${parsed.last_meaningful_contact}`;
  return { type: "updated", action, contact: data };
}

// ── Main route — SSE streaming ───────────────────────────────────────────────

const INTENT_STATUS: Record<string, string> = {
  query_contacts: "Searching your contacts...",
  query_signals:  "Searching your brain...",
  ingest_signal:  "Saving to your brain...",
  update_contact: "Updating contact...",
  add_contact:    "Adding contact...",
};

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const body = await request.json().catch(() => ({}));

  // Validate: must have either image or text input
  const { file_data, file_type, input } = body;
  if (!file_data && !input?.trim()) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: "Nothing to process" })}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } }
    );
  }
  if (file_data && !file_type?.startsWith("image/")) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: "Unsupported file type" })}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      try {
        if (file_data && file_type?.startsWith("image/")) {
          send({ type: "status", message: "Reading screenshot..." });
          send(await handle_screenshot(file_data, file_type, input?.trim()));
          return;
        }

        send({ type: "status", message: "Thinking..." });
        const intent = await classify_intent(input);
        send({ type: "status", message: INTENT_STATUS[intent] ?? "Working..." });

        switch (intent) {
          case "query_contacts": send(await handle_query_contacts(input)); break;
          case "query_signals":  send(await handle_query_signals(input)); break;
          case "ingest_signal":  send(await handle_ingest_signal(input)); break;
          case "update_contact": send(await handle_update_contact(input)); break;
          case "add_contact":    send(await handle_add_contact(input)); break;
          default: send({ type: "error", message: "Could not understand that." });
        }
      } catch (err) {
        console.error("Unified route error:", err);
        send({ type: "error", message: "Something went wrong. Try again." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
