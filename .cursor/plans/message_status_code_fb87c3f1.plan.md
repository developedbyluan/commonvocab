---
name: Message status code
overview: Add an owner-managed nullable status_code integer (0–9) on messages. Default is null; omit on edit keeps the current value; PATCH can set or clear it without rewriting the text.
todos:
  - id: migration
    content: Add migrations/0019_add_status_code.sql and apply it locally.
    status: completed
  - id: api
    content: Accept, store, and return status_code in src/chat.ts.
    status: completed
  - id: readme
    content: Document status_code in README.md section 22.
    status: completed
  - id: verify
    content: Curl owner set, clear, forbidden author change, and rejected 10.
    status: completed
isProject: false
---

# Message status code

## Schema

New migration [migrations/0019_add_status_code.sql](migrations/0019_add_status_code.sql), applied locally only:

```sql
ALTER TABLE messages
ADD COLUMN status_code INTEGER
CHECK (status_code IS NULL OR (status_code >= 0 AND status_code <= 9));
```

Existing rows stay `null`.

## API

In [src/chat.ts](src/chat.ts), every message response includes `status_code: number | null`.

Owner-only, same gate as pin / `pinned_range`:

- Omit on create → `null`.
- Omit on PUT → keep the current value.
- Send an integer `0`–`9` to set or replace.
- Send `null` to clear.
- A non-owner who sends a different value gets 403 and nothing is written.

Extend `PATCH /messages/:id` so the body may include `status_code` alone or with `pinned` / `pin_rank` / `allowed_roles` / `pinned_range`. At least one of those fields is required. `body`, `secret`, `links`, and `tags` stay rejected.

Document the field in section 22 of [README.md](README.md).

## Check

With `bun run dev`, create a message as an author (response has `"status_code": null`). As the chat owner:

```json
PATCH /messages/:id
{ "user_id": "<CHAT_OWNER_USER_ID>", "status_code": 3 }
```

Confirm the text is unchanged and `"status_code": 3`. Author PATCH with `4` returns 403. Owner sends `"status_code": null` and the field is null. `status_code: 10` returns 400. Delete test rows; leave the existing owner user. Stop the dev server. Do not apply the migration remotely.
