/**
 * LLM-based Link Ranker - Uses OpenAI to classify and rank links by relevance
 */

import { chatCompletion } from "../services/openai.js";
import type { ExtractedLink } from "./extractor.js";

export interface RankedLink extends ExtractedLink {
  relevanceScore: number; // 0-1
  category: LinkCategory;
  rationale: string;
}

export type LinkCategory =
  | "budget" // Budget documents, financial reports, ACFR
  | "finance" // Finance department, treasurer, CFO contacts
  | "procurement" // RFPs, bids, procurement portals
  | "contact" // Contact pages, staff directories
  | "meeting" // Meeting agendas, minutes, board meetings
  | "policy" // Policies, ordinances, resolutions
  | "project" // Capital projects, initiatives
  | "department" // Department pages (general)
  | "document" // PDFs, downloadable documents
  | "other"; // Not relevant

export interface RankerConfig {
  // Keywords to prioritize (configurable per use case)
  priorityKeywords: string[];
  // Minimum relevance score to consider (0-1)
  minRelevanceScore: number;
  // Maximum links to rank per batch (to control API costs)
  batchSize: number;
}

const DEFAULT_CONFIG: RankerConfig = {
  priorityKeywords: [
    "ACFR",
    "Annual Comprehensive Financial Report",
    "Budget",
    "Finance",
    "Finance Director",
    "CFO",
    "Treasurer",
    "Procurement",
    "RFP",
    "Request for Proposal",
    "Bid",
    "Contract",
    "Capital",
    "Project",
    "Infrastructure",
  ],
  minRelevanceScore: 0.3,
  batchSize: 50,
};

// JSON schema for structured output
const RANKING_SCHEMA = {
  type: "object",
  properties: {
    rankedLinks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "number" },
          relevanceScore: { type: "number" },
          category: {
            type: "string",
            enum: [
              "budget",
              "finance",
              "procurement",
              "contact",
              "meeting",
              "policy",
              "project",
              "department",
              "document",
              "other",
            ],
          },
          rationale: { type: "string" },
        },
        required: ["index", "relevanceScore", "category", "rationale"],
        additionalProperties: false,
      },
    },
  },
  required: ["rankedLinks"],
  additionalProperties: false,
};

interface RankingResponse {
  rankedLinks: Array<{
    index: number;
    relevanceScore: number;
    category: LinkCategory;
    rationale: string;
  }>;
}

/**
 * Ranks a batch of links using LLM classification
 */
export async function rankLinks(
  links: ExtractedLink[],
  config: Partial<RankerConfig> = {}
): Promise<RankedLink[]> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (links.length === 0) {
    return [];
  }

  // Process in batches to avoid token limits
  const rankedLinks: RankedLink[] = [];

  for (let i = 0; i < links.length; i += cfg.batchSize) {
    const batch = links.slice(i, i + cfg.batchSize);
    const batchRanked = await rankBatch(batch, cfg, i);
    rankedLinks.push(...batchRanked);
  }

  // Sort by relevance score descending
  rankedLinks.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return rankedLinks;
}

/**
 * Ranks a single batch of links
 */
