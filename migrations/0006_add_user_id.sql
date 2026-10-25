ALTER TABLE entries
ADD COLUMN user_id TEXT NOT NULL DEFAULT 'user_'
CHECK (substr(user_id, 1, 5) = 'user_');
