---
name: Message media sentence ids
overview: Add nullable integer media_id and sentence_id on messages. Author or owner sets them on create or PUT; GET /messages can filter by media_id, sentence_id, and author_id.
todos:
  - id: migration
    content: Add migrations/0020_add_message_media_ids.sql and apply it locally.
    status: completed
  - id: api
    content: Accept, store, return, and filter media_id, sentence_id, and author_id in src/chat.ts.
    status: completed
  - id: readme
    content: Document media_id, sentence_id, and author_id filter in README.md section 22.
    status: completed
  - id: verify
    content: Curl create, media/author filters, clear one on PUT, and rejected PATCH.
    status: completed
isProject: false
---

# Message media_id and sentence_id

## Schema

New migration [migrations/0020_add_message_media_ids.sql](migrations/0020_add_message_media_ids.sql), applied locally only:

```sql
ALTER TABLE messages ADD COLUMN media_id INTEGER CHECK (media_id IS NULL OR media_id >= 0);
ALTER TABLE messages ADD COLUMN sentence_id INTEGER CHECK (sentence_id IS NULL OR sentence_id >= 0);
```

Existing rows stay `null` for both. No foreign key to entries (entries use text ids).

## API

In [src/chat.ts](src/chat.ts), every message response includes `media_id: number | null` and `sentence_id: number | null`.

On `POST /messages` and `PUT /messages/:id` (author or owner, same as body):

- Each field is an optional integer ≥ 0, or `null`.
- Omit on create → that field is `null`.
- Omit on PUT → keep the current value.
- Send `null` to clear.
- Either field may be set alone.
- `PATCH /messages/:id` rejects `media_id` and `sentence_id` with the same 400 used for `body` / `secret` / `links` / `tags`.

### List filter

`user_id` stays the viewer. Add optional query filters:

```http
GET /messages?user_id=<viewer>&author_id=user_author&media_id=888&sentence_id=1
```

- `author_id` → only messages whose `user_id` (author) equals that id. Must be a valid chat user id (`user_…`). The author user does not have to exist; an unknown id simply returns `[]`.
- `media_id` / `sentence_id` → integers ≥ 0; match that column. Either alone or both (AND).
- Any combination of the three filters is AND with the existing visibility rules (`secret`, `allowed_roles`, `pinned`, `tags`, `limit`, `offset`).
- Omit a filter → do not constrain that field.
- Invalid `author_id` / `media_id` / `sentence_id` → 400.

Document create/edit and the query filters in section 22 of [README.md](README.md).

## Check

With `bun run dev`, create one message as `user_author` with `media_id: 888` and `sentence_id: 1`, and one as another user with the same media/sentence. As a viewer:

- `GET /messages?user_id=<viewer>&media_id=888&sentence_id=1` returns both (if visible).
- `GET /messages?user_id=<viewer>&author_id=user_author&media_id=888` returns only the author message.
- `GET /messages?user_id=<viewer>&media_id=999` returns `[]`.

PUT with only `"media_id": null` clears media and leaves `sentence_id` `1`. PATCH that includes `media_id` returns 400. Delete test rows; leave the existing owner user. Stop the dev server. Do not apply the migration remotely.
