---
name: Filter messages by tags
overview: Add an owner-managed tag catalog and let a message carry tags from that catalog. GET /messages?tags=grammar,vocab returns visible messages that have any of those tags.
todos:
  - id: migration
    content: Add migrations/0016_add_tags.sql and apply it locally.
    status: completed
  - id: api
    content: Add the tag catalog and message tag filter in src/chat.ts and src/index.ts.
    status: completed
  - id: readme
    content: Document tags and GET /messages?tags= in README.md.
    status: completed
  - id: verify
    content: Curl catalog, any-match filter, unknown tag, and forbidden create.
    status: completed
isProject: false
---

# Filter messages by tags

No change to pin, secret, or links behavior. Replies stay untagged.

## Catalog

New migration [migrations/0016_add_tags.sql](migrations/0016_add_tags.sql), applied locally only:

- `tags`: integer id, unique `name` (`COLLATE NOCASE`), 1–40 characters, no commas.
- `message_tags`: `(message_id, tag_id)` primary key. Deleting a message or a catalog tag removes the join rows.

Routes on a new `tags` router in [src/chat.ts](src/chat.ts), mounted at `/tags` from [src/index.ts](src/index.ts), with the same Basic auth and `CHAT_LIMITER` as chat:

- `POST /tags` `{ user_id, name }` creates a tag. Chat owner only. Duplicate name is 409.
- `GET /tags?user_id=` lists the catalog. The viewer must already exist.
- `DELETE /tags/:id?user_id=` is owner only. Messages that used the tag lose it.
- Anyone else who tries to create or delete gets 403.

## On a message

`POST /messages` and `PUT /messages/:id` accept an optional `tags` array of names, at most 10, each of which must already be in the catalog. Matching is case-insensitive and the stored row uses the catalog id.

- Omit `tags` on create and the message has none.
- Omit `tags` on PUT and the current tags stay.
- Send `tags` and that list replaces the current set. An unknown name is 400 and nothing is written.
- The author or the chat owner may set them, because those are the people who can already edit the message.

`PATCH /messages/:id` also rejects `tags`, with the same 400 it already returns for `body`, `secret`, and `links`.

Every message response includes `tags` as `{ id, name }[]`, sorted by name. `presentMessage` reads them from a subquery on `MESSAGE_SELECT`, so list, get, create, and edit all return the same shape.

## Filter

`GET /messages` keeps newest-first paging. Add optional `tags`:

```http
GET /messages?user_id=<viewer>&limit=20&offset=0&tags=grammar,vocab
```

A message matches when it has any listed tag. The existing visibility rule still applies, so another person's secret message stays hidden. Omit `tags` and the list is unfiltered. An empty piece, more than 10 names, or a name that is not in the catalog is 400.

Document the catalog routes, the message `tags` field, and the query in section 22 of [README.md](README.md).

## Check

With `bun run dev`, as the chat owner create `grammar` and `vocab`. As an author, create one message with both and one with only `grammar`. `GET /messages?tags=grammar,vocab` returns both. `GET /messages?tags=grammar` returns only the grammar message. An unknown tag on create returns 400. A non-owner `POST /tags` returns 403. Delete the test messages, test user, and test tags. Leave the existing owner user. Stop the dev server. Do not apply the migration remotely.
