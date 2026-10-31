---
name: Message links column
overview: Add a links JSON column on messages so each message can store a list of id, text, url, and note. Replies stay unchanged.
todos: []
isProject: false
---

# Message links

Add one column on `messages`. Each value is a JSON array of `{ "id": number, "text": string, "url": string, "note": string }`, stored the same way `entries.usage` is stored. Replies do not get this column.

## Column

New file [migrations/0014_add_message_links.sql](migrations/0014_add_message_links.sql). Leave earlier migrations unchanged.

```sql
ALTER TABLE messages ADD COLUMN links TEXT NOT NULL DEFAULT '[]';
```

Existing messages become an empty list. Apply it locally with `npx wrangler d1 migrations apply commonvocab --local`. Remote apply stays a separate confirmed step.

## API

In [src/chat.ts](src/chat.ts), include `links` in the message `SELECT`, `INSERT`, and `UPDATE`. Responses parse the stored text and return a JSON array. `presentMessage` must not return the raw string.

`links` is optional on create and edit, same rule as `secret`:

- Omitted on create stores `[]`.
- Omitted on edit leaves the stored list.
- When present, it replaces the whole list.

Validation, or 400:

- `links` must be an array of at most 20 objects.
- `id` is an integer greater than or equal to 0, and ids in one list are unique.
- `text` is a non-empty string of at most 200 characters.
- `url` is a non-empty string of at most 2000 characters and starts with `http://` or `https://`.
- `note` is a string of at most 500 characters and may be empty.

Create and edit still send `user_id` and `body`. A message with two links looks like:

```json
{
  "user_id": "user_author",
  "body": "See these",
  "links": [
    { "id": 1, "text": "Docs", "url": "https://example.com/docs", "note": "" },
    {
      "id": 2,
      "text": "Demo",
      "url": "https://example.com/demo",
      "note": "short clip"
    }
  ]
}
```

Secret visibility is unchanged. A caller who cannot see the message still gets 404 and does not receive its links.

Add the field to the chat section of [README.md](README.md).

## Check

With `bun run dev`, create a message with two links and read it back as an array. Edit the body without `links` and confirm the list stays. Send a `url` that does not start with `http://` or `https://` and confirm 400. Confirm an older message returns `"links": []`.
