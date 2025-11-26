import { chatCompletion } from "./openai.js";

export interface DocumentSummary {
  title: string;
  summary: string;
  keywords: string[];
  documentType: "budget" | "meeting" | "rfp" | "policy" | "contact" | "other";
  fiscalYear: number | null;
}

// JSON Schema for structured outputs
const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Document title extracted or inferred from content" },
    summary: { type: "string", description: "2-3 sentence summary focused on budget/project/procurement info" },
    keywords: {
      type: "array",
      items: { type: "string" },
      description: "Relevant keywords for search"
    },
    documentType: {
      type: "string",
      enum: ["budget", "meeting", "rfp", "policy", "contact", "other"],
      description: "Type of document"
    },
    fiscalYear: { type: ["integer", "null"], description: "Fiscal year if mentioned" }
  },
  required: ["title", "summary", "keywords", "documentType", "fiscalYear"],
  additionalProperties: false
};

const SUMMARIZATION_PROMPT = `You are analyzing government documents to extract key information for sales intelligence purposes.

Analyze the provided document and return a JSON object with the following structure:
{
  "title": "The document title (extract from content or infer from context)",
  "summary": "A 2-3 sentence summary focusing on budget allocations, projects, procurements, or key initiatives",
  "keywords": ["relevant", "keywords", "for", "search"],
  "documentType": "budget|meeting|rfp|policy|contact|other",
  "fiscalYear": 2024 (or null if not mentioned)
}

Document type guidance:
- budget: Budget documents, financial reports, ACFR, appropriations
- meeting: Board meetings, council meetings, committee minutes
- rfp: Request for proposals, procurement notices, bid requests
- policy: Policy documents, handbooks, procedures, guidelines
- contact: Contact lists, staff directories, organizational charts
- other: Anything that doesn't fit the above categories

Focus on extracting information that would help a service provider identify opportunities.`;

/**
 * Generate a summary and metadata for a document
 */
export async function summarizeDocument(
  content: string,
  url: string
): Promise<DocumentSummary> {
  // Truncate very long documents to avoid token limits
  const maxChars = 30000;
  const truncatedContent =
    content.length > maxChars
      ? content.slice(0, maxChars) + "\n\n[Document truncated...]"
      : content;

  const prompt = `Document URL: ${url}

Document Content:
${truncatedContent}`;

  try {
    const result = await chatCompletion<DocumentSummary>(
      SUMMARIZATION_PROMPT,
      prompt,
      {
        temperature: 0.3,
        schema: SUMMARY_SCHEMA,
        schemaName: "document_summary",
      }
    );

    return {
      title: result.title || "Untitled Document",
      summary: result.summary || "No summary available",
      keywords: result.keywords || [],
      documentType: result.documentType || "other",
      fiscalYear: result.fiscalYear || null,
    };
  } catch (error) {
    console.error("Error summarizing document:", error);
    return {
      title: "Untitled Document",
      summary: "Summary generation failed",
      keywords: [],
      documentType: "other",
      fiscalYear: null,
    };
  }
}
