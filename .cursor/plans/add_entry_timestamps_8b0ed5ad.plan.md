---
name: Add entry timestamps
overview: Add server-written created_at and updated_at columns. A new row stores the current Unix time and an empty update history. Each update appends a new time and leaves the creation time unchanged.
todos:
  - id: migration
    content: Add migrations/0010_add_timestamps.sql and apply it locally and remotely.
    status: completed
  - id: worker
    content: Set created_at and updated_at on create, lookup insert, and update without accepting them from the client.
    status: completed
  - id: verify
    content: Create one entry, update it twice, check a lookup miss and an old row, then delete the test rows.
    status: completed
isProject: false
---

# Add created_at and updated_at

`created_at` is one Unix time in seconds, such as `1792947752`. `updated_at` is a JSON array of those times, such as `[1792947752, 1792947772]`. The client does not send either field. A value sent in the body is ignored.

The clock is `Math.floor(Date.now() / 1000)`, so the stored number matches the 10-digit example rather than a millisecond value.

## Database

Add [migrations/0010_add_timestamps.sql](migrations/0010_add_timestamps.sql). Leave the earlier migration files unchanged.

```sql
ALTER TABLE entries
ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0
CHECK (created_at >= 0);

ALTER TABLE entries
ADD COLUMN updated_at TEXT NOT NULL DEFAULT '[]';
```

Existing rows keep `created_at` `0` and `updated_at` `[]`, because their real creation time is unknown. Apply the migration to the local D1 database and the remote `commonvocab` database.

## Worker

In [src/entries.ts](src/entries.ts), add `created_at: number` and `updated_at: number[]` to `Entry`. Change `EntryInput` to `Omit<Entry, "id" | "created_at" | "updated_at">`, so `parseEntry` stays limited to the fields the client sends.

Store `updated_at` as text, the same way `usage` and `subtitles` are stored. Add it to the `StoredEntry` omission list, append both names to `COLUMNS` and `PUBLIC_COLUMNS`, and parse the array in `withStoredColumns`. A stored value that is not an array of integers greater than or equal to 0 reads back as `[]`.

- `POST /entries` binds the current Unix time as `created_at` and `'[]'` as `updated_at`.
- `PUT /entries/:id` does not assign `created_at`. It appends the current Unix time with SQLite `json_insert(updated_at, '$[#]', ?)`, so the history grows inside the same update.
- The lookup placeholder insert is also a new row. Add `created_at` to that `INSERT` and bind the current Unix time. Leave `updated_at` out of the column list so the default `[]` applies. The response stays `404`.

## Check

Create one entry without `created_at` or `updated_at`. The `201` body has a current `created_at` and `updated_at: []`. Update that entry twice. `created_at` stays the same, and `updated_at` gains one time per update. A lookup miss inserts one pending row with a current `created_at` and `updated_at: []`. An older row still reads `created_at: 0` and `updated_at: []`. Delete the rows created by the check.
