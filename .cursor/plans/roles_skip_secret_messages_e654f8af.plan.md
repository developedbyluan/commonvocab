---
name: Roles skip secret messages
overview: Apply allowed_roles only to public messages. Secret messages keep author-or-owner visibility and ignore the viewer’s role.
todos:
  - id: api
    content: Skip allowed_roles for secret messages in canSeeMessage and GET /messages.
    status: completed
  - id: readme
    content: Document that roles apply only when secret is false.
    status: completed
  - id: verify
    content: Curl secret bypasses roles and public still filters by role.
    status: completed
isProject: false
---

# Roles skip secret messages

No database change. [src/chat.ts](src/chat.ts) already stores `secret` and `allowed_roles`.

## Visibility

Update `canSeeMessage` so:

- `secret = 1`: visible only to the message author or the chat owner. Do not check `allowed_roles`.
- `secret = 0`: chat owner always sees it; everyone else needs their stored `role` in `allowed_roles` (unchanged). `[]` still means only the owner for public messages.

`canSeeMessageRow` and parent-message checks on replies/likes keep calling this helper, so they pick up the new rule automatically.

## List query

In `GET /messages`, change the role filter so it runs only for public rows:

```sql
WHERE (m.secret = 0 OR m.user_id = ?1 OR ?1 = ?2)
  AND (
    m.secret = 1
    OR ?1 = ?2
    OR EXISTS (
      SELECT 1 FROM json_each(m.allowed_roles) WHERE value = ?3
    )
  )
```

A secret message the viewer authored still appears even when their role is not in `allowed_roles`. A public message still requires a matching role (or owner).

Update the `allowed_roles` paragraph in section 22 of [README.md](README.md) to say the role gate applies only when `secret` is false.

## Check

With `bun run dev`, as a `standard` author create a public message and a secret message. Owner patches both to `allowed_roles: ["premium"]`. Standard `GET /messages` includes the secret message and omits the public one. Premium sees the public one. Owner sees both. Delete test rows; leave the existing owner user. Stop the dev server.
