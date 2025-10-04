# Deployment Checklist

Quick checklist to get your Spaced Repetition MCP server deployed.

## ☐ Prerequisites
- [ ] GitHub account created
- [ ] Cloudflare account created (free tier)
- [ ] Node.js installed (`node --version`)

## ☐ GitHub OAuth Apps

### Production OAuth App
- [ ] Create at https://github.com/settings/developers
- [ ] Homepage URL: `https://spaced-mcp-server.<your-cf-username>.workers.dev`
- [ ] Callback URL: `https://spaced-mcp-server.<your-cf-username>.workers.dev/callback`
- [ ] Save Client ID: `___________________________`
- [ ] Save Client Secret: `___________________________`

### Dev OAuth App (for local testing)
- [ ] Create second OAuth app
- [ ] Homepage URL: `http://localhost:8788`
- [ ] Callback URL: `http://localhost:8788/callback`
- [ ] Save Dev Client ID: `___________________________`
- [ ] Save Dev Client Secret: `___________________________`

## ☐ Install Dependencies
```bash
cd spaced-mcp-server
npm install
```

## ☐ Cloudflare Setup

### Login
```bash
npx wrangler login
```

### Create D1 Database
```bash
npx wrangler d1 create spaced-repetition-db
```
- [ ] Copy `database_id` from output
- [ ] Update `wrangler.jsonc` line 52 with database_id

### Initialize Schema
```bash
npx wrangler d1 execute spaced-repetition-db --file=schema.sql
```

### Create KV Namespace
```bash
npx wrangler kv namespace create "OAUTH_KV"
```
- [ ] Copy `id` from output
- [ ] Update `wrangler.jsonc` line 45 with KV id

### Set Secrets
```bash
# Generate encryption key
openssl rand -hex 32

# Set production secrets
npx wrangler secret put GITHUB_CLIENT_ID
# Paste production Client ID

npx wrangler secret put GITHUB_CLIENT_SECRET
# Paste production Client Secret

npx wrangler secret put COOKIE_ENCRYPTION_KEY
# Paste encryption key from openssl command
```

## ☐ Deploy
```bash
npx wrangler deploy
```
- [ ] Note your worker URL: `___________________________`

## ☐ Test Deployment
```bash
npx @modelcontextprotocol/inspector
```
- [ ] Enter: `https://your-worker-url.workers.dev/sse`
- [ ] Click Connect
- [ ] Complete GitHub OAuth
- [ ] Verify tools appear in list

## ☐ Connect to Claude Web
1. [ ] Go to https://claude.ai/settings/integrations
2. [ ] Click "Add custom connector"
3. [ ] Enter: `https://your-worker-url.workers.dev/mcp`
4. [ ] Complete OAuth flow
5. [ ] Verify tools show under 🔨 icon
6. [ ] Test: "What cards are due today?"

## ☐ Connect to Claude Desktop (Optional)
1. [ ] Open config file:
   - Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
2. [ ] Add configuration:
```json
{
  "mcpServers": {
    "spaced-repetition": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://your-worker-url.workers.dev/sse"
      ]
    }
  }
}
```
3. [ ] Restart Claude Desktop
4. [ ] Complete OAuth in browser
5. [ ] Verify tools available

## ☐ Connect to Cursor (Optional)
1. [ ] Cursor Settings → Features → MCP
2. [ ] Add server:
   - Name: `spaced-repetition`
   - Type: `Command`
   - Command: `npx mcp-remote https://your-worker-url.workers.dev/sse`
3. [ ] Restart Cursor
4. [ ] Complete OAuth
5. [ ] Test with Cursor's AI

## ☐ Local Development Setup (Optional)

### Create .dev.vars
```bash
cat > .dev.vars << EOF
GITHUB_CLIENT_ID=your_dev_client_id
GITHUB_CLIENT_SECRET=your_dev_client_secret
COOKIE_ENCRYPTION_KEY=any_random_string
EOF
```

### Start Dev Server
```bash
npx wrangler dev
```

### Test Locally
```bash
npx @modelcontextprotocol/inspector
```
- [ ] Enter: `http://localhost:8788/sse`
- [ ] Verify connection works

## ✅ Success Criteria

You're done when:
- [ ] Can ask Claude: "Add a card about Python" and get "Created card 1"
- [ ] Can ask: "What cards are due?" and see your cards
- [ ] Can review a card and see next review date
- [ ] Same cards appear in all connected MCP clients

## 🐛 Troubleshooting

### "No tools available"
- Verify OAuth completed (check browser)
- Restart MCP client
- Check URL has `/sse` or `/mcp` endpoint

### "Database not found"
- Run: `npx wrangler d1 execute spaced-repetition-db --file=schema.sql`
- Verify database_id in wrangler.jsonc

### "OAuth failed"
- Verify callback URLs match exactly
- Check secrets are set: `npx wrangler secret list`
- Try in incognito/private browser window

### "Card not found"
- Each user has isolated cards
- Verify you're logged in as correct GitHub user

## 📚 Next Steps

Once deployed:
1. Add your first card: "Add a card to practice [topic]"
2. Set up review routine: Check "What's due?" daily
3. Customize card instructions for your learning style
4. Use tags to organize by topic
5. Share your worker URL with friends (they'll have separate cards)

## 🎉 You're Ready!

Your personal spaced repetition system is now live and accessible from any MCP client!
