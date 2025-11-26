# Technical Design Document

## Overview

Public Sector Intelligence is a RAG-based system that analyzes government documents to discover contracting opportunities ahead of formal RFP publication. The system tracks projects through their lifecycle phases, enabling service providers to engage early in the sales cycle.

---

## 1. Data Flow (Domain Storytelling)

### Story 1: Document Ingestion

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DOCUMENT INGESTION FLOW                              │
└─────────────────────────────────────────────────────────────────────────────┘

  [Data Analyst]                    [System]                      [Database]
       │                               │                              │
       │  1. places JSON documents     │                              │
       │     in data/{entity_id}/      │                              │
       │─────────────────────────────▶ │                              │
       │                               │                              │
       │  2. runs `npm run ingest`     │                              │
       │─────────────────────────────▶ │                              │
       │                               │                              │
       │                               │  3. reads each JSON file     │
       │                               │     {url, org_id, text}      │
       │                               │──────────────────────────────│
       │                               │                              │
       │                               │  4. creates Entity record    │
       │                               │─────────────────────────────▶│
       │                               │                              │
       │                               │  5. calls OpenAI to          │
       │                               │     summarize document       │
       │                               │     ─────────┐               │
       │                               │              │ LLM           │
       │                               │     ◀────────┘               │
       │                               │                              │
       │                               │  6. chunks document by       │
       │                               │     markdown headers         │
       │                               │     (100-1000 tokens)        │
       │                               │──────────────────────────────│
       │                               │                              │
       │                               │  7. generates embeddings     │
       │                               │     for each chunk           │
       │                               │     ─────────┐               │
       │                               │              │ OpenAI        │
       │                               │     ◀────────┘ text-embedding│
       │                               │                              │
       │                               │  8. stores Document +        │
       │                               │     Chunks with vectors      │
       │                               │─────────────────────────────▶│
       │                               │                              │
       │                               │  9. extracts Projects        │
       │                               │     using structured LLM     │
       │                               │     ─────────┐               │
       │                               │              │ GPT-4o        │
       │                               │     ◀────────┘ JSON mode     │
       │                               │                              │
       │                               │  10. stores Projects +       │
       │                               │      Evidence + embeddings   │
       │                               │─────────────────────────────▶│
       │                               │                              │
       │                               │  11. extracts Entity info    │
       │                               │      (name, type, state)     │
       │                               │      from document patterns  │
       │                               │─────────────────────────────▶│
       │                               │                              │
```

**Actors:**
- **Data Analyst**: Prepares and places raw document JSON files
- **Ingest Script**: Orchestrates the entire pipeline (`src/scripts/ingest.ts`)
- **Summarizer Service**: Generates document summaries and metadata
- **Chunker Service**: Splits documents into semantic chunks
- **Project Extractor**: Identifies projects and classifies lifecycle phase
- **OpenAI API**: Provides embeddings and LLM completions
- **PostgreSQL + pgvector**: Stores all data with vector indexes

---

### Story 2: User Query (RAG Pipeline)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            RAG QUERY FLOW                                    │
└─────────────────────────────────────────────────────────────────────────────┘

  [Sales Rep]                      [API Server]                   [Database]
       │                               │                              │
       │  1. asks "What tech           │                              │
       │     opportunities exist       │                              │
       │     in school districts?"     │                              │
       │─────────────────────────────▶ │                              │
       │     POST /api/chat            │                              │
       │                               │                              │
       │                               │  2. generates query          │
       │                               │     embedding                │
       │                               │     ─────────┐               │
       │                               │              │ OpenAI        │
       │                               │     ◀────────┘               │
       │                               │                              │
       │                               │  3. vector search:           │
       │                               │     - top 10 chunks          │
       │                               │     - top 5 projects         │
       │                               │◀─────────────────────────────│
       │                               │     (cosine similarity)      │
       │                               │                              │
       │                               │  4. groups chunks by         │
       │                               │     parent document          │
       │                               │──────────────────────────────│
       │                               │                              │
       │                               │  5. formats context:         │
       │                               │     - document excerpts      │
       │                               │     - project pipeline       │
       │                               │──────────────────────────────│
       │                               │                              │
       │                               │  6. generates response       │
       │                               │     with sales positioning   │
       │                               │     ─────────┐               │
       │                               │              │ GPT-4o        │
       │                               │     ◀────────┘               │
       │                               │                              │
       │  7. receives answer with      │                              │
       │     - opportunity signals     │                              │
       │     - source citations        │                              │
       │     - related projects        │                              │
       │     - next steps              │                              │
       │◀──────────────────────────────│                              │
       │                               │                              │
       │                               │  8. logs chat session        │
       │                               │     for analytics            │
       │                               │─────────────────────────────▶│
       │                               │                              │
```

