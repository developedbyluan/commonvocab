ALTER TABLE messages
ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0
CHECK (pinned IN (0, 1));

ALTER TABLE messages
ADD COLUMN pin_rank INTEGER
CHECK (pin_rank IS NULL OR pin_rank >= 1);
