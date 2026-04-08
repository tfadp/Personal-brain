/**
 * Pure helpers extracted so they can be unit-tested without
 * spinning up Next.js or a Supabase connection.
 */

/**
 * Converts a comma-separated topics string from CSV into a clean array.
 * Returns null if the input is empty or missing.
 */
export function parse_topics(raw: string | undefined | null): string[] | null {
  if (!raw) return null;
  const result = raw.split(",").map((t) => t.trim()).filter(Boolean);
  return result.length > 0 ? result : null;
}

/**
 * Safely parses filter JSON returned by Claude.
 * Falls back to { intent: originalQuery } if the JSON is malformed.
 */
export function parse_filters(
  text: string,
  fallback_query: string
): { city?: string; country?: string; topics?: string[]; relationship_strength?: string; intent?: string } {
  try {
    return JSON.parse(text);
  } catch {
    return { intent: fallback_query };
  }
}

// Valid values per SPECS.md invariants
const VALID_STRENGTHS = new Set(["strong", "medium", "light"]);

/**
 * Returns true only if the value is a valid relationship_strength.
 * null is also valid (optional field).
 */
export function is_valid_strength(value: string | null | undefined): boolean {
  if (value == null || value === "") return true;
  return VALID_STRENGTHS.has(value);
}
