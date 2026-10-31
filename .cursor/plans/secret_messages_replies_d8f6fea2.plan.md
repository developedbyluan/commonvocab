---
name: Secret messages replies
overview: Add a secret flag to messages and replies. Secret messages are visible only to their author and the chat owner. Secret replies are visible only to the reply author, the parent message author, and the chat owner.
todos: []
isProject: false
---

# Secret messages and replies

Add `secret` to the existing chat tables. No new routes. Reads learn who is looking from a required `user_id` query parameter, the same id already sent on writes.

## Column

New file [migrations/0013_add_secret.sql](migrations/0013_add_secret.sql). Leave `0012` unchanged.

- `messages.secret INTEGER NOT NULL DEFAULT 0 CHECK (secret IN (0, 1))`
- `replies.secret INTEGER NOT NULL DEFAULT 0 CHECK (secret IN (0, 1))`

Existing rows stay public. Apply it locally with `npx wrangler d1 migrations apply commonvocab --local`. Remote apply stays a separate confirmed step.

## Who can see a row

In [src/chat.ts](src/chat.ts):

- A public message or reply is visible to every caller who passes Basic auth.
- A secret message is visible to its `user_id` and to `CHAT_OWNER_USER_ID`.
- A secret reply is visible to its author, the parent message’s author, and `CHAT_OWNER_USER_ID`.
- If the parent message is secret and the viewer cannot see that message, the reply list, likes, and a non-secret reply are hidden too. The author of a secret reply can still load that one reply with `GET /replies/:id`.

Hidden list rows are omitted. A direct fetch the viewer cannot see returns 404 (`message not found`, `reply not found`, or `like not found`) so the response does not confirm the row exists. `reply_count` counts only replies that viewer can see.

## Requests

`secret` is an optional boolean on create and edit. Omitted on create means public. Omitted on edit leaves the stored value. A non-boolean value is 400 `{ "error": "secret must be a boolean" }`. Responses return `secret` as `true` or `false`.

These reads require `?user_id=`. The user must already exist, or the response is 400 `{ "error": "user not found" }`.

- `GET /messages?user_id=`
- `GET /messages/:id?user_id=`
- `GET /messages/:id/replies?user_id=`
- `GET /messages/:id/likes?user_id=`
- `GET /replies/:id?user_id=`

Creating a reply, liking, and removing a like on a message the actor cannot see return 404. Edit and delete permissions stay as they are: the item’s author or the chat owner.

Add this query parameter and the `secret` field to the chat section of [README.md](README.md).

## Check

With `bun run dev`, create two users plus the owner. Post a secret message and a public message. The other user does not see the secret message in the list and gets 404 for its id. The author and the owner see it. Put a secret reply on the public message: the other user does not see that reply, while the message author, the reply author, and the owner do. Edit `secret` to `false` and confirm the other user can then see it. Confirm `reply_count` skips replies that viewer cannot see.
