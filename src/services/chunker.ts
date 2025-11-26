import { encode } from "gpt-tokenizer";

export interface ChunkResult {
  sectionTitle: string;
  content: string;
  tokenCount: number;
  chunkIndex: number;
}

// Configuration
const MAX_CHUNK_TOKENS = 1000;
const MIN_CHUNK_TOKENS = 100;
const OVERLAP_TOKENS = 50;

/**
 * Count tokens in a string using GPT tokenizer
 */
export function countTokens(text: string): number {
  return encode(text).length;
}

/**
 * Split markdown by headers while preserving hierarchy
 */
function splitByHeaders(markdown: string): Array<{ title: string; content: string }> {
  // Match headers (## or ###) and their content
  const headerRegex = /^(#{2,3})\s+(.+)$/gm;
  const sections: Array<{ title: string; content: string }> = [];

  let lastIndex = 0;
  let lastTitle = "Introduction";
  let match;

  // Find all headers
  const matches: Array<{ index: number; title: string; level: number }> = [];
  while ((match = headerRegex.exec(markdown)) !== null) {
    matches.push({
      index: match.index,
      title: match[2].trim(),
      level: match[1].length,
    });
  }

  // If no headers found, return whole doc as one section
  if (matches.length === 0) {
    return [{ title: "Document", content: markdown.trim() }];
  }

  // Extract content before first header
  if (matches[0].index > 0) {
    const introContent = markdown.slice(0, matches[0].index).trim();
    if (introContent) {
      sections.push({ title: "Introduction", content: introContent });
    }
  }

  // Extract content for each header
  for (let i = 0; i < matches.length; i++) {
    const currentMatch = matches[i];
    const nextMatch = matches[i + 1];

    const startIndex = currentMatch.index;
    const endIndex = nextMatch ? nextMatch.index : markdown.length;

    // Get content after the header line
    const headerLineEnd = markdown.indexOf("\n", startIndex);
    const contentStart = headerLineEnd !== -1 ? headerLineEnd + 1 : startIndex;
    const content = markdown.slice(contentStart, endIndex).trim();

    if (content) {
      sections.push({
        title: currentMatch.title,
        content: content,
      });
    }
  }

  return sections;
}

/**
 * Split content by paragraphs
 */
function splitByParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Split an oversized paragraph into smaller pieces
 * First tries splitting by sentences, then by fixed token chunks
 */
function splitOversizedParagraph(text: string): string[] {
  const tokens = countTokens(text);

  if (tokens <= MAX_CHUNK_TOKENS) {
    return [text];
  }

  // Try splitting by sentences first
  const sentenceRegex = /(?<=[.!?])\s+(?=[A-Z])/g;
  const sentences = text.split(sentenceRegex).filter(s => s.trim().length > 0);

  if (sentences.length > 1) {
    // Group sentences into chunks that fit within MAX_CHUNK_TOKENS
    const chunks: string[] = [];
    let currentChunk = "";
    let currentTokens = 0;

    for (const sentence of sentences) {
      const sentenceTokens = countTokens(sentence);

      if (sentenceTokens > MAX_CHUNK_TOKENS) {
        // Sentence itself is too big, save current chunk and split sentence by words
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }
        chunks.push(...splitByTokenCount(sentence));
        currentChunk = "";
        currentTokens = 0;
      } else if (currentTokens + sentenceTokens > MAX_CHUNK_TOKENS) {
        // Save current chunk and start new one
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = sentence;
        currentTokens = sentenceTokens;
      } else {
        currentChunk += (currentChunk ? " " : "") + sentence;
        currentTokens += sentenceTokens;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  // No sentence boundaries found, split by token count
  return splitByTokenCount(text);
}

/**
 * Split text into chunks of roughly MAX_CHUNK_TOKENS tokens
 * Tries to split at word boundaries
 */
function splitByTokenCount(text: string): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;

  for (const word of words) {
    const wordTokens = countTokens(word + " ");

    if (currentTokens + wordTokens > MAX_CHUNK_TOKENS && currentChunk.length > 0) {
      chunks.push(currentChunk.join(" "));
      currentChunk = [word];
      currentTokens = wordTokens;
    } else {
      currentChunk.push(word);
      currentTokens += wordTokens;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(" "));
  }

  return chunks;
}

/**
 * Merge small consecutive chunks
 */
function mergeSmallSections(
  sections: Array<{ title: string; content: string }>
): Array<{ title: string; content: string }> {
  const merged: Array<{ title: string; content: string }> = [];

  for (const section of sections) {
    const tokens = countTokens(section.content);

    if (tokens < MIN_CHUNK_TOKENS && merged.length > 0) {
      // Merge with previous section
      const prev = merged[merged.length - 1];
      prev.content += "\n\n" + section.content;
      prev.title = prev.title; // Keep original title
    } else {
      merged.push({ ...section });
    }
  }

  return merged;
}

/**
 * Split large section into smaller chunks
 */
function splitLargeSection(
  title: string,
  content: string,
  startIndex: number
): ChunkResult[] {
  const chunks: ChunkResult[] = [];
  const paragraphs = splitByParagraphs(content);

  // Expand any oversized paragraphs
  const expandedParagraphs: string[] = [];
  for (const para of paragraphs) {
    const paraTokens = countTokens(para);
    if (paraTokens > MAX_CHUNK_TOKENS) {
      // This paragraph is too big, split it further
      expandedParagraphs.push(...splitOversizedParagraph(para));
    } else {
      expandedParagraphs.push(para);
    }
  }

  let currentChunk = "";
  let currentTokens = 0;
  let chunkNum = 0;

  for (const para of expandedParagraphs) {
    const paraTokens = countTokens(para);

    if (currentTokens + paraTokens > MAX_CHUNK_TOKENS && currentChunk) {
      // Save current chunk
      chunks.push({
        sectionTitle: chunkNum === 0 ? title : `${title} (continued)`,
        content: currentChunk.trim(),
        tokenCount: currentTokens,
        chunkIndex: startIndex + chunkNum,
      });
      chunkNum++;

      // Start new chunk with overlap
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-Math.floor(OVERLAP_TOKENS / 2));
      currentChunk = overlapWords.join(" ") + "\n\n" + para;
      currentTokens = countTokens(currentChunk);
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + para;
      currentTokens += paraTokens;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push({
      sectionTitle: chunkNum === 0 ? title : `${title} (continued)`,
      content: currentChunk.trim(),
      tokenCount: countTokens(currentChunk),
      chunkIndex: startIndex + chunkNum,
    });
  }

  return chunks;
}

/**
 * Chunk a markdown document into smaller pieces for embedding
 *
 * Strategy:
 * 1. Split by markdown headers (## and ###)
 * 2. Merge sections that are too small (< MIN_CHUNK_TOKENS)
 * 3. Split sections that are too large (> MAX_CHUNK_TOKENS) by paragraphs
 * 4. Add overlap between chunks
 */
export function chunkDocument(markdown: string): ChunkResult[] {
  if (!markdown || markdown.trim().length === 0) {
    return [];
  }

  // Step 1: Split by headers
  let sections = splitByHeaders(markdown);

  // Step 2: Merge small sections
  sections = mergeSmallSections(sections);

  // Step 3: Process each section
  const chunks: ChunkResult[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const tokens = countTokens(section.content);

    if (tokens > MAX_CHUNK_TOKENS) {
      // Split large sections
      const subChunks = splitLargeSection(section.title, section.content, chunkIndex);
      chunks.push(...subChunks);
      chunkIndex += subChunks.length;
    } else {
      // Keep as single chunk
      chunks.push({
        sectionTitle: section.title,
        content: section.content,
        tokenCount: tokens,
        chunkIndex: chunkIndex,
      });
      chunkIndex++;
    }
  }

  return chunks;
}

/**
 * Get total token count for a document
 */
export function getDocumentTokenCount(markdown: string): number {
  return countTokens(markdown);
}
