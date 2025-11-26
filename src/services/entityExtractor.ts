/**
 * Entity Extractor - Uses LLM to extract organization metadata from scraped content
 */

import OpenAI from "openai";

const openai = new OpenAI();

export interface ExtractedEntityInfo {
  name: string;
  type: "city" | "county" | "school_district" | "special_district" | "university" | "other";
  state: string | null;
  confidence: number;
}

const ENTITY_EXTRACTION_PROMPT = `You are analyzing a government or public sector website to extract organization information.

Based on the content provided, extract:
1. **name**: The official name of the organization (e.g., "City of Bozeman", "Boerne Independent School District", "Arizona State University")
2. **type**: One of: "city", "county", "school_district", "special_district", "university", "other"
3. **state**: The US state abbreviation (e.g., "TX", "MT", "AZ") or null if not in the US
4. **confidence**: Your confidence in this extraction (0.0 to 1.0)

Respond in JSON format only:
{
  "name": "Official Organization Name",
  "type": "city|county|school_district|special_district|university|other",
  "state": "XX" or null,
  "confidence": 0.95
}`;

/**
 * Extract entity information from scraped page content using LLM
 */
export async function extractEntityInfo(
  pageContents: Array<{ url: string; title: string; content: string }>,
  website: string
): Promise<ExtractedEntityInfo | null> {
  // Take first 3 pages and limit content to avoid token limits
  const sampledContent = pageContents
    .slice(0, 3)
    .map((page) => {
      const truncatedContent = page.content.slice(0, 2000);
      return `URL: ${page.url}\nTitle: ${page.title}\nContent:\n${truncatedContent}`;
    })
    .join("\n\n---\n\n");

  if (sampledContent.length < 100) {
    console.log("   ⚠️  Not enough content to extract entity info");
    return null;
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: ENTITY_EXTRACTION_PROMPT },
        {
          role: "user",
          content: `Website: ${website}\n\nScraped Content:\n${sampledContent}`,
        },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;
    if (!content) {
      return null;
    }

    const parsed = JSON.parse(content) as ExtractedEntityInfo;

    // Validate the response
    if (!parsed.name || !parsed.type) {
      console.log("   ⚠️  Invalid entity extraction response");
      return null;
    }

    // Normalize type
    const validTypes = ["city", "county", "school_district", "special_district", "university", "other"];
    if (!validTypes.includes(parsed.type)) {
      parsed.type = "other";
    }

    // Normalize state (uppercase, 2 chars)
    if (parsed.state) {
      parsed.state = parsed.state.toUpperCase().slice(0, 2);
    }

    return parsed;
  } catch (error) {
    console.error("   ⚠️  Entity extraction failed:", error);
    return null;
  }
}
