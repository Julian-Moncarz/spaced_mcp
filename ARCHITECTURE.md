# Architecture Deep Dive

This document provides a comprehensive walkthrough of how the Spaced Repetition MCP Server works, from a user clicking "Connect" to data being stored in the database.

## Table of Contents

- [Tech Stack Overview](#tech-stack-overview)
- [Request Lifecycle](#request-lifecycle)
- [Data Flow & User Isolation](#data-flow--user-isolation)
- [FSRS Integration](#fsrs-integration)
- [Key Design Decisions](#key-design-decisions)
- [Database Architecture](#database-architecture)

## Tech Stack Overview

### Cloudflare Workers

The entire application runs on [Cloudflare Workers](https://workers.cloudflare.com/), a serverless platform that executes code at the edge.

**Key concepts:**
- **Workers**: Stateless JavaScript functions that handle HTTP requests
- **Durable Objects**: Stateful workers that maintain state across requests (used for MCP sessions)
- **D1**: Serverless SQLite database
- **KV**: Key-value storage (used for OAuth state)

### Model Context Protocol (MCP)

[MCP](https://modelcontextprotocol.io) is a protocol that allows AI assistants to call tools and access resources. Think of it like a function-calling API specifically designed for AI agents.

**In this project:**
- We define 9 tools (add_card, get_due_cards, etc.)
- Claude/Cursor clients call these tools via MCP protocol
- The protocol supports two transports: SSE (legacy) and Streamable-HTTP (new)

### FSRS Algorithm

[FSRS (Free Spaced Repetition Scheduler)](https://github.com/open-spaced-repetition/ts-fsrs) is a modern, machine-learning-based algorithm for scheduling reviews. It's a replacement for the older SM-2 algorithm used by Anki.

**Key difference from traditional flashcards:**
- Traditional: Store Q&A pairs, show them on schedule
- This app: Store instructions for Claude to generate dynamic practice problems

## Request Lifecycle

Let's trace what happens when a user connects to the MCP server and calls a tool.

### 1. Initial Connection (OAuth Flow)

```
User clicks "Connect" in Claude
    ↓
GET /authorize (src/google-handler.ts:13)
    ↓
Display approval dialog: "Allow Claude to access Spaced Repetition MCP Server?"
    ↓
User clicks "Approve"
    ↓
POST /authorize (src/google-handler.ts:37)
    ↓
Redirect to Google OAuth
    ↓
User signs in with Google
    ↓
Google redirects to /callback?code=XXX
    ↓
GET /callback (src/google-handler.ts:75)
    ↓
Exchange code for access token
    ↓
Fetch user info from Google API (email, name)
    ↓
Create encrypted MCP session token with props:
{
  login: "user@gmail.com",
  email: "user@gmail.com",
  name: "John Doe",
  accessToken: "ya29.xxx"
}
    ↓
Redirect back to Claude with session token
    ↓
Connection established!
```

**Critical detail:** The `props` object created in the callback becomes `this.props` inside the `MyMCP` Durable Object. This is where user isolation starts!

### 2. Tool Call Flow

```
Claude: "Add a card about Python decorators"
    ↓
MCP Client sends tool call:
POST /mcp
{
  "method": "tools/call",
  "params": {
    "name": "add_card",
    "arguments": {
      "instructions": "Practice implementing Python decorators",
      "tags": "python,advanced"
    }
  }
}
    ↓
OAuth Provider validates session token
    ↓
Durable Object (MyMCP) is created/retrieved
    ↓
this.props populated from decrypted session:
{
  login: "user@gmail.com",
  email: "user@gmail.com",
  name: "John Doe",
  accessToken: "ya29.xxx"
}
    ↓
Tool handler executes (src/index.ts:40)
const db = getUserDb()
// which expands to:
const db = new SpacedRepetition(this.env.DB, this.props.login)
//                                             ↑
//                                    "user@gmail.com"
    ↓
SpacedRepetition.addCard() executes (src/spaced-core.ts:40)
INSERT INTO cards (user_id, instructions)
VALUES ('user@gmail.com', 'Practice implementing Python decorators')
    ↓
Return card ID
    ↓
MCP response sent to Claude:
{
  "content": [
    { "text": "Created card 1", "type": "text" }
  ]
}
    ↓
Claude displays: "Created card 1"
```

## Data Flow & User Isolation

The most critical security feature is **user isolation** - ensuring users can only access their own cards.

### How It Works

```
OAuth (google-handler.ts)
    ↓
Google returns: email = "user@gmail.com"
    ↓
Store in session props:
props = { login: "user@gmail.com", ... }
    ↓
Durable Object (index.ts)
this.props.login = "user@gmail.com"
    ↓
SpacedRepetition class (spaced-core.ts)
constructor(db, userId = "user@gmail.com")
    ↓
Every database query:
WHERE user_id = 'user@gmail.com'
```

### The Isolation Guarantee

Every SQL query in `src/spaced-core.ts` includes `user_id` filter:

```typescript
// Example from getDueCards (line 143)
WHERE c.user_id = ? AND datetime(r.due) <= datetime('now')
//    ↑
//    Always filtered by user_id
```

**This means:**
- User A (alice@gmail.com) can ONLY see cards where `user_id = 'alice@gmail.com'`
- User B (bob@gmail.com) can ONLY see cards where `user_id = 'bob@gmail.com'`
- No way to access other users' data (barring SQL injection, which parameterized queries prevent)

## FSRS Integration

### What is FSRS?

FSRS determines the optimal time to review a card based on:
- **Stability**: How long until you're likely to forget
- **Difficulty**: Intrinsic complexity of the material
- **Retrievability**: Current probability of recall
- **Review history**: Your past performance

### How We Use It

The FSRS algorithm is a black box provided by the `ts-fsrs` package. We:

1. **Store FSRS state in the database** (reviews table):
   ```sql
   state, due, stability, difficulty, elapsed_days,
   scheduled_days, learning_steps, reps, lapses, last_review
   ```

2. **Load state before review**:
   ```typescript
   const card: Card = {
     state: review.state,
     due: new Date(review.due),
     stability: review.stability,
     // ... etc
   }
   ```

3. **Call FSRS to calculate next state**:
   ```typescript
   const recordLogItem = this.scheduler.next(card, now, rating);
   const updatedCard = recordLogItem.card;
   ```

4. **Save new state back to database**:
   ```typescript
   UPDATE reviews SET state = ?, due = ?, stability = ?, ...
   ```

### Card States

FSRS uses 4 states:
- **0 (New)**: Never reviewed
- **1 (Learning)**: In initial learning phase (short intervals)
- **2 (Review)**: Graduated to review phase (longer intervals)
- **3 (Relearning)**: Forgot, need to relearn

### Ratings

When reviewing, users provide a rating (1-4):
- **1 (Again)**: Completely forgot
- **2 (Hard)**: Difficult to recall
- **3 (Good)**: Recalled correctly
- **4 (Easy)**: Recalled easily

FSRS uses this rating + current card state to calculate the next review date.

### Retrievability Sorting

One clever optimization: when getting due cards, we sort by **retrievability** (descending):

```typescript
// src/spaced-core.ts:175
const retrievability = this.scheduler.get_retrievability(card, now, false);
```

This means cards you're about to forget appear first, maximizing learning efficiency!

## Key Design Decisions

### Why Durable Objects?

**Problem:** MCP sessions need to be stateful (maintain connection, share context across tool calls).

**Solution:** Durable Objects provide:
- Persistent state (this.props survives across requests)
- Single-threaded execution (no concurrency issues)
- Isolated per session (each user gets their own instance)

### Why 1:1 reviews:cards instead of one row per review?

**Traditional approach (like Anki):**
```
reviews table:
card_id | timestamp   | rating
1       | 2025-10-15  | 3
1       | 2025-10-16  | 2
1       | 2025-10-17  | 4
```

**Our approach:**
```
reviews table (current state only):
card_id | state | due        | stability | difficulty
1       | 2     | 2025-10-23 | 8.5       | 6.2

review_history table (snapshots for undo):
card_id | state | due        | ... | created_at
1       | 1     | 2025-10-16 | ... | 2025-10-16T10:30
1       | 2     | 2025-10-18 | ... | 2025-10-17T14:22
```

**Why?**
- FSRS only needs the current state to schedule the next review
- Storing full history is wasteful (we only need it for undo)
- Faster queries (1 row per card vs N rows)
- `review_history` serves dual purpose: undo + streak calculation

### Why FTS5 for search?

**Alternatives:**
- `LIKE '%query%'`: Slow, doesn't support ranking
- External search service: Added complexity, cost

**FTS5 (Full-Text Search 5) provides:**
- Fast full-text search (inverted index)
- Relevance ranking
- Built into SQLite (no external deps)
- Automatically synced via triggers

```sql
-- Virtual table definition (schema.sql:65)
CREATE VIRTUAL TABLE cards_fts USING fts5(
    instructions,
    user_id UNINDEXED,
    content='cards',
    content_rowid='id'
);

-- Triggers keep it in sync (schema.sql:73-86)
CREATE TRIGGER cards_ai AFTER INSERT ON cards BEGIN
    INSERT INTO cards_fts(rowid, instructions, user_id)
    VALUES (new.id, new.instructions, new.user_id);
END;
```

### Why D1 instead of traditional database?

**Benefits:**
- Serverless (no infrastructure management)
- SQLite (mature, well-understood)
- Free tier (generous for personal use)
- Low latency (co-located with Workers)

**Tradeoffs:**
- Limited to SQLite features (no JSONB, array types, etc.)
- Can't drop columns (only additive migrations)
- Regional (not globally distributed like KV)

## Database Architecture

### Table Relationships

```
┌─────────────┐         ┌──────────────┐
│   cards     │◀────────│     tags     │
├─────────────┤    1:N  ├──────────────┤
│ id (PK)     │         │ card_id (FK) │
│ user_id     │         │ user_id      │
│ instructions│         │ tag          │
│ created_at  │         └──────────────┘
└──────┬──────┘
       │ 1:1
       ▼
┌──────────────┐        ┌──────────────────┐
│   reviews    │        │ review_history   │
├──────────────┤        ├──────────────────┤
│ card_id (PK) │◀───────│ id (PK)          │
│ user_id      │   N:1  │ card_id (FK)     │
│ state        │        │ user_id          │
│ due          │        │ state (snapshot) │
│ stability    │        │ due (snapshot)   │
│ difficulty   │        │ ... (FSRS state) │
│ ... (FSRS)   │        │ created_at       │
└──────────────┘        └──────────────────┘

Virtual Table (FTS5):
┌──────────────┐
│  cards_fts   │  ← Auto-synced via triggers
├──────────────┤
│ instructions │  (full-text indexed)
│ user_id      │  (not indexed)
└──────────────┘
```

### Indexes for Performance

```sql
-- User-specific queries (most common)
CREATE INDEX idx_cards_user ON cards(user_id);
CREATE INDEX idx_reviews_user ON reviews(user_id);
CREATE INDEX idx_tags_user ON tags(user_id);

-- Due cards query optimization
CREATE INDEX idx_reviews_due ON reviews(due);

-- Tag filtering
CREATE INDEX idx_tags_tag ON tags(tag);

-- Streak calculation & undo
CREATE INDEX idx_review_history_card_user ON review_history(card_id, user_id);
CREATE INDEX idx_review_history_created ON review_history(created_at);
```

### Query Patterns

**Get due cards** (most common):
```sql
SELECT c.id, c.instructions, r.due, ...
FROM cards c
JOIN reviews r ON c.id = r.card_id
WHERE c.user_id = ?
  AND datetime(r.due) <= datetime('now')
ORDER BY retrievability DESC  -- In-memory sort after query
```
Uses: `idx_cards_user`, `idx_reviews_due`

**Search cards**:
```sql
SELECT c.id, c.instructions, r.due, ...
FROM cards_fts fts
JOIN cards c ON fts.rowid = c.id
JOIN reviews r ON c.id = r.card_id
WHERE cards_fts MATCH ?
  AND c.user_id = ?
```
Uses: FTS5 index, `idx_cards_user`

**Calculate streak**:
```sql
SELECT DISTINCT DATE(created_at) as review_date
FROM review_history
WHERE user_id = ?
ORDER BY review_date DESC
```
Uses: `idx_review_history_created`

## Code Organization

### src/index.ts
- **Purpose**: MCP tool definitions
- **Key class**: `MyMCP` (Durable Object)
- **Responsibilities**:
  - Define 9 MCP tools
  - Route tool calls to `SpacedRepetition` methods
  - Handle errors and format responses

### src/spaced-core.ts
- **Purpose**: Core spaced repetition logic
- **Key class**: `SpacedRepetition`
- **Responsibilities**:
  - Database queries (all filtered by `user_id`)
  - FSRS integration
  - Business logic (streaks, stats, etc.)

### src/google-handler.ts
- **Purpose**: OAuth flow handling
- **Responsibilities**:
  - Display approval dialog
  - Redirect to Google OAuth
  - Exchange code for access token
  - Fetch user info
  - Create session with user props

### src/workers-oauth-utils.ts
- **Purpose**: Helper utilities for OAuth Provider
- Shared utilities for cookie handling, approval dialogs, etc.

### src/utils.ts
- **Purpose**: Generic utilities
- OAuth URL generation, token fetching, etc.

## Security Considerations

### User Isolation
✅ Every query filters by `user_id`
✅ `user_id` comes from OAuth-verified email
✅ No way to forge `user_id` (encrypted in session token)

### SQL Injection Prevention
✅ All queries use parameterized statements (`.bind(...)`)
✅ Never concatenate user input into SQL strings

### OAuth Security
✅ Google handles authentication
✅ Session tokens encrypted with `COOKIE_ENCRYPTION_KEY`
✅ Tokens expire (handled by OAuth Provider)

### Secrets Management
✅ Secrets stored in Cloudflare (not in code)
✅ Access via `env.GOOGLE_CLIENT_ID`, etc.
✅ Never logged or exposed to client

## Performance Optimizations

1. **Batch operations**: Tag inserts use `db.batch()` (spaced-core.ts:58)
2. **Parallel queries**: Stats run 6 queries in parallel with `Promise.all()` (spaced-core.ts:575)
3. **Indexes**: Strategic indexes on user_id, due, created_at
4. **FTS5**: Fast full-text search with inverted index
5. **Retrievability sorting**: Prioritize cards about to be forgotten
6. **1:1 reviews:cards**: Single row per card instead of full history

## Monitoring & Debugging

### Local Development
```bash
npx wrangler dev
# Server runs on http://localhost:8788
# Logs appear in terminal
```

### Production Logs
```bash
npx wrangler tail
# Streams real-time logs from production
```

### Database Inspection
```bash
# Query production database
npx wrangler d1 execute spaced-repetition-db \
  --command="SELECT COUNT(*) FROM cards"

# Query local database
npx wrangler d1 execute spaced-repetition-db --local \
  --command="SELECT * FROM cards LIMIT 5"
```

### MCP Inspector
```bash
npx @modelcontextprotocol/inspector
# Connect to: http://localhost:8788/sse
# Test tools interactively
```

## Common Extension Points

### Adding a new MCP tool

1. Add tool definition in `src/index.ts`:
```typescript
this.server.tool(
  "my_new_tool",
  "Tool description",
  { param: z.string().describe("Parameter description") },
  async ({ param }) => {
    const db = getUserDb();
    const result = await db.myNewMethod(param);
    return { content: [{ text: result, type: "text" }] };
  }
);
```

2. Add method to `SpacedRepetition` class in `src/spaced-core.ts`:
```typescript
async myNewMethod(param: string): Promise<string> {
  const result = await this.db
    .prepare("SELECT ... WHERE user_id = ?")
    .bind(this.userId)
    .first();
  return result;
}
```

### Adding a database column

1. Update `schema.sql`:
```sql
ALTER TABLE cards ADD COLUMN new_field TEXT;
```

2. Run migration:
```bash
npx wrangler d1 execute spaced-repetition-db --file=schema.sql
```

3. Update queries in `src/spaced-core.ts` to use new column

4. Regenerate types:
```bash
npm run cf-typegen
```

### Changing FSRS parameters

FSRS can be configured in `src/spaced-core.ts:30`:

```typescript
private scheduler = fsrs({
  w: [...], // Custom FSRS parameters
  request_retention: 0.9, // Target 90% retention
  maximum_interval: 36500, // Max 100 years
  enable_fuzz: true, // Add randomness to intervals
});
```

See [ts-fsrs documentation](https://github.com/open-spaced-repetition/ts-fsrs) for all options.

## Further Reading

- [Model Context Protocol Spec](https://spec.modelcontextprotocol.io/)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare D1 Documentation](https://developers.cloudflare.com/d1/)
- [FSRS Algorithm Whitepaper](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm)
- [SQLite FTS5 Documentation](https://www.sqlite.org/fts5.html)
- [OAuth 2.0 Specification](https://oauth.net/2/)
