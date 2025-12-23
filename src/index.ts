import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { GoogleHandler } from "./google-handler";
import { SpacedRepetition } from "./spaced-core";
import { FLASHCARD_ICON } from "./icon";

// Context from the auth process, encrypted & stored in the auth token
// and provided to the Durable MCP as this.props
// Populated by GoogleHandler (src/google-handler.ts) after successful OAuth
type Props = {
	login: string; // User's Google email - used as user_id for database isolation
	name: string; // User's display name from Google
	email: string; // User's email (same as login)
	accessToken: string; // Google OAuth access token
};

// MyMCP is a Durable Object that maintains stateful MCP sessions
// After OAuth, this.props contains user context (login, name, email, accessToken)
// We use this.props.login (Google email) as the user_id for all database queries
// This ensures complete user isolation - users can ONLY access their own data
export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Spaced Repetition MCP Server",
		version: "1.0.0",
		icons: [
			{
				src: FLASHCARD_ICON,
				mimeType: "image/png",
			},
		],
	});

	async init() {
		const initStart = Date.now();
		console.log('[PERF] init() started');
		
		// Helper to create SpacedRepetition instance scoped to the authenticated user
		// this.props!.login = Google email from OAuth (e.g., "user@gmail.com")
		// All database queries in SpacedRepetition will filter by this user_id
		const getUserDb = () => new SpacedRepetition(this.env.DB, this.props!.login);

		// Tool 1: Add a new card (supports single or batch mode)
		this.server.tool(
			"add_card",
			"Add spaced repetition card(s) with instructions and optional tags. Supports single or batch mode. Examples: Single - {instructions: 'Practice Python decorators', tags: 'python,advanced'}. Batch - {cards: [{instructions: 'Practice decorators', tags: 'python'}, {instructions: 'Practice async/await', tags: 'javascript'}]}",
			{
				instructions: z
					.string()
					.optional()
					.describe(
						"(Single mode) Detailed instructions for generating practice problems or questions. " +
						"Example: 'Generate problems about implementing binary search trees. Focus on insertion, deletion, and balancing. User struggles with edge cases.'"
					),
				tags: z
					.string()
					.optional()
					.describe(
						"(Single mode) Comma-separated tags for organizing cards by topic. " +
						"Example: 'python,algorithms' or 'javascript,async,advanced'"
					),
				cards: z
					.array(
						z.object({
							instructions: z.string().describe("Card instructions"),
							tags: z.string().optional().describe("Comma-separated tags"),
						})
					)
					.optional()
					.describe("(Batch mode) Array of cards to create at once"),
			},
			async ({ instructions, tags, cards }) => {
				const toolStart = Date.now();
				console.log('[PERF] add_card tool called');
				const db = getUserDb();

				// Batch mode
				if (cards && cards.length > 0) {
					const createdIds: number[] = [];
					const failed: Array<{ index: number; error: string }> = [];

					for (let i = 0; i < cards.length; i++) {
						try {
							const card = cards[i];
							const tagArray = card.tags ? card.tags.split(",").map((t) => t.trim()) : [];
							const cardId = await db.addCard(card.instructions, tagArray);
							createdIds.push(cardId);
						} catch (error) {
							failed.push({
								index: i,
								error: error instanceof Error ? error.message : "Unknown error",
							});
						}
					}

					let text = "";
					if (createdIds.length > 0) {
						text += `Successfully created ${createdIds.length} card(s): ${createdIds.join(", ")}`;
					}
					if (failed.length > 0) {
						if (text) text += "\n";
						text += `Failed to create ${failed.length} card(s):\n`;
						for (const { index, error } of failed) {
							text += `  - Card ${index + 1}: ${error}\n`;
						}
					}

					return {
						content: [{ text: text.trim(), type: "text" }],
					};
				}

				// Single mode (backward compatible)
				if (instructions !== undefined) {
					const tagArray = tags ? tags.split(",").map((t) => t.trim()) : [];
					const cardId = await db.addCard(instructions, tagArray);
					return {
						content: [{ text: `Created card ${cardId}`, type: "text" }],
					};
				}

				// Invalid input
				return {
					content: [
						{
							text: "Error: Must provide either (instructions) for single card or (cards array) for batch creation",
							type: "text",
						},
					],
				};
			},
		);

		// Tool 2: Get due cards
		this.server.tool(
			"get_due_cards",
			"Get cards that are due for review today, sorted by FSRS retrievability (cards you're about to forget appear first). Example: Get 5 due cards tagged 'algorithms'",
			{
				limit: z
					.number()
					.optional()
					.describe(
						"Maximum number of cards to return. " +
						"Example: limit=5 returns only the 5 most urgent cards"
					),
				tags: z
					.string()
					.optional()
					.describe(
						"Filter by comma-separated tags. " +
						"Example: 'python,algorithms' returns only cards with those tags"
					),
			},
			async ({ limit, tags }) => {
				const db = getUserDb();
				const tagArray = tags ? tags.split(",").map((t) => t.trim()) : [];
				const cards = await db.getDueCards(limit, tagArray);

				if (cards.length === 0) {
					return {
						content: [{ text: "No cards due for review", type: "text" }],
					};
				}

				const formatted = cards
					.map(
						(c) =>
							`Card ${c.id}: ${c.instructions}\nTags: ${c.tags.join(", ") || "none"}\nDue: ${c.due}`,
					)
					.join("\n\n");

				return {
					content: [{ text: formatted, type: "text" }],
				};
			},
		);

		// Tool 3: Search cards (supports single or batch mode)
		this.server.tool(
			"search_cards",
			"Search cards using full-text search (FTS5) with optional tag filtering. Supports single or batch mode. Examples: Single - {query: 'binary tree', tags: 'algorithms'}. Batch - {searches: [{query: 'recursion', tags: 'python'}, {query: 'async', tags: 'javascript'}]}",
			{
				query: z
					.string()
					.optional()
					.describe(
						"(Single mode) Search query text to match against card instructions. " +
						"Example: 'recursion' or 'async await' or 'sorting algorithms'"
					),
				tags: z
					.string()
					.optional()
					.describe(
						"(Single mode) Filter results by comma-separated tags. " +
						"Example: 'python,algorithms' returns only matching cards with those tags"
					),
				searches: z
					.array(
						z.object({
							query: z.string().describe("Search query text"),
							tags: z.string().optional().describe("Comma-separated tags"),
						})
					)
					.optional()
					.describe("(Batch mode) Array of searches to perform at once"),
			},
			async ({ query, tags, searches }) => {
				const db = getUserDb();

				// Batch mode
				if (searches && searches.length > 0) {
					const batchInput = searches.map(s => ({
						query: s.query,
						tags: s.tags ? s.tags.split(",").map((t) => t.trim()) : undefined,
					}));

					const result = await db.searchCardsInBatch(batchInput);

					let text = "";

					if (result.successful.length > 0) {
						text += `Successfully searched ${result.successful.length} quer${result.successful.length === 1 ? 'y' : 'ies'}:\n\n`;
						for (const { query, cards } of result.successful) {
							text += `Query: "${query}"\n`;
							if (cards.length === 0) {
								text += "  No cards found\n\n";
							} else {
								for (const c of cards) {
									text += `  - Card ${c.id}: ${c.instructions}\n`;
									text += `    Tags: ${c.tags.join(", ") || "none"} | Due: ${c.due}\n`;
								}
								text += "\n";
							}
						}
					}

					if (result.failed.length > 0) {
						if (text) text += "\n";
						text += `Failed to search ${result.failed.length} quer${result.failed.length === 1 ? 'y' : 'ies'}:\n`;
						for (const { query, error } of result.failed) {
							text += `  - Query "${query}": ${error}\n`;
						}
					}

					return {
						content: [{ text: text.trim(), type: "text" }],
					};
				}

				// Single mode (backward compatible)
				if (query !== undefined) {
					const tagArray = tags ? tags.split(",").map((t) => t.trim()) : [];
					const cards = await db.searchCards(query, tagArray);

					if (cards.length === 0) {
						return {
							content: [{ text: "No cards found", type: "text" }],
						};
					}

					const formatted = cards
						.map(
							(c) =>
								`Card ${c.id}: ${c.instructions}\nTags: ${c.tags.join(", ") || "none"}\nDue: ${c.due}`,
						)
						.join("\n\n");

					return {
						content: [{ text: formatted, type: "text" }],
					};
				}

				// Invalid input
				return {
					content: [
						{
							text: "Error: Must provide either (query) for single search or (searches array) for batch search",
							type: "text",
						},
					],
				};
			},
		);

		// Tool 4: Get all cards
		this.server.tool(
			"get_all_cards",
			"Get all cards with optional tag filtering",
			{
				tags: z
					.string()
					.optional()
					.describe("Filter by comma-separated tags (e.g., 'python,algorithms')"),
			},
			async ({ tags }) => {
				const db = getUserDb();
				const tagArray = tags ? tags.split(",").map((t) => t.trim()) : [];
				const cards = await db.getAllCards(tagArray);

				if (cards.length === 0) {
					return {
						content: [{ text: "No cards found", type: "text" }],
					};
				}

				const formatted = cards
					.map(
						(c) =>
							`Card ${c.id}: ${c.instructions}\nTags: ${c.tags.join(", ") || "none"}\nDue: ${c.due}`,
					)
					.join("\n\n");

				return {
					content: [{ text: formatted, type: "text" }],
				};
			},
		);

		// Tool 5: Review a card (supports both single and batch review)
		this.server.tool(
			"review_card",
			"Submit review(s) for card(s) with FSRS rating. Supports single or batch mode. FSRS ratings: 1=Again (forgot), 2=Hard (difficult), 3=Good (correct), 4=Easy (effortless). Examples: Single - {card_id: 5, rating: 3}. Batch - {reviews: [{card_id: 5, rating: 3}, {card_id: 8, rating: 4}]}",
			{
				card_id: z.number().optional().describe("(Single mode) The ID of the card to review"),
				rating: z
					.number()
					.min(1)
					.max(4)
					.optional()
					.describe("(Single mode) FSRS rating (1-4)"),
				reviews: z
					.array(
						z.object({
							card_id: z.number().describe("The ID of the card to review"),
							rating: z.number().min(1).max(4).describe("FSRS rating (1-4)"),
						})
					)
					.optional()
					.describe("(Batch mode) Array of card reviews to submit together"),
			},
			async ({ card_id, rating, reviews }) => {
				const db = getUserDb();

				// Helper to format date string
				const formatDateStr = (nextReview: string): string => {
					const today = new Date().toISOString().split("T")[0];
					const nextDate = new Date(nextReview);
					const daysDiff = Math.round(
						(nextDate.getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24),
					);

					if (daysDiff === 0) return "today";
					if (daysDiff === 1) return "tomorrow";
					return `${nextReview} (in ${daysDiff} days)`;
				};

				// Batch mode
				if (reviews && reviews.length > 0) {
					try {
						const result = await db.submitBatchReviews(reviews as any);
						
						let text = "";
						
						if (result.successful.length > 0) {
							text += `Successfully reviewed ${result.successful.length} card(s):\n`;
							for (const { card_id, next_review } of result.successful) {
								text += `  - Card ${card_id}: Next review ${formatDateStr(next_review)}\n`;
							}
						}
						
						if (result.failed.length > 0) {
							if (text) text += "\n";
							text += `Failed to review ${result.failed.length} card(s):\n`;
							for (const { card_id, error } of result.failed) {
								text += `  - Card ${card_id}: ${error}\n`;
							}
						}

						return {
							content: [{ text: text.trim(), type: "text" }],
						};
					} catch (error) {
						return {
							content: [
								{
									text: `Batch review error: ${error instanceof Error ? error.message : "Unknown error"}`,
									type: "text",
								},
							],
						};
					}
				}

				// Single mode (backward compatible)
				if (card_id !== undefined && rating !== undefined) {
					try {
						const result = await db.submitReview(card_id, rating);
						const dateStr = formatDateStr(result.next_review);

						return {
							content: [
								{
									text: `Card ${card_id} reviewed. Next review: ${dateStr}`,
									type: "text",
								},
							],
						};
					} catch (error) {
						return {
							content: [
								{
									text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
									type: "text",
								},
							],
						};
					}
				}

				// Invalid input
				return {
					content: [
						{
							text: "Error: Must provide either (card_id + rating) for single review or (reviews array) for batch review",
							type: "text",
						},
					],
				};
			},
		);

		// Tool 6: Edit a card (supports single or batch mode)
		this.server.tool(
			"edit_card",
			"Edit card(s) instructions and/or tags. Supports single or batch mode. Examples: Single - {card_id: 5, instructions: 'new text', tags: 'python'}. Batch - {edits: [{card_id: 5, instructions: 'new text'}, {card_id: 8, tags: 'javascript'}]}",
			{
				card_id: z.number().optional().describe("(Single mode) The ID of the card to edit. Example: card_id=5"),
				instructions: z
					.string()
					.optional()
					.describe(
						"(Single mode) New instructions text (replaces existing). " +
						"Example: 'Generate problems about recursion with memoization'"
					),
				tags: z
					.string()
					.optional()
					.describe(
						"(Single mode) New comma-separated tags (replaces existing). " +
						"Example: 'python,intermediate,recursion'"
					),
				edits: z
					.array(
						z.object({
							card_id: z.number().describe("Card ID to edit"),
							instructions: z.string().optional().describe("New instructions"),
							tags: z.string().optional().describe("New comma-separated tags"),
						})
					)
					.optional()
					.describe("(Batch mode) Array of card edits to apply at once"),
			},
			async ({ card_id, instructions, tags, edits }) => {
				const db = getUserDb();

				// Batch mode
				if (edits && edits.length > 0) {
					const batchInput = edits.map(e => ({
						card_id: e.card_id,
						instructions: e.instructions,
						tags: e.tags ? e.tags.split(",").map((t) => t.trim()) : undefined,
					}));

					const result = await db.editCardsInBatch(batchInput);

					let text = "";

					if (result.successful.length > 0) {
						const ids = result.successful.map(s => s.card_id).join(", ");
						text += `Successfully edited ${result.successful.length} card(s): ${ids}`;
					}

					if (result.failed.length > 0) {
						if (text) text += "\n";
						text += `Failed to edit ${result.failed.length} card(s):\n`;
						for (const { card_id, error } of result.failed) {
							text += `  - Card ${card_id}: ${error}\n`;
						}
					}

					return {
						content: [{ text: text.trim(), type: "text" }],
					};
				}

				// Single mode (backward compatible)
				if (card_id !== undefined) {
					if (!instructions && !tags) {
						return {
							content: [
								{
									text: "Error: Must provide either instructions or tags",
									type: "text",
								},
							],
						};
					}

					const tagArray = tags ? tags.split(",").map((t) => t.trim()) : undefined;
					const success = await db.editCard(card_id, instructions, tagArray);

					if (success) {
						return {
							content: [{ text: `Updated card ${card_id}`, type: "text" }],
						};
					} else {
						return {
							content: [{ text: `Card ${card_id} not found`, type: "text" }],
						};
					}
				}

				// Invalid input
				return {
					content: [
						{
							text: "Error: Must provide either (card_id + instructions/tags) for single edit or (edits array) for batch edit",
							type: "text",
						},
					],
				};
			},
		);

		// Tool 7: Delete a card (supports single or batch mode)
		this.server.tool(
			"delete_card",
			"Delete card(s) permanently. Supports single or batch mode. Examples: Single - {card_id: 5}. Batch - {card_ids: [5, 8, 12]}",
			{
				card_id: z.number().optional().describe("(Single mode) The ID of the card to delete"),
				card_ids: z
					.array(z.number())
					.optional()
					.describe("(Batch mode) Array of card IDs to delete at once"),
			},
			async ({ card_id, card_ids }) => {
				const db = getUserDb();

				// Batch mode
				if (card_ids && card_ids.length > 0) {
					const result = await db.deleteCardsInBatch(card_ids);

					let text = "";

					if (result.successful.length > 0) {
						const ids = result.successful.map(s => s.card_id).join(", ");
						text += `Successfully deleted ${result.successful.length} card(s): ${ids}`;
					}

					if (result.failed.length > 0) {
						if (text) text += "\n";
						text += `Failed to delete ${result.failed.length} card(s):\n`;
						for (const { card_id, error } of result.failed) {
							text += `  - Card ${card_id}: ${error}\n`;
						}
					}

					return {
						content: [{ text: text.trim(), type: "text" }],
					};
				}

				// Single mode (backward compatible)
				if (card_id !== undefined) {
					const success = await db.deleteCard(card_id);

					if (success) {
						return {
							content: [{ text: `Deleted card ${card_id}`, type: "text" }],
						};
					} else {
						return {
							content: [{ text: `Card ${card_id} not found`, type: "text" }],
						};
					}
				}

				// Invalid input
				return {
					content: [
						{
							text: "Error: Must provide either (card_id) for single delete or (card_ids array) for batch delete",
							type: "text",
						},
					],
				};
			},
		);

		// Tool 8: Get statistics
		this.server.tool(
			"get_stats",
			"Get statistics about your spaced repetition cards including current streak, cards due today, total reviews, and breakdown by tag. Example: Get stats for all cards, or filter by tags 'python,algorithms'",
			{
				tags: z
					.string()
					.optional()
					.describe(
						"Filter stats by comma-separated tags. " +
						"Example: 'python,algorithms' shows stats only for cards with those tags. " +
						"Omit to see all cards and breakdown by tag."
					),
			},
			async ({ tags }) => {
				const db = getUserDb();
				const tagArray = tags ? tags.split(",").map((t) => t.trim()) : [];
				const stats = await db.getStats(tagArray);

				let text = "=== Your Learning Stats ===\n\n";

				// Streak section with motivational messaging
				text += "STREAK:\n";
				if (stats.current_streak === 0) {
					text += "  Current streak: 0 days - Start your streak today!\n";
				} else if (stats.current_streak === 1) {
					text += "  Current streak: 1 day - Great start! Keep it going!\n";
				} else if (stats.current_streak < 7) {
					text += `  Current streak: ${stats.current_streak} days - You're building momentum!\n`;
				} else if (stats.current_streak < 30) {
					text += `  Current streak: ${stats.current_streak} days - Amazing consistency!\n`;
				} else {
					text += `  Current streak: ${stats.current_streak} days - Incredible dedication!\n`;
				}

				if (stats.longest_streak > stats.current_streak) {
					text += `  Longest streak: ${stats.longest_streak} days\n`;
				} else if (stats.longest_streak > 0) {
					text += `  Longest streak: ${stats.longest_streak} days - This is your best!\n`;
				}

				// Recent activity
				text += `\nRECENT ACTIVITY:\n`;
				text += `  Cards reviewed (last 24h): ${stats.cards_reviewed_last_24h}\n`;
				text += `  Cards due now: ${stats.due_today}\n`;

				// Overall stats
				text += `\nOVERALL:\n`;
				text += `  Total cards: ${stats.total}\n`;
				text += `  Total reviews: ${stats.total_reviews}\n`;

				// Tag breakdown
				if (stats.by_tag && Object.keys(stats.by_tag).length > 0) {
					text += "\nBY TAG:";
					for (const [tag, tagStats] of Object.entries(stats.by_tag)) {
						text += `\n  ${tag}: ${tagStats.total} cards (${tagStats.due} due)`;
					}
				}

				return {
					content: [{ text, type: "text" }],
				};
			},
		);

		// Tool 9: Undo last review (supports single or batch mode)
		this.server.tool(
			"undo_review",
			"Undo the last review rating for card(s), restoring previous state and review schedule. Supports single or batch mode. Examples: Single - {card_id: 5}. Batch - {card_ids: [5, 8, 12]}",
			{
				card_id: z
					.number()
					.optional()
					.describe(
						"(Single mode) The ID of the card to undo the review for. " +
						"Example: card_id=5 undoes the most recent review of card 5"
					),
				card_ids: z
					.array(z.number())
					.optional()
					.describe("(Batch mode) Array of card IDs to undo reviews for at once"),
			},
			async ({ card_id, card_ids }) => {
				const db = getUserDb();

				// Batch mode
				if (card_ids && card_ids.length > 0) {
					const result = await db.undoReviewsInBatch(card_ids);

					let text = "";

					if (result.successful.length > 0) {
						const ids = result.successful.map(s => s.card_id).join(", ");
						text += `Successfully undid reviews for ${result.successful.length} card(s): ${ids}`;
					}

					if (result.failed.length > 0) {
						if (text) text += "\n";
						text += `Failed to undo reviews for ${result.failed.length} card(s):\n`;
						for (const { card_id, error } of result.failed) {
							text += `  - Card ${card_id}: ${error}\n`;
						}
					}

					return {
						content: [{ text: text.trim(), type: "text" }],
					};
				}

				// Single mode (backward compatible)
				if (card_id !== undefined) {
					const success = await db.undoReview(card_id);

					if (success) {
						return {
							content: [
								{
									text: `Undid last review for card ${card_id}. Card restored to previous state.`,
									type: "text",
								},
							],
						};
					} else {
						return {
							content: [
								{
									text: `No review history found for card ${card_id}. Nothing to undo.`,
									type: "text",
								},
							],
						};
					}
				}

				// Invalid input
				return {
					content: [
						{
							text: "Error: Must provide either (card_id) for single undo or (card_ids array) for batch undo",
							type: "text",
						},
					],
				};
			},
		);
		
		const initEnd = Date.now();
		console.log(`[PERF] init() completed in ${initEnd - initStart}ms`);
	}
}

