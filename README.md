```txt
npm install
npm run dev
```

```txt
npm run deploy
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
npm run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiating `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>();
```

# THIS PROJECT'S DOCUMENTATION

## 1. deploy `bun run deploy`

Project address

```
https://commonvocab.developedbyluan.workers.dev
Current Version ID: 9236b200-0f39-4c7d-a061-c58518e171d3
```

## 2. INSERT A NEW ENTRY/VOCAB (local dev)

- Method: POST
- Endpoint: http://localhost:8787/entries
- Body -> JSON:

```json
{
  "input_text": "it was worth it",
  "definition": "the cost was justified",
  "media_id": "1",
  "sentence_id": "1",
  "start_index": 5,
  "end_index": 20
}
```

## 3. REQUEST AN ENTRY/VOCAB using 4 INPUTS and Insomnia (local dev)

In Insomnia this is a GET with four query parameters. Leave the body empty.

The handler reads `media_id`, `sentence_id`, `start_index`, and `end_index` from the URL, not from JSON.

i. Start the local Worker with `bun run dev` so `http://localhost:8787` is running.
ii. In Insomnia, create a request and set the method to **GET**.
iii. Set the URL to `http://localhost:8787/entries/lookup`.
iv. Open the **Query** tab and add these four rows:

| Name          | Value |
| ------------- | ----- |
| `media_id`    | `1`   |
| `sentence_id` | `1`   |
| `start_index` | `5`   |
| `end_index`   | `20`  |

Insomnia turns that into:

```text
http://localhost:8787/entries/lookup?media_id=1&sentence_id=1&start_index=5&end_index=20
```

v. Send the request. You do not need an authorization header or a `Content-Type` header, because there is no body.

A match returns **200** and:

```json
{
  "input_text": "it was worth it",
  "definition": "the cost was justified",
  "media_id": "1",
  "sentence_id": "1",
  "start_index": 5,
  "end_index": 20
}
```

That row has to exist already. Create it first with a **POST** to `http://localhost:8787/entries`, body type **JSON**, and the same four fields plus `input_text` and `definition`. A span that was never saved returns **404** with `{ "error": "entry not found" }`. A missing query parameter returns **400**.

## 4. ADD A NEW COLUMN

Adding a column means a new D1 migration, then applying it to the database this Worker already uses. I’ll check the current `entries` schema so the steps match this project.

Add the column in a new migration file. Leave `migrations/0001_create_entries.sql` as it is. Wrangler has already applied that file to your local database and to the remote `commonvocab` database, and it will not run an edited copy again.

### i. Create the next migration

Add `migrations/0002_add_part_of_speech.sql`. The `0002_` prefix is the version, and it must be higher than `0001`. Replace `part_of_speech` with the column you actually want.

```sql
ALTER TABLE entries ADD COLUMN part_of_speech TEXT NOT NULL DEFAULT '';
```

`ALTER TABLE` changes the table that already has rows. A new `NOT NULL` column needs a `DEFAULT`, because every existing row has to receive a value. A column that can be empty is simpler:

```sql
ALTER TABLE entries ADD COLUMN part_of_speech TEXT;
```

`TEXT` stores a string. Use `INTEGER` for a whole number. You can also add an index in the same file when you will look rows up by that column:

```sql
CREATE INDEX idx_entries_part_of_speech ON entries (part_of_speech);
```

### ii. Apply it to both databases

From the project folder, update the database used by `bun run dev`:

```bash
npx wrangler d1 migrations apply commonvocab --local
```

Then update the database behind the deployed Worker:

```bash
npx wrangler d1 migrations apply commonvocab --remote
```

Wrangler asks you to confirm the remote one. After either command, `0002_add_part_of_speech.sql` is recorded in the `d1_migrations` table, so the next apply skips it.

### iii. TEACH THE WORKER ABOUT THE NEW COLUMN

The routes name their columns in `src/entries.ts`. A new database column stays hidden until those lists include it.

Add the field to the `Entry` type, then add the column name to both `COLUMNS` and `PUBLIC_COLUMNS`. On create and update, add it to the `INSERT` and `UPDATE` statements, to the `.bind(...)` calls, and to `parseEntry` so a JSON body can send it.

## 6. [UPDATE] INSERT A NEW ENTRY/VOCAB (local dev)

- Method: POST
- Endpoint: http://localhost:8787/entries
- Body -> JSON:

```json
{
  "input_text": "worth",
  "definition": "having a particular value, especially in money",
  "media_id": "1",
  "sentence_id": "2",
  "start_index": 15,
  "end_index": 21,
  "part_of_speech": "adjective" // new column
}
```
