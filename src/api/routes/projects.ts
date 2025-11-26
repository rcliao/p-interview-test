import { Hono } from "hono";
import { db, pool } from "../../db/index.js";
import { projects, projectEvidence, documents, entities } from "../../db/schema.js";
import { eq, sql, desc, asc, inArray } from "drizzle-orm";
import { getPhaseInfo, type ExtractedProject } from "../../services/projectExtractor.js";
import type { ProjectPhase } from "../../db/schema.js";

const projectsRouter = new Hono();

/**
 * GET /api/projects
 * List all projects with optional filters
 */
projectsRouter.get("/", async (c) => {
  const phase = c.req.query("phase");
  const category = c.req.query("category");
  const orgId = c.req.query("org_id");

  try {
    let query = db
      .select({
        id: projects.id,
        title: projects.title,
        description: projects.description,
        phase: projects.phase,
        phaseConfidence: projects.phaseConfidence,
        category: projects.category,
        estimatedValue: projects.estimatedValue,
        fiscalYear: projects.fiscalYear,
        timelineNotes: projects.timelineNotes,
        contacts: projects.contacts,
        keywords: projects.keywords,
        orgId: projects.orgId,
        entityName: entities.name,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .leftJoin(entities, eq(projects.orgId, entities.id))
      .orderBy(desc(projects.createdAt));

    // TODO: Add filters when drizzle supports dynamic where

    const result = await query;

    // Filter in JS for now (small dataset)
    let filtered = result;
    if (phase) {
      filtered = filtered.filter((p) => p.phase === phase);
    }
    if (category) {
      filtered = filtered.filter((p) => p.category === category);
    }
    if (orgId) {
      filtered = filtered.filter((p) => p.orgId === orgId);
    }

    const projectsWithPhaseInfo = filtered.map((p) => ({
      ...p,
      phaseInfo: getPhaseInfo(p.phase as ProjectPhase),
    }));

    return c.json({
      projects: projectsWithPhaseInfo,
      total: projectsWithPhaseInfo.length,
    });
  } catch (error) {
    console.error("Error fetching projects:", error);
    return c.json({ error: "Failed to fetch projects" }, 500);
  }
});

/**
 * GET /api/projects/pipeline
 * Get projects grouped by lifecycle phase
 */
projectsRouter.get("/pipeline", async (c) => {
  try {
    const allProjects = await db
      .select({
        id: projects.id,
        title: projects.title,
        description: projects.description,
        phase: projects.phase,
        phaseConfidence: projects.phaseConfidence,
        category: projects.category,
        estimatedValue: projects.estimatedValue,
        fiscalYear: projects.fiscalYear,
        orgId: projects.orgId,
        entityName: entities.name,
      })
      .from(projects)
      .leftJoin(entities, eq(projects.orgId, entities.id));

    // Group by phase
    const phases: ProjectPhase[] = [
      "strategy",
      "budget",
      "contacts",
      "rfp_open",
      "awarded",
      "in_progress",
    ];

    const pipeline: Record<string, any> = {};
    for (const phase of phases) {
      const info = getPhaseInfo(phase);
      pipeline[phase] = {
        label: info.label,
        emoji: info.emoji,
        description: info.description,
        projects: allProjects
          .filter((p) => p.phase === phase)
          .map((p) => ({
            ...p,
            phaseInfo: info,
          })),
        count: allProjects.filter((p) => p.phase === phase).length,
      };
    }

    // Summary stats
    const summary = {
      total: allProjects.length,
      byPhase: phases.map((phase) => ({
        phase,
        ...getPhaseInfo(phase),
        count: allProjects.filter((p) => p.phase === phase).length,
      })),
      totalEstimatedValue: allProjects
        .filter((p) => p.estimatedValue)
        .reduce((sum, p) => sum + Number(p.estimatedValue), 0),
    };

    return c.json({ pipeline, summary });
  } catch (error) {
    console.error("Error fetching pipeline:", error);
    return c.json({ error: "Failed to fetch pipeline" }, 500);
  }
});

/**
 * GET /api/projects/:id
 * Get a single project with evidence
 */
projectsRouter.get("/:id", async (c) => {
  const projectId = c.req.param("id");

  try {
    // Get project
    const [project] = await db
      .select({
        id: projects.id,
        title: projects.title,
        description: projects.description,
        phase: projects.phase,
        phaseConfidence: projects.phaseConfidence,
        phaseReasoning: projects.phaseReasoning,
        category: projects.category,
        estimatedValue: projects.estimatedValue,
        fiscalYear: projects.fiscalYear,
        timelineNotes: projects.timelineNotes,
        contacts: projects.contacts,
        keywords: projects.keywords,
        sourceDocuments: projects.sourceDocuments,
        orgId: projects.orgId,
        entityName: entities.name,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .leftJoin(entities, eq(projects.orgId, entities.id))
      .where(eq(projects.id, projectId));

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    // Get evidence
    const evidence = await db
      .select({
        id: projectEvidence.id,
        evidenceType: projectEvidence.evidenceType,
        excerpt: projectEvidence.excerpt,
        confidence: projectEvidence.confidence,
        documentId: projectEvidence.documentId,
        documentTitle: documents.title,
        documentUrl: documents.url,
      })
      .from(projectEvidence)
      .leftJoin(documents, eq(projectEvidence.documentId, documents.id))
      .where(eq(projectEvidence.projectId, projectId));

    // Get source documents
    const sourceDocIds = (project.sourceDocuments || []) as string[];
    let sourceDocs: any[] = [];
    if (sourceDocIds.length > 0) {
      sourceDocs = await db
        .select({
          id: documents.id,
          title: documents.title,
          url: documents.url,
          summary: documents.summary,
          contentType: documents.contentType,
        })
        .from(documents)
        .where(inArray(documents.id, sourceDocIds));
    }

    return c.json({
      project: {
        ...project,
        phaseInfo: getPhaseInfo(project.phase as ProjectPhase),
      },
      evidence,
      sourceDocuments: sourceDocs,
    });
  } catch (error) {
    console.error("Error fetching project:", error);
    return c.json({ error: "Failed to fetch project" }, 500);
  }
});

export { projectsRouter };
