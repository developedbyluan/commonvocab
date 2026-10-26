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

## 10. INSERT A NEW ENTRY/VOCAB AFTER ADDING NEW COLUMN `usage`

An example:

- Method: POST
- Endpoint: http://localhost:8787/entries
- Body -> JSON:

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
  "status": "pending",
  "usage": [
    {
      "id": 0,
      "image": { "url": "", "alt": "" },
      "text": { "english": "", "vietnamese": "" },
      "note": { "english": "", "vietnamese": "" }
    }
  ]
}
```

## 11. INSERT A NEW ENTRY/VOCAB AFTER ADDING NEW COLUMN `user_id`

Below is an example:

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
  "status": "pending",
  "usage": [
    {
      "id": 0,
      "image": { "url": "", "alt": "" },
      "text": { "english": "", "vietnamese": "" },
      "note": { "english": "", "vietnamese": "" }
    }
  ],
  "user_id": "user_3JfBd7NGG2fv7pUKpN3vL2s2wBG"
}
```

## 12. REQUIRE `user_id` when requesting `entries/lookup`

This change is needed because now an unknown lookup will be stored with placeholders for unknown information while still returning 404 to users.

- METHOD: GET
- ENDPOINT: `http://localhost:8787/entries/lookup`
- QUERY PARAMS:
  - media_id
  - sentence_id
  - start_index
  - end_index
  - input_text
  - user_id // new param added

## 13. [UPDATE] INSERT A NEW ENTRY/VOCAB (local dev) after adding a new column `subtitles`

