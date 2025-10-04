/**
 * Spaced Repetition Core Logic for Cloudflare D1 using FSRS algorithm
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

export interface Stats {
	due_today: number;
	total: number;
	by_tag?: Record<string, { total: number; due: number }>;
}

export class SpacedRepetition {
	private scheduler = fsrs();

	constructor(
		private db: D1Database,
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
	 * Get cards due for review
	 */
	async getDueCards(limit?: number, tags: string[] = []): Promise<CardData[]> {
		let sql = `
      SELECT c.id, c.instructions, r.due,
             GROUP_CONCAT(t.tag) as tags
      FROM cards c
      JOIN reviews r ON c.id = r.card_id
      LEFT JOIN tags t ON c.id = t.card_id AND t.user_id = ?
      WHERE c.user_id = ? AND r.due <= datetime('now')
    `;
		const params: any[] = [this.userId, this.userId];

		if (tags.length > 0) {
			const placeholders = tags.map(() => "?").join(",");
			sql += ` AND c.id IN (SELECT card_id FROM tags WHERE user_id = ? AND tag IN (${placeholders}))`;
			params.push(this.userId, ...tags);
		}

		sql += " GROUP BY c.id ORDER BY r.due";

		if (limit !== undefined) {
			sql += " LIMIT ?";
			params.push(limit);
		}

		const result = await this.db.prepare(sql).bind(...params).all();
		return result.results.map((row) => this.formatCardRow(row));
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

		// Count due today
		const dueResult = await this.db
			.prepare(
				`SELECT COUNT(*) as count
         FROM cards c
         JOIN reviews r ON c.id = r.card_id
         WHERE c.user_id = ? AND r.due <= datetime('now')${tagFilter}`,
			)
			.bind(...params)
			.first();

		// Count total cards
		const totalResult = await this.db
			.prepare(
				`SELECT COUNT(*) as count
         FROM cards c
         WHERE c.user_id = ?${tagFilter}`,
			)
			.bind(...params)
			.first();

		const stats: Stats = {
			due_today: (dueResult?.count as number) || 0,
			total: (totalResult?.count as number) || 0,
		};

		// Stats by tag if no specific tags requested
		if (tags.length === 0) {
			const tagStatsResult = await this.db
				.prepare(
					`SELECT t.tag,
               COUNT(DISTINCT c.id) as total_cards,
               SUM(CASE WHEN r.due <= datetime('now') THEN 1 ELSE 0 END) as due_cards
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
