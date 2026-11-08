const CHANNELS = [
  { url: "https://t.me/s/NDS4ALLVIDEOS", name: "NDS4ALLVIDEOS" },
  { url: "https://t.me/s/fuzzylogic_nds", name: "FuzzyLogic_NDS" },
  { url: "https://t.me/s/BNJ1I", name: "BNJ1I" },
  { url: "https://t.me/s/cottagends", name: "cottagends" }
];
const DIAGNOSTIC_CHANNELS = [
  ...CHANNELS,
  { url: "https://t.me/s/NDSsystem", name: "NDSsystem", diagnosticOnly: true },
  { url: "https://t.me/s/NDS_academy", name: "NDS_academy", diagnosticOnly: true },
  { url: "https://t.me/s/NDS_academy_group", name: "NDS_academy_group", diagnosticOnly: true },
  { url: "https://t.me/s/NDS_Algorithm", name: "NDS_Algorithm", diagnosticOnly: true }
];
const AI_MODEL = "@cf/zai-org/glm-4.7-flash";
// High-precision NDS retrieval gate. It is a source prefilter only:
// it never validates, approves, or promotes a trading rule.
const NDS_MIN_SOURCE_LENGTH = 120;
const NDS_EXPLICIT_ANCHOR =
  /\bnodal\s+displacement\s+sequencing\b|\b123\s*[-_ ]?\s*flag\b|\bhook\s*[-–—>→]+\s*hook\s*[-–—>→]+\s*rall(?:y|ies)\b|هوک\s*[-–—>→]+\s*هوک\s*[-–—>→]+\s*رالی/u;
const NDS_RELATION_CONNECTOR =
  /\b(?:after|before|then|followed\s+by|following|preced(?:e|es|ed)|prior\s+to|contains?|includes?|consists?\s+of|made\s+of|formed\s+by|within|parent|child|higher|lower|priority|ends?\s+with|closes?\s+with)\b|بعد(?:\s*از)?|پس\s*از|سپس|قبل\s*از|به\s*دنبال|شامل|متشکل\s*از|والد|فرزند|اولویت|پایان|بسته\s*می\s*شود/u;
const NDS_SENTENCE_BOUNDARY = /[.!?؟؛;\n]+/u;

function normalizeNdsText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[۰-۹٠-٩]/g, digit => String("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩".indexOf(digit) % 10))
    .replace(/[\u200c\u200d\u200e\u200f\u202a-\u202e]/g, " ")
    .toLowerCase();
}

function hasNdsRelatedPair(sentences, leftPattern, rightPattern) {
  return sentences.some(sentence =>
    leftPattern.test(sentence) &&
    rightPattern.test(sentence) &&
    NDS_RELATION_CONNECTOR.test(sentence)
  );
}

export function isNdsRelevantText(value) {
  const text = normalizeNdsText(value);
  if (text.trim().length < NDS_MIN_SOURCE_LENGTH) return false;
  if (NDS_EXPLICIT_ANCHOR.test(text)) return true;

  const sentences = text.split(NDS_SENTENCE_BOUNDARY).map(sentence => sentence.trim()).filter(Boolean);
  const relationships = [
    hasNdsRelatedPair(sentences, /\bhooks?\b|هوک/u, /\bnodes?\b|گره|نود/u),
    hasNdsRelatedPair(sentences, /\bhooks?\b|هوک/u, /\brall(?:y|ies)\b|رالی/u),
    hasNdsRelatedPair(sentences, /\brall(?:y|ies)\b|رالی/u, /\bflags?\b|فلگ/u),
    hasNdsRelatedPair(sentences, /\bflags?\b|فلگ/u, /\blip\b|لیپ/u),
    hasNdsRelatedPair(sentences, /\brall(?:y|ies)\b|رالی/u, /\bdrops?\b|دراپ/u),
    hasNdsRelatedPair(sentences, /\bnodes?\b|گره|نود/u, /\b(?:parent|child|priority|higher|lower|sub-?node)\b|والد|فرزند|اولویت/u)
  ];
  if (relationships.filter(Boolean).length >= 2) return true;

  // Preserve compact methodology summaries when the source explicitly names NDS
  // and describes a broad set of its structural components.
  const namedMethod =
    /\bnds\b[\s\S]{0,45}\b(?:strategy|method|system|framework)\b|\b(?:strategy|method|system|framework)\b[\s\S]{0,45}\bnds\b|استراتژی[\s\S]{0,45}\bnds\b|روش[\s\S]{0,45}\bnds\b/u.test(text);
  const componentFamilies = [
    /\bnodes?\b|گره|نود/u,
    /\bhooks?\b|هوک/u,
    /\brall(?:y|ies)?\b|رالی/u,
    /\bflags?\b|فلگ|لیپ/u,
    /\bsequenc(?:e|ing)\b|توالی|سکانس/u,
    /\bcycles?\b|چرخه|سایکل/u,
    /\bfractals?\b|فراکتال/u,
    /\bsymmetry\b|تقارن/u
  ];
  const componentCount = componentFamilies.filter(pattern => pattern.test(text)).length;
  const structuralDescription = /\b(?:components?|elements?|structure|structural|building blocks)\b|اجزا|عناصر|ساختار|مولفه/u.test(text);
  return namedMethod && componentCount >= 5 && structuralDescription;
}

