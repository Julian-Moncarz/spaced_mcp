# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a remote MCP (Model Context Protocol) server that provides spaced repetition tools to AI assistants. It runs on Cloudflare Workers with a D1 SQLite database and GitHub OAuth for user authentication. Each user's spaced repetition cards are isolated by their GitHub login.

The core concept: Instead of static flashcards, this stores **instructions** that Claude uses to generate fresh, personalized practice problems on demand.

## Essential Commands

### Development
```bash
npx wrangler dev                    # Start local dev server on port 8788
npx wrangler deploy                 # Deploy to production
npx wrangler types                  # Regenerate TypeScript types (cf-typegen)
npm run type-check                  # Run TypeScript type checking
```

### Database Operations
```bash
# Initialize schema (required on first setup)
npx wrangler d1 execute spaced-repetition-db --file=schema.sql

# Query database directly
npx wrangler d1 execute spaced-repetition-db --command="SELECT * FROM cards"

# Create new D1 database
npx wrangler d1 create spaced-repetition-db
```

### Secrets Management
```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put COOKIE_ENCRYPTION_KEY
```

### Testing
```bash
# Test with MCP Inspector
npx @modelcontextprotocol/inspector
# Then connect to: http://localhost:8788/sse (local) or https://your-worker.workers.dev/sse (prod)
```

## Architecture

### Request Flow
1. MCP client (Claude, Cursor, etc) connects via OAuth + MCP protocol
2. GitHub OAuth authenticates user → `user_id` = GitHub login
3. Request hits Cloudflare Worker ([src/index.ts](src/index.ts))
4. Worker calls Durable Object ([MyMCP](src/index.ts) class extends `McpAgent`)
5. Durable Object has `this.props.login` (GitHub username) from OAuth
6. [SpacedRepetition](src/spaced-core.ts) class queries D1 with `user_id` filter
7. Response sent back through MCP protocol

### Key Components

**[src/index.ts](src/index.ts)**
Main entry point. Defines 8 MCP tools (`add_card`, `get_due_cards`, `search_cards`, `get_all_cards`, `review_card`, `edit_card`, `delete_card`, `get_stats`). Each tool creates a `SpacedRepetition` instance scoped to `this.props.login` (GitHub username from OAuth).

**[src/spaced-core.ts](src/spaced-core.ts)**
Core spaced repetition logic. Implements SM-2 algorithm for review scheduling. All database queries filter by `user_id` for data isolation. Uses D1 SQLite with FTS5 for full-text search.

**[src/github-handler.ts](src/github-handler.ts)**
GitHub OAuth handler. Exchanges OAuth code for access token, fetches user info from GitHub API, and stores user context (`login`, `name`, `email`, `accessToken`) encrypted in the MCP session.

**[src/workers-oauth-utils.ts](src/workers-oauth-utils.ts)**
OAuth utilities for Cloudflare Workers OAuth Provider integration.

**[schema.sql](schema.sql)**
Database schema with 3 main tables (`cards`, `tags`, `reviews`) plus `cards_fts` virtual table for full-text search. Triggers keep FTS index synced. All tables have `user_id` column for multi-tenancy.

**[wrangler.jsonc](wrangler.jsonc)**
Cloudflare Workers configuration. Defines bindings for D1 database (`DB`), KV namespace (`OAUTH_KV`), and AI inference (`AI`). Uses Durable Objects for stateful MCP sessions.

### Data Model

- **Cards**: Store learning instructions (not static Q&A)
- **Tags**: Many-to-many relationship with cards
- **Reviews**: One per card, stores SM-2 state (easiness_factor, interval, repetitions, next_review_date)
- **User isolation**: All tables have `user_id TEXT NOT NULL` column

### SM-2 Algorithm

