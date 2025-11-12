# Latency Analysis Results

## Test 1: Basic HTTP Endpoints (from test-latency.js)

### Production (Cloudflare Workers)
- Favicon (no auth): **312ms** 
- MCP server card (no auth): **232ms**
- MCP endpoint (expect 401): **24ms**

### Local Dev
- Favicon (no auth): **12ms**
- MCP server card (no auth): **4ms**
- MCP endpoint (expect 401): **4ms**

## Initial Findings

1. **Static assets are slow in production (200-300ms)** - This suggests cold start issues
2. **Local dev is very fast (<15ms)** - The code itself isn't the problem
3. **The difference is 10-50x between local and production**

## Likely Causes

### Most Probable: Cloudflare Workers Cold Starts
When Claude calls a tool:
1. Request hits Cloudflare edge (~50-100ms network)
2. **Worker cold start** (~200-500ms if not warmed up)
3. **Durable Object cold start** (~200-500ms if not warmed up)
4. OAuth session validation (~50-100ms)
5. Durable Object `onStart()` + `init()` execution
6. Actual tool execution (< 50ms based on local tests)
7. Response back through MCP protocol (~50-100ms)

**Total: 550ms - 1350ms** for a cold request

### How Durable Objects Work
- Each MCP session gets a Durable Object instance
- If idle for a few minutes, the DO is evicted from memory
- Next request requires:
  - DO instantiation
  - Loading state from storage
  - Running `onStart()` which calls `reinitializeServer()`
  - Running your `init()` which registers 9 tools with descriptions

### Tool Registration Overhead
Looking at `src/index.ts`, the `init()` method:
- Registers 9 tools with `this.server.tool(...)`
- Each tool has detailed descriptions and Zod schemas
- This happens EVERY TIME the Durable Object starts

## Testing Hypothesis

To confirm this is cold starts, you would need to:

1. **Check Cloudflare Dashboard** → Analytics → Performance
   - Look for "Cold Start" metrics
   - Check "CPU Time" for Durable Objects

2. **Add timing logs** to `init()`:
   ```typescript
   async init() {
       const start = Date.now();
       // ... existing code ...
       console.log(`[PERF] init() took ${Date.now() - start}ms`);
   }
   ```

3. **Test consecutive requests**: Make 2 tool calls within 30 seconds
   - First should be slow (cold start)
   - Second should be fast (warm)

## Potential Solutions

### 1. Accept It (Recommended for MVP)
- Cold starts are normal for Cloudflare Workers/DOs
- 500ms-1s is acceptable for occasional tool calls
- Claude.ai adds its own UI latency on top

### 2. Keep-Alive (If Frequent Usage)
- Use Cloudflare Cron Triggers to ping the worker every 1-2 minutes
- Keeps Workers/DOs warm
- Costs more, but reduces latency to < 200ms

### 3. Optimize init() (Minor Gain)
- Cache tool registrations instead of recreating each time
- Reduce description strings
- Lazy-load tools only when first called
- **Estimated savings: 50-100ms**

### 4. Smart Placement (If Global Users)
- Enable `placement: { mode: "smart" }` in wrangler.jsonc
- Routes requests to closest Cloudflare region with your data
- May reduce D1 database latency
- **Estimated savings: 20-50ms for database-heavy operations**

## Recommendation

**The latency you're experiencing is NORMAL for Cloudflare Workers with Durable Objects.**

- Cold starts: ~500-1000ms (what you're seeing)
- Warm requests: ~100-200ms
- This is inherent to the serverless architecture

**To verify this is expected behavior:**
1. Make a tool call in Claude
2. Immediately make another tool call
3. If the second is much faster, it's cold starts (expected)
4. If both are slow, there's a different issue

**The latency is NOT in your code** - your database queries and logic are fine based on local testing.

**The latency IS in:**
- Cloudflare network routing
- Worker/DO cold starts (biggest factor)
- OAuth/session validation
- MCP protocol overhead
- Claude.ai UI rendering (you can't control this)

## Questions to Ask

1. How often are you using the tools? (once per hour = always cold, once per minute = usually warm)
2. Are you seeing the same latency on EVERY tool call, or just the first one?
3. Is the latency from when you hit Enter in Claude to when you see "thinking..." or from "thinking..." to response?
4. Are other MCP servers you use equally slow?
