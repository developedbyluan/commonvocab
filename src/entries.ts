import { Hono } from "hono";

type Definition = {
  vietnamese: string;
  english: string;
};

type LocalizedText = {
  english: string;
  vietnamese: string;
  start: number;
  end: number;
};

type UsageImage = {
  url: string;
  alt: string;
};

type UsageExample = {
  id: number;
  image: UsageImage;
  text: LocalizedText;
  note: LocalizedText;
};

type SubtitleLine = {
  id: number;
  target: string;
  mine: string;
  ipa: string;
  start: number;
  end: number;
  speaker: string;
};

type Entry = {
  id: number;
  input_text: string;
  definition: Definition;
  media_id: string;
  sentence_id: string;
  start_index: number;
  end_index: number;
  part_of_speech: string;
  status: "pending" | "aigenerated" | "editorpicked" | "approved";
  usage: UsageExample[];
  user_id: string;
  subtitles: SubtitleLine[];
  phonetic: string;
  created_at: number;
  updated_at: number[];
  allowed_roles: AllowedRole[];
};

type EntryInput = Omit<Entry, "id" | "created_at" | "updated_at">;

type StoredEntry = Omit<
  Entry,
  "definition" | "usage" | "subtitles" | "updated_at" | "allowed_roles"
> & {
  definition: string;
  usage: string;
  subtitles: string;
  updated_at: string;
  allowed_roles: string;
};

type FieldError = { error: string };

const COLUMNS =
  "id, input_text, definition, media_id, sentence_id, start_index, end_index, part_of_speech, status, usage, user_id, subtitles, phonetic, created_at, updated_at, allowed_roles";

const PUBLIC_COLUMNS =
  "input_text, definition, media_id, sentence_id, start_index, end_index, part_of_speech, status, usage, user_id, subtitles, phonetic, created_at, updated_at, allowed_roles";

type Bindings = CloudflareBindings & {
  OPENAI_API_KEY: string;
  BASIC_AUTH_USERNAME: string;
  BASIC_AUTH_PASSWORD: string;
};

const entries = new Hono<{ Bindings: Bindings }>();

entries.use("*", async (c, next) => {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if (c.req.path.endsWith("/lookup")) {
    const lookup = await c.env.LOOKUP_LIMITER.limit({
      key: lookupRateLimitKey(await lookupRequestUserId(c), ip),
    });
    if (!lookup.success) return c.json({ error: "too many requests" }, 429);
  }

  const shared = await c.env.ENTRIES_LIMITER.limit({ key: ip });
  if (!shared.success) return c.json({ error: "too many requests" }, 429);
  await next();
});

entries.get("/", async (c) => {
  const inputText = optionalText(c.req.query("input_text"), "input_text");
  if (isFieldError(inputText)) return c.json(inputText, 400);
  const mediaId = optionalText(c.req.query("media_id"), "media_id");
  if (isFieldError(mediaId)) return c.json(mediaId, 400);
  const sentenceId = optionalText(c.req.query("sentence_id"), "sentence_id");
  if (isFieldError(sentenceId)) return c.json(sentenceId, 400);
  const limit = parseBound(c.req.query("limit"), "limit", 50, 1, 100);
  if (isFieldError(limit)) return c.json(limit, 400);
  const offset = parseBound(c.req.query("offset"), "offset", 0, 0, 100_000);
  if (isFieldError(offset)) return c.json(offset, 400);

  try {
    const { results } = await c.env.DB.prepare(
      `SELECT ${COLUMNS}
       FROM entries
       WHERE (?1 IS NULL OR input_text = ?1)
         AND (?2 IS NULL OR media_id = ?2)
         AND (?3 IS NULL OR sentence_id = ?3)
       ORDER BY id
       LIMIT ?4 OFFSET ?5`,
    )
      .bind(inputText, mediaId, sentenceId, limit, offset)
      .all<StoredEntry>();

    return c.json(results.map(withStoredColumns));
  } catch (error) {
    return databaseError(c, error);
  }
});