Located in [src/spaced-core.ts](src/spaced-core.ts#L379-L414). Key rules:
- Difficulty < 3: Reset to interval=1, repetitions=0
- First review: interval=1 day
- Second review: interval=6 days
- Subsequent: interval = previous_interval × easiness_factor
- Easiness factor adjusts based on difficulty (1-5)

## Environment Setup

### Production
Requires 3 secrets (set via `wrangler secret put`):
- `GITHUB_CLIENT_ID` - From GitHub OAuth app
- `GITHUB_CLIENT_SECRET` - From GitHub OAuth app
- `COOKIE_ENCRYPTION_KEY` - Generate with `openssl rand -hex 32`

Requires D1 database and KV namespace (IDs in [wrangler.jsonc](wrangler.jsonc)):
- Update `d1_databases[0].database_id` after creating D1 database
- Update `kv_namespaces[0].id` after creating KV namespace

### Local Development
Create `.dev.vars` file:
```bash
GITHUB_CLIENT_ID=dev_client_id
GITHUB_CLIENT_SECRET=dev_client_secret
COOKIE_ENCRYPTION_KEY=any_random_string
```

Use separate GitHub OAuth app with callback `http://localhost:8788/callback`.

## MCP Protocol Support

Two transport protocols:
- `/sse` - Legacy SSE (Server-Sent Events) protocol
- `/mcp` - New Streamable-HTTP protocol (preferred)

Both use the same MCP tools underneath. OAuth flow is identical.

## Adding New MCP Tools

Tools are defined in [src/index.ts](src/index.ts#L27-L294) using:
```typescript
this.server.tool(
  "tool_name",
  "Tool description",
  { param1: z.string().describe("...") },
  async ({ param1 }) => {
    const db = getUserDb(); // Scoped to this.props.login
    // ... implementation
    return { content: [{ text: "result", type: "text" }] };
  }
);
```

All database operations should use the `getUserDb()` helper to ensure user isolation.

## Common Gotchas

1. **User Isolation**: Always use `this.props.login` from OAuth context as `user_id`. Never hardcode or skip this filter.

2. **D1 Batching**: Use `this.db.batch([...queries])` for multiple inserts (e.g., tags) to reduce round trips.

3. **Date Handling**: D1 SQLite uses `DATE('now')` for current date. Dates stored as `YYYY-MM-DD` strings. JavaScript `Date.toISOString().split('T')[0]` for formatting.

4. **FTS Triggers**: Modifying cards table schema requires updating FTS triggers in [schema.sql](schema.sql#L44-L57).

5. **OAuth Context**: `this.props` is populated by [src/github-handler.ts](src/github-handler.ts) after successful OAuth. Contains `{ login, name, email, accessToken }`.

6. **Type Safety**: Run `npm run type-check` before deployment. Worker bindings defined in [worker-configuration.d.ts](worker-configuration.d.ts) (auto-generated).

## Testing Workflow

1. Make code changes
2. Run `npx wrangler dev` (local server on :8788)
3. Test with MCP Inspector: `npx @modelcontextprotocol/inspector`
4. Connect to `http://localhost:8788/sse`
5. Complete OAuth flow
6. Test tools in Inspector
7. Deploy with `npx wrangler deploy`
8. Test production via real MCP client (Claude/Cursor)

## Database Migrations

To modify schema:
1. Update [schema.sql](schema.sql)
2. Run locally: `npx wrangler d1 execute spaced-repetition-db --local --file=schema.sql`
3. Deploy to prod: `npx wrangler d1 execute spaced-repetition-db --file=schema.sql`

For additive changes (new columns/tables), use `ALTER TABLE`. For breaking changes, coordinate with data migration strategy.

## Related Documentation

- [README.md](README.md) - User-facing overview and features
- [SETUP.md](SETUP.md) - Complete setup guide for deploying and connecting clients
- Parent directory [README.md](../README.md) - CLI version of spaced repetition (separate project)
- Parent directory [AI_GUIDE.md](../AI_GUIDE.md) - Guide for AI assistants using the spaced repetition system
