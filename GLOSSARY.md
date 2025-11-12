# Glossary

A comprehensive guide to technical terms, acronyms, and concepts used in this project.

## Table of Contents

- [Platform & Infrastructure](#platform--infrastructure)
- [MCP (Model Context Protocol)](#mcp-model-context-protocol)
- [FSRS Algorithm](#fsrs-algorithm)
- [Database & Storage](#database--storage)
- [OAuth & Authentication](#oauth--authentication)
- [Spaced Repetition Concepts](#spaced-repetition-concepts)

## Platform & Infrastructure

### Cloudflare Workers
A serverless computing platform that runs JavaScript/TypeScript code at the edge (close to users globally). Think AWS Lambda, but distributed across 300+ data centers.

**In this project:** The entire application runs as a Worker.

### Durable Objects
Stateful serverless compute units in Cloudflare Workers. Unlike regular Workers (which are stateless), Durable Objects can maintain state across requests.

**In this project:** Each MCP session runs in a Durable Object (`MyMCP` class), maintaining user context across tool calls.

### Edge Computing
Running code geographically close to users (rather than in a central data center). Reduces latency.

### Wrangler
Cloudflare's CLI tool for developing, testing, and deploying Workers.

**Commands:**
- `npx wrangler dev` - Run locally
- `npx wrangler deploy` - Deploy to production
- `npx wrangler d1 execute` - Run SQL commands

## MCP (Model Context Protocol)

### MCP (Model Context Protocol)
A standardized protocol for AI assistants to interact with external tools and resources. Think of it as an API specification designed specifically for AI agents.

**Official site:** https://modelcontextprotocol.io

### MCP Server
An application that implements the MCP protocol and provides tools/resources to MCP clients.

**In this project:** We are an MCP server providing spaced repetition tools.

### MCP Client
An application that connects to MCP servers and calls their tools. Examples: Claude, Cursor, Windsurf.

### MCP Tool
A function that MCP clients can call. Similar to API endpoints, but designed for AI consumption.

**In this project:** We provide 9 tools (add_card, get_due_cards, review_card, etc.)

### SSE (Server-Sent Events)
A legacy transport protocol for MCP. One-way streaming from server to client.

**Endpoint:** `/sse`

**Status:** Deprecated in favor of Streamable-HTTP

### Streamable-HTTP
The modern MCP transport protocol. Bidirectional streaming over HTTP.

**Endpoint:** `/mcp`

**Status:** Preferred for new integrations

### Durable MCP / McpAgent
A pattern for running MCP servers in Cloudflare Durable Objects, provided by the `agents` npm package.

**In this project:** `MyMCP` extends `McpAgent<Env, Record<string, never>, Props>`

## FSRS Algorithm

### FSRS (Free Spaced Repetition Scheduler)
A modern, machine-learning-based algorithm for optimal review scheduling. Replaces the older SM-2 algorithm used in Anki.

**Official repo:** https://github.com/open-spaced-repetition/ts-fsrs

**Key improvement over SM-2:** Uses memory decay models trained on real user data, not hand-tuned formulas.

### State (Card State)
The current learning phase of a card. FSRS defines 4 states:

- **0 (New)**: Card has never been reviewed
- **1 (Learning)**: Card is in initial learning phase (short intervals: minutes/hours)
- **2 (Review)**: Card has graduated to review phase (long intervals: days/weeks/months)
- **3 (Relearning)**: Card was forgotten, needs to be relearned

### Stability
How long (in days) until you're likely to forget the material. Higher stability = longer retention.

**Example:** A card with stability=10 means you'll retain it for ~10 days before forgetting.

### Difficulty
The intrinsic complexity of the material, ranging from 0 (easy) to 10 (hard). Determined by your review history.

**Example:** A card you consistently rate "Hard" will have high difficulty.

### Retrievability
The current probability (0-1) that you can successfully recall the card.

**Example:** Retrievability=0.9 means 90% chance you'll remember it right now.

**Use case:** We sort due cards by retrievability (descending) to prioritize cards you're about to forget.

### Rating (Review Rating)
Your self-assessment of how well you recalled the card. FSRS uses 4 ratings:

- **1 (Again)**: Completely forgot, couldn't recall
- **2 (Hard)**: Recalled with difficulty, took effort
- **3 (Good)**: Recalled correctly with moderate effort
- **4 (Easy)**: Recalled easily, no hesitation

**Anki comparison:** Same as Anki's Again/Hard/Good/Easy buttons.

### Interval
The number of days until the next review.

**Example:** After reviewing a card with rating "Good", FSRS might schedule it for 6 days from now (interval=6).

### Reps (Repetitions)
The total number of times you've reviewed the card.

### Lapses
The number of times you've forgotten the card (rated it "Again").

**Use case:** High lapses might indicate the material is too difficult or needs to be broken down.

### Scheduled Days
The interval that was scheduled for this review period.

**Example:** If card was reviewed on Oct 1 and next review was Oct 8, scheduled_days=7.

### Elapsed Days
The actual number of days between the last review and now.

**Example:** If you review a card 2 days late, elapsed_days = scheduled_days + 2.

## Database & Storage

### D1
Cloudflare's serverless SQLite database. Runs on the same infrastructure as Workers.

**Features:**
- SQL interface (standard SQLite)
- Automatically replicated
- Free tier: 5GB storage, 100k reads/day

**In this project:** Stores cards, tags, reviews, review history.

### SQLite
A lightweight, file-based relational database. Most widely deployed database engine in the world (used in phones, browsers, etc.).

**Why SQLite?** Mature, well-understood, excellent for read-heavy workloads, supports full-text search (FTS5).

### FTS5 (Full-Text Search 5)
SQLite's built-in full-text search engine. Uses inverted indexes for fast text searches.

**In this project:** Powers the `search_cards` tool.

**Example query:**
```sql
SELECT * FROM cards_fts WHERE cards_fts MATCH 'python decorators'
```

### Virtual Table
A SQLite table that doesn't store data directly but provides a SQL interface to external data.

**In this project:** `cards_fts` is a virtual table that indexes the `instructions` column from `cards` table.

### Trigger
A SQL function that automatically executes when certain events occur (INSERT, UPDATE, DELETE).

**In this project:** We use triggers to keep the `cards_fts` virtual table in sync with the `cards` table.

### KV (Key-Value Store)
Cloudflare's globally distributed key-value storage. Optimized for reads.

**In this project:** Used by OAuth Provider to store session state.

### Migration
A change to the database schema (adding tables, columns, indexes, etc.).

**In D1:** Limited to additive changes only (can't drop columns).

## OAuth & Authentication

### OAuth 2.0
An industry-standard protocol for authorization. Allows users to grant third-party applications access without sharing passwords.

**Flow:** User → Authorize app → Redirect to Google → Login → Redirect back with code → Exchange code for token

### OAuth Provider
The service that authenticates users. In this project: Google.

### OAuth Client
The application requesting access. In this project: Claude, Cursor, etc.

### Access Token
A credential issued after successful OAuth authentication. Used to access protected resources.

**In this project:** Stored in `this.props.accessToken`, though we don't currently use it (we only use email for user_id).

### Redirect URI / Callback URL
The URL where the OAuth provider sends the user after authentication.

**In this project:** `https://your-worker.workers.dev/callback`

### Scope
The permissions requested during OAuth.

**In this project:** `"openid email profile"` - we request user's email and basic profile info.

### Client ID & Client Secret
Credentials for your OAuth application (like username/password for your app).

**Security:** Client secret must NEVER be exposed publicly. Stored in Cloudflare secrets.

### Approval Dialog
The UI showing "App X wants to access your Y data. Allow?"

**In this project:** Rendered by `renderApprovalDialog()` in google-handler.ts.

## Spaced Repetition Concepts

### Spaced Repetition
A learning technique where review intervals increase over time. Based on the "spacing effect" - we remember better when reviews are spaced out.

**Example:** Review today → 1 day → 3 days → 1 week → 2 weeks → 1 month → ...

### Flashcard
A study aid with a question/prompt on one side and answer on the other.

**Traditional:** Static Q&A pairs
**This project:** Dynamic - stores instructions for Claude to generate fresh practice problems

### Review
The act of testing yourself on a card and providing feedback on how well you recalled it.

### Due Date
The date when a card should be reviewed next, based on the spaced repetition algorithm.

**In this project:** Stored in `reviews.due` as a timestamp.

### Streak
The number of consecutive days you've completed reviews.

**In this project:** Calculated from `review_history` table by counting consecutive review dates.

### Card Instructions
Text describing what practice problems to generate for this card.

**Example:** "Generate problems about implementing binary search trees in Python. Focus on insertion, deletion, and balancing. User struggles with edge cases."

**Key difference:** Unlike traditional flashcards (Q&A), instructions are meta-prompts for AI.

### Tag
A label for categorizing cards (e.g., "python", "algorithms", "beginner").

**In this project:** Many-to-many relationship - cards can have multiple tags, tags can apply to multiple cards.

### Undo Review
Reverting a review to the previous state. Useful if you accidentally click the wrong rating.

**In this project:** Implemented by storing snapshots in `review_history` table before each review.

## TypeScript & Zod

### Zod
A TypeScript-first schema validation library. Used to define and validate tool parameters.

**Example from our code:**
```typescript
{
  instructions: z.string().describe("Instructions for the card"),
  tags: z.string().optional().describe("Comma-separated tags")
}
```

### Type Safety
Ensuring code uses values of the correct type at compile-time. TypeScript provides type safety.

**In this project:** Prevents bugs like passing a number where a string is expected.

### Environment Bindings
TypeScript interfaces describing resources available in Cloudflare Workers environment (D1, KV, secrets, etc.).

**In this project:** Defined in `worker-configuration.d.ts`, auto-generated by `wrangler types`.

## Development Tools

### npm (Node Package Manager)
JavaScript's package manager. Used to install dependencies.

**Key commands:**
- `npm install` - Install dependencies
- `npm run type-check` - Run TypeScript type checker

### TypeScript
JavaScript with static type checking. Catches errors before runtime.

**In this project:** All code is written in TypeScript (`.ts` files).

### Prettier
A code formatter that enforces consistent style.

**Config:** Project uses Prettier (see `package.json` devDependencies).

### MCP Inspector
A debugging tool for testing MCP servers interactively.

**Usage:**
```bash
npx @modelcontextprotocol/inspector
# Connect to: http://localhost:8788/sse
```

**Features:** Call tools, inspect responses, view logs.

## Acronyms Quick Reference

- **AI**: Artificial Intelligence
- **API**: Application Programming Interface
- **CLI**: Command Line Interface
- **D1**: Cloudflare's SQLite database (name chosen by Cloudflare, no specific meaning)
- **FK**: Foreign Key
- **FSRS**: Free Spaced Repetition Scheduler
- **FTS5**: Full-Text Search version 5
- **HTTP**: HyperText Transfer Protocol
- **JSON**: JavaScript Object Notation
- **KV**: Key-Value (store)
- **MCP**: Model Context Protocol
- **OAuth**: Open Authorization
- **PK**: Primary Key
- **SM-2**: SuperMemo 2 (older spaced repetition algorithm)
- **SQL**: Structured Query Language
- **SSE**: Server-Sent Events
- **URI**: Uniform Resource Identifier
- **URL**: Uniform Resource Locator

## Conversions & Comparisons

### Anki → This Project

| Anki Concept | This Project Equivalent |
|--------------|------------------------|
| Deck | Tag (e.g., "python") |
| Note | Card |
| Card front/back | Instructions (meta-prompt) |
| Again/Hard/Good/Easy | Ratings 1/2/3/4 |
| SM-2 algorithm | FSRS algorithm |
| AnkiWeb sync | Cloudflare D1 (automatic) |
| Add-ons | MCP tools |

### Traditional API → MCP

| Traditional API | MCP Equivalent |
|-----------------|---------------|
| REST endpoint | MCP tool |
| API key | OAuth token |
| OpenAPI spec | MCP protocol schema |
| Postman | MCP Inspector |
| curl request | MCP tool call |

## Further Reading

For deeper understanding of these concepts:

- **FSRS:** [FSRS Algorithm Wiki](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm)
- **MCP:** [Model Context Protocol Docs](https://modelcontextprotocol.io)
- **Cloudflare Workers:** [Workers Documentation](https://developers.cloudflare.com/workers/)
- **D1:** [D1 Documentation](https://developers.cloudflare.com/d1/)
- **OAuth 2.0:** [OAuth 2.0 Simplified](https://aaronparecki.com/oauth-2-simplified/)
- **Spaced Repetition:** [Spaced Repetition Wikipedia](https://en.wikipedia.org/wiki/Spaced_repetition)
- **SQLite FTS5:** [FTS5 Documentation](https://www.sqlite.org/fts5.html)
