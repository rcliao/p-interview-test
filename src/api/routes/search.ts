import { Hono } from "hono";
import { searchChunks, searchProjects } from "../../services/rag.js";
import { db } from "../../db/index.js";
import { documents, entities } from "../../db/schema.js";
import { eq, ilike, sql } from "drizzle-orm";

const searchRouter = new Hono();

/**
 * GET /api/search
 * Search documents and projects
 */
searchRouter.get("/", async (c) => {
  const query = c.req.query("q");
  const limit = parseInt(c.req.query("limit") || "10");
  const type = c.req.query("type"); // 'documents' | 'projects' | 'all'

  if (!query) {
    return c.json({ error: "Query parameter 'q' is required" }, 400);
  }

  try {
    const searchType = type || "all";

    let results: any = {};

    if (searchType === "all" || searchType === "documents") {
      const chunks = await searchChunks(query, limit);

      // Deduplicate by document
      const seenDocs = new Set<string>();
      const uniqueDocs = chunks.filter((ch) => {
        if (seenDocs.has(ch.documentId)) return false;
        seenDocs.add(ch.documentId);
        return true;
      });

      results.documents = uniqueDocs.map((ch) => ({
        id: ch.documentId,
        title: ch.documentTitle,
        url: ch.documentUrl,
        entity: ch.entityName,
        matchedSection: ch.sectionTitle,
        excerpt: ch.content.slice(0, 300) + "...",
        relevance: ch.similarity,
      }));
    }

    if (searchType === "all" || searchType === "projects") {
      const projectResults = await searchProjects(query, limit);
      results.projects = projectResults.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        phase: p.phase,
        phaseLabel: p.phaseInfo.label,
        phaseEmoji: p.phaseInfo.emoji,
        category: p.category,
        estimatedValue: p.estimatedValue,
        entity: p.entityName,
        relevance: p.similarity,
      }));
    }

    return c.json(results);
  } catch (error) {
    console.error("Search error:", error);
    return c.json({ error: "Search failed" }, 500);
  }
});

/**
 * GET /api/entities
 * List all entities with stats
 */
searchRouter.get("/entities", async (c) => {
  try {
    // Get all data with counts using raw SQL to avoid type issues
    const { pool } = await import("../../db/index.js");
    const result = await pool.query(`
      SELECT
        e.id,
        e.name,
        e.type,
        e.state,
        e.website,
        (SELECT COUNT(*) FROM documents d WHERE d.org_id = e.id) as document_count,
        (SELECT COUNT(*) FROM projects p WHERE p.org_id = e.id) as project_count
      FROM entities e
      ORDER BY e.id
    `);

    const entitiesList = result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      state: r.state,
      website: r.website,
      documentCount: parseInt(r.document_count) || 0,
      projectCount: parseInt(r.project_count) || 0,
    }));

    return c.json({ entities: entitiesList });
  } catch (error) {
    console.error("Error fetching entities:", error);
    return c.json({ error: "Failed to fetch entities" }, 500);
  }
});

/**
 * GET /api/search/entities/:id
 * Get entity details with documents and projects
 */
searchRouter.get("/entities/:id", async (c) => {
  const entityId = c.req.param("id");

  try {
    const { pool } = await import("../../db/index.js");

    // Get entity details
    const entityResult = await pool.query(
      `SELECT id, name, type, state, website, created_at FROM entities WHERE id = $1`,
      [entityId]
    );

    if (entityResult.rows.length === 0) {
      return c.json({ error: "Entity not found" }, 404);
    }

    const entity = entityResult.rows[0];

    // Get documents for this entity
    const docsResult = await pool.query(
      `SELECT id, url, title, content_type, summary, keywords, fiscal_year, token_count, chunk_count, created_at
       FROM documents WHERE org_id = $1 ORDER BY created_at DESC`,
      [entityId]
    );

    // Get projects for this entity
    const projectsResult = await pool.query(
      `SELECT id, title, description, phase, phase_confidence, category, estimated_value, fiscal_year, keywords, created_at
       FROM projects WHERE org_id = $1 ORDER BY created_at DESC`,
      [entityId]
    );

    return c.json({
      entity: {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        state: entity.state,
        website: entity.website,
        createdAt: entity.created_at,
      },
      documents: docsResult.rows.map((d: any) => ({
        id: d.id,
        url: d.url,
        title: d.title,
        contentType: d.content_type,
        summary: d.summary,
        keywords: d.keywords,
        fiscalYear: d.fiscal_year,
        tokenCount: d.token_count,
        chunkCount: d.chunk_count,
        createdAt: d.created_at,
      })),
      projects: projectsResult.rows.map((p: any) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        phase: p.phase,
        phaseConfidence: p.phase_confidence,
        category: p.category,
        estimatedValue: p.estimated_value,
        fiscalYear: p.fiscal_year,
        keywords: p.keywords,
        createdAt: p.created_at,
      })),
    });
  } catch (error) {
    console.error("Error fetching entity:", error);
    return c.json({ error: "Failed to fetch entity" }, 500);
  }
});

export { searchRouter };
