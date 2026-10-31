import { Hono, type MiddlewareHandler } from "hono";

type FieldError = { error: string };

type Bindings = CloudflareBindings & {
  BASIC_AUTH_USERNAME: string;
  BASIC_AUTH_PASSWORD: string;
  CHAT_OWNER_USER_ID?: string;
};

type UserRow = {
  id: string;
  display_name: string;
  created_at: number;
};

type MessageLink = {
  id: number;
  text: string;
  url: string;
  note: string;
};

type MessageRow = {
  id: number;
  user_id: string;
  display_name: string;
  body: string;
  secret: number;
  links: string;
  pinned: number;
  pin_rank: number | null;
  created_at: number;
  updated_at: number;
  reply_count: number;
  like_count: number;
};

type ReplyRow = {
  id: number;
  message_id: number;
  user_id: string;
  display_name: string;
  body: string;
  secret: number;
  created_at: number;
  updated_at: number;
};

type ReplyAccess = ReplyRow & {
  message_user_id: string;
  message_secret: number;
};

type LikeRow = {
  message_id: number;
  user_id: string;
  display_name: string;
  created_at: number;
};

type ChatContext = {
  env: Bindings;
  req: {
    header: (name: string) => string | undefined;
    query: (name: string) => string | undefined;
    param: (name: string) => string | undefined;
    json: () => Promise<unknown>;
    path: string;
  };
  header: (name: string, value: string) => void;
  json: (body: unknown, status?: number) => Response;
};

const MESSAGE_SELECT = `SELECT m.id, m.user_id, u.display_name, m.body, m.secret, m.links, m.pinned, m.pin_rank, m.created_at, m.updated_at,
       (SELECT COUNT(*) FROM replies r
        WHERE r.message_id = m.id
          AND (r.secret = 0 OR r.user_id = ?1 OR m.user_id = ?1 OR ?1 = ?2)
       ) AS reply_count,
       (SELECT COUNT(*) FROM likes l WHERE l.message_id = m.id) AS like_count
     FROM messages m
     JOIN users u ON u.id = m.user_id`;

const REPLY_SELECT = `SELECT r.id, r.message_id, r.user_id, u.display_name, r.body, r.secret, r.created_at, r.updated_at
     FROM replies r
     JOIN users u ON u.id = r.user_id`;

const users = new Hono<{ Bindings: Bindings }>();
const messages = new Hono<{ Bindings: Bindings }>();
const replies = new Hono<{ Bindings: Bindings }>();

const protect: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const limited = await c.env.CHAT_LIMITER.limit({ key: ip });
  if (!limited.success) return c.json({ error: "too many requests" }, 429);

  const allowed = basicAuthMatches(
    c.req.header("authorization"),
    c.env.BASIC_AUTH_USERNAME,
    c.env.BASIC_AUTH_PASSWORD,
  );
  if (!allowed) {
    c.header("WWW-Authenticate", 'Basic realm="chat"');
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};

users.use("*", protect);
messages.use("*", protect);
replies.use("*", protect);

users.post("/", async (c) => {
  const body = await readJson(c);
  if (body instanceof Response) return body;
  const input = parseCreateUser(body);
  if (isFieldError(input)) return c.json(input, 400);

  const createdAt = unixSeconds();
  try {
    const row = await c.env.DB.prepare(
      `INSERT INTO users (id, display_name, created_at)
       VALUES (?, ?, ?)
       RETURNING id, display_name, created_at`,
    )
      .bind(input.id, input.display_name, createdAt)
      .first<UserRow>();
    if (!row) return c.json({ error: "database query failed" }, 500);
    return c.json(row, 201);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ error: "user already exists" }, 409);
    }
    return databaseError(c, error);
  }
});

users.get("/", async (c) => {
  const bounds = page(c);
  if (isFieldError(bounds)) return c.json(bounds, 400);

  try {
    const { results } = await c.env.DB.prepare(
      `SELECT id, display_name, created_at
       FROM users
       ORDER BY created_at, id
       LIMIT ?1 OFFSET ?2`,
    )
      .bind(bounds.limit, bounds.offset)
      .all<UserRow>();
    return c.json(results);
  } catch (error) {
    return databaseError(c, error);
  }
});

