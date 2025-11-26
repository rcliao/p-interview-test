/**
 * Scraper Orchestrator - Main entry point for the web scraper
 *
 * Coordinates crawling, content extraction, and database storage
 */

import { db, pool } from "../db/index.js";
import { entities, documents, chunks, projects, projectEvidence } from "../db/schema.js";
import { crawl, getRobotsInfo, type CrawlerConfig, type CrawlResult } from "./crawler.js";
import { type RankedLink } from "./ranker.js";
import { chunkDocument, getDocumentTokenCount } from "../services/chunker.js";
import { generateEmbeddings } from "../services/openai.js";
import { summarizeDocument } from "../services/summarizer.js";
import { extractProjects } from "../services/projectExtractor.js";
import { extractEntityInfo } from "../services/entityExtractor.js";
import { eq } from "drizzle-orm";

export interface ScraperConfig extends Partial<CrawlerConfig> {
  // Organization ID to associate scraped content with
  orgId: string;
  // Whether to store content in database
  storeInDb: boolean;
  // Whether to extract projects from scraped content
  extractProjects: boolean;
  // Whether to generate embeddings
  generateEmbeddings: boolean;
  // Verbose logging
  verbose: boolean;
}

export interface ScraperResult {
  crawlResult: CrawlResult;
  stored: {
    documentsCreated: number;
    chunksCreated: number;
    projectsExtracted: number;
  };
}

const DEFAULT_SCRAPER_CONFIG: ScraperConfig = {
  orgId: "scraped",
  storeInDb: true,
  extractProjects: true,
  generateEmbeddings: true,
  verbose: true,
  maxDepth: 2,
  maxPages: 20,
  minScoreToFollow: 0.5,
  useLlmRanking: true,
  sameDomainOnly: true,
  requestDelayMs: 1000,
};

/**
 * Main scraper function - crawls a website and stores high-value content
 */
export async function scrape(
  seedUrl: string,
  config: Partial<ScraperConfig> = {}
): Promise<ScraperResult> {
  const cfg = { ...DEFAULT_SCRAPER_CONFIG, ...config };

  console.log("\n" + "═".repeat(60));
  console.log("🕷️  PUBLIC SECTOR INTELLIGENCE SCRAPER");
  console.log("═".repeat(60));
  console.log(`\n📍 Seed URL: ${seedUrl}`);
  console.log(`📁 Org ID: ${cfg.orgId}`);
  console.log(`📊 Config:`);
  console.log(`   • Max depth: ${cfg.maxDepth}`);
  console.log(`   • Max pages: ${cfg.maxPages}`);
  console.log(`   • Min score to follow: ${cfg.minScoreToFollow}`);
  console.log(`   • LLM ranking: ${cfg.useLlmRanking}`);
  console.log(`   • Store in DB: ${cfg.storeInDb}`);
  console.log(`   • Extract projects: ${cfg.extractProjects}`);

  // Check robots.txt
  console.log("\n🤖 Checking robots.txt...");
  const robotsInfo = await getRobotsInfo(seedUrl);
  if (robotsInfo.crawlDelay) {
    console.log(`   Found crawl-delay: ${robotsInfo.crawlDelay}ms`);
    cfg.requestDelayMs = Math.max(cfg.requestDelayMs || 1000, robotsInfo.crawlDelay);
  }
  if (robotsInfo.disallowed.length > 0) {
    console.log(`   Disallowed paths: ${robotsInfo.disallowed.length}`);
  }

  // Ensure entity exists
  if (cfg.storeInDb) {
    await ensureEntity(cfg.orgId, seedUrl);
  }

  // Run the crawler
  const crawlResult = await crawl(seedUrl, {
    maxDepth: cfg.maxDepth,
    maxPages: cfg.maxPages,
    minScoreToFollow: cfg.minScoreToFollow,
    useLlmRanking: cfg.useLlmRanking,
    sameDomainOnly: cfg.sameDomainOnly,
    requestDelayMs: cfg.requestDelayMs,
    concurrency: cfg.concurrency,
    rankerConfig: cfg.rankerConfig,
  });

  // Store results in database
  let stored = {
    documentsCreated: 0,
    chunksCreated: 0,
    projectsExtracted: 0,
  };

  if (cfg.storeInDb) {
    console.log("\n📦 Storing results in database...");
    stored = await storeResults(crawlResult, cfg);

    // Extract and update entity information using LLM
    await enrichEntityInfo(crawlResult, cfg.orgId, seedUrl);
  }

  // Print summary
  printSummary(crawlResult, stored, cfg);

  return {
    crawlResult,
    stored,
  };
}

/**
 * Ensures an entity exists in the database
 */
