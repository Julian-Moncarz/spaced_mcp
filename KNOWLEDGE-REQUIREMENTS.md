# Knowledge Requirements to Build This From Scratch (No AI)

A comprehensive list of everything you'd need to know, define, understand, and do to build this spaced repetition MCP server from scratch without AI assistance.

---

## Part 1: Concepts You Must Be Able to DEFINE

### Networking & Web Protocols

1. **HTTP/HTTPS**
   - Request methods (GET, POST, PUT, DELETE)
   - Status codes (200, 302, 401, 403, 404, 500)
   - Headers (Authorization, Content-Type, Cookie, Location)
   - Request/response cycle

2. **Server-Sent Events (SSE)**
   - What SSE is vs WebSockets vs HTTP polling
   - `text/event-stream` content type
   - Event format (data:, id:, event:, retry:)
   - Keep-alive connections

3. **REST API**
   - Resource-oriented architecture
   - Stateless communication
   - Endpoint design patterns
   - JSON request/response format

4. **OAuth 2.1**
   - Authorization vs Authentication
   - OAuth roles (Resource Owner, Client, Authorization Server, Resource Server)
   - Authorization Code Flow
   - PKCE (Proof Key for Code Exchange)
   - Access tokens vs Refresh tokens
   - Scopes and permissions
   - Redirect URIs and callback URLs
   - State parameter (CSRF protection)

5. **Cookies & Sessions**
   - Cookie attributes (HttpOnly, Secure, SameSite)
   - Session management
   - Cookie encryption
   - CSRF tokens

### Programming Concepts

6. **TypeScript/JavaScript**
   - Type system vs JavaScript
   - Interfaces and types
   - Generics
   - Async/await
   - Promises
   - Arrow functions
   - Classes and inheritance
   - Modules (import/export)
   - Destructuring
   - Optional chaining (?.)
   - Nullish coalescing (??)

7. **Serverless Computing**
   - What "serverless" means
   - Cold starts vs warm instances
   - Execution time limits
   - Stateless vs stateful functions
   - Edge computing
   - Isolated execution contexts

8. **Durable Objects**
   - What makes them "durable"
   - Single-threaded consistency
   - State persistence
   - Global uniqueness
   - Migration patterns

### Database Concepts

9. **SQL & SQLite**
   - Relational database model
   - Tables, rows, columns
   - Primary keys
   - Foreign keys
   - Indexes (and when to use them)
   - Transactions (ACID properties)
   - Normalization (1NF, 2NF, 3NF)
   - JOINs (INNER, LEFT, RIGHT)
   - GROUP BY and aggregation
   - Subqueries

10. **Full-Text Search (FTS5)**
    - What FTS is vs LIKE queries
    - Tokenization
    - Inverted indexes
    - MATCH operator
    - Content vs contentless tables
    - Triggers for synchronization
    - Ranking and relevance

11. **Database Triggers**
    - BEFORE vs AFTER triggers
    - INSERT, UPDATE, DELETE triggers
    - NEW and OLD row references
    - Use cases (audit logs, derived data)

12. **Key-Value Stores**
    - What KV stores are
    - Eventual consistency
    - TTL (Time To Live)
    - Use cases vs relational databases

### Application Architecture

13. **Multi-Tenancy**
    - What multi-tenant means
    - Data isolation strategies
    - Row-level security
    - Tenant identification

14. **API Design**
    - Tool/function naming conventions
    - Parameter design
    - Error handling patterns
    - Response formatting
    - Versioning strategies

15. **Model Context Protocol (MCP)**
    - What MCP is
    - Tools vs Prompts vs Resources
    - Transport layers (SSE, Streamable HTTP, STDIO)
    - Client-server communication
    - Tool schemas and validation
    - MCP lifecycle (initialize, shutdown)

### Algorithms

16. **Spaced Repetition**
    - Forgetting curve
    - Spacing effect
    - Optimal intervals

17. **SM-2 Algorithm**
    - Easiness Factor (EF)
    - Repetition number
    - Interval calculation
    - Failure handling
    - EF adjustment formula

### Security

18. **Authentication vs Authorization**
    - What each means
    - When to use which
    - Token-based auth

19. **Secrets Management**
    - Environment variables
    - Secret rotation
    - Encryption at rest
    - Never commit secrets to git

20. **SQL Injection**
    - What it is
    - How parameterized queries prevent it
    - Why string concatenation is dangerous

21. **CSRF (Cross-Site Request Forgery)**
    - What CSRF attacks are
    - State parameter in OAuth
    - SameSite cookies