users.get("/:id", async (c) => {
  const id = requiredUserId(c.req.param("id"));
  if (isFieldError(id)) return c.json(id, 400);

  try {
    const row = await findUser(c.env.DB, id);
    if (!row) return c.json({ error: "user not found" }, 404);
    return c.json(row);
  } catch (error) {
    return databaseError(c, error);
  }
});

users.put("/:id", async (c) => {
  const id = requiredUserId(c.req.param("id"));
  if (isFieldError(id)) return c.json(id, 400);
  const body = await readJson(c);
  if (body instanceof Response) return body;
  const input = parseActorName(body);
  if (isFieldError(input)) return c.json(input, 400);

  try {
    const actor = await findUser(c.env.DB, input.user_id);
    if (!actor) return c.json({ error: "user not found" }, 400);
    const row = await findUser(c.env.DB, id);
    if (!row) return c.json({ error: "user not found" }, 404);
    if (!canMutate(input.user_id, row.id, c.env.CHAT_OWNER_USER_ID)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const updated = await c.env.DB.prepare(
      `UPDATE users SET display_name = ? WHERE id = ?
       RETURNING id, display_name, created_at`,
    )
      .bind(input.display_name, id)
      .first<UserRow>();
    if (!updated) return c.json({ error: "user not found" }, 404);
    return c.json(updated);
  } catch (error) {
    return databaseError(c, error);
  }
});

users.delete("/:id", async (c) => {
  const id = requiredUserId(c.req.param("id"));
  if (isFieldError(id)) return c.json(id, 400);
  const actorId = requiredQueryUserId(c.req.query("user_id"));
  if (isFieldError(actorId)) return c.json(actorId, 400);

  try {
    const actor = await findUser(c.env.DB, actorId);
    if (!actor) return c.json({ error: "user not found" }, 400);
    const row = await findUser(c.env.DB, id);
    if (!row) return c.json({ error: "user not found" }, 404);
    if (!canMutate(actorId, row.id, c.env.CHAT_OWNER_USER_ID)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const refs = await c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM messages WHERE user_id = ?1) +
         (SELECT COUNT(*) FROM replies WHERE user_id = ?1) +
         (SELECT COUNT(*) FROM likes WHERE user_id = ?1) AS refs`,
    )
      .bind(id)
      .first<{ refs: number }>();
    if ((refs?.refs ?? 0) > 0) {
      return c.json({ error: "user has messages, replies, or likes" }, 409);
    }

    const deleted = await c.env.DB.prepare(
      `DELETE FROM users WHERE id = ? RETURNING id, display_name, created_at`,
    )
      .bind(id)
      .first<UserRow>();
    if (!deleted) return c.json({ error: "user not found" }, 404);
    return c.json(deleted);
  } catch (error) {
    return databaseError(c, error);
  }
});

messages.post("/", async (c) => {
  const body = await readJson(c);
  if (body instanceof Response) return body;
  const input = parseAuthorBody(body);
  if (isFieldError(input)) return c.json(input, 400);

  try {
    const author = await findUser(c.env.DB, input.user_id);
    if (!author) return c.json({ error: "user not found" }, 400);
    const pin = decidePin(input, null, input.user_id, c.env.CHAT_OWNER_USER_ID);
    if ("status" in pin) return c.json({ error: pin.error }, pin.status);
    const now = unixSeconds();
    const row = await c.env.DB.prepare(
      `INSERT INTO messages (user_id, body, secret, links, pinned, pin_rank, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id, user_id, body, secret, links, pinned, pin_rank, created_at, updated_at`,
    )
      .bind(
        input.user_id,
        input.body,
        input.secret ? 1 : 0,
        JSON.stringify(input.links ?? []),
        pin.pinned,
        pin.pin_rank,
        now,
        now,
      )
      .first<Omit<MessageRow, "display_name" | "reply_count" | "like_count">>();
    if (!row) return c.json({ error: "database query failed" }, 500);
    return c.json(presentMessage(asMessage(row, author.display_name, 0, 0)), 201);
  } catch (error) {
    return databaseError(c, error);
  }
});

messages.get("/", async (c) => {
  const viewer = await requireViewer(c);
  if (viewer instanceof Response) return viewer;
  const bounds = page(c);
  if (isFieldError(bounds)) return c.json(bounds, 400);

  try {
    const owner = chatOwner(c.env.CHAT_OWNER_USER_ID);
    const { results } = await c.env.DB.prepare(
      `${MESSAGE_SELECT}
       WHERE m.secret = 0 OR m.user_id = ?1 OR ?1 = ?2
       ORDER BY m.id DESC
       LIMIT ?3 OFFSET ?4`,
    )
      .bind(viewer.id, owner, bounds.limit, bounds.offset)
      .all<MessageRow>();
    return c.json(results.map(presentMessage));
  } catch (error) {
    return databaseError(c, error);
  }
});

messages.post("/:id/replies", async (c) => {
  const messageId = parseId(c.req.param("id"));
  if (messageId === null) {
    return c.json({ error: "id must be a positive integer" }, 400);
  }
  const body = await readJson(c);
  if (body instanceof Response) return body;
  const input = parseAuthorBody(body);
  if (isFieldError(input)) return c.json(input, 400);

  try {
    const author = await findUser(c.env.DB, input.user_id);
    if (!author) return c.json({ error: "user not found" }, 400);
    const owner = chatOwner(c.env.CHAT_OWNER_USER_ID);
    const message = await findMessage(c.env.DB, messageId, input.user_id, owner);
    if (
      !message ||
      !canSeeMessage(input.user_id, message.user_id, message.secret, owner)
    ) {
      return c.json({ error: "message not found" }, 404);
    }
    const now = unixSeconds();
    const row = await c.env.DB.prepare(
      `INSERT INTO replies (message_id, user_id, body, secret, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING id, message_id, user_id, body, secret, created_at, updated_at`,
    )
      .bind(messageId, input.user_id, input.body, input.secret ? 1 : 0, now, now)
      .first<Omit<ReplyRow, "display_name">>();
    if (!row) return c.json({ error: "database query failed" }, 500);
    return c.json(presentReply({ ...row, display_name: author.display_name }), 201);
  } catch (error) {
    return databaseError(c, error);
  }
});

messages.get("/:id/replies", async (c) => {
  const messageId = parseId(c.req.param("id"));
  if (messageId === null) {
    return c.json({ error: "id must be a positive integer" }, 400);
  }
  const viewer = await requireViewer(c);
  if (viewer instanceof Response) return viewer;
  const bounds = page(c);
  if (isFieldError(bounds)) return c.json(bounds, 400);

  try {
    const owner = chatOwner(c.env.CHAT_OWNER_USER_ID);
    const message = await findMessage(c.env.DB, messageId, viewer.id, owner);
    if (
      !message ||
      !canSeeMessage(viewer.id, message.user_id, message.secret, owner)
    ) {
      return c.json({ error: "message not found" }, 404);
    }
    const { results } = await c.env.DB.prepare(
      `${REPLY_SELECT}
       WHERE r.message_id = ?1
         AND (r.secret = 0 OR r.user_id = ?2 OR ?3 = ?2 OR ?2 = ?4)
       ORDER BY r.id
       LIMIT ?5 OFFSET ?6`,
    )
      .bind(messageId, viewer.id, message.user_id, owner, bounds.limit, bounds.offset)
      .all<ReplyRow>();
    return c.json(results.map(presentReply));
  } catch (error) {
    return databaseError(c, error);
  }
});

messages.post("/:id/likes", async (c) => {
  const messageId = parseId(c.req.param("id"));
  if (messageId === null) {
    return c.json({ error: "id must be a positive integer" }, 400);
  }
  const body = await readJson(c);
  if (body instanceof Response) return body;
  const input = parseActor(body);
  if (isFieldError(input)) return c.json(input, 400);

  try {
    const actor = await findUser(c.env.DB, input.user_id);
    if (!actor) return c.json({ error: "user not found" }, 400);
    const owner = chatOwner(c.env.CHAT_OWNER_USER_ID);
    const message = await findMessage(c.env.DB, messageId, input.user_id, owner);
    if (
      !message ||
      !canSeeMessage(input.user_id, message.user_id, message.secret, owner)
    ) {
      return c.json({ error: "message not found" }, 404);
    }

    const now = unixSeconds();
    await c.env.DB.prepare(
      `INSERT INTO likes (message_id, user_id, created_at) VALUES (?, ?, ?)`,
    )
      .bind(messageId, input.user_id, now)
      .run();
    const like: LikeRow = {
      message_id: messageId,
      user_id: actor.id,
      display_name: actor.display_name,
      created_at: now,
    };
    return c.json(like, 201);
  } catch (error) {
    if (isUniqueViolation(error)) return c.json({ error: "already liked" }, 409);
    return databaseError(c, error);
  }
});

messages.get("/:id/likes", async (c) => {
  const messageId = parseId(c.req.param("id"));
  if (messageId === null) {
    return c.json({ error: "id must be a positive integer" }, 400);
  }
  const viewer = await requireViewer(c);
  if (viewer instanceof Response) return viewer;
  const bounds = page(c);
  if (isFieldError(bounds)) return c.json(bounds, 400);

  try {
    const owner = chatOwner(c.env.CHAT_OWNER_USER_ID);
    const message = await findMessage(c.env.DB, messageId, viewer.id, owner);
    if (
      !message ||
      !canSeeMessage(viewer.id, message.user_id, message.secret, owner)
    ) {
      return c.json({ error: "message not found" }, 404);
    }
    const { results } = await c.env.DB.prepare(
      `SELECT l.message_id, l.user_id, u.display_name, l.created_at
       FROM likes l
       JOIN users u ON u.id = l.user_id
       WHERE l.message_id = ?1
       ORDER BY l.created_at, l.user_id
       LIMIT ?2 OFFSET ?3`,
    )
      .bind(messageId, bounds.limit, bounds.offset)
      .all<LikeRow>();
    return c.json(results);
  } catch (error) {
    return databaseError(c, error);
  }
});

messages.delete("/:id/likes/:userId", async (c) => {
  const messageId = parseId(c.req.param("id"));
  if (messageId === null) {
    return c.json({ error: "id must be a positive integer" }, 400);
  }
  const likerId = requiredUserId(c.req.param("userId"));
  if (isFieldError(likerId)) return c.json(likerId, 400);
  const actorId = requiredQueryUserId(c.req.query("user_id"));
  if (isFieldError(actorId)) return c.json(actorId, 400);

  try {
    const actor = await findUser(c.env.DB, actorId);
    if (!actor) return c.json({ error: "user not found" }, 400);
    const owner = chatOwner(c.env.CHAT_OWNER_USER_ID);
    const message = await findMessage(c.env.DB, messageId, actorId, owner);
    if (
      !message ||
      !canSeeMessage(actorId, message.user_id, message.secret, owner)
    ) {
      return c.json({ error: "message not found" }, 404);
    }
    const like = await findLike(c.env.DB, messageId, likerId);
    if (!like) return c.json({ error: "like not found" }, 404);
    if (!canMutate(actorId, like.user_id, c.env.CHAT_OWNER_USER_ID)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const deleted = await c.env.DB.prepare(
      `DELETE FROM likes WHERE message_id = ? AND user_id = ?`,
    )
      .bind(messageId, likerId)
      .run();
    if (!deleted.meta.changes) return c.json({ error: "like not found" }, 404);
    return c.json(like);
  } catch (error) {
    return databaseError(c, error);
  }
});

messages.get("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "id must be a positive integer" }, 400);
  const viewer = await requireViewer(c);
  if (viewer instanceof Response) return viewer;
  const bounds = page(c);
  if (isFieldError(bounds)) return c.json(bounds, 400);

  try {
    const owner = chatOwner(c.env.CHAT_OWNER_USER_ID);
    const row = await findMessage(c.env.DB, id, viewer.id, owner);
    if (!row || !canSeeMessage(viewer.id, row.user_id, row.secret, owner)) {
      return c.json({ error: "message not found" }, 404);
    }
    const { results } = await c.env.DB.prepare(
      `${REPLY_SELECT}
       WHERE r.message_id = ?1
         AND (r.secret = 0 OR r.user_id = ?2 OR ?3 = ?2 OR ?2 = ?4)
       ORDER BY r.id
       LIMIT ?5 OFFSET ?6`,
    )
      .bind(id, viewer.id, row.user_id, owner, bounds.limit, bounds.offset)
      .all<ReplyRow>();
    return c.json({ ...presentMessage(row), replies: results.map(presentReply) });
  } catch (error) {
    return databaseError(c, error);
  }
});

messages.put("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "id must be a positive integer" }, 400);
  const body = await readJson(c);
  if (body instanceof Response) return body;
  const input = parseAuthorBody(body);
  if (isFieldError(input)) return c.json(input, 400);

  try {
    const actor = await findUser(c.env.DB, input.user_id);
    if (!actor) return c.json({ error: "user not found" }, 400);
    const owner = chatOwner(c.env.CHAT_OWNER_USER_ID);
    const row = await findMessage(c.env.DB, id, input.user_id, owner);
    if (!row) return c.json({ error: "message not found" }, 404);
    if (!canMutate(input.user_id, row.user_id, c.env.CHAT_OWNER_USER_ID)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const pin = decidePin(input, row, input.user_id, c.env.CHAT_OWNER_USER_ID);
    if ("status" in pin) return c.json({ error: pin.error }, pin.status);
    const secret = input.secret === undefined ? row.secret : input.secret ? 1 : 0;
    const links =
      input.links === undefined ? row.links : JSON.stringify(input.links);
    await c.env.DB.prepare(
      `UPDATE messages SET body = ?, secret = ?, links = ?, pinned = ?, pin_rank = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(
        input.body,
        secret,
        links,
        pin.pinned,
        pin.pin_rank,
        Math.max(unixSeconds(), row.created_at),
        id,
      )
      .run();
    const updated = await findMessage(c.env.DB, id, input.user_id, owner);
    if (!updated) return c.json({ error: "message not found" }, 404);
    return c.json(presentMessage(updated));
  } catch (error) {
    return databaseError(c, error);
  }
});

messages.delete("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "id must be a positive integer" }, 400);
  const actorId = requiredQueryUserId(c.req.query("user_id"));
  if (isFieldError(actorId)) return c.json(actorId, 400);

  try {
    const actor = await findUser(c.env.DB, actorId);
    if (!actor) return c.json({ error: "user not found" }, 400);
    const owner = chatOwner(c.env.CHAT_OWNER_USER_ID);
    const row = await findMessage(c.env.DB, id, actorId, owner);
    if (!row) return c.json({ error: "message not found" }, 404);
    if (!canMutate(actorId, row.user_id, c.env.CHAT_OWNER_USER_ID)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const deleted = await c.env.DB.prepare(`DELETE FROM messages WHERE id = ?`)
      .bind(id)
      .run();
    if (!deleted.meta.changes) return c.json({ error: "message not found" }, 404);
    return c.json(presentMessage(row));
  } catch (error) {
    return databaseError(c, error);
  }
});

replies.get("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "id must be a positive integer" }, 400);
  const viewer = await requireViewer(c);
  if (viewer instanceof Response) return viewer;

  try {
    const row = await findReplyAccess(c.env.DB, id);
    if (
      !row ||
      !canSeeReply(
        viewer.id,
        row.user_id,
        row.message_user_id,
        row.secret,
        row.message_secret,
        chatOwner(c.env.CHAT_OWNER_USER_ID),
      )
    ) {
      return c.json({ error: "reply not found" }, 404);
    }
    return c.json(presentReply(row));
  } catch (error) {
    return databaseError(c, error);
  }
});

replies.put("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "id must be a positive integer" }, 400);
  const body = await readJson(c);
  if (body instanceof Response) return body;
  const input = parseAuthorBody(body);
  if (isFieldError(input)) return c.json(input, 400);

  try {
    const actor = await findUser(c.env.DB, input.user_id);
    if (!actor) return c.json({ error: "user not found" }, 400);
    const row = await findReply(c.env.DB, id);
    if (!row) return c.json({ error: "reply not found" }, 404);
    if (!canMutate(input.user_id, row.user_id, c.env.CHAT_OWNER_USER_ID)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const secret = input.secret === undefined ? row.secret : input.secret ? 1 : 0;
    const updated = await c.env.DB.prepare(
      `UPDATE replies SET body = ?, secret = ?, updated_at = ? WHERE id = ?
       RETURNING id`,
    )
      .bind(input.body, secret, Math.max(unixSeconds(), row.created_at), id)
      .first<{ id: number }>();
    if (!updated) return c.json({ error: "reply not found" }, 404);
    const fresh = await findReply(c.env.DB, id);
    if (!fresh) return c.json({ error: "reply not found" }, 404);
    return c.json(presentReply(fresh));
  } catch (error) {
    return databaseError(c, error);
  }
});

replies.delete("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "id must be a positive integer" }, 400);
  const actorId = requiredQueryUserId(c.req.query("user_id"));
  if (isFieldError(actorId)) return c.json(actorId, 400);

  try {
    const actor = await findUser(c.env.DB, actorId);
    if (!actor) return c.json({ error: "user not found" }, 400);
    const row = await findReply(c.env.DB, id);
    if (!row) return c.json({ error: "reply not found" }, 404);
    if (!canMutate(actorId, row.user_id, c.env.CHAT_OWNER_USER_ID)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const deleted = await c.env.DB.prepare(`DELETE FROM replies WHERE id = ?`)
      .bind(id)
      .run();
    if (!deleted.meta.changes) return c.json({ error: "reply not found" }, 404);
    return c.json(presentReply(row));
  } catch (error) {
    return databaseError(c, error);
  }
});

function presentMessage(row: MessageRow) {
  return {
    ...row,
    secret: row.secret === 1,
    links: parseStoredLinks(row.links),
    pinned: row.pinned === 1,
    pin_rank: row.pin_rank,
  };
}

function presentReply(row: ReplyRow) {
  return {
    id: row.id,
    message_id: row.message_id,
    user_id: row.user_id,
    display_name: row.display_name,
    body: row.body,
    secret: row.secret === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function chatOwner(ownerId: string | undefined): string {
  return typeof ownerId === "string" ? ownerId : "";
}

function canSeeMessage(
  viewer: string,
  author: string,
  secret: number,
  owner: string,
): boolean {
  if (secret === 0) return true;
  return viewer === author || (owner.length > 0 && viewer === owner);
}

function canSeeReply(
  viewer: string,
  replyAuthor: string,
  messageAuthor: string,
  replySecret: number,
  messageSecret: number,
  owner: string,
): boolean {
  if (replySecret === 1) {
    return (
      viewer === replyAuthor ||
      viewer === messageAuthor ||
      (owner.length > 0 && viewer === owner)
    );
  }
  return canSeeMessage(viewer, messageAuthor, messageSecret, owner);
}

async function requireViewer(c: ChatContext): Promise<UserRow | Response> {
  const viewerId = requiredQueryUserId(c.req.query("user_id"));
  if (isFieldError(viewerId)) return c.json(viewerId, 400);
  const viewer = await findUser(c.env.DB, viewerId);
  if (!viewer) return c.json({ error: "user not found" }, 400);
  return viewer;
}

function asMessage(
  row: Omit<MessageRow, "display_name" | "reply_count" | "like_count">,
  displayName: string,
  replyCount: number,
  likeCount: number,
): MessageRow {
  return {
    ...row,
    display_name: displayName,
    reply_count: replyCount,
    like_count: likeCount,
  };
}

function canMutate(
  actor: string,
  author: string,
  ownerId: string | undefined,
): boolean {
  if (actor === author) return true;
  return typeof ownerId === "string" && ownerId.length > 0 && actor === ownerId;
}

async function findUser(db: D1Database, id: string): Promise<UserRow | null> {
  return db
    .prepare(`SELECT id, display_name, created_at FROM users WHERE id = ?`)
    .bind(id)
    .first<UserRow>();
}

async function findMessage(
  db: D1Database,
  id: number,
  viewer: string,
  owner: string,
): Promise<MessageRow | null> {
  return db
    .prepare(`${MESSAGE_SELECT} WHERE m.id = ?3`)
    .bind(viewer, owner, id)
    .first<MessageRow>();
}

async function findReply(db: D1Database, id: number): Promise<ReplyRow | null> {
  return db
    .prepare(`${REPLY_SELECT} WHERE r.id = ?`)
    .bind(id)
    .first<ReplyRow>();
}

async function findReplyAccess(
  db: D1Database,
  id: number,
): Promise<ReplyAccess | null> {
  return db
    .prepare(
      `SELECT r.id, r.message_id, r.user_id, u.display_name, r.body, r.secret, r.created_at, r.updated_at,
              m.user_id AS message_user_id, m.secret AS message_secret
       FROM replies r
       JOIN users u ON u.id = r.user_id
       JOIN messages m ON m.id = r.message_id
       WHERE r.id = ?`,
    )
    .bind(id)
    .first<ReplyAccess>();
}

async function findLike(
  db: D1Database,
  messageId: number,
  userId: string,
): Promise<LikeRow | null> {
  return db
    .prepare(
      `SELECT l.message_id, l.user_id, u.display_name, l.created_at
       FROM likes l
       JOIN users u ON u.id = l.user_id
       WHERE l.message_id = ? AND l.user_id = ?`,
    )
    .bind(messageId, userId)
    .first<LikeRow>();
}

function parseCreateUser(
  value: unknown,
): { id: string; display_name: string } | FieldError {
  const body = jsonObject(value);
  if (isFieldError(body)) return body;
  const id = requiredUserId(body.id);
  if (isFieldError(id)) return id;
  const displayName = requiredLimitedText(body.display_name, "display_name", 80);
  if (isFieldError(displayName)) return displayName;
  return { id, display_name: displayName };
}

function parseActor(value: unknown): { user_id: string } | FieldError {
  const body = jsonObject(value);
  if (isFieldError(body)) return body;
  const userId = requiredUserId(body.user_id);
  if (isFieldError(userId)) return userId;
  return { user_id: userId };
}

function parseActorName(
  value: unknown,
): { user_id: string; display_name: string } | FieldError {
  const actor = parseActor(value);
  if (isFieldError(actor)) return actor;
  const body = jsonObject(value);
  if (isFieldError(body)) return body;
  const displayName = requiredLimitedText(body.display_name, "display_name", 80);
  if (isFieldError(displayName)) return displayName;
  return { user_id: actor.user_id, display_name: displayName };
}

function parseAuthorBody(
  value: unknown,
):
  | {
      user_id: string;
      body: string;
      secret?: boolean;
      links?: MessageLink[];
      pinned?: boolean;
      pin_rank?: number;
    }
  | FieldError {
  const actor = parseActor(value);
  if (isFieldError(actor)) return actor;
  const body = jsonObject(value);
  if (isFieldError(body)) return body;
  const text = requiredLimitedText(body.body, "body", 2000);
  if (isFieldError(text)) return text;
  const secret = optionalSecret(body.secret);
  if (isFieldError(secret)) return secret;
  const links = optionalLinks(body.links);
  if (isFieldError(links)) return links;
  const pinned = optionalPinned(body.pinned);
  if (isFieldError(pinned)) return pinned;
  const pinRank = optionalPinRank(body.pin_rank);
  if (isFieldError(pinRank)) return pinRank;
  return {
    user_id: actor.user_id,
    body: text,
    secret,
    links,
    pinned,
    pin_rank: pinRank,
  };
}

function optionalSecret(value: unknown): boolean | undefined | FieldError {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") return { error: "secret must be a boolean" };
  return value;
}

function optionalPinned(value: unknown): boolean | undefined | FieldError {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") return { error: "pinned must be a boolean" };
  return value;
}

function optionalPinRank(value: unknown): number | undefined | FieldError {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return { error: "pin_rank must be an integer greater than or equal to 1" };
  }
  return value;
}

function decidePin(
  input: { pinned?: boolean; pin_rank?: number },
  current: { pinned: number; pin_rank: number | null } | null,
  actor: string,
  ownerId: string | undefined,
): { pinned: number; pin_rank: number | null } | { error: string; status: 400 | 403 } {
  const currentPinned = current !== null && current.pinned === 1;
  const currentRank = current?.pin_rank ?? null;
  const nextPinned = input.pinned === undefined ? currentPinned : input.pinned;
  if (
    nextPinned &&
    input.pin_rank === undefined &&
    !(currentPinned && currentRank !== null)
  ) {
    return { error: "pin_rank is required when pinned is true", status: 400 };
  }

  const nextRank = nextPinned
    ? input.pin_rank !== undefined
      ? input.pin_rank
      : currentRank
    : null;
  const pinnedChanged = input.pinned !== undefined && input.pinned !== currentPinned;
  const rankChanged = input.pin_rank !== undefined && input.pin_rank !== currentRank;
  const owner = typeof ownerId === "string" && ownerId.length > 0 && actor === ownerId;
  if ((pinnedChanged || rankChanged) && !owner) {
    return { error: "forbidden", status: 403 };
  }
  return { pinned: nextPinned ? 1 : 0, pin_rank: nextRank };
}

function optionalLinks(
  value: unknown,
): MessageLink[] | undefined | FieldError {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return { error: "links must be an array" };
  if (value.length > 20) return { error: "links must have at most 20 items" };
  const links: MessageLink[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    const link = requiredLink(item);
    if (isFieldError(link)) return link;
    if (seen.has(link.id)) return { error: "links.id must be unique" };
    seen.add(link.id);
    links.push(link);
  }
  return links;
}

function requiredLink(value: unknown): MessageLink | FieldError {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { error: "links item must be an object" };
  }
  const body = value as Record<string, unknown>;
  const id = requiredLinkId(body.id);
  if (isFieldError(id)) return id;
  const text = requiredLimitedText(body.text, "links.text", 200);
  if (isFieldError(text)) return text;
  const url = requiredLinkUrl(body.url);
  if (isFieldError(url)) return url;
  const note = optionalNote(body.note);
  if (isFieldError(note)) return note;
  return { id, text, url, note };
}

function requiredLinkId(value: unknown): number | FieldError {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return { error: "links.id must be an integer" };
  }
  if (value < 0) {
    return { error: "links.id must be greater than or equal to 0" };
  }
  return value;
}

function requiredLinkUrl(value: unknown): string | FieldError {
  const url = requiredLimitedText(value, "links.url", 2000);
  if (isFieldError(url)) return url;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return { error: "links.url must start with http:// or https://" };
  }
  return url;
}