import { ApiRoutes } from "./api-routes";

// Wrapper handler that serves favicon, API routes, and MCP server card publicly
const DefaultHandler = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		console.log('[DefaultHandler] Path:', url.pathname);

		// Handle REST API routes for iOS app
		if (url.pathname.startsWith('/api/')) {
			console.log('[DefaultHandler] Routing to ApiRoutes');
			// Hono app expects routes without /api prefix, so we need to rewrite the URL
			const apiUrl = new URL(request.url);
			apiUrl.pathname = url.pathname.replace('/api', '');
			const apiRequest = new Request(apiUrl, request);
			return ApiRoutes.fetch(apiRequest, env, ctx);
		}

		// Serve MCP server card for discovery (SEP-1649)
		if (url.pathname === '/.well-known/mcp.json') {
			const serverCard = {
				schemaVersion: '2025-06-18',
				serverInfo: {
					name: 'Spaced Repetition MCP Server',
					version: '1.0.0',
					iconUrl: `${url.origin}/favicon.png`,
					description: 'A spaced repetition system for AI-powered learning with FSRS algorithm',
					documentationUrl: 'https://github.com/julianmoncarz/spaced-mcp-server',
				},
				capabilities: {
					tools: {},
				},
			};

			return new Response(JSON.stringify(serverCard, null, 2), {
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'public, max-age=3600',
					'Access-Control-Allow-Origin': '*',
				},
			});
		}

		// Serve favicon without authentication
		if (url.pathname === '/favicon.ico' || url.pathname === '/favicon.png') {
			const base64Data = FLASHCARD_ICON.split(',')[1];
			const binaryString = atob(base64Data);
			const bytes = new Uint8Array(binaryString.length);
			for (let i = 0; i < binaryString.length; i++) {
				bytes[i] = binaryString.charCodeAt(i);
			}

			return new Response(bytes, {
				headers: {
					'Content-Type': 'image/png',
					'Cache-Control': 'public, max-age=31536000',
				},
			});
		}

		// Delegate all other requests to GoogleHandler
		return (GoogleHandler as any).fetch(request, env, ctx);
	},
} as ExportedHandler<Env>;

export default new OAuthProvider({
	// NOTE - during the summer 2025, the SSE protocol was deprecated and replaced by the Streamable-HTTP protocol
	// https://developers.cloudflare.com/agents/model-context-protocol/transport/#mcp-server-with-authentication
	apiHandlers: {
		"/sse": MyMCP.serveSSE("/sse"), // deprecated SSE protocol - use /mcp instead
		"/mcp": MyMCP.serve("/mcp"), // Streamable-HTTP protocol
	},
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: DefaultHandler as any, // Custom handler for public favicon + OAuth
	tokenEndpoint: "/token",
});
