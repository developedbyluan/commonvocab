import { Hono } from "hono";
import { entries } from "./entries";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/", (c) => {
  return c.text("Hello!");
});

app.route("/entries", entries);

export default app;
