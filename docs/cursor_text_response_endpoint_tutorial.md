# Text response endpoint tutorial
_Exported on 10/24/2026 at 10:15:52 GMT+7 from Cursor (3.27.12)_

---

**User**

@src/index.ts 
teach me step by step how to build an endpoint which allows users to send a text "it was worth it" and the response should be an array of text like this:

```
["God, **it was worth it.*", "Do you think **it was worth it?**"]
```

Ask me any questions if you need to or just because of your curiosity

---

**Cursor**

I'll look at the project first so the walkthrough matches the code you already have.

You already have a Hono app on Cloudflare Workers. The new endpoint is a second route next to the existing `GET /` in `src/index.ts`: it takes a phrase, finds sentences that contain that phrase, wraps the match in `**`, and returns a JSON array.

For the phrase `it was worth it`, the response looks like this:

```json
["God, **it was worth it.**", "Do you think **it was worth it?**"]
```

Your first sample string has one closing asterisk (`**it was worth it.*`). The version below closes the bold and keeps the following punctuation inside it, which matches the second sample (`**it was worth it?**`).

## 1. Decide the contract

Use a query string so you can hit it from the browser and from `curl`.

- Method and path: `GET /examples?text=it%20was%20worth%20it`
- Success: `200` and a JSON array of strings
- Missing `text`: `400` and `{ "error": "missing text" }`
- No sentences contain the phrase: `200` and `[]`

`c.json()` sets `Content-Type: application/json` and serializes the array. `c.text()`, which `/` uses now, would send a plain string instead.

## 2. Keep a small list of sentences

Start with an array in the same file. The endpoint only returns entries that contain the phrase.

```ts
const EXAMPLES = [
  'God, it was worth it.',
  'Do you think it was worth it?',
  'The train leaves at noon.',
]
```

## 3. Highlight the phrase without changing its casing

Search case-insensitively, but copy the original letters out of the sentence. Also pull in any punctuation that sits directly after the phrase, so `it was worth it?` becomes `**it was worth it?**`.

```ts
function highlight(sentence: string, phrase: string): string | null {
  const index = sentence.toLowerCase().indexOf(phrase.toLowerCase())
  if (index === -1) return null

  let end = index + phrase.length
  while (end < sentence.length && '.,!?;:'.includes(sentence[end])) {
    end++
  }

  return (
    sentence.slice(0, index) +
    '**' +
    sentence.slice(index, end) +
    '**' +
    sentence.slice(end)
  )
}
```

`indexOf` treats the input as literal text. A `RegExp` built from user input would treat characters like `.` and `?` as pattern syntax.

## 4. Add the route

Put this under the existing `app.get('/')` handler. `export default app` stays at the bottom.

```ts
app.get('/examples', (c) => {
  const text = c.req.query('text')?.trim()
  if (!text) {
    return c.json({ error: 'missing text' }, 400)
  }

  const matches = EXAMPLES.flatMap((sentence) => {
    const highlighted = highlight(sentence, text)
    return highlighted === null ? [] : [highlighted]
  })

  return c.json(matches)
})
```

`c.req.query('text')` reads the query parameter. `trim()` drops surrounding spaces so ` text ` still matches. `flatMap` keeps only the sentences that contained the phrase.

## 5. Try it

Wrangler serves the worker locally on port 8787.

```bash
npm run dev
```

```bash
curl 'http://localhost:8787/examples?text=it%20was%20worth%20it'
```

That should print the two highlighted sentences. A phrase that never appears, such as `purple`, should print `[]`. Leaving off `text` should return 400.

---

A few things I want to know before this grows past the in-memory list:

Where should the sentences come from? A hardcoded array is enough to learn the route. `wrangler.jsonc` already has a commented D1 block, so a database is the natural next step if this is a real vocabulary corpus. Generating sentences with a model is a different endpoint.

Is the consumer a page that renders markdown? `**` only looks bold after something parses it. If the client is going to do that itself, returning `{ "sentence": "...", "start": 5, "end": 20 }` is easier to style than baking markdown into the string.

Should a later match be highlighted too? `highlight` currently stops at the first occurrence of the phrase in each sentence.

And, because the project is named commonvocab: is this example sentences for learners looking up a chunk of English, or a search box over lines you already have?

---

**User**

teach me how to do this:
```
{ "sentence": "...", "start": 5, "end": 20 }
```

