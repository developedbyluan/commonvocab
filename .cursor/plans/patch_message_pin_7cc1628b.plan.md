---
name: Patch message pin
overview: Add PATCH /messages/:id so the chat owner can change pinned and pin_rank without sending or replacing the message text. PUT still edits the text.
todos: []
isProject: false
---

# Patch a message pin

No database change. [src/chat.ts](src/chat.ts) already stores `pinned` and `pin_rank` and decides who may change them in `decidePin`.

Add `PATCH /messages/:id` beside the existing `PUT /messages/:id`. The patch body accepts only `user_id`, `pinned`, and `pin_rank`. At least one of `pinned` or `pin_rank` is required. `body`, `secret`, or `links` in the patch is 400, so a client cannot think those fields were updated.

The handler loads the message, then:

- The acting user must already exist, or the response is 400 `{ "error": "user not found" }`.
- A missing message, or a secret message the actor cannot see, is 404 `{ "error": "message not found" }`.
- `decidePin` applies the current rules. `pinned: true` still needs a `pin_rank` when the message is not already pinned. `pinned: false` clears `pin_rank`. A non-owner who sends a different `pinned` or `pin_rank` gets 403 `{ "error": "forbidden" }` and nothing is written.

The update sets only `pinned`, `pin_rank`, and `updated_at`. `body`, `secret`, and `links` stay as stored. The response is the same message object `PUT` returns.

`PUT /messages/:id` stays the text edit. It still requires `body` and can still include pin fields when the owner is rewriting the message.

Add the patch URL to the chat section of [README.md](README.md).

## Check

With `bun run dev`, create a message as an author, then as the chat owner:

```json
PATCH /messages/:id
{ "user_id": "<CHAT_OWNER_USER_ID>", "pinned": true, "pin_rank": 1 }
```

Confirm the text is unchanged and the response has `"pinned": true` and `"pin_rank": 1`. Send the same patch with a different `pin_rank` as the author and confirm 403 and the stored rank is unchanged. Send `body` in the patch and confirm 400.