async function ensureEntity(orgId: string, website: string): Promise<void> {
  try {
    const domain = new URL(website).hostname;
    await db
      .insert(entities)
      .values({
        id: orgId,
        name: domain,
        website: website,
      })
      .onConflictDoNothing();
  } catch (error) {
    console.error("Error creating entity:", error);
  }
}

/**
 * Enriches entity information using LLM extraction from crawled pages
 */
async function enrichEntityInfo(
  crawlResult: CrawlResult,
  orgId: string,
  website: string
): Promise<void> {
  if (crawlResult.pages.length === 0) {
    return;
  }

  console.log("\n🏢 Extracting entity information...");

  // Prepare page contents for extraction
  const pageContents = crawlResult.pages
    .filter((p) => p.markdown && p.markdown.length > 100)
    .map((p) => ({
      url: p.url,
      title: p.title || "",
      content: p.markdown || "",
    }));

  if (pageContents.length === 0) {
    console.log("   ⚠️  No suitable pages for entity extraction");
    return;
  }

  try {
    const entityInfo = await extractEntityInfo(pageContents, website);

    if (entityInfo && entityInfo.confidence >= 0.5) {
      console.log(`   ✅ Extracted: ${entityInfo.name}`);
      console.log(`      Type: ${entityInfo.type}`);
      if (entityInfo.state) {
        console.log(`      State: ${entityInfo.state}`);
      }
      console.log(`      Confidence: ${(entityInfo.confidence * 100).toFixed(0)}%`);

      // Update entity in database
      await db
        .update(entities)
        .set({
          name: entityInfo.name,
          type: entityInfo.type,
          state: entityInfo.state,
        })
        .where(eq(entities.id, orgId));
    } else {
      console.log("   ⚠️  Could not extract entity info with high confidence");
    }
  } catch (error) {
    console.error("   ⚠️  Entity enrichment failed:", error);
  }
}

/**
 * Stores crawl results in the database
 */