22. **XSS (Cross-Site Scripting)**
    - What XSS is
    - Input sanitization
    - Content Security Policy

### Developer Tools

23. **Git**
    - Version control concepts
    - Commits, branches, merges
    - Remote repositories
    - .gitignore

24. **Package Managers (npm)**
    - package.json
    - Dependencies vs devDependencies
    - Semantic versioning
    - Lock files

25. **Build Tools**
    - Transpilation (TypeScript → JavaScript)
    - Bundling
    - Source maps
    - Minification

26. **CLI Tools**
    - Command-line arguments
    - Flags and options
    - STDIN/STDOUT/STDERR
    - Exit codes

---

## Part 2: Things You Must Be Able to UNDERSTAND/EXPLAIN

### System Architecture

27. **End-to-End Flow**
    - Explain the complete request flow from Claude → Worker → D1 → Response
    - How OAuth token gets attached to each request
    - How user_id is extracted and used
    - How database queries filter by user

28. **OAuth Flow Sequence**
    - Step 1: User clicks "Connect" in Claude
    - Step 2: Redirect to your worker /authorize
    - Step 3: Show approval dialog
    - Step 4: Redirect to GitHub
    - Step 5: User authorizes on GitHub
    - Step 6: GitHub redirects to /callback
    - Step 7: Exchange code for access token
    - Step 8: Create MCP token with user metadata
    - Step 9: Redirect back to Claude
    - Step 10: Claude makes MCP requests with token

29. **Database Schema Relationships**
    - How cards relate to tags (many-to-many)
    - How cards relate to reviews (one-to-one)
    - How FTS table stays in sync with cards
    - Why denormalization (user_id in tags) helps performance

30. **SM-2 Algorithm Logic**
    - When interval = 1 day (first review)
    - When interval = 6 days (second review)
    - When interval = previous × EF (subsequent reviews)
    - How difficulty rating affects EF
    - Why failure resets to day 1

31. **User Isolation Mechanism**
    - Every table has user_id
    - Every query filters: WHERE user_id = ?
    - Why this prevents data leakage
    - What happens if you forget to filter

32. **Cloudflare Edge Network**
    - What "edge" means (geographically distributed)
    - How requests route to nearest datacenter
    - Why this reduces latency
    - How Durable Objects maintain consistency

33. **Wrangler Configuration**
    - What wrangler.jsonc defines
    - Bindings (KV, D1, Durable Objects, AI)
    - Migrations
    - Compatibility dates
    - Why secrets aren't in config file

34. **TypeScript Type System**
    - How interfaces enforce structure
    - Why `D1Database` type matters
    - What `Env` interface does
    - How generics work in `McpAgent<Env, Record, Props>`

35. **Async Database Operations**
    - Why D1 operations are async
    - How `.bind()` prevents SQL injection
    - What `.all()` vs `.first()` vs `.run()` return
    - How to handle errors in async code

36. **MCP Tool Registration**
    - How `server.tool()` registers a tool
    - What Zod schema does (validation)
    - How tool description helps Claude understand usage
    - What the handler function receives

37. **Environment Bindings**
    - How `this.env.DB` accesses database
    - How `this.env.OAUTH_KV` accesses key-value store
    - How `this.props!.login` gets user identity
    - Why bindings are better than environment variables

38. **Date Calculations**
    - How to add days to a date in JavaScript
    - ISO date format (YYYY-MM-DD)
    - Timezone considerations
    - SQLite DATE('now') function

39. **Error Handling Patterns**
    - Try-catch blocks
    - Throwing vs returning errors
    - User-friendly error messages
    - When to return false vs throw

40. **Full-Text Search Mechanics**
    - How FTS tokenizes "Practice Python decorators"
    - How MATCH query finds relevant cards
    - Why triggers keep FTS in sync
    - Why user_id is UNINDEXED in FTS

---

## Part 3: Things You Must Be Able to DO

### Environment Setup

41. **Install Node.js and npm**
    - Download and install from nodejs.org
    - Verify installation: `node --version`
    - Understand npm global vs local packages

42. **Create Cloudflare Account**
    - Sign up at cloudflare.com
    - Navigate dashboard
    - Understand free tier limits

43. **Install and Configure Wrangler**
    - `npm install -g wrangler`
    - `wrangler login`
    - Authenticate in browser

44. **Create GitHub Account**
    - If you don't have one
    - Navigate developer settings

### GitHub OAuth Setup

