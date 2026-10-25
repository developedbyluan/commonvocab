---
name: Add subtitles column
overview: A step-by-step lesson for a `subtitles` column that stores an array of timed lines as JSON text. An empty array is valid.
todos:
  - id: migration
    content: Add migrations/0007_add_subtitles.sql with TEXT NOT NULL DEFAULT '[]', then apply it locally and remotely.
    status: completed
  - id: types
    content: Add the SubtitleLine type, extend Entry and StoredEntry, and append subtitles to both column lists.
    status: completed
  - id: validate
    content: Validate the subtitles array in parseEntry, allowing [] and empty strings, and requiring numeric start and end.
    status: completed
  - id: persist
    content: JSON.stringify subtitles on write and parse the array on every response.
    status: completed
isProject: false
---

# Add the `subtitles` column

This is a lesson to follow yourself. The column is named `subtitles`. It stays `TEXT` in D1, and the Worker stores the array with `JSON.stringify`, the same way [src/entries.ts](src/entries.ts) already stores `usage`.

`[]` is a valid value. Each item in a non-empty array has this shape. `start` and `end` are seconds, so they are numbers, not only integers. `0.00` is valid. `end` must be greater than or equal to `start`.

```json
{
  "id": 1,
  "target": "When someone is well-behaved,",
  "mine": "Khi ai đó cư xử đúng mực,",
  "ipa": "wɛn ˈsʌmwʌn ɪz ˌwɛl bɪˈheɪvd",
  "start": 0.0,
  "end": 0.0,
  "speaker": "Narrator:"
}
```

The four text fields are strings and may be empty. A missing key is rejected.

## 1. Add the migration

Create [migrations/0007_add_subtitles.sql](migrations/0007_add_subtitles.sql). Leave [migrations/0006_add_user_id.sql](migrations/0006_add_user_id.sql) unchanged.

```sql
ALTER TABLE entries
ADD COLUMN subtitles TEXT NOT NULL DEFAULT '[]';
```

`DEFAULT '[]'` fills every existing row. Do not call `json_extract` in this file.

```bash
npx wrangler d1 migrations apply commonvocab --local
npx wrangler d1 migrations apply commonvocab --remote
```

The lookup insert in `entries.get("/lookup")` lists its columns explicitly and does not mention `subtitles`. SQLite fills the default `[]` for that insert, so that statement can stay as it is.

## 2. Describe the value in [src/entries.ts](src/entries.ts)

Add this beside `UsageExample`:

```ts
type SubtitleLine = {
  id: number;
  target: string;
  mine: string;
  ipa: string;
  start: number;
  end: number;
  speaker: string;
};
```

Add `subtitles: SubtitleLine[]` to `Entry`. Extend `StoredEntry` so D1's text column is separate from the parsed array:

```ts
type StoredEntry = Omit<Entry, "definition" | "usage" | "subtitles"> & {
  definition: string;
  usage: string;
  subtitles: string;
};
```

Append `, subtitles` to both `COLUMNS` and `PUBLIC_COLUMNS`.

## 3. Check the array in `parseEntry`

Add `requiredSubtitles` and call it after `requiredUsage`. Put `subtitles` on the object `parseEntry` returns. `[]` returns immediately as an empty array.

```ts
function requiredSubtitles(value: unknown): SubtitleLine[] | FieldError {
  if (!Array.isArray(value)) return { error: "subtitles must be an array" };
  const lines: SubtitleLine[] = [];
  for (const item of value) {
    const line = requiredSubtitleLine(item);
    if (isFieldError(line)) return line;
    lines.push(line);
  }
  return lines;
}
```

`requiredSubtitleLine` checks, in order:

- The item is an object.
- `id` is an integer and is `>= 0`, using `requiredIndex`.
- `target`, `mine`, `ipa`, and `speaker` are strings. Use `requiredString`, which trims and allows `""`.
- `start` and `end` are finite numbers and are `>= 0`. Do not use `requiredIndex` for these two, because `1.25` is a valid time and that helper rejects every non-integer.
- `end` is greater than or equal to `start`.

Widen `isFieldError` so it also accepts `SubtitleLine` and `SubtitleLine[]`.

## 4. Save a string and return an array

In the `POST` and `PUT` `.bind(...)` calls, pass `JSON.stringify(input.subtitles)`. On `PUT`, bind it before `id`.

Add `subtitles` to `withStoredColumns`:

```ts
subtitles: parseStoredSubtitles(row.subtitles),
```

`parseStoredSubtitles` uses `JSON.parse`, then keeps the value only when every item is a `SubtitleLine`. Anything else, including a missing value, becomes `[]`.

## 5. Send it from Insomnia

`POST http://localhost:8787/entries` with body type JSON. `subtitles` may be `[]`, or the three-line array from the example. A missing `subtitles` field returns 400 with `subtitles must be an array`. A line whose `end` is less than `start` returns 400.
