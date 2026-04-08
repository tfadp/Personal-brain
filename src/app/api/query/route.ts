import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "@/lib/supabase";
import { Contact } from "@/lib/types";

const anthropic = new Anthropic();

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    // Step 1: Extract structured filters from natural language
    const filterResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `Extract search filters from this query about a personal contacts database. Return ONLY valid JSON, no other text.

Query: "${query}"

Return JSON with these optional fields (omit fields that aren't relevant):
{
  "city": "string or null",
  "country": "string or null",
  "topics": ["array", "of", "topic", "keywords"],
  "relationship_strength": "strong | medium | light or null",
  "intent": "what the user is looking for in one phrase"
}`,
        },
      ],
    });

    const filterText =
      filterResponse.content[0].type === "text"
        ? filterResponse.content[0].text
        : "";

    let filters: {
      city?: string;
      country?: string;
      topics?: string[];
      relationship_strength?: string;
      intent?: string;
    };
    try {
      filters = JSON.parse(filterText);
    } catch {
      filters = { intent: query };
    }

    // Step 2: Pull candidates from Supabase
    const supabase = getSupabase();
    let dbQuery = supabase.from("contacts").select("*");

    if (filters.city) {
      dbQuery = dbQuery.ilike("city", `%${filters.city}%`);
    }
    if (filters.country) {
      dbQuery = dbQuery.ilike("country", `%${filters.country}%`);
    }
    if (filters.relationship_strength) {
      dbQuery = dbQuery.eq(
        "relationship_strength",
        filters.relationship_strength
      );
    }

    const { data: filtered } = await dbQuery;

    // If filters returned too few results, also get all contacts for ranking
    let candidates: Contact[] = filtered || [];
    if (candidates.length < 5) {
      const { data: all } = await getSupabase().from("contacts").select("*");
      if (all) {
        const filteredIds = new Set(candidates.map((c) => c.id));
        const additional = all.filter((c: Contact) => !filteredIds.has(c.id));
        candidates = [...candidates, ...additional];
      }
    }

    if (candidates.length === 0) {
      return NextResponse.json({ results: [], filters });
    }

    // Step 3: Rank with Claude
    const rankResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `You are a personal network assistant. Given a query and a list of contacts, return the most relevant contacts ranked by relevance.

Query: "${query}"

Contacts:
${JSON.stringify(candidates, null, 2)}

Return ONLY valid JSON array, no other text. Return up to 10 results, ranked by relevance:
[
  {
    "id": "contact uuid",
    "name": "contact name",
    "company": "company",
    "role": "role",
    "city": "city",
    "country": "country",
    "relationship_strength": "strong/medium/light",
    "how_you_know_them": "context",
    "topics": ["topics"],
    "last_meaningful_contact": "when",
    "notes": "their notes",
    "relevance": "One sentence on why this person is relevant to the query"
  }
]

Only include contacts that are genuinely relevant. If fewer than 10 are relevant, return fewer.`,
        },
      ],
    });

    const rankText =
      rankResponse.content[0].type === "text"
        ? rankResponse.content[0].text
        : "[]";

    let results;
    try {
      results = JSON.parse(rankText);
    } catch {
      // Try to extract JSON from the response
      const jsonMatch = rankText.match(/\[[\s\S]*\]/);
      results = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    }

    return NextResponse.json({ results, filters });
  } catch (err) {
    console.error("Query error:", err);
    return NextResponse.json(
      { error: "Query failed", details: String(err) },
      { status: 500 }
    );
  }
}
