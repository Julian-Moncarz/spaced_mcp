# Setup Guide

Complete setup guide for deploying your own Spaced Repetition MCP Server to Cloudflare Workers.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ installed
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- A [Google Cloud](https://console.cloud.google.com/) account (free)

## Part 1: Deploy to Cloudflare Workers

### 1. Clone and Install

```bash
git clone https://github.com/julianmoncarz/spaced-mcp-server
cd spaced-mcp-server
npm install
```

### 2. Login to Cloudflare

```bash
npx wrangler login
```

This opens your browser to authenticate with Cloudflare.

### 3. Create D1 Database

```bash
npx wrangler d1 create spaced-repetition-db
```

Copy the `database_id` from the output and update `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "spaced-repetition-db",
    "database_id": "YOUR_DATABASE_ID_HERE"  // ← Replace this
  }
]
```

### 4. Initialize Database Schema

```bash
npx wrangler d1 execute spaced-repetition-db --file=schema.sql
```

### 5. Create KV Namespace

```bash
npx wrangler kv:namespace create OAUTH_KV
```

Copy the `id` from the output and update `wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  {
    "binding": "OAUTH_KV",
    "id": "YOUR_KV_ID_HERE"  // ← Replace this
  }
]
```

### 6. Deploy Worker

```bash
npx wrangler deploy
```

Save the URL from the output (e.g., `https://spaced-mcp-server.your-subdomain.workers.dev`).

## Part 2: Configure Google OAuth

### 1. Create Google OAuth App

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Navigate to **APIs & Services > Credentials**

### 2. Configure OAuth Consent Screen

1. Click **CONFIGURE CONSENT SCREEN**
2. Choose **External** (unless using Google Workspace)
3. Fill in:
   - **App name**: `Spaced Repetition MCP`
   - **User support email**: Your email
   - **Developer contact**: Your email
4. Click **SAVE AND CONTINUE**
5. **Scopes**: Add these scopes:
   - `openid`
   - `email`
   - `profile`
6. **Test users** (if External): Add your email
7. Click **SAVE AND CONTINUE**, then **BACK TO DASHBOARD**

### 3. Create OAuth Credentials

1. Go back to **Credentials**
2. Click **+ CREATE CREDENTIALS > OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Name: `Spaced MCP Server`
5. **Authorized redirect URIs** - Add:
   ```
   https://spaced-mcp-server.your-subdomain.workers.dev/callback
   http://localhost:8788/callback
   ```
   (Replace `your-subdomain` with your actual worker URL)
6. Click **CREATE**
7. **Copy your Client ID and Client Secret**

### 4. Set Cloudflare Secrets

```bash
# Set Google Client ID
npx wrangler secret put GOOGLE_CLIENT_ID
# Paste your client ID when prompted

# Set Google Client Secret
npx wrangler secret put GOOGLE_CLIENT_SECRET
# Paste your client secret when prompted

# Generate and set encryption key
npx wrangler secret put COOKIE_ENCRYPTION_KEY
# Paste a random 64-character hex string (generate with: openssl rand -hex 32)
```

## Part 3: Connect MCP Clients

### Claude.ai (Web)

1. Go to https://claude.ai/settings/integrations
2. Click **Add custom connector**
3. Enter your worker URL with `/mcp` endpoint:
   ```
   https://spaced-mcp-server.your-subdomain.workers.dev/mcp
   ```
4. Click **Connect**
5. Click **Approve** on the Cloudflare page
6. Sign in with Google
7. Done! Claude now has access to spaced repetition tools

### Claude Desktop

Add to your `claude_desktop_config.json`:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "spaced-repetition": {
      "url": "https://spaced-mcp-server.your-subdomain.workers.dev/mcp"
    }
  }
}
```

Restart Claude Desktop and connect via the integrations menu.

### Cursor

Add to `.cursor/mcp.json` in your home directory:

```json
{
  "mcpServers": {
    "spaced-repetition": {
      "url": "https://spaced-mcp-server.your-subdomain.workers.dev/mcp"
    }
  }
}
```

Restart Cursor and authorize via Settings > MCP.

### Windsurf

Add to Windsurf's MCP settings (similar to Cursor):

```json
{
  "mcpServers": {
    "spaced-repetition": {
      "url": "https://spaced-mcp-server.your-subdomain.workers.dev/mcp"
    }
  }
}
```

## Part 4: Test Your Setup

Ask your MCP client:

```
"Add a card about Python list comprehensions"
```

Expected response:
```
Created card 1
```

Check it worked:
```
"Get my stats"
```

Expected response:
```
Cards due today: 1
Total cards: 1
```

Success! 🎉

## Local Development

### 1. Create `.dev.vars`

Create a `.dev.vars` file in the project root:

```bash
GOOGLE_CLIENT_ID=your_dev_client_id
GOOGLE_CLIENT_SECRET=your_dev_client_secret
COOKIE_ENCRYPTION_KEY=any_random_string_for_dev
```

**Note**: Create a separate Google OAuth app with callback `http://localhost:8788/callback` for local development.

### 2. Run Local Server

```bash
npx wrangler dev
```

Server runs on `http://localhost:8788`

### 3. Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Connect to: `http://localhost:8788/sse`

Complete the OAuth flow, then test all 8 MCP tools.

## Troubleshooting

### "Failed to fetch access token"

- Check that `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set correctly
- Verify the redirect URI in Google OAuth matches your worker URL exactly
- Check logs: `npx wrangler tail --format pretty`

### "Missing or invalid access token"

- Clear browser cookies and reconnect
- Check that your worker is deployed: `npx wrangler deployments list`

### Database Errors

```bash
# Check database exists
npx wrangler d1 list

# Re-initialize schema
npx wrangler d1 execute spaced-repetition-db --file=schema.sql

# Query database
npx wrangler d1 execute spaced-repetition-db --remote --command="SELECT * FROM cards"
```

### Check Logs

```bash
npx wrangler tail --format pretty
```

Then trigger the error by connecting from your MCP client.

## Useful Commands

```bash
# Deploy to production
npx wrangler deploy

# View deployments
npx wrangler deployments list

# List secrets
npx wrangler secret list

# Delete a secret
npx wrangler secret delete SECRET_NAME

# Check types
npm run type-check

# Regenerate TypeScript types
npx wrangler types

# Query database
npx wrangler d1 execute spaced-repetition-db --remote --command="SELECT * FROM cards"
```

## Security Notes

- All secrets are encrypted by Cloudflare
- User data is isolated by Google email (from OAuth)
- Never commit `.dev.vars` or secrets to git
- Use separate OAuth apps for dev/prod environments

## Cost Estimate

**Cloudflare Workers Free Tier:**
- 100,000 requests/day
- 10ms CPU time per request
- 5GB D1 storage
- 100,000 D1 reads/day
- 50,000 D1 writes/day

**Typical personal use:**
- ~100 requests/day
- Well within free tier limits
- $0/month

## Next Steps

- Read [CLAUDE.md](CLAUDE.md) for development tips
- Check [schema.sql](schema.sql) for database structure
- Explore [src/spaced-core.ts](src/spaced-core.ts) for FSRS implementation
- See [README.md](README.md) for architecture overview

## Support

- Report issues: https://github.com/julianmoncarz/spaced-mcp-server/issues
- MCP Protocol docs: https://modelcontextprotocol.io
- Cloudflare Workers docs: https://developers.cloudflare.com/workers