45. **Create OAuth Application**
    - Go to Settings → Developer settings → OAuth Apps
    - Fill out form correctly
    - Understand Homepage URL vs Callback URL
    - Generate client secret
    - Keep credentials secure

46. **Update OAuth App Settings**
    - Change URLs after deployment
    - Understand why callback URL must match exactly

### Cloudflare Resource Management

47. **Create D1 Database**
    - `wrangler d1 create <name>`
    - Copy database_id from output
    - Understand what you're creating

48. **Execute SQL on D1**
    - `wrangler d1 execute <db> --file=schema.sql`
    - `wrangler d1 execute <db> --command="SELECT ..."`
    - Debug SQL errors

49. **Create KV Namespace**
    - `wrangler kv namespace create <name>`
    - Copy ID from output
    - Understand KV use cases

50. **Manage Secrets**
    - `wrangler secret put <NAME>`
    - `wrangler secret list`
    - `wrangler secret delete <NAME>`
    - Never log secrets

51. **Deploy Worker**
    - `wrangler deploy`
    - Understand deployment output
    - Read error messages
    - Check worker logs

52. **Monitor Worker**
    - `wrangler tail` (live logs)
    - Check Cloudflare dashboard
    - Understand metrics (requests, errors, CPU time)

### TypeScript Development

53. **Set Up TypeScript Project**
    - Create tsconfig.json
    - Configure compiler options
    - Understand module resolution

54. **Write TypeScript Interfaces**
    - Define Card, Stats, ReviewResult types
    - Use optional properties (?)
    - Use union types (string | number)

55. **Implement Classes**
    - Constructor with parameters
    - Private vs public methods
    - Method signatures with types
    - Return type annotations

56. **Use Async/Await**
    - Mark functions as async
    - Await promises
    - Handle async errors with try-catch
    - Chain async operations

57. **Import/Export Modules**
    - Export classes and interfaces
    - Import from other files
    - Understand relative paths
    - Use named vs default exports

58. **Compile TypeScript**
    - `npx tsc --noEmit` (check without compiling)
    - Read compiler errors
    - Fix type errors

### SQL Development

59. **Write CREATE TABLE Statements**
    - Define columns with types
    - Add PRIMARY KEY
    - Add FOREIGN KEY with ON DELETE CASCADE
    - Set DEFAULT values

60. **Create Indexes**
    - `CREATE INDEX idx_name ON table(column)`
    - Understand when indexes help
    - Multi-column indexes

61. **Write FTS5 Tables**
    - `CREATE VIRTUAL TABLE ... USING fts5()`
    - content= and content_rowid= options
    - UNINDEXED columns

62. **Create Triggers**
    - AFTER INSERT/UPDATE/DELETE
    - NEW and OLD references
    - Multiple statements in trigger body

63. **Write SELECT Queries**
    - Basic: `SELECT * FROM table`
    - Filtering: `WHERE column = ?`
    - Joins: `JOIN table ON condition`
    - Aggregation: `GROUP_CONCAT()`, `COUNT()`
    - Ordering: `ORDER BY column`
    - Limiting: `LIMIT n`

64. **Write INSERT Queries**
    - `INSERT INTO table (col1, col2) VALUES (?, ?)`
    - Get last insert ID
    - Handle failures

65. **Write UPDATE Queries**
    - `UPDATE table SET col = ? WHERE id = ?`
    - Update multiple columns
    - Check rows affected

66. **Write DELETE Queries**
    - `DELETE FROM table WHERE id = ?`
    - Understand CASCADE deletes
    - Check rows affected

67. **Use FTS MATCH Queries**
    - `WHERE cards_fts MATCH ?`
    - Combine with regular WHERE clauses
    - Handle special characters in search

68. **Use Parameterized Queries**
    - `.bind(param1, param2, ...)`
    - Never concatenate user input into SQL
    - Understand why this prevents SQL injection

### MCP Server Development

69. **Initialize MCP Server**
    - Create McpServer instance
    - Set name and version
    - Understand server lifecycle

70. **Define MCP Tools**
    - Use `server.tool(name, description, schema, handler)`
    - Write Zod schemas for parameters
    - Implement async handler functions

71. **Write Zod Schemas**
    - `z.string()`, `z.number()`, `z.boolean()`
    - `.optional()`, `.describe()`
    - `.min()`, `.max()` for validation

72. **Format Tool Responses**
    - Return `{ content: [{ type: "text", text: "..." }] }`
    - Handle errors gracefully
    - Format output for readability

