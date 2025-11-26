import { pool, db } from "../db/index.js";
import { generateEmbedding, streamChatCompletion, textCompletion } from "./openai.js";
import { documents, projects, entities, chunks } from "../db/schema.js";
import { eq, inArray, sql } from "drizzle-orm";
import { getPhaseInfo } from "./projectExtractor.js";

export interface RetrievedChunk {
  id: string;
  content: string;
  sectionTitle: string | null;
  documentId: string;
  documentTitle: string | null;
  documentUrl: string;
  entityName: string | null;
  similarity: number;
}

export interface RetrievedProject {
  id: string;
  title: string;
  description: string | null;
  phase: string;
  phaseInfo: ReturnType<typeof getPhaseInfo>;
  category: string | null;
  estimatedValue: string | null;
  fiscalYear: number | null;
  entityName: string | null;
  similarity: number;
}

export interface RAGContext {
  chunks: RetrievedChunk[];
  projects: RetrievedProject[];
}

const RAG_SYSTEM_PROMPT = `You are a Public Sector Sales Intelligence Assistant for Pursuit.us.
Your job is to help service providers find and WIN government contracts.

For EVERY response:
1. CITE SOURCES - Always reference document titles and provide context
2. IDENTIFY OPPORTUNITIES - Look for budget signals, project mentions, RFP indicators
3. PROVIDE POSITIONING - Suggest how to approach, what to say, who to contact
4. BE ACTIONABLE - End with specific next steps, not just information
5. HIGHLIGHT TIMING - Note fiscal years, budget cycles, procurement windows

When answering:
- Start with direct findings from documents
- Add "💡 Opportunity Signal" when you detect buying intent
- Include "Positioning Recommendation" section for sales context
- End with "Next Steps" or "Action Items"
- Use markdown formatting for readability
- Reference specific projects by phase when relevant

If you find relevant projects, mention their lifecycle phase:
- 🎯 Strategy: Early signal, mentioned in plans
- 💰 Budget: Funding allocated
- 👤 Contacts: Decision makers identified
- 📋 RFP Open: Active procurement
- ✅ Awarded: Contract given
- 🔄 In Progress: Work underway`;

/**
 * Search for relevant chunks using vector similarity
 */
export async function searchChunks(
  query: string,
  limit: number = 10
): Promise<RetrievedChunk[]> {
  const embedding = await generateEmbedding(query);
  return searchChunksWithEmbedding(embedding, limit);
}

/**
 * Search chunks with pre-computed embedding
 */
export async function searchChunksWithEmbedding(
  embedding: number[],
  limit: number = 10
): Promise<RetrievedChunk[]> {
  try {
    const result = await pool.query(
      `SELECT
        c.id,
        c.content,
        c.section_title,
        c.document_id,
        d.title as document_title,
        d.url as document_url,
        e.name as entity_name,
        1 - (c.embedding <=> $1::vector) as similarity
      FROM chunks c
      JOIN documents d ON c.document_id = d.id
      LEFT JOIN entities e ON d.org_id = e.id
      WHERE c.embedding IS NOT NULL
      ORDER BY c.embedding <=> $1::vector
      LIMIT $2`,
      [`[${embedding.join(",")}]`, limit]
    );

    return result.rows.map((row) => ({
      id: row.id,
      content: row.content,
      sectionTitle: row.section_title,
      documentId: row.document_id,
      documentTitle: row.document_title,
      documentUrl: row.document_url,
      entityName: row.entity_name,
      similarity: parseFloat(row.similarity),
    }));
  } catch (error: any) {
    console.error("[RAG] Error searching chunks:", error?.message || error);
    return [];
  }
}

/**
 * Search for relevant projects using vector similarity
 */
export async function searchProjects(
  query: string,
  limit: number = 5
): Promise<RetrievedProject[]> {
  const embedding = await generateEmbedding(query);
  return searchProjectsWithEmbedding(embedding, limit);
}

/**
 * Search projects with pre-computed embedding
 */
export async function searchProjectsWithEmbedding(
  embedding: number[],
  limit: number = 5
): Promise<RetrievedProject[]> {
  try {
    const result = await pool.query(
      `SELECT
        p.id,
        p.title,
        p.description,
        p.phase,
        p.category,
        p.estimated_value,
        p.fiscal_year,
        e.name as entity_name,
        1 - (p.embedding <=> $1::vector) as similarity
      FROM projects p
      LEFT JOIN entities e ON p.org_id = e.id
      WHERE p.embedding IS NOT NULL
      ORDER BY p.embedding <=> $1::vector
      LIMIT $2`,
      [`[${embedding.join(",")}]`, limit]
    );

    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      phase: row.phase,
      phaseInfo: getPhaseInfo(row.phase),
      category: row.category,
      estimatedValue: row.estimated_value,
      fiscalYear: row.fiscal_year,
      entityName: row.entity_name,
      similarity: parseFloat(row.similarity),
    }));
  } catch (error: any) {
    console.error("[RAG] Error searching projects:", error?.message || error);
    return [];
  }
}

