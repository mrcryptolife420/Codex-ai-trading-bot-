import test from "node:test";
import assert from "node:assert/strict";
import { scoreHeadline, summarizeNews } from "../src/news/sentiment.js";

test("headline scoring catches positive and risky crypto news", () => {
  const positive = scoreHeadline("Bitcoin approval sparks bullish breakout and inflows");
  const negative = scoreHeadline("Major exploit and hack trigger delist fears");
  assert.ok(positive.score > 0);
  assert.ok(negative.score < 0);
  assert.ok(negative.riskScore > 0);
});

test("news summary weights recent items", () => {
  const now = new Date("2026-03-08T12:00:00.000Z").toISOString();
  const summary = summarizeNews(
    [
      {
        title: "Ethereum partnership boosts adoption",
        source: "Example",
        publishedAt: "2026-03-08T10:00:00.000Z",
        link: "https://example.com/1"
      },
      {
        title: "Old hack story resurfaces",
        source: "Example",
        publishedAt: "2026-03-07T02:00:00.000Z",
        link: "https://example.com/2"
      }
    ],
    24,
    now
  );
  assert.ok(summary.confidence > 0);
  assert.ok(summary.coverage >= 1);
});
