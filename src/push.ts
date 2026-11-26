import { Hono, type MiddlewareHandler } from "hono";

// Push notifications for newly pinned messages.
//
// The Practice Offline app registers each phone's Expo push token here
// (POST /push-tokens) and removes it on sign-out (DELETE /push-tokens). When a message
// becomes pinned, notifyNewPin() sends a "New event" push through Expo's push service to
// every user who can see the message. See docs/push_notifications.md.

type Bindings = CloudflareBindings & {
  BASIC_AUTH_USERNAME: string;
  BASIC_AUTH_PASSWORD: string;
  CHAT_OWNER_USER_ID?: string;
  // Only needed if "enhanced push security" is turned on in the Expo dashboard.
  EXPO_ACCESS_TOKEN?: string;
};

type Provider = "expo" | "apns" | "fcm";
type Platform = "android" | "ios";

type PushTokenRow = {
  token: string;
  user_id: string;
  provider: Provider;
  platform: Platform;
  created_at: number;
  updated_at: number;
};

const PROVIDERS: readonly Provider[] = ["expo", "apns", "fcm"];
const PLATFORMS: readonly Platform[] = ["android", "ios"];

// Must match the app: the Android channel it creates, and the data type its tap handler
// looks for (opens the Pinned tab).
const CHANNEL_ID = "new-events";
const DATA_TYPE = "new-pinned";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Expo accepts up to 100 messages per request.
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 3;