// Immutable Preview URLs are version-specific; aliases are not DNS routes.
const PREVIEW_HOSTS = new Set([
  "goldstar-trainer-staging.goldstar-nsl83.workers.dev",
  "staging-goldstar-trainer.goldstar-nsl83.workers.dev",
  "staging-v40-goldstar-trainer.goldstar-nsl83.workers.dev",
  "nds-gate-v12-goldstar-trainer-staging.goldstar-nsl83.workers.dev",
  "45c03d2b-goldstar-trainer-staging.goldstar-nsl83.workers.dev"
]);
function isAllowedPreviewHost(url) {
  return PREVIEW_HOSTS.has(url.hostname) ||
    /^[a-f0-9]{8}-goldstar-trainer-staging\.goldstar-nsl83\.workers\.dev$/i.test(url.hostname);
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
function extractJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const startArray = text.indexOf("[");
  const endArray = text.lastIndexOf("]");
  if (startArray >= 0 && endArray > startArray) {
    try { return JSON.parse(text.slice(startArray, endArray + 1)); } catch {}
  }
  const startObject = text.indexOf("{");
  const endObject = text.lastIndexOf("}");
  if (startObject >= 0 && endObject > startObject) {
    try { return JSON.parse(text.slice(startObject, endObject + 1)); } catch {}
  }
  return null;
}
const AI_DAILY_BUDGET_NEURONS = 3000;
const AI_INPUT_NEURONS_PER_MILLION = 5500;
const AI_OUTPUT_NEURONS_PER_MILLION = 36400;
function secondsUntilUtcReset() {
  const now = new Date();
  const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.ceil((reset - now.getTime()) / 1000));
}
function isDailyAiQuotaError(message) {
  return /(?:daily.{0,40}(?:quota|limit)|(?:quota|limit).{0,40}(?:daily|exceeded|reached)|neurons?.{0,40}(?:quota|limit|exceeded)|free.{0,20}allocation)/i.test(String(message || ""));
}
function isTransientAiError(message) {
  return /\b429\b|rate[\s_-]*limit|overloaded|temporarily unavailable|service unavailable/i.test(String(message || ""));
}
async function reserveAiBudget(env, prompt, maxTokens) {
  if (!env.DB || typeof env.DB.prepare !== "function") throw new Error("AI budget D1 binding unavailable; inference blocked");
  const now = new Date(), day = now.toISOString().slice(0, 10);
  const inputTokens = Math.ceil(String(prompt || "").length / 2);
  const estimatedNeurons = Math.max(1, Math.ceil(((inputTokens * AI_INPUT_NEURONS_PER_MILLION) + (maxTokens * AI_OUTPUT_NEURONS_PER_MILLION)) / 1000000 * 1.5));
  const reserved = await env.DB.prepare(
    "INSERT INTO gs_ai_daily_budget (day_utc, reserved_neurons, updated_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(day_utc) DO UPDATE SET reserved_neurons = gs_ai_daily_budget.reserved_neurons + excluded.reserved_neurons, updated_at = excluded.updated_at " +
    "WHERE gs_ai_daily_budget.reserved_neurons + excluded.reserved_neurons <= ? RETURNING reserved_neurons"
  ).bind(day, estimatedNeurons, now.toISOString(), AI_DAILY_BUDGET_NEURONS).first();
  if (!reserved) throw new Error("AI daily safety budget reached; inference skipped to prevent overage");
  return { estimatedNeurons, reservedNeurons: reserved.reserved_neurons, dailyLimitNeurons: AI_DAILY_BUDGET_NEURONS };
}
const KNOWLEDGE_WRITE_LOCK_LEASE_MS = 10 * 60 * 1000;
const KNOWLEDGE_COMMIT_JOURNAL_KEY = "trainer:commit_journal";
const MAX_KNOWLEDGE_JOURNAL_BYTES = 1024 * 1024;
const MAX_DEFERRED_RETRIES = 5;

async function acquireKnowledgeWriteLock(env, ownerToken) {
  if (!env.DB || typeof env.DB.prepare !== "function") throw new Error("Atomic D1 knowledge lock binding unavailable");
  const now = Date.now();
  const row = await env.DB.prepare(
    "INSERT INTO gs_worker_locks (lock_name, owner_token, lease_until_ms, updated_at) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(lock_name) DO UPDATE SET owner_token = excluded.owner_token, lease_until_ms = excluded.lease_until_ms, updated_at = excluded.updated_at " +
    "WHERE gs_worker_locks.lease_until_ms <= ? RETURNING owner_token"
  ).bind("knowledge-write", ownerToken, now + KNOWLEDGE_WRITE_LOCK_LEASE_MS, new Date(now).toISOString(), now).first();
  return !!row && row.owner_token === ownerToken;
}

export async function renewKnowledgeWriteLock(env, ownerToken) {
  if (!env.DB || typeof env.DB.prepare !== "function") throw new Error("Atomic D1 knowledge lock binding unavailable");
  const now = Date.now();
  const row = await env.DB.prepare(
    "UPDATE gs_worker_locks SET lease_until_ms = ?, updated_at = ? " +
    "WHERE lock_name = ? AND owner_token = ? AND lease_until_ms > ? RETURNING owner_token"
  ).bind(now + KNOWLEDGE_WRITE_LOCK_LEASE_MS, new Date(now).toISOString(), "knowledge-write", ownerToken, now).first();
  if (!row || row.owner_token !== ownerToken) {
    throw new Error("Knowledge write lease expired or ownership was lost; refusing further writes");
  }
  return true;
}

const JOURNAL_ALLOWED_KEY = key =>
  key === "knowledge_NDS_pending" ||
  key === "trainer:last_seen:NDS4ALLVIDEOS" ||
  key === "trainer:last_seen:FuzzyLogic_NDS" ||
  key === "trainer:last_seen:BNJ1I" ||
  key === "trainer:last_seen:cottagends" ||
  /^trainer:(post_hashes|deferred_posts):[A-Za-z0-9_]+$/.test(key) ||
  key === "trainer:last_run";

export async function recoverPendingKnowledgeCommit(env, ownerToken) {
  const raw = await env.KNOWLEDGE.get(KNOWLEDGE_COMMIT_JOURNAL_KEY);
  if (raw === null) return false;
  let journal;
  try { journal = JSON.parse(raw); }
  catch { throw new Error("Knowledge commit journal is invalid JSON; refusing further processing"); }
  if (!journal || journal.version !== 1 || !Array.isArray(journal.writes) || journal.writes.length > 100) {
    throw new Error("Knowledge commit journal has an invalid structure; refusing further processing");
  }
  const seen = new Set();
  for (const item of journal.writes) {
    if (!item || typeof item.key !== "string" || typeof item.value !== "string" ||
        !JOURNAL_ALLOWED_KEY(item.key) || seen.has(item.key)) {
      throw new Error("Knowledge commit journal contains an invalid or duplicate write; refusing replay");
    }
    seen.add(item.key);
  }
  await renewKnowledgeWriteLock(env, ownerToken);
  for (const item of journal.writes) {
    await renewKnowledgeWriteLock(env, ownerToken);
    await env.KNOWLEDGE.put(item.key, item.value);
  }
  await renewKnowledgeWriteLock(env, ownerToken);
  await env.KNOWLEDGE.delete(KNOWLEDGE_COMMIT_JOURNAL_KEY);
  return true;
}

