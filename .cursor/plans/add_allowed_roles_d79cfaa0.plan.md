---
name: Add allowed roles
overview: Add an allowed_roles JSON array limited to standard, premium, vip, and vvip. Existing rows and lookup placeholders start as ["standard"]. POST and PUT require the client to send the array, and [] is valid.
todos:
  - id: migration
    content: Add migrations/0011_add_allowed_roles.sql and apply it locally and remotely.
    status: completed
  - id: worker
    content: Require an allowed_roles array of standard, premium, vip, and vvip on create and update.
    status: completed
  - id: verify
    content: Check a valid list, an empty list, invalid roles, an old row, and a lookup miss, then delete the test rows.
    status: completed
isProject: false
---

# Add the allowed_roles column

`allowed_roles` is a JSON array stored as text, the same way [src/entries.ts](src/entries.ts) stores `usage`. Each item is one of `standard`, `premium`, `vip`, or `vvip`. An entry can include more than one role, and `[]` is valid when the client sends it. A repeated role is rejected.

## Database

Add [migrations/0011_add_allowed_roles.sql](migrations/0011_add_allowed_roles.sql). Leave the earlier migration files unchanged.

```sql
ALTER TABLE entries
ADD COLUMN allowed_roles TEXT NOT NULL DEFAULT '["standard"]';
```

Existing rows receive `["standard"]` from that default. Apply the migration to the local D1 database and the remote `commonvocab` database.

## Worker

In [src/entries.ts](src/entries.ts), add `allowed_roles` to `Entry`. `EntryInput` already omits only `id`, `created_at`, and `updated_at`, so it includes the new field. Store the column as text on `StoredEntry`, append it to `COLUMNS` and `PUBLIC_COLUMNS`, and parse it in `withStoredColumns`. A stored value that is not an array of the four roles reads back as `["standard"]`.

Validate it in `parseEntry` with the same style as `requiredStatus`:

```ts
const ROLES = ["standard", "premium", "vip", "vvip"] as const;
```

A missing array returns `allowed_roles must be an array`. An unknown item returns `allowed_roles item must be standard, premium, vip, or vvip`. A duplicate returns `allowed_roles item must not be repeated`. Widen the `isFieldError` parameter list so the array narrows correctly.

`POST` and `PUT` bind `JSON.stringify(input.allowed_roles)`. The lookup placeholder insert does not name this column, so the default `["standard"]` applies. Its response stays `404`.

## Check

Create one entry with `["premium", "vip"]` and read those roles back. An empty array returns `201`. An unknown role, a duplicate, and a missing array each return `400`. An older row reads `["standard"]`. A lookup miss inserts one pending row with `["standard"]`. Delete the rows created by the check.
