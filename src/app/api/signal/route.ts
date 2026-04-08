import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "@/lib/supabase";
import { Signal } from "@/lib/types";

const anthropic = new Anthropic();

// Returns true if the string looks like a standalone URL
function is_url(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Extracts YouTube video ID from any URL format
function extract_youtube_id(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

// Fetches YouTube transcript via Supadata API (works from cloud IPs)
async function fetch_youtube_transcript(video_id: string): Promise<string | null> {
  const api_key = process.env.SUPADATA_API_KEY;
  if (!api_key) return null;

  try {
    const res = await fetch(
      `https://api.supadata.ai/v1/youtube/transcript?videoId=${video_id}&text=true`,
      {
        headers: { "x-api-key": api_key },
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    // Supadata returns { content: "full transcript text", ... }
    return data.content ?? data.transcript ?? null;
  } catch {
    return null;
  }
}

// Fetches an article via Jina Reader — handles JS-heavy sites, returns clean markdown
async function fetch_article(url: string): Promise<{ title: string | null; text: string } | null> {
  try {
    const jina_url = `https://r.jina.ai/${url}`;
    const res = await fetch(jina_url, {
      headers: { "Accept": "text/plain" },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return null;

    const raw = await res.text();
    if (!raw || raw.length < 100) return null;

    // Jina returns "Title: ...\nURL: ...\n\n[content]" — extract title if present
    const title_match = raw.match(/^Title:\s*(.+)/m);
    const title = title_match ? title_match[1].trim() : null;

    // Trim to ~8000 chars to stay within Claude token budget
    const text = raw.slice(0, 8000);
    return { title, text };
  } catch {
    return null;
  }
}

// Enriches raw input — fetches content for URLs, transcripts for YouTube
async function enrich_input(raw: string): Promise<{ content: string; source_url: string | null; source_title: string | null }> {
  const trimmed = raw.trim();

  // Only attempt fetch if the entire input is a URL (not a URL mixed with text)
  if (!is_url(trimmed)) {
    return { content: trimmed, source_url: null, source_title: null };
  }

  // YouTube: use Supadata API (works from cloud IPs, Jina doesn't get transcripts)
  const video_id = extract_youtube_id(trimmed);
  if (video_id) {
    const transcript = await fetch_youtube_transcript(video_id);
    if (transcript) {
      return {
        content: `YouTube video URL: ${trimmed}\n\nTranscript:\n${transcript}`,
        source_url: trimmed,
        source_title: null,
      };
    }
    return {
      content: `YouTube video URL: ${trimmed}\n\n(Transcript unavailable — video may be private or have captions disabled.)`,
      source_url: trimmed,
      source_title: null,
    };
  }

  // Articles and all other URLs go through Jina Reader
  const article = await fetch_article(trimmed);
  if (article) {
    return {
      content: `Article URL: ${trimmed}\nTitle: ${article.title ?? "Unknown"}\n\nContent:\n${article.text}`,
      source_url: trimmed,
      source_title: article.title,
    };
  }

  // URL fetch failed — save the URL itself with a note
  return {
    content: `URL: ${trimmed}\n\n(Could not fetch content — page may require login or block scrapers. Paste the article text directly for better results.)`,
    source_url: trimmed,
    source_title: null,
  };
}

// ── POST — ingest new signal ─────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const { raw_input } = await request.json();

    if (!raw_input?.trim()) {
      return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
    }

    // Enrich input — fetches article text or YouTube transcript if URL detected
    const { content: enriched_content, source_url: detected_url, source_title: detected_title } =
      await enrich_input(raw_input);

    // Ask Claude to extract knowledge from whatever was pasted
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `You are a personal knowledge assistant. Extract the core knowledge from this input and return ONLY valid JSON, no other text.

Input:
${enriched_content}

Return:
{
  "summary": "2-3 sentences capturing the actual insight or knowledge — not what the piece is about, but what it says or means. Write as if explaining to yourself why this matters.",
  "topics": ["3-6 specific topic tags — concrete, not generic. e.g. 'creator-monetization', 'trust-graphs', 'sports-media-distribution' not 'media' or 'business'"],
  "source_title": "title of the article/video/newsletter if identifiable, otherwise null",
  "source_url": "URL if present in the input, otherwise null"
}`,
        },
      ],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
    const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();

    let parsed: {
      summary: string;
      topics: string[];
      source_title: string | null;
      source_url: string | null;
    };

    try {
      parsed = JSON.parse(clean);
    } catch {
      return NextResponse.json(
        { error: "Could not process that input. Try again." },
        { status: 500 }
      );
    }

    const { data, error } = await getSupabase()
      .from("signals")
      .insert({
        summary: parsed.summary,
        topics: parsed.topics,
        // Prefer detected title (from actual page fetch), then Claude's, then null
        source_title: detected_title ?? parsed.source_title,
        // Prefer Claude's extracted URL, fall back to what we detected
        source_url: parsed.source_url ?? detected_url,
        raw_input: raw_input.trim(),
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, signal: data });
  } catch (err) {
    console.error("Signal ingest error:", err);
    return NextResponse.json(
      { error: "Ingest failed", details: String(err) },
      { status: 500 }
    );
  }
}

// ── GET — query signals ──────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get("q");
    const supabase = getSupabase();

    // No query — return recent signals
    if (!q?.trim()) {
      const { data, error } = await supabase
        .from("signals")
        .select("*")
        .order("captured_at", { ascending: false })
        .limit(20);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ signals: data });
    }

    // With query — pull all signals and let Claude rank/filter
    const { data: all } = await supabase
      .from("signals")
      .select("*")
      .order("captured_at", { ascending: false });

    if (!all || all.length === 0) {
      return NextResponse.json({ signals: [] });
    }

    const rankResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `You are a personal knowledge assistant. Given a question and a list of saved knowledge items, return the most relevant ones.

Question: "${q}"

Saved knowledge:
${JSON.stringify(all.map((s: Signal) => ({
  id: s.id,
  summary: s.summary,
  topics: s.topics,
  source_title: s.source_title,
  captured_at: s.captured_at,
})), null, 2)}

Return ONLY a valid JSON array of the most relevant items, ranked by relevance. Include up to 8. Add a "relevance" field explaining the connection in one sentence.

[
  {
    "id": "uuid",
    "summary": "...",
    "topics": [...],
    "source_title": "...",
    "captured_at": "...",
    "relevance": "why this is relevant to the question"
  }
]

Only include items that genuinely relate to the question. Return fewer if needed.`,
        },
      ],
    });

    const rankRaw = rankResponse.content[0].type === "text" ? rankResponse.content[0].text : "[]";
    const rankClean = rankRaw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();

    let results;
    try {
      results = JSON.parse(rankClean);
    } catch {
      const match = rankClean.match(/\[[\s\S]*\]/);
      results = match ? JSON.parse(match[0]) : [];
    }

    return NextResponse.json({ signals: results });
  } catch (err) {
    console.error("Signal query error:", err);
    return NextResponse.json(
      { error: "Query failed", details: String(err) },
      { status: 500 }
    );
  }
}
