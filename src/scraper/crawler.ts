/**
 * Recursive Crawler - Manages crawling with depth control and URL deduplication
 */

import {
  extractLinksFromUrl,
  preFilterLinks,
  initBrowser,
  closeBrowser,
  type PageContent,
  type ExtractedLink,
} from "./extractor.js";
import {
  rankLinks,
  heuristicRank,
  filterByScore,
  type RankedLink,
  type RankerConfig,
} from "./ranker.js";

export interface CrawlerConfig {
  // Maximum crawl depth (0 = only seed URL, 1 = seed + one level, etc.)
  maxDepth: number;
  // Maximum total pages to crawl
  maxPages: number;
  // Minimum relevance score to follow a link
  minScoreToFollow: number;
  // Delay between requests in ms (politeness)
  requestDelayMs: number;
  // Maximum concurrent requests (for scale)
  concurrency: number;
  // Whether to use LLM ranking (vs heuristic only)
  useLlmRanking: boolean;
  // Ranker config overrides
  rankerConfig?: Partial<RankerConfig>;
  // Callback for progress updates
  onProgress?: (status: CrawlProgress) => void;
  // Only crawl within same domain
  sameDomainOnly: boolean;
}

export interface CrawlProgress {
  pagesProcessed: number;
  pagesQueued: number;
  linksFound: number;
  highValueLinksFound: number;
  currentUrl: string;
  currentDepth: number;
}

export interface CrawlResult {
  pages: PageContent[];
  rankedLinks: RankedLink[];
  stats: {
    totalPagesProcessed: number;
    totalLinksFound: number;
    totalHighValueLinks: number;
    duration: number;
    errors: Array<{ url: string; error: string }>;
  };
}

interface QueueItem {
  url: string;
  depth: number;
  parentUrl?: string;
  score?: number;
}

const DEFAULT_CONFIG: CrawlerConfig = {
  maxDepth: 2,
  maxPages: 50,
  minScoreToFollow: 0.5,
  requestDelayMs: 1000,
  concurrency: 1, // Sequential by default for politeness
  useLlmRanking: true,
  sameDomainOnly: true,
};

/**
 * Crawls a website starting from a seed URL
 */
export async function crawl(
  seedUrl: string,
  config: Partial<CrawlerConfig> = {}
): Promise<CrawlResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();

  // Initialize browser for Playwright-based scraping
  await initBrowser();

  // Normalize seed URL
  const normalizedSeed = normalizeUrl(seedUrl);
  const seedDomain = new URL(normalizedSeed).hostname;

  // State tracking
  const visited = new Set<string>();
  const queue: QueueItem[] = [{ url: normalizedSeed, depth: 0 }];
  const pages: PageContent[] = [];
  const allRankedLinks: RankedLink[] = [];
  const errors: Array<{ url: string; error: string }> = [];

  console.log(`\n🕷️  Starting crawl from: ${normalizedSeed}`);
  console.log(`   Max depth: ${cfg.maxDepth}, Max pages: ${cfg.maxPages}`);
  console.log(`   LLM ranking: ${cfg.useLlmRanking ? "enabled" : "disabled"}`);
  console.log("");

  while (queue.length > 0 && pages.length < cfg.maxPages) {
    // Get next URL from queue (priority queue by score, then FIFO)
    queue.sort((a, b) => (b.score || 0) - (a.score || 0));
    const item = queue.shift()!;

    // Skip if already visited
    const normalizedUrl = normalizeUrl(item.url);
    if (visited.has(normalizedUrl)) {
      continue;
    }

    // Check domain restriction
    if (cfg.sameDomainOnly) {
      try {
        const urlDomain = new URL(normalizedUrl).hostname;
        if (!isSameDomain(seedDomain, urlDomain)) {
          continue;
        }
      } catch {
        continue;
      }
    }

    visited.add(normalizedUrl);

    // Report progress
    const progress: CrawlProgress = {
      pagesProcessed: pages.length,
      pagesQueued: queue.length,
      linksFound: allRankedLinks.length,
      highValueLinksFound: allRankedLinks.filter((l) => l.relevanceScore >= 0.7)
        .length,
      currentUrl: normalizedUrl,
      currentDepth: item.depth,
    };
    cfg.onProgress?.(progress);

    console.log(
      `📄 [${pages.length + 1}/${cfg.maxPages}] Depth ${item.depth}: ${normalizedUrl.slice(0, 80)}...`
    );

    // Fetch and extract page
    const pageContent = await extractLinksFromUrl(normalizedUrl);

    if (!pageContent) {
      errors.push({ url: normalizedUrl, error: "Failed to fetch" });
      continue;
    }

    pages.push(pageContent);

    // Process links if not at max depth
    if (item.depth < cfg.maxDepth && pageContent.links.length > 0) {
      console.log(`   Found ${pageContent.links.length} links`);

      // Pre-filter links
      const filtered = preFilterLinks(pageContent.links, normalizedUrl);
      console.log(`   After pre-filter: ${filtered.length} links`);

      // Rank links
      let ranked: RankedLink[];

      if (cfg.useLlmRanking) {
        // Use heuristic first to reduce LLM calls
        const heuristicFiltered = heuristicRank(filtered);
        console.log(
          `   After heuristic: ${heuristicFiltered.length} potentially valuable links`
        );

        if (heuristicFiltered.length > 0) {
          console.log(`   🧠 Ranking with LLM...`);
          ranked = await rankLinks(heuristicFiltered, cfg.rankerConfig);
        } else {
          ranked = [];
        }
      } else {
        // Heuristic only - convert to RankedLink format
        ranked = heuristicRank(filtered).map((link) => ({
          ...link,
          relevanceScore: 0.5,
          category: "other" as const,
          rationale: "Heuristic match",
        }));
      }

      // Store all ranked links
      allRankedLinks.push(...ranked);

      // Filter high-value links for following
      const highValue = filterByScore(ranked, cfg.minScoreToFollow);
      console.log(
        `   🎯 ${highValue.length} high-value links (score >= ${cfg.minScoreToFollow})`
      );

      // Log top links
      for (const link of highValue.slice(0, 5)) {
        console.log(
          `      ${link.relevanceScore.toFixed(2)} [${link.category}] ${link.anchorText.slice(0, 50)}`
        );
      }

      // Add high-value links to queue
      for (const link of highValue) {
        if (!visited.has(normalizeUrl(link.url))) {
          queue.push({
            url: link.url,
            depth: item.depth + 1,
            parentUrl: normalizedUrl,
            score: link.relevanceScore,
          });
        }
      }
    }

    // Politeness delay
    if (queue.length > 0) {
      await sleep(cfg.requestDelayMs);
    }
  }

  // Close browser when done
  await closeBrowser();

  const duration = Date.now() - startTime;

  console.log(`\n✅ Crawl complete!`);
  console.log(`   Pages: ${pages.length}`);
  console.log(`   Links ranked: ${allRankedLinks.length}`);
  console.log(
    `   High-value links: ${allRankedLinks.filter((l) => l.relevanceScore >= 0.7).length}`
  );
  console.log(`   Duration: ${(duration / 1000).toFixed(1)}s`);
  console.log(`   Errors: ${errors.length}`);

  return {
    pages,
    rankedLinks: allRankedLinks,
    stats: {
      totalPagesProcessed: pages.length,
      totalLinksFound: allRankedLinks.length,
      totalHighValueLinks: allRankedLinks.filter((l) => l.relevanceScore >= 0.7)
        .length,
      duration,
      errors,
    },
  };
}