**Key Operations:**
1. Single embedding generation (reused for both searches)
2. Parallel vector search on chunks and projects tables
3. Context assembly with document grouping
4. Sales-focused response generation with source attribution

---

### Story 3: Pipeline Discovery

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PIPELINE DISCOVERY FLOW                              │
└─────────────────────────────────────────────────────────────────────────────┘

  [Sales Manager]                  [API Server]                   [Database]
       │                               │                              │
       │  1. views pipeline            │                              │
       │     dashboard                 │                              │
       │─────────────────────────────▶ │                              │
       │     GET /api/projects/pipeline│                              │
       │                               │                              │
       │                               │  2. fetches all projects     │
       │                               │     with entity joins        │
       │                               │◀─────────────────────────────│
       │                               │                              │
       │                               │  3. groups by lifecycle      │
       │                               │     phase                    │
       │                               │──────────────────────────────│
       │                               │                              │
       │  4. sees opportunities        │                              │
       │     organized by:             │                              │
       │     🎯 Strategy (early)       │                              │
       │     💰 Budget (funded)        │                              │
       │     👤 Contacts (named)       │                              │
       │     📋 RFP Open (active)      │                              │
       │     ✅ Awarded                │                              │
       │     🔄 In Progress            │                              │
       │◀──────────────────────────────│                              │
       │                               │                              │
       │  5. clicks project for        │                              │
       │     details + evidence        │                              │
       │─────────────────────────────▶ │                              │
       │     GET /api/projects/:id     │                              │
       │                               │                              │
       │                               │  6. fetches project +        │
       │                               │     evidence excerpts +      │
       │                               │     source documents         │
       │                               │◀─────────────────────────────│
       │                               │                              │
       │  7. reviews evidence to       │                              │
       │     validate opportunity      │                              │
       │◀──────────────────────────────│                              │
```

---

## 2. Data Model

### Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA MODEL                                      │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐       ┌──────────────────┐       ┌──────────────────┐
│   entities   │       │    documents     │       │     chunks       │
├──────────────┤       ├──────────────────┤       ├──────────────────┤
│ id (PK)      │◀──┐   │ id (PK, UUID)    │◀──┐   │ id (PK, UUID)    │
│ name         │   │   │ url (UNIQUE)     │   │   │ document_id (FK) │───┐
│ type         │   │   │ url_id           │   │   │ section_title    │   │
│ state        │   └───│ org_id (FK)      │   │   │ content          │   │
│ website      │       │ title            │   │   │ token_count      │   │
│ created_at   │       │ content          │   │   │ chunk_index      │   │
└──────────────┘       │ content_type     │   │   │ embedding (1536) │   │
                       │ summary          │   │   │ created_at       │   │
                       │ keywords[]       │   │   └──────────────────┘   │
                       │ fiscal_year      │   │                          │
                       │ token_count      │   │                          │
                       │ chunk_count      │   │                          │
                       │ created_at       │   │                          │
                       │ updated_at       │   │                          │
                       └──────────────────┘   │                          │
                              ▲               │                          │
┌──────────────────┐          │               │                          │
│    projects      │          │               │                          │
├──────────────────┤          │               │                          │
│ id (PK, UUID)    │          │               │                          │
│ org_id (FK)      │──────────│───────────────│──────────────────────────┘
│ title            │          │               │         (via entities)
│ description      │          │               │
│ phase            │          │               │
│ phase_confidence │          │               │
│ phase_reasoning  │          │               │
│ category         │          │               │
│ estimated_value  │          │               │
│ fiscal_year      │          │               │
│ timeline_notes   │          │               │
│ contacts (JSONB) │          │               │
│ source_documents │──────────┘               │
│ keywords[]       │     (UUID array)         │
│ embedding (1536) │                          │
│ first_seen_at    │                          │
│ last_updated_at  │                          │
│ created_at       │                          │
└──────────────────┘                          │
        │                                     │
        │                                     │
        ▼                                     │
┌────────────────────┐                        │
│ project_evidence   │                        │
├────────────────────┤                        │
│ id (PK, UUID)      │                        │
│ project_id (FK)    │                        │
│ document_id (FK)   │────────────────────────┘
│ chunk_id (FK)      │
│ evidence_type      │
│ excerpt            │
│ confidence         │
│ created_at         │
└────────────────────┘

┌──────────────────┐
│  chat_sessions   │
├──────────────────┤
│ id (PK, UUID)    │
│ query            │
│ response         │
│ matched_docs     │  (JSONB)
│ matched_projects │  (JSONB)
│ created_at       │
└──────────────────┘
```

