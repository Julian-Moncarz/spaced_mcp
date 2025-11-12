/**
 * Spaced Repetition Core Logic for Cloudflare D1 using FSRS algorithm
 *
 * This class handles all database operations for spaced repetition cards.
 * Key principles:
 * - ALL queries filter by userId (Google email from OAuth) for user isolation
 * - FSRS algorithm handles optimal review scheduling (see: https://github.com/open-spaced-repetition/ts-fsrs)
 * - Reviews table stores CURRENT state only (history in review_history table)
 */

import { fsrs, Card, Rating, State, type Grade, type RecordLogItem, createEmptyCard } from 'ts-fsrs';

export interface CardData {
	id: number;
	instructions: string;
	tags: string[];
	due: string;
}

export interface ReviewResult {
	next_review: string;
	interval: number;
}

export interface BatchReviewInput {
	card_id: number;
	rating: Grade;
}

export interface BatchReviewSuccess {
	card_id: number;
	next_review: string;
	interval: number;
}

export interface BatchReviewFailure {
	card_id: number;
	error: string;
}

export interface BatchReviewResult {
	successful: BatchReviewSuccess[];
	failed: BatchReviewFailure[];
}

export interface BatchSearchInput {
	query: string;
	tags?: string[];
}

export interface BatchSearchSuccess {
	query: string;
	cards: CardData[];
}

export interface BatchEditInput {
	card_id: number;
	instructions?: string;
	tags?: string[];
}

export interface BatchOperationResult<T> {
	successful: T[];
	failed: Array<{ card_id?: number; query?: string; error: string }>;
}

export interface Stats {
	due_today: number;
	total: number;
	cards_reviewed_last_24h: number;
	current_streak: number;
	longest_streak: number;
	total_reviews: number;
	by_tag?: Record<string, { total: number; due: number }>;
}

export class SpacedRepetition {
	// FSRS scheduler - handles all spaced repetition math
	// Uses machine learning-based algorithm for optimal review scheduling
	// See: https://github.com/open-spaced-repetition/ts-fsrs
	private scheduler = fsrs();

	constructor(
		private db: D1Database,
		// userId is the user's Google email from OAuth (this.props.login in index.ts)
		// ALL queries MUST filter by this to ensure user isolation
		// Example: WHERE user_id = 'user@gmail.com'
		private userId: string,
	) {}

