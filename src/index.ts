import { Hono } from "hono";
import { messages, replies, tags, users } from "./chat";
import { entries } from "./entries";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/", (c) => {
  return c.text("Hello!");
});

app.route("/entries", entries);
app.route("/users", users);
app.route("/messages", messages);
app.route("/replies", replies);
app.route("/tags", tags);

export default app;