/**
 * Retrieve context for RAG - uses single embedding for efficiency
 */
export async function retrieveContext(query: string): Promise<RAGContext> {
  console.log(`[RAG] Retrieving context for: "${query.slice(0, 50)}..."`);

  // Generate embedding once and reuse
  const embedding = await generateEmbedding(query);
  console.log(`[RAG] Generated embedding with ${embedding.length} dimensions`);

  // Search both in parallel using the same embedding
  const [relevantChunks, relevantProjects] = await Promise.all([
    searchChunksWithEmbedding(embedding, 10),
    searchProjectsWithEmbedding(embedding, 5),
  ]);

  console.log(`[RAG] Found ${relevantChunks.length} chunks, ${relevantProjects.length} projects`);

  if (relevantChunks.length > 0) {
    console.log(`[RAG] Top chunk: "${relevantChunks[0].documentTitle}" (similarity: ${relevantChunks[0].similarity.toFixed(3)})`);
  }

  return {
    chunks: relevantChunks,
    projects: relevantProjects,
  };
}

/**
 * Format context for prompt
 */
function formatContext(context: RAGContext): string {
  let formatted = "";

  // Format chunks
  if (context.chunks.length > 0) {
    formatted += "## Retrieved Documents\n\n";

    // Group chunks by document
    const byDoc = new Map<string, RetrievedChunk[]>();
    for (const chunk of context.chunks) {
      const key = chunk.documentId;
      if (!byDoc.has(key)) {
        byDoc.set(key, []);
      }
      byDoc.get(key)!.push(chunk);
    }

    for (const [docId, docChunks] of byDoc) {
      const first = docChunks[0];
      formatted += `### ${first.documentTitle || "Untitled"}\n`;
      formatted += `**Source**: ${first.documentUrl}\n`;
      if (first.entityName) {
        formatted += `**Entity**: ${first.entityName}\n`;
      }
      formatted += "\n";

      for (const chunk of docChunks) {
        if (chunk.sectionTitle) {
          formatted += `**${chunk.sectionTitle}**\n`;
        }
        formatted += `${chunk.content}\n\n`;
      }
    }
  }

  // Format projects
  if (context.projects.length > 0) {
    formatted += "\n## Related Projects in Pipeline\n\n";

    for (const project of context.projects) {
      const info = project.phaseInfo;
      formatted += `### ${info.emoji} ${project.title}\n`;
      formatted += `- **Phase**: ${info.label} - ${info.description}\n`;
      if (project.entityName) {
        formatted += `- **Entity**: ${project.entityName}\n`;
      }
      if (project.category) {
        formatted += `- **Category**: ${project.category}\n`;
      }
      if (project.estimatedValue) {
        formatted += `- **Est. Value**: $${Number(project.estimatedValue).toLocaleString()}\n`;
      }
      if (project.fiscalYear) {
        formatted += `- **Fiscal Year**: ${project.fiscalYear}\n`;
      }
      if (project.description) {
        formatted += `- **Description**: ${project.description}\n`;
      }
      formatted += "\n";
    }
  }

  return formatted;
}

/**
 * Generate RAG response (non-streaming)
 */
export async function generateResponse(
  query: string,
  context: RAGContext
): Promise<string> {
  const contextStr = formatContext(context);

  const userPrompt = `Context from retrieved documents and projects:

${contextStr}

---

User question: ${query}`;

  const response = await textCompletion(RAG_SYSTEM_PROMPT, userPrompt, {
    temperature: 0.7,
    maxTokens: 4096,
  });

  return response;
}

/**
 * Generate streaming RAG response
 */
export async function* generateStreamingResponse(
  query: string,
  context: RAGContext
): AsyncGenerator<string> {
  const contextStr = formatContext(context);

  const userPrompt = `Context from retrieved documents and projects:

${contextStr}

---

User question: ${query}`;

  yield* streamChatCompletion(RAG_SYSTEM_PROMPT, userPrompt, {
    temperature: 0.7,
    maxTokens: 4096,
  });
}
