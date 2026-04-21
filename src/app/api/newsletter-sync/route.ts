import { NextResponse } from "next/server";
import { google } from "googleapis";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "@/lib/supabase";

const anthropic = new Anthropic();

// ── Newsletter sender config ──────────────────────────────────────────────────

interface NewsletterSender {
  email: string;
  label: string;
  // Which Gmail account receives this newsletter: "gmail" or "dan"
  account: "gmail" | "dan";
  // Custom extraction instructions for this sender (null = standard)
  instructions: string | null;
  // If true, one email may yield multiple signals (one per item)
  multi_signal: boolean;
}

const SENDERS: NewsletterSender[] = [
  // ── dan@juddporter.com account ──
  {
    email: "afterschool@substack.com",
    label: "After School (Substack)",
    account: "dan",
    instructions: null,
    multi_signal: false,
  },
  {
    email: "list@ben-evans.com",
    label: "Ben Evans",
    account: "dan",
    instructions: null,
    multi_signal: false,
  },
  {
    email: "hi@www.garbageday.email",
    label: "Garbage Day",
    account: "dan",
    instructions: null,
    multi_signal: false,
  },
  {
    email: "portfolio@juddporter.com",
    label: "Judd Porter Portfolio",
    account: "dan",
    instructions: `This email contains multiple podcast summaries plus unrelated content (Eagles news, stock prices).
IGNORE all sports scores, stock prices, Eagles football news, and financial market data.
EXTRACT ONLY the podcast summaries. Each podcast summary is a separate insight.
For each podcast: capture the core argument or idea discussed, not just the title.`,
    multi_signal: true,
  },
  // ── juddporter@gmail.com account ──
  {
    email: "dan@tldrnewsletter.com",
    label: "TLDR",
    account: "gmail",
    instructions: null,
    multi_signal: false,
  },
  {
    email: "superhuman@mail.joinsuperhuman.ai",
    label: "Superhuman AI",
    account: "gmail",
    instructions: null,
    multi_signal: false,
  },
  {
    email: "news@daily.therundown.ai",
    label: "The Rundown AI",
    account: "gmail",
    instructions: null,
    multi_signal: false,
  },
  {
    email: "aiadopters@substack.com",
    label: "AI Adopters (Substack)",
    account: "gmail",
    instructions: null,
    multi_signal: false,
  },
  {
    email: "buildtolaunch@substack.com",
    label: "Build to Launch (Substack)",
    account: "gmail",
    instructions: null,
    multi_signal: false,
  },
  {
    email: "hi@simple.ai",
    label: "Simple AI",
    account: "gmail",
    instructions: null,
    multi_signal: false,
  },
];

// ── Gmail auth — supports two accounts ───────────────────────────────────────

function get_gmail_client(account: "gmail" | "dan") {
  const client_id     = process.env.GMAIL_CLIENT_ID;
  const client_secret = process.env.GMAIL_CLIENT_SECRET;
  const refresh_token = account === "dan"
    ? process.env.GMAIL_REFRESH_TOKEN_DAN
    : process.env.GMAIL_REFRESH_TOKEN;

  if (!client_id || !client_secret) {
    throw new Error("Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET.");
  }
  if (!refresh_token) {
    // Non-fatal — skip this account's senders, don't crash the whole sync
    return null;
  }

  const auth = new google.auth.OAuth2(client_id, client_secret);
  auth.setCredentials({ refresh_token });
  return google.gmail({ version: "v1", auth });
}

// ── Email parsing helpers ─────────────────────────────────────────────────────

function decode_base64url(s: string): string {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function strip_html(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{3,}/g, "\n\n")
    .trim();
}

function extract_body(payload: {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: typeof payload[];
}): string {
  // Prefer plain text, fall back to HTML
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decode_base64url(payload.body.data);
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return strip_html(decode_base64url(payload.body.data));
  }
  if (payload.parts) {
    // Try text/plain first across all parts
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decode_base64url(part.body.data);
      }
    }
    for (const part of payload.parts) {
      const nested = extract_body(part);
      if (nested) return nested;
    }
  }
  return "";
}

// ── Signal extraction ─────────────────────────────────────────────────────────

interface ExtractedSignal {
  summary: string;
  topics: string[];
  source_title: string | null;
  source_url: string | null;
}