/**
 * Normalizes a URL for deduplication
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove trailing slash, fragment, and common tracking params
    parsed.hash = "";
    parsed.searchParams.delete("utm_source");
    parsed.searchParams.delete("utm_medium");
    parsed.searchParams.delete("utm_campaign");
    parsed.searchParams.delete("fbclid");
    parsed.searchParams.delete("gclid");

    let normalized = parsed.toString();
    // Remove trailing slash except for root
    if (normalized.endsWith("/") && parsed.pathname !== "/") {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return url;
  }
}

/**
 * Checks if two domains are the same or subdomains
 */
function isSameDomain(domain1: string, domain2: string): boolean {
  // Exact match
  if (domain1 === domain2) return true;

  // Remove www prefix for comparison
  const d1 = domain1.replace(/^www\./, "");
  const d2 = domain2.replace(/^www\./, "");

  if (d1 === d2) return true;

  // Check if one is subdomain of the other
  return d2.endsWith(`.${d1}`) || d1.endsWith(`.${d2}`);
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches robots.txt and extracts crawl delay if present
 */
export async function getRobotsInfo(
  baseUrl: string
): Promise<{
  crawlDelay?: number;
  disallowed: string[];
}> {
  try {
    const robotsUrl = new URL("/robots.txt", baseUrl).toString();
    const response = await fetch(robotsUrl, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { disallowed: [] };
    }

    const text = await response.text();
    const lines = text.split("\n");

    let crawlDelay: number | undefined;
    const disallowed: string[] = [];
    let inUserAgentAll = false;

    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();

      if (trimmed.startsWith("user-agent:")) {
        const agent = trimmed.replace("user-agent:", "").trim();
        inUserAgentAll = agent === "*";
      } else if (inUserAgentAll) {
        if (trimmed.startsWith("crawl-delay:")) {
          const delay = parseInt(trimmed.replace("crawl-delay:", "").trim());
          if (!isNaN(delay)) {
            crawlDelay = delay * 1000; // Convert to ms
          }
        } else if (trimmed.startsWith("disallow:")) {
          const path = trimmed.replace("disallow:", "").trim();
          if (path) {
            disallowed.push(path);
          }
        }
      }
    }

    return { crawlDelay, disallowed };
  } catch {
    return { disallowed: [] };
  }
}

/**
 * Checks if a URL is allowed by robots.txt rules
 */
export function isUrlAllowed(url: string, disallowed: string[]): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;

    for (const rule of disallowed) {
      if (rule === "/") {
        return false; // Everything disallowed
      }
      if (path.startsWith(rule)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}
