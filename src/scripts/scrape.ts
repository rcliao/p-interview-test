/**
 * Scrape CLI - Command line interface for the web scraper
 *
 * Usage:
 *   npm run scrape <url> [options]
 *
 * Examples:
 *   npm run scrape https://bozeman.net
 *   npm run scrape https://a2gov.org --depth 3 --max-pages 50
 *   npm run scrape https://asu.edu --org-id arizona-state --no-llm
 */

import "dotenv/config";
import { scrape, type ScraperConfig } from "../scraper/index.js";
import { setHeadless } from "../scraper/extractor.js";
import { pool } from "../db/index.js";

// Parse command line arguments
function parseArgs(): { url: string; config: Partial<ScraperConfig>; visible: boolean } {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    process.exit(0);
  }

  const url = args[0];

  // Validate URL
  try {
    new URL(url);
  } catch {
    console.error(`❌ Invalid URL: ${url}`);
    process.exit(1);
  }

  const config: Partial<ScraperConfig> = {};
  let visible = false;

  // Parse options
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--depth":
      case "-d":
        config.maxDepth = parseInt(args[++i]) || 2;
        break;

      case "--max-pages":
      case "-m":
        config.maxPages = parseInt(args[++i]) || 20;
        break;

      case "--org-id":
      case "-o":
        config.orgId = args[++i];
        break;

      case "--min-score":
      case "-s":
        config.minScoreToFollow = parseFloat(args[++i]) || 0.5;
        break;

      case "--delay":
        config.requestDelayMs = parseInt(args[++i]) || 1000;
        break;

      case "--no-llm":
        config.useLlmRanking = false;
        break;

      case "--no-store":
        config.storeInDb = false;
        break;

      case "--no-projects":
        config.extractProjects = false;
        break;

      case "--no-embeddings":
        config.generateEmbeddings = false;
        break;

      case "--cross-domain":
        config.sameDomainOnly = false;
        break;

      case "--quiet":
      case "-q":
        config.verbose = false;
        break;

      case "--visible":
      case "-v":
        visible = true;
        break;

      default:
        if (arg.startsWith("-")) {
          console.error(`❌ Unknown option: ${arg}`);
          printHelp();
          process.exit(1);
        }
    }
  }

  // Default org ID from domain
  if (!config.orgId) {
    try {
      const domain = new URL(url).hostname.replace(/^www\./, "");
      config.orgId = domain.replace(/\./g, "-");
    } catch {
      config.orgId = "scraped";
    }
  }

  return { url, config, visible };
}

function printHelp(): void {
  console.log(`
🕷️  PUBLIC SECTOR INTELLIGENCE SCRAPER
=====================================

Usage:
  npm run scrape <url> [options]

Arguments:
  url                    The seed URL to start crawling from

Options:
  -d, --depth <n>        Maximum crawl depth (default: 2)
  -m, --max-pages <n>    Maximum pages to crawl (default: 20)
  -o, --org-id <id>      Organization ID for storage (default: from domain)
  -s, --min-score <n>    Minimum relevance score to follow (default: 0.5)
  --delay <ms>           Delay between requests in ms (default: 1000)
  --no-llm               Use heuristic ranking only (no LLM)
  --no-store             Don't store results in database
  --no-projects          Don't extract projects from content
  --no-embeddings        Don't generate embeddings
  --cross-domain         Follow links to other domains
  -v, --visible          Show browser window (helps bypass bot detection)
  -q, --quiet            Less verbose output
  -h, --help             Show this help message

Examples:
  # Basic crawl of a government website
  npm run scrape https://bozeman.net

  # Deep crawl with more pages
  npm run scrape https://a2gov.org --depth 3 --max-pages 100

  # Quick heuristic-only crawl (no LLM costs)
  npm run scrape https://asu.edu --no-llm --max-pages 30

  # Dry run without storing
  npm run scrape https://boerneisd.net --no-store

Test Websites (from requirements):
  • https://www.a2gov.org/
  • https://bozeman.net/
  • https://asu.edu/
  • https://boerneisd.net/
`);
}

// Main entry point
async function main(): Promise<void> {
  const { url, config, visible } = parseArgs();

  // Set browser visibility before scraping
  if (visible) {
    setHeadless(false);
    console.log("🖥️  Running with visible browser window");
  }

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🕷️  PUBLIC SECTOR INTELLIGENCE SCRAPER                  ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);

  try {
    const result = await scrape(url, config);

    // Exit with appropriate code
    if (result.crawlResult.stats.errors.length > result.crawlResult.stats.totalPagesProcessed / 2) {
      console.log("\n⚠️  Crawl completed with many errors");
      process.exit(1);
    }

    console.log("\n✅ Scrape completed successfully!");
  } catch (error) {
    console.error("\n❌ Scrape failed:", error);
    process.exit(1);
  } finally {
    // Close database connection
    await pool.end();
  }
}

// Run
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
