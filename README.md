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
const app = new Hono<{ Bindings: CloudflareBindings }>()
```

# THIS PROJECT'S DOCUMENTATION
1. deploy `bun run deploy`
Project address
```
https://commonvocab.developedbyluan.workers.dev
Current Version ID: 9236b200-0f39-4c7d-a061-c58518e171d3
```

2. INSERT A NEW ENTRY/VOCAB (local dev)
* Method: POST
* Endpoint: http://localhost:8787/entries
* Body -> JSON:
```json
{
    "input_text":"it was worth it",
    "definition":"the cost was justified",
    "media_id":"1",
    "sentence_id":"1",
    "start_index":5,
    "end_index":20
}
```

3. REQUEST AN ENTRY/VOCAB using 4 INPUTS and Insomnia (local dev)
In Insomnia this is a GET with four query parameters. Leave the body empty.

The handler reads `media_id`, `sentence_id`, `start_index`, and `end_index` from the URL, not from JSON.

1. Start the local Worker with `bun run dev` so `http://localhost:8787` is running.
2. In Insomnia, create a request and set the method to **GET**.
3. Set the URL to `http://localhost:8787/entries/lookup`.
4. Open the **Query** tab and add these four rows:

| Name | Value |
|---|---|
| `media_id` | `1` |
| `sentence_id` | `1` |
| `start_index` | `5` |
| `end_index` | `20` |

Insomnia turns that into:

```text
http://localhost:8787/entries/lookup?media_id=1&sentence_id=1&start_index=5&end_index=20
```

5. Send the request. You do not need an authorization header or a `Content-Type` header, because there is no body.

A match returns **200** and:

```json
{"input_text":"it was worth it","definition":"the cost was justified","media_id":"1","sentence_id":"1","start_index":5,"end_index":20}
```

That row has to exist already. Create it first with a **POST** to `http://localhost:8787/entries`, body type **JSON**, and the same four fields plus `input_text` and `definition`. A span that was never saved returns **404** with `{ "error": "entry not found" }`. A missing query parameter returns **400**.
