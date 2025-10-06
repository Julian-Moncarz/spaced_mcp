# Troubleshooting Guide

Common issues and how to fix them.

## OAuth Issues

### "Failed to fetch access token"

**Symptoms:** After clicking "Continue" on Google sign-in, you see "Failed to fetch access token"

**Causes & Fixes:**

1. **Missing grant_type parameter** (fixed in latest version)
   - Update to latest code: `git pull`
   - Redeploy: `npx wrangler deploy`

2. **Wrong Google OAuth redirect URI**
   - Go to [Google Cloud Console > Credentials](https://console.cloud.google.com/apis/credentials)
   - Edit your OAuth client
   - Verify redirect URI exactly matches: `https://spaced-mcp-server.spaced-repetition-mcp.workers.dev/callback`
   - No trailing slash, exact match required

3. **Missing or wrong secrets**
   ```bash
   # Verify secrets exist
   npx wrangler secret list

   # Should show:
   # - GOOGLE_CLIENT_ID
   # - GOOGLE_CLIENT_SECRET
   # - COOKIE_ENCRYPTION_KEY

   # If missing, set them:
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

4. **Check logs for detailed error**
   ```bash
   npx wrangler tail --format pretty
   ```
   Then retry OAuth flow and look for the error message

### "Missing or invalid access token"

**Symptoms:** MCP client shows authentication error

**Fixes:**

1. **Clear cookies and reconnect**
   - Clear browser cookies for the worker domain
   - Disconnect and reconnect in your MCP client

2. **Token expired**
   - Simply reconnect - tokens expire after some time
   - This is normal behavior

3. **Check worker is deployed**
   ```bash
   npx wrangler deployments list
   ```
   Should show recent deployment

## Connection Issues

### MCP client can't find the server

**Symptoms:** "Connection failed" or "Server not found"

**Fixes:**

1. **Verify URL is correct**
   - Must end with `/mcp` (not `/sse`)
   - Example: `https://spaced-mcp-server.spaced-repetition-mcp.workers.dev/mcp`

2. **Test worker is responding**
   ```bash
   curl -I https://spaced-mcp-server.spaced-repetition-mcp.workers.dev/mcp
   ```
   Should return HTTP 401 (unauthorized) - this is correct!

3. **Check worker status**
   ```bash
   npx wrangler deployments list
   ```

### Connection works but no tools appear

**Symptoms:** MCP connects but tools list is empty

**Fixes:**

1. **OAuth not completed**
   - Make sure you completed the full OAuth flow
   - Try disconnecting and reconnecting

2. **Check Durable Object initialization**
   ```bash
   npx wrangler tail --format pretty
   ```
   Look for "MyMCP.init" or similar messages

## Database Issues

### "Card not found" errors

**Symptoms:** Operations fail with "Card not found"

**Causes:**

1. **Wrong user context**
   - Cards are isolated by user email
   - Make sure you're using the same Google account

2. **Check database**
   ```bash
   # List all cards for all users (admin query)
   npx wrangler d1 execute spaced-repetition-db --remote \
     --command="SELECT id, user_id, instructions FROM cards"
   ```

### Database schema errors

**Symptoms:** SQL errors about missing tables or columns

**Fixes:**

1. **Reinitialize schema**
   ```bash
   npx wrangler d1 execute spaced-repetition-db --remote --file=schema.sql
   ```

2. **Check tables exist**
   ```bash
   npx wrangler d1 execute spaced-repetition-db --remote \
     --command="SELECT name FROM sqlite_master WHERE type='table'"
   ```
   Should show: `cards`, `tags`, `reviews`, `cards_fts`, etc.

## Local Development Issues

### Local dev server won't start

**Symptoms:** `npx wrangler dev` fails

**Fixes:**

1. **Missing .dev.vars file**
   ```bash
   cp .dev.vars.example .dev.vars
   # Edit .dev.vars with your local OAuth credentials
   ```

2. **Port 8788 already in use**
   ```bash
   # Kill existing process
   lsof -ti:8788 | xargs kill

   # Or use different port
   npx wrangler dev --port 8789
   ```

3. **Node version too old**
   ```bash
   node --version  # Should be 18+
   ```

### OAuth fails in local dev

**Symptoms:** OAuth redirect fails on localhost

**Fixes:**

1. **Create separate OAuth app for local dev**
   - Go to Google Cloud Console
   - Create new OAuth client
   - Add redirect URI: `http://localhost:8788/callback` (note: http, not https)
   - Use these credentials in `.dev.vars`

2. **Check .dev.vars format**
   ```bash
   # Must be:
   GOOGLE_CLIENT_ID=123456789.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
   COOKIE_ENCRYPTION_KEY=any_string

   # No quotes, no spaces around =
   ```

## Type Errors

### TypeScript compilation errors

**Symptoms:** `npm run type-check` fails

**Fixes:**

1. **Regenerate types**
   ```bash
   npx wrangler types
   npm run type-check
   ```

2. **Check worker-configuration.d.ts exists**
   - Should be auto-generated
   - Contains bindings for DB, OAUTH_KV, AI

## Performance Issues

### Slow responses

**Causes:**

1. **Cold start** - First request after idle period is slower
2. **Database far from user** - D1 database location matters

**Monitoring:**

```bash
npx wrangler tail --format pretty
```

Look for "Worker Startup Time" and query durations

### Rate limiting

**Symptoms:** Intermittent failures, 429 errors

**Check quotas:**

```bash
# Free tier limits:
# - 100k requests/day
# - 100k D1 reads/day
# - 50k D1 writes/day
```

View usage in [Cloudflare Dashboard > Analytics](https://dash.cloudflare.com)

## Debugging Tips

### Enable detailed logging

Add console.log statements to your code:

```typescript
// In src/index.ts or src/spaced-core.ts
console.log('Debug:', { userId: this.props.login, cardId, ... });
```

Deploy and watch logs:
```bash
npx wrangler deploy && npx wrangler tail --format pretty
```

### Check environment variables

```bash
# List secrets (shows names only, not values)
npx wrangler secret list

# Verify bindings in dry-run
npx wrangler deploy --dry-run
```

### Query database directly

```bash
# See all users
npx wrangler d1 execute spaced-repetition-db --remote \
  --command="SELECT DISTINCT user_id FROM cards"

# Count cards per user
npx wrangler d1 execute spaced-repetition-db --remote \
  --command="SELECT user_id, COUNT(*) as count FROM cards GROUP BY user_id"

# See recent reviews
npx wrangler d1 execute spaced-repetition-db --remote \
  --command="SELECT * FROM reviews ORDER BY last_review DESC LIMIT 10"
```

### Test MCP protocol manually

```bash
# Test initialize (should fail with 401)
curl -X POST https://spaced-mcp-server.spaced-repetition-mcp.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

## Still Having Issues?

1. **Check GitHub Issues**: https://github.com/julianmoncarz/spaced-mcp-server/issues
2. **Review logs**: `npx wrangler tail --format pretty`
3. **Check Cloudflare status**: https://www.cloudflarestatus.com/
4. **Verify Google OAuth status**: https://console.cloud.google.com/

## Common Log Messages

### Normal (Good)
```
✅ Connection established
✅ MyMCP.updateProps
✅ POST /mcp - Ok
```

### Errors to Fix
```
❌ Failed to fetch access token
❌ Missing or invalid access token
❌ OAuth error response: 401
❌ unsupported_grant_type
```

### Warnings (Usually OK)
```
⚠️  OAuth error response: 401 invalid_token - Missing or invalid access token
   (This is normal for unauthorized requests)
```
