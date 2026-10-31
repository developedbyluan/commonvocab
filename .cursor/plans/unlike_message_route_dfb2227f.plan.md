---
name: Unlike message route
overview: Add a delete route that removes one user’s like from a message, using the same actor rules as deleting a reply. No database migration.
todos:
  - id: delete-like
    content: Add DELETE /messages/:id/likes/:userId in src/chat.ts using the reply-delete checks.
    status: completed
  - id: readme
    content: Document the unlike URL in the chat section of README.md.
    status: completed
  - id: verify
    content: Curl self-delete, a second like, a forbidden delete, and an owner delete.
    status: completed
isProject: false
---

# Remove a like

No new table and no change to [migrations/0012_create_chat.sql](migrations/0012_create_chat.sql). A like is already one row in `likes`, keyed by `(message_id, user_id)`.

Add `DELETE /messages/:id/likes/:userId` in [src/chat.ts](src/chat.ts), beside the existing `POST` and `GET` handlers for `/:id/likes`. The path `:id` is the message. The path `:userId` is the person whose like is removed. The query `user_id` is who is asking, same as [the reply delete handler](src/chat.ts) around line 501.

Checks, in that order:

- `:id` must be a positive integer, and `:userId` and `user_id` must start with `user_`. Otherwise 400.
- The acting user must already exist. Otherwise 400 `{ "error": "user not found" }`.
- The message must exist. Otherwise 404 `{ "error": "message not found" }`.
- That user must have a like on that message. Otherwise 404 `{ "error": "like not found" }`.
- `canMutate` must allow it: the actor is the person who liked it, or the actor equals `CHAT_OWNER_USER_ID`. Otherwise 403 `{ "error": "forbidden" }`.

Then `DELETE FROM likes WHERE message_id = ? AND user_id = ?`. A success returns 200 and the removed like (`message_id`, `user_id`, `display_name`, `created_at`). The message, its replies, and other likes stay. `like_count` on the next read is one lower. The same user can `POST /messages/:id/likes` again after this.

Example, for message `1` and liker `user_alice`:

- `DELETE /messages/1/likes/user_alice?user_id=user_alice` removes Alice’s own like.
- `DELETE /messages/1/likes/user_alice?user_id=<CHAT_OWNER_USER_ID>` removes it as the owner.

Basic auth and `CHAT_LIMITER` already wrap every route on the messages router.

Add one sentence to the chat section of [README.md](README.md) so it shows this URL. Verify locally with `bun run dev`: create a like, delete it as the liker, confirm a second like returns 201, confirm another user gets 403, and confirm the owner can delete the remaining like.
