import OpenAI from "openai";

// Initialize OpenAI client
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Embedding model
const EMBEDDING_MODEL = "text-embedding-3-small";

// Chat model - using latest available
const CHAT_MODEL = "gpt-4o"; // Will use gpt-4o as GPT-5.1 isn't available yet

// Retry configuration
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with exponential backoff retry on rate limit errors
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  operationName: string
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Check if it's a rate limit error
      if (error?.status === 429 || error?.code === "rate_limit_exceeded") {
        // Get retry delay from header or use exponential backoff
        const retryAfterMs = error?.headers?.["retry-after-ms"]
          ? parseInt(error.headers["retry-after-ms"])
          : INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);

        const delayMs = Math.min(retryAfterMs + 500, 60000); // Add buffer, max 60s

        console.log(
          `  ⏳ Rate limited on ${operationName}, retrying in ${(delayMs / 1000).toFixed(1)}s (attempt ${attempt + 1}/${MAX_RETRIES})`
        );

        await sleep(delayMs);
        continue;
      }

      // For non-rate-limit errors, throw immediately
      throw error;
    }
  }

  throw lastError || new Error(`Failed after ${MAX_RETRIES} retries`);
}

/**
 * Generate embeddings for text
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  return withRetry(async () => {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
    });
    return response.data[0].embedding;
  }, "embedding");
}

/**
 * Generate embeddings for multiple texts (batched)
 */
export async function generateEmbeddings(
  texts: string[]
): Promise<number[][]> {
  // OpenAI allows up to 2048 inputs per batch, but use smaller batches to avoid rate limits
  const batchSize = 50;
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    const batchEmbeddings = await withRetry(async () => {
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: batch,
      });
      return response.data.map((d) => d.embedding);
    }, "batch embeddings");

    embeddings.push(...batchEmbeddings);

    // Delay between batches to avoid rate limits
    if (i + batchSize < texts.length) {
      await sleep(500);
    }
  }

  return embeddings;
}

/**
 * Chat completion with JSON response using structured outputs
 */
export async function chatCompletion<T>(
  systemPrompt: string,
  userPrompt: string,
  options?: {
    temperature?: number;
    maxTokens?: number;
    schema?: object;
    schemaName?: string;
  }
): Promise<T> {
  return withRetry(async () => {
    const messages = [
      { role: "system" as const, content: systemPrompt + "\n\nRespond with valid JSON." },
      { role: "user" as const, content: userPrompt },
    ];

    const requestOptions: any = {
      model: CHAT_MODEL,
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 4096,
    };

    // Use structured outputs if schema provided, otherwise use json_object
    if (options?.schema) {
      requestOptions.response_format = {
        type: "json_schema",
        json_schema: {
          name: options.schemaName || "response",
          schema: options.schema,
          strict: true,
        },
      };
    } else {
      requestOptions.response_format = { type: "json_object" };
    }

    const response = await openai.chat.completions.create(requestOptions);

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    return JSON.parse(content) as T;
  }, options?.schemaName || "chat completion");
}

/**
 * Chat completion with streaming (for RAG responses)
 */
export async function* streamChatCompletion(
  systemPrompt: string,
  userPrompt: string,
  options?: {
    temperature?: number;
    maxTokens?: number;
  }
): AsyncGenerator<string> {
  const stream = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 4096,
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      yield content;
    }
  }
}

/**
 * Simple text completion without JSON parsing
 */
export async function textCompletion(
  systemPrompt: string,
  userPrompt: string,
  options?: {
    temperature?: number;
    maxTokens?: number;
  }
): Promise<string> {
  return withRetry(async () => {
    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
    });

    return response.choices[0]?.message?.content || "";
  }, "text completion");
}
