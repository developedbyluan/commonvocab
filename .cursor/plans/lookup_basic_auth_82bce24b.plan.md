---
name: Lookup basic auth
overview: Require HTTP Basic authentication on POST /entries/lookup before any database or OpenAI work. GET lookup and the other entry routes stay unchanged.
todos:
  - id: auth
    content: Require Basic auth on POST /entries/lookup and return 401 before any database or OpenAI work.
    status: completed
  - id: verify
    content: Confirm a missing header and a wrong password return 401, and the correct credentials still return a finished entry.
    status: completed
isProject: false
---

# Protect POST /entries/lookup with Basic auth

Only [POST /entries/lookup](src/entries.ts) requires a username and password. GET `/entries/lookup` and the other entry routes stay open.

The existing rate limiters still run first. A caller who is under the limit then reaches the route, which checks the `Authorization` header before reading the JSON body, querying D1, or calling OpenAI.

## Credentials

Add two Worker secrets, using the same local `.env` file Wrangler already loads for `OPENAI_API_KEY`. Do not put the values in [wrangler.jsonc](wrangler.jsonc).

- `BASIC_AUTH_USERNAME`
- `BASIC_AUTH_PASSWORD`

Extend the bindings type in [src/entries.ts](src/entries.ts) with those two strings. For the remote Worker, set them with `npx wrangler secret put BASIC_AUTH_USERNAME` and `npx wrangler secret put BASIC_AUTH_PASSWORD`.

If either secret is missing, or the header is missing, malformed, or does not match, return **401**:

```json
{ "error": "unauthorized" }
```

Also set `WWW-Authenticate: Basic realm="entries"`. Compare the username and password with `crypto.subtle.timingSafeEqual` when the lengths match, so the response does not reveal which value was wrong.

In Insomnia, open the request’s **Auth** tab, choose **Basic**, and enter the same username and password. Leave the JSON body as it is.

## Check

With the local server running and both secrets present, send POST `/entries/lookup` with no `Authorization` header and expect 401. Send a wrong password and expect 401. Send the correct credentials for a span that already has a finished entry and expect 200 with that stored entry. Delete any row created by the check.
