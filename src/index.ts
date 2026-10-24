import { Hono } from "hono";

const app = new Hono();

const EXAMPLES = [
  "God, it was worth it.",
  "Do you think it was worth it?",
  "But look at your face, it was worth it.",
  "And it can manipulate people at will.",
  "Don't try to manipulate me.",
];

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

export default app;
