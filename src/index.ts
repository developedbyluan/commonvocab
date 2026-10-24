import { Hono } from "hono";

const app = new Hono();

type Match = {
  sentence: string;
  start: number;
  end: number;
};

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

function locate(sentence: string, phrase: string): Match | null {
  /**
   * Finds the starting and ending index of a phrase within a sentence (case-insensitive).
   * Returns a Match object with the original sentence, start and end indices, or null if not found.
   *
   * @param sentence - The sentence to search within.
   * @param phrase - The phrase to locate in the sentence.
   * @returns {Match | null} The match information or null if the phrase is not found.
   */
  const start = sentence.toLowerCase().indexOf(phrase.toLowerCase());
  if (start === -1) return null;
  return {
    sentence,
    start,
    end: start + phrase.length,
  };
}

function findMatches(text: string): Match[] {
  /**
   * Finds all example sentences that contain the given text (case-insensitive),
   * highlights the first occurrence of the text in each sentence,
   * and returns an array of sentences with highlights.
   *
   * @param text - The phrase to search for within the example sentences.
   * @returns An array of sentences with the phrase highlighted. Sentences that don't contain the phrase are omitted.
   */
  return EXAMPLES.flatMap((sentence) => {
    const match = locate(sentence, text);
    return match === null ? [] : [match];
  });
}
