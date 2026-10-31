---
name: Pin messages flag
overview: Add a pinned flag and a pin_rank on messages. Only the chat owner can set them. Rank 1 is the most important. The message list stays newest first.
todos: []
isProject: false
---

# Pin messages

Add `pinned` and `pin_rank` on `messages`. The list stays `ORDER BY m.id DESC`. The client sorts pinned messages by `pin_rank` ascending, so `1` is more important than `2`. Only the user whose id equals `CHAT_OWNER_USER_ID` can change either field.

## Columns

New file [migrations/0015_add_pinned.sql](migrations/0015_add_pinned.sql). Leave earlier migrations unchanged.

```sql
ALTER TABLE messages
ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0
CHECK (pinned IN (0, 1));

ALTER TABLE messages
ADD COLUMN pin_rank INTEGER
CHECK (pin_rank IS NULL OR pin_rank >= 1);
```

Existing messages stay unpinned, with `pin_rank` null. Apply it locally with `npx wrangler d1 migrations apply commonvocab --local`. Remote apply stays a separate confirmed step.

## API

In [src/chat.ts](src/chat.ts), include both columns in the message `SELECT`, `INSERT`, and `UPDATE`. Responses return `pinned` as `true` or `false`, and `pin_rank` as a number or `null`.

`pinned` is an optional boolean. `pin_rank` is an optional integer greater than or equal to 1.

- Omitted on create stores `pinned: false` and `pin_rank: null`.
- Omitted on edit leaves the stored values, so an author can edit `body` or `links` without changing the pin.
- A non-boolean `pinned` is 400 `{ "error": "pinned must be a boolean" }`. A `pin_rank` that is not an integer greater than or equal to 1 is 400 `{ "error": "pin_rank must be an integer greater than or equal to 1" }`.
- `pinned: true` requires a `pin_rank`. On create, or when changing an unpinned message to pinned, a missing `pin_rank` is 400 `{ "error": "pin_rank is required when pinned is true" }`. On edit of a message that is already pinned, omitting `pin_rank` keeps the current rank.
- Setting `pinned` to `false` stores `pin_rank` as `null`.
- Sending `pinned: true` on create, or sending `pinned` or `pin_rank` on edit that differs from the stored values, is allowed only when `user_id` equals `CHAT_OWNER_USER_ID`. Otherwise the request is 403 `{ "error": "forbidden" }` and nothing is written.

Two pinned messages may share a rank. The client treats the lower number as more important and can break a tie by message id.

Secret visibility is unchanged. Someone who cannot see a message still gets 404 and does not learn that it is pinned.

Add both fields to the chat section of [README.md](README.md).

## Check

With `bun run dev`, have the owner create or edit two messages with `"pinned": true` and `"pin_rank": 1` and `"pin_rank": 2`. Confirm both responses. Have the author edit a body without those fields and confirm the rank stays. Have the author send `"pin_rank": 1` and confirm 403. Confirm `GET /messages` is still newest first, with both ranks present for the client to sort.
