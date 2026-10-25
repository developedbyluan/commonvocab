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

## 7. [UPDATE] INSERT A NEW ENTRY/VOCAB (local dev) after adding STATUS column

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
  "part_of_speech": "adjective",
  "status": "editorpicked | pending | approved | aigenerated" // new column
}
```

## 8. MODIFY VALUE OF THE COLUMN `DEFINITION`

Modify the value's data structure of column `definition` to the one below:

```
{
"vietnamese": "nó đáng lắm"
"english": "it was worth it"
}
```

---

The `definition` field is a single string today. I’ll check how it is stored and validated so the object shape fits this table.

Keep the `definition` column as `TEXT`. D1 stores the object as a JSON string, and the Worker turns that string back into the object before it responds.

The request body uses a real JSON object, with a comma between the two fields:

```json
{
  "vietnamese": "nó đáng lắm",
  "english": "it was worth it"
}
```

### i. Change the type

In `src/entries.ts`, replace `definition: string` with:

```ts
type Definition = {
  vietnamese: string;
  english: string;
};
```

Then `Entry` uses `definition: Definition`.

### ii. Accept that object in `parseEntry`

`requiredText(body.definition, ...)` rejects an object. Replace that check with a function that reads both fields:

```ts
function requiredDefinition(value: unknown): Definition | FieldError {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { error: "definition must be an object" };
  }
  const body = value as Record<string, unknown>;
  const vietnamese = requiredText(
    body.vietnamese,
    "definition.vietnamese",
    true,
  );
  if (isFieldError(vietnamese)) return vietnamese;
  const english = requiredText(body.english, "definition.english", true);
  if (isFieldError(english)) return english;
  return { vietnamese, english };
}
```

`parseEntry` then stores that object on `definition`.

### iii. Save a string, return an object

D1 gives `definition` back as text. Bind the stored form in the `INSERT` and `UPDATE` calls:

```ts
JSON.stringify(input.definition);
```

After every `SELECT`, `INSERT ... RETURNING`, `UPDATE ... RETURNING`, and `DELETE ... RETURNING`, parse it before `c.json`:

```ts
function withDefinition(row: Entry & { definition: string }): Entry {
  return { ...row, definition: JSON.parse(row.definition) as Definition };
}
```

A saved row then responds as:

```json
"definition": { "vietnamese": "nó đáng lắm", "english": "it was worth it" }
```

### iv. Convert the rows you already have

The current values are plain sentences, such as `"the cost was justified"`. Add `migrations/0004_definition_json.sql` and apply it locally and remotely:

```sql
-- json_extract raises "malformed JSON" on the older plain-text definitions.
-- json_valid returns 0 for those rows and leaves existing JSON objects unchanged.
UPDATE entries
SET definition = json_object('vietnamese', '', 'english', definition)
WHERE json_valid(definition) = 0;
```

That puts the old sentence in `english` and leaves `vietnamese` empty. Fill in the Vietnamese text with a later `PUT`. The `PUT` body must include both strings, because `requiredDefinition` rejects an empty one.

## 9. [UPDATE] INSERT A NEW ENTRY/VOCAB (local dev) after modifying DEFINITION column's data structure

```json
{
  "input_text": "it was worth it",
  "definition": {
    "vietnamese": "nó đáng lắm",
    "english": "it was worth it"
  },
  "media_id": "1",
  "sentence_id": "1",
  "start_index": 5,
  "end_index": 20,
  "part_of_speech": "phrase",
  "status": "pending"
}
```

## 10. NEW COLUMN `usage`
### 1. Add the migration

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