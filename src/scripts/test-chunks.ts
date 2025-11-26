import "dotenv/config";
import { db } from "../db/index.js";
import { documents } from "../db/schema.js";
import { chunkDocument } from "../services/chunker.js";
import { generateEmbeddings } from "../services/openai.js";
import { eq } from "drizzle-orm";

async function test() {
  // Get a scraped document
  const docs = await db
    .select()
    .from(documents)
    .where(eq(documents.orgId, "boerneisd-net"))
    .limit(1);

  if (docs.length === 0) {
    console.log("No boerneisd-net documents found");
    return;
  }

  const doc = docs[0];
  console.log("Document URL:", doc.url);
  console.log("Content length:", doc.content?.length);
  console.log("Content preview:", doc.content?.slice(0, 500));
  console.log("\n--- Chunking ---");

  const chunks = chunkDocument(doc.content || "");
  console.log("Chunks created:", chunks.length);

  if (chunks.length > 0) {
    console.log("\nFirst chunk:");
    console.log("  Section:", chunks[0].sectionTitle);
    console.log("  Tokens:", chunks[0].tokenCount);
    console.log("  Content length:", chunks[0].content.length);
    console.log("  Content preview:", chunks[0].content.slice(0, 200));

    console.log("\n--- Testing embedding on chunk ---");
    try {
      const embedding = await generateEmbeddings([chunks[0].content]);
      console.log("Embedding success! Length:", embedding[0].length);
    } catch (error) {
      console.error("Embedding failed:", error);
    }
  }

  process.exit(0);
}

test();
