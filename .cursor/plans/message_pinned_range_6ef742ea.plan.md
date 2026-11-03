---
name: Message pinned range
overview: Add an owner-managed pinned_range object on messages with unix-second start and end. It is independent of pinned and pin_rank, and can be set on create, PUT, or PATCH.
todos:
  - id: migration
    content: Add migrations/0018_add_pinned_range.sql and apply it locally.
    status: completed
  - id: api
    content: Accept, store, and return pinned_range in src/chat.ts.
    status: completed
  - id: readme
    content: Document pinned_range in README.md section 22.
    status: completed
  - id: verify
    content: Curl owner set, clear, and forbidden author change.
    status: completed
isProject: false
---

# Message pinned range

## Schema

New migration [migrations/0018_add_pinned_range.sql](migrations/0018_add_pinned_range.sql), applied locally only:

```sql
ALTER TABLE messages ADD COLUMN pinned_range TEXT;
```

`NULL` means no range. A stored value is JSON `{"start":1793685135,"end":1793685200}`. Existing rows stay `null`.

## API

In [src/chat.ts](src/chat.ts), every message response includes `pinned_range: { start, end } | null`.

Validation: both `start` and `end` are integers ≥ 0 (unix seconds for the client). Require `start <= end`. Reject a partial object.

Owner-only, same gate as pin (`decidePin`-style helper):

- Omit on create → `null`.
- Omit on PUT → keep the current value.
- Send `{ start, end }` to set or replace.
- Send `null` to clear.
- A non-owner who sends a different value gets 403 and nothing is written.

Extend `PATCH /messages/:id` so the body may include `pinned_range` alone or with `pinned` / `pin_rank` / `allowed_roles`. At least one of those fields is required. Unpinning does not clear `pinned_range`.

Document the field in section 22 of [README.md](README.md).

## Check

With `bun run dev`, create a message as an author. As the chat owner:

```json
PATCH /messages/:id
{ "user_id": "<CHAT_OWNER_USER_ID>", "pinned_range": { "start": 1793685135, "end": 1793685200 } }
```

Confirm the response has that object and the text is unchanged. Author PATCH with a different range returns 403. Owner sends `"pinned_range": null` and the field is null. Delete test rows; leave the existing owner user. Stop the dev server. Do not apply the migration remotely.
