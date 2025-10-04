-- Spaced Repetition Database Schema with User Isolation

CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    instructions TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tags (
    card_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (card_id, tag),
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reviews (
    card_id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL,
    -- FSRS fields
    state INTEGER DEFAULT 0, -- 0=New, 1=Learning, 2=Review, 3=Relearning
    due TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    stability REAL DEFAULT 0,
    difficulty REAL DEFAULT 0,
    elapsed_days INTEGER DEFAULT 0,
    scheduled_days INTEGER DEFAULT 0,
    learning_steps INTEGER DEFAULT 0,
    reps INTEGER DEFAULT 0,
    lapses INTEGER DEFAULT 0,
    last_review TIMESTAMP,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cards_user ON cards(user_id);
CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_due ON reviews(due);

-- FTS5 for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
    instructions,
    user_id UNINDEXED,
    content='cards',
    content_rowid='id'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS cards_ai AFTER INSERT ON cards BEGIN
    INSERT INTO cards_fts(rowid, instructions, user_id)
    VALUES (new.id, new.instructions, new.user_id);
END;

CREATE TRIGGER IF NOT EXISTS cards_ad AFTER DELETE ON cards BEGIN
    DELETE FROM cards_fts WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS cards_au AFTER UPDATE ON cards BEGIN
    UPDATE cards_fts
    SET instructions = new.instructions, user_id = new.user_id
    WHERE rowid = new.id;
END;
