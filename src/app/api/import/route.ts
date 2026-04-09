import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "@/lib/supabase";

const anthropic = new Anthropic();

// Our canonical schema fields
const SCHEMA_FIELDS = [
  "name", "company", "role", "city", "country",
  "relationship_strength", "how_you_know_them", "topics",
  "last_meaningful_contact", "notes", "email", "linkedin_url",
];

// LinkedIn exports always have these distinctive columns
const LINKEDIN_SIGNATURE_HEADERS = ["first_name", "last_name", "connected_on"];

function is_linkedin_export(headers: string[]): boolean {
  return LINKEDIN_SIGNATURE_HEADERS.every((h) => headers.includes(h));
}

async function map_headers(csv_headers: string[]): Promise<Record<string, string>> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `You are mapping CSV column headers to a contacts database schema.

CSV headers found: ${JSON.stringify(csv_headers)}

Our schema fields: ${JSON.stringify(SCHEMA_FIELDS)}

Return ONLY valid JSON mapping each CSV header to the best matching schema field.
If a header doesn't match any schema field, map it to null.
Multiple CSV headers can map to the same schema field — use the best one.
For LinkedIn exports: "first_name" + "last_name" should both map to "name" (we'll combine them), "position" → "role", "connected_on" → "last_meaningful_contact".

Example output:
{
  "first_name": "name",
  "last_name": "name",
  "email_address": "email",
  "position": "role",
  "company": "company",
  "connected_on": "last_meaningful_contact"
}`,
      },
    ],
  });

  const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
  const clean = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    const fallback: Record<string, string> = {};
    csv_headers.forEach((h) => {
      const match = SCHEMA_FIELDS.find((f) => f === h.toLowerCase());
      fallback[h] = match ?? "";
    });
    return fallback;
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const raw = await file.text();

    // LinkedIn exports start with a "Notes:" comment block before the real headers.
    // Find the first line that looks like a CSV header row and strip everything above it.
    const lines = raw.split("\n");
    const header_index = lines.findIndex((line) =>
      line.trim().match(/^(first.name|name|first_name)/i)
    );
    const text = header_index > 0 ? lines.slice(header_index).join("\n") : raw;

    const { data, errors } = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header: string) =>
        header.trim().toLowerCase().replace(/\s+/g, "_"),
    });

    // Only abort if we got no data at all — minor parse errors (unescaped quotes,
    // trailing commas in notes fields) are common in LinkedIn exports and shouldn't block the import
    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: "CSV is empty or could not be parsed", details: errors },
        { status: 400 }
      );
    }

    const csv_headers = Object.keys(data[0] as Record<string, string>);
    const linkedin = is_linkedin_export(csv_headers);

    // Ask Claude to map headers to schema
    const header_map = await map_headers(csv_headers);

    // Build reverse map: schema_field → csv_header (first winning match)
    // For LinkedIn name, we handle first+last specially below
    const field_to_csv: Record<string, string> = {};
    Object.entries(header_map).forEach(([csv_col, schema_field]) => {
      if (schema_field && !field_to_csv[schema_field]) {
        field_to_csv[schema_field] = csv_col;
      }
    });

    const rows = (data as Record<string, string>[]).map((row) => {
      const get = (field: string) => {
        const col = field_to_csv[field];
        return col ? row[col]?.trim() || null : null;
      };

      // LinkedIn: combine first_name + last_name into name
      let name: string;
      if (linkedin && row.first_name && row.last_name) {
        name = `${row.first_name.trim()} ${row.last_name.trim()}`.trim();
      } else {
        name = get("name") || "";
      }

      const topics_raw = get("topics");

      return {
        name,
        company: get("company"),
        role: get("role"),
        city: get("city"),
        country: get("country"),
        relationship_strength: linkedin ? "light" : get("relationship_strength"),
        // LinkedIn imports default to unreviewed (null quality)
        contact_quality: linkedin ? null : null,
        how_you_know_them: linkedin ? "LinkedIn connection" : get("how_you_know_them"),
        topics: topics_raw
          ? topics_raw.split(",").map((t) => t.trim()).filter(Boolean)
          : null,
        last_meaningful_contact: get("last_meaningful_contact"),
        notes: get("notes"),
        email: get("email"),
        linkedin_url: get("linkedin_url"),
        follow_up: false,
        follow_up_note: null,
      };
    });

    const validRows = rows.filter((r) => r.name);

    if (validRows.length === 0) {
      return NextResponse.json(
        {
          error: "No valid rows found — could not identify a 'name' column.",
          detected_headers: csv_headers,
          mapped_as: header_map,
        },
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
      linkedin_detected: linkedin,
      column_mapping: field_to_csv,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Import failed", details: String(err) },
      { status: 500 }
    );
  }
}