---

**Cursor**

The file grew since last time, so I’ll read the route you have now and show how to return positions instead of markdown.

Return the original sentence plus the two indexes you already compute inside `highlight`. `start` is where the phrase begins, and `end` is where it stops. Both are character positions in that sentence, and `end` is exclusive, same as `slice`.

For `"God, it was worth it."` and the phrase `"it was worth it"`:

```text
God, it was worth it.
0123456789...
     ^              ^
     5              20
```

`"God, "` is 5 characters, so the phrase starts at `5`. The phrase is 15 characters, so it stops at `20`. `sentence.slice(5, 20)` is `"it was worth it"`. The period at index `20` stays outside the span, which is the `{ "start": 5, "end": 20 }` shape.

## 1. Describe one match

```ts
type Match = {
  sentence: string
  start: number
  end: number
}
```

## 2. Replace the markdown wrapper with those numbers

`highlight` finds `index`, then builds a new string. A locate function returns that index instead.

```ts
function locate(sentence: string, phrase: string): Match | null {
  const start = sentence.toLowerCase().indexOf(phrase.toLowerCase())
  if (start === -1) return null

  return {
    sentence,
    start,
    end: start + phrase.length,
  }
}
```

The search stays case-insensitive. The letters in `sentence` stay as written, because you return the original string and only record where the match sits.

## 3. Change `findMatches` to return `Match[]`

```ts
function findMatches(text: string): Match[] {
  return EXAMPLES.flatMap((sentence) => {
    const match = locate(sentence, text)
    return match === null ? [] : [match]
  })
}
```

`GET /commonvocab` can stay as it is. `c.json(matches)` will serialize the objects.

`/commonvocab?text=it%20was%20worth%20it` then returns:

```json
[
  { "sentence": "God, it was worth it.", "start": 5, "end": 20 },
  { "sentence": "Do you think it was worth it?", "start": 13, "end": 28 },
  { "sentence": "But look at your face, it was worth it.", "start": 23, "end": 38 }
]
```

`"And it can manipulate people at will."` and `"Don't try to manipulate me."` are left out, because `indexOf` returns `-1`.

## 4. Let the client paint the span

The page rebuilds the highlight from the indexes:

```ts
const before = sentence.slice(0, start)
const match = sentence.slice(start, end)
const after = sentence.slice(end)
```

`before` is plain text, `match` goes inside `<mark>` or `<strong>`, and `after` is plain text again. The server no longer has to guess that the client wants `**`.

Your punctuation loop still works if you want the period or question mark inside the span. Advance `end` the same way, then return that larger `end`. On the first sentence that changes `end` from `20` to `21`, so the client highlights `"it was worth it."` including the period.

---

**User**

teach me how flatmap works in the baby style

---

**Cursor**

I’ll use the `flatMap` in your route so the explanation sits on code you already wrote.

`flatMap` walks through a list, turns each item into a little list, then dumps those little lists into one big list.

In `findMatches` you start with five sentences. For each one, `locate` either finds the phrase or returns `null`. You want a list of matches only, with the misses gone.

```64:67:src/index.ts
  return EXAMPLES.flatMap((sentence) => {
    const match = locate(sentence, text);
    return match === null ? [] : [match];
  });
```

Picture five friends and a bowl. You ask each friend for a snack.

- A friend who has one puts it in a small bag and hands you the bag: `[match]`.
- A friend who has none hands you an empty bag: `[]`.

`flatMap` opens every bag and pours it into one bowl. Empty bags add nothing. You never get bags inside the bowl, only snacks.

For `text = "it was worth it"`, the five bags are:

```text
[ { sentence: "God, it was worth it.", start: 5, end: 20 } ]
[ { sentence: "Do you think it was worth it?", start: 13, end: 28 } ]
[ { sentence: "But look at your face, it was worth it.", start: 23, end: 38 } ]
[]
[]
```

Poured into one bowl:

```text
[
  { sentence: "God, it was worth it.", start: 5, end: 20 },
  { sentence: "Do you think it was worth it?", start: 13, end: 28 },
  { sentence: "But look at your face, it was worth it.", start: 23, end: 38 }
]
```

The line `match === null ? [] : [match]` is the bag. `[]` means "skip this sentence." `[match]` means "keep this one match." The brackets around `match` matter: `flatMap` expects a list back from each step, even when that list holds a single match.

