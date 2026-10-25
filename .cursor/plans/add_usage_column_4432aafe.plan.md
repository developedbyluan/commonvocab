---
name: Add usage column
overview: A step-by-step lesson for adding a `usage` column that stores an array of example objects as JSON text, using the same D1 and Worker pattern as `definition`.
todos:
  - id: migration
    content: Add migrations/0005_add_usage.sql with TEXT NOT NULL DEFAULT '[]', then apply it locally and remotely.
    status: pending
  - id: types
    content: Add UsageExample types, extend Entry and StoredEntry, and append usage to both column lists.
    status: pending
  - id: validate
    content: Validate the usage array in parseEntry, allowing empty strings and requiring every nested key.
    status: pending
  - id: persist
    content: JSON.stringify usage on write and parse it back to an array on every response.
    status: pending
isProject: false
---

# Add the `usage` column

This is a lesson to follow yourself. No files need to be edited until you choose to apply it. The column stays `TEXT` in D1. The Worker accepts and returns a JSON array, and stores that array with `JSON.stringify`.

Your sample is missing a quote on the last key. The object the Worker should accept is:

```json
[
  {
    "id": 0,
    "image": { "url": "", "alt": "" },
    "text": { "english": "", "vietnamese": "" },
    "note": { "english": "", "vietnamese": "" }
  }
]
```

Empty strings are valid, matching that sample. A missing key, a non-object `image` / `text` / `note`, or a non-array `usage` is rejected. `usage[].id` is the id of one example inside the array. It is separate from the entry's own `id`.

Existing rows receive `[]` from the column default. `POST` and `PUT` must include `usage`, and `[]` is allowed.

## 1. Add the migration

Create [migrations/0005_add_usage.sql](migrations/0005_add_usage.sql). Leave [migrations/0004_definition_json.sql](migrations/0004_definition_json.sql) unchanged.

```sql
ALTER TABLE entries
ADD COLUMN usage TEXT NOT NULL DEFAULT '[]';
```

`DEFAULT '[]'` fills every row that already exists. Do not call `json_extract` here. On this SQLite version it throws `malformed JSON` for values that are not already JSON, which is what broke migration `0004` before it was changed to `json_valid`.

Apply it to the local database, then to the remote database:

```bash
npx wrangler d1 migrations apply commonvocab --local
npx wrangler d1 migrations apply commonvocab --remote
```

The local file stays the same `.sqlite` file under `.wrangler/state/v3/d1`. The new column is added inside it.

## 2. Describe the value in [src/entries.ts](src/entries.ts)

Add this beside the existing `Definition` type:

```ts
type LocalizedText = {
  english: string;
  vietnamese: string;
};

type UsageImage = {
  url: string;
  alt: string;
};

type UsageExample = {
  id: number;
  image: UsageImage;
  text: LocalizedText;
  note: LocalizedText;
};
```

Add `usage: UsageExample[]` to `Entry`. `EntryInput` already omits `id`, so it picks up `usage` automatically.

`StoredEntry` currently turns only `definition` into a string. Both JSON columns are strings in D1, so change it to:

```ts
type StoredEntry = Omit<Entry, "definition" | "usage"> & {
  definition: string;
  usage: string;
};
```

Append `, usage` to both `COLUMNS` and `PUBLIC_COLUMNS`.

## 3. Check the array in `parseEntry`

Add `requiredUsage` and call it after the `status` check. Put `usage` on the object `parseEntry` returns.

```ts
function requiredUsage(value: unknown): UsageExample[] | FieldError {
  if (!Array.isArray(value)) return { error: "usage must be an array" };
  const examples: UsageExample[] = [];
  for (const item of value) {
    const example = requiredUsageExample(item);
    if (isFieldError(example)) return example;
    examples.push(example);
  }
  return examples;
}
```

`requiredUsageExample` checks, in order:

- The item is an object.
- `id` is an integer and is `>= 0`. Reuse the integer test from `requiredIndex`.
- `image` is an object with string `url` and `alt`.
- `text` and `note` are objects with string `english` and `vietnamese`.

Allow `""`. That is different from `requiredText`, which rejects an empty string. A small `requiredString` that trims and allows an empty result is the right helper for these fields. Trim so `"  "` is stored as `""`.

Widen `isFieldError` so it also accepts `UsageExample[]`. The current parameter list only includes `Definition`. After the check, TypeScript still needs to narrow `usage` back to `UsageExample[]`.

## 4. Save a string and return an array

In the `POST` and `PUT` `.bind(...)` calls, pass `JSON.stringify(input.usage)` in the new last-value position. Keep `id` last on `PUT`.

D1 returns `usage` as text. Extend the current `withDefinition` helper into one function that parses both columns before every `c.json` response:

```ts
function withStoredColumns(row: StoredEntry): Entry {
  return {
    ...row,
    definition: parseStoredDefinition(row.definition),
    usage: parseStoredUsage(row.usage),
  };
}
```

`parseStoredUsage` uses `JSON.parse`, then checks that the result is an array of `UsageExample`. A row whose `usage` is missing or not an array becomes `[]`, so an old response cannot crash the route.

Use `withStoredColumns` in `GET /entries`, `GET /entries/lookup`, `GET /entries/:id`, `POST`, `PUT`, and `DELETE`. `findEntry` should return that parsed `Entry`.

## 5. Send it from Insomnia

`POST http://localhost:8787/entries` with body type JSON. Add `usage` to the body you already use:

```json
"usage": [
  {
    "id": 0,
    "image": { "url": "", "alt": "" },
    "text": { "english": "", "vietnamese": "" },
    "note": { "english": "", "vietnamese": "" }
  }
]
```

A successful create returns **201** and `usage` as that array. `[]` is also valid. A missing `usage`, or an item missing `note.vietnamese`, returns **400**.