function optionalNote(value: unknown): string | FieldError {
  if (typeof value !== "string") return { error: "links.note must be a string" };
  const note = value.trim();
  if (note.length > 500) {
    return { error: "links.note must be at most 500 characters" };
  }
  return note;
}

function parseStoredLinks(value: string): MessageLink[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("links must be an array");
  return parsed as MessageLink[];
}

function jsonObject(value: unknown): Record<string, unknown> | FieldError {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { error: "expected a JSON object" };
  }
  return value as Record<string, unknown>;
}

function requiredUserId(value: unknown): string | FieldError {
  if (typeof value !== "string") return { error: "user_id must be a string" };
  const userId = value.trim();
  if (userId.length === 0) return { error: "user_id must not be empty" };
  if (!userId.startsWith("user_")) {
    return { error: "user_id must start with user_" };
  }
  if (userId.length > 64) {
    return { error: "user_id must be at most 64 characters" };
  }
  return userId;
}

function requiredQueryUserId(value: string | undefined): string | FieldError {
  if (value === undefined) return { error: "user_id is required" };
  return requiredUserId(value);
}

function requiredLimitedText(
  value: unknown,
  field: string,
  max: number,
): string | FieldError {
  if (typeof value !== "string") return { error: `${field} must be a string` };
  const text = value.trim();
  if (text.length === 0) return { error: `${field} must not be empty` };
  if (text.length > max) {
    return { error: `${field} must be at most ${max} characters` };
  }
  return text;
}

