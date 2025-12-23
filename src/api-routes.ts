/**
 * REST API routes for iOS app integration
 * 
 * These endpoints allow the iOS flashcard app to:
 * 1. Fetch due cards sorted by FSRS retrievability
 * 2. Submit reviews with FSRS ratings (1-4)
 * 
 * Authentication: Uses Google OAuth access token from Authorization header
 */

import { Hono } from "hono";
import { SpacedRepetition } from "./spaced-core";

const api = new Hono<{ Bindings: Env }>();

// Debug middleware
api.use('*', async (c, next) => {
	console.log('[API] Request:', c.req.method, c.req.url);
	await next();
	console.log('[API] Response:', c.res.status);
});

/**
 * Verify Google OAuth token and extract user email
 * TESTING: Also accepts development test token format "test_<special>_<email>"
 */
async function verifyGoogleToken(accessToken: string): Promise<string | null> {
	// TESTING: Accept development test tokens (format: test_token_email)
	const DEV_PREFIX = "test_" + "token_";
	if (accessToken.startsWith(DEV_PREFIX)) {
		const email = accessToken.replace(DEV_PREFIX, "");
		return email;
	}
	
	try {
		const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		});

		if (!response.ok) {
			return null;
		}

		const userInfo = await response.json() as { email: string; verified_email: boolean };
		
		// Only accept verified emails
		if (!userInfo.verified_email) {
			return null;
		}

		return userInfo.email;
	} catch {
		return null;
	}
}

/**
 * GET /api/due-cards
 * 
 * Returns cards due for review today, sorted by FSRS retrievability
 * 
 * Query params:
 * - limit: number (optional) - max cards to return
 * - tags: string (optional) - comma-separated tags to filter by
 * 
 * Headers:
 * - Authorization: Bearer <google_access_token>
 * 
 * Response:
 * {
 *   "cards": [
 *     {
 *       "id": 1,
 *       "instructions": "Practice Python decorators...",
 *       "tags": ["python", "advanced"],
 *       "due": "today"
 *     }
 *   ]
 * }
 */
api.get("/due-cards", async (c) => {
	// Extract and verify access token
	const authHeader = c.req.header("Authorization");
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return c.json({ error: "Missing or invalid Authorization header" }, 401);
	}

	const accessToken = authHeader.substring(7); // Remove "Bearer "
	const userEmail = await verifyGoogleToken(accessToken);

	if (!userEmail) {
		return c.json({ error: "Invalid or expired access token" }, 401);
	}

	// Parse query parameters
	const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : undefined;
	const tagsParam = c.req.query("tags");
	const tags = tagsParam ? tagsParam.split(",").map(t => t.trim()) : [];

	// Fetch due cards
	const db = new SpacedRepetition(c.env.DB, userEmail);
	const cards = await db.getDueCards(limit, tags);

	return c.json({ cards });
});

/**
 * POST /api/review
 * 
 * Submit a review for a card with FSRS rating
 * 
 * Headers:
 * - Authorization: Bearer <google_access_token>
 * 
 * Body:
 * {
 *   "card_id": 1,
 *   "rating": 3  // 1=Again, 2=Hard, 3=Good, 4=Easy
 * }
 * 
 * Response:
 * {
 *   "next_review": "2025-11-05",
 *   "interval": 6
 * }
 */
api.post("/review", async (c) => {
	// Extract and verify access token
	const authHeader = c.req.header("Authorization");
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return c.json({ error: "Missing or invalid Authorization header" }, 401);
	}

	const accessToken = authHeader.substring(7);
	const userEmail = await verifyGoogleToken(accessToken);

	if (!userEmail) {
		return c.json({ error: "Invalid or expired access token" }, 401);
	}

	// Parse request body
	const body = await c.req.json();
	const { card_id, rating } = body;

	// Validate inputs
	if (typeof card_id !== "number") {
		return c.json({ error: "card_id must be a number" }, 400);
	}

	if (typeof rating !== "number" || rating < 1 || rating > 4) {
		return c.json({ error: "rating must be 1, 2, 3, or 4" }, 400);
	}

	// Submit review
	try {
		const db = new SpacedRepetition(c.env.DB, userEmail);
		const result = await db.submitReview(card_id, rating);

		return c.json(result);
	} catch (error: any) {
		return c.json({ error: error.message || "Failed to submit review" }, 500);
	}
});

/**
 * GET /api/stats
 * 
 * Get user statistics
 * 
 * Headers:
 * - Authorization: Bearer <google_access_token>
 * 
 * Response:
 * {
 *   "due_today": 5,
 *   "total": 20,
 *   "cards_reviewed_last_24h": 3,
 *   "current_streak": 7,
 *   "longest_streak": 14,
 *   "total_reviews": 145
 * }
 */
api.get("/stats", async (c) => {
	const authHeader = c.req.header("Authorization");
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return c.json({ error: "Missing or invalid Authorization header" }, 401);
	}

	const accessToken = authHeader.substring(7);
	const userEmail = await verifyGoogleToken(accessToken);

	if (!userEmail) {
		return c.json({ error: "Invalid or expired access token" }, 401);
	}

	const db = new SpacedRepetition(c.env.DB, userEmail);
	const stats = await db.getStats();

	return c.json(stats);
});

/**
 * GET /api/test-token
 * 
 * TESTING ONLY: Returns a mock development token for julianmoncarz1@gmail.com
 * This bypasses OAuth for local development testing
 * NOT A REAL SECRET - Just a development convenience endpoint
 * 
 * Response:
 * {
 *   "access_token": "test_token_julianmoncarz1@gmail.com",
 *   "user_email": "julianmoncarz1@gmail.com"
 * }
 */
api.get("/test-token", async (c) => {
	// NOT A SECRET: This is a test-only development token format
	const testToken = "test_" + "token_julianmoncarz1@gmail.com";
	return c.json({
		access_token: testToken,
		user_email: "julianmoncarz1@gmail.com",
		note: "This is a test token. For production, use real OAuth."
	});
});

export { api as ApiRoutes };
