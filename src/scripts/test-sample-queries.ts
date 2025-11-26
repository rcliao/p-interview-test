import "dotenv/config";
import { pool } from "../db/index.js";
import { retrieveContext, generateResponse } from "../services/rag.js";

const SAMPLE_QUERIES = [
  "What's the operating budget for year 2025?",
  "Give me a summary of all operating expenses",
  "What is the top priorities of Entity A's agenda?",
  "How many infrastructure projects are planned for Q3 2025?",
  "What are the main environmental initiatives across all entities?",
  "When is the next city council meeting scheduled for Entity G?",
  "Extract all sustainability goals mentioned in the documents",
];

async function testSampleQueries() {
  console.log("🧪 Testing Sample Queries\n");
  console.log("=".repeat(70));

  for (let i = 0; i < SAMPLE_QUERIES.length; i++) {
    const query = SAMPLE_QUERIES[i];
    console.log(`\n📝 Query ${i + 1}: "${query}"\n`);
    console.log("-".repeat(70));

    try {
      // Retrieve context
      const context = await retrieveContext(query);

      console.log(`✅ Retrieved: ${context.chunks.length} chunks, ${context.projects.length} projects`);

      if (context.chunks.length > 0) {
        console.log("\n📄 Top 3 Chunks:");
        for (const chunk of context.chunks.slice(0, 3)) {
          console.log(`   • "${chunk.documentTitle}" (${chunk.similarity.toFixed(3)})`);
          console.log(`     Section: ${chunk.sectionTitle}`);
          console.log(`     Preview: "${chunk.content.slice(0, 100).replace(/\n/g, " ")}..."`);
        }
      }

      if (context.projects.length > 0) {
        console.log("\n🎯 Top 3 Projects:");
        for (const proj of context.projects.slice(0, 3)) {
          console.log(`   • "${proj.title}" [${proj.phase}] (${proj.similarity.toFixed(3)})`);
          if (proj.entityName) console.log(`     Entity: ${proj.entityName}`);
        }
      }

      // Generate response (optional - comment out to save API calls)
      // console.log("\n💬 Generating response...");
      // const response = await generateResponse(query, context);
      // console.log(`\n📣 Response:\n${response.slice(0, 500)}...`);

    } catch (error: any) {
      console.log(`❌ Error: ${error.message}`);
    }

    console.log("\n" + "=".repeat(70));
  }

  // Summary stats
  console.log("\n📊 Database Stats:");
  const stats = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM entities) as entities,
      (SELECT COUNT(*) FROM documents) as documents,
      (SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL) as chunks_with_embedding,
      (SELECT COUNT(*) FROM projects WHERE embedding IS NOT NULL) as projects_with_embedding
  `);
  console.log(`   Entities: ${stats.rows[0].entities}`);
  console.log(`   Documents: ${stats.rows[0].documents}`);
  console.log(`   Chunks (with embeddings): ${stats.rows[0].chunks_with_embedding}`);
  console.log(`   Projects (with embeddings): ${stats.rows[0].projects_with_embedding}`);

  console.log("\n✅ All sample queries tested!\n");
  await pool.end();
}

testSampleQueries().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
