---
name: Lookup saves placeholder
overview: When GET /entries/lookup does not find a finished entry, insert one pending placeholder and keep returning 404 on later requests while that status stays pending.
todos:
  - id: query-user-id
    content: Require user_id on GET /entries/lookup and validate the user_ prefix.
    status: completed
  - id: insert-placeholder
    content: On a span miss, insert a placeholder with known fields and blank definition, part_of_speech, pending status, and empty usage.
    status: completed
  - id: response-rules
    content: Return 404 while the span's row is missing or still pending, 400 when the stored text differs, and 200 only after status is no longer pending.
    status: completed
isProject: false
---

# Save a placeholder on lookup miss

Only [src/entries.ts](src/entries.ts) changes. `GET /entries/lookup` keeps its current success response. A miss inserts one row and still returns `{ "error": "entry not found" }` with status 404.

## Request

`user_id` becomes a required query parameter, checked with the same rule as create: trimmed, non-empty, and starting with `user_`. The other required parameters stay `input_text`, `media_id`, `sentence_id`, `start_index`, and `end_index`.

## What gets stored

The lookup already knows the span and the text. The insert uses those values plus `user_id`. The columns the user did not send are blank:

- `definition`: `{"vietnamese":"","english":""}`
- `part_of_speech`: `""`
- `status`: `pending`
- `usage`: `[]`

`pending` is the stored status because the database only allows `pending`, `aigenerated`, `editorpicked`, and `approved`. An empty status would be rejected.

## When the same or another user requests again

`status` is the check. The placeholder insert stores `pending`, so a later lookup uses that value instead of looking at the blank definition or `part_of_speech`.

After the span query in `entries.get("/lookup")`:

- No row: insert one placeholder, then return 404.
- A row exists for that span, the text matches, and `status` is `pending`: return 404. This is the same user or a different user. Do not insert another row, and do not replace the first `user_id`.
- A row exists for that span and its text does not match: keep the current 400, `input text does not match`. Do not insert a second row.
- A row exists, the text matches, and `status` is `aigenerated`, `editorpicked`, or `approved`: return 200 and the row.

Changing `pending` to another status is done with the existing `PUT /entries/:id`. The next lookup then returns 200.
