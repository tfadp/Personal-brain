import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

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

  // All contacts — raise limit beyond Supabase's 1000-row default
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .order("name")
    .limit(5000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
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
