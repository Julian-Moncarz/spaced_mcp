# Spaced Repetition MCP Server

A remote [Model Context Protocol](https://modelcontextprotocol.io) server that brings spaced repetition to Claude, Claude Code, Cursor, and other MCP clients.

## What It Does

Turns your AI assistants into personalized tutors with spaced repetition. Instead of static flashcards, Claude generates fresh practice problems based on your stored instructions.

**Example conversation:**
```
You: "Add a card to help me practice Python decorators"
Claude: Created card 1

You: "What's due today?"
Claude: Card 1: Practice implementing decorators... Due: today

You: "Give me a decorator problem"
Claude: [generates custom practice problem]
[You work through it together]

You: "That was medium difficulty, rate it 3"
Claude: Card 1 reviewed. Next review in 6 days.
```

## Features

- ✅ **8 MCP tools** for card management (add, search, review, edit, delete, stats)
- ✅ **GitHub OAuth** authentication with user isolation
- ✅ **Cloudflare D1** SQLite database (free tier)
- ✅ **FSRS algorithm** for optimal review scheduling (modern, ML-based)
- ✅ **Full-text search** with FTS5
- ✅ **Works everywhere**: Claude web, Claude Desktop, Claude Code, Cursor, Windsurf
- ✅ **Private & secure**: Your cards are isolated to your GitHub account

## Quick Start

**1. Deploy (5 minutes):**
```bash
git clone <this-repo>
cd spaced-mcp-server
npm install
```

Follow [SETUP.md](SETUP.md) for complete deployment instructions.

**2. Connect to Claude:**
- Go to https://claude.ai/settings/integrations
- Add custom connector: `https://your-worker.workers.dev/mcp`
- Authorize with GitHub

**3. Start using:**
```
"Add a card about binary search trees"
"What cards are due?"
"Give me a practice problem"
```

## Documentation

- **[SETUP.md](SETUP.md)** - Complete setup guide for all MCP clients
- **[schema.sql](schema.sql)** - Database schema
- **[src/spaced-core.ts](src/spaced-core.ts)** - Core spaced repetition logic
- **[src/index.ts](src/index.ts)** - MCP tool definitions

## Architecture

```
┌─────────────────────────────────────────────┐
│  MCP Clients                                │
│  • Claude (web, desktop, code)              │
│  • Cursor                                   │
│  • Windsurf                                 │
└─────────────────┬───────────────────────────┘
                  │ OAuth + MCP Protocol
                  ▼
┌─────────────────────────────────────────────┐
│  Cloudflare Worker (Your Server)            │
│  • GitHub OAuth                             │
│  • 8 MCP Tools                              │
│  • User isolation                           │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│  Cloudflare D1 (SQLite)                     │
│  • Cards with FTS5 search                   │
│  • Tags                                     │
│  • Review history & SM-2 state              │
└─────────────────────────────────────────────┘
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `add_card` | Create a new card with instructions and tags |
| `get_due_cards` | Get cards due for review today |
| `search_cards` | Full-text search across cards |
| `get_all_cards` | List all your cards |
| `review_card` | Submit review with FSRS rating (1-4: Again/Hard/Good/Easy) |
| `edit_card` | Update card instructions or tags |
| `delete_card` | Permanently remove a card |
| `get_stats` | View statistics (total, due, by tag) |

## Why MCP?

Traditional spaced repetition apps use static flashcards. This system stores *instructions* for Claude to generate dynamic practice problems:

**Traditional flashcard:**
```
Q: What is a Python decorator?
A: A function that wraps another function
```

**Spaced repetition MCP card:**
```
Instructions: Generate problems about Python decorators.
User struggles with nested decorators and passing arguments.
Start simple, gradually increase complexity.
```

Claude reads these instructions and generates fresh, personalized practice every time.

## Tech Stack

- **Runtime**: Cloudflare Workers (serverless)
- **Database**: Cloudflare D1 (SQLite with FTS5)
- **Auth**: GitHub OAuth via workers-oauth-provider
- **Protocol**: MCP (Model Context Protocol)
- **Language**: TypeScript
- **Algorithm**: FSRS (Free Spaced Repetition Scheduler) via ts-fsrs

## Cost

Free tier includes:
- 100k requests/day
- 5GB storage
- 100k reads/day

Plenty for personal use.

## Local Development

```bash
# Create .dev.vars with dev OAuth credentials
# (see SETUP.md for details)

npx wrangler dev

# Test with MCP Inspector
npx @modelcontextprotocol/inspector
# Enter: http://localhost:8788/sse
```

## Credits

Based on:
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Cloudflare MCP Templates](https://github.com/cloudflare/ai/tree/main/demos)
- [FSRS Algorithm](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm)
- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)

## License

MIT