entries.get("/lookup", async (c) => {
  const inputText = requiredQueryText(c.req.query("input_text"), "input_text");
  if (isFieldError(inputText)) return c.json(inputText, 400);
  const mediaId = requiredQueryText(c.req.query("media_id"), "media_id");
  if (isFieldError(mediaId)) return c.json(mediaId, 400);
  const sentenceId = requiredQueryText(
    c.req.query("sentence_id"),
    "sentence_id",
  );
  if (isFieldError(sentenceId)) return c.json(sentenceId, 400);
  const startIndex = requiredQueryIndex(
    c.req.query("start_index"),
    "start_index",
  );
  if (isFieldError(startIndex)) return c.json(startIndex, 400);
  const endIndex = requiredQueryIndex(c.req.query("end_index"), "end_index");
  if (isFieldError(endIndex)) return c.json(endIndex, 400);
  if (endIndex < startIndex) {
    return c.json(
      { error: "end_index must be greater than or equal to start_index" },
      400,
    );
  }
  const userId = requiredQueryUserId(c.req.query("user_id"));
  if (isFieldError(userId)) return c.json(userId, 400);

  try {
    const row = await c.env.DB.prepare(
      `SELECT ${PUBLIC_COLUMNS}
       FROM entries
       WHERE media_id = ? AND sentence_id = ? AND start_index = ? AND end_index = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
      .bind(mediaId, sentenceId, startIndex, endIndex)
      .first<StoredEntry>();

    if (!row) {
      await c.env.DB.prepare(
        `INSERT INTO entries (input_text, definition, media_id, sentence_id, start_index, end_index, part_of_speech, status, usage, user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          inputText,
          JSON.stringify({ vietnamese: "", english: "" }),
          mediaId,
          sentenceId,
          startIndex,
          endIndex,
          "",
          "pending",
          "[]",
          userId,
          unixSeconds(),
        )
        .run();
      return c.json({ error: "entry not found" }, 404);
    }

    const sameText =
      row.input_text.trim().toLowerCase() === inputText.toLowerCase();
    if (!sameText) return c.json({ error: "input text does not match" }, 400);
    if (row.status === "pending") return c.json({ error: "entry not found" }, 404);
    return c.json(withStoredColumns(row));
  } catch (error) {
    return databaseError(c, error);
  }
});

