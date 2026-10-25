CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  input_text TEXT NOT NULL,
  definition TEXT NOT NULL,
  media_id TEXT NOT NULL,
  sentence_id TEXT NOT NULL,
  start_index INTEGER NOT NULL,
  end_index INTEGER NOT NULL,
  CHECK (length(input_text) > 0),
  CHECK (length(definition) > 0),
  CHECK (length(media_id) > 0),
  CHECK (length(sentence_id) > 0),
  CHECK (start_index >= 0),
  CHECK (end_index >= start_index)
) STRICT;

CREATE INDEX idx_entries_input_text ON entries (input_text);
CREATE INDEX idx_entries_media_id ON entries (media_id);
CREATE INDEX idx_entries_sentence_id ON entries (sentence_id);