	/**
	 * Add a new card with instructions and tags
	 */
	async addCard(instructions: string, tags: string[]): Promise<number> {
		// Insert card
		const result = await this.db
			.prepare("INSERT INTO cards (user_id, instructions) VALUES (?, ?)")
			.bind(this.userId, instructions)
			.run();

		const cardId = result.meta.last_row_id as number;

		// Insert tags
		if (tags.length > 0) {
			const tagInserts = tags
				.filter((tag) => tag.trim())
				.map((tag) =>
					this.db
						.prepare("INSERT INTO tags (card_id, user_id, tag) VALUES (?, ?, ?)")
						.bind(cardId, this.userId, tag.trim()),
				);
			await this.db.batch(tagInserts);
		}

		// Create initial FSRS card state
		const emptyCard = createEmptyCard();
		await this.db
			.prepare(
				`INSERT INTO reviews (card_id, user_id, state, due, stability, difficulty,
         elapsed_days, scheduled_days, learning_steps, reps, lapses, last_review)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				cardId,
				this.userId,
				emptyCard.state,
				emptyCard.due.toISOString(),
				emptyCard.stability,
				emptyCard.difficulty,
				emptyCard.elapsed_days,
				emptyCard.scheduled_days,
				emptyCard.learning_steps,
				emptyCard.reps,
				emptyCard.lapses,
				emptyCard.last_review ? emptyCard.last_review.toISOString() : null,
			)
			.run();

		return cardId;
	}

	/**
	 * Search cards using FTS or simple filter
	 */
	async searchCards(query: string = "", tags: string[] = []): Promise<CardData[]> {
		let sql: string;
		let params: any[];

		if (query) {
			// Use FTS search
			sql = `
        SELECT c.id, c.instructions, r.due,
               GROUP_CONCAT(t.tag) as tags
        FROM cards_fts fts
        JOIN cards c ON fts.rowid = c.id
        JOIN reviews r ON c.id = r.card_id
        LEFT JOIN tags t ON c.id = t.card_id AND t.user_id = ?
        WHERE cards_fts MATCH ? AND c.user_id = ?
      `;
			params = [this.userId, query, this.userId];
		} else {
			sql = `
        SELECT c.id, c.instructions, r.due,
               GROUP_CONCAT(t.tag) as tags
        FROM cards c
        JOIN reviews r ON c.id = r.card_id
        LEFT JOIN tags t ON c.id = t.card_id AND t.user_id = ?
        WHERE c.user_id = ?
      `;
			params = [this.userId, this.userId];
		}

		if (tags.length > 0) {
			const placeholders = tags.map(() => "?").join(",");
			sql += ` AND c.id IN (SELECT card_id FROM tags WHERE user_id = ? AND tag IN (${placeholders}))`;
			params.push(this.userId, ...tags);
		}

		sql += " GROUP BY c.id ORDER BY c.created_at DESC";

		const result = await this.db.prepare(sql).bind(...params).all();
		return result.results.map((row) => this.formatCardRow(row));
	}

	/**
	 * Get cards due for review, sorted by FSRS retrievability (descending)
	 */
	async getDueCards(limit?: number, tags: string[] = []): Promise<CardData[]> {
		// Fetch all FSRS data needed for retrievability calculation
		let sql = `
      SELECT c.id, c.instructions, r.due, r.state, r.stability, r.difficulty,
             r.elapsed_days, r.scheduled_days, r.learning_steps, r.reps, r.lapses,
             r.last_review, GROUP_CONCAT(t.tag) as tags
      FROM cards c
      JOIN reviews r ON c.id = r.card_id
      LEFT JOIN tags t ON c.id = t.card_id AND t.user_id = ?
      WHERE c.user_id = ? AND datetime(r.due) <= datetime('now')
    `;
		const params: any[] = [this.userId, this.userId];

		if (tags.length > 0) {
			const placeholders = tags.map(() => "?").join(",");
			sql += ` AND c.id IN (SELECT card_id FROM tags WHERE user_id = ? AND tag IN (${placeholders}))`;
			params.push(this.userId, ...tags);
		}

		sql += " GROUP BY c.id";

		const result = await this.db.prepare(sql).bind(...params).all();

		// Calculate retrievability for each card and sort
		// Retrievability = probability (0-1) of successfully recalling the card right now
		// Higher retrievability = more likely to remember
		const now = new Date();
		const cardsWithR = result.results.map((row: any) => {
			// Convert DB row to FSRS Card object
			const card: Card = {
				state: row.state as State,
				due: new Date(row.due as string),
				stability: row.stability as number,
				difficulty: row.difficulty as number,
				elapsed_days: row.elapsed_days as number,
				scheduled_days: row.scheduled_days as number,
				learning_steps: row.learning_steps as number,
				reps: row.reps as number,
				lapses: row.lapses as number,
				last_review: row.last_review ? new Date(row.last_review as string) : undefined,
			};

			// Get retrievability from FSRS (probability of recall)
			const retrievability = this.scheduler.get_retrievability(card, now, false);

			return {
				row,
				retrievability,
			};
		});

		// Sort by retrievability DESCENDING (highest first) - FSRS recommendation for backlogs
		cardsWithR.sort((a, b) => b.retrievability - a.retrievability);

		// Apply limit after sorting
		const limitedCards = limit ? cardsWithR.slice(0, limit) : cardsWithR;

		// Format and return
		return limitedCards.map((item) => this.formatCardRow(item.row));
	}

	/**
	 * Get all cards
	 */
	async getAllCards(tags: string[] = []): Promise<CardData[]> {
		let sql = `
      SELECT c.id, c.instructions, r.due,
             GROUP_CONCAT(t.tag) as tags
      FROM cards c
      JOIN reviews r ON c.id = r.card_id
      LEFT JOIN tags t ON c.id = t.card_id AND t.user_id = ?
      WHERE c.user_id = ?
    `;
		const params: any[] = [this.userId, this.userId];

		if (tags.length > 0) {
			const placeholders = tags.map(() => "?").join(",");
			sql += ` AND c.id IN (SELECT card_id FROM tags WHERE user_id = ? AND tag IN (${placeholders}))`;
			params.push(this.userId, ...tags);
		}

		sql += " GROUP BY c.id ORDER BY c.created_at DESC";

		const result = await this.db.prepare(sql).bind(...params).all();
		return result.results.map((row) => this.formatCardRow(row));
	}

	/**
	 * Submit batch reviews with FSRS ratings
	 * Processes multiple card reviews in a single transaction for performance
	 */
	async submitBatchReviews(reviews: BatchReviewInput[]): Promise<BatchReviewResult> {
		const successful: BatchReviewSuccess[] = [];
		const failed: BatchReviewFailure[] = [];

		for (const { card_id, rating } of reviews) {
			try {
				const result = await this.submitReview(card_id, rating);
				successful.push({
					card_id,
					next_review: result.next_review,
					interval: result.interval,
				});
			} catch (error) {
				failed.push({
					card_id,
					error: error instanceof Error ? error.message : 'Unknown error',
				});
			}
		}

		return { successful, failed };
	}

	/**
	 * Search multiple queries in batch
	 */
	async searchCardsInBatch(searches: BatchSearchInput[]): Promise<BatchOperationResult<BatchSearchSuccess>> {
		const successful: BatchSearchSuccess[] = [];
		const failed: Array<{ query?: string; error: string }> = [];

		for (const search of searches) {
			try {
				const cards = await this.searchCards(search.query, search.tags);
				successful.push({
					query: search.query,
					cards,
				});
			} catch (error) {
				failed.push({
					query: search.query,
					error: error instanceof Error ? error.message : 'Unknown error',
				});
			}
		}

		return { successful, failed };
	}

	/**
	 * Submit a review with FSRS rating (1-4: Again, Hard, Good, Easy)
	 */
	async submitReview(cardId: number, rating: Grade): Promise<ReviewResult> {
		// Get current card state from database
		const review = await this.db
			.prepare(
				`SELECT state, due, stability, difficulty, elapsed_days, scheduled_days,
         learning_steps, reps, lapses, last_review
         FROM reviews WHERE card_id = ? AND user_id = ?`,
			)
			.bind(cardId, this.userId)
			.first();

		if (!review) {
			throw new Error(`Card ${cardId} not found`);
		}

		// Save current state to review_history BEFORE updating
		await this.db
			.prepare(
				`INSERT INTO review_history (card_id, user_id, state, due, stability, difficulty,
         elapsed_days, scheduled_days, learning_steps, reps, lapses, last_review)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				cardId,
				this.userId,
				review.state,
				review.due,
				review.stability,
				review.difficulty,
				review.elapsed_days,
				review.scheduled_days,
				review.learning_steps,
				review.reps,
				review.lapses,
				review.last_review,
			)
			.run();

		// Convert database row to FSRS Card object
		const card: Card = {
			state: review.state as State,
			due: new Date(review.due as string),
			stability: review.stability as number,
			difficulty: review.difficulty as number,
			elapsed_days: review.elapsed_days as number,
			scheduled_days: review.scheduled_days as number,
			learning_steps: review.learning_steps as number,
			reps: review.reps as number,
			lapses: review.lapses as number,
			last_review: review.last_review ? new Date(review.last_review as string) : undefined,
		};

		// Schedule the card using FSRS
		const now = new Date();
		const recordLogItem: RecordLogItem = this.scheduler.next(card, now, rating);
		const updatedCard = recordLogItem.card;

		// Calculate interval in days
		const nextDate = updatedCard.due;
		const interval = Math.round(
			(nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
		);

		// Update reviews table with new FSRS state
		await this.db
			.prepare(
				`UPDATE reviews
         SET state = ?, due = ?, stability = ?, difficulty = ?,
             elapsed_days = ?, scheduled_days = ?, learning_steps = ?,
             reps = ?, lapses = ?, last_review = ?
         WHERE card_id = ? AND user_id = ?`,
			)
			.bind(
				updatedCard.state,
				updatedCard.due.toISOString(),
				updatedCard.stability,
				updatedCard.difficulty,
				updatedCard.elapsed_days,
				updatedCard.scheduled_days,
				updatedCard.learning_steps,
				updatedCard.reps,
				updatedCard.lapses,
				updatedCard.last_review ? updatedCard.last_review.toISOString() : null,
				cardId,
				this.userId,
			)
			.run();

		return {
			next_review: nextDate.toISOString().split("T")[0],
			interval: interval,
		};
	}

	/**
	 * Undo the last review for a card
	 */
	async undoReview(cardId: number): Promise<boolean> {
		// Get the most recent review history entry for this card
		const history = await this.db
			.prepare(
				`SELECT id, state, due, stability, difficulty, elapsed_days, scheduled_days,
         learning_steps, reps, lapses, last_review
         FROM review_history
         WHERE card_id = ? AND user_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
			)
			.bind(cardId, this.userId)
			.first();

		if (!history) {
			return false; // No history to undo
		}

		// Restore the previous state to reviews table
		await this.db
			.prepare(
				`UPDATE reviews
         SET state = ?, due = ?, stability = ?, difficulty = ?,
             elapsed_days = ?, scheduled_days = ?, learning_steps = ?,
             reps = ?, lapses = ?, last_review = ?
         WHERE card_id = ? AND user_id = ?`,
			)
			.bind(
				history.state,
				history.due,
				history.stability,
				history.difficulty,
				history.elapsed_days,
				history.scheduled_days,
				history.learning_steps,
				history.reps,
				history.lapses,
				history.last_review,
				cardId,
				this.userId,
			)
			.run();

		// Delete the history entry we just used
		await this.db
			.prepare("DELETE FROM review_history WHERE id = ?")
			.bind(history.id)
			.run();

		return true;
	}

	/**
	 * Undo reviews for multiple cards in batch
	 */
	async undoReviewsInBatch(cardIds: number[]): Promise<BatchOperationResult<{ card_id: number }>> {
		const successful: Array<{ card_id: number }> = [];
		const failed: Array<{ card_id: number; error: string }> = [];

		for (const cardId of cardIds) {
			try {
				const success = await this.undoReview(cardId);
				if (success) {
					successful.push({ card_id: cardId });
				} else {
					failed.push({
						card_id: cardId,
						error: 'No review history found',
					});
				}
			} catch (error) {
				failed.push({
					card_id: cardId,
					error: error instanceof Error ? error.message : 'Unknown error',
				});
			}
		}

		return { successful, failed };
	}

	/**
	 * Delete a card
	 */
	async deleteCard(cardId: number): Promise<boolean> {
		const result = await this.db
			.prepare("DELETE FROM cards WHERE id = ? AND user_id = ?")
			.bind(cardId, this.userId)
			.run();

		return result.meta.changes > 0;
	}

	/**
	 * Delete multiple cards in batch
	 */
	async deleteCardsInBatch(cardIds: number[]): Promise<BatchOperationResult<{ card_id: number }>> {
		const successful: Array<{ card_id: number }> = [];
		const failed: Array<{ card_id: number; error: string }> = [];

		for (const cardId of cardIds) {
			try {
				const success = await this.deleteCard(cardId);
				if (success) {
					successful.push({ card_id: cardId });
				} else {
					failed.push({
						card_id: cardId,
						error: 'Card not found',
					});
				}
			} catch (error) {
				failed.push({
					card_id: cardId,
					error: error instanceof Error ? error.message : 'Unknown error',
				});
			}
		}

		return { successful, failed };
	}

	/**
	 * Edit a card's instructions and/or tags
	 */
	async editCard(
		cardId: number,
		instructions?: string,
		tags?: string[],
	): Promise<boolean> {
		// Check if card exists and belongs to user
		const card = await this.db
			.prepare("SELECT id FROM cards WHERE id = ? AND user_id = ?")
			.bind(cardId, this.userId)
			.first();

		if (!card) {
			return false;
		}

		// Update instructions if provided
		if (instructions !== undefined) {
			await this.db
				.prepare("UPDATE cards SET instructions = ? WHERE id = ? AND user_id = ?")
				.bind(instructions, cardId, this.userId)
				.run();
		}

		// Update tags if provided
		if (tags !== undefined) {
			// Delete existing tags
			await this.db
				.prepare("DELETE FROM tags WHERE card_id = ? AND user_id = ?")
				.bind(cardId, this.userId)
				.run();

			// Insert new tags
			if (tags.length > 0) {
				const tagInserts = tags
					.filter((tag) => tag.trim())
					.map((tag) =>
						this.db
							.prepare("INSERT INTO tags (card_id, user_id, tag) VALUES (?, ?, ?)")
							.bind(cardId, this.userId, tag.trim()),
					);
				await this.db.batch(tagInserts);
			}
		}

		return true;
	}

	/**
	 * Edit multiple cards in batch
	 */
	async editCardsInBatch(edits: BatchEditInput[]): Promise<BatchOperationResult<{ card_id: number }>> {
		const successful: Array<{ card_id: number }> = [];
		const failed: Array<{ card_id: number; error: string }> = [];

		for (const edit of edits) {
			try {
				const success = await this.editCard(edit.card_id, edit.instructions, edit.tags);
				if (success) {
					successful.push({ card_id: edit.card_id });
				} else {
					failed.push({
						card_id: edit.card_id,
						error: 'Card not found',
					});
				}
			} catch (error) {
				failed.push({
					card_id: edit.card_id,
					error: error instanceof Error ? error.message : 'Unknown error',
				});
			}
		}

		return { successful, failed };
	}

	/**
	 * Get cards reviewed in the last 24 hours
	 */
	private async getCardsReviewedLast24Hours(): Promise<number> {
		const result = await this.db
			.prepare(
				`SELECT COUNT(DISTINCT card_id) as count
         FROM review_history
         WHERE user_id = ? AND created_at >= datetime('now', '-24 hours')`,
			)
			.bind(this.userId)
			.first();

		return (result?.count as number) || 0;
	}

	/**
	 * Get total reviews count
	 */
	private async getTotalReviews(): Promise<number> {
		const result = await this.db
			.prepare(
				`SELECT COUNT(*) as count
         FROM review_history
         WHERE user_id = ?`,
			)
			.bind(this.userId)
			.first();

		return (result?.count as number) || 0;
	}

	/**
	 * Calculate current streak (consecutive days with reviews)
	 */
	private async getCurrentStreak(): Promise<number> {
		// Get distinct review dates ordered by date descending
		const result = await this.db
			.prepare(
				`SELECT DISTINCT DATE(created_at) as review_date
         FROM review_history
         WHERE user_id = ?
         ORDER BY review_date DESC`,
			)
			.bind(this.userId)
			.all();

		if (!result.results || result.results.length === 0) {
			return 0;
		}

		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const todayStr = today.toISOString().split('T')[0];

		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);
		const yesterdayStr = yesterday.toISOString().split('T')[0];

		const reviewDates = result.results.map((row) => row.review_date as string);

		// Check if user reviewed today or yesterday (streak is active)
		if (reviewDates[0] !== todayStr && reviewDates[0] !== yesterdayStr) {
			return 0; // Streak is broken
		}

		// Count consecutive days
		let streak = 0;
		let expectedDate = reviewDates[0] === todayStr ? today : yesterday;

		for (const dateStr of reviewDates) {
			const expectedDateStr = expectedDate.toISOString().split('T')[0];
			if (dateStr === expectedDateStr) {
				streak++;
				expectedDate.setDate(expectedDate.getDate() - 1);
			} else {
				break; // Streak broken
			}
		}

		return streak;
	}

	/**
	 * Calculate longest streak ever
	 */
	private async getLongestStreak(): Promise<number> {
		// Get all distinct review dates ordered by date
		const result = await this.db
			.prepare(
				`SELECT DISTINCT DATE(created_at) as review_date
         FROM review_history
         WHERE user_id = ?
         ORDER BY review_date ASC`,
			)
			.bind(this.userId)
			.all();

		if (!result.results || result.results.length === 0) {
			return 0;
		}

		const reviewDates = result.results.map((row) => row.review_date as string);

		let longestStreak = 1;
		let currentStreak = 1;

		for (let i = 1; i < reviewDates.length; i++) {
			const prevDate = new Date(reviewDates[i - 1]);
			const currDate = new Date(reviewDates[i]);

			// Calculate difference in days
			const diffTime = currDate.getTime() - prevDate.getTime();
			const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

			if (diffDays === 1) {
				// Consecutive day
				currentStreak++;
				longestStreak = Math.max(longestStreak, currentStreak);
			} else {
				// Streak broken
				currentStreak = 1;
			}
		}

		return longestStreak;
	}

	/**
	 * Get statistics
	 */
	async getStats(tags: string[] = []): Promise<Stats> {
		const params: any[] = [this.userId];
		let tagFilter = "";

		if (tags.length > 0) {
			const placeholders = tags.map(() => "?").join(",");
			tagFilter = ` AND c.id IN (SELECT card_id FROM tags WHERE user_id = ? AND tag IN (${placeholders}))`;
			params.push(this.userId, ...tags);
		}

		// Run all queries in parallel for better performance
		const [
			dueResult,
			totalResult,
			cardsReviewedLast24h,
			currentStreak,
			longestStreak,
			totalReviews,
		] = await Promise.all([
			// Count due today
			this.db
				.prepare(
					`SELECT COUNT(*) as count
           FROM cards c
           JOIN reviews r ON c.id = r.card_id
           WHERE c.user_id = ? AND datetime(r.due) <= datetime('now')${tagFilter}`,
				)
				.bind(...params)
				.first(),
			// Count total cards
			this.db
				.prepare(
					`SELECT COUNT(*) as count
           FROM cards c
           WHERE c.user_id = ?${tagFilter}`,
				)
				.bind(...params)
				.first(),
			// Get motivational stats
			this.getCardsReviewedLast24Hours(),
			this.getCurrentStreak(),
			this.getLongestStreak(),
			this.getTotalReviews(),
		]);

		const stats: Stats = {
			due_today: (dueResult?.count as number) || 0,
			total: (totalResult?.count as number) || 0,
			cards_reviewed_last_24h: cardsReviewedLast24h,
			current_streak: currentStreak,
			longest_streak: longestStreak,
			total_reviews: totalReviews,
		};

		// Stats by tag if no specific tags requested
		if (tags.length === 0) {
			const tagStatsResult = await this.db
				.prepare(
					`SELECT t.tag,
               COUNT(DISTINCT c.id) as total_cards,
               SUM(CASE WHEN datetime(r.due) <= datetime('now') THEN 1 ELSE 0 END) as due_cards
         FROM tags t
         JOIN cards c ON t.card_id = c.id
         JOIN reviews r ON c.id = r.card_id
         WHERE t.user_id = ?
         GROUP BY t.tag
         ORDER BY t.tag`,
				)
				.bind(this.userId)
				.all();

			const byTag: Record<string, { total: number; due: number }> = {};
			for (const row of tagStatsResult.results) {
				byTag[row.tag as string] = {
					total: (row.total_cards as number) || 0,
					due: (row.due_cards as number) || 0,
				};
			}
			stats.by_tag = byTag;
		}

		return stats;
	}

	/**
	 * Format a card row from database
	 */
	private formatCardRow(row: any): CardData {
		const dueDate = new Date(row.due as string);
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const tomorrow = new Date(today);
		tomorrow.setDate(tomorrow.getDate() + 1);

		let dueStr: string;
		const dueDay = new Date(dueDate);
		dueDay.setHours(0, 0, 0, 0);

		if (dueDay.getTime() === today.getTime()) {
			dueStr = "today";
		} else if (dueDay.getTime() === tomorrow.getTime()) {
			dueStr = "tomorrow";
		} else {
			dueStr = dueDate.toISOString().split("T")[0];
		}

		return {
			id: row.id as number,
			instructions: row.instructions as string,
			tags: row.tags ? (row.tags as string).split(",") : [],
			due: dueStr,
		};
	}
}
