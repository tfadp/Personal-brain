import { describe, it, expect } from "vitest";
import { topics_from_url } from "./domain_topics";

describe("topics_from_url", () => {
  it("returns topics for a known domain", () => {
    expect(topics_from_url("https://arxiv.org/abs/2301.12345")).toEqual(["ai", "research"]);
  });

  it("strips www. prefix", () => {
    expect(topics_from_url("https://www.wired.com/story/something")).toEqual(["tech", "culture"]);
  });

  it("falls back to bare domain on subdomain match", () => {
    expect(topics_from_url("https://news.ycombinator.com/item?id=123")).toEqual(["tech", "startups"]);
  });

  it("returns empty array for unknown domain", () => {
    expect(topics_from_url("https://example.com/post")).toEqual([]);
  });

  it("returns empty array for null/undefined", () => {
    expect(topics_from_url(null)).toEqual([]);
    expect(topics_from_url(undefined)).toEqual([]);
    expect(topics_from_url("")).toEqual([]);
  });

  it("returns empty array for non-URL strings", () => {
    expect(topics_from_url("not a url")).toEqual([]);
  });
});
