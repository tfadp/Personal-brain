import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "@/lib/supabase";
import { SignalQuestion } from "@/lib/types";

const anthropic = new Anthropic();

// Maximum transcript characters we feed into the prompt — keeps the call
// within a safe token budget while preserving most of a long video.
const TRANSCRIPT_CHAR_LIMIT = 80_000;

// GET /api/signals/[id]/ask
// Returns Q&A history for a signal, newest first.
// 404 if the signal does not exist.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getSupabase();

  // Verify the signal exists before returning questions for it
  const { data: signal, error: signal_error } = await supabase
    .from("signals")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (signal_error) {
    return NextResponse.json({ ok: false, error: signal_error.message }, { status: 500 });
  }
  if (!signal) {
    return NextResponse.json({ ok: false, error: "signal not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("signal_questions")
    .select("*")
    .eq("signal_id", id)
    .order("asked_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, questions: (data ?? []) as SignalQuestion[] });
}

// POST /api/signals/[id]/ask
// Body: { question: string }
// Calls Claude with the signal's transcript to answer the question,
// then persists the Q&A pair to signal_questions.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── Validate request body ──────────────────────────────────────────────────
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const raw_question: unknown = body.question;
  if (typeof raw_question !== "string" || !raw_question.trim()) {
    return NextResponse.json({ ok: false, error: "question is required and must be a non-empty string" }, { status: 400 });
  }
  if (raw_question.trim().length > 1000) {
    return NextResponse.json({ ok: false, error: "question must be 1000 characters or fewer" }, { status: 400 });
  }
  const question = raw_question.trim();

  // ── Load signal ────────────────────────────────────────────────────────────
  const supabase = getSupabase();
  const { data: signal, error: signal_error } = await supabase
    .from("signals")
    .select("id, transcript")
    .eq("id", id)
    .maybeSingle();

  if (signal_error) {
    return NextResponse.json({ ok: false, error: signal_error.message }, { status: 500 });
  }
  if (!signal) {
    return NextResponse.json({ ok: false, error: "signal not found" }, { status: 404 });
  }
  if (!signal.transcript) {
    return NextResponse.json(
      { ok: false, error: "this signal has no transcript to query" },
      { status: 400 }
    );
  }

  // ── Call Claude ────────────────────────────────────────────────────────────
  // Truncate the transcript so the prompt stays within our token budget.
  // We lose the tail end of very long videos, but the start is almost always
  // the densest part of the material.
  const transcript_excerpt = signal.transcript.slice(0, TRANSCRIPT_CHAR_LIMIT);

  const prompt = `You are answering questions about a YouTube video using ONLY its transcript.
If the answer isn't in the transcript, reply with exactly: "Not in the transcript."
Do not speculate. Do not use outside knowledge. Quote or paraphrase the transcript when helpful.

Transcript:
${transcript_excerpt}

Question: ${question}

Answer:`;

  const claude_response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  // Anti-pattern rule: always check stop_reason when response length is variable
  if (claude_response.stop_reason === "max_tokens") {
    console.warn(
      `[ask] Claude answer truncated at max_tokens for signal ${id} — consider raising max_tokens`
    );
  }

  const first_block = claude_response.content[0];
  const answer =
    first_block?.type === "text" ? first_block.text.trim() : "";

  // Guard: Claude returned a non-text content block (e.g. tool_use) — cannot proceed
  if (!answer) {
    return NextResponse.json({ ok: false, error: "Claude returned an empty answer" }, { status: 500 });
  }

  // ── Persist Q&A row ────────────────────────────────────────────────────────
  // WHY: persistence is part of the contract — soft-fail would silently lose Q&A history
  // TODO: decide whether fail-loud (current) vs fail-soft is right here.
  //       Fail-loud means if the insert errors the user gets a 500 even though Claude
  //       answered correctly. Fail-soft would return the answer but lose the history.
  //       Current stance: fail loud.
  const { data: inserted, error: insert_error } = await supabase
    .from("signal_questions")
    .insert({ signal_id: id, question, answer })
    .select()
    .single();

  if (insert_error) {
    return NextResponse.json({ ok: false, error: insert_error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, question: inserted as SignalQuestion });
}
