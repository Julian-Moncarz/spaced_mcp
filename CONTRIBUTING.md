# Contributing Guide

Welcome! This guide will help you set up a development environment and contribute to the Spaced Repetition MCP Server.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Development Setup](#development-setup)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Code Style](#code-style)
- [Common Tasks](#common-tasks)
- [Debugging](#debugging)
- [Deployment](#deployment)
- [Pull Request Process](#pull-request-process)

## Prerequisites

**Required:**
- Node.js 18+ and npm
- A Cloudflare account (free tier is fine)
- Basic knowledge of TypeScript and SQL

**Helpful but not required:**
- Understanding of MCP (Model Context Protocol)
- Familiarity with Cloudflare Workers
- Experience with OAuth flows

## Development Setup

### 1. Clone and Install

```bash
git clone https://github.com/julianmoncarz/spaced-mcp-server
cd spaced-mcp-server
npm install
```

### 2. Set Up Local Database

Create a local D1 database for development:

```bash
# Create local database
npx wrangler d1 create spaced-repetition-db-dev

# Initialize schema
npx wrangler d1 execute spaced-repetition-db-dev --local --file=schema.sql
```

### 3. Configure Environment Variables

Create a `.dev.vars` file in the project root:

```bash
GOOGLE_CLIENT_ID=your_dev_client_id
GOOGLE_CLIENT_SECRET=your_dev_client_secret
COOKIE_ENCRYPTION_KEY=any_random_string_for_local_dev
```

**Note:** You'll need a separate Google OAuth app for local development:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable "Google+ API"
4. Create OAuth 2.0 credentials
5. Add authorized redirect URI: `http://localhost:8788/callback`
6. Copy Client ID and Client Secret to `.dev.vars`

See [SETUP.md](SETUP.md) for detailed OAuth setup instructions.

### 4. Start Development Server

```bash
npx wrangler dev
```

Your local server will be running at `http://localhost:8788`.

### 5. Test with MCP Inspector

In a separate terminal:

```bash
npx @modelcontextprotocol/inspector
```

Then connect to: `http://localhost:8788/sse`

You should see the approval dialog, complete OAuth, and be able to call MCP tools!

## Development Workflow

### Making Changes

#### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
```

#### 2. Make Your Changes

Edit files in `src/`. Common files:
- `src/index.ts` - MCP tool definitions
- `src/spaced-core.ts` - Core logic and database queries
- `src/google-handler.ts` - OAuth flow
- `schema.sql` - Database schema

#### 3. Run Type Check

```bash
npm run type-check
```

Fix any TypeScript errors before proceeding.

#### 4. Test Locally

The dev server auto-reloads when you save files. Test your changes:

```bash
# In terminal 1: dev server should already be running
npx wrangler dev

# In terminal 2: MCP Inspector
npx @modelcontextprotocol/inspector
```

#### 5. Verify Database Changes (if applicable)

```bash
# Check local database
npx wrangler d1 execute spaced-repetition-db-dev --local \
  --command="SELECT * FROM cards LIMIT 5"
```

#### 6. Commit Your Changes

```bash
git add .
git commit -m "feat: your descriptive commit message"
```

Use conventional commit prefixes:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Adding tests
- `chore:` - Maintenance tasks

## Testing

### Manual Testing Workflow

#### Testing a Tool Change

Example: Modifying the `add_card` tool

1. Edit `src/index.ts` (lines 28-48)
2. Save file (wrangler dev auto-reloads)
3. In MCP Inspector:
   - Call `add_card` tool
   - Provide: `instructions="Test card"`, `tags="test"`
   - Check response
4. Verify in database:
   ```bash
   npx wrangler d1 execute spaced-repetition-db-dev --local \
     --command="SELECT * FROM cards ORDER BY id DESC LIMIT 1"
   ```

#### Testing FSRS Integration

1. Add a card via `add_card` tool
2. Get card via `get_due_cards` (should show due today)
3. Review card via `review_card` with rating 3 (Good)
4. Check next due date (should be ~6 days later)
5. Verify FSRS state in database:
   ```bash
   npx wrangler d1 execute spaced-repetition-db-dev --local \
     --command="SELECT * FROM reviews ORDER BY card_id DESC LIMIT 1"
   ```

#### Testing User Isolation

Use two different Google accounts:

1. Connect with Account A, add cards
2. Disconnect, connect with Account B
3. Verify Account B sees no cards
4. Add cards as Account B
5. Reconnect as Account A
6. Verify Account A still sees only their cards

### Automated Testing

Currently, the project doesn't have automated tests. This is a great contribution opportunity! If you'd like to add tests:

- Unit tests: Consider Vitest or Jest
- Integration tests: Test against local D1 database
- E2E tests: Test MCP protocol interactions

## Code Style

### TypeScript

- Use TypeScript for all code (no plain JavaScript)
- Prefer `const` over `let`
- Use descriptive variable names
- Add types explicitly when inference isn't clear

**Example:**
```typescript
// ✅ Good
const cardId: number = await db.addCard(instructions, tagArray);

// ❌ Avoid (unclear type)
let result = await someFunction();
```

### Database Queries

- Always filter by `user_id` for user-specific data
- Use parameterized queries (never concatenate user input)
- Use descriptive SQL formatting

**Example:**
```typescript
// ✅ Good
const result = await this.db
  .prepare("SELECT * FROM cards WHERE id = ? AND user_id = ?")
  .bind(cardId, this.userId)
  .first();

// ❌ Wrong - no user_id filter
const result = await this.db
  .prepare("SELECT * FROM cards WHERE id = ?")
  .bind(cardId)
  .first();

// ❌ NEVER - SQL injection vulnerability
const result = await this.db
  .prepare(`SELECT * FROM cards WHERE id = ${cardId}`)
  .first();
```

### Error Handling

- Always handle errors in tool handlers
- Return user-friendly error messages
- Log errors for debugging

**Example:**
```typescript
try {
  const result = await db.submitReview(card_id, rating);
  return { content: [{ text: `Success: ${result}`, type: "text" }] };
} catch (error) {
  return {
    content: [{
      text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      type: "text"
    }]
  };
}
```

### Comments

- Add comments for non-obvious logic
- Explain "why", not "what"
- Document complex FSRS interactions

**Example:**
```typescript
// Good - explains why
// Sort by retrievability DESC to prioritize cards about to be forgotten (FSRS recommendation)
cardsWithR.sort((a, b) => b.retrievability - a.retrievability);

// Bad - explains what (obvious from code)
// Sort the cards
cardsWithR.sort((a, b) => b.retrievability - a.retrievability);
```

## Common Tasks

### Adding a New MCP Tool

1. **Define the tool in `src/index.ts`:**

```typescript
this.server.tool(
  "my_new_tool",
  "Description of what the tool does",
  {
    param1: z.string().describe("Description of param1"),
    param2: z.number().optional().describe("Optional param2"),
  },
  async ({ param1, param2 }) => {
    const db = getUserDb(); // Always use this for user isolation
    try {
      const result = await db.myNewMethod(param1, param2);
      return { content: [{ text: result, type: "text" }] };
    } catch (error) {
      return {
        content: [{
          text: `Error: ${error instanceof Error ? error.message : "Unknown"}`,
          type: "text"
        }]
      };
    }
  }
);
```

2. **Add method to `SpacedRepetition` class in `src/spaced-core.ts`:**

```typescript
async myNewMethod(param1: string, param2?: number): Promise<string> {
  // Always filter by this.userId
  const result = await this.db
    .prepare("SELECT ... WHERE user_id = ?")
    .bind(this.userId)
    .first();

  return `Result: ${result}`;
}
```

3. **Test with MCP Inspector**
4. **Update documentation in README.md** (add to MCP Tools table)

### Adding a Database Column

1. **Update `schema.sql`:**

```sql
ALTER TABLE cards ADD COLUMN new_field TEXT;
```

2. **Run migration locally:**

```bash
npx wrangler d1 execute spaced-repetition-db-dev --local --file=schema.sql
```

3. **Update TypeScript code** to use new column

4. **Regenerate types:**

```bash
npm run cf-typegen
```

5. **Test thoroughly** before deploying to production

### Modifying FTS Search

If you modify the `cards` table schema:

1. Update table in `schema.sql`
2. Check if `cards_fts` virtual table needs updates
3. Update triggers if necessary (lines 73-86 in schema.sql)

**Example:** Adding a `title` field to cards and including it in FTS:

```sql
-- Update virtual table definition
CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
    title,          -- NEW
    instructions,
    user_id UNINDEXED,
    content='cards',
    content_rowid='id'
);

-- Update triggers to sync title
CREATE TRIGGER IF NOT EXISTS cards_ai AFTER INSERT ON cards BEGIN
    INSERT INTO cards_fts(rowid, title, instructions, user_id)
    VALUES (new.id, new.title, new.instructions, new.user_id);
END;

-- ... update other triggers similarly
```

### Changing FSRS Parameters

Modify the scheduler initialization in `src/spaced-core.ts`:

```typescript
private scheduler = fsrs({
  request_retention: 0.9,    // Target 90% retention rate
  maximum_interval: 36500,   // Max interval: 100 years
  enable_fuzz: true,         // Add randomness to prevent review clustering
  // w: [...],               // Custom FSRS parameters (advanced)
});
```

See [ts-fsrs documentation](https://github.com/open-spaced-repetition/ts-fsrs#parameters) for all options.

## Debugging

### Viewing Logs

**Local development:**
Logs appear directly in the terminal running `npx wrangler dev`.

**Production:**
```bash
npx wrangler tail
# Streams real-time logs from production
```

### Inspecting Database

**Local database:**
```bash
# Run any SQL query
npx wrangler d1 execute spaced-repetition-db-dev --local \
  --command="SELECT COUNT(*) FROM cards"

# Export all data
npx wrangler d1 export spaced-repetition-db-dev --local --output=backup.sql
```

**Production database:**
```bash
# Query production (be careful!)
npx wrangler d1 execute spaced-repetition-db \
  --command="SELECT COUNT(*) FROM cards"
```

### Common Issues

**Issue: Type errors after updating schema**
```bash
# Solution: Regenerate types
npm run cf-typegen
npm run type-check
```

**Issue: OAuth not working locally**
- Check `.dev.vars` has correct credentials
- Verify Google OAuth app has `http://localhost:8788/callback` in redirect URIs
- Clear browser cookies and try again

**Issue: Changes not appearing in dev server**
- Check for TypeScript errors (they block compilation)
- Restart wrangler dev
- Check if file is actually being saved

**Issue: Database queries failing**
- Verify database exists: `npx wrangler d1 list`
- Check schema is initialized: `npx wrangler d1 execute ... --command="SELECT name FROM sqlite_master WHERE type='table'"`
- Ensure query filters by `user_id`

## Deployment

### Pre-Deployment Checklist

- [ ] Run `npm run type-check` - no errors
- [ ] Test all changed tools in MCP Inspector
- [ ] Verify database migrations (if any)
- [ ] Update documentation (README, ARCHITECTURE.md, etc.)
- [ ] Review changes for security issues (SQL injection, user isolation)

### Deploy to Production

```bash
# Deploy code
npx wrangler deploy

# If schema changed, run migration
npx wrangler d1 execute spaced-repetition-db --file=schema.sql
```

### Post-Deployment Verification

1. **Test OAuth flow:**
   - Connect from Claude web/desktop
   - Verify approval dialog appears
   - Complete sign-in

2. **Test a few tools:**
   - `add_card` - Create a card
   - `get_due_cards` - Retrieve it
   - `review_card` - Review it
   - `get_stats` - Check stats

3. **Monitor logs:**
   ```bash
   npx wrangler tail
   # Watch for errors
   ```

4. **Check database:**
   ```bash
   npx wrangler d1 execute spaced-repetition-db \
     --command="SELECT COUNT(*) FROM cards"
   ```

## Pull Request Process

### Before Submitting

1. **Ensure your branch is up to date:**
   ```bash
   git checkout main
   git pull origin main
   git checkout your-feature-branch
   git merge main
   ```

2. **Run final checks:**
   ```bash
   npm run type-check
   # Test locally with MCP Inspector
   ```

3. **Write a clear commit message:**
   ```bash
   git commit -m "feat: add undo_review tool for reverting reviews"
   ```

### Submitting the PR

1. **Push your branch:**
   ```bash
   git push origin your-feature-branch
   ```

2. **Open PR on GitHub**

3. **Fill out PR template:**
   - **Title:** Clear, concise description
   - **Description:**
     - What does this PR do?
     - Why is this change needed?
     - How did you test it?
     - Any breaking changes?
   - **Screenshots/logs:** If applicable

### PR Review Process

- Maintainers will review your code
- Address any feedback
- Once approved, maintainer will merge

### PR Examples

**Good PR title:**
```
feat: add bulk import tool for cards
fix: prevent duplicate tags when editing cards
docs: add troubleshooting guide for OAuth
```

**Bad PR title:**
```
Update stuff
Fix bug
Changes
```

## Getting Help

- **Questions about the codebase?** Check [ARCHITECTURE.md](ARCHITECTURE.md) and [GLOSSARY.md](GLOSSARY.md)
- **Questions about terminology?** See [GLOSSARY.md](GLOSSARY.md)
- **Found a bug?** [Open an issue](https://github.com/julianmoncarz/spaced-mcp-server/issues)
- **Want to discuss a feature?** [Start a discussion](https://github.com/julianmoncarz/spaced-mcp-server/discussions)

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on the code, not the person
- Assume good intentions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Spaced Repetition MCP Server! 🎉