### Table Definitions

#### `entities`
Government organizations (cities, counties, school districts, etc.)

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (PK) | Original org_id from data source |
| name | TEXT | Extracted organization name |
| type | TEXT | 'city', 'county', 'school_district', 'special_district' |
| state | TEXT | US state abbreviation |
| website | TEXT | Organization website URL |
| created_at | TIMESTAMP | Record creation time |

#### `documents`
Parent documents ingested from JSON corpus

| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Auto-generated identifier |
| url | TEXT (UNIQUE) | Source document URL |
| url_id | TEXT | Base64-encoded URL ID from source |
| org_id | TEXT (FK) | Reference to entities.id |
| title | TEXT | LLM-extracted document title |
| content | TEXT | Full document text |
| content_type | TEXT | 'budget', 'meeting', 'rfp', 'contact', 'policy' |
| summary | TEXT | LLM-generated summary |
| keywords | TEXT[] | Extracted keywords |
| fiscal_year | INTEGER | Detected fiscal year |
| token_count | INTEGER | Total tokens in document |
| chunk_count | INTEGER | Number of chunks created |

#### `chunks`
Semantically chunked document sections with embeddings

| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Auto-generated identifier |
| document_id | UUID (FK) | Reference to documents.id |
| section_title | TEXT | Markdown header if present |
| content | TEXT | Chunk text content |
| token_count | INTEGER | Tokens in this chunk |
| chunk_index | INTEGER | Position in document |
| embedding | VECTOR(1536) | OpenAI text-embedding-3-small |

#### `projects`
Extracted projects with lifecycle tracking

| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Auto-generated identifier |
| org_id | TEXT (FK) | Reference to entities.id |
| title | TEXT | Project name |
| description | TEXT | Project description |
| phase | TEXT | Lifecycle phase (see below) |
| phase_confidence | REAL | Confidence score 0-1 |
| phase_reasoning | TEXT | LLM explanation for phase |
| category | TEXT | 'technology', 'infrastructure', 'consulting', etc. |
| estimated_value | DECIMAL(15,2) | Estimated contract value |
| fiscal_year | INTEGER | Target fiscal year |
| timeline_notes | TEXT | Timeline information |
| contacts | JSONB | Array of contact objects |
| source_documents | UUID[] | Document IDs where found |
| keywords | TEXT[] | Search keywords |
| embedding | VECTOR(1536) | Project description embedding |

**Project Lifecycle Phases:**

| Phase | Emoji | Description | Sales Implication |
|-------|-------|-------------|-------------------|
| strategy | 🎯 | Mentioned in plans/goals | Earliest signal, relationship building |
| budget | 💰 | Funding allocated | High intent, budget confirmed |
| contacts | 👤 | Decision maker identified | Direct outreach possible |
| rfp_open | 📋 | Active RFP/RFQ | Time-sensitive, respond now |
| awarded | ✅ | Contract awarded | Track for subcontracting |
| in_progress | 🔄 | Work underway | Future phases, expansions |

#### `project_evidence`
Links projects to supporting document excerpts

| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Auto-generated identifier |
| project_id | UUID (FK) | Reference to projects.id |
| document_id | UUID (FK) | Reference to documents.id |
| chunk_id | UUID (FK) | Reference to chunks.id |
| evidence_type | TEXT | 'phase_signal', 'budget_mention', 'contact_info', 'timeline' |
| excerpt | TEXT | Direct quote from document |
| confidence | REAL | Confidence score 0-1 |

#### `chat_sessions`
Analytics for chat interactions

| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Auto-generated identifier |
| query | TEXT | User's question |
| response | TEXT | Generated response |
| matched_docs | JSONB | Documents used in context |
| matched_projects | JSONB | Projects surfaced |
| created_at | TIMESTAMP | Query timestamp |

### Vector Indexes

```sql
-- HNSW indexes for fast approximate nearest neighbor search
CREATE INDEX idx_chunks_embedding ON chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_projects_embedding ON projects
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

---

## 3. API Definitions

### Base URL
```
http://localhost:3000/api
```

### Health Check

#### `GET /api/health`
Check API server status.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-11-25T12:00:00.000Z"
}
```

---

### Chat API

#### `POST /api/chat`
RAG-powered chat endpoint for opportunity discovery.

**Request Body:**
```json
{
  "query": "What technology opportunities exist in school districts?",
  "stream": false,
  "filters": {
    "orgId": "optional-entity-id",
    "phase": "budget",
    "category": "technology"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| query | string | Yes | User question (1-2000 chars) |
| stream | boolean | No | Enable SSE streaming (default: false) |
| filters.orgId | string | No | Filter by entity ID |
| filters.phase | string | No | Filter by project phase |
| filters.category | string | No | Filter by category |

**Response (non-streaming):**
```json
{
  "answer": "Based on the documents analyzed...\n\n## Technology Opportunities\n...",
  "sources": [
    {
      "documentId": "uuid",
      "title": "FY2024 Budget Summary",
      "url": "https://example-city.gov/budget.pdf",
      "section": "Capital Projects",
      "entity": "City of Example",
      "relevance": 0.89
    }
  ],
  "projects": [
    {
      "id": "uuid",
      "title": "Network Infrastructure Upgrade",
      "phase": "budget",
      "phaseLabel": "Budget",
      "phaseEmoji": "💰",
      "category": "technology",
      "estimatedValue": "2100000",
      "entity": "City of Example",
      "relevance": 0.85
    }
  ]
}
```

**Response (streaming):**
Server-Sent Events stream of text chunks.

---

### Projects API

#### `GET /api/projects`
List all extracted projects with optional filters.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| phase | string | Filter by lifecycle phase |
| category | string | Filter by category |
| org_id | string | Filter by entity ID |

**Response:**
```json
{
  "projects": [
    {
      "id": "uuid",
      "title": "Technology Infrastructure Upgrade",
      "description": "Comprehensive network modernization...",
      "phase": "budget",
      "phaseConfidence": 0.85,
      "phaseInfo": {
        "label": "Budget",
        "emoji": "💰",
        "description": "Funding allocated or approved",
        "priority": 2
      },
      "category": "technology",
      "estimatedValue": "2100000",
      "fiscalYear": 2024,
      "timelineNotes": "Expected completion June 2025",
      "contacts": [
        {
          "name": "David Brown",
          "title": "City Manager",
          "context": "Leading the initiative"
        }
      ],
      "keywords": ["network", "cybersecurity", "cloud"],
      "orgId": "example-entity-001",
      "entityName": "City of Example",
      "createdAt": "2024-11-25T12:00:00.000Z"
    }
  ],
  "total": 45
}
```

#### `GET /api/projects/pipeline`
Get projects grouped by lifecycle phase for pipeline visualization.

**Response:**
```json
{
  "pipeline": {
    "strategy": {
      "label": "Strategy",
      "emoji": "🎯",
      "description": "Mentioned in plans/goals, no budget yet",
      "projects": [...],
      "count": 12
    },
    "budget": {
      "label": "Budget",
      "emoji": "💰",
      "description": "Funding allocated or approved",
      "projects": [...],
      "count": 8
    },
    "contacts": {...},
    "rfp_open": {...},
    "awarded": {...},
    "in_progress": {...}
  },
  "summary": {
    "total": 45,
    "byPhase": [
      {"phase": "strategy", "label": "Strategy", "emoji": "🎯", "count": 12},
      {"phase": "budget", "label": "Budget", "emoji": "💰", "count": 8}
    ],
    "totalEstimatedValue": 15200000
  }
}
```

#### `GET /api/projects/:id`
Get detailed project information with evidence.

**Response:**
```json
{
  "project": {
    "id": "uuid",
    "title": "Technology Infrastructure Upgrade",
    "description": "...",
    "phase": "budget",
    "phaseConfidence": 0.85,
    "phaseReasoning": "Document explicitly mentions $2.1M budget allocation...",
    "phaseInfo": {...},
    "category": "technology",
    "estimatedValue": "2100000",
    "fiscalYear": 2024,
    "timelineNotes": "Expected completion June 2025",
    "contacts": [...],
    "keywords": [...],
    "sourceDocuments": ["uuid1", "uuid2"],
    "orgId": "example-entity-001",
    "entityName": "City of Example"
  },
  "evidence": [
    {
      "id": "uuid",
      "evidenceType": "phase_signal",
      "excerpt": "The IT Department has requested funding for a comprehensive network infrastructure modernization project at $2.1M...",
      "confidence": 0.85,
      "documentId": "uuid",
      "documentTitle": "FY2024 Budget Summary",
      "documentUrl": "https://example-city.gov/budget.pdf"
    }
  ],
  "sourceDocuments": [
    {
      "id": "uuid",
      "title": "FY2024 Budget Summary",
      "url": "https://example-city.gov/budget.pdf",
      "summary": "Annual budget document for the City of Example...",
      "contentType": "budget"
    }
  ]
}
```

---

### Search API

#### `GET /api/search`
Semantic search across documents and projects.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| q | string | Search query (required) |
| limit | integer | Max results (default: 10) |
| type | string | 'documents', 'projects', or 'all' (default) |

**Response:**
```json
{
  "documents": [
    {
      "id": "uuid",
      "title": "FY2024 Budget Summary",
      "url": "https://example-city.gov/budget.pdf",
      "entity": "City of Example",
      "matchedSection": "Capital Projects",
      "excerpt": "The IT Department has requested funding...",
      "relevance": 0.89
    }
  ],
  "projects": [
    {
      "id": "uuid",
      "title": "Network Infrastructure Upgrade",
      "description": "...",
      "phase": "budget",
      "phaseLabel": "Budget",
      "phaseEmoji": "💰",
      "category": "technology",
      "estimatedValue": "2100000",
      "entity": "City of Example",
      "relevance": 0.85
    }
  ]
}
```

#### `GET /api/search/entities`
List all entities with document/project counts.

**Response:**
```json
{
  "entities": [
    {
      "id": "example-entity-001",
      "name": "City of Example",
      "type": "city",
      "state": "CA",
      "website": "https://example-city.gov",
      "documentCount": 5,
      "projectCount": 3
    }
  ]
}
```

#### `GET /api/search/entities/:id`
Get entity details with all documents and projects.

**Response:**
```json
{
  "entity": {
    "id": "example-entity-001",
    "name": "City of Example",
    "type": "city",
    "state": "CA",
    "website": "https://example-city.gov",
    "createdAt": "2024-11-25T12:00:00.000Z"
  },
  "documents": [
    {
      "id": "uuid",
      "url": "https://example-city.gov/budget.pdf",
      "title": "FY2024 Budget Summary",
      "contentType": "budget",
      "summary": "...",
      "keywords": ["budget", "capital", "technology"],
      "fiscalYear": 2024,
      "tokenCount": 15000,
      "chunkCount": 12
    }
  ],
  "projects": [
    {
      "id": "uuid",
      "title": "Network Infrastructure Upgrade",
      "phase": "budget",
      "category": "technology",
      "estimatedValue": "2100000"
    }
  ]
}
```

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 18+ |
| Language | TypeScript |
| Web Framework | Hono |
| Database | PostgreSQL 15+ with pgvector |
| ORM | Drizzle ORM |
| Embeddings | OpenAI text-embedding-3-small (1536 dims) |
| LLM | OpenAI GPT-4o (structured outputs) |
| Vector Index | HNSW (pgvector) |
