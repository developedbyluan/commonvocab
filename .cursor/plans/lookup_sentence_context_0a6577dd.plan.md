---
name: Lookup sentence context
overview: Require previous, current, and next on every POST /entries/lookup. Use them only to make the OpenAI definition, part of speech, and phonetic match the surrounding lines. Do not store or return them.
todos:
  - id: validate
    content: Require previous, current, and next on POST /entries/lookup, and reject a current line that does not contain input_text.
    status: completed
  - id: prompt
    content: Pass the three lines to the OpenAI prompt only when generating a missing or pending entry.
    status: completed
  - id: verify
    content: Check missing context, a line that does not contain the word, a finished entry, and one generated meaning, then delete the test row.
    status: completed
isProject: false
---

# Add sentence context to POST /entries/lookup

Every [POST /entries/lookup](src/entries.ts) body keeps the six fields it has now and adds three strings:

- `previous`: the line before, or `""`
- `current`: the line that contains `input_text`
- `next`: the line after, or `""`

Basic auth still runs first. `parseLookup` then requires all three keys. `previous` and `next` are trimmed strings and may be empty. `current` is trimmed and must not be empty. After trimming, `current` must contain `input_text` using a case-insensitive comparison. A missing key returns `previous must be a string`, `current must be a string`, or `next must be a string`. An empty `current` returns `current must not be empty`. A line that does not contain the word returns `current must contain input_text`.

These fields are not saved and are not part of the response. A finished row still has to send them, and the route then ignores them and returns the stored entry. A text mismatch stays 400 and does not call OpenAI. A missing or pending row passes `previous`, `current`, `next`, and `input_text` to `generateLookupFields`. The prompt tells the model to define that word as it is used in `current`, with the neighboring lines as context. The saved fields stay `definition`, `part_of_speech`, `phonetic`, and status `editorpicked`.

No migration. GET `/entries/lookup` stays unchanged.

## Check

With the local server running, a body missing `current` returns 400. A `current` that does not contain `input_text` returns 400. A finished entry sent with `previous: ""`, a matching `current`, and `next: ""` returns the stored entry. A missing span for an ambiguous word, with context that fixes its meaning, returns 200 with status `editorpicked` and a definition that matches that context. Delete the row created by the check.