Here's an example:

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
  "status": "pending",
  "usage": [
    {
      "id": 0,
      "image": { "url": "", "alt": "" },
      "text": { "english": "", "vietnamese": "" },
      "note": { "english": "", "vietnamese": "" }
    }
  ],
  "user_id": "user_3JfBd7NGG2fv7pUKpN3vL2s2wBG",
  "subtitles": [
    {
      "id": 1,
      "target": "When someone is well-behaved,",
      "mine": "Khi ai đó cư xử đúng mực,",
      "ipa": "wɛn ˈsʌmwʌn ɪz ˌwɛl bɪˈheɪvd",
      "start": 0.0,
      "end": 0.0,
      "speaker": "Narrator:"
    },
    {
      "id": 2,
      "target": "it means they act in a polite, proper, and acceptable way,",
      "mine": "điều đó có nghĩa là họ cư xử một cách lịch sự, đúng đắn và phù hợp,",
      "ipa": "ɪt minz ðeɪ ækt ɪn ə pəˈlaɪt ˈprɑpɚ ænd əkˈsɛptəbəl weɪ",
      "start": 0.0,
      "end": 0.0,
      "speaker": "Narrator:"
    },
    {
      "id": 3,
      "target": "often following rules and showing good manners.",
      "mine": "thường tuân thủ các quy tắc và thể hiện phép lịch sự.",
      "ipa": "ˈɔfən ˈfɑloʊɪŋ rulz ænd ˈʃoʊɪŋ ɡʊd ˈmænɚz",
      "start": 0.0,
      "end": 0.0,
      "speaker": "Narrator:"
    }
  ]
}
```

## 14. [UPDATE] INSERT A NEW ENTRY/VOCAB (local dev) after adding a new column `phonetic`

Here's an example:

```json
{
  "input_text": "walt in",
  "definition": {
    "vietnamese": "nó đáng lắm",
    "english": "enter the room without permission"
  },
  "media_id": "11",
  "sentence_id": "1",
  "start_index": 5,
  "end_index": 20,
  "part_of_speech": "phrase",
  "status": "editorpicked",
  "usage": [
    {
      "id": 0,
      "image": { "url": "", "alt": "" },
      "text": { "english": "", "vietnamese": "" },
      "note": { "english": "", "vietnamese": "" }
    }
  ],
  "user_id": "user_3JfBd7NGG2fv7pUKpN3vL2s2wBG",
  "subtitles": [
    {
      "id": 1,
      "target": "When someone is well-behaved,",
      "mine": "Khi ai đó cư xử đúng mực,",
      "ipa": "wɛn ˈsʌmwʌn ɪz ˌwɛl bɪˈheɪvd",
      "start": 0.0,
      "end": 0.0,
      "speaker": "Narrator:"
    },
    {
      "id": 2,
      "target": "it means they act in a polite, proper, and acceptable way,",
      "mine": "điều đó có nghĩa là họ cư xử một cách lịch sự, đúng đắn và phù hợp,",
      "ipa": "ɪt minz ðeɪ ækt ɪn ə pəˈlaɪt ˈprɑpɚ ænd əkˈsɛptəbəl weɪ",
      "start": 0.0,
      "end": 0.0,
      "speaker": "Narrator:"
    },
    {
      "id": 3,
      "target": "often following rules and showing good manners.",
      "mine": "thường tuân thủ các quy tắc và thể hiện phép lịch sự.",
      "ipa": "ˈɔfən ˈfɑloʊɪŋ rulz ænd ˈʃoʊɪŋ ɡʊd ˈmænɚz",
      "start": 0.0,
      "end": 0.0,
      "speaker": "Narrator:"
    }
  ],
  "phonetic": "waltz in"
}
```

## 15. [UPDATE] INSERT A NEW ENTRY/VOCAB (local dev) after modifying column `usage`

Here's an example:

```json
{
  "input_text": "walt in",
  "definition": {
    "vietnamese": "nó đáng lắm",
    "english": "enter the room without permission"
  },
  "media_id": "111",
  "sentence_id": "11",
  "start_index": 50,
  "end_index": 200,
  "part_of_speech": "phrase",
  "status": "editorpicked",
  "usage": [
    {
      "id": 0,
      "image": { "url": "", "alt": "" },
      "text": { "english": "", "vietnamese": "", "start": 0, "end": 0 },
      "note": { "english": "", "vietnamese": "", "start": 0, "end": 0 }
    }
  ],
  "user_id": "user_3JfBd7NGG2fv7pUKpN3vL2s2wBG",
  "subtitles": [
    {
      "id": 1,
      "target": "When someone is well-behaved,",
      "mine": "Khi ai đó cư xử đúng mực,",
      "ipa": "wɛn ˈsʌmwʌn ɪz ˌwɛl bɪˈheɪvd",
      "start": 0.0,
      "end": 0.0,
      "speaker": "Narrator:"
    },
    {
      "id": 2,
      "target": "it means they act in a polite, proper, and acceptable way,",
      "mine": "điều đó có nghĩa là họ cư xử một cách lịch sự, đúng đắn và phù hợp,",
      "ipa": "ɪt minz ðeɪ ækt ɪn ə pəˈlaɪt ˈprɑpɚ ænd əkˈsɛptəbəl weɪ",
      "start": 0.0,
      "end": 0.0,
      "speaker": "Narrator:"
    },
    {
      "id": 3,
      "target": "often following rules and showing good manners.",
      "mine": "thường tuân thủ các quy tắc và thể hiện phép lịch sự.",
      "ipa": "ˈɔfən ˈfɑloʊɪŋ rulz ænd ˈʃoʊɪŋ ɡʊd ˈmænɚz",
      "start": 0.0,
      "end": 0.0,
      "speaker": "Narrator:"
    }
  ],
  "phonetic": "waltz in"
}
```

## 16. DEPLOY THE WORKER

Respond in command line:

```bash
developedbyluan@Trans-Mac-mini commonvocab % bun run deploy
$ wrangler deploy --minify

 ⛅️ wrangler 4.152.0
────────────────────
Total Upload: 32.79 KiB / gzip: 11.46 KiB
Worker Startup Time: 2 ms
Your Worker has access to the following bindings:
Binding                                    Resource
env.DB (commonvocab)                       D1 Database
env.LOOKUP_LIMITER (10 requests/60s)       Rate Limit
env.ENTRIES_LIMITER (30 requests/60s)      Rate Limit

Uploaded commonvocab (3.52 sec)
Deployed commonvocab triggers (0.75 sec)
  https://commonvocab.developedbyluan.workers.dev
