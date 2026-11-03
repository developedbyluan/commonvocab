ALTER TABLE messages
ADD COLUMN status_code INTEGER
CHECK (status_code IS NULL OR (status_code >= 0 AND status_code <= 9));
