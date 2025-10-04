/**
 * Spaced Repetition Core Logic for Cloudflare D1
 * Ported from Python SQLite implementation
 */

export interface Card {
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

		// Create initial review record
		await this.db
			.prepare(
				`INSERT INTO reviews (card_id, user_id, easiness_factor, interval, repetitions, next_review_date)
         VALUES (?, ?, 2.5, 0, 0, DATE('now'))`,
			)
			.bind(cardId, this.userId)
			.run();

		return cardId;
	}

	/**
	 * Search cards using FTS or simple filter
	 */
	async searchCards(query: string = "", tags: string[] = []): Promise<Card[]> {
		let sql: string;
		let params: any[];

		if (query) {
			// Use FTS search
			sql = `
        SELECT c.id, c.instructions, r.next_review_date,
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
        SELECT c.id, c.instructions, r.next_review_date,
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
	async getDueCards(limit?: number, tags: string[] = []): Promise<Card[]> {
		let sql = `
      SELECT c.id, c.instructions, r.next_review_date,
             GROUP_CONCAT(t.tag) as tags
      FROM cards c
      JOIN reviews r ON c.id = r.card_id
      LEFT JOIN tags t ON c.id = t.card_id AND t.user_id = ?
      WHERE c.user_id = ? AND r.next_review_date <= DATE('now')
    `;
		const params: any[] = [this.userId, this.userId];

		if (tags.length > 0) {
			const placeholders = tags.map(() => "?").join(",");
			sql += ` AND c.id IN (SELECT card_id FROM tags WHERE user_id = ? AND tag IN (${placeholders}))`;
			params.push(this.userId, ...tags);
		}

		sql += " GROUP BY c.id ORDER BY r.next_review_date";

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
	async getAllCards(tags: string[] = []): Promise<Card[]> {
		let sql = `
      SELECT c.id, c.instructions, r.next_review_date,
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
	 * Submit a review with difficulty rating (1-5)
	 */
	async submitReview(cardId: number, difficulty: number): Promise<ReviewResult> {
		// Get current review state
		const review = await this.db
			.prepare(
				`SELECT easiness_factor, interval, repetitions
         FROM reviews WHERE card_id = ? AND user_id = ?`,
			)
			.bind(cardId, this.userId)
			.first();

		if (!review) {
			throw new Error(`Card ${cardId} not found`);
		}

		const ef = review.easiness_factor as number;
		const interval = review.interval as number;
		const repetitions = review.repetitions as number;

		// Calculate new values using SM-2 algorithm
		const { newInterval, newEf, newRepetitions } = this.calculateNextReview(
			repetitions,
			ef,
			difficulty,
			interval,
		);

		// Calculate next review date
		const today = new Date();
		const nextDate = new Date(today);
		nextDate.setDate(nextDate.getDate() + newInterval);
		const nextDateStr = nextDate.toISOString().split("T")[0];

		// Update reviews table
		await this.db
			.prepare(
				`UPDATE reviews
         SET easiness_factor = ?, interval = ?, repetitions = ?,
             next_review_date = ?, last_reviewed_date = DATE('now')
         WHERE card_id = ? AND user_id = ?`,
			)
			.bind(newEf, newInterval, newRepetitions, nextDateStr, cardId, this.userId)
			.run();

		return {
			next_review: nextDateStr,
			interval: newInterval,
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
         WHERE c.user_id = ? AND r.next_review_date <= DATE('now')${tagFilter}`,
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
                SUM(CASE WHEN r.next_review_date <= DATE('now') THEN 1 ELSE 0 END) as due_cards
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
	private formatCardRow(row: any): Card {
		const dueDate = row.next_review_date as string;
		const today = new Date().toISOString().split("T")[0];
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		const tomorrowStr = tomorrow.toISOString().split("T")[0];

		let dueStr: string;
		if (dueDate === today) {
			dueStr = "today";
		} else if (dueDate === tomorrowStr) {
			dueStr = "tomorrow";
		} else {
			dueStr = dueDate;
		}

		return {
			id: row.id as number,
			instructions: row.instructions as string,
			tags: row.tags ? (row.tags as string).split(",") : [],
			due: dueStr,
		};
	}

	/**
	 * Calculate next review using SM-2 algorithm
	 */
	private calculateNextReview(
		repetitions: number,
		easinessFactor: number,
		difficulty: number,
		previousInterval: number = 0,
	): { newInterval: number; newEf: number; newRepetitions: number } {
		// Reset if failed (difficulty < 3)
		if (difficulty < 3) {
			return {
				newInterval: 1,
				newEf: easinessFactor,
				newRepetitions: 0,
			};
		}

		// Calculate new EF
		let newEf =
			easinessFactor + (0.1 - (5 - difficulty) * (0.08 + (5 - difficulty) * 0.02));
		newEf = Math.max(1.3, newEf); // Minimum EF of 1.3

		// Calculate interval
		let interval: number;
		if (repetitions === 0) {
			interval = 1;
		} else if (repetitions === 1) {
			interval = 6;
		} else {
			interval = Math.round(previousInterval * newEf);
		}

		return {
			newInterval: interval,
			newEf: newEf,
			newRepetitions: repetitions + 1,
		};
	}
}
