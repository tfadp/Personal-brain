import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources";
import { getSupabase } from "@/lib/supabase";
import { Contact, Signal } from "@/lib/types";
import { enrich_input } from "@/lib/enrich";
import { apply_contact_update, apply_contact_update_by_id, UpdatePayload } from "@/lib/contact_update";

const anthropic = new Anthropic();

// ── Intent classification ────────────────────────────────────────────────────

type Intent =
  | "query_contacts"
  | "query_signals"
  | "query_combined"
  | "ingest_signal"
  | "update_contact"
  | "add_contact"
  | "log_interaction";

const VALID_INTENTS: Intent[] = [
  "query_contacts", "query_signals", "query_combined", "ingest_signal", "update_contact", "add_contact", "log_interaction",
];

// Fast heuristic — handles the obvious cases without a Claude round-trip.
function fast_intent(input: string): Intent | null {
  const t = input.toLowerCase().trim();
  if (/^https?:\/\/\S+$/.test(input.trim())) return "ingest_signal";
  // Combined: references both research/knowledge AND people in the same query
  if (/(what (do i know|have i saved|does my research say|does cortex say)|what.{0,30}(saved|brain|research)).{0,80}(who (do i know|should i talk|should i meet)|people|contacts)/i.test(t)) return "query_combined";
  if (/(who (do i know|should i talk|should i meet)).{0,80}(what (do i know|have i saved|does my research)|research|ideas|notes|brain)/i.test(t)) return "query_combined";
  if (/\bi('m| am) thinking about.{0,60}(who|people|contacts|talk to)\b/i.test(t)) return "query_combined";
  if (/\bwho.{0,30}(understands?|knows?|works? (in|on|with)).{0,30}(and|that also|who also).{0,30}(my research|what i (know|saved|read))\b/i.test(t)) return "query_combined";
  if (/\bwho (do i know|should i talk to).+\band\b.+(what|research|saved|brain)\b/i.test(t)) return "query_combined";
  if (/\bwho (do i know|should i meet).+\bwhat.+(know|saved|research)\b/i.test(t)) return "query_combined";
  if (/\bwho (do i know|should i meet).+\b(ai|sports|media|finance|tech|venture|startup)/i.test(t)) return "query_contacts";
  if (/\bwho (do i know|should i meet|to (meet|see|talk|catch up)|do i need to follow up)\b/.test(t)) return "query_contacts";
  if (/\b(who|what).{0,20}follow.?up\b/.test(t)) return "query_contacts";
  if (/\b(i('m| am)|i've) (going|headed|traveling|flying) to\b/.test(t)) return "query_contacts";
  if (/\b(find|show me|list) (contacts?|people|someone|connections?)\b/.test(t)) return "query_contacts";
  if (/\bwhat (do i know about|have i (saved|read)|did i save)\b/.test(t)) return "query_signals";
  if (/\bwhat.{0,30}\b(saved|in my brain)\b/.test(t)) return "query_signals";
  // log_interaction: describing an interaction with a topic — must precede plain update_contact patterns
  if (/\b(talked|spoke|met|discussed|chatted|caught up).{0,80}\babout\b/i.test(t)) return "log_interaction";
  if (/\b(today|yesterday|this morning|this week)\b.{0,60}\b(talked|spoke|met|called|discussed|had (coffee|lunch|a call|a meeting))\b/i.test(t)) return "log_interaction";
  if (/\bhad (coffee|lunch|dinner|a call|a meeting) with\b/i.test(t)) return "log_interaction";
  if (/\bfollow.?up (with|on)\b/.test(t)) return "update_contact";
  if (/\b(add|put|set).{1,30}(to |for |on )follow.?up\b/.test(t)) return "update_contact";
  if (/\b(just (met|spoke|talked|texted|emailed|called)|caught up with)\b/.test(t)) return "update_contact";
  // Any mention of follow-up/marking in a multi-line input = bulk update, not add
  // This must come before the email-list heuristic which would otherwise fire first
  if (/follow.?up|mark for|remind me about|reach out/i.test(t) && (input.match(/\n/g) ?? []).length >= 1) return "update_contact";
  if (/\bmark (these|them|all|this)\b/.test(t)) return "update_contact";
  if (/\b(set|add|clear|remove|done with) follow.?up\b/.test(t)) return "update_contact";
  if (/\b(add|new) contact\b/.test(t)) return "add_contact";
  if (/\badd (them|these|all|contacts?)\b/.test(t)) return "add_contact";
  // Pasted list: 2+ lines each containing an email address (and no update directive above)
  if ((input.match(/\n/g) ?? []).length >= 1 && (input.match(/@\w+\.\w+/g) ?? []).length >= 2) return "add_contact";
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
query_contacts | query_signals | ingest_signal | update_contact | add_contact | log_interaction

log_interaction = user describing a meeting, call, or conversation with a specific person that should be logged to their history (e.g. "talked to X about Y", "had coffee with X", "met X at Z")
update_contact = changing a contact field or marking follow-up (e.g. "mark X for follow-up", "X moved to Goldman")

Input: "${input}"`,
    }],
  });

  const raw = res.content[0].type === "text" ? res.content[0].text.trim() : "";
  return VALID_INTENTS.find((i) => raw.includes(i)) ?? "ingest_signal";
}

// ── Contact search ────────────────────────────────────────────────────────────

// Fields needed for fast ranking and result cards — slimmer than the full row.
const SLIM_FIELDS = [
  "id", "name", "company", "role", "city", "country", "relationship_strength",
  "how_you_know_them", "topics", "last_meaningful_contact", "notes",
  "contact_quality", "follow_up", "follow_up_note",
].join(",");

const SEARCH_FIELDS = ["company", "role", "city", "country", "how_you_know_them", "notes"] as const;
const SIGNAL_SEARCH_FIELDS = ["summary", "source_title"] as const;

const SEARCH_STOP_WORDS = new Set([
  "who", "what", "where", "when", "why", "how", "know", "people", "person",
  "contacts", "contact", "should", "meet", "meets", "find", "finds", "show",
  "shows", "list", "lists", "about", "early", "stage", "someone", "reach",
  "today", "email", "call", "there", "their", "that", "this", "these", "those",
  "which", "think", "need", "want", "like", "some", "good", "best", "great",
  "help", "tell", "give", "make", "take", "follow", "ping", "remind", "catch",
  "talk", "text", "message", "work", "works", "working", "worked", "does",
  "with", "from", "have", "they", "all", "any", "the", "and", "for", "you",
]);

// ── Query expansion — think like a human, not a keyword matcher ──────────────
//
// Instead of maintaining hardcoded alias maps that can never be complete,
// we ask Claude to expand the user's query into everything a human would
// think to search for. "Recruiting" → HR, talent, staffing, headhunter.
// "Brooklyn" → NYC, New York. "Deal flow" → investing, venture, VC.
//
// One fast Claude call (~200ms, ~100 tokens) replaces hundreds of aliases.

interface ExpandedQuery {
  search_terms: string[];     // words/phrases to ilike search in text fields
  location_terms: string[];   // city/neighborhood/metro expansions
  is_role_query: boolean;     // true if asking about what people DO (needs semantic ranking)
}

async function expand_query(input: string): Promise<ExpandedQuery> {
  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    messages: [{
      role: "user",
      content: `You help search a personal contacts database. Given a query, expand it into search terms a human would think of. Think like a human, not a computer.

Query: "${input}"

Rules:
- "recruiting" → also search "recruiter", "talent acquisition", "HR", "human resources", "staffing", "headhunter"
- "Brooklyn" → also search "NYC", "New York" (it's a borough)
- "VC" → also search "venture capital", "venture", "investor"
- "sports media" → also search "sports journalism", "sports broadcasting", "sports content"
- Include the original terms AND all synonyms, related roles, abbreviations, and parent categories
- For locations: include the metro area, common abbreviations, and neighborhoods/boroughs
- Decide: is the user asking about what people DO (role/industry) or just looking for a name/city/company?

Return ONLY valid JSON:
{
  "search_terms": ["every", "relevant", "search", "term", "including", "originals"],
  "location_terms": ["city names", "abbreviations", "neighborhoods", "metros"],
  "is_role_query": true
}

Keep search_terms under 20 items. Keep location_terms under 10.`,
    }],
  });
  const raw = res.content[0].type === "text" ? res.content[0].text : "{}";
  const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    // Fallback: extract manually
    return { search_terms: extract_contact_search_terms(input), location_terms: [], is_role_query: false };
  }
}

function parse_json_array<T>(raw: string): T[] {
  const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  try {
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

function as_contacts(data: unknown): Contact[] {
  return (Array.isArray(data) ? data : []) as Contact[];
}

function as_signals(data: unknown): Signal[] {
  return (Array.isArray(data) ? data : []) as Signal[];
}

function unique_by_id<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function extract_contact_search_terms(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) =>
      !SEARCH_STOP_WORDS.has(word) && word.length > 2
    )
    .slice(0, 10);
}

function contact_field_text(contact: Contact, field: (typeof SEARCH_FIELDS)[number]): string {
  return String(contact[field] ?? "").toLowerCase();
}

function contact_topic_text(contact: Contact): string {
  return (contact.topics ?? []).join(" ").toLowerCase();
}

function contact_match_score(contact: Contact, terms: string[]): number {
  const name_score = terms.some((term) => contact.name.toLowerCase().includes(term)) ? 10 : 0;
  const role_score = terms.some((term) => contact_field_text(contact, "role").includes(term)) ? 8 : 0;
  const topic_score = terms.some((term) => contact_topic_text(contact).includes(term)) ? 7 : 0;
  const company_score = terms.some((term) => contact_field_text(contact, "company").includes(term)) ? 6 : 0;
  const context_score = terms.some((term) =>
    contact_field_text(contact, "how_you_know_them").includes(term) ||
    contact_field_text(contact, "notes").includes(term)
  ) ? 4 : 0;
  const location_score = terms.some((term) =>
    contact_field_text(contact, "city").includes(term) ||
    contact_field_text(contact, "country").includes(term)
  ) ? 2 : 0;
  return name_score + role_score + topic_score + company_score + context_score + location_score;
}

function normalized_contact_quality(contact: Contact): number {
  return contact.contact_quality ?? 0;
}

function contact_relevance(contact: Contact, terms: string[]): string {
  const matched_term = terms.find((term) =>
    contact.name.toLowerCase().includes(term) ||
    contact_field_text(contact, "role").includes(term) ||
    contact_field_text(contact, "company").includes(term) ||
    contact_topic_text(contact).includes(term) ||
    contact_field_text(contact, "how_you_know_them").includes(term) ||
    contact_field_text(contact, "notes").includes(term)
  );
  if (!matched_term) return "Matched this contact search.";
  if (contact.name.toLowerCase().includes(matched_term)) return `Matched name: ${contact.name}`;
  if (contact_field_text(contact, "role").includes(matched_term)) return `Matched role: ${contact.role}`;
  if (contact_field_text(contact, "company").includes(matched_term)) return `Matched company: ${contact.company}`;
  if (contact_topic_text(contact).includes(matched_term)) return `Matched topic: ${matched_term}`;
  return `Matched context for ${matched_term}`;
}

function rank_direct_contacts(contacts: Contact[], terms: string[]): Contact[] {
  return [...contacts]
    .sort((a, b) =>
      normalized_contact_quality(b) - normalized_contact_quality(a) ||
      contact_match_score(b, terms) - contact_match_score(a, terms) ||
      a.name.localeCompare(b.name)
    )
    .map((contact) => ({
      ...contact,
      notes: null,
      relevance: contact_relevance(contact, terms),
    }));
}

/**
 * Fetch candidate contacts using Claude-expanded search terms.
 * expand_query thinks like a human — "recruiting" → HR, talent, staffing.
 * "Brooklyn" → NYC, New York. We search with ALL the expanded terms.
 */
async function get_candidates(expanded: ExpandedQuery): Promise<Contact[]> {
  const supabase = getSupabase();

  const all_terms = [...new Set([...expanded.search_terms, ...expanded.location_terms])].filter(Boolean);
  if (all_terms.length === 0) return [];

  // Text field search (ilike across all searchable columns)
  const text_filters = all_terms.flatMap((k) => [
    `name.ilike.%${k}%`,
    ...SEARCH_FIELDS.map((field) => `${field}.ilike.%${k}%`),
  ]);
  const { data: text_hits } = await supabase
    .from("contacts")
    .select(SLIM_FIELDS)
    .or(text_filters.join(","))
    .order("contact_quality", { ascending: false, nullsFirst: false })
    .limit(300);

  // Topics array search (Postgres overlaps + case-insensitive in-app filter)
  const { data: topic_exact } = await supabase
    .from("contacts")
    .select(SLIM_FIELDS)
    .overlaps("topics", all_terms)
    .limit(200);

  const { data: all_with_topics } = await supabase
    .from("contacts")
    .select(SLIM_FIELDS)
    .not("topics", "is", null)
    .limit(2000);
  const topic_fuzzy = as_contacts(all_with_topics).filter((c) =>
    c.topics?.some((t) => {
      const tl = t.toLowerCase();
      return all_terms.some((term) => tl.includes(term));
    })
  );

  let candidates = unique_by_id([
    ...as_contacts(text_hits),
    ...as_contacts(topic_exact),
    ...topic_fuzzy,
  ]);

  // For role queries with few keyword hits, supplement with top-quality contacts
  if (expanded.is_role_query && candidates.length < 50) {
    const { data: quality_contacts } = await supabase
      .from("contacts")
      .select(SLIM_FIELDS)
      .order("contact_quality", { ascending: false, nullsFirst: false })
      .limit(100);
    candidates = unique_by_id([...candidates, ...as_contacts(quality_contacts)]);
  }

  return candidates.slice(0, 250);
}

function sort_contacts_three_stars_first<T extends Partial<Contact>>(contacts: T[]): T[] {
  return [...contacts].sort((a, b) =>
    (b.contact_quality ?? 0) - (a.contact_quality ?? 0) ||
    String(a.name ?? "").localeCompare(String(b.name ?? ""))
  );
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
    const results = sort_contacts_three_stars_first(
      data.map((c: Contact) => ({
        ...c,
        relevance: c.follow_up_note ?? "Marked for follow-up",
      }))
    );
    return { type: "contacts", results };
  }

  // Ask Claude to expand the query like a human would think about it
  const expanded = await expand_query(input);

  // Fetch candidates using the expanded terms
  const candidates = await get_candidates(expanded);
  if (candidates.length === 0) return { type: "contacts", results: [] };

  // For pure location queries (no role component), return DB results directly
  if (!expanded.is_role_query && expanded.location_terms.length > 0) {
    const all_terms = [...expanded.search_terms, ...expanded.location_terms];
    return { type: "contacts", results: rank_direct_contacts(candidates, all_terms) };
  }

  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: `You are a personal network assistant. The user is searching for people in their network.

Query: "${input}"

CRITICAL RULES:
- Understand the INTENT of the query, not just keywords. "Human resources" means people who work in HR/people ops — NOT anyone whose company has the word "human" in it. "Sports media" means people in sports journalism/broadcasting — not just anyone in sports or anyone in media.
- "HR" = human resources. "AI" = artificial intelligence. "VC" = venture capital. Understand abbreviations.
- Only return contacts whose role, company, industry, or expertise ACTUALLY matches what the user is looking for.
- Be INCLUSIVE — if someone could plausibly work in the space, include them. A VP of Content at a sports company counts for "sports media." A journalist who covers athletics counts. Cast a wide net, then rank by relevance.
- contact_quality 3 = real relationship, prefer strongly; 1 = noise, surface last
- If you find even 1 relevant contact, return them. Only return an empty array if truly ZERO contacts are relevant.
- Return up to 15 results

Contacts to evaluate (${candidates.length} candidates):
${JSON.stringify(candidates.map(c => ({ id: c.id, name: c.name, role: c.role, company: c.company, city: c.city, topics: c.topics, contact_quality: c.contact_quality })))}

Return ONLY a valid JSON array:
[{ "id": "...", "name": "...", "company": "...", "role": "...", "city": "...", "country": "...", "contact_quality": 0, "topics": [], "follow_up": false, "relevance": "one sentence on why this person specifically matches the query" }]`,
    }],
  });

  const raw = res.content[0].type === "text" ? res.content[0].text : "[]";
  const results = sort_contacts_three_stars_first(
    parse_json_array<Partial<Contact> & { relevance?: string }>(raw)
  );
  return { type: "contacts", results };
}

async function handle_query_signals(input: string) {
  const supabase = getSupabase();
  const search_terms = extract_contact_search_terms(input);

  let all: Signal[] = [];

  if (search_terms.length > 0) {
    const text_filters = search_terms.flatMap((word) =>
      SIGNAL_SEARCH_FIELDS.map((field) => `${field}.ilike.%${word}%`)
    );
    const { data: text_matches } = await supabase
      .from("signals")
      .select("id,summary,topics,source_title,captured_at")
      .or(text_filters.join(","))
      .order("captured_at", { ascending: false })
      .limit(120);

    const { data: topic_matches } = await supabase
      .from("signals")
      .select("id,summary,topics,source_title,captured_at")
      .overlaps("topics", search_terms)
      .order("captured_at", { ascending: false })
      .limit(120);

    // The DB array overlap is case-sensitive, so add a bounded app-side fallback.
    const { data: topic_candidates } = await supabase
      .from("signals")
      .select("id,summary,topics,source_title,captured_at")
      .order("captured_at", { ascending: false })
      .limit(1000);
    const case_insensitive_topics = as_signals(topic_candidates).filter((signal) =>
      signal.topics?.some((topic) => {
        const normalized = topic.toLowerCase();
        return search_terms.some((term) => normalized.includes(term));
      }) ?? false
    );

    all = unique_by_id([
      ...as_signals(text_matches),
      ...as_signals(topic_matches),
      ...case_insensitive_topics,
    ]).slice(0, 200);
  }

  if (all.length === 0) {
    // Fallback: recent 200 signals — Claude ranks from this candidate set.
    const { data: recent } = await supabase
      .from("signals")
      .select("id,summary,topics,source_title,captured_at")
      .order("captured_at", { ascending: false })
      .limit(200);
    all = as_signals(recent);
  }

  if (all.length === 0) return { type: "signals", results: [] };

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
  let ranked = parse_json_array<Partial<Signal> & { relevance?: string }>(rank_raw);

  // Fetch full records for the matched IDs (source_url not included in candidate query)
  const ids = ranked.map((r) => r.id).filter(Boolean);
  if (ids.length === 0) return { type: "signals", results: [] };
  const { data: full } = await supabase.from("signals").select("*").in("id", ids);
  const by_id = Object.fromEntries((full ?? []).map((s: Signal) => [s.id, s]));
  ranked = ranked.map((r) => ({ ...by_id[r.id as string], relevance: r.relevance }));

  return { type: "signals", results: ranked };
}

async function handle_query_combined(input: string) {
  const supabase = getSupabase();

  // Run signals + contacts fetch in parallel
  const terms = extract_contact_search_terms(input);

  const signal_filters = terms.map((t) => `summary.ilike.%${t}%`);
  const contact_filters = terms.flatMap((t) => [
    `name.ilike.%${t}%`,
    ...SEARCH_FIELDS.map((f) => `${f}.ilike.%${t}%`),
  ]);

  const [signal_res, contact_res] = await Promise.all([
    supabase
      .from("signals")
      .select("id,summary,topics,source_title,source_url,captured_at")
      .or(signal_filters.length > 0 ? signal_filters.join(",") : "id.neq.00000000-0000-0000-0000-000000000000")
      .order("captured_at", { ascending: false })
      .limit(50),
    supabase
      .from("contacts")
      .select(SLIM_FIELDS)
      .or(contact_filters.length > 0 ? contact_filters.join(",") : "id.neq.00000000-0000-0000-0000-000000000000")
      .order("contact_quality", { ascending: false, nullsFirst: false })
      .limit(100),
  ]);

  const raw_signals = signal_res.data ?? [];
  const raw_contacts = as_contacts(contact_res.data);

  // Single Claude call — think like a brain, not a library
  const synthesis_res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: `You are Cortex — the user's personal synthesis engine and thinking partner. You have read everything they have saved and you know everyone in their network.

The user is asking: "${input}"

Everything they have saved on this topic:
${JSON.stringify(raw_signals, null, 2)}

People in their network (pre-filtered as relevant):
${JSON.stringify(raw_contacts, null, 2)}

Your job is to synthesize, not summarize. Think across the full set of saved material and form a real point of view.

Rules:
- Do NOT produce a source-by-source summary
- Do NOT merely list recurring themes
- Identify the deepest recurring patterns
- Find non-obvious connections across items
- Notice contradictions, edge cases, and second-order effects
- Separate durable signal from hype, repetition, and noise
- Form a real judgment
- If the material is too thin or contradictory, say so
- Use plain, sharp English — no consultant phrasing
- If a conclusion is an inference, label it as an inference

Return ONLY valid JSON with exactly this structure:
{
  "core_thesis": "1 tight paragraph answering: what do these materials collectively suggest is true?",
  "point_of_view": [
    "specific, non-generic, judgmental insight grounded in the material",
    "specific, non-generic, judgmental insight grounded in the material",
    "specific, non-generic, judgmental insight grounded in the material",
    "specific, non-generic, judgmental insight grounded in the material"
  ],
  "implications": [
    "what this means for operators and builders",
    "what this means for investors and strategists",
    "what this means about timing or market direction"
  ],
  "tensions": [
    "what does not fully fit the thesis",
    "where the evidence conflicts",
    "what could make this synthesis wrong"
  ],
  "missing_information": [
    "important question the material does not answer",
    "important question the material does not answer",
    "important question the material does not answer"
  ],
  "takeaway": "one crisp sentence — the most memorable version of the thesis",
  "hot_take": "a stronger, more provocative version of the same conclusion",
  "next_move": "the single most important action right now — what to decide, find out, or who to call first and why",
  "contact_ids": ["up to 5 contact IDs in priority order — only people who genuinely matter for THIS question"],
  "contact_notes": { "contact_id": "one sharp sentence on WHY this person specifically — not their title, but what they unlock for this question" },
  "signal_ids": ["up to 4 signal IDs that most informed your view — the evidence behind the thesis, not a reading list"]
}

If the saved items span multiple unrelated subtopics, name the clusters briefly in core_thesis, synthesize the dominant one, and note whether the collection is coherent enough for a single POV.`,
    }],
  });

  const raw = synthesis_res.content[0].type === "text" ? synthesis_res.content[0].text : "{}";
  const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  let parsed: {
    core_thesis: string;
    point_of_view: string[];
    implications: string[];
    tensions: string[];
    missing_information: string[];
    takeaway: string;
    hot_take: string;
    next_move: string;
    contact_ids: string[];
    contact_notes: Record<string, string>;
    signal_ids: string[];
  };
  try { parsed = JSON.parse(clean); } catch { return { type: "error", message: "Could not synthesize results." }; }

  // Fetch full signal records for matched IDs
  const sig_by_id = Object.fromEntries(raw_signals.map((s) => [s.id, s]));
  const signals = (parsed.signal_ids ?? []).map((id) => sig_by_id[id]).filter(Boolean);

  // Fetch full contact records for matched IDs — in priority order
  const { data: full_contacts } = await supabase.from("contacts").select("*").in("id", parsed.contact_ids ?? []);
  const contact_map = Object.fromEntries((full_contacts ?? []).map((c: Contact) => [c.id, c]));
  const contacts = (parsed.contact_ids ?? [])
    .map((id) => contact_map[id])
    .filter(Boolean)
    .map((c: Contact) => ({ ...c, relevance: parsed.contact_notes?.[c.id] ?? null }));

  return {
    type: "combined",
    core_thesis: parsed.core_thesis,
    point_of_view: parsed.point_of_view ?? [],
    implications: parsed.implications ?? [],
    tensions: parsed.tensions ?? [],
    missing_information: parsed.missing_information ?? [],
    takeaway: parsed.takeaway,
    hot_take: parsed.hot_take,
    next_move: parsed.next_move,
    signals,
    contacts,
  };
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

async function handle_bulk_update(input: string) {
  // Determine what update to apply from the directive in the input
  const updates: UpdatePayload = {};
  if (/follow.?up|mark|remind|reach out|ping/i.test(input)) {
    updates.follow_up = true;
    updates.follow_up_note = "Marked for follow-up";
  } else if (/done|spoke|talked|called|caught up|followed up|clear|remove/i.test(input)) {
    updates.follow_up = false;
  }

  // Ask Claude to pull just the names out of the list
  const name_res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: `Extract only the person names from this input. Ignore email addresses, companies, dates, and instructions.

Input: "${input}"

Return ONLY a valid JSON array of name strings, e.g.: ["John Smith", "Jane Doe"]`,
    }],
  });

  const raw = name_res.content[0].type === "text" ? name_res.content[0].text : "[]";
  const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  let names: string[] = [];
  try { names = JSON.parse(clean); } catch { return { type: "error", message: "Could not parse names from that input." }; }
  if (!Array.isArray(names) || names.length === 0) return { type: "error", message: "Could not find any names to update." };

  const updated: string[] = [];
  const not_found: string[] = [];
  const action = updates.follow_up === true ? "Marked for follow-up" : updates.follow_up === false ? "Cleared follow-up" : "Updated";

  for (const name of names) {
    const result = await apply_contact_update(name.trim(), updates, action);
    if (result.ok) { updated.push(result.contact.name); }
    else { not_found.push(name); }
  }

  const summary = [
    updated.length > 0 ? `${action}: ${updated.length} contact${updated.length > 1 ? "s" : ""}` : null,
    not_found.length > 0 ? `Not found: ${not_found.join(", ")}` : null,
  ].filter(Boolean).join(" · ");

  return { type: "updated_bulk", updated, not_found, action: summary };
}

async function handle_update_contact(input: string, contact_id?: string) {
  // Bulk mode: 3+ non-empty lines = multiple contacts
  const lines = input.trim().split(/\n+/).filter((s) => s.trim().length > 0);
  if (lines.length >= 3) {
    return await handle_bulk_update(input);
  }

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

  // Enforce follow-up flag regardless of Claude's parse — don't trust inference for data mutations
  if (/\bfollow.?up\b|\breach out\b|\bping\b|\bneed to (call|email|text)\b/i.test(input)) {
    parsed.updates.follow_up = true;
    if (!parsed.updates.follow_up_note) {
      parsed.updates.follow_up_note = "Marked for follow-up";
    }
  } else if (/\b(done|spoke|talked|called|texted|emailed|caught up|followed up|clear follow.?up|remove follow.?up)\b/i.test(input)) {
    // Clear the follow-up flag when user says they've done it
    parsed.updates.follow_up = false;
    parsed.updates.follow_up_note = undefined;
  }

  // If the caller already resolved a clarify prompt, apply directly by ID — skip name matching
  if (contact_id) {
    const result = await apply_contact_update_by_id(contact_id, parsed.updates, parsed.action);
    if (!result.ok) return { type: "error", message: result.clarify ? "Unexpected clarify" : result.error };
    return { type: "updated", action: result.action, contact: result.contact };
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
  const today = new Date().toISOString().split("T")[0];
  const parse_res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [{
      role: "user",
      content: `Extract contact details from this input. There may be one contact or many.
Today is ${today}.

Input: "${input}"

Return ONLY a valid JSON array (even for a single contact).
Omit fields that are null — only include fields with actual values:
[{ "name": "required", "email": "if present", "role": "if present", "company": "if present", "city": "if present", "last_meaningful_contact": "YYYY-MM-DD if date mentioned" }]`,
    }],
  });

  const raw = parse_res.content[0].type === "text" ? parse_res.content[0].text : "[]";
  const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  let parsed: Partial<Contact>[];
  try {
    parsed = JSON.parse(clean);
  } catch {
    // Partial recovery: JSON may be truncated — extract every complete {...} object
    const objects = [...clean.matchAll(/\{[^{}]+\}/g)].flatMap((m) => {
      try { return [JSON.parse(m[0])]; } catch { return []; }
    });
    if (objects.length === 0) return { type: "error", message: "Could not parse contact details." };
    parsed = objects;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { type: "error", message: "Could not identify any contacts." };

  const wants_follow_up = /\bfollow.?up\b|\breach out\b|\bping\b/i.test(input);

  const rows = parsed
    .filter((p) => !!p.name)
    .map((p) => {
      // Validate enums per row
      const strength = ["strong", "medium", "light"].includes(p.relationship_strength ?? "") ? p.relationship_strength : null;
      const quality = [1, 2, 3].includes(p.contact_quality ?? 0) ? p.contact_quality : null;
      return {
        name: p.name!,
        role: p.role ?? null,
        company: p.company ?? null,
        city: p.city ?? null,
        country: p.country ?? null,
        email: p.email ?? null,
        topics: p.topics ?? null,
        notes: p.notes ?? null,
        relationship_strength: strength ?? null,
        contact_quality: quality ?? null,
        how_you_know_them: p.how_you_know_them ?? null,
        last_meaningful_contact: p.last_meaningful_contact ?? null,
        follow_up: wants_follow_up,
        follow_up_note: wants_follow_up ? "Marked for follow-up" : null,
      };
    });

  if (rows.length === 0) return { type: "error", message: "Could not identify any names." };

  // Skip rows whose email already exists in the DB to avoid unique constraint errors
  const emails_to_check = rows.map((r) => r.email).filter(Boolean) as string[];
  let existing_emails = new Set<string>();
  if (emails_to_check.length > 0) {
    const { data: existing } = await getSupabase()
      .from("contacts")
      .select("email")
      .in("email", emails_to_check);
    existing_emails = new Set((existing ?? []).map((c: { email: string }) => c.email?.toLowerCase()));
  }
  const new_rows = rows.filter((r) => !r.email || !existing_emails.has(r.email.toLowerCase()));
  const skipped = rows.length - new_rows.length;

  if (new_rows.length === 0) {
    return { type: "error", message: `All ${rows.length} contact${rows.length > 1 ? "s" : ""} already exist.` };
  }

  const { data, error } = await getSupabase().from("contacts").insert(new_rows).select();
  if (error) return { type: "error", message: error.message };

  const skip_note = skipped > 0 ? ` (${skipped} already existed, skipped)` : "";
  if (data.length === 1) {
    return { type: "added", contact: data[0] };
  }
  return {
    type: "added_bulk",
    contacts: data,
    action: `Added ${data.length} contact${data.length > 1 ? "s" : ""}${skip_note}`,
  };
}

// ── Log interaction handler ───────────────────────────────────────────────────

async function handle_log_interaction(input: string, contact_id?: string) {
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  const parse_res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [{
      role: "user",
      content: `Parse this personal note about an interaction with someone in my network.
Today: ${today}
Yesterday: ${yesterday}

Input: "${input}"

Return ONLY valid JSON:
{
  "contact_name": "the person's name",
  "summary": "one sentence: what happened in this interaction",
  "topics": ["2-4 relevant topic tags"],
  "date": "YYYY-MM-DD — infer from 'today', 'yesterday', 'this morning' etc., default to today"
}`,
    }],
  });

  const raw = parse_res.content[0].type === "text" ? parse_res.content[0].text : "{}";
  const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();

  let parsed: { contact_name: string; summary: string; topics: string[]; date: string };
  try { parsed = JSON.parse(clean); }
  catch { return { type: "error", message: "Could not parse that interaction." }; }

  if (!parsed.contact_name?.trim()) {
    return { type: "error", message: "Could not identify who this interaction was with." };
  }

  const supabase = getSupabase();
  let resolved_contact;

  if (contact_id) {
    const result = await apply_contact_update_by_id(
      contact_id,
      { last_meaningful_contact: parsed.date },
      `Logged interaction`,
    );
    if (!result.ok) return { type: "error", message: result.clarify ? "Unexpected clarify" : result.error };
    resolved_contact = result.contact;
  } else {
    const result = await apply_contact_update(
      parsed.contact_name,
      { last_meaningful_contact: parsed.date },
      `Logged interaction with ${parsed.contact_name}`,
    );
    if (!result.ok && result.clarify) {
      return { type: "clarify", message: `Multiple contacts match "${parsed.contact_name}". Which one?`, candidates: result.candidates };
    }
    if (!result.ok) return { type: "error", message: !result.clarify ? result.error : "Unknown error" };
    resolved_contact = result.contact;
  }

  const { data: interaction, error } = await supabase
    .from("interactions")
    .insert({
      contact_id: resolved_contact.id,
      date: parsed.date,
      source: "manual",
      raw_content: input.trim(),
      summary: parsed.summary,
      topics: parsed.topics,
    })
    .select()
    .single();

  if (error) return { type: "error", message: error.message };

  return {
    type: "logged",
    interaction,
    contact: resolved_contact,
    action: parsed.summary,
  };
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

  // Limit to 500 — Claude can fuzzy match within this set; full table is wasteful
  const { data: contacts } = await getSupabase()
    .from("contacts")
    .select("id, name, email")
    .order("name")
    .limit(500);

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
  query_contacts:  "Searching your contacts...",
  query_signals:   "Searching your brain...",
  query_combined:  "Connecting your research and contacts...",
  ingest_signal:   "Saving to your brain...",
  update_contact:  "Updating contact...",
  add_contact:     "Adding contact...",
  log_interaction: "Logging interaction...",
};

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const body = await request.json().catch(() => ({}));

  // Validate: must have either image or text input
  const { file_data, file_type, input, contact_id } = body;
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
          case "query_combined": send(await handle_query_combined(input)); break;
          case "ingest_signal":   send(await handle_ingest_signal(input)); break;
          case "update_contact":  send(await handle_update_contact(input, contact_id)); break;
          case "add_contact":     send(await handle_add_contact(input)); break;
          case "log_interaction": send(await handle_log_interaction(input, contact_id)); break;
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
