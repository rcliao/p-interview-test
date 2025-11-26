import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { db, pool } from "../db/index.js";
import {
  entities,
  documents,
  chunks,
  projects,
  projectEvidence,
} from "../db/schema.js";
import { chunkDocument, getDocumentTokenCount } from "../services/chunker.js";
import { generateEmbeddings } from "../services/openai.js";
import { summarizeDocument } from "../services/summarizer.js";
import { extractProjects } from "../services/projectExtractor.js";
import { extractEntityInfo } from "../services/entityExtractor.js";
import { eq, sql } from "drizzle-orm";

const DATA_DIR = path.join(process.cwd(), "data");

interface RawDocument {
  url: string;
  org_id: string;
  url_id: string;
  text: string;
}

/**
 * Main ingestion function
 */
async function ingest() {
  console.log("🚀 Starting data ingestion...\n");

  // Get all entity folders
  const entityFolders = await fs.readdir(DATA_DIR);
  console.log(`Found ${entityFolders.length} entity folders\n`);

  let totalDocs = 0;
  let totalChunks = 0;
  let totalProjects = 0;
  let skippedDocs = 0;

  for (const entityId of entityFolders) {
    const entityPath = path.join(DATA_DIR, entityId);
    const stat = await fs.stat(entityPath);

    if (!stat.isDirectory()) continue;

    console.log(`\n📁 Processing entity: ${entityId}`);

    // Create or get entity
    await db
      .insert(entities)
      .values({ id: entityId })
      .onConflictDoNothing();

    // Get all JSON files in this entity folder
    const files = await fs.readdir(entityPath);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    // Track processed documents for entity extraction
    const processedDocs: Array<{ url: string; title: string; content: string }> = [];
    let entityWebsite: string | null = null;

    for (const jsonFile of jsonFiles) {
      const filePath = path.join(entityPath, jsonFile);

      try {
        const content = await fs.readFile(filePath, "utf-8");
        const rawDoc: RawDocument = JSON.parse(content);

        // Skip empty documents
        if (!rawDoc.text || rawDoc.text.trim().length < 50) {
          console.log(`  ⏭️  Skipping empty doc: ${jsonFile}`);
          skippedDocs++;
          continue;
        }

        // Track website for entity extraction
        if (!entityWebsite && rawDoc.url) {
          try {
            const urlObj = new URL(rawDoc.url);
            entityWebsite = `${urlObj.protocol}//${urlObj.hostname}`;
          } catch {}
        }

        console.log(`  📄 Processing: ${rawDoc.url.slice(0, 60)}...`);

        // Check if document already exists
        const existing = await db
          .select()
          .from(documents)
          .where(eq(documents.url, rawDoc.url))
          .limit(1);

        if (existing.length > 0) {
          console.log(`    ⏭️  Already exists, skipping`);
          // Still add to processed docs for entity extraction
          processedDocs.push({
            url: rawDoc.url,
            title: existing[0].title || "",
            content: rawDoc.text,
          });
          continue;
        }

        // Generate summary and metadata
        console.log(`    📝 Generating summary...`);
        const summary = await summarizeDocument(rawDoc.text, rawDoc.url);

        // Chunk the document
        const docChunks = chunkDocument(rawDoc.text);
        console.log(`    🔪 Created ${docChunks.length} chunks`);

        // Insert document
        const [insertedDoc] = await db
          .insert(documents)
          .values({
            url: rawDoc.url,
            urlId: rawDoc.url_id,
            orgId: rawDoc.org_id,
            title: summary.title,
            content: rawDoc.text,
            contentType: summary.documentType,
            summary: summary.summary,
            keywords: summary.keywords,
            fiscalYear: summary.fiscalYear,
            tokenCount: getDocumentTokenCount(rawDoc.text),
            chunkCount: docChunks.length,
          })
          .returning();

        totalDocs++;

        // Track for entity extraction
        processedDocs.push({
          url: rawDoc.url,
          title: summary.title || "",
          content: rawDoc.text,
        });

        // Generate embeddings for all chunks
        if (docChunks.length > 0) {
          console.log(`    🧠 Generating embeddings...`);
          const chunkTexts = docChunks.map((c) => c.content);
          const embeddings = await generateEmbeddings(chunkTexts);

          // Insert chunks with embeddings
          for (let i = 0; i < docChunks.length; i++) {
            const chunk = docChunks[i];

            // Use raw SQL for vector insertion
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

          totalChunks += docChunks.length;
        }

        // Extract projects from document
        console.log(`    🔍 Extracting projects...`);
        const extractedProjects = await extractProjects(rawDoc.text, rawDoc.url);

        for (const proj of extractedProjects) {
          console.log(`      📌 Found project: ${proj.title} (${proj.phase})`);

          // Generate embedding for project
          const projEmbedding = (
            await generateEmbeddings([`${proj.title} ${proj.description}`])
          )[0];

          // Insert project using raw SQL for vector
          const projResult = await pool.query(
            `INSERT INTO projects (
              org_id, title, description, phase, phase_confidence, phase_reasoning,
              category, estimated_value, fiscal_year, timeline_notes, contacts,
              source_documents, keywords, embedding
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING id`,
            [
              rawDoc.org_id,
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

          // Insert evidence for each excerpt
          for (const excerpt of proj.evidenceExcerpts) {
            await db.insert(projectEvidence).values({
              projectId,
              documentId: insertedDoc.id,
              evidenceType: "phase_signal",
              excerpt,
              confidence: proj.phaseConfidence,
            });
          }

          totalProjects++;
        }

        // Small delay to avoid rate limits
        await new Promise((r) => setTimeout(r, 500));
      } catch (error) {
        console.error(`    ❌ Error processing ${jsonFile}:`, error);
      }
    }

    // Extract and update entity information using LLM
    if (processedDocs.length > 0 && entityWebsite) {
      console.log(`\n  🏢 Extracting entity information for ${entityId}...`);
      try {
        const entityInfo = await extractEntityInfo(processedDocs, entityWebsite);

        if (entityInfo && entityInfo.confidence >= 0.5) {
          console.log(`    ✅ Extracted: ${entityInfo.name}`);
          console.log(`       Type: ${entityInfo.type}`);
          if (entityInfo.state) {
            console.log(`       State: ${entityInfo.state}`);
          }
          console.log(`       Confidence: ${(entityInfo.confidence * 100).toFixed(0)}%`);

          // Update entity in database
          await db
            .update(entities)
            .set({
              name: entityInfo.name,
              type: entityInfo.type,
              state: entityInfo.state,
              website: entityWebsite,
            })
            .where(eq(entities.id, entityId));
        } else {
          console.log(`    ⚠️  Could not extract entity info with high confidence`);
        }
      } catch (error) {
        console.error(`    ⚠️  Entity extraction failed:`, error);
      }
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("📊 Ingestion Summary:");
  console.log(`   Documents processed: ${totalDocs}`);
  console.log(`   Documents skipped: ${skippedDocs}`);
  console.log(`   Chunks created: ${totalChunks}`);
  console.log(`   Projects extracted: ${totalProjects}`);
  console.log("=".repeat(50) + "\n");

  // Create HNSW vector indexes if not exists
  // HNSW is better than IVFFlat for smaller datasets - no training phase needed
  console.log("🔧 Creating vector indexes (HNSW)...");
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chunks_embedding
      ON chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_projects_embedding
      ON projects USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)
    `);
    console.log("✅ Vector indexes created\n");
  } catch (err) {
    console.log("⚠️  Vector indexes may already exist\n");
  }

  console.log("✅ Ingestion complete!");
  await pool.end();
}

// Run ingestion
ingest().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
