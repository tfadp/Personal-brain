import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { Note } from "@/lib/types";

// GET /api/notes
// Optional ?topic=X  — filters rows where topics contains X
// Optional ?q=term   — ilike on title or body
// Returns { notes: Note[] }, ordered by updated_at desc, limit 100.
export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  const topic = request.nextUrl.searchParams.get("topic");
  const q = request.nextUrl.searchParams.get("q");

  let query = supabase
    .from("notes")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(100);

  if (topic) {
    // cs = "contains" — the topics array must include this value
    query = query.contains("topics", [topic]);
  }

  if (q) {
    // Escape ilike wildcards so user search treats % and _ as literals.
    // Backslash must be escaped first to avoid double-escaping our own escapes.
    const escaped_q = q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    // Filter on title or body using case-insensitive like
    query = query.or(`title.ilike.%${escaped_q}%,body.ilike.%${escaped_q}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notes: (data ?? []) as Note[] });
}

// POST /api/notes
// Body: { title: string, body: string, topics?: string[] }
// Returns { note: Note }.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title is required and must be a non-empty string" }, { status: 400 });
  }
  if (typeof body.body !== "string" || !body.body.trim()) {
    return NextResponse.json({ error: "body is required and must be a non-empty string" }, { status: 400 });
  }

  // Validate optional topics — must be an array of strings if provided
  if (body.topics !== undefined && body.topics !== null) {
    if (!Array.isArray(body.topics) || body.topics.some((t: unknown) => typeof t !== "string")) {
      return NextResponse.json({ error: "topics must be an array of strings" }, { status: 400 });
    }
  }

  const supabase = getSupabase();
  const insert_payload: Record<string, unknown> = {
    title: body.title.trim(),
    body: body.body.trim(),
    topics: body.topics ?? [],
  };

  const { data, error } = await supabase
    .from("notes")
    .insert(insert_payload)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data as Note });
}

// PUT /api/notes
// Body: { id: string, title?: string, body?: string, topics?: string[] }
// Updates only provided fields. DB trigger bumps updated_at automatically.
// Returns { note: Note }.
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const { id, ...updates } = body as Record<string, unknown>;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Validate individual fields only if they are present
  if ("title" in updates && (typeof updates.title !== "string" || !(updates.title as string).trim())) {
    return NextResponse.json({ error: "title must be a non-empty string" }, { status: 400 });
  }
  if ("body" in updates && (typeof updates.body !== "string" || !(updates.body as string).trim())) {
    return NextResponse.json({ error: "body must be a non-empty string" }, { status: 400 });
  }
  if ("topics" in updates && updates.topics !== null) {
    if (!Array.isArray(updates.topics) || (updates.topics as unknown[]).some((t) => typeof t !== "string")) {
      return NextResponse.json({ error: "topics must be an array of strings" }, { status: 400 });
    }
  }

  // Trim string fields in place if present
  const clean_updates: Record<string, unknown> = { ...updates };
  if (typeof clean_updates.title === "string") clean_updates.title = clean_updates.title.trim();
  if (typeof clean_updates.body === "string") clean_updates.body = (clean_updates.body as string).trim();

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("notes")
    .update(clean_updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    // PostgREST returns PGRST116 when no row matched the eq filter
    const not_found = error.code === "PGRST116";
    return NextResponse.json({ error: error.message }, { status: not_found ? 404 : 500 });
  }
  return NextResponse.json({ note: data as Note });
}

// DELETE /api/notes?id=X
// Returns { ok: true }.
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const supabase = getSupabase();
  const { error } = await supabase.from("notes").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