function parseBound(
  value: string | undefined,
  field: string,
  fallback: number,
  min: number,
  max: number,
): number | FieldError {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return { error: `${field} must be an integer` };
  const parsed = Number(value);
  if (parsed < min || parsed > max) {
    return { error: `${field} must be between ${min} and ${max}` };
  }
  return parsed;
}

function page(c: ChatContext): { limit: number; offset: number } | FieldError {
  const limit = parseBound(c.req.query("limit"), "limit", 50, 1, 100);
  if (isFieldError(limit)) return limit;
  const offset = parseBound(c.req.query("offset"), "offset", 0, 0, 100_000);
  if (isFieldError(offset)) return offset;
  return { limit, offset };
}

function parseId(value: string | undefined): number | null {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id)) return null;
  return id;
}

function isFieldError(value: unknown): value is FieldError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  );
}

async function readJson(c: ChatContext): Promise<unknown | Response> {
  try {
    return await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
}

function unixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function basicAuthMatches(
  header: string | undefined,
  username: string | undefined,
  password: string | undefined,
): boolean {
  if (!username || !password) return false;
  if (!header?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = atob(header.slice("Basic ".length).trim());
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  const user = decoded.slice(0, separator);
  const pass = decoded.slice(separator + 1);
  return safeEqual(user, username) && safeEqual(pass, password);
}

function safeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes("UNIQUE constraint failed")
  );
}

function databaseError(c: ChatContext, error: unknown): Response {
  console.error(
    JSON.stringify({
      message: "d1 query failed",
      path: c.req.path,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return c.json({ error: "database query failed" }, 500);
}

export { messages, replies, users };
