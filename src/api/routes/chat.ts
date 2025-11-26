import { Hono } from "hono";
import { stream } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  retrieveContext,
  generateResponse,
  generateStreamingResponse,
} from "../../services/rag.js";
import { db } from "../../db/index.js";
import { chatSessions } from "../../db/schema.js";

const chatRouter = new Hono();

const chatRequestSchema = z.object({
  query: z.string().min(1).max(2000),
  stream: z.boolean().optional().default(false),
  filters: z
    .object({
      orgId: z.string().optional(),
      phase: z.string().optional(),
      category: z.string().optional(),
    })
    .optional(),
});

/**
 * POST /api/chat
 * Main chat endpoint with RAG
 */
chatRouter.post("/", zValidator("json", chatRequestSchema), async (c) => {
  const { query, stream: useStreaming } = c.req.valid("json");

  try {
    // Retrieve relevant context
    const context = await retrieveContext(query);

    if (useStreaming) {
      // Streaming response
      return stream(c, async (stream) => {
        let fullResponse = "";

        for await (const chunk of generateStreamingResponse(query, context)) {
          fullResponse += chunk;
          await stream.write(chunk);
        }

        // Save to chat history (async, don't wait)
        db.insert(chatSessions)
          .values({
            query,
            response: fullResponse,
            matchedDocs: context.chunks.map((ch) => ({
              id: ch.documentId,
              title: ch.documentTitle,
              url: ch.documentUrl,
            })),
            matchedProjects: context.projects.map((p) => ({
              id: p.id,
              title: p.title,
              phase: p.phase,
            })),
          })
          .catch(console.error);
      });
    } else {
      // Non-streaming response
      const response = await generateResponse(query, context);

      // Save to chat history
      await db.insert(chatSessions).values({
        query,
        response,
        matchedDocs: context.chunks.map((ch) => ({
          id: ch.documentId,
          title: ch.documentTitle,
          url: ch.documentUrl,
        })),
        matchedProjects: context.projects.map((p) => ({
          id: p.id,
          title: p.title,
          phase: p.phase,
        })),
      });

      return c.json({
        answer: response,
        sources: context.chunks.slice(0, 5).map((ch) => ({
          documentId: ch.documentId,
          title: ch.documentTitle,
          url: ch.documentUrl,
          section: ch.sectionTitle,
          entity: ch.entityName,
          relevance: ch.similarity,
        })),
        projects: context.projects.map((p) => ({
          id: p.id,
          title: p.title,
          phase: p.phase,
          phaseLabel: p.phaseInfo.label,
          phaseEmoji: p.phaseInfo.emoji,
          category: p.category,
          estimatedValue: p.estimatedValue,
          entity: p.entityName,
          relevance: p.similarity,
        })),
      });
    }
  } catch (error) {
    console.error("Chat error:", error);
    return c.json({ error: "Failed to process chat request" }, 500);
  }
});

export { chatRouter };