export async function persistKnowledgeCommit(env, ownerToken, writes) {
  if (!Array.isArray(writes) || !writes.length) return false;
  const seen = new Set();
  for (const item of writes) {
    if (!item || typeof item.key !== "string" || typeof item.value !== "string" ||
        !JOURNAL_ALLOWED_KEY(item.key) || seen.has(item.key)) {
      throw new Error("Knowledge commit contains an invalid or duplicate write");
    }
    seen.add(item.key);
  }
  const journal = JSON.stringify({ version: 1, createdAt: new Date().toISOString(), writes });
  if (new TextEncoder().encode(journal).length > MAX_KNOWLEDGE_JOURNAL_BYTES) {
    throw new Error("Knowledge commit journal exceeds the 1 MiB safety limit");
  }
  await renewKnowledgeWriteLock(env, ownerToken);
  await env.KNOWLEDGE.put(KNOWLEDGE_COMMIT_JOURNAL_KEY, journal);
  for (const item of writes) {
    await renewKnowledgeWriteLock(env, ownerToken);
    await env.KNOWLEDGE.put(item.key, item.value);
  }
  await renewKnowledgeWriteLock(env, ownerToken);
  await env.KNOWLEDGE.delete(KNOWLEDGE_COMMIT_JOURNAL_KEY);
  return true;
}

export function isDeferredRetryDue(item, nowMs = Date.now()) {
  if (!item || typeof item !== "object") return false;
  const retryCount = Number.isInteger(item.retryCount) ? item.retryCount : 0;
  if (retryCount >= MAX_DEFERRED_RETRIES) return false;
  const dueAt = Date.parse(item.nextRetryAt || item.recordedAt || "");
  return !Number.isFinite(dueAt) || dueAt <= nowMs;
}

export function buildDeferredRecord(post, previous, nowMs = Date.now()) {
  const sameContent = !!previous && previous.contentHash === post.contentHash;
  const retryCount = sameContent
    ? Math.min(MAX_DEFERRED_RETRIES, (Number.isInteger(previous.retryCount) ? previous.retryCount : 0) + (post.deferredRetry ? 1 : 0))
    : 0;
  const delayMs = 24 * 60 * 60 * 1000 * (2 ** Math.min(retryCount, 4));
  return {
    sourcePostId: post.sourcePostId,
    sourcePostUrl: post.sourcePostUrl,
    contentHash: post.contentHash,
    links: (post.links || []).slice(0, 10),
    youtubeLinks: (post.youtubeLinks || []).slice(0, 5),
    videoUrls: (post.videoUrls || []).slice(0, 5),
    reason: post.text.trim().length < 120 ? "insufficient_text_or_video_transcript_missing" : "no_nds_signal",
    retryCount,
    recordedAt: new Date(nowMs).toISOString(),
    nextRetryAt: new Date(nowMs + delayMs).toISOString()
  };
}