async function storeResults(
  crawlResult: CrawlResult,
  config: ScraperConfig
): Promise<{
  documentsCreated: number;
  chunksCreated: number;
  projectsExtracted: number;
}> {
  let documentsCreated = 0;
  let chunksCreated = 0;
  let projectsExtracted = 0;

  for (const page of crawlResult.pages) {
    // Skip pages with little content
    if (!page.markdown || page.markdown.length < 200) {
      console.log(`   ⏭️  Skipping thin content: ${page.url.slice(0, 50)}...`);
      continue;
    }

    try {
      // Check if document already exists
      const existing = await db
        .select()
        .from(documents)
        .where(eq(documents.url, page.url))
        .limit(1);

      if (existing.length > 0) {
        console.log(`   ⏭️  Already exists: ${page.url.slice(0, 50)}...`);
        continue;
      }

      console.log(`   📄 Processing: ${page.url.slice(0, 60)}...`);

      // Generate summary and metadata
      let summary;
      try {
        summary = await summarizeDocument(page.markdown, page.url);
      } catch (error) {
        console.log(`      ⚠️  Summary failed, using defaults`);
        summary = {
          title: page.title || "Untitled",
          summary: page.markdown.slice(0, 200),
          keywords: [],
          documentType: "other",
          fiscalYear: null,
        };
      }

      // Chunk the document
      const docChunks = chunkDocument(page.markdown);
      console.log(`      🔪 Created ${docChunks.length} chunks`);

      // Insert document
      const [insertedDoc] = await db
        .insert(documents)
        .values({
          url: page.url,
          urlId: generateUrlId(page.url),
          orgId: config.orgId,
          title: summary.title || page.title,
          content: page.markdown,
          contentType: summary.documentType,
          summary: summary.summary,
          keywords: summary.keywords,
          fiscalYear: summary.fiscalYear,
          tokenCount: getDocumentTokenCount(page.markdown),
          chunkCount: docChunks.length,
        })
        .returning();

      documentsCreated++;

      // Generate embeddings and insert chunks
      if (config.generateEmbeddings && docChunks.length > 0) {
        console.log(`      🧠 Generating embeddings...`);
        const chunkTexts = docChunks.map((c) => c.content);

        try {
          const embeddings = await generateEmbeddings(chunkTexts);

          for (let i = 0; i < docChunks.length; i++) {
            const chunk = docChunks[i];

            await pool.query(
              `INSERT INTO chunks (document_id, section_title, content, token_count, chunk_index, embedding)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                insertedDoc.id,
                chunk.sectionTitle,
                chunk.content,
                chunk.tokenCount,
                chunk.chunkIndex,
                `[${embeddings[i].join(",")}]`,
              ]
            );
          }

          chunksCreated += docChunks.length;
        } catch (error) {
          console.log(`      ⚠️  Embedding failed, skipping chunks:`, error);
        }
      }

      // Extract projects
      if (config.extractProjects) {
        console.log(`      🔍 Extracting projects...`);
        try {
          const extractedProjects = await extractProjects(page.markdown, page.url);

          for (const proj of extractedProjects) {
            console.log(`         📌 Found: ${proj.title} (${proj.phase})`);

            const projEmbedding = (
              await generateEmbeddings([`${proj.title} ${proj.description}`])
            )[0];

            const projResult = await pool.query(
              `INSERT INTO projects (
                org_id, title, description, phase, phase_confidence, phase_reasoning,
                category, estimated_value, fiscal_year, timeline_notes, contacts,
                source_documents, keywords, embedding
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
              RETURNING id`,
              [
                config.orgId,
                proj.title,
                proj.description,
                proj.phase,
                proj.phaseConfidence,
                proj.phaseReasoning,
                proj.category,
                proj.estimatedValue,
                proj.fiscalYear,
                proj.timelineNotes,
                JSON.stringify(proj.contacts),
                [insertedDoc.id],
                proj.keywords,
                `[${projEmbedding.join(",")}]`,
              ]
            );

            const projectId = projResult.rows[0].id;

            for (const excerpt of proj.evidenceExcerpts) {
              await db.insert(projectEvidence).values({
                projectId,
                documentId: insertedDoc.id,
                evidenceType: "phase_signal",
                excerpt,
                confidence: proj.phaseConfidence,
              });
            }

            projectsExtracted++;
          }
        } catch (error) {
          console.log(`      ⚠️  Project extraction failed`);
        }
      }

      // Small delay to avoid rate limits
      await new Promise((r) => setTimeout(r, 300));
    } catch (error) {
      console.error(`   ❌ Error storing ${page.url}:`, error);
    }
  }

  return { documentsCreated, chunksCreated, projectsExtracted };
}

/**
 * Generates a URL ID from a URL
 */
function generateUrlId(url: string): string {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const slug = pathParts.slice(-2).join("-") || "home";
    return `${parsed.hostname}-${slug}`.replace(/[^a-z0-9-]/gi, "-");
  } catch {
    return `url-${Date.now()}`;
  }
}

/**
 * Prints a summary of the scrape operation
 */
function printSummary(
  crawlResult: CrawlResult,
  stored: { documentsCreated: number; chunksCreated: number; projectsExtracted: number },
  config: ScraperConfig
): void {
  console.log("\n" + "═".repeat(60));
  console.log("📊 SCRAPE SUMMARY");
  console.log("═".repeat(60));
  console.log(`\n🕷️  Crawl Results:`);
  console.log(`   • Pages processed: ${crawlResult.stats.totalPagesProcessed}`);
  console.log(`   • Total links found: ${crawlResult.stats.totalLinksFound}`);
  console.log(`   • High-value links: ${crawlResult.stats.totalHighValueLinks}`);
  console.log(`   • Duration: ${(crawlResult.stats.duration / 1000).toFixed(1)}s`);
  console.log(`   • Errors: ${crawlResult.stats.errors.length}`);

  if (config.storeInDb) {
    console.log(`\n📦 Storage Results:`);
    console.log(`   • Documents created: ${stored.documentsCreated}`);
    console.log(`   • Chunks created: ${stored.chunksCreated}`);
    console.log(`   • Projects extracted: ${stored.projectsExtracted}`);
  }

  // Top ranked links
  const topLinks = crawlResult.rankedLinks
    .filter((l) => l.relevanceScore >= 0.7)
    .slice(0, 10);

  if (topLinks.length > 0) {
    console.log(`\n🎯 Top High-Value Links Found:`);
    for (const link of topLinks) {
      console.log(
        `   ${link.relevanceScore.toFixed(2)} [${link.category}] ${link.anchorText.slice(0, 50)}`
      );
      console.log(`      → ${link.url.slice(0, 70)}...`);
    }
  }

  // Errors
  if (crawlResult.stats.errors.length > 0) {
    console.log(`\n⚠️  Errors:`);
    for (const err of crawlResult.stats.errors.slice(0, 5)) {
      console.log(`   • ${err.url.slice(0, 50)}: ${err.error}`);
    }
  }

  console.log("\n" + "═".repeat(60));
}

// Re-export types and utilities
export { type CrawlResult, type CrawlerConfig } from "./crawler.js";
export { type RankedLink, type LinkCategory } from "./ranker.js";
export { type ExtractedLink, type PageContent } from "./extractor.js";