// The /push-tokens routes, behind the same Basic auth and rate limit as the chat routes.
// The middleware must be registered before the routes, so they're built here.
export function createPushTokenRoutes(protect: MiddlewareHandler<{ Bindings: Bindings }>) {
  const pushTokens = new Hono<{ Bindings: Bindings }>();
  pushTokens.use("*", protect);

  // Registers a phone, or moves its token to another user (a phone can switch accounts).
  pushTokens.post("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    const input = parseRegistration(body);
    if ("error" in input) return c.json(input, 400);

    try {
      const user = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?`)
        .bind(input.user_id)
        .first<{ id: string }>();
      if (!user) return c.json({ error: "user not found" }, 400);

      const now = unixSeconds();
      const row = await c.env.DB.prepare(
        `INSERT INTO push_tokens (token, user_id, provider, platform, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT (token) DO UPDATE SET
           user_id = excluded.user_id,
           provider = excluded.provider,
           platform = excluded.platform,
           updated_at = MAX(excluded.updated_at, push_tokens.created_at)
         RETURNING token, user_id, provider, platform, created_at, updated_at`,
      )
        .bind(input.token, input.user_id, input.provider, input.platform, now)
        .first<PushTokenRow>();
      if (!row) return c.json({ error: "database query failed" }, 500);
      return c.json(row, row.created_at === now ? 201 : 200);
    } catch (error) {
      return databaseError(c.req.path, c, error);
    }
  });

  // Removes a phone's registration. Both the token and its user must match.
  pushTokens.delete("/", async (c) => {
    const token = c.req.query("token")?.trim();
    const userId = c.req.query("user_id")?.trim();
    if (!token) return c.json({ error: "token is required" }, 400);
    const userError = checkUserId(userId);
    if (userError) return c.json({ error: userError }, 400);

    try {
      const deleted = await c.env.DB.prepare(
        `DELETE FROM push_tokens WHERE token = ? AND user_id = ?`,
      )
        .bind(token, userId)
        .run();
      if (!deleted.meta.changes) return c.json({ error: "push token not found" }, 404);
      return c.json({ token, user_id: userId });
    } catch (error) {
      return databaseError(c.req.path, c, error);
    }
  });

  return pushTokens;
}

// The message fields notifyNewPin needs.
export type PinnedMessageForPush = {
  id: number;
  user_id: string;
  body: string;
  secret: number;
  allowed_roles: string;
  pinned_range: string | null;
};

// Whether an update should announce the message: it just became pinned (it wasn't before,
// or it's new), and its time window, if any, hasn't ended. Edits and re-ranking of an
// already pinned message don't announce it again.
export function shouldAnnouncePin(
  wasPinned: boolean,
  isPinned: boolean,
  pinnedRange: { start: number; end: number } | null,
): boolean {
  if (!isPinned || wasPinned) return false;
  return pinnedRange === null || pinnedRange.end > unixSeconds();
}

// Sends "New event" to every user who can see the message, except whoever pinned it.
// Meant for executionCtx.waitUntil: it never throws, and logs what happened.
export async function notifyNewPin(
  env: Bindings,
  message: PinnedMessageForPush,
  actorId: string,
): Promise<void> {
  try {
    const tokens = await recipientTokens(env, message, actorId);
    if (tokens.length === 0) return;
    const title = "New event";
    const body = firstLine(message.body);
    let sent = 0;
    const dead: string[] = [];
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);
      const tickets = await sendBatch(env, batch, {
        title,
        body,
        data: { type: DATA_TYPE, messageId: message.id },
      });
      tickets.forEach((ticket, index) => {
        if (ticket.status === "ok") sent += 1;
        else if (ticket.details?.error === "DeviceNotRegistered") dead.push(batch[index]);
        else console.warn(JSON.stringify({ message: "push ticket error", ticket }));
      });
    }
    if (dead.length > 0) await deleteTokens(env.DB, dead);
    console.log(
      JSON.stringify({
        message: "new pin pushed",
        message_id: message.id,
        recipients: tokens.length,
        sent,
        removed: dead.length,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "new pin push failed",
        message_id: message.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

// Expo tokens of users allowed to see the message: their role is in allowed_roles (the chat
// owner sees everything), and for a secret message only the author and the owner.
async function recipientTokens(
  env: Bindings,
  message: PinnedMessageForPush,
  actorId: string,
): Promise<string[]> {
  const owner = env.CHAT_OWNER_USER_ID ?? "";
  const { results } = await env.DB.prepare(
    `SELECT pt.token
     FROM push_tokens pt
     JOIN users u ON u.id = pt.user_id
     WHERE pt.provider = 'expo'
       AND u.id <> ?1
       AND (
         CASE WHEN ?2 = 1
           THEN u.id = ?3 OR (?4 <> '' AND u.id = ?4)
           ELSE (?4 <> '' AND u.id = ?4)
             OR u.role IN (SELECT value FROM json_each(?5))
         END
       )`,
  )
    .bind(actorId, message.secret, message.user_id, owner, message.allowed_roles)
    .all<{ token: string }>();
  return results.map((row) => row.token);
}

type ExpoTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message?: string; details?: { error?: string } };

type PushContent = {
  title: string;
  body: string;
  data: Record<string, unknown>;
};

// One request to Expo, retried with backoff on 429 and 5xx.
async function sendBatch(
  env: Bindings,
  tokens: string[],
  content: PushContent,
): Promise<ExpoTicket[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
  const payload = tokens.map((to) => ({
    to,
    ...content,
    channelId: CHANNEL_ID,
    priority: "high",
  }));

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < MAX_ATTEMPTS) {
      await sleep(500 * 2 ** (attempt - 1));
      continue;
    }
    if (!res.ok) throw new Error(`Expo push failed: HTTP ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { data?: ExpoTicket[] };
    return Array.isArray(json.data) ? json.data : [];
  }
}

async function deleteTokens(db: D1Database, tokens: string[]) {
  await db.batch(
    tokens.map((token) => db.prepare(`DELETE FROM push_tokens WHERE token = ?`).bind(token)),
  );
}

// The message's first non-empty line without markdown heading marks, as the app shows it.
function firstLine(body: string): string {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim().replace(/^#{1,6}\s*/, "").trim();
    if (line) return line.length > 178 ? `${line.slice(0, 177)}…` : line;
  }
  return "A new event was pinned.";
}

function parseRegistration(
  value: unknown,
):
  | { user_id: string; token: string; provider: Provider; platform: Platform }
  | { error: string } {
  if (typeof value !== "object" || value === null) return { error: "body must be an object" };
  const body = value as Record<string, unknown>;
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : undefined;
  const userError = checkUserId(userId);
  if (userError) return { error: userError };
  if (typeof body.token !== "string" || !body.token.trim()) {
    return { error: "token must be a non-empty string" };
  }
  const token = body.token.trim();
  if (token.length > 512) return { error: "token must be at most 512 characters" };
  const provider = body.provider ?? "expo";
  if (!PROVIDERS.includes(provider as Provider)) {
    return { error: `provider must be one of: ${PROVIDERS.join(", ")}` };
  }
  if (provider === "expo" && !/^Expo(nent)?PushToken\[.+\]$/.test(token)) {
    return { error: "token is not an Expo push token" };
  }
  if (!PLATFORMS.includes(body.platform as Platform)) {
    return { error: `platform must be one of: ${PLATFORMS.join(", ")}` };
  }
  return {
    user_id: userId as string,
    token,
    provider: provider as Provider,
    platform: body.platform as Platform,
  };
}

function checkUserId(userId: string | undefined): string | null {
  if (!userId) return "user_id is required";
  if (!userId.startsWith("user_")) return "user_id must start with user_";
  if (userId.length > 64) return "user_id must be at most 64 characters";
  return null;
}

function unixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function databaseError(
  path: string,
  c: { json: (body: unknown, status: 500) => Response },
  error: unknown,
): Response {
  console.error(
    JSON.stringify({
      message: "d1 query failed",
      path,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return c.json({ error: "database query failed" }, 500);
}
