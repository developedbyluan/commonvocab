---
name: Role gate redaction
overview: Public messages outside the viewer’s allowed_roles stay in GET /messages as redacted rows (preview body, partial links, null media/sentence ids). Detail, replies, and likes still require a matching role and otherwise 404.
todos:
  - id: access-helpers
    content: Split list vs full visibility; redact presentMessage for role-gated public rows.
    status: completed
  - id: list-sql
    content: Remove role filter from GET /messages SQL; apply redaction when mapping results.
    status: completed
  - id: readme
    content: Document redacted list vs locked detail/reply/like in README section 22.
    status: completed
  - id: verify
    content: Curl list redaction and detail/reply/like still blocked for wrong role.
    status: completed
isProject: false
---

# Role-gated public message redaction

## Behavior

Secret messages are unchanged: only author and owner see them; everyone else never gets the row.

Public messages change only for viewers whose `users.role` is **not** in `allowed_roles` (and who are not the chat owner):

| Endpoint                                                              | Behavior                                            |
| --------------------------------------------------------------------- | --------------------------------------------------- |
| `GET /messages`                                                       | Row is included, **redacted**                       |
| `GET /messages/:id`, `.../replies`, `.../likes`, reply/like mutations | Still require full access → `404` / existing forbid |

Owner always gets the full message. Authors still do **not** bypass `allowed_roles` on public messages (same as today).

### Redacted list payload

Compared to a full `presentMessage`:

- `body`: if length &gt; 40, `body.slice(0, 40) + "…"`; otherwise the full body (no ellipsis when already ≤ 40).
- `links`: each item is `{ id, text }` only (`url` and `note` dropped).
- `media_id` / `sentence_id`: always `null`.
- All other fields stay as today (`id`, author, tags, pin fields, `allowed_roles`, counts, timestamps, etc.).

No new response flag; clients can treat a truncated body / thin links / null media as locked, or compare `allowed_roles` to the viewer role.

## Code ([src/chat.ts](src/chat.ts))

1. Split access helpers:
   - Keep `canSeeMessage` / `canSeeMessageRow` for **full** access (detail, replies, likes, mutations).
   - Add something like `canListMessage` that allows any non-secret message (plus secret for author/owner). Role is **not** required to list.

2. Change `GET /messages` SQL: drop the `json_each(m.allowed_roles)` role filter so public role-gated rows are selected. Keep the secret visibility clause. After fetch, map with `presentMessage(row, { full: canSeeMessageRow(...) })` (or equivalent) so role-mismatched viewers get the redacted shape.

3. Leave `GET /messages/:id`, reply/like routes on the existing full-access checks.

4. Document in [README.md](README.md) section 22: list returns redacted public messages; detail/reply/like still need a matching role.

## Check

Locally: create a public message with `allowed_roles: ["vip"]` and body longer than 40 chars plus a link. As a `standard` viewer:

- `GET /messages` includes the row with truncated body, link `{ id, text }` only, `media_id`/`sentence_id` null.
- `GET /messages/:id`, reply, and like return 404 / not allowed.

As owner or a `vip` viewer: full body, full links, real media/sentence ids. Delete test rows afterward.
