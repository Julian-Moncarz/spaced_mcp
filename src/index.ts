import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { GitHubHandler } from "./github-handler";
import { SpacedRepetition } from "./spaced-core";

// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
type Props = {
	login: string;
	name: string;
	email: string;
	accessToken: string;
};

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Spaced Repetition MCP Server",
		version: "1.0.0",
	});

	async init() {
		// Initialize SpacedRepetition instance with user's GitHub login as user_id
		const getUserDb = () => new SpacedRepetition(this.env.DB, this.props!.login);

		// Tool 1: Add a new card
		this.server.tool(
			"add_card",
			"Add a new spaced repetition card with instructions and optional tags",
			{
				instructions: z
					.string()
					.describe("Detailed instructions for generating practice problems or questions"),
				tags: z
					.string()
					.optional()
					.describe("Comma-separated tags (e.g., 'python,algorithms')"),
			},
			async ({ instructions, tags }) => {
				const db = getUserDb();
				const tagArray = tags ? tags.split(",").map((t) => t.trim()) : [];
				const cardId = await db.addCard(instructions, tagArray);
				return {
					content: [{ text: `Created card ${cardId}`, type: "text" }],
				};
			},
		);

		// Tool 2: Get due cards
		this.server.tool(
			"get_due_cards",
			"Get cards that are due for review today",
			{
				limit: z.number().optional().describe("Maximum number of cards to return"),
				tags: z
					.string()
					.optional()
					.describe("Filter by comma-separated tags (e.g., 'python,algorithms')"),
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

		// Tool 3: Search cards
		this.server.tool(
			"search_cards",
			"Search cards using full-text search with optional tag filtering",
			{
				query: z.string().describe("Search query text"),
				tags: z
					.string()
					.optional()
					.describe("Filter by comma-separated tags (e.g., 'python,algorithms')"),
			},
			async ({ query, tags }) => {
				const db = getUserDb();
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

		// Tool 5: Review a card
		this.server.tool(
			"review_card",
			"Submit a review for a card with difficulty rating (1=failed, 5=easy)",
			{
				card_id: z.number().describe("The ID of the card to review"),
				difficulty: z
					.number()
					.min(1)
					.max(5)
					.describe("Difficulty rating: 1=failed, 2=hard, 3=medium, 4=good, 5=easy"),
			},
			async ({ card_id, difficulty }) => {
				const db = getUserDb();
				try {
					const result = await db.submitReview(card_id, difficulty);
					const today = new Date().toISOString().split("T")[0];
					const nextDate = new Date(result.next_review);
					const daysDiff = Math.round(
						(nextDate.getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24),
					);

					let dateStr: string;
					if (daysDiff === 0) {
						dateStr = "today";
					} else if (daysDiff === 1) {
						dateStr = "tomorrow";
					} else {
						dateStr = `${result.next_review} (in ${daysDiff} days)`;
					}

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
			},
		);

		// Tool 6: Edit a card
		this.server.tool(
			"edit_card",
			"Edit a card's instructions and/or tags",
			{
				card_id: z.number().describe("The ID of the card to edit"),
				instructions: z.string().optional().describe("New instructions text"),
				tags: z.string().optional().describe("New comma-separated tags"),
			},
			async ({ card_id, instructions, tags }) => {
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

				const db = getUserDb();
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
			},
		);

		// Tool 7: Delete a card
		this.server.tool(
			"delete_card",
			"Delete a card permanently",
			{
				card_id: z.number().describe("The ID of the card to delete"),
			},
			async ({ card_id }) => {
				const db = getUserDb();
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
			},
		);

		// Tool 8: Get statistics
		this.server.tool(
			"get_stats",
			"Get statistics about your spaced repetition cards",
			{
				tags: z
					.string()
					.optional()
					.describe("Filter by comma-separated tags (e.g., 'python,algorithms')"),
			},
			async ({ tags }) => {
				const db = getUserDb();
				const tagArray = tags ? tags.split(",").map((t) => t.trim()) : [];
				const stats = await db.getStats(tagArray);

				let text = `Cards due today: ${stats.due_today}\nTotal cards: ${stats.total}`;

				if (stats.by_tag && Object.keys(stats.by_tag).length > 0) {
					text += "\n\nBy tag:";
					for (const [tag, tagStats] of Object.entries(stats.by_tag)) {
						text += `\n  ${tag}: ${tagStats.total} cards (${tagStats.due} due)`;
					}
				}

				return {
					content: [{ text, type: "text" }],
				};
			},
		);
	}
}

export default new OAuthProvider({
	// NOTE - during the summer 2025, the SSE protocol was deprecated and replaced by the Streamable-HTTP protocol
	// https://developers.cloudflare.com/agents/model-context-protocol/transport/#mcp-server-with-authentication
	apiHandlers: {
		"/sse": MyMCP.serveSSE("/sse"), // deprecated SSE protocol - use /mcp instead
		"/mcp": MyMCP.serve("/mcp"), // Streamable-HTTP protocol
	},
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: GitHubHandler as any,
	tokenEndpoint: "/token",
});
