---
name: Usage text times
overview: Add required start and end times to each usage example’s text and note, using the same number rules as subtitle times, and fill those fields on rows that were saved before they existed.
todos:
  - id: migration
    content: Add migrations/0009_usage_times.sql and apply it locally and remotely so existing usage items gain start and end 0.
    status: completed
  - id: validate
    content: Require start and end on usage.text and usage.note in the type, write validation, and stored-JSON check.
    status: completed
  - id: verify
    content: Create a timed usage example, reject invalid times, confirm [] still works, then delete the test row.
    status: completed
isProject: false
---

# Add start and end to usage text and note

`usage` stays a JSON array in the existing `usage` text column. No new column. [src/entries.ts](src/entries.ts) already stores it with `JSON.stringify` and parses it in `parseStoredUsage`. `LocalizedText` is only used by `usage.text` and `usage.note`, so `definition` stays `{ vietnamese, english }`.

Each text and note object gains two numbers:

```ts
type LocalizedText = {
  english: string;
  vietnamese: string;
  start: number;
  end: number;
};
```

`POST` and `PUT` require both times on `usage.text` and `usage.note`. Reuse `requiredTime`: a finite number greater than or equal to 0. Reject `end < start` with `usage.text.end must be greater than or equal to usage.text.start` (and the same message for `usage.note`). Decimals such as `1.11` are valid. Empty `english` and `vietnamese` strings stay valid. `usage: []` stays valid. The lookup placeholder still inserts `"[]"`.

`isLocalizedText` must check `start` and `end` the same way `isSubtitleLine` checks its times. Otherwise `parseStoredUsage` treats the whole array as invalid and a read returns `usage: []`.

## Existing rows

Add [migrations/0009_usage_times.sql](migrations/0009_usage_times.sql). Leave [migrations/0005_add_usage.sql](migrations/0005_add_usage.sql) unchanged. For each object in a valid non-empty `usage` array, set a missing `text.start`, `text.end`, `note.start`, or `note.end` to `0`. Skip `[]` and invalid JSON. `json_patch` and `json_group_array` keep the JSON subtype so the column remains an array of objects, not an array of strings. Check that with a `SELECT` on a local row before applying.

Apply the migration to the local D1 database and the remote `commonvocab` database.

## Check

Create one entry whose `usage.text` and `usage.note` include the sample times, then read it back. A missing `start`, a negative time, and `end` before `start` each return 400. An empty `usage` array still returns 201. Delete the test row afterward.
