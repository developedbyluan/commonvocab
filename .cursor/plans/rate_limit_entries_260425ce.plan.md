---
name: Rate limit entries
overview: Add two Workers rate-limit bindings so lookup is limited per user_id and the other entry routes are limited per IP. A caller who exceeds the limit gets 429.
todos:
  - id: bindings
    content: Add LOOKUP_LIMITER and ENTRIES_LIMITER to wrangler.jsonc and regenerate Worker types.
    status: completed
  - id: middleware
    content: Add an entries middleware that returns 429 before any D1 call when a limiter rejects the key.
    status: completed
  - id: verify
    content: Burst the local lookup route and confirm the 11th request is rejected without another insert.
    status: completed
isProject: false
---

# Rate limit the entry routes

Yes. This is the simple control that fits the current Worker. It counts calls inside the Worker, so it works on `workers.dev` without a custom domain. Cloudflare still absorbs large network floods before the code runs. This limit stops one caller from repeating `GET /entries/lookup`, which inserts a row on a miss.

Only [wrangler.jsonc](wrangler.jsonc) and [src/entries.ts](src/entries.ts) change. `GET /` stays unlimited.

## Bindings

Add this to [wrangler.jsonc](wrangler.jsonc). The installed Wrangler schema requires `name`, `namespace_id`, and `simple`. `period` can only be `10` or `60`.

```jsonc
"ratelimits": [
  {
    "name": "LOOKUP_LIMITER",
    "namespace_id": "1001",
    "simple": { "limit": 10, "period": 60 }
  },
  {
    "name": "ENTRIES_LIMITER",
    "namespace_id": "1002",
    "simple": { "limit": 30, "period": 60 }
  }
]
```

Lookup allows 10 requests per `user_id` per minute. The other `/entries` routes allow 30 requests per IP per minute. Lookup is checked against both, so a single IP cannot fan out through many `user_id` values without also hitting the IP limit.

Run `npm run cf-typegen` after the config change so `CloudflareBindings` includes both limiters.

## Check

Add one Hono middleware at the top of the `entries` router in [src/entries.ts](src/entries.ts), before the routes. It reads the path and calls `limit({ key })`.

- For `/lookup`, the key is the `user_id` query value when it starts with `user_` and is at most 64 characters. Otherwise the key is the client IP. That still limits requests that omit or fake `user_id`.
- For every other entry route, the key is the client IP from the `cf-connecting-ip` header. If that header is missing, use `unknown`.
- Lookup calls `LOOKUP_LIMITER` and then `ENTRIES_LIMITER`. The other routes call only `ENTRIES_LIMITER`.
- When `success` is false, return `{ "error": "too many requests" }` with status 429 and do not touch D1.

The same `user_id` shares one lookup counter from every IP. A different `user_id` gets its own lookup counter, and the IP limit still applies.

## Verify

With `bun run dev`, send 11 lookup requests in a minute for one `user_id`. Request 11 returns 429 and does not insert another row. A normal `GET /entries` under the IP limit still returns 200.