async function rankBatch(
  links: ExtractedLink[],
  config: RankerConfig,
  startIndex: number
): Promise<RankedLink[]> {
  const systemPrompt = `You are a link classification expert for government and public sector websites.
Your task is to rank links by their relevance to finding high-value government information.

PRIORITY KEYWORDS (links containing or related to these are HIGH value):
${config.priorityKeywords.map((k) => `- ${k}`).join("\n")}

CATEGORIES:
- budget: Budget documents, financial reports, ACFR, comprehensive annual financial reports
- finance: Finance department pages, treasurer, CFO, controller contacts
- procurement: RFPs, RFQs, bids, solicitations, procurement portals, vendor registration
- contact: Contact pages, staff directories, department contacts
- meeting: Meeting agendas, minutes, board meetings, council meetings, public hearings
- policy: Policies, ordinances, resolutions, codes, bylaws
- project: Capital improvement projects, infrastructure initiatives, construction projects
- department: General department landing pages
- document: PDF downloads, document libraries, forms
- other: Navigation links, social media, login pages, or irrelevant content

SCORING GUIDELINES:
- 0.9-1.0: Direct match to priority keywords (e.g., "2024 Budget", "ACFR", "Finance Director")
- 0.7-0.9: Highly relevant to procurement/finance (e.g., "Purchasing Department", "Capital Projects")
- 0.5-0.7: Potentially valuable (e.g., "Board of Directors", "Public Documents")
- 0.3-0.5: Marginally relevant (e.g., general department pages)
- 0.0-0.3: Not relevant (e.g., social media, login, news, careers)

Analyze each link's URL, anchor text, and surrounding context to determine relevance.`;

  const userPrompt = `Rank these ${links.length} links by relevance to government procurement, budget, and finance information:

${links
  .map(
    (link, idx) => `[${idx}] URL: ${link.url}
    Anchor: ${link.anchorText}
    Context: ${link.context.slice(0, 200)}
`
  )
  .join("\n")}

Return a JSON object with rankedLinks array containing index, relevanceScore (0-1), category, and brief rationale for each link.`;

  try {
    const response = await chatCompletion<RankingResponse>(
      systemPrompt,
      userPrompt,
      {
        temperature: 0.2,
        maxTokens: 4096,
        schema: RANKING_SCHEMA,
        schemaName: "link_ranking",
      }
    );

    // Map the rankings back to the original links
    return response.rankedLinks
      .map((ranking) => {
        const link = links[ranking.index];
        if (!link) return null;

        return {
          ...link,
          relevanceScore: ranking.relevanceScore,
          category: ranking.category,
          rationale: ranking.rationale,
        };
      })
      .filter((link): link is RankedLink => link !== null);
  } catch (error) {
    console.error("Error ranking links:", error);
    // Return links with default low score on error
    return links.map((link) => ({
      ...link,
      relevanceScore: 0.1,
      category: "other" as LinkCategory,
      rationale: "Error during ranking",
    }));
  }
}

/**
 * Quick heuristic-based pre-ranking (no LLM, for filtering before LLM call)
 */
export function heuristicRank(links: ExtractedLink[]): ExtractedLink[] {
  const highValuePatterns = [
    // Budget/Finance
    { pattern: /budget/i, weight: 0.9 },
    { pattern: /acfr/i, weight: 0.95 },
    { pattern: /annual.*financial.*report/i, weight: 0.95 },
    { pattern: /financial.*report/i, weight: 0.85 },
    { pattern: /finance/i, weight: 0.8 },
    { pattern: /treasurer/i, weight: 0.8 },
    { pattern: /cfo|chief.*financial/i, weight: 0.85 },

    // Procurement
    { pattern: /procurement/i, weight: 0.9 },
    { pattern: /rfp|rfq|rfi/i, weight: 0.95 },
    { pattern: /bid|bidding/i, weight: 0.85 },
    { pattern: /solicitation/i, weight: 0.9 },
    { pattern: /vendor/i, weight: 0.7 },
    { pattern: /contract/i, weight: 0.75 },

    // Contacts
    { pattern: /contact/i, weight: 0.6 },
    { pattern: /directory/i, weight: 0.65 },
    { pattern: /staff/i, weight: 0.55 },

    // Meetings
    { pattern: /agenda/i, weight: 0.7 },
    { pattern: /minutes/i, weight: 0.7 },
    { pattern: /board.*meeting/i, weight: 0.75 },
    { pattern: /council.*meeting/i, weight: 0.75 },

    // Documents
    { pattern: /\.pdf$/i, weight: 0.5 },
    { pattern: /document/i, weight: 0.5 },
    { pattern: /capital.*project/i, weight: 0.85 },
    { pattern: /capital.*improvement/i, weight: 0.85 },
  ];

  // Score each link
  const scored = links.map((link) => {
    const textToCheck = `${link.url} ${link.anchorText} ${link.context}`.toLowerCase();
    let maxScore = 0;

    for (const { pattern, weight } of highValuePatterns) {
      if (pattern.test(textToCheck)) {
        maxScore = Math.max(maxScore, weight);
      }
    }

    return { link, score: maxScore };
  });

  // Sort by score and return links with score > 0
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.link);
}

/**
 * Filters ranked links by minimum score
 */
export function filterByScore(
  links: RankedLink[],
  minScore: number = DEFAULT_CONFIG.minRelevanceScore
): RankedLink[] {
  return links.filter((link) => link.relevanceScore >= minScore);
}

/**
 * Groups ranked links by category
 */
export function groupByCategory(
  links: RankedLink[]
): Record<LinkCategory, RankedLink[]> {
  const groups: Record<LinkCategory, RankedLink[]> = {
    budget: [],
    finance: [],
    procurement: [],
    contact: [],
    meeting: [],
    policy: [],
    project: [],
    department: [],
    document: [],
    other: [],
  };

  for (const link of links) {
    groups[link.category].push(link);
  }

  return groups;
}