73. **Access OAuth Context**
    - Use `this.props!.login` for user_id
    - Understand why `!` is needed (non-null assertion)
    - Pass context to other functions

74. **Extend McpAgent Class**
    - Understand class inheritance
    - Implement `init()` method
    - Use class properties (server, env, props)

75. **Configure OAuth Provider**
    - Set apiHandlers (/sse, /mcp)
    - Set authorizeEndpoint
    - Set tokenEndpoint
    - Set clientRegistrationEndpoint

### Algorithm Implementation

76. **Implement SM-2 Algorithm**
    - Calculate new EF from difficulty
    - Determine interval based on repetition count
    - Handle failure case (difficulty < 3)
    - Enforce minimum EF of 1.3
    - Round interval to integer days

77. **Calculate Date Math**
    - Parse ISO date strings
    - Add days to a date
    - Format date back to ISO
    - Compare dates

78. **Implement Card Formatting**
    - Check if due today/tomorrow
    - Format tags as comma-separated string
    - Split comma-separated strings
    - Trim whitespace

### Error Handling

79. **Handle Missing Resources**
    - Check if card exists before operating
    - Return descriptive errors
    - Use appropriate HTTP status codes

80. **Validate User Input**
    - Check required parameters
    - Validate ranges (difficulty 1-5)
    - Sanitize search queries
    - Handle empty strings

81. **Debug OAuth Issues**
    - Check callback URL matches exactly
    - Verify secrets are set
    - Test in incognito mode
    - Read OAuth error messages

82. **Debug Database Issues**
    - Check database exists
    - Verify schema is loaded
    - Test queries in isolation
    - Check user_id filtering

### Testing

83. **Use MCP Inspector**
    - Install: `npx @modelcontextprotocol/inspector`
    - Enter server URL
    - Navigate OAuth flow
    - Test individual tools
    - Read error messages

84. **Test Locally**
    - `wrangler dev`
    - Use localhost URLs
    - Create .dev.vars file
    - Test without deploying

85. **Test OAuth Flow**
    - Complete authorization
    - Verify token storage
    - Test expired tokens
    - Test unauthorized access

86. **Test Database Operations**
    - Create test cards
    - Search for cards
    - Update and delete
    - Verify isolation between users

87. **Test Edge Cases**
    - Empty results
    - Invalid IDs
    - Missing parameters
    - Concurrent operations

### Documentation

88. **Write Clear README**
    - Explain what project does
    - Quick start instructions
    - Link to detailed setup
    - Include examples

89. **Create Setup Guide**
    - Step-by-step instructions
    - For all platforms/clients
    - Troubleshooting section
    - Screenshots if helpful

90. **Document API/Tools**
    - List all tools
    - Document parameters
    - Show example usage
    - Explain response format

91. **Write Code Comments**
    - Explain non-obvious logic
    - Document complex algorithms
    - Add TODO comments
    - Avoid obvious comments

### Git & Version Control

92. **Initialize Git Repository**
    - `git init`
    - Create .gitignore
    - Make initial commit

93. **Create .gitignore**
    - Ignore node_modules/
    - Ignore .env and .dev.vars
    - Ignore build artifacts
    - Never commit secrets

94. **Make Commits**
    - `git add <files>`
    - `git commit -m "message"`
    - Write descriptive commit messages
    - Commit related changes together

95. **Push to GitHub**
    - Create GitHub repository
    - `git remote add origin <url>`
    - `git push -u origin main`

### Debugging

96. **Read Error Messages**
    - Identify error type
    - Find line number
    - Understand stack traces
    - Search error messages online

97. **Use Console Logging**
    - `console.log()` for debugging
    - Log variable values
    - Remove before production
    - Use structured logging

98. **Check Browser Network Tab**
    - Inspect requests
    - Check response bodies
    - Verify headers
    - Check timing

99. **Use Cloudflare Logs**
    - `wrangler tail` for real-time
    - Dashboard for historical
    - Filter by status code
    - Check for exceptions

### Configuration Management

100. **Edit JSON Configuration**
     - Understand JSON syntax
     - Edit wrangler.jsonc
     - Add bindings correctly
     - Avoid trailing commas

101. **Manage Environment Variables**
     - Create .dev.vars for local
     - Use secrets for production
     - Never commit .env files
     - Understand variable precedence

102. **Update Package Dependencies**
     - `npm install <package>`
     - `npm update`
     - Check for vulnerabilities
     - Read package documentation

### Deployment

103. **Prepare for Deployment**
     - Test locally first
     - Check all secrets are set
     - Verify database schema
     - Update OAuth callback URLs

