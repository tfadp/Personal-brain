// Canonical URL enrichment — used by signal and unified routes.
// Fetches article text (Jina Reader) or YouTube transcripts (Supadata).

export function is_url(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function extract_youtube_id(url: string): string | null {
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

async function fetch_article(url: string): Promise<{ title: string | null; text: string } | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/plain" },
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

export interface EnrichedInput {
  content: string;
  source_url: string | null;
  source_title: string | null;
}

/**
 * Enriches a raw text input for ingestion.
 * - Standalone URL → fetch article text or YouTube transcript
 * - Plain text → returned as-is
 */
export async function enrich_input(raw: string): Promise<EnrichedInput> {
  const trimmed = raw.trim();

  if (!is_url(trimmed)) {
    return { content: trimmed, source_url: null, source_title: null };
  }

  const video_id = extract_youtube_id(trimmed);
  if (video_id) {
    const transcript = await fetch_youtube_transcript(video_id);
    return {
      content: transcript
        ? `YouTube video URL: ${trimmed}\n\nTranscript:\n${transcript}`
        : `YouTube video URL: ${trimmed}\n\n(Transcript unavailable.)`,
      source_url: trimmed,
      source_title: null,
    };
  }

  const article = await fetch_article(trimmed);
  if (article) {
    return {
      content: `Article URL: ${trimmed}\nTitle: ${article.title ?? "Unknown"}\n\nContent:\n${article.text}`,
      source_url: trimmed,
      source_title: article.title,
    };
  }

  return {
    content: `URL: ${trimmed}\n\n(Could not fetch — paste the article text directly.)`,
    source_url: trimmed,
    source_title: null,
  };
}
