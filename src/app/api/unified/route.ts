import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "@/lib/supabase";
import { Contact, Signal } from "@/lib/types";

const anthropic = new Anthropic();

// ── Intent classification ────────────────────────────────────────────────────

type Intent =
  | "query_contacts"
  | "query_signals"
  | "ingest_signal"
  | "update_contact"
  | "add_contact";

// Fast heuristic — handles the obvious cases without a Claude round-trip.
// Returns null when uncertain so we fall back to Claude.
function fast_intent(input: string): Intent | null {
  const t = input.toLowerCase().trim();

  // Standalone URL → always ingest
  if (/^https?:\/\/\S+$/.test(input.trim())) return "ingest_signal";

  // Contact search
  if (/\bwho (do i know|should i meet|to (meet|see|talk|catch up))\b/.test(t)) return "query_contacts";
  if (/\b(i('m| am)|i've) (going|headed|traveling|flying) to\b/.test(t)) return "query_contacts";
  if (/\b(find|show me|list) (contacts?|people|someone|connections?)\b/.test(t)) return "query_contacts";

  // Knowledge search
  if (/\bwhat (do i know about|have i (saved|read)|did i save)\b/.test(t)) return "query_signals";
  if (/\bwhat.{0,30}\b(saved|in my brain)\b/.test(t)) return "query_signals";

  // Contact updates
  if (/\bfollow.?up with\b/.test(t)) return "update_contact";
  if (/\b(just (met|spoke|talked|texted|emailed|called)|caught up with)\b/.test(t)) return "update_contact";

  // Add contact
  if (/\b(add|new) contact\b/.test(t)) return "add_contact";

  return null; // uncertain — ask Claude
}

async function classify_intent(input: string): Promise<{ intent: Intent }> {
  // Try heuristics first — instant, no API call
  const quick = fast_intent(input);
  if (quick) return { intent: quick };

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
  const VALID_INTENTS: Intent[] = ["query_contacts", "query_signals", "ingest_signal", "update_contact", "add_contact"];
  const matched = VALID_INTENTS.find(i => raw.includes(i));
  return { intent: matched ?? "ingest_signal" };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function is_url(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function extract_youtube_id(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

async function fetch_youtube_transcript(video_id: string): Promise<string | null> {
  const api_key = process.env.SUPADATA_API_KEY;
  if (!api_key) return null;
  try {
    const res = await fetch(
      `https://api.supadata.ai/v1/youtube/transcript?videoId=${video_id}&text=true`,
      { headers: { "x-api-key": api_key }, signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.content ?? data.transcript ?? null;
  } catch {
    return null;
  }
}

async function fetch_url_content(url: string): Promise<{ title: string | null; text: string } | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { "Accept": "text/plain" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const raw = await res.text();
    if (!raw || raw.length < 100) return null;
    const title_match = raw.match(/^Title:\s*(.+)/m);
    return { title: title_match ? title_match[1].trim() : null, text: raw.slice(0, 8000) };
  } catch {
    return null;
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handle_query_contacts(input: string) {
  // Fetch all contacts in one shot — Claude does filtering + ranking in the
  // same call, saving a full round-trip vs the old extract-filters → rank pattern.
  const { data: contacts } = await getSupabase().from("contacts").select("*").order("name");
  if (!contacts || contacts.length === 0) return { type: "contacts", results: [] };

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
- follow_up = true contacts should be surfaced prominently for reconnect queries
- Return an empty array if no contacts genuinely match

Contacts:
${JSON.stringify(contacts, null, 2)}

Return ONLY a valid JSON array, up to 10 results:
[{ "id": "...", "name": "...", "company": "...", "role": "...", "city": "...", "country": "...", "relationship_strength": "...", "how_you_know_them": "...", "topics": [...], "last_meaningful_contact": "...", "notes": "...", "follow_up": false, "follow_up_note": "...", "relevance": "one sentence why relevant" }]`,
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
  const { data: all } = await supabase.from("signals").select("*").order("captured_at", { ascending: false });
  if (!all || all.length === 0) return { type: "signals", results: [] };

  const rank_res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: `You are a personal knowledge assistant. Find the most relevant saved knowledge items.

Question: "${input}"

Saved knowledge: ${JSON.stringify(all.map((s: Signal) => ({ id: s.id, summary: s.summary, topics: s.topics, source_title: s.source_title, captured_at: s.captured_at })), null, 2)}

Return ONLY a valid JSON array, up to 8 results:
[{ "id": "...", "summary": "...", "topics": [...], "source_title": "...", "captured_at": "...", "relevance": "one sentence why relevant" }]

Only include genuinely relevant items.`,
    }],
  });

  const rank_raw = rank_res.content[0].type === "text" ? rank_res.content[0].text : "[]";
  const rank_clean = rank_raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  // Merge source_url back from full records since we didn't pass it above
  let ranked = [];
  try { ranked = JSON.parse(rank_clean); } catch { const m = rank_clean.match(/\[[\s\S]*\]/); ranked = m ? JSON.parse(m[0]) : []; }
  const by_id = Object.fromEntries((all as Signal[]).map((s) => [s.id, s]));
  ranked = ranked.map((r: Signal & { relevance?: string }) => ({ ...by_id[r.id], relevance: r.relevance }));
  return { type: "signals", results: ranked };
}

async function handle_ingest_signal(input: string) {
  const trimmed = input.trim();
  let enriched = trimmed;
  let source_url: string | null = null;
  let detected_title: string | null = null;

  if (is_url(trimmed)) {
    const video_id = extract_youtube_id(trimmed);
    if (video_id) {
      const transcript = await fetch_youtube_transcript(video_id);
      enriched = transcript
        ? `YouTube video URL: ${trimmed}\n\nTranscript:\n${transcript}`
        : `YouTube video URL: ${trimmed}\n\n(Transcript unavailable.)`;
      source_url = trimmed;
    } else {
      const article = await fetch_url_content(trimmed);
      if (article) {
        enriched = `Article URL: ${trimmed}\nTitle: ${article.title ?? "Unknown"}\n\nContent:\n${article.text}`;
        source_url = trimmed;
        detected_title = article.title;
      } else {
        enriched = `URL: ${trimmed}\n\n(Could not fetch — paste the article text directly.)`;
        source_url = trimmed;
      }
    }
  }

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
    raw_input: trimmed,
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
  let parsed: { contact_name: string; updates: Partial<Contact> & { topics?: string[] }; action: string };
  try { parsed = JSON.parse(clean); } catch { return { type: "error", message: "Could not understand that command." }; }

  const supabase = getSupabase();
  const { data: matches } = await supabase.from("contacts").select("*").ilike("name", `%${parsed.contact_name}%`);
  if (!matches || matches.length === 0) return { type: "error", message: `No contact found matching "${parsed.contact_name}".` };

  const contact: Contact = matches[0];
  const final: Partial<Contact> = { ...parsed.updates };

  if (parsed.updates.topics?.length) {
    final.topics = Array.from(new Set([...(contact.topics ?? []), ...parsed.updates.topics]));
  }
  if (parsed.updates.notes) {
    const prefix = new Date().toISOString().split("T")[0];
    final.notes = contact.notes ? `${contact.notes}\n[${prefix}] ${parsed.updates.notes}` : `[${prefix}] ${parsed.updates.notes}`;
  }

  const { data: updated, error } = await supabase.from("contacts").update({ ...final, updated_at: new Date().toISOString() }).eq("id", contact.id).select().single();
  if (error) return { type: "error", message: error.message };
  return { type: "updated", action: parsed.action, contact: updated };
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
{ "name": "required", "role": "or null", "company": "or null", "city": "or null", "country": "or null", "email": "or null", "phone": "save as note if present", "topics": ["if mentioned"], "notes": "any other details including phone number", "relationship_strength": "strong|medium|light or null", "how_you_know_them": "or null" }`,
    }],
  });

  const raw = parse_res.content[0].type === "text" ? parse_res.content[0].text : "{}";
  const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  let parsed: Partial<Contact> & { phone?: string };
  try { parsed = JSON.parse(clean); } catch { return { type: "error", message: "Could not parse contact details." }; }
  if (!parsed.name) return { type: "error", message: "Could not identify a name." };

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
  return "image/jpeg"; // covers jpg, heic (iOS converts to jpeg on upload)
}

async function handle_screenshot(file_data: string, file_type: string) {
  const media_type = normalize_image_type(file_type);

  // Get contacts for matching
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
        } as Parameters<typeof anthropic.messages.create>[0]["messages"][0]["content"][0],
        {
          type: "text",
          text: `Look at this screenshot. If it shows a text/iMessage/WhatsApp conversation:
1. Find the contact's name (shown at the top of the conversation)
2. Find the most recent message date
3. Match the name to this contacts list (fuzzy match — "Jon" can match "Jonathan Smith"):
${JSON.stringify(contacts.map(c => ({ id: c.id, name: c.name })), null, 2)}

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
      ],
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

  try {
    parsed = JSON.parse(clean);
  } catch {
    return { type: "error", message: "Could not read that screenshot." };
  }

  if (!parsed.is_text_screenshot) {
    return { type: "error", message: "That doesn't look like a text conversation screenshot." };
  }

  if (!parsed.contact_id) {
    return {
      type: "error",
      message: `Found a conversation with "${parsed.contact_name}" but they're not in Cortex. Add them first.`,
    };
  }

  const { data, error } = await getSupabase()
    .from("contacts")
    .update({
      last_meaningful_contact: parsed.last_meaningful_contact,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.contact_id)
    .select()
    .single();

  if (error) return { type: "error", message: error.message };
  return {
    type: "updated",
    action: `Updated ${data.name} — last text ${parsed.last_meaningful_contact}`,
    contact: data,
  };
}

// ── Main route ───────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { file_data, file_type } = body;

    // Image screenshot path
    if (file_data && file_type?.startsWith("image/")) {
      return NextResponse.json(await handle_screenshot(file_data, file_type));
    }

    const { input } = body;
    if (!input?.trim()) return NextResponse.json({ error: "Nothing to process" }, { status: 400 });

    const { intent } = await classify_intent(input);

    switch (intent) {
      case "query_contacts":  return NextResponse.json(await handle_query_contacts(input));
      case "query_signals":   return NextResponse.json(await handle_query_signals(input));
      case "ingest_signal":   return NextResponse.json(await handle_ingest_signal(input));
      case "update_contact":  return NextResponse.json(await handle_update_contact(input));
      case "add_contact":     return NextResponse.json(await handle_add_contact(input));
      default:                return NextResponse.json({ type: "error", message: "Could not understand that." });
    }
  } catch (err) {
    console.error("Unified route error:", err);
    return NextResponse.json({ error: "Something went wrong", details: String(err) }, { status: 500 });
  }
}
