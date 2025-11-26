import "dotenv/config";
import { generateEmbeddings } from "../services/openai.js";

async function test() {
  try {
    console.log("Testing embedding generation...");
    console.log("OPENAI_API_KEY set:", !!process.env.OPENAI_API_KEY);

    const result = await generateEmbeddings(["Test embedding for Boerne ISD budget"]);
    console.log("Success! Embedding length:", result[0].length);
  } catch (error) {
    console.error("Error details:", error);
  }
}

test();