async function releaseKnowledgeWriteLock(env, ownerToken) {
  await env.DB.prepare("DELETE FROM gs_worker_locks WHERE lock_name = ? AND owner_token = ?").bind("knowledge-write", ownerToken).run();
}
async function runAI(env, prompt) {
  await reserveAiBudget(env, prompt, 1200);
  const result = await env.AI.run(AI_MODEL, { prompt, max_tokens: 1200 });
  if (result && typeof result.response === "string") return result.response;
  if (result && result.choices && result.choices[0] && result.choices[0].text) return result.choices[0].text;
  if (typeof result === "string") return result;
  throw new Error("AI returned an unsupported response shape");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
function sourceEvidencePayload(rule) {
  return {
    id: String(rule.id || ""),
    contentType: String(rule.contentType || ""),
    category: String(rule.category || ""),
    rule: String(rule.rule || rule.description || ""),
    conditions: Array.isArray(rule.conditions) ? rule.conditions.map(value => String(value)) : [],
    priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : null,
    sourcePostId: String(rule.sourcePostId || ""),
    sourcePostUrl: String(rule.sourcePostUrl || ""),
    sourceExcerptHash: String(rule.sourceExcerptHash || ""),
    sourcePostContentHash: String(rule.sourcePostContentHash || ""),
    sourceCaptureMethod: String(rule.sourceCaptureMethod || ""),
    sourceExcerptVerified: rule.sourceExcerptVerified === true
  };
}

export async function signSourceEvidence(env, rule) {
  if (!env || typeof env.NDS_EVIDENCE_HMAC_KEY !== "string" || env.NDS_EVIDENCE_HMAC_KEY.length < 32) {
    throw new Error("NDS evidence signing key unavailable; candidate cannot be persisted");
  }
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.NDS_EVIDENCE_HMAC_KEY),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(JSON.stringify(sourceEvidencePayload(rule)))
  );
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
}
function cleanTelegramHtml(value) {
  return String(value || "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\\\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
function extractTelegramContentBlocks(wrapper) {
  const openPattern = /<div class="tgme_widget_message_(?:text|caption)[^"]*"[^>]*>/gi;
  const blocks = [];
  let open;
  while ((open = openPattern.exec(wrapper)) !== null) {
    const contentStart = openPattern.lastIndex;
    const tagPattern = /<\/?div\b[^>]*>/gi;
    tagPattern.lastIndex = contentStart;
    let depth = 1;
    let tag;
    let closeIndex = -1;
    let endIndex = contentStart;
    while ((tag = tagPattern.exec(wrapper)) !== null) {
      if (/^<\s*\/div/i.test(tag[0])) depth--;
      else if (!/\/\s*>$/.test(tag[0])) depth++;
      if (depth === 0) {
        closeIndex = tag.index;
        endIndex = tagPattern.lastIndex;
        break;
      }
    }
    if (closeIndex < 0) {
      blocks.push(wrapper.slice(contentStart));
      break;
    }
    blocks.push(wrapper.slice(contentStart, closeIndex));
    openPattern.lastIndex = endIndex;
  }
  return blocks;
}
function decodeTelegramAttribute(value) {
  return String(value || "").replace(/&amp;/gi, "&");
}
function parseTelegramPosts(html, channel) {
  const wrappers = Array.from(html.matchAll(/<div class="tgme_widget_message_wrap[^"]*"[^>]*>([\s\S]*?)(?=<div class="tgme_widget_message_wrap[^"]*"|$)/gi), match => match[1]);
  const posts = [];
  for (const wrapper of wrappers) {
    const postMatch = wrapper.match(/data-post="([^"]+)"/i);
    if (!postMatch) continue;
    const receivedPostKey = postMatch[1];
    const prefix = channel.name + "/";
    if (!receivedPostKey.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const sourcePostId = receivedPostKey.slice(receivedPostKey.lastIndexOf("/") + 1);
    const postKey = prefix + sourcePostId;
    if (!/^\d+$/.test(sourcePostId)) continue;
    const links = Array.from(wrapper.matchAll(/<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>/gi), match => decodeTelegramAttribute(match[1])).filter(url => /^https?:\/\//i.test(url));
    const videoUrls = Array.from(wrapper.matchAll(/<(?:video|source)\b[^>]*(?:src|data-src)\s*=\s*"([^"]+)"[^>]*>/gi), match => decodeTelegramAttribute(match[1])).filter(url => /^https?:\/\//i.test(url));
    const uniqueLinks = Array.from(new Set(links));
    const uniqueVideoUrls = Array.from(new Set(videoUrls));
    const youtubeLinks = uniqueLinks.filter(url => /(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(url));
    const contentBlocks = extractTelegramContentBlocks(wrapper);
    const postText = cleanTelegramHtml(contentBlocks.join(" "));
    if (!postText && !uniqueLinks.length && !uniqueVideoUrls.length) continue;
    posts.push({ sourcePostId, sourcePostKey: postKey, sourcePostUrl: "https://t.me/s/" + postKey, text: postText, links: uniqueLinks, youtubeLinks: youtubeLinks, videoUrls: uniqueVideoUrls });
  }
  return posts;
}
async function channelContentMarker(posts, fallbackText) {
  const recentPosts = Array.isArray(posts) ? posts.slice(-30) : [];
  const material = recentPosts.length
    ? recentPosts.map(function(post) { return String(post.sourcePostKey || "") + "\n" + String(post.text || "") + "\nlinks:" + (post.links || []).join("\n") + "\nvideo:" + (post.videoUrls || []).join("\n"); }).join("\n---\n")
    : String(fallbackText || "");
  return "sha256:" + await sha256Hex(material);
}
async function readChannel(env, channel) {
  let html = "";
  let responseMeta = null;
  try {
    const direct = await fetch(channel.url, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GoldstarTrainer/1.0)",
        "Accept": "text/html,application/xhtml+xml"
      }
    });
    responseMeta = {
      httpStatus: direct.status,
      responseOk: direct.ok,
      finalUrl: direct.url || channel.url,
      redirected: direct.redirected === true,
      contentType: direct.headers.get("content-type") || null,
      server: direct.headers.get("server") || null
    };
    if (!direct.ok) throw new Error("Telegram HTTP " + direct.status);
    html = await direct.text();
  } catch (error) {
    throw new Error("Direct Telegram fetch failed; Browser Run is disabled in zero-cost mode: " + String(error.message || error));
  }

  const posts = parseTelegramPosts(html, channel);
  const postIds = posts.slice(-30).map(post => post.sourcePostKey);
  const text = posts.map(post => post.text).join("\n\n").trim() || cleanTelegramHtml(html);
  if (!text) throw new Error("Channel page contained no readable text");
  const marker = await channelContentMarker(posts, text);
  const diagnostics = {
    requestedUrl: channel.url,
    finalUrl: responseMeta.finalUrl,
    redirected: responseMeta.redirected,
    httpStatus: responseMeta.httpStatus,
    responseOk: responseMeta.responseOk,
    contentType: responseMeta.contentType,
    server: responseMeta.server,
    htmlLength: html.length,
    wrapperCount: (html.match(/<div class="tgme_widget_message_wrap/gi) || []).length,
    dataPostCount: (html.match(/data-post="/gi) || []).length,
    parsedPostCount: posts.length,
    pageTitle: ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").replace(/<[^>]+>/g, " ").trim().slice(0, 180),
    hasTelegramWidget: html.includes("tgme_widget_message"),
    hasRedirectNotice: /redirect|moved permanently|not available|private channel/i.test(cleanTelegramHtml(html).slice(0, 1200))
  };
  return { html, text, marker, postIds, posts, hasPosts: posts.length > 0, diagnostics };
}

async function runDryRun(env, channelName, fetchOnly) {
  const channel = CHANNELS.find(function(item) { return item.name === channelName; });
  if (!channel) throw new Error("Unknown channel");
  const page = await readChannel(env, channel);
  if (fetchOnly) return {
    success: page.hasPosts, retrievalStatus: page.hasPosts ? "posts_extracted" : "no_posts_extracted",
    dryRun: true, fetchOnly: true, persisted: false,
    channel: channel.name, source: channel.url, postCount: page.postIds.length,
    diagnostics: page.diagnostics,
    hasPosts: page.hasPosts, textLength: page.text.length,
    linkCount: page.posts.reduce((sum, post) => sum + (post.links || []).length, 0),
    youtubeLinkCount: page.posts.reduce((sum, post) => sum + (post.youtubeLinks || []).length, 0),
    videoUrlCount: page.posts.reduce((sum, post) => sum + (post.videoUrls || []).length, 0),
    youtubeLinks: Array.from(new Set(page.posts.flatMap(post => post.youtubeLinks || []))).slice(0, 5),
    videoUrls: Array.from(new Set(page.posts.flatMap(post => post.videoUrls || []))).slice(0, 5),
    textSample: page.text.slice(0, 600),
    note: "Direct source retrieval only. No AI call and no KV write."
  };
  const sourcePosts = page.posts.slice(-10).map(post => ({
    sourcePostId: post.sourcePostId,
    text: post.text.slice(0, 1600)
  }));
  const eligiblePosts = sourcePosts.filter(post => isNdsRelevantText(post.text));
  if (!eligiblePosts.length) return {
    success: false, retrievalStatus: page.hasPosts ? "no_eligible_nds_content" : "no_posts_extracted",
    dryRun: true, persisted: false, channel: channel.name,
    source: channel.url, postCount: page.postIds.length, diagnostics: page.diagnostics,
    rulesExtracted: 0, evidenceReady: 0,
    sample: [], note: "No substantive NDS text/transcript found; AI was not called."
  };
  const prompt = "Extract only explicit NDS trading rules. Exclude channel administration, video upload notices, moderation, advertisements, and unrelated discussion. Return ONLY a JSON array. Each item must contain contentType exactly trading_rule, sourcePostId copied from one supplied post, sourceExcerpt copied verbatim as a contiguous 40-1000 character substring of that post, category, rule, conditions, priority. Never invent a sourcePostId or paraphrase sourceExcerpt. If no valid trading rule exists, return []. Source posts: " + JSON.stringify(eligiblePosts);
  const parsed = extractJSON(await runAI(env, prompt));
  const rules = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.rules) ? parsed.rules : null);
  if (!rules) throw new Error("AI output was not a JSON rules array");
  const evidenceReady = rules.filter(item => {
    if (!item || item.contentType !== "trading_rule") return false;
    const post = page.posts.find(candidate => candidate.sourcePostId === String(item.sourcePostId || "").trim());
    const excerpt = String(item.sourceExcerpt || "").trim();
    return !!post && excerpt.length >= 40 && excerpt.length <= 2000 && post.text.includes(excerpt);
  });
  return {
    success: true, dryRun: true, persisted: false, channel: channel.name,
    source: channel.url, postCount: page.postIds.length,
    rulesExtracted: rules.length, evidenceReady: evidenceReady.length,
    rejectedEvidence: rules.length - evidenceReady.length,
    sample: evidenceReady.slice(0, 3),
    note: "No KV data was written or changed."
  };
}

async function runScheduledTraining(env) {
  if (!env.NDS_EVIDENCE_HMAC_KEY || env.NDS_EVIDENCE_HMAC_KEY.length < 32) {
    const blocked = {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      success: false,
      executionStatus: "blocked",
      learningSuccess: false,
      learningStatus: "evidence_signing_key_missing",
      error: "NDS_EVIDENCE_HMAC_KEY is required; no training or persistence was performed."
    };
    await env.KNOWLEDGE.put("trainer:last_run", JSON.stringify(blocked));
    return blocked;
  }
  const quotaBackoff = await env.KNOWLEDGE.get("trainer:ai_quota_backoff");
  const budgetBackoff = await env.KNOWLEDGE.get("trainer:ai_budget_backoff");
  const transientBackoff = await env.KNOWLEDGE.get("trainer:ai_transient_backoff");
  if (quotaBackoff || budgetBackoff || transientBackoff) {
    const skipped = { startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), success: true, executionStatus: "skipped", learningSuccess: false, learningStatus: "backoff_active", backoff: { dailyQuota: !!quotaBackoff, localBudget: !!budgetBackoff, transient: !!transientBackoff } };
    await env.KNOWLEDGE.put("trainer:last_run", JSON.stringify(skipped));
    return skipped;
  }
  if (!env.DB || typeof env.DB.prepare !== "function") return { skipped: true, reason: "Atomic D1 lock unavailable; training failed closed" };
  const lockOwner = crypto.randomUUID();
  let lockAcquired = false;
  try { lockAcquired = await acquireKnowledgeWriteLock(env, lockOwner); }
  catch (error) { return { skipped: true, reason: "Atomic D1 lock failed closed", error: String(error.message || error) }; }
  if (!lockAcquired) return { skipped: true, reason: "another knowledge writer holds the shared D1 lock" };
  const summary = {
    startedAt: new Date().toISOString(),
    channels: [],
    newRules: 0,
    existingRules: 0,
    pendingRules: 0,
    totalChangedPosts: 0,
    totalEligiblePosts: 0,
    aiCalls: 0,
    rejectedEvidence: 0,
    success: false,
    learningSuccess: false
  };
  try {
    await recoverPendingKnowledgeCommit(env, lockOwner);
    await renewKnowledgeWriteLock(env, lockOwner);
    const rawExisting = await env.KNOWLEDGE.get("knowledge_NDS");
    const rawPending = await env.KNOWLEDGE.get("knowledge_NDS_pending");
    let existing = [];
    let pending = [];
    if (rawExisting !== null) {
      existing = JSON.parse(rawExisting);
      if (!Array.isArray(existing)) throw new Error("knowledge_NDS is not a JSON array; refusing to modify active knowledge");
    }
    if (rawPending !== null) {
      pending = JSON.parse(rawPending);
      if (!Array.isArray(pending)) throw new Error("knowledge_NDS_pending is not a JSON array; refusing to overwrite pending knowledge");
    }
    summary.existingRules = existing.length;
    summary.pendingRules = pending.length;
    const seen = new Set(existing.concat(pending).map(rule =>
      String(rule.rule || rule.description || rule.title || JSON.stringify(rule)).trim().toLowerCase().replace(/\s+/g, " ")
    ));
    const additions = [];
    const markers = [];
    const hashMapWrites = [];
    const deferredWrites = [];
    for (const channel of CHANNELS) {
      let aiCallStarted = false;
      try {
        await renewKnowledgeWriteLock(env, lockOwner);
        const page = await readChannel(env, channel);
        await renewKnowledgeWriteLock(env, lockOwner);
        const markerKey = "trainer:last_seen:" + channel.name;
        const previousMarker = await env.KNOWLEDGE.get(markerKey);
        if (page.marker && page.marker !== previousMarker) markers.push({ key: markerKey, value: page.marker });
        if (!page.hasPosts) {
          summary.channels.push({ channel: channel.name, status: "no_public_posts", postCount: page.postIds.length, changedPosts: 0, eligiblePosts: 0 });
          continue;
        }
        const hashKey = "trainer:post_hashes:" + channel.name;
        const deferredKey = "trainer:deferred_posts:" + channel.name;
        const rawHashMap = await env.KNOWLEDGE.get(hashKey);
        const rawDeferred = await env.KNOWLEDGE.get(deferredKey);
        let hashMap = {};
        let deferredPosts = [];
        const deferredById = new Map();
        if (rawHashMap !== null) {
          hashMap = JSON.parse(rawHashMap);
          if (!hashMap || typeof hashMap !== "object" || Array.isArray(hashMap)) throw new Error("Invalid per-post hash map for " + channel.name);
        }
        if (rawDeferred !== null) {
          deferredPosts = JSON.parse(rawDeferred);
          if (!Array.isArray(deferredPosts)) throw new Error("Invalid deferred-post queue for " + channel.name);
        }
        for (const item of deferredPosts) {
          if (item && item.sourcePostId) deferredById.set(String(item.sourcePostId), item);
        }
        const orderedPosts = page.posts.slice().sort((a, b) => Number(a.sourcePostId) - Number(b.sourcePostId));
        const changedPosts = [];
        for (const post of orderedPosts) {
          const postId = String(post.sourcePostId || "").trim();
          if (!postId) continue;
          const postText = String(post.text || "");
          const contentHash = await sha256Hex(postText + "\nlinks:" + (post.links || []).join("\n") + "\nvideo:" + (post.videoUrls || []).join("\n"));
          const previousDeferred = deferredById.get(postId);
          const retryDue = previousDeferred && previousDeferred.contentHash === contentHash && isDeferredRetryDue(previousDeferred);
          if (hashMap[postId] !== contentHash || retryDue) {
            changedPosts.push({
              ...post, sourcePostId: postId, text: postText, contentHash: contentHash,
              deferredRetry: !!retryDue
            });
          }
        }
        if (!changedPosts.length) {
          summary.channels.push({ channel: channel.name, status: "unchanged", postCount: page.postIds.length, changedPosts: 0, eligiblePosts: 0 });
          continue;
        }
        const batch = changedPosts.slice(0, 10);
        summary.totalChangedPosts += batch.length;
        const batchIds = new Set(batch.map(post => String(post.sourcePostId)));
        let nextDeferred = deferredPosts.filter(item => !batchIds.has(String(item.sourcePostId)));
        const eligiblePosts = batch.filter(post => {
          return isNdsRelevantText(post.text);
        });
        const eligibleIds = new Set(eligiblePosts.map(post => String(post.sourcePostId)));
        const ineligiblePosts = batch.filter(post => !eligibleIds.has(String(post.sourcePostId)));
        for (const post of ineligiblePosts) {
          nextDeferred.push(buildDeferredRecord(post, deferredById.get(String(post.sourcePostId))));
        }
        nextDeferred = nextDeferred.slice(-100);
        const nextHashMap = {};
        const currentIds = new Set(orderedPosts.map(post => String(post.sourcePostId || "")));
        for (const [id, hash] of Object.entries(hashMap)) if (currentIds.has(id)) nextHashMap[id] = hash;
        if (!eligiblePosts.length) {
          for (const post of batch) nextHashMap[String(post.sourcePostId)] = post.contentHash;
          hashMapWrites.push({ key: hashKey, value: JSON.stringify(nextHashMap) });
          deferredWrites.push({ key: deferredKey, value: JSON.stringify(nextDeferred) });
          summary.channels.push({
            channel: channel.name, status: "deferred_low_signal", postCount: page.postIds.length,
            changedPosts: batch.length, eligiblePosts: 0, deferredPosts: ineligiblePosts.length,
            remainingChangedPosts: Math.max(0, changedPosts.length - batch.length)
          });
          continue;
        }
        const promptPosts = eligiblePosts.map(post => ({
          sourcePostId: post.sourcePostId,
          text: post.text.slice(0, 1600)
        }));
        const prompt = "Extract only explicit NDS trading rules. Exclude channel administration, video upload notices, moderation, advertisements, and unrelated discussion. Return ONLY a JSON array. Each item must contain contentType exactly trading_rule, sourcePostId copied from one supplied post, sourceExcerpt copied verbatim as a contiguous 40-1000 character substring of that post, category, rule, conditions, priority. Never invent a sourcePostId or paraphrase sourceExcerpt. If no valid trading rule exists, return []. Source posts: " + JSON.stringify(promptPosts);
        summary.totalEligiblePosts += eligiblePosts.length;
        summary.aiCalls += 1;
        aiCallStarted = true;
        await renewKnowledgeWriteLock(env, lockOwner);
        const parsed = extractJSON(await runAI(env, prompt));
        await renewKnowledgeWriteLock(env, lockOwner);
        const rules = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.rules) ? parsed.rules : null);
        if (!rules) throw new Error("AI output was not a JSON rules array");
        let addedForChannel = 0;
        for (const item of rules) {
          if (!item || typeof item !== "object") continue;
          const ruleText = String(item.rule || item.description || item.title || "").trim();
          const sourcePostId = String(item.sourcePostId || "").trim();
          const post = page.posts.find(candidate => candidate.sourcePostId === sourcePostId);
          const excerpt = String(item.sourceExcerpt || "").trim();
          const conditions = Array.isArray(item.conditions) ? item.conditions.map(value => String(value).trim()).filter(Boolean) : [];
          const category = String(item.category || "").trim();
          if (item.contentType !== "trading_rule" || !ruleText || !category || !conditions.length ||
              !post || excerpt.length < 40 || excerpt.length > 2000 || !post.text.includes(excerpt)) {
            summary.rejectedEvidence = (summary.rejectedEvidence || 0) + 1;
            continue;
          }
          const fingerprint = ruleText.toLowerCase().replace(/\s+/g, " ");
          if (seen.has(fingerprint)) continue;
          seen.add(fingerprint);
          const addition = {
            ...item,
            id: "nds_" + crypto.randomUUID(),
            style: "NDS",
            contentType: "trading_rule",
            category,
            rule: ruleText,
            conditions,
            priority: Number.isFinite(Number(item.priority)) ? Math.max(1, Math.min(10, Math.round(Number(item.priority)))) : 5,
            source: post.sourcePostUrl,
            sourceName: channel.name,
            sourcePostIds: [post.sourcePostKey],
            sourcePostId: post.sourcePostId,
            sourcePostUrl: post.sourcePostUrl,
            sourceExcerpt: excerpt,
            sourceExcerptHash: await sha256Hex(excerpt),
            sourceExcerptVerified: true,
            sourcePostContentHash: await sha256Hex(post.text),
            sourceCaptureMethod: "telegram_public_post_html",
            collectedAt: new Date().toISOString(),
            validationStatus: "pending"
          };
          addition.sourceEvidenceSignature = await signSourceEvidence(env, addition);
          additions.push(addition);
          addedForChannel++;
        }
        for (const post of batch) nextHashMap[String(post.sourcePostId)] = post.contentHash;
        hashMapWrites.push({ key: hashKey, value: JSON.stringify(nextHashMap) });
        deferredWrites.push({ key: deferredKey, value: JSON.stringify(nextDeferred) });
        summary.channels.push({
          channel: channel.name, status: "reviewed", postCount: page.postIds.length,
          changedPosts: batch.length, eligiblePosts: eligiblePosts.length, rulesExtracted: rules.length,
          newRules: addedForChannel, rejectedEvidence: Math.max(0, rules.length - addedForChannel),
          deferredPosts: ineligiblePosts.length, remainingChangedPosts: Math.max(0, changedPosts.length - batch.length)
        });
      } catch (error) {
        const message = String(error.message || error);
        summary.channels.push({ channel: channel.name, status: "error", error: message });
        if (aiCallStarted && /AI daily safety budget reached/i.test(message)) {
          await env.KNOWLEDGE.put("trainer:ai_budget_backoff", "1", { expirationTtl: secondsUntilUtcReset() });
          summary.aiBackoff = "local_daily_budget";
          break;
        }
        if (aiCallStarted && isDailyAiQuotaError(message)) {
          await env.KNOWLEDGE.put("trainer:ai_quota_backoff", "1", { expirationTtl: secondsUntilUtcReset() });
          summary.aiBackoff = "provider_daily_quota";
          break;
        }
        if (aiCallStarted && isTransientAiError(message)) {
          await env.KNOWLEDGE.put("trainer:ai_transient_backoff", "1", { expirationTtl: 300 });
          summary.aiBackoff = "transient_rate_limit";
          break;
        }
      }
    }
    summary.newRules = additions.length;
    summary.pendingRules = pending.length + additions.length;
    summary.success = !summary.channels.some(channel => channel.status === "error");
    summary.executionStatus = summary.success ? "completed" : "partial_with_errors";
    summary.learningSuccess = additions.length > 0;
    const hasChannelErrors = summary.channels.some(channel => channel.status === "error");
    summary.learningStatus = additions.length > 0 ? (hasChannelErrors ? "partial_new_rules_added" : "new_rules_added") : hasChannelErrors ? "processing_errors" : summary.totalEligiblePosts > 0 ? "content_reviewed_no_new_rules" : summary.totalChangedPosts > 0 ? "new_posts_deferred_or_filtered" : "no_new_source_content";
    summary.finishedAt = new Date().toISOString();

    const commitWrites = [];
    if (additions.length) commitWrites.push({
      key: "knowledge_NDS_pending",
      value: JSON.stringify(pending.concat(additions))
    });
    for (const item of hashMapWrites) commitWrites.push(item);
    for (const item of deferredWrites) commitWrites.push(item);
    for (const marker of markers) commitWrites.push(marker);
    await persistKnowledgeCommit(env, lockOwner, commitWrites);
    await renewKnowledgeWriteLock(env, lockOwner);
    await env.KNOWLEDGE.put("trainer:last_run", JSON.stringify(summary));
    return summary;
  } catch (error) {
    summary.error = String(error.message || error);
    summary.finishedAt = new Date().toISOString();
    await env.KNOWLEDGE.put("trainer:last_run", JSON.stringify(summary)).catch(() => {});
    throw error;
  } finally {
    await releaseKnowledgeWriteLock(env, lockOwner).catch(() => {});
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/__preview/parser-selftest" && request.method === "GET" && isAllowedPreviewHost(url)) {
      const sampleHtml = '<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="NDS4ALLVIDEOS/125"><div class="tgme_widget_message_text js-message_text">Rule A: price sweeps prior low <div class="tgme_widget_message_link_preview">nested detail</div> and then reclaims it &amp; confirms.</div><div class="tgme_widget_message_caption">Risk must be defined before entry.</div></div></div><div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="NDS4ALLVIDEOS/126"><div class="tgme_widget_message_text js-message_text">Rule B: wait for higher-timeframe confirmation.</div></div></div>';
      const parsed = parseTelegramPosts(sampleHtml, { name: "NDS4ALLVIDEOS" });
      const lowerCaseHtml = sampleHtml.replace(/NDS4ALLVIDEOS\//g, "fuzzylogic_nds/");
      const lowerCaseParsed = parseTelegramPosts(lowerCaseHtml, { name: "FuzzyLogic_NDS" });
      const markerOne = await channelContentMarker(parsed, "");
      const markerSame = await channelContentMarker(parsed, "");
      const editedPosts = parsed.map(function(post, index) { return index === 0 ? Object.assign({}, post, { text: post.text + " edited" }) : post; });
      const markerEdited = await channelContentMarker(editedPosts, "");
      const checks = {
        markerStableForSameContent: markerOne === markerSame,
        markerChangesOnEdit: markerOne !== markerEdited,
        twoPosts: parsed.length === 2,
        firstPostId: parsed[0] && parsed[0].sourcePostId === "125",
        firstPostUrl: parsed[0] && parsed[0].sourcePostUrl === "https://t.me/s/NDS4ALLVIDEOS/125",
        nestedContentPreserved: parsed[0] && parsed[0].text.includes("nested detail and then reclaims it & confirms."),
        captionPreserved: parsed[0] && parsed[0].text.includes("Risk must be defined before entry."),
        secondPostPreserved: parsed[1] && parsed[1].text.includes("higher-timeframe confirmation"),
        caseInsensitiveChannelSlug: lowerCaseParsed.length === 2 && lowerCaseParsed[0].sourcePostUrl === "https://t.me/s/FuzzyLogic_NDS/125"
      };
      return json({ success: Object.values(checks).every(Boolean), checks, parsed });
    }
    if (url.pathname === "/__preview/dry-run" && request.method === "GET" && isAllowedPreviewHost(url)) {
      try {
        const channelName = url.searchParams.get("channel") || CHANNELS[0].name;
        // This preview route is public and must never trigger Workers AI.
        // AI-backed extraction requires a separate authenticated control path.
        return json(await runDryRun(env, channelName, true));
      } catch (error) {
        return json({ success: false, dryRun: true, persisted: false, error: String(error.message || error) }, 502);
      }
    }
    if (url.pathname === "/__preview/source-diagnostics" && request.method === "GET" &&
        isAllowedPreviewHost(url)) {
      const results = await Promise.all(DIAGNOSTIC_CHANNELS.map(async function(channel) {
        try {
          const page = await readChannel(env, channel);
          return {
            channel: channel.name,
            sourceRole: channel.diagnosticOnly ? "diagnostic_only" : "configured_source",
            success: page.hasPosts,
            retrievalStatus: page.hasPosts ? "posts_extracted" : "no_posts_extracted",
            postCount: page.posts.length,
            textLength: page.text.length,
            linkCount: page.posts.reduce(function(sum, post) { return sum + (post.links || []).length; }, 0),
            diagnostics: page.diagnostics
          };
        } catch (error) {
          return {
            channel: channel.name,
            sourceRole: channel.diagnosticOnly ? "diagnostic_only" : "configured_source",
            success: false,
            retrievalStatus: "fetch_error",
            error: String(error.message || error).slice(0, 240)
          };
        }
      }));
      const configuredResults = results.filter(function(item) { return item.sourceRole === "configured_source"; });
      return json({
        ok: configuredResults.length === CHANNELS.length && configuredResults.every(function(item) {
          return item.success === true && item.retrievalStatus === "posts_extracted" && item.postCount > 0;
        }),
        diagnosticOnly: {
          total: results.length - configuredResults.length,
          successful: results.filter(function(item) { return item.sourceRole === "diagnostic_only" && item.success === true; }).length
        },
        dryRun: true,
        persisted: false,
        aiCalled: false,
        channels: results
      });
    }
    if (url.pathname === "/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "goldstar-trainer",
        mode: "staging-nds-ingestion",
        scheduler: "paused; no Cron triggers configured",
        integrations: ["Direct HTTPS fetch only", "Workers AI with 3,000-neuron daily cap", "Workers KV", "D1 atomic lock"]
      });
    }
    if (url.pathname === "/admin/diagnostics" && request.method === "POST") {
      const secret = env.GOLDSTAR_BRIDGE_SECRET || "";
      if (!secret || request.headers.get("authorization") !== "Bearer " + secret) return json({ error: "Unauthorized" }, 401);
      let knowledge = { ok: false };
      try {
        const value = await env.KNOWLEDGE.get("knowledge_NDS");
        knowledge = { ok: true, keyPresent: value !== null, bytes: value ? new TextEncoder().encode(value).length : 0 };
      } catch (error) {
        knowledge = { ok: false, error: String(error.message || error).slice(0, 160) };
      }
      return json({
        ok: true,
        service: "goldstar-trainer",
        checks: { auth: true, kv: knowledge, aiBinding: !!env.AI, browserBinding: !!env.BROWSER, scheduledHandler: true },
        note: "Read-only diagnostics. No training run was started."
      });
    }
    if ((url.pathname === "/admin/status" || url.pathname === "/admin/run-once") && request.method === (url.pathname.endsWith("run-once") ? "POST" : "GET")) {
      const secret = env.GOLDSTAR_BRIDGE_SECRET || "";
      if (!secret || request.headers.get("authorization") !== "Bearer " + secret) return json({ error: "Unauthorized" }, 401);
      if (url.pathname === "/admin/status") {
        const [lastRun, rawRules, rawPending] = await Promise.all([
          env.KNOWLEDGE.get("trainer:last_run"),
          env.KNOWLEDGE.get("knowledge_NDS"),
          env.KNOWLEDGE.get("knowledge_NDS_pending")
        ]);
        let count = 0;
        let pendingCount = 0;
        try { count = rawRules ? JSON.parse(rawRules).length : 0; } catch {}
        try { pendingCount = rawPending ? JSON.parse(rawPending).length : 0; } catch {}
        return json({ service: "goldstar-trainer", approvedRuleCount: count, pendingRuleCount: pendingCount, lastRun: lastRun ? JSON.parse(lastRun) : null });
      }
      try {
        return json(await runScheduledTraining(env));
      } catch (error) {
        return json({ success: false, error: String(error.message || error) }, 502);
      }
    }
    return json({ error: "Not found" }, 404);
  },
  async scheduled(event, env) {
    await runScheduledTraining(env);
  }
};