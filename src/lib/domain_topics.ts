// Domain → topic prior.
// When a URL is saved, we seed the topic list from the domain instead of
// asking Claude to classify from scratch. Claude still produces the summary
// and can add more topics — these are hints, not replacements.

const DOMAIN_TOPICS: Record<string, string[]> = {
  // Tech / startups
  "news.ycombinator.com": ["tech", "startups"],
  "techcrunch.com": ["tech", "startups"],
  "theverge.com": ["tech", "culture"],
  "arstechnica.com": ["tech"],
  "wired.com": ["tech", "culture"],

  // AI / research
  "arxiv.org": ["ai", "research"],
  "openai.com": ["ai"],
  "anthropic.com": ["ai"],
  "huggingface.co": ["ai", "research"],

  // Finance / markets
  "bloomberg.com": ["finance", "markets"],
  "ft.com": ["finance", "markets"],
  "wsj.com": ["finance", "markets"],
  "reuters.com": ["news", "markets"],
  "cnbc.com": ["finance", "markets"],

  // Sports / sports business
  "theringer.com": ["sports", "culture"],
  "espn.com": ["sports"],
  "theathletic.com": ["sports"],
  "sportico.com": ["sports", "business"],
  "sportsbusinessjournal.com": ["sports", "business"],
  "frontofficesports.com": ["sports", "business"],

  // Media / journalism
  "nytimes.com": ["news", "media"],
  "washingtonpost.com": ["news", "media"],
  "theatlantic.com": ["media", "culture"],
  "newyorker.com": ["media", "culture"],
  "economist.com": ["news", "markets"],

  // Newsletters / blogs
  "stratechery.com": ["tech", "strategy"],
  "benedictevans.com": ["tech", "strategy"],
  "garbageday.email": ["culture", "internet"],
  "substack.com": [],          // too generic; let Claude decide
  "www.garbageday.email": ["culture", "internet"],

  // Social / video
  "twitter.com": ["social"],
  "x.com": ["social"],
  "youtube.com": ["video"],
  "linkedin.com": ["networking"],

  // VC / investing
  "a16z.com": ["vc", "tech"],
  "sequoiacap.com": ["vc", "tech"],
  "pitchbook.com": ["vc", "markets"],
  "crunchbase.com": ["vc", "startups"],
};

/**
 * Extract the base domain from a URL, lowercased.
 * Returns null if the input is not a valid URL.
 */
function extract_domain(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Look up baseline topics for a URL's domain.
 * Returns an empty array if the domain is unknown — caller should fall back
 * to full LLM topic extraction.
 */
export function topics_from_url(url: string | null | undefined): string[] {
  if (!url) return [];
  const domain = extract_domain(url);
  if (!domain) return [];
  // Exact match first
  if (DOMAIN_TOPICS[domain]) return DOMAIN_TOPICS[domain];
  // Strip www. variant already handled; try bare domain without subdomain
  const parts = domain.split(".");
  if (parts.length > 2) {
    const bare = parts.slice(-2).join(".");
    if (DOMAIN_TOPICS[bare]) return DOMAIN_TOPICS[bare];
  }
  return [];
}
