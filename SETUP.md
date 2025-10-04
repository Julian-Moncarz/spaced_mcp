# Spaced Repetition MCP Server - Setup Guide

A remote MCP server that provides spaced repetition tools to Claude, Claude Code, Cursor, and other MCP clients. Cards are stored in a Cloudflare D1 database and isolated per GitHub user via OAuth.

## What You'll Get

After setup, you can talk to Claude naturally:
- "Add a card about Python decorators"
- "What cards are due today?"
- "Give me a practice problem for card 5"
- "That was medium difficulty, rate it 3"

Your cards sync across all MCP clients (Claude web, Claude Desktop, Cursor, etc).

## Prerequisites

- GitHub account
- Cloudflare account (free tier works)
- Node.js installed locally

## Setup Steps

### 1. Clone and Install

```bash
cd spaced-mcp-server
npm install
```

### 2. Create GitHub OAuth Apps

You need TWO OAuth apps (one for local dev, one for production):

#### Production OAuth App
1. Go to https://github.com/settings/developers
2. Click "New OAuth App"
3. Fill in:
   - **Application name**: `Spaced Repetition MCP`
   - **Homepage URL**: `https://spaced-mcp-server.<your-username>.workers.dev`
   - **Authorization callback URL**: `https://spaced-mcp-server.<your-username>.workers.dev/callback`
4. Click "Register application"
5. Note your **Client ID**
6. Generate a **Client secret** and save it

#### Development OAuth App (for local testing)
1. Create another OAuth App with:
   - **Homepage URL**: `http://localhost:8788`
   - **Authorization callback URL**: `http://localhost:8788/callback`
2. Note the **Client ID** and **Client secret**

### 3. Set Up Cloudflare Resources

#### Login to Cloudflare
```bash
npx wrangler login
```

#### Create D1 Database
```bash
npx wrangler d1 create spaced-repetition-db
```

Copy the `database_id` from the output and update `wrangler.jsonc`:
```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "spaced-repetition-db",
    "database_id": "YOUR_DATABASE_ID_HERE"  // ← Update this
  }
],
```

#### Initialize Database Schema
```bash
npx wrangler d1 execute spaced-repetition-db --file=schema.sql
```

#### Create KV Namespace
```bash
npx wrangler kv namespace create "OAUTH_KV"
```

Copy the `id` from the output and update `wrangler.jsonc`:
```jsonc
"kv_namespaces": [
  {
    "binding": "OAUTH_KV",
    "id": "YOUR_KV_ID_HERE"  // ← Update this
  }
],
```

#### Set Production Secrets
```bash
npx wrangler secret put GITHUB_CLIENT_ID
# Paste your production Client ID

npx wrangler secret put GITHUB_CLIENT_SECRET
# Paste your production Client secret

npx wrangler secret put COOKIE_ENCRYPTION_KEY
# Generate with: openssl rand -hex 32
```

### 4. Deploy to Production

```bash
npx wrangler deploy
```

Note your worker URL (e.g., `https://spaced-mcp-server.<your-username>.workers.dev`)

### 5. Connect to Claude (Web)

1. Go to https://claude.ai/settings/integrations
2. Click "Add custom connector"
3. Enter your worker URL with `/mcp` endpoint:
   ```
   https://spaced-mcp-server.<your-username>.workers.dev/mcp
   ```
4. Click through the GitHub OAuth flow
5. Once connected, the tools will appear under the 🔨 icon

### 6. Connect to Claude Desktop

Edit your Claude Desktop config:
- **Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add this configuration:
```json
{
  "mcpServers": {
    "spaced-repetition": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://spaced-mcp-server.<your-username>.workers.dev/sse"
      ]
    }
  }
}
```

Restart Claude Desktop. A browser will open for OAuth authentication.

### 7. Connect to Cursor

1. Open Cursor settings → Features → MCP
2. Add a new MCP server:
   - **Name**: `spaced-repetition`
   - **Type**: `Command`
   - **Command**: `npx mcp-remote https://spaced-mcp-server.<your-username>.workers.dev/sse`
3. Restart Cursor
4. Complete OAuth flow in browser

### 8. Connect to Claude Code

In Claude Code, run:
```
/settings
```

