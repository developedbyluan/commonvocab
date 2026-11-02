---
name: Message allowed roles
overview: Add a required role on users and an owner-managed allowed_roles list on messages. GET /messages and related reads only return a message when the viewer is the chat owner or their stored role is in that list.
todos:
  - id: migration
    content: Add migrations/0017_add_message_roles.sql and apply it locally.
    status: completed
  - id: api
    content: Add user role, message allowed_roles, and role visibility in src/chat.ts.
    status: completed
  - id: readme
    content: Document role and allowed_roles in README.md section 22.
    status: completed
  - id: verify
    content: Curl premium visibility, empty list, owner bypass, and forbidden role edit.
    status: completed
isProject: false
---

# Message allowed roles

## Schema

New migration [migrations/0017_add_message_roles.sql](migrations/0017_add_message_roles.sql), applied locally only:

```sql
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'standard'
  CHECK (role IN ('standard', 'premium', 'vip', 'vvip'));

ALTER TABLE messages ADD COLUMN allowed_roles TEXT NOT NULL DEFAULT '["standard"]';
```

Existing local users become `standard`. Existing messages become `["standard"]`. Replies stay unchanged.

## User role

In [src/chat.ts](src/chat.ts):

- Every user response includes `role`.
- `POST /users` requires `{ id, display_name, role }`. `role` must be one of the four values. Any Basic-auth caller can still create a user, same as today.
- `PUT /users/:id` may send `role`. Only the chat owner can change it; a non-owner who sends a different role gets 403. Omit `role` and the stored role stays. Display name edits stay author-or-owner.

## Message allowed_roles

Reuse the entries rules: a JSON array of `standard`, `premium`, `vip`, `vvip`; duplicates rejected; `[]` is valid.

- Only the chat owner may set or change `allowed_roles`, same gate as pin (`decidePin`-style helper).
- Omit on create stores `["standard"]`.
- The chat owner may set roles on create:

```http
POST /messages
{ "user_id": "<CHAT_OWNER_USER_ID>", "body": "Hello", "allowed_roles": ["standard", "premium"] }
```

- Authors send `user_id` and `body` only. A non-owner who sends `allowed_roles` other than the default gets 403 and the message is not created.
- After create, the primary way the owner changes roles without rewriting the text is the pin patch route, extended for roles:

```http
PATCH /messages/:id
{ "user_id": "<CHAT_OWNER_USER_ID>", "allowed_roles": ["standard", "premium"] }
```

- `PATCH` may send `allowed_roles` alone or with `pinned` / `pin_rank`. At least one of those three is required. `body`, `secret`, `links`, and `tags` stay rejected. Text stays as stored.
- `PUT /messages/:id` may still include `allowed_roles` when the owner is rewriting the message. Omit it and the current list stays. A non-owner who sends a different list gets 403 and nothing is written.
- Every message response includes `allowed_roles` as a parsed array.

## Visibility

Chat owner always sees every message they already could see under the secret rules. Authors do not bypass roles.

For a non-owner viewer, a message is visible only when their stored `role` appears in `allowed_roles`. An empty list means only the chat owner. Apply that check together with the existing secret check on:

- `GET /messages` (including `pinned=true` and `tags=`)
- `GET /messages/:id`
- reply and like routes that require seeing the parent message

A hidden message stays 404 `message not found` on direct fetch, the same as an unseen secret message.

Document the user `role`, message `allowed_roles`, and the visibility rule in section 22 of [README.md](README.md).

## Check

With `bun run dev`, create a `standard` author and a `premium` author. Author creates a message (defaults to `["standard"]`). Owner patches it to `["premium"]`. Premium `GET /messages` includes it; standard gets it omitted or 404 on direct fetch. Owner still sees it. Owner patches `[]` and only the owner can see it. Non-owner PATCH that changes `allowed_roles` returns 403. Delete test rows; leave the existing owner user. Stop the dev server. Do not apply the migration remotely.
