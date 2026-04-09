import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources";
import { getSupabase } from "@/lib/supabase";
import { Signal } from "@/lib/types";
import { enrich_input } from "@/lib/enrich";

const anthropic = new Anthropic();

const EXTRACT_PROMPT = (context?: string) => `You are a personal knowledge assistant. Extract the core knowledge from this input and return ONLY valid JSON, no other text.
${context ? `\nContext note: ${context}\n` : ""}
Return:
{
  "summary": "2-3 sentences capturing the actual insight or knowledge — not what the piece is about, but what it says or means. Write as if explaining to yourself why this matters.",
  "topics": ["3-6 specific topic tags — concrete, not generic. e.g. 'creator-monetization', 'trust-graphs', 'sports-media-distribution' not 'media' or 'business'"],
  "source_title": "title of the article/document/video if identifiable, otherwise null",
  "source_url": "URL if present in the input, otherwise null"
}`;

// Handles PDF files via Claude's native document block
async function ingest_pdf(file_data: string, file_name: string, context?: string) {
  return anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: file_data },
          } as ContentBlockParam,
          { type: "text", text: EXTRACT_PROMPT(context) },
        ] as ContentBlockParam[],
      },
    ],
  });
}

// ── POST — ingest new signal ─────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { raw_input, file_data, file_type, file_name, context } = body;

    // ── File upload path ────────────────────────────────────────────────────
    if (file_data || file_type || file_name) {
      if (!file_data || !file_type || !file_name) {
        return NextResponse.json(
          { error: "file_data, file_type, and file_name are all required for file uploads" },
          { status: 400 }
        );
      }

      let response;
      let stored_raw: string;

      if (file_type === "application/pdf") {
        response = await ingest_pdf(file_data, file_name, context);
        stored_raw = `[PDF] ${file_name}${context ? ` — ${context}` : ""}`;
      } else {
        const decoded = Buffer.from(file_data, "base64").toString("utf-8");
        const truncated = decoded.slice(0, 8000);
        response = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 512,
          messages: [{ role: "user", content: `${EXTRACT_PROMPT(context)}\n\nInput:\n${truncated}` }],
        });
        stored_raw = `[${file_name}] ${truncated.slice(0, 500)}`;
      }

      const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
      const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
      let parsed: { summary: string; topics: string[]; source_title: string | null; source_url: string | null };
      try {
        parsed = JSON.parse(clean);
      } catch {
        return NextResponse.json({ error: "Could not process that file. Try again." }, { status: 500 });
      }

      const { data, error } = await getSupabase()
        .from("signals")
        .insert({
          summary: parsed.summary,
          topics: parsed.topics,
          source_title: parsed.source_title ?? file_name,
          source_url: parsed.source_url ?? null,
          raw_input: stored_raw,
        })
        .select()
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, signal: data });
    }

    // ── Text / URL path ─────────────────────────────────────────────────────
    if (!raw_input?.trim()) {
      return NextResponse.json({ error: "raw_input is required" }, { status: 400 });
    }
    if (raw_input.length > 50000) {
      return NextResponse.json({ error: "Input too long (max 50 000 characters)" }, { status: 400 });
    }

    const { content: enriched, source_url: detected_url, source_title: detected_title } =
      await enrich_input(raw_input);

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      messages: [{
        role: "user",
        content: `You are a personal knowledge assistant. Extract the core knowledge from this input and return ONLY valid JSON, no other text.

Input:
${enriched}

Return:
{
  "summary": "2-3 sentences capturing the actual insight or knowledge — not what the piece is about, but what it says or means. Write as if explaining to yourself why this matters.",
  "topics": ["3-6 specific topic tags — concrete, not generic. e.g. 'creator-monetization', 'trust-graphs', 'sports-media-distribution' not 'media' or 'business'"],
  "source_title": "title of the article/video/newsletter if identifiable, otherwise null",
  "source_url": "URL if present in the input, otherwise null"
}`,
      }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
    const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    let parsed: { summary: string; topics: string[]; source_title: string | null; source_url: string | null };
    try {
      parsed = JSON.parse(clean);
    } catch {
      return NextResponse.json({ error: "Could not process that input. Try again." }, { status: 500 });
    }

    const { data, error } = await getSupabase()
      .from("signals")
      .insert({
        summary: parsed.summary,
        topics: parsed.topics,
        source_title: detected_title ?? parsed.source_title,
        source_url: parsed.source_url ?? detected_url,
        raw_input: raw_input.trim(),
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, signal: data });
  } catch (err) {
    console.error("Signal ingest error:", err);
    return NextResponse.json({ error: "Ingest failed", details: String(err) }, { status: 500 });
  }
}

// ── GET — query signals ──────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get("q");
    const supabase = getSupabase();

    if (!q?.trim()) {
      const { data, error } = await supabase
        .from("signals")
        .select("*")
        .order("captured_at", { ascending: false })
        .limit(20);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ signals: data });
    }

    // Pre-filter: most recent 200 signals only — Claude ranks the candidates
    const { data: all } = await supabase
      .from("signals")
      .select("*")
      .order("captured_at", { ascending: false })
      .limit(200);

    if (!all || all.length === 0) return NextResponse.json({ signals: [] });

    const rank_res = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: `You are a personal knowledge assistant. Find the most relevant saved knowledge items.

Question: "${q}"

Saved knowledge: ${JSON.stringify(all.map((s: Signal) => ({ id: s.id, summary: s.summary, topics: s.topics, source_title: s.source_title, captured_at: s.captured_at })), null, 2)}

Return ONLY a valid JSON array, up to 8 results:
[{ "id": "...", "summary": "...", "topics": [...], "source_title": "...", "captured_at": "...", "relevance": "one sentence why relevant" }]

Only include genuinely relevant items.`,
      }],
    });

    const rank_raw = rank_res.content[0].type === "text" ? rank_res.content[0].text : "[]";
    const rank_clean = rank_raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    let ranked: (Signal & { relevance?: string })[] = [];
    try { ranked = JSON.parse(rank_clean); } catch { const m = rank_clean.match(/\[[\s\S]*\]/); ranked = m ? JSON.parse(m[0]) : []; }

    const by_id = Object.fromEntries((all as Signal[]).map((s) => [s.id, s]));
    ranked = ranked.map((r) => ({ ...by_id[r.id], relevance: r.relevance }));
    return NextResponse.json({ signals: ranked });
  } catch (err) {
    console.error("Signal query error:", err);
    return NextResponse.json({ error: "Query failed", details: String(err) }, { status: 500 });
  }
}