104. **Deploy and Verify**
     - Run `wrangler deploy`
     - Check deployment URL
     - Test all endpoints
     - Monitor for errors

105. **Rollback if Needed**
     - `wrangler rollback`
     - Understand versioning
     - Keep previous version ready

---

## Part 4: Conceptual Understanding

### High-Level System Design

106. **Understand the Full Stack**
     - Frontend: Claude/Cursor/MCP clients
     - Protocol: MCP over SSE/HTTP
     - Backend: Cloudflare Worker
     - Auth: GitHub OAuth
     - Database: D1 SQLite
     - Storage: KV for tokens
     - State: Durable Objects

107. **Understand Request Flow**
     - User action in Claude
     - Claude sends MCP request with OAuth token
     - Worker validates token
     - Worker extracts user_id
     - Worker queries database (filtered by user_id)
     - Worker returns formatted response
     - Claude displays to user

108. **Understand Data Flow**
     - User authorizes → GitHub provides access token
     - Worker stores token in KV
     - Worker creates MCP token with user metadata
     - MCP token includes user_id (GitHub login)
     - Every request includes MCP token
     - Every database query filters by user_id

109. **Understand Security Model**
     - OAuth prevents unauthorized access
     - Token encryption protects sensitive data
     - Parameterized queries prevent SQL injection
     - user_id filtering prevents data leakage
     - HTTPS encrypts all communication

110. **Understand Scaling Characteristics**
     - Serverless = auto-scaling
     - Edge = low latency globally
     - Durable Objects = consistent state
     - D1 = single-region writes, replicated reads
     - Free tier limits = 8k daily active users

### Problem-Solving Skills

111. **Debug from First Principles**
     - What should happen?
     - What is happening?
     - Where do they diverge?
     - What changed recently?
     - Can you reproduce it?

112. **Read Documentation**
     - Official docs are authoritative
     - Read error messages carefully
     - Search for specific error codes
     - Check GitHub issues
     - Read changelog for breaking changes

113. **Break Down Complex Problems**
     - Identify discrete steps
     - Test each step individually
     - Isolate the failure point
     - Fix one thing at a time
     - Verify fix before moving on

114. **Make Incremental Changes**
     - Don't change 10 things at once
     - Test after each change
     - Commit working code
     - Easier to debug small changes

115. **Use Scientific Method**
     - Form hypothesis
     - Design test
     - Run test
     - Analyze results
     - Refine hypothesis
     - Repeat

---

## Part 5: Soft Skills & Practices

### Development Process

116. **Read and Understand Existing Code**
     - Start with entry point (index.ts)
     - Follow function calls
     - Understand data structures
     - Trace execution flow

117. **Refactor for Clarity**
     - Extract repeated code into functions
     - Use descriptive variable names
     - Keep functions short and focused
     - Add comments for complex logic

118. **Test as You Build**
     - Don't write everything then test
     - Test each function as you write it
     - Use console.log liberally
     - Fix bugs immediately

119. **Handle Edge Cases**
     - What if input is empty?
     - What if database is empty?
     - What if user is not found?
     - What if network fails?

120. **Write User-Friendly Errors**
     - "Card 123 not found"
     - Not: "undefined is not a function"
     - Include actionable information
     - Log technical details separately

### Learning & Research

121. **Search Effectively**
     - Use specific terms
     - Include technology names
     - Search error messages verbatim
     - Use site:stackoverflow.com

122. **Read Stack Overflow Carefully**
     - Check accepted answer date
     - Check if relevant to your version
     - Understand why it works
     - Don't just copy-paste

123. **Follow Official Examples**
     - Cloudflare examples
     - MCP SDK examples
     - Start with working code
     - Modify incrementally

124. **Keep Learning Resources**
     - Bookmark useful docs
     - Save working examples
     - Document solutions to problems
     - Build personal knowledge base

### Project Management

125. **Plan Before Coding**
     - What features do you need?
     - What's the data model?
     - What's the API surface?
     - Draw diagrams

126. **Build MVP First**
     - Get basic version working
     - Add features incrementally
     - Don't over-engineer early
     - Iterate based on feedback

127. **Document as You Go**
     - Write README early
     - Update docs when changing features
     - Document deployment steps
     - Future you will thank you

128. **Manage Scope Creep**
     - Finish core features first
     - Keep "nice to have" list
     - Don't get distracted by polish
     - Ship working product

---

## Difficulty Assessment

