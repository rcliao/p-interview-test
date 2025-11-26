# Public Sector Intelligence

> Technical Assessment: AI-powered opportunity discovery for government contracts

A RAG-based system that analyzes government documents to discover contracting opportunities **before** formal RFPs are published. By tracking projects through their lifecycle phases, service providers can engage early and build relationships with decision makers.

## The Problem

Government contracts are typically discovered only when RFPs are published, leaving vendors just weeks to respond. However, signals of upcoming procurements exist months earlier in:
- Budget documents with capital project allocations
- Council/board meeting minutes discussing initiatives
- Strategic plans outlining future priorities
- Staff reports identifying needs

This system extracts those early signals and tracks projects through their lifecycle.

## Solution Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Ingestion     │────▶│    Postgres     │◀────│   Chat API      │
│   + Project     │     │  + pgvector     │     │  (Hono + RAG)   │
│   Extraction    │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        ▼                       ▼                       ▼
   Parse JSON docs        Store: documents,        Vector search,
   Chunk by sections      chunks, projects,        retrieve context,
   Extract projects       embeddings               generate response
```

### Key Features

1. **Document Intelligence** - Ingests government documents, chunks them semantically, and generates embeddings for vector search

2. **Project Extraction** - Uses LLM to identify projects and classify their lifecycle phase

3. **RAG-Powered Chat** - Natural language interface to discover opportunities with source attribution

4. **Pipeline View** - Visual dashboard of all projects grouped by lifecycle phase

### Project Lifecycle Phases

| Phase | Emoji | Description | Timing |
|-------|-------|-------------|--------|
| Strategy | 🎯 | Mentioned in plans/goals, no budget yet | ~12+ months out |
| Budget | 💰 | Funding allocated or approved | ~6-12 months out |
| Contacts | 👤 | Decision makers identified | ~3-6 months out |
| RFP Open | 📋 | Active procurement accepting bids | Weeks remaining |
| Awarded | ✅ | Contract given to vendor | Closed |
| In Progress | 🔄 | Work actively underway | Subcontracting possible |

## Quick Start

### Prerequisites
- Node.js 18+
- Docker (for PostgreSQL)
- OpenAI API key

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Create environment file
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# 3. Start Postgres with pgvector
docker-compose up -d

# 4. Run database migrations
npm run db:generate
npm run db:migrate

# 5. Ingest documents (uses example-data by default)
npm run ingest

# 6. Start the server
npm run dev
```

Then open http://localhost:3000

## API Endpoints

### Chat
```http
POST /api/chat
Content-Type: application/json

{
  "query": "What technology opportunities exist in school districts?",
  "stream": false
}
```

### Projects
```http
# Get all projects
GET /api/projects

# Get pipeline view (grouped by phase)
GET /api/projects/pipeline

# Get project details with evidence
GET /api/projects/:id
```

### Search
```http
# Semantic search
GET /api/search?q=infrastructure&type=all

# List entities
GET /api/search/entities
```

## Project Structure

```
├── data/                    # Your document corpus (gitignored)
├── example-data/            # Sample documents for testing
├── docs/
│   └── design.md            # Technical design documentation
├── src/
│   ├── api/                 # Hono API server
│   │   ├── routes/          # API endpoints
│   │   └── index.ts         # Server entry
│   ├── db/                  # Database schema and migrations
│   ├── services/            # Core business logic
│   │   ├── chunker.ts       # Document chunking
│   │   ├── openai.ts        # OpenAI client
│   │   ├── projectExtractor.ts  # LLM project extraction
│   │   ├── rag.ts           # RAG pipeline
│   │   └── summarizer.ts    # Document summarization
│   ├── scripts/             # CLI scripts
│   │   └── ingest.ts        # Data ingestion
│   └── web/                 # Frontend UI
│       └── index.html       # Chat interface
├── docker-compose.yml       # Postgres + pgvector
└── package.json
```

## Sample Queries

Try these in the chat interface:

1. **Pipeline Overview**: "Show me all projects in the pipeline by phase"
2. **Opportunity Discovery**: "What technology opportunities exist in school districts?"
3. **Entity Intel**: "What projects are planned for City of Example?"
4. **Category Search**: "Find infrastructure projects with allocated budgets"

## Technical Decisions

### Why pgvector over dedicated vector DBs?
- Single database for all data (simplicity)
- ACID transactions across vectors and metadata
- HNSW indexes provide excellent performance for this scale
- No additional infrastructure to manage

### Why chunk by markdown headers?
- Government documents are often well-structured
- Preserves semantic meaning within sections
- Enables section-level attribution in responses

### Why track project lifecycle?
- Earlier phases = more time to build relationships
- Phase progression indicates buying intent
- Enables prioritization of sales efforts

## Future Improvements

1. **Web Scraper** - Crawl government websites to expand document corpus
2. **Project Deduplication** - Match projects across documents using embedding similarity
3. **Alerting** - Notify when projects move to new phases
4. **Entity Enrichment** - Pull in population, budget, contact data from external sources

## Documentation

See [docs/design.md](docs/design.md) for detailed technical documentation including:
- Data flow diagrams
- Complete data model
- API specifications

## License

MIT
