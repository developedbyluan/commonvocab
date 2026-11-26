# Push notifications for new pinned messages

The Practice Offline Android app shows pinned messages on its Pinned tab. When a message becomes pinned, the worker sends a **"New event"** push to everyone who can see it. The push goes through **Expo's push service**, which forwards it to Firebase Cloud Messaging for Android, and to Apple later on.

## Storage: `push_tokens` (migration 0021)

| column | notes |
| --- | --- |
| `token` | primary key, one row per phone, e.g. `ExponentPushToken[…]` |
| `user_id` | the Clerk user id; it must exist in `users` (`ON DELETE CASCADE`) |
| `provider` | `expo` today; `apns` and `fcm` are reserved for a future native app |
| `platform` | `android` or `ios` |
| `created_at`, `updated_at` | Unix seconds |

## Routes (Basic auth, the chat rate limit)

- `POST /push-tokens` `{ user_id, token, provider?, platform }`: registers the phone, or moves an existing token to this user. `provider` defaults to `expo`, and an `expo` token must look like `ExponentPushToken[…]`. It returns the row, with `201` when new and `200` when it was already there.
- `DELETE /push-tokens?token=&user_id=`: removes the row when both match, otherwise returns `404`. The app treats `404` as already removed.

The app calls these on sign-in, sign-out, account switches, the Settings switch and token changes.

## When a push is sent

`shouldAnnouncePin` in `src/push.ts` is checked after `POST /messages`, `PATCH /messages/:id` and `PUT /messages/:id`. A push goes out only when both are true:
- the message **just became pinned**: it wasn't pinned before, or it's new and created pinned;
- its `pinned_range` is empty, or hasn't ended yet.

Re-ranking, editing or re-saving an already pinned message does **not** send again. Unpinning and pinning again does.

The send runs in `executionCtx.waitUntil`, so the API response isn't delayed. It never fails the request, and its result is logged as `new pin pushed` with counts.

## Who gets it

These are the same people who can see the message, minus whoever pinned it:
- **A normal message:** users whose `role` is in `allowed_roles`, plus the chat owner.
- **A secret message:** only its author and the chat owner.

## The push

```json
{
  "to": "ExponentPushToken[…]",
  "title": "New event",
  "body": "<first line of the message, without # marks>",
  "data": { "type": "new-pinned", "messageId": 114 },
  "channelId": "new-events",
  "priority": "high"
}
```

`channelId` and `data.type` must match the app:
- **`new-events`** is the Android channel the app creates. Android drops a push sent to an unknown channel.
- **`new-pinned`** is what makes a tap open the Pinned tab.

**How it's sent:**
- **Batches:** messages go out in batches of 100, which is Expo's limit.
- **Retries:** 429 and 5xx responses are retried up to 3 times, with backoff.
- **Dead tokens:** tickets that fail with `DeviceNotRegistered` delete that token.
- **Receipts:** they aren't checked yet (that would need a Cron Trigger). A dead token is still removed by the next push that reaches it.

## Configuration

- **Nothing new is required.** Expo's push API needs no key by default.
- **`EXPO_ACCESS_TOKEN` (optional secret):** only needed if "enhanced push security" is turned on in the Expo dashboard. Set it with `npx wrangler secret put EXPO_ACCESS_TOKEN`.

## Testing

- **Locally:** run `npx wrangler d1 migrations apply commonvocab --local`, then `npx wrangler dev`. Register a token with `POST /push-tokens`, then create a pinned message as the chat owner and watch the log for `new pin pushed`. A fake token comes back as `DeviceNotRegistered` and is deleted.
- **On a phone:** with the app's push-enabled build, sign in, allow notifications, then pin a message. The phone shows "New event", and tapping it opens the Pinned tab.
