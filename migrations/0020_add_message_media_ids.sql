ALTER TABLE messages ADD COLUMN media_id INTEGER CHECK (media_id IS NULL OR media_id >= 0);
ALTER TABLE messages ADD COLUMN sentence_id INTEGER CHECK (sentence_id IS NULL OR sentence_id >= 0);
