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

app.get("/commonvocab", (c) => {
  const text = c.req.query("text")?.trim();

  if (!text) {
    return c.json({ error: "missing text" }, 400);
  }

  const matches = findMatches(text);

  return c.json(matches);
});

export default app;

function highlight(sentence: string, phrase: string): string | null {
  /**
   * Highlights the first occurrence of a phrase within a sentence by wrapping it in double asterisks (**).
   * The search is case-insensitive. If the matched phrase is immediately followed by punctuation (.,!?;:),
   * the highlight will include those punctuation marks as well.
   *
   * @param sentence - The sentence to search within.
   * @param phrase - The phrase to highlight.
   * @returns The sentence with the matched phrase highlighted, or null if not found.
   */
  const index = sentence.toLowerCase().indexOf(phrase.toLowerCase());
  if (index === -1) return null;

  let end = index + phrase.length;
  while (end < sentence.length && ".,!?;:".includes(sentence[end])) {
    end++;
  }

  return (
    sentence.slice(0, index) +
    "**" +
    sentence.slice(index, end) +
    "**" +
    sentence.slice(end)
  );
}

function findMatches(text: string): string[] {
  /**
   * Finds all example sentences that contain the given text (case-insensitive),
   * highlights the first occurrence of the text in each sentence,
   * and returns an array of sentences with highlights.
   *
   * @param text - The phrase to search for within the example sentences.
   * @returns An array of sentences with the phrase highlighted. Sentences that don't contain the phrase are omitted.
   */
  return EXAMPLES.flatMap((sentence) => {
    const highlighted = highlight(sentence, text);
    return highlighted === null ? [] : [highlighted];
  });
}
