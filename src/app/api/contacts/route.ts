import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { Contact } from "@/lib/types";
import { contact_embedding_text, embed_text } from "@/lib/embeddings";

// Fields that affect the embedding text. If any of these change on PUT,
// we re-embed. If none of these change (e.g. just flipping follow_up),
// we skip the embed call to save tokens.
const EMBEDDING_FIELDS = [
  "name", "company", "role", "city", "country",
  "how_you_know_them", "topics", "notes",
] as const;

// Best-effort embed — logs failures but never blocks the write.
async function embed_contact_safe(contact: Partial<Contact>): Promise<number[] | null> {
  try {
    const text = contact_embedding_text(contact);
    if (!text.trim()) return null;
    return await embed_text(text);
  } catch (err) {
    console.warn("Contact embedding failed (non-fatal):", err);
    return null;
  }
}

const VALID_STRENGTHS = ["strong", "medium", "light"];
const VALID_QUALITIES = [1, 2, 3];

function validate_contact_fields(body: Record<string, unknown>): string | null {
  if (body.relationship_strength !== undefined && body.relationship_strength !== null &&
      !VALID_STRENGTHS.includes(body.relationship_strength as string)) {
    return `relationship_strength must be one of: ${VALID_STRENGTHS.join(", ")}`;
  }
  if (body.contact_quality !== undefined && body.contact_quality !== null &&
      !VALID_QUALITIES.includes(body.contact_quality as number)) {
    return `contact_quality must be 1, 2, or 3`;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  const id = request.nextUrl.searchParams.get("id");

  if (id) {
    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", id)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json(data);
  }

  // Paginate to bypass Supabase's 1000-row PostgREST max-rows project setting
  const PAGE = 1000;
  let all: Contact[] = [];
  for (let page = 0; ; page++) {
    const { data: chunk, error } = await supabase
      .from("contacts")
      .select("*")
      .order("name")
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!chunk || chunk.length === 0) break;
    all = all.concat(chunk);
    if (chunk.length < PAGE) break;
  }
  return NextResponse.json(all);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  if (!body.name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const validation_error = validate_contact_fields(body);
  if (validation_error) return NextResponse.json({ error: validation_error }, { status: 400 });

  const supabase = getSupabase();
  const { data, error } = await supabase.from("contacts").insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Embed in the background — don't block the response on it.
  // If the embed succeeds, patch the row with the vector.
  embed_contact_safe(data as Contact).then((vec) => {
    if (vec) {
      supabase.from("contacts").update({ contact_embedding: vec }).eq("id", data.id)
        .then(({ error: e }) => { if (e) console.warn("Embed write failed:", e); });
    }
  });

  return NextResponse.json(data);
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const validation_error = validate_contact_fields(updates);
  if (validation_error) return NextResponse.json({ error: validation_error }, { status: 400 });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("contacts")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Re-embed only if a field that affects the embedding text changed
  const embedding_affected = EMBEDDING_FIELDS.some((f) => f in updates);
  if (embedding_affected) {
    embed_contact_safe(data as Contact).then((vec) => {
      if (vec) {
        supabase.from("contacts").update({ contact_embedding: vec }).eq("id", id)
          .then(({ error: e }) => { if (e) console.warn("Embed write failed:", e); });
      }
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const supabase = getSupabase();
  const { error } = await supabase.from("contacts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