async function extract_signals(
  body: string,
  sender: NewsletterSender,
  subject: string,
): Promise<ExtractedSignal[]> {
  // Truncate to avoid huge token counts — newsletters rarely need more than 8k chars
  const truncated = body.slice(0, 8000);

  if (sender.multi_signal) {
    // Returns an array of signals — one per podcast/item
    const res = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: `You are a personal knowledge assistant ingesting a newsletter email.

${sender.instructions}

Email subject: "${subject}"
Email body:
${truncated}

Return ONLY a valid JSON array, one object per podcast/item found:
[{
  "summary": "2-3 sentences on the core argument or idea — what was actually said, not just the topic",
  "topics": ["3-5 specific tags"],
  "source_title": "podcast name + episode title if identifiable",
  "source_url": null
}]

If no podcast summaries are found, return an empty array [].`,
      }],
    });

    const raw = res.content[0].type === "text" ? res.content[0].text : "[]";
    const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    try { return JSON.parse(clean); } catch { return []; }
  }

  // Standard single-signal extraction
  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [{
      role: "user",
      content: `You are a personal knowledge assistant ingesting a newsletter email.
${sender.instructions ? `\n${sender.instructions}\n` : ""}
Email subject: "${subject}"
Email body:
${truncated}

Extract the core knowledge and return ONLY valid JSON:
{
  "summary": "2-3 sentences on the actual insight — what it says and why it matters",
  "topics": ["3-6 specific tags — concrete, not generic"],
  "source_title": "${sender.label}: ${subject}",
  "source_url": null
}`,
    }],
  });

  const raw = res.content[0].type === "text" ? res.content[0].text : "{}";
  const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  try { return [JSON.parse(clean)]; } catch { return []; }
}

// ── Dedup check ───────────────────────────────────────────────────────────────

async function already_ingested(gmail_message_id: string): Promise<boolean> {
  const { data } = await getSupabase()
    .from("signals")
    .select("id")
    .eq("raw_input", `gmail:${gmail_message_id}`)
    .limit(1);
  return (data ?? []).length > 0;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  // Vercel cron sends a GET with a secret header — verify it
  // (Vercel automatically adds CRON_SECRET to cron requests)
  // We skip verification in dev but enforce in production via env
  // Verify Vercel cron secret if configured
  const cron_secret = process.env.CRON_SECRET;
  if (cron_secret) {
    const auth_header = request.headers.get("authorization") ?? "";
    if (auth_header !== `Bearer ${cron_secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Build Gmail clients for each account — null if the token isn't configured
  const gmail_clients = {
    gmail: get_gmail_client("gmail"),
    dan: get_gmail_client("dan"),
  };

  if (!gmail_clients.gmail && !gmail_clients.dan) {
    return NextResponse.json({ error: "No Gmail tokens configured. Set GMAIL_REFRESH_TOKEN and/or GMAIL_REFRESH_TOKEN_DAN." }, { status: 500 });
  }

  // Look back window — daily cron uses 48h, manual hit with ?days=N overrides
  const url = new URL(request.url);
  const days_back = parseInt(url.searchParams.get("days") ?? "2", 10);
  const since = new Date(Date.now() - days_back * 24 * 60 * 60 * 1000);
  const after_date = `${since.getFullYear()}/${String(since.getMonth() + 1).padStart(2, "0")}/${String(since.getDate()).padStart(2, "0")}`;

  const results: Record<string, { processed: number; skipped: number; signals_saved: number }> = {};
  let total_signals = 0;

  for (const sender of SENDERS) {
    results[sender.email] = { processed: 0, skipped: 0, signals_saved: 0 };

    const gmail = gmail_clients[sender.account];
    if (!gmail) {
      // Token for this account not configured yet — skip silently
      continue;
    }

    // Search for emails from this sender in the window
    const search = await gmail.users.messages.list({
      userId: "me",
      q: `from:${sender.email} after:${after_date}`,
      maxResults: 20,
    });

    const messages = search.data.messages ?? [];

    for (const msg_ref of messages) {
      if (!msg_ref.id) continue;

      // Skip if already ingested (dedup by Gmail message ID stored in raw_input)
      if (await already_ingested(msg_ref.id)) {
        results[sender.email].skipped++;
        continue;
      }

      // Fetch full message
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: msg_ref.id,
        format: "full",
      });

      const headers = msg.data.payload?.headers ?? [];
      const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "(no subject)";
      const body = extract_body(msg.data.payload as Parameters<typeof extract_body>[0] ?? {});

      if (!body || body.length < 100) {
        results[sender.email].skipped++;
        continue;
      }

      results[sender.email].processed++;

      // Extract signals (1 or many depending on sender config)
      const extracted = await extract_signals(body, sender, subject);

      for (const signal of extracted) {
        if (!signal.summary) continue;

        await getSupabase().from("signals").insert({
          summary: signal.summary,
          topics: signal.topics ?? [],
          source_title: signal.source_title ?? `${sender.label}: ${subject}`,
          source_url: signal.source_url ?? null,
          // Store the Gmail message ID so we never process the same email twice
          raw_input: `gmail:${msg_ref.id}`,
          captured_at: new Date().toISOString(),
        });

        results[sender.email].signals_saved++;
        total_signals++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    total_signals_saved: total_signals,
    by_sender: results,
    window: `${days_back} days (since ${after_date})`,
    run_at: new Date().toISOString(),
  });
}