Add the MCP server configuration:
```json
{
  "mcpServers": {
    "spaced-repetition": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://spaced-mcp-server.<your-username>.workers.dev/sse"
      ]
    }
  }
}
```

Restart Claude Code and complete the OAuth flow.

## Local Development (Optional)

For iterating on the server:

1. Create `.dev.vars` file:
```bash
GITHUB_CLIENT_ID=your_dev_github_client_id
GITHUB_CLIENT_SECRET=your_dev_github_client_secret
COOKIE_ENCRYPTION_KEY=any_random_string_here
```

2. Start local server:
```bash
npx wrangler dev
```

3. Test with MCP Inspector:
```bash
npx @modelcontextprotocol/inspector
```
Enter `http://localhost:8788/sse` and connect.

## Available Tools

Once connected, these tools are available in your MCP clients:

### `add_card`
Add a new spaced repetition card
- `instructions` (string): Detailed instructions for practice problems
- `tags` (string, optional): Comma-separated tags

### `get_due_cards`
Get cards due for review today
- `limit` (number, optional): Max cards to return
- `tags` (string, optional): Filter by tags

### `search_cards`
Search cards with full-text search
- `query` (string): Search text
- `tags` (string, optional): Filter by tags

### `get_all_cards`
Get all your cards
- `tags` (string, optional): Filter by tags

### `review_card`
Submit a review after practicing
- `card_id` (number): Card ID
- `difficulty` (number 1-5): 1=failed, 2=hard, 3=medium, 4=good, 5=easy

### `edit_card`
Update a card's content
- `card_id` (number): Card ID
- `instructions` (string, optional): New instructions
- `tags` (string, optional): New tags

### `delete_card`
Permanently remove a card
- `card_id` (number): Card ID

### `get_stats`
View your statistics
- `tags` (string, optional): Filter by tags

## Example Usage

```
User: "Add a card to help me practice binary search trees"

Claude: [calls add_card]
"Created card 1"

User: "What's due today?"

Claude: [calls get_due_cards]
"You have 1 card due:
Card 1: Practice implementing binary search tree insertion
Tags: algorithms, data-structures
Due: today"

User: "Give me a BST problem"

Claude: [reads card 1 instructions, generates problem]
"Here's a problem: Implement the insert() method for a BST..."

[User works through it with Claude's help]

User: "That was good difficulty, log it as 4"

Claude: [calls review_card(1, 4)]
"Card 1 reviewed. Next review: 2025-10-09 (in 6 days)"
```

## Troubleshooting

### "No tools available"
- Check that OAuth completed successfully
- Verify the MCP URL includes `/sse` or `/mcp` endpoint
- Restart the MCP client

### "Card not found" errors
- Each GitHub user has isolated cards
- Make sure you're authenticated as the correct user

### "Database not found"
- Run the schema initialization: `npx wrangler d1 execute spaced-repetition-db --file=schema.sql`
- Verify the database_id in wrangler.jsonc matches your D1 database

### Local dev not working
- Ensure `.dev.vars` has the correct dev OAuth credentials
- Use `http://localhost:8788` (not https)
- Check you created a separate dev OAuth app with localhost callback

## Architecture

```
User → Claude/Cursor/etc
        ↓
    MCP Protocol (OAuth authenticated)
        ↓
    Cloudflare Worker (your deployed server)
        ↓
    D1 Database (SQLite, user-isolated)
```

- **Authentication**: GitHub OAuth identifies users
- **Data isolation**: All queries filter by `user_id` (GitHub login)
- **Algorithm**: SM-2 spaced repetition (same as Anki)
- **Search**: SQLite FTS5 for full-text search

## Security Notes

- Cards are private per GitHub user
- OAuth tokens stored encrypted in Cloudflare KV
- All communication over HTTPS
- No data shared between users

## Cost

Cloudflare free tier includes:
- 100,000 Worker requests/day
- 5GB D1 storage
- 100,000 D1 reads/day
- 1,000 D1 writes/day

This is more than enough for personal use.

## Support

For issues:
1. Check the Cloudflare dashboard logs
2. Test with MCP Inspector to isolate client vs server issues
3. Verify GitHub OAuth apps are configured correctly

## Next Steps

Consider adding:
- Export/import functionality
- Statistics dashboard
- Custom review algorithms
- Image/attachment support
- Shared deck functionality
