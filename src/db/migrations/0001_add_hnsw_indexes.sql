-- Drop existing IVFFlat indexes if they exist (they may have been created manually)
DROP INDEX IF EXISTS idx_chunks_embedding;
DROP INDEX IF EXISTS idx_projects_embedding;

-- Create HNSW indexes for vector similarity search
-- HNSW is better than IVFFlat for smaller datasets (<100k rows) because:
-- 1. No training phase required
-- 2. Works well regardless of data distribution
-- 3. Better recall accuracy
-- 4. Good performance with default parameters

CREATE INDEX idx_chunks_embedding ON chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_projects_embedding ON projects
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
