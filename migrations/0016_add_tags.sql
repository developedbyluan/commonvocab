CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  CHECK (length(name) >= 1 AND length(name) <= 40),
  CHECK (instr(name, ',') = 0)
) STRICT;

CREATE TABLE message_tags (
  message_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (message_id, tag_id),
  FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_message_tags_tag_id ON message_tags (tag_id);
