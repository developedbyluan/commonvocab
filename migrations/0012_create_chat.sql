CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (length(id) >= 5 AND length(id) <= 64),
  CHECK (substr(id, 1, 5) = 'user_'),
  CHECK (length(display_name) > 0 AND length(display_name) <= 80),
  CHECK (created_at >= 0)
) STRICT;

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id),
  CHECK (length(body) > 0 AND length(body) <= 2000),
  CHECK (created_at >= 0),
  CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX idx_messages_user_id ON messages (user_id);

CREATE TABLE replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id),
  CHECK (length(body) > 0 AND length(body) <= 2000),
  CHECK (created_at >= 0),
  CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX idx_replies_message_id ON replies (message_id);

CREATE TABLE likes (
  message_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id),
  FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id),
  CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_likes_user_id ON likes (user_id);
