-- One row per phone. The Practice Offline app registers its Expo push token here so the
-- worker can announce newly pinned messages. `provider` leaves room for raw APNs/FCM tokens
-- from a future native app.
CREATE TABLE push_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'expo',
  platform TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CHECK (length(token) > 0 AND length(token) <= 512),
  CHECK (provider IN ('expo', 'apns', 'fcm')),
  CHECK (platform IN ('android', 'ios')),
  CHECK (created_at >= 0),
  CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX idx_push_tokens_user_id ON push_tokens (user_id);
