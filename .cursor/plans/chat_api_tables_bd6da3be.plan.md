---
name: Chat API tables
overview: Add users, messages, replies, and likes tables to the existing commonvocab D1 database, and expose Basic-auth Worker routes a separate Next.js app can call. Likes can be created and read once per user, and cannot be changed or removed.
todos:
  - id: migration
    content: Add migrations/0012_create_chat.sql and apply it to the local commonvocab database.
    status: completed
  - id: routes
    content: Add src/chat.ts with Basic auth, users, messages, replies, and one-time likes, and mount it from src/index.ts.
    status: completed
  - id: bindings
    content: Add CHAT_LIMITER and document CHAT_OWNER_USER_ID, then regenerate Worker types.
    status: completed
  - id: verify
    content: Curl the chat flow and confirm /entries is unchanged.
    status: completed
isProject: false
---

# Chat API on the existing D1 database

No new D1 database and no Next.js UI. New tables go in the current `commonvocab` database. A separate Next.js app calls the Worker with the same HTTP Basic credentials already used by `POST /entries/lookup` in [src/entries.ts](src/entries.ts).

Basic auth is the shared gate. The acting person is the `user_id` in the JSON body (it must start with `user_`, same rule as entries). Edit and delete succeed only when that id is the row’s author or equals the `CHAT_OWNER_USER_ID` secret.

## Tables

One new file, [migrations/0012_create_chat.sql](migrations/0012_create_chat.sql). Leave `0001` through `0011` unchanged.

- `users`: `id` TEXT primary key (`user_…`), `display_name` TEXT, `created_at` INTEGER.
- `messages`: `id` INTEGER primary key, `user_id` references `users`, `body` TEXT, `created_at` INTEGER, `updated_at` INTEGER.
- `replies`: `id` INTEGER primary key, `message_id` references `messages` with `ON DELETE CASCADE`, `user_id` references `users`, `body` TEXT, `created_at` INTEGER, `updated_at` INTEGER.
- `likes`: primary key `(message_id, user_id)`, `message_id` references `messages` with `ON DELETE CASCADE`, `user_id` references `users`, `created_at` INTEGER. Likes attach to top-level messages only.

Indexes on `messages(user_id)`, `replies(message_id)`, and `likes(user_id)`.

Apply locally with `npx wrangler d1 migrations apply commonvocab --local`. Remote apply stays a separate confirmed step (`--remote`) because it changes the deployed database.

## Routes

New router in [src/chat.ts](src/chat.ts), mounted from [src/index.ts](src/index.ts). Every chat route requires Basic auth (`realm="chat"`) via the same compare-in-constant-time check as `basicAuthMatches`. A missing or wrong `CHAT_OWNER_USER_ID` means there is no owner; authors can still edit their own rows.

- `POST /users` `{ id, display_name }` creates a user. `GET /users` and `GET /users/:id` read them. `PUT /users/:id` `{ user_id, display_name }` and `DELETE /users/:id` with query `user_id` are limited to that user or the owner. Delete returns 409 when the user still has messages, replies, or likes.
- `POST /messages` `{ user_id, body }` sends a message. The user must already exist. `GET /messages` lists newest first with `limit` and `offset` (same bounds as entries: default 50, max 100). Each row includes `display_name`, `reply_count`, and `like_count`. `GET /messages/:id` returns that message plus its replies. `PUT /messages/:id` `{ user_id, body }` and `DELETE /messages/:id?user_id=` are author or owner. Deleting a message removes its replies and likes.
- `POST /messages/:id/replies` `{ user_id, body }`, `GET /messages/:id/replies`, `GET /replies/:id`, `PUT /replies/:id` `{ user_id, body }`, `DELETE /replies/:id?user_id=`. Same author-or-owner rule. A reply to a missing message is 404.
- `POST /messages/:id/likes` `{ user_id }` inserts one like. A second like from the same user is 409. `GET /messages/:id/likes` lists who liked it. There is no update or delete for likes.

Empty text, an unknown user, and a `user_id` that does not start with `user_` return 400. Unauthorized edit or delete returns 403. Bodies are capped at 2000 characters and display names at 80.

Add a `CHAT_LIMITER` rate limit in [wrangler.jsonc](wrangler.jsonc) (30 requests per 60 seconds per IP, namespace `1003`) and run `npm run cf-typegen` so the binding is typed. Store `CHAT_OWNER_USER_ID` in `.dev.vars` for local dev and set the remote value with `npx wrangler secret put CHAT_OWNER_USER_ID`. Do not put that id in `wrangler.jsonc`. The owner user row still has to be created with `POST /users` before owner actions work.

## Check

With `bun run dev`, curl the flow: create two users (one matching `CHAT_OWNER_USER_ID`), post a message, reply as the other user, like once, confirm the second like is 409, edit as the author, edit as the owner, and reject an edit from someone else. Confirm `/entries` still responds without the chat Basic auth header.