entries.post("/lookup", async (c) => {
  const allowed = basicAuthMatches(
    c.req.header("authorization"),
    c.env.BASIC_AUTH_USERNAME,
    c.env.BASIC_AUTH_PASSWORD,
  );
  if (!allowed) {
    c.header("WWW-Authenticate", 'Basic realm="entries"');
    return c.json({ error: "unauthorized" }, 401);
  }

  const body = await readJson(c);
  if (body instanceof Response) return body;
  const input = parseLookup(body);
  if ("error" in input) return c.json(input, 400);

  try {
    const row = await c.env.DB.prepare(
      `SELECT id, ${PUBLIC_COLUMNS}
       FROM entries
       WHERE media_id = ? AND sentence_id = ? AND start_index = ? AND end_index = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
      .bind(input.media_id, input.sentence_id, input.start_index, input.end_index)
      .first<StoredEntry>();

    if (row) {
      const sameText =
        row.input_text.trim().toLowerCase() === input.input_text.toLowerCase();
      if (!sameText) return c.json({ error: "input text does not match" }, 400);
      if (row.status !== "pending") return c.json(publicEntry(row));
    }

    const generated = await generateLookupFields(c.env.OPENAI_API_KEY, input);
    if (!generated) return c.json({ error: "generation failed" }, 502);

    if (!row) {
      const created = await c.env.DB.prepare(
        `INSERT INTO entries (input_text, definition, media_id, sentence_id, start_index, end_index, part_of_speech, status, usage, user_id, phonetic, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${PUBLIC_COLUMNS}`,
      )
        .bind(
          input.input_text,
          JSON.stringify(generated.definition),
          input.media_id,
          input.sentence_id,
          input.start_index,
          input.end_index,
          generated.part_of_speech,
          "editorpicked",
          "[]",
          input.user_id,
          generated.phonetic,
          unixSeconds(),
        )
        .first<StoredEntry>();
      if (!created) return c.json({ error: "database query failed" }, 500);
      return c.json(publicEntry(created));
    }

    const updated = await c.env.DB.prepare(
      `UPDATE entries
       SET definition = ?, part_of_speech = ?, phonetic = ?, status = ?, updated_at = json_insert(updated_at, '$[#]', ?)
       WHERE id = ?
       RETURNING ${PUBLIC_COLUMNS}`,
    )
      .bind(
        JSON.stringify(generated.definition),
        generated.part_of_speech,
        generated.phonetic,
        "editorpicked",
        unixSeconds(),
        row.id,
      )
      .first<StoredEntry>();
    if (!updated) return c.json({ error: "database query failed" }, 500);
    return c.json(publicEntry(updated));
  } catch (error) {
    return databaseError(c, error);
  }
});

entries.get("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null)
    return c.json({ error: "id must be a positive integer" }, 400);

  try {
    const row = await findEntry(c.env.DB, id);
    if (!row) return c.json({ error: "entry not found" }, 404);
    return c.json(row);
  } catch (error) {
    return databaseError(c, error);
  }
});

entries.post("/", async (c) => {
  const body = await readJson(c);
  if (body instanceof Response) return body;
  const input = parseEntry(body);
  if ("error" in input) return c.json(input, 400);

  try {
    const row = await c.env.DB.prepare(
      `INSERT INTO entries (input_text, definition, media_id, sentence_id, start_index, end_index, part_of_speech, status, usage, user_id, subtitles, phonetic, created_at, updated_at, allowed_roles)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING ${COLUMNS}`,
    )
      .bind(
        input.input_text,
        JSON.stringify(input.definition),
        input.media_id,
        input.sentence_id,
        input.start_index,
        input.end_index,
        input.part_of_speech,
        input.status,
        JSON.stringify(input.usage),
        input.user_id,
        JSON.stringify(input.subtitles),
        input.phonetic,
        unixSeconds(),
        "[]",
        JSON.stringify(input.allowed_roles),
      )
      .first<StoredEntry>();

    if (!row) return c.json({ error: "database query failed" }, 500);
    return c.json(withStoredColumns(row), 201);
  } catch (error) {
    return databaseError(c, error);
  }
});

entries.put("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null)
    return c.json({ error: "id must be a positive integer" }, 400);

  const body = await readJson(c);
  if (body instanceof Response) return body;
  const input = parseEntry(body);
  if ("error" in input) return c.json(input, 400);

  try {
    const row = await c.env.DB.prepare(
      `UPDATE entries
       SET input_text = ?, definition = ?, media_id = ?, sentence_id = ?, start_index = ?, end_index = ?, part_of_speech = ?, status = ?, usage = ?, user_id = ?, subtitles = ?, phonetic = ?, allowed_roles = ?, updated_at = json_insert(updated_at, '$[#]', ?)
       WHERE id = ?
       RETURNING ${COLUMNS}`,
    )
      .bind(
        input.input_text,
        JSON.stringify(input.definition),
        input.media_id,
        input.sentence_id,
        input.start_index,
        input.end_index,
        input.part_of_speech,
        input.status,
        JSON.stringify(input.usage),
        input.user_id,
        JSON.stringify(input.subtitles),
        input.phonetic,
        JSON.stringify(input.allowed_roles),
        unixSeconds(),
        id,
      )
      .first<StoredEntry>();

    if (!row) return c.json({ error: "entry not found" }, 404);
    return c.json(withStoredColumns(row));
  } catch (error) {
    return databaseError(c, error);
  }
});

entries.delete("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null)
    return c.json({ error: "id must be a positive integer" }, 400);

  try {
    const row = await c.env.DB.prepare(
      `DELETE FROM entries WHERE id = ? RETURNING ${COLUMNS}`,
    )
      .bind(id)
      .first<StoredEntry>();

    if (!row) return c.json({ error: "entry not found" }, 404);
    return c.json(withStoredColumns(row));
  } catch (error) {
    return databaseError(c, error);
  }
});

const STATUSES = ["pending", "aigenerated", "editorpicked", "approved"] as const;

const ROLES = ["standard", "premium", "vip", "vvip"] as const;

type AllowedRole = (typeof ROLES)[number];

function requiredStatus(
  value: unknown,
): (typeof STATUSES)[number] | FieldError {
  if (typeof value !== "string" || !STATUSES.includes(value as (typeof STATUSES)[number])) {
    return { error: "status must be pending, aigenerated, editorpicked, or approved" };
  }
  return value as (typeof STATUSES)[number];
}

function parseEntry(value: unknown): EntryInput | FieldError {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { error: "expected a JSON object" };
  }

  const body = value as Record<string, unknown>;
  const inputText = requiredText(body.input_text, "input_text", false);
  if (isFieldError(inputText)) return inputText;
  const definition = requiredDefinition(body.definition);
  if (isFieldError(definition)) return definition;
  const mediaId = requiredText(body.media_id, "media_id", true);
  if (isFieldError(mediaId)) return mediaId;
  const sentenceId = requiredText(body.sentence_id, "sentence_id", true);
  if (isFieldError(sentenceId)) return sentenceId;
  const startIndex = requiredIndex(body.start_index, "start_index");
  if (isFieldError(startIndex)) return startIndex;
  const endIndex = requiredIndex(body.end_index, "end_index");
  if (isFieldError(endIndex)) return endIndex;
  if (endIndex < startIndex) {
    return { error: "end_index must be greater than or equal to start_index" };
  }
  const partOfSpeech = requiredText(
    body.part_of_speech,
    "part_of_speech",
    true,
  );
  if (isFieldError(partOfSpeech)) return partOfSpeech;

  const status = requiredStatus(body.status);
  if (isFieldError(status)) return status;
  const usage = requiredUsage(body.usage);
  if (isFieldError(usage)) return usage;
  const subtitles = requiredSubtitles(body.subtitles);
  if (isFieldError(subtitles)) return subtitles;
  const userId = requiredUserId(body.user_id);
  if (isFieldError(userId)) return userId;
  const phonetic = requiredText(body.phonetic, "phonetic", true);
  if (isFieldError(phonetic)) return phonetic;
  const allowedRoles = requiredAllowedRoles(body.allowed_roles);
  if (isFieldError(allowedRoles)) return allowedRoles;
  return {
    input_text: inputText,
    definition,
    media_id: mediaId,
    sentence_id: sentenceId,
    start_index: startIndex,
    end_index: endIndex,
    part_of_speech: partOfSpeech,
    status: status,
    usage,
    user_id: userId,
    subtitles,
    phonetic,
    allowed_roles: allowedRoles,
  };
}

function requiredAllowedRoles(value: unknown): AllowedRole[] | FieldError {
  if (!Array.isArray(value)) return { error: "allowed_roles must be an array" };
  const roles: AllowedRole[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !ROLES.includes(item as AllowedRole)) {
      return {
        error: "allowed_roles item must be standard, premium, vip, or vvip",
      };
    }
    const role = item as AllowedRole;
    if (roles.includes(role)) {
      return { error: "allowed_roles item must not be repeated" };
    }
    roles.push(role);
  }
  return roles;
}

function requiredSubtitles(value: unknown): SubtitleLine[] | FieldError {
  if (!Array.isArray(value)) return { error: "subtitles must be an array" };
  const lines: SubtitleLine[] = [];
  for (const item of value) {
    const line = requiredSubtitleLine(item);
    if (isFieldError(line)) return line;
    lines.push(line);
  }
  return lines;
}

function requiredSubtitleLine(value: unknown): SubtitleLine | FieldError {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { error: "subtitles item must be an object" };
  }
  const body = value as Record<string, unknown>;
  const id = requiredIndex(body.id, "subtitles.id");
  if (isFieldError(id)) return id;
  const target = requiredString(body.target, "subtitles.target");
  if (isFieldError(target)) return target;
  const mine = requiredString(body.mine, "subtitles.mine");
  if (isFieldError(mine)) return mine;
  const ipa = requiredString(body.ipa, "subtitles.ipa");
  if (isFieldError(ipa)) return ipa;
  const start = requiredTime(body.start, "subtitles.start");
  if (isFieldError(start)) return start;
  const end = requiredTime(body.end, "subtitles.end");
  if (isFieldError(end)) return end;
  if (end < start) {
    return { error: "subtitles.end must be greater than or equal to subtitles.start" };
  }
  const speaker = requiredString(body.speaker, "subtitles.speaker");
  if (isFieldError(speaker)) return speaker;
  return { id, target, mine, ipa, start, end, speaker };
}

function requiredTime(value: unknown, field: string): number | FieldError {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { error: `${field} must be a number` };
  }
  if (value < 0) return { error: `${field} must be greater than or equal to 0` };
  return value;
}

async function lookupRequestUserId(c: {
  req: {
    method: string;
    query: (name: string) => string | undefined;
    json: () => Promise<unknown>;
  };
}): Promise<string | undefined> {
  const fromQuery = c.req.query("user_id");
  if (fromQuery !== undefined) return fromQuery;
  if (c.req.method !== "POST") return undefined;
  try {
    const body: unknown = await c.req.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return undefined;
    }
    const userId = (body as Record<string, unknown>).user_id;
    return typeof userId === "string" ? userId : undefined;
  } catch {
    return undefined;
  }
}

function lookupRateLimitKey(userId: string | undefined, ip: string): string {
  const key = userId?.trim() ?? "";
  if (key.startsWith("user_") && key.length <= 64) return key;
  return ip;
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

function requiredQueryUserId(value: string | undefined): string | FieldError {
  const userId = requiredQueryText(value, "user_id");
  if (isFieldError(userId)) return userId;
  if (!userId.startsWith("user_")) {
    return { error: "user_id must start with user_" };
  }
  return userId;
}

function requiredUserId(value: unknown): string | FieldError {
  const userId = requiredText(value, "user_id", true);
  if (isFieldError(userId)) return userId;
  if (!userId.startsWith("user_")) {
    return { error: "user_id must start with user_" };
  }
  return userId;
}

function requiredUsage(value: unknown): UsageExample[] | FieldError {
  if (!Array.isArray(value)) return { error: "usage must be an array" };
  const examples: UsageExample[] = [];
  for (const item of value) {
    const example = requiredUsageExample(item);
    if (isFieldError(example)) return example;
    examples.push(example);
  }
  return examples;
}

function requiredUsageExample(value: unknown): UsageExample | FieldError {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { error: "usage item must be an object" };
  }
  const body = value as Record<string, unknown>;
  const id = requiredIndex(body.id, "usage.id");
  if (isFieldError(id)) return id;
  const image = requiredUsageImage(body.image);
  if (isFieldError(image)) return image;
  const text = requiredLocalizedText(body.text, "usage.text");
  if (isFieldError(text)) return text;
  const note = requiredLocalizedText(body.note, "usage.note");
  if (isFieldError(note)) return note;
  return { id, image, text, note };
}

function requiredUsageImage(value: unknown): UsageImage | FieldError {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { error: "usage.image must be an object" };
  }
  const body = value as Record<string, unknown>;
  const url = requiredString(body.url, "usage.image.url");
  if (isFieldError(url)) return url;
  const alt = requiredString(body.alt, "usage.image.alt");
  if (isFieldError(alt)) return alt;
  return { url, alt };
}

function requiredLocalizedText(
  value: unknown,
  field: string,
): LocalizedText | FieldError {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { error: `${field} must be an object` };
  }
  const body = value as Record<string, unknown>;
  const english = requiredString(body.english, `${field}.english`);
  if (isFieldError(english)) return english;
  const vietnamese = requiredString(body.vietnamese, `${field}.vietnamese`);
  if (isFieldError(vietnamese)) return vietnamese;
  const start = requiredTime(body.start, `${field}.start`);
  if (isFieldError(start)) return start;
  const end = requiredTime(body.end, `${field}.end`);
  if (isFieldError(end)) return end;
  if (end < start) {
    return {
      error: `${field}.end must be greater than or equal to ${field}.start`,
    };
  }
  return { english, vietnamese, start, end };
}

function requiredString(value: unknown, field: string): string | FieldError {
  if (typeof value !== "string") return { error: `${field} must be a string` };
  return value.trim();
}

function requiredDefinition(value: unknown): Definition | FieldError {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { error: "definition must be an object" };
  }
  const body = value as Record<string, unknown>;
  const vietnamese = requiredText(body.vietnamese, "definition.vietnamese", true);
  if (isFieldError(vietnamese)) return vietnamese;
  const english = requiredText(body.english, "definition.english", true);
  if (isFieldError(english)) return english;
  return { vietnamese, english };
}

function requiredText(
  value: unknown,
  field: string,
  trim: boolean,
): string | FieldError {
  if (typeof value !== "string") return { error: `${field} must be a string` };
  const text = trim ? value.trim() : value;
  if (text.length === 0) return { error: `${field} must not be empty` };
  return text;
}

function optionalText(
  value: string | undefined,
  field: string,
): string | null | FieldError {
  if (value === undefined) return null;
  const text = value.trim();
  if (text.length === 0) return { error: `${field} must not be empty` };
  return text;
}

function requiredQueryText(
  value: string | undefined,
  field: string,
): string | FieldError {
  if (value === undefined) return { error: `${field} is required` };
  const text = value.trim();
  if (text.length === 0) return { error: `${field} must not be empty` };
  return text;
}

function requiredQueryIndex(
  value: string | undefined,
  field: string,
): number | FieldError {
  if (value === undefined) return { error: `${field} is required` };
  if (!/^\d+$/.test(value)) return { error: `${field} must be an integer` };
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    return { error: `${field} must be an integer` };
  return parsed;
}

function requiredIndex(value: unknown, field: string): number | FieldError {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return { error: `${field} must be an integer` };
  }
  if (value < 0)
    return { error: `${field} must be greater than or equal to 0` };
  return value;
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

function parseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id)) return null;
  return id;
}

function isFieldError(
  value:
    | string
    | number
    | null
    | Definition
    | UsageExample
    | UsageExample[]
    | UsageImage
    | LocalizedText
    | SubtitleLine
    | SubtitleLine[]
    | AllowedRole[]
    | FieldError,
): value is FieldError {
  return typeof value === "object" && value !== null && "error" in value;
}

async function readJson(c: {
  req: { json: () => Promise<unknown> };
  json: (body: FieldError, status: 400) => Response;
}): Promise<unknown | Response> {
  try {
    return await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
}

function unixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function withStoredColumns(row: StoredEntry): Entry {
  return {
    ...row,
    definition: parseStoredDefinition(row.definition),
    usage: parseStoredUsage(row.usage),
    subtitles: parseStoredSubtitles(row.subtitles),
    updated_at: parseStoredUpdatedAt(row.updated_at),
    allowed_roles: parseStoredAllowedRoles(row.allowed_roles),
  };
}

function publicEntry(row: StoredEntry): Omit<Entry, "id"> {
  const { id: _id, ...entry } = withStoredColumns(row);
  return entry;
}

type LookupInput = {
  input_text: string;
  media_id: string;
  sentence_id: string;
  start_index: number;
  end_index: number;
  user_id: string;
  previous: string;
  current: string;
  next: string;
};

function parseLookup(value: unknown): LookupInput | FieldError {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { error: "expected a JSON object" };
  }
  const body = value as Record<string, unknown>;
  const inputText = requiredText(body.input_text, "input_text", true);
  if (isFieldError(inputText)) return inputText;
  const mediaId = requiredText(body.media_id, "media_id", true);
  if (isFieldError(mediaId)) return mediaId;
  const sentenceId = requiredText(body.sentence_id, "sentence_id", true);
  if (isFieldError(sentenceId)) return sentenceId;
  const startIndex = requiredIndex(body.start_index, "start_index");
  if (isFieldError(startIndex)) return startIndex;
  const endIndex = requiredIndex(body.end_index, "end_index");
  if (isFieldError(endIndex)) return endIndex;
  if (endIndex < startIndex) {
    return { error: "end_index must be greater than or equal to start_index" };
  }
  const userId = requiredUserId(body.user_id);
  if (isFieldError(userId)) return userId;
  const previous = requiredString(body.previous, "previous");
  if (isFieldError(previous)) return previous;
  const current = requiredText(body.current, "current", true);
  if (isFieldError(current)) return current;
  if (!current.toLowerCase().includes(inputText.toLowerCase())) {
    return { error: "current must contain input_text" };
  }
  const next = requiredString(body.next, "next");
  if (isFieldError(next)) return next;
  return {
    input_text: inputText,
    media_id: mediaId,
    sentence_id: sentenceId,
    start_index: startIndex,
    end_index: endIndex,
    user_id: userId,
    previous,
    current,
    next,
  };
}

type GeneratedLookup = {
  definition: Definition;
  part_of_speech: string;
  phonetic: string;
};

async function generateLookupFields(
  apiKey: string | undefined,
  input: LookupInput,
): Promise<GeneratedLookup | null> {
  if (typeof apiKey !== "string" || apiKey.trim() === "") return null;
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content:
              "You fill a vocabulary entry for one English word or phrase. Define it as it is used in the current line. Use the previous and next lines only as context. Return a short English definition, its Vietnamese definition, the part of speech, and an IPA phonetic spelling.",
          },
          {
            role: "user",
            content: [
              `Word: ${input.input_text}`,
              `Previous: ${input.previous}`,
              `Current: ${input.current}`,
              `Next: ${input.next}`,
            ].join("\n"),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "lookup_fields",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                definition: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    english: { type: "string" },
                    vietnamese: { type: "string" },
                  },
                  required: ["english", "vietnamese"],
                },
                part_of_speech: { type: "string" },
                phonetic: { type: "string" },
              },
              required: ["definition", "part_of_speech", "phonetic"],
            },
          },
        },
      }),
    });
    if (!response.ok) return null;
    const content = completionContent(await response.json());
    if (!content) return null;
    return parseGeneratedLookup(JSON.parse(content));
  } catch {
    return null;
  }
}

function completionContent(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  return typeof message?.content === "string" ? message.content : null;
}

function parseGeneratedLookup(value: unknown): GeneratedLookup | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const body = value as Record<string, unknown>;
  const definition = requiredDefinition(body.definition);
  if (isFieldError(definition)) return null;
  const partOfSpeech = requiredText(body.part_of_speech, "part_of_speech", true);
  if (isFieldError(partOfSpeech)) return null;
  const phonetic = requiredText(body.phonetic, "phonetic", true);
  if (isFieldError(phonetic)) return null;
  return { definition, part_of_speech: partOfSpeech, phonetic };
}

function parseStoredAllowedRoles(value: string): AllowedRole[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (isAllowedRoles(parsed)) return parsed;
  } catch {
    // A bad stored value reads as the default role.
  }
  return ["standard"];
}

function isAllowedRoles(value: unknown): value is AllowedRole[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  for (const item of value) {
    if (
      typeof item !== "string" ||
      !ROLES.includes(item as AllowedRole) ||
      seen.has(item)
    ) {
      return false;
    }
    seen.add(item);
  }
  return true;
}

function parseStoredUpdatedAt(value: string): number[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every(isUnixTime)) return parsed;
  } catch {
    // A bad stored value reads as no updates.
  }
  return [];
}

function isUnixTime(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseStoredSubtitles(value: string): SubtitleLine[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every(isSubtitleLine)) return parsed;
  } catch {
    // Rows created before this column, or a bad stored value, read as no lines.
  }
  return [];
}

function isSubtitleLine(value: unknown): value is SubtitleLine {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const body = value as Record<string, unknown>;
  return (
    typeof body.id === "number" &&
    Number.isInteger(body.id) &&
    body.id >= 0 &&
    typeof body.target === "string" &&
    typeof body.mine === "string" &&
    typeof body.ipa === "string" &&
    typeof body.speaker === "string" &&
    typeof body.start === "number" &&
    Number.isFinite(body.start) &&
    body.start >= 0 &&
    typeof body.end === "number" &&
    Number.isFinite(body.end) &&
    body.end >= body.start
  );
}

function parseStoredUsage(value: string): UsageExample[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every(isUsageExample)) return parsed;
  } catch {
    // Rows created before this column, or a bad stored value, read as no examples.
  }
  return [];
}

function isUsageExample(value: unknown): value is UsageExample {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const body = value as Record<string, unknown>;
  return (
    typeof body.id === "number" &&
    Number.isInteger(body.id) &&
    body.id >= 0 &&
    isUsageImage(body.image) &&
    isLocalizedText(body.text) &&
    isLocalizedText(body.note)
  );
}

function isUsageImage(value: unknown): value is UsageImage {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const body = value as Record<string, unknown>;
  return typeof body.url === "string" && typeof body.alt === "string";
}

function isLocalizedText(value: unknown): value is LocalizedText {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const body = value as Record<string, unknown>;
  return (
    typeof body.english === "string" &&
    typeof body.vietnamese === "string" &&
    typeof body.start === "number" &&
    Number.isFinite(body.start) &&
    body.start >= 0 &&
    typeof body.end === "number" &&
    Number.isFinite(body.end) &&
    body.end >= body.start
  );
}

function parseStoredDefinition(value: string): Definition {
  try {
    const parsed: unknown = JSON.parse(value);
    if (isDefinition(parsed)) return parsed;
  } catch {
    // Rows created before this shape stored a plain sentence.
  }
  return { vietnamese: "", english: value };
}

function isDefinition(value: unknown): value is Definition {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const body = value as Record<string, unknown>;
  return typeof body.vietnamese === "string" && typeof body.english === "string";
}

async function findEntry(db: D1Database, id: number): Promise<Entry | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM entries WHERE id = ?`)
    .bind(id)
    .first<StoredEntry>();
  return row ? withStoredColumns(row) : null;
}

function databaseError(
  c: {
    json: (body: FieldError, status: 500) => Response;
    req: { path: string };
  },
  error: unknown,
): Response {
  console.error(
    JSON.stringify({
      message: "d1 query failed",
      path: c.req.path,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return c.json({ error: "database query failed" }, 500);
}

export { entries };
