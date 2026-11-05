import test from "node:test";
import assert from "node:assert/strict";
import { parseTelegramPosts } from "./worker.js";

test("parses canonical Telegram channel post identifiers", () => {
  const html = '<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="NDS4ALLVIDEOS/125"><div class="tgme_widget_message_text js-message_text">Price sweeps prior low and reclaims it with confirmation.</div></div></div>';
  const posts = parseTelegramPosts(html, { name: "NDS4ALLVIDEOS" });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].sourcePostId, "125");
  assert.equal(posts[0].sourcePostUrl, "https://t.me/s/NDS4ALLVIDEOS/125");
});

test("matches channel slug case-insensitively and emits canonical source URL", () => {
  const html = '<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="fuzzylogic_nds/126"><div class="tgme_widget_message_text js-message_text">Liquidity sweep followed by a confirmed market structure shift.</div></div></div>';
  const posts = parseTelegramPosts(html, { name: "FuzzyLogic_NDS" });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].sourcePostId, "126");
  assert.equal(posts[0].sourcePostKey, "FuzzyLogic_NDS/126");
  assert.equal(posts[0].sourcePostUrl, "https://t.me/s/FuzzyLogic_NDS/126");
});