Current Version ID: 6ab46528-bfab-4332-9ba2-6803d421588e
```

## 17. SEND A POST REQUEST to `/entries/lookup (local dev)

1. In Insomnia, create a request and set the method to POST.
2. Set the URL to http://localhost:8787/entries/lookup.
3. Open Body, choose JSON, and paste:

{
"input_text": "harbor",
"media_id": "media-1",
"sentence_id": "1",
"start_index": 0,
"end_index": 6,
"user_id": "user_demo"
}

## 18. DEPLOY THE WORKER with AI FEATURE

```bash
developedbyluan@Trans-Mac-mini commonvocab % npx wrangler secret put OPENAI_API_KEY

 ⛅️ wrangler 4.152.0
────────────────────
✔ Enter a secret value: … ********************************************************************************************************************************************************************
🌀 Creating the secret for the Worker "commonvocab"
✨ Success! Uploaded secret OPENAI_API_KEY
developedbyluan@Trans-Mac-mini commonvocab %
developedbyluan@Trans-Mac-mini commonvocab % bun run deploy
$ wrangler deploy --minify

 ⛅️ wrangler 4.152.0
────────────────────
Total Upload: 36.74 KiB / gzip: 12.36 KiB
Worker Startup Time: 2 ms
Your Worker has access to the following bindings:
Binding                                    Resource
env.DB (commonvocab)                       D1 Database
env.LOOKUP_LIMITER (10 requests/60s)       Rate Limit
env.ENTRIES_LIMITER (30 requests/60s)      Rate Limit

Uploaded commonvocab (3.57 sec)
Deployed commonvocab triggers (0.95 sec)
  https://commonvocab.developedbyluan.workers.dev
Current Version ID: 36d9d5e6-d359-4b51-b175-f09093c8cff4
```

## 19. SEND A POST REQUEST to `/entries/lookup (local dev) with BASIC AUTH

1. In Insomnia, create a request and set the method to POST.
2. Set the URL to http://localhost:8787/entries/lookup.
3. Open Body, choose JSON, and paste:

```json
{
  "input_text": "Treat or trick!",
  "media_id": "186",
  "sentence_id": "10",
  "start_index": 10,
  "end_index": 28,
  "user_id": "user_demo"
}
```

4. Open the request’s Auth tab, choose Basic, and use:

- Username: \*\*\*\*
- Password: 9cIaou4laZZcB6-hvcl7CdFa
  (look at the `.env` file to see the real confidential)

## 20. DEPLOY THE WORKER WITH BASIC AUTH FEATURE

```bash
developedbyluan@Trans-Mac-mini commonvocab % npx wrangler secret put BASIC_AUTH_USERNAME
 ⛅️ wrangler 4.152.0
────────────────────
✔ Enter a secret value: … ******
🌀 Creating the secret for the Worker "commonvocab"
✨ Success! Uploaded secret BASIC_AUTH_USERNAME
developedbyluan@Trans-Mac-mini commonvocab % npx wrangler secret put BASIC_AUTH_PASSWORD

 ⛅️ wrangler 4.152.0
────────────────────
✔ Enter a secret value: … ************************
🌀 Creating the secret for the Worker "commonvocab"
✨ Success! Uploaded secret BASIC_AUTH_PASSWORD

developedbyluan@Trans-Mac-mini commonvocab % bun run deploy
$ wrangler deploy --minify

 ⛅️ wrangler 4.152.0
────────────────────
Total Upload: 37.30 KiB / gzip: 12.63 KiB
Worker Startup Time: 2 ms
Your Worker has access to the following bindings:
Binding                                    Resource
env.DB (commonvocab)                       D1 Database
env.LOOKUP_LIMITER (10 requests/60s)       Rate Limit
env.ENTRIES_LIMITER (30 requests/60s)      Rate Limit

Uploaded commonvocab (2.97 sec)
Deployed commonvocab triggers (0.67 sec)
  https://commonvocab.developedbyluan.workers.dev
Current Version ID: f802b1fd-e6aa-4bf0-89da-835e48edac8d
```