### Easy (1-2 weeks to learn)
- Basic TypeScript syntax
- Git basics
- npm commands
- Simple SQL queries
- HTTP basics

### Medium (1-2 months to learn)
- OAuth flow
- Async programming
- Database design
- API design
- Cloudflare platform

### Hard (3-6 months to learn)
- Serverless architecture
- Durable Objects
- MCP protocol deep dive
- Security best practices
- Performance optimization

### Expert (6-12 months to master)
- System design at scale
- Debugging distributed systems
- Advanced TypeScript patterns
- Database performance tuning
- Production operations

---

## Estimated Time to Build from Scratch (No AI)

### If You're a Beginner
- **Learning time**: 6-12 months
- **Building time**: 2-3 weeks
- **Total**: ~8-14 months

### If You're Intermediate
- **Learning time**: 2-3 months
- **Building time**: 1-2 weeks
- **Total**: ~3-4 months

### If You're Advanced
- **Learning time**: 2-4 weeks (specific technologies)
- **Building time**: 3-5 days
- **Total**: ~1-2 months

### If You're an Expert
- **Learning time**: 1-2 days (read docs)
- **Building time**: 1-2 days
- **Total**: ~1 week

---

## What Makes This Hard?

### Biggest Challenges

1. **OAuth is Complex**
   - Many moving parts
   - Hard to debug
   - Security implications
   - State management

2. **Async Everything**
   - Database calls are async
   - OAuth redirects are async
   - Easy to make mistakes
   - Hard to debug

3. **Type System**
   - TypeScript can be finicky
   - Need to understand generics
   - Environment types confusing
   - Compiler errors cryptic

4. **Platform-Specific Knowledge**
   - Cloudflare Workers aren't Node.js
   - D1 isn't regular SQLite
   - Durable Objects are unique
   - Different debugging tools

5. **Integration Points**
   - MCP protocol
   - GitHub OAuth
   - Cloudflare APIs
   - Multiple clients (Claude, Cursor)

6. **Testing is Hard**
   - Can't easily test OAuth locally
   - Need to deploy to test properly
   - Debugging production is hard
   - Error messages not always clear

---

## What Makes This Easier?

### Things That Help

1. **Good Documentation**
   - Cloudflare docs are excellent
   - MCP docs are clear
   - TypeScript docs comprehensive
   - SQLite docs detailed

2. **Working Examples**
   - Cloudflare provides templates
   - MCP SDK has examples
   - Can learn from existing code

3. **Fast Feedback Loop**
   - `wrangler dev` for local testing
   - Fast deployments (14 seconds)
   - MCP Inspector for testing
   - Console logs visible immediately

4. **Generous Free Tier**
   - Can experiment freely
   - No cost pressure
   - Test in production safely

5. **Familiar Technologies**
   - SQL is standard
   - TypeScript is popular
   - Git is universal
   - HTTP is fundamental

---

## Resources to Learn Each Topic

### Online Courses
- TypeScript: Official TypeScript Handbook
- OAuth: oauth.com and oauth.net
- SQL: SQLite Tutorial, Mode Analytics SQL Tutorial
- Cloudflare: Cloudflare Workers documentation
- MCP: modelcontextprotocol.io

### Books
- "Learning TypeScript" by Josh Goldberg
- "OAuth 2 in Action" by Justin Richer
- "SQL Antipatterns" by Bill Karwin
- "Designing Data-Intensive Applications" by Martin Kleppmann

### Practice Projects
- Build a simple REST API
- Implement OAuth login for a website
- Create a todo app with database
- Deploy something to Cloudflare Workers

---

## Final Thoughts

**This is a complex project.** It requires knowledge from:
- Web development (HTTP, APIs, async)
- Databases (SQL, transactions, FTS)
- Security (OAuth, secrets, injection)
- DevOps (deployment, monitoring, debugging)
- Distributed systems (serverless, edge, consistency)

**But it's learnable.** Each piece individually is well-documented. The challenge is putting them all together.

**AI helps by:**
- Connecting the dots between technologies
- Suggesting appropriate patterns
- Catching mistakes early
- Explaining complex concepts
- Writing boilerplate code
- Debugging issues

**Without AI, you'd need to:**
- Read all the documentation yourself
- Try many approaches to find what works
- Debug every issue from scratch
- Write all code yourself
- Learn from your mistakes

**Both paths work.** AI is faster, but learning from scratch builds deeper understanding.

**Recommendation**: Learn the fundamentals first (TypeScript, SQL, HTTP, OAuth), then use AI to accelerate building on that foundation.
