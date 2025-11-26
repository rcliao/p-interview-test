import { chatCompletion } from "./openai.js";
import type { ProjectPhase } from "../db/schema.js";

export interface ExtractedProject {
  title: string;
  description: string;
  phase: ProjectPhase;
  phaseReasoning: string;
  phaseConfidence: number;
  category: string;
  estimatedValue: number | null;
  fiscalYear: number | null;
  timelineNotes: string | null;
  contacts: Array<{
    name: string;
    title?: string;
    email?: string;
    phone?: string;
    context?: string;
  }>;
  evidenceExcerpts: string[];
  keywords: string[];
}

export interface ProjectExtractionResult {
  projects: ExtractedProject[];
}

// JSON Schema for structured outputs (strict mode requires all props in required)
const PROJECT_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    projects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Project name or initiative title" },
          description: { type: "string", description: "Brief description of what the project entails" },
          phase: {
            type: "string",
            enum: ["strategy", "budget", "contacts", "rfp_open", "awarded", "in_progress"],
            description: "Lifecycle phase of the project"
          },
          phaseReasoning: { type: "string", description: "Explanation for the phase classification" },
          phaseConfidence: { type: "number", description: "Confidence score 0-1" },
          category: {
            type: "string",
            enum: ["technology", "infrastructure", "consulting", "facilities", "services", "other"],
            description: "Category of the project"
          },
          estimatedValue: { type: ["number", "null"], description: "Estimated value in dollars" },
          fiscalYear: { type: ["integer", "null"], description: "Fiscal year" },
          timelineNotes: { type: ["string", "null"], description: "Timeline information" },
          contacts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                title: { type: "string" },
                context: { type: "string" }
              },
              required: ["name", "title", "context"],
              additionalProperties: false
            }
          },
          evidenceExcerpts: {
            type: "array",
            items: { type: "string" },
            description: "Direct quotes from the document"
          },
          keywords: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["title", "description", "phase", "phaseReasoning", "phaseConfidence", "category", "estimatedValue", "fiscalYear", "timelineNotes", "contacts", "evidenceExcerpts", "keywords"],
        additionalProperties: false
      }
    }
  },
  required: ["projects"],
  additionalProperties: false
};

const PROJECT_EXTRACTION_PROMPT = `You are an expert at analyzing government documents to identify procurement opportunities and projects.

Analyze this document and extract any projects, initiatives, or procurement opportunities mentioned.

For each project found, return:
{
  "projects": [
    {
      "title": "Project name or initiative title",
      "description": "Brief description of what the project entails",
      "phase": "strategy|budget|contacts|rfp_open|awarded|in_progress",
      "phaseReasoning": "Explain why you classified it in this phase",
      "phaseConfidence": 0.85,
      "category": "technology|infrastructure|consulting|facilities|services|other",
      "estimatedValue": 2000000 (number in dollars, or null if unknown),
      "fiscalYear": 2024 (or null if not mentioned),
      "timelineNotes": "Expected timeline information",
      "contacts": [
        {"name": "John Smith", "title": "CTO", "context": "leading the initiative"}
      ],
      "evidenceExcerpts": [
        "Direct quotes from the document that support this project identification..."
      ],
      "keywords": ["relevant", "search", "terms"]
    }
  ]
}

Phase Classification Guide:
- strategy: Project mentioned in plans, goals, or strategy documents. No specific budget allocated yet. Earliest signal.
- budget: Specific funding has been allocated or approved for this project. Money is earmarked.
- contacts: A named person is responsible for the project. Decision maker identified but no RFP yet.
- rfp_open: Active RFP, RFQ, or bid request is published with a deadline. Time-sensitive opportunity.
- awarded: Contract has been awarded to a vendor. Winner announced.
- in_progress: Work is actively underway. May have subcontracting or future phase opportunities.

Important:
- Only extract genuine projects/initiatives, not general operational activities
- Include direct quotes as evidence
- Be conservative with phase classification - when uncertain, choose earlier phase
- If no projects found, return {"projects": []}`;

/**
 * Extract projects from a document
 */
export async function extractProjects(
  content: string,
  documentUrl: string
): Promise<ExtractedProject[]> {
  // Truncate very long documents
  const maxChars = 25000;
  const truncatedContent =
    content.length > maxChars
      ? content.slice(0, maxChars) + "\n\n[Document truncated...]"
      : content;

  const prompt = `Document URL: ${documentUrl}

Document Content:
${truncatedContent}`;

  try {
    const result = await chatCompletion<ProjectExtractionResult>(
      PROJECT_EXTRACTION_PROMPT,
      prompt,
      {
        temperature: 0.3,
        maxTokens: 4096,
        schema: PROJECT_EXTRACTION_SCHEMA,
        schemaName: "project_extraction",
      }
    );

    // Validate and normalize the results
    return (result.projects || []).map((p) => ({
      title: p.title || "Unnamed Project",
      description: p.description || "",
      phase: validatePhase(p.phase),
      phaseReasoning: p.phaseReasoning || "",
      phaseConfidence: Math.min(1, Math.max(0, p.phaseConfidence || 0.5)),
      category: p.category || "other",
      estimatedValue: p.estimatedValue,
      fiscalYear: p.fiscalYear,
      timelineNotes: p.timelineNotes,
      contacts: p.contacts || [],
      evidenceExcerpts: p.evidenceExcerpts || [],
      keywords: p.keywords || [],
    }));
  } catch (error) {
    console.error("Error extracting projects:", error);
    return [];
  }
}

/**
 * Validate and normalize phase value
 */
function validatePhase(phase: string): ProjectPhase {
  const validPhases: ProjectPhase[] = [
    "strategy",
    "budget",
    "contacts",
    "rfp_open",
    "awarded",
    "in_progress",
  ];

  const normalized = phase?.toLowerCase().replace(/[^a-z_]/g, "") as ProjectPhase;

  if (validPhases.includes(normalized)) {
    return normalized;
  }

  // Default to strategy (earliest phase) if unknown
  return "strategy";
}

/**
 * Get phase display info
 */
export function getPhaseInfo(phase: ProjectPhase): {
  label: string;
  emoji: string;
  description: string;
  priority: number;
} {
  const phaseInfo: Record<
    ProjectPhase,
    { label: string; emoji: string; description: string; priority: number }
  > = {
    strategy: {
      label: "Strategy",
      emoji: "🎯",
      description: "Mentioned in plans/goals, no budget yet",
      priority: 1,
    },
    budget: {
      label: "Budget",
      emoji: "💰",
      description: "Funding allocated or approved",
      priority: 2,
    },
    contacts: {
      label: "Contacts",
      emoji: "👤",
      description: "Decision makers identified",
      priority: 3,
    },
    rfp_open: {
      label: "RFP Open",
      emoji: "📋",
      description: "Active RFP accepting bids",
      priority: 4,
    },
    awarded: {
      label: "Awarded",
      emoji: "✅",
      description: "Contract awarded",
      priority: 5,
    },
    in_progress: {
      label: "In Progress",
      emoji: "🔄",
      description: "Work underway",
      priority: 6,
    },
  };

  return phaseInfo[phase] || phaseInfo.strategy;
}
