import { describe, it, expect } from "vitest";
import { parse_topics, parse_filters, is_valid_strength } from "./utils";

// ── parse_topics ────────────────────────────────────────────────────────────

describe("parse_topics", () => {
  it("splits a comma-separated string into trimmed tokens", () => {
    expect(parse_topics("sports, media, venture")).toEqual([
      "sports",
      "media",
      "venture",
    ]);
  });

  it("returns null for an empty string", () => {
    expect(parse_topics("")).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parse_topics(undefined)).toBeNull();
  });

  it("filters out whitespace-only tokens", () => {
    expect(parse_topics("sports,  , media")).toEqual(["sports", "media"]);
  });
});

// ── parse_filters ───────────────────────────────────────────────────────────

describe("parse_filters", () => {
  it("parses valid JSON returned by Claude", () => {
    const json = JSON.stringify({ city: "London", intent: "sports media" });
    expect(parse_filters(json, "original query")).toEqual({
      city: "London",
      intent: "sports media",
    });
  });

  it("falls back to { intent: query } when JSON is malformed", () => {
    expect(parse_filters("not json at all", "who do I know in London?")).toEqual(
      { intent: "who do I know in London?" }
    );
  });
});

// ── is_valid_strength ───────────────────────────────────────────────────────

describe("is_valid_strength", () => {
  it("accepts 'strong'", () => {
    expect(is_valid_strength("strong")).toBe(true);
  });

  it("accepts 'medium'", () => {
    expect(is_valid_strength("medium")).toBe(true);
  });

  it("accepts 'light'", () => {
    expect(is_valid_strength("light")).toBe(true);
  });

  it("accepts null (optional field)", () => {
    expect(is_valid_strength(null)).toBe(true);
  });

  it("rejects an unknown value", () => {
    expect(is_valid_strength("close")).toBe(false);
  });

  it("rejects an empty string as falsy (treated as null)", () => {
    expect(is_valid_strength("")).toBe(true); // empty = not set = valid
  });
});
