-- Spaced Repetition Database Schema with User Isolation
-- All tables have user_id column (Google email from OAuth) to isolate data by user
-- This ensures users can ONLY access their own cards

-- Cards table: Stores learning instructions (not traditional Q&A flashcards)
-- Instructions are meta-prompts that Claude uses to generate dynamic practice problems
CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL, -- Google email from OAuth (e.g., "user@gmail.com")
    instructions TEXT NOT NULL, -- Instructions for generating practice problems
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tags table: Many-to-many relationship with cards
-- Cards can have multiple tags, tags can apply to multiple cards
-- Used for filtering cards by topic (e.g., "python", "algorithms")
CREATE TABLE IF NOT EXISTS tags (
    card_id INTEGER NOT NULL,
    user_id TEXT NOT NULL, -- Same as cards.user_id for consistency
    tag TEXT NOT NULL,
    PRIMARY KEY (card_id, tag),
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

-- Reviews table: ONE row per card (1:1 relationship)
-- Stores the CURRENT FSRS state for scheduling the next review
-- This is NOT a history of all reviews - just the current state!
-- Historical reviews are stored in review_history table below
CREATE TABLE IF NOT EXISTS reviews (
    card_id INTEGER PRIMARY KEY, -- 1:1 with cards
    user_id TEXT NOT NULL,
    -- FSRS fields (see: https://github.com/open-spaced-repetition/ts-fsrs)
    state INTEGER DEFAULT 0, -- 0=New, 1=Learning, 2=Review, 3=Relearning
    due TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- When to review next
    stability REAL DEFAULT 0, -- How long (days) until likely to forget
    difficulty REAL DEFAULT 0, -- Intrinsic complexity (0-10 scale)
    elapsed_days INTEGER DEFAULT 0, -- Days since last review
    scheduled_days INTEGER DEFAULT 0, -- Interval that was scheduled
    learning_steps INTEGER DEFAULT 0, -- Progress through learning steps
    reps INTEGER DEFAULT 0, -- Total number of reviews
    lapses INTEGER DEFAULT 0, -- Number of times forgotten
    last_review TIMESTAMP, -- When last reviewed
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

-- Review history: Snapshots of review state BEFORE each review
-- Used for two purposes:
-- 1. Undo functionality - restore previous state if user made a mistake
-- 2. Streak calculation - count consecutive days with reviews
CREATE TABLE IF NOT EXISTS review_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    -- Snapshot of FSRS state BEFORE the review was submitted
    state INTEGER NOT NULL,
    due TIMESTAMP NOT NULL,
    stability REAL NOT NULL,
    difficulty REAL NOT NULL,
    elapsed_days INTEGER NOT NULL,
    scheduled_days INTEGER NOT NULL,
    learning_steps INTEGER NOT NULL,
    reps INTEGER NOT NULL,
    lapses INTEGER NOT NULL,
    last_review TIMESTAMP,
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- When review was submitted
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cards_user ON cards(user_id);
CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_due ON reviews(due);
CREATE INDEX IF NOT EXISTS idx_review_history_card_user ON review_history(card_id, user_id);
CREATE INDEX IF NOT EXISTS idx_review_history_created ON review_history(created_at);

-- FTS5 (Full-Text Search) virtual table for fast text search
-- This creates an inverted index on the instructions column for search queries
-- See: https://www.sqlite.org/fts5.html
-- Virtual tables don't store data directly - they're a view over the cards table
CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
    instructions, -- Full-text indexed column (searchable)
    user_id UNINDEXED, -- Included but not searchable (used for filtering)
    content='cards', -- Source table
    content_rowid='id' -- Map to cards.id
);

-- Triggers to keep FTS index in sync with cards table
-- IMPORTANT: If you modify the cards table schema, update these triggers!
-- The FTS virtual table must always mirror the cards table

-- Trigger: After INSERT on cards, add to FTS index
CREATE TRIGGER IF NOT EXISTS cards_ai AFTER INSERT ON cards BEGIN
    INSERT INTO cards_fts(rowid, instructions, user_id)
    VALUES (new.id, new.instructions, new.user_id);
END;

-- Trigger: After DELETE on cards, remove from FTS index
CREATE TRIGGER IF NOT EXISTS cards_ad AFTER DELETE ON cards BEGIN
    DELETE FROM cards_fts WHERE rowid = old.id;
END;

-- Trigger: After UPDATE on cards, update FTS index
CREATE TRIGGER IF NOT EXISTS cards_au AFTER UPDATE ON cards BEGIN
    UPDATE cards_fts
    SET instructions = new.instructions, user_id = new.user_id
    WHERE rowid = new.id;
END;
