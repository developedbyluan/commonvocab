---
name: Pinned message filter
overview: Add an optional pinned=true filter to GET /messages so the client can load pinned messages in pin_rank order without paging through the newest-first feed.
todos:
  - id: api
    content: Accept pinned=true on GET /messages and order those rows by pin_rank.
    status: completed
  - id: readme
    content: Document the pinned query in README.md section 22.
    status: completed
  - id: verify
    content: Curl pinned order, the unfiltered list, and a rejected pinned=false.
    status: completed
isProject: false
---

# Pinned message filter

No new route and no database change. [src/chat.ts](src/chat.ts) already stores `pinned` and `pin_rank`. `GET /messages` currently always ends with `ORDER BY m.id DESC`.

Accept an optional query `pinned=true` on that same list. Omit it and the list stays newest first, including the existing `tags`, `limit`, and `offset` behavior. Any other value, including `pinned=false`, is 400.

`<viewer>` is the `user_id` query parameter: any user who already exists. A normal user does not need to be `CHAT_OWNER_USER_ID`. The owner id is only required to pin or unpin. Seeing a pin uses the same rule as the rest of the list: a public pinned message is visible to every viewer, and a secret pinned message is visible to its author and the chat owner.

When `pinned=true`:

- Add `AND m.pinned = 1` to the existing visibility filter, so another person's secret message stays hidden.
- If `tags` is also present, a row must be pinned and have any of those tags.
- Order by `m.pin_rank ASC, m.id DESC`, so rank 1 comes before rank 2 and ties stay newest first.
- Keep `limit` and `offset`.

Update the pin paragraph in section 22 of [README.md](README.md) with:

```http
GET /messages?user_id=<viewer>&pinned=true
```

## Check

With `bun run dev`, create two messages as an author. As the chat owner, pin them at ranks 2 and 1. `GET /messages?user_id=<viewer>&pinned=true` returns those two rows with rank 1 first, and leaves an unpinned message out. The same list without `pinned` stays newest first. `pinned=false` returns 400. Delete the test messages and test user. Leave the existing owner user. Stop the dev server.
