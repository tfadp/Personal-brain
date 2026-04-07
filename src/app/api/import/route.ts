import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { getSupabase } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const text = await file.text();
    const { data, errors } = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header: string) => header.trim().toLowerCase().replace(/\s+/g, "_"),
    });

    if (errors.length > 0) {
      return NextResponse.json(
        { error: "CSV parsing errors", details: errors },
        { status: 400 }
      );
    }

    const rows = (data as Record<string, string>[]).map((row) => ({
      name: row.name?.trim() || "",
      company: row.company?.trim() || null,
      role: row.role?.trim() || null,
      city: row.city?.trim() || null,
      country: row.country?.trim() || null,
      relationship_strength: row.relationship_strength?.trim() || null,
      how_you_know_them: row.how_you_know_them?.trim() || null,
      topics: row.topics
        ? row.topics.split(",").map((t: string) => t.trim()).filter(Boolean)
        : null,
      last_meaningful_contact: row.last_meaningful_contact?.trim() || null,
      notes: row.notes?.trim() || null,
      email: row.email?.trim() || null,
      linkedin_url: row.linkedin_url?.trim() || null,
    }));

    const validRows = rows.filter((r) => r.name);

    if (validRows.length === 0) {
      return NextResponse.json(
        { error: "No valid rows found in CSV" },
        { status: 400 }
      );
    }

    const { error } = await getSupabase().from("contacts").insert(validRows);

    if (error) {
      return NextResponse.json(
        { error: "Database insert failed", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      count: validRows.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Import failed", details: String(err) },
      { status: 500 }
    );
  }
}
