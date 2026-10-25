import { Hono } from "hono";

type Definition = {
  vietnamese: string;
  english: string;
};

type LocalizedText = {
  english: string;
  vietnamese: string;
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
};

type EntryInput = Omit<Entry, "id">;

type StoredEntry = Omit<Entry, "definition" | "usage"> & {
  definition: string;
  usage: string;
};

type FieldError = { error: string };

const COLUMNS =
  "id, input_text, definition, media_id, sentence_id, start_index, end_index, part_of_speech, status, usage, user_id";

const PUBLIC_COLUMNS =
  "input_text, definition, media_id, sentence_id, start_index, end_index, part_of_speech, status, usage, user_id";

const entries = new Hono<{ Bindings: CloudflareBindings }>();

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

    if (!row) return c.json({ error: "entry not found" }, 404);
    const sameText =
      row.input_text.trim().toLowerCase() === inputText.toLowerCase();
    if (!sameText) return c.json({ error: "input text does not match" }, 400);
    return c.json(withStoredColumns(row));
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
      `INSERT INTO entries (input_text, definition, media_id, sentence_id, start_index, end_index, part_of_speech, status, usage, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
       SET input_text = ?, definition = ?, media_id = ?, sentence_id = ?, start_index = ?, end_index = ?, part_of_speech = ?, status = ?, usage = ?, user_id = ?
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
  const userId = requiredUserId(body.user_id);
  if (isFieldError(userId)) return userId;
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
  };
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
  return { english, vietnamese };
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
  value: string | number | null | Definition | UsageExample | UsageExample[] | UsageImage | LocalizedText | FieldError,
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

function withStoredColumns(row: StoredEntry): Entry {
  return {
    ...row,
    definition: parseStoredDefinition(row.definition),
    usage: parseStoredUsage(row.usage),
  };
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
  return typeof body.english === "string" && typeof body.vietnamese === "string";
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
