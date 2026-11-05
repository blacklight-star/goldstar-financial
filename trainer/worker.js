const CHANNELS = [
  { url: "https://t.me/s/NDS4ALLVIDEOS", name: "NDS4ALLVIDEOS" },
  { url: "https://t.me/s/FuzzyLogic_NDS", name: "FuzzyLogic_NDS" },
  { url: "https://t.me/s/BNJ1I", name: "BNJ1I" },
  { url: "https://t.me/s/cottagends", name: "cottagends" }
];
const AI_MODEL = "@cf/zai-org/glm-4.7-flash";
const NDS_SIGNAL_PATTERN = /liquidity|sweep|stop\s*hunt|order\s*block|fair\s*value\s*gap|\bfvg\b|\bbos\b|\bchoch\b|\bmss\b|displacement|mitigation|entry|stop\s*loss|take\s*profit|market\s*structure|risk|support|resistance|نقدینگی|سوییپ|سوئیپ|اوردر\s*بلاک|ساختار\s*بازار|شکست\s*ساختار|حد\s*ضرر|حد\s*سود|ورود|خروج/i;
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
async function acquireKnowledgeWriteLock(env, ownerToken) {
  if (!env.DB || typeof env.DB.prepare !== "function") throw new Error("Atomic D1 knowledge lock binding unavailable");
  const now = Date.now();
  const row = await env.DB.prepare(
    "INSERT INTO gs_worker_locks (lock_name, owner_token, lease_until_ms, updated_at) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(lock_name) DO UPDATE SET owner_token = excluded.owner_token, lease_until_ms = excluded.lease_until_ms, updated_at = excluded.updated_at " +
    "WHERE gs_worker_locks.lease_until_ms <= ? RETURNING owner_token"
  ).bind("knowledge-write", ownerToken, now + 10 * 60 * 1000, new Date(now).toISOString(), now).first();
  return !!row && row.owner_token === ownerToken;
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
  try {
    const direct = await fetch(channel.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GoldstarTrainer/1.0)",
        "Accept": "text/html,application/xhtml+xml"
      }
    });
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
  return { html, text, marker, postIds, posts, hasPosts: posts.length > 0 };
}

async function runDryRun(env, channelName, fetchOnly) {
  const channel = CHANNELS.find(function(item) { return item.name === channelName; });
  if (!channel) throw new Error("Unknown channel");
  const page = await readChannel(env, channel);
  if (fetchOnly) return {
    success: true, dryRun: true, fetchOnly: true, persisted: false,
    channel: channel.name, source: channel.url, postCount: page.postIds.length,
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
  const eligiblePosts = sourcePosts.filter(post => post.text.trim().length >= 120 && NDS_SIGNAL_PATTERN.test(post.text));
  if (!eligiblePosts.length) return {
    success: true, dryRun: true, persisted: false, channel: channel.name,
    source: channel.url, postCount: page.postIds.length, rulesExtracted: 0, evidenceReady: 0,
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
        const page = await readChannel(env, channel);
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
        if (rawHashMap !== null) {
          hashMap = JSON.parse(rawHashMap);
          if (!hashMap || typeof hashMap !== "object" || Array.isArray(hashMap)) throw new Error("Invalid per-post hash map for " + channel.name);
        }
        if (rawDeferred !== null) {
          deferredPosts = JSON.parse(rawDeferred);
          if (!Array.isArray(deferredPosts)) throw new Error("Invalid deferred-post queue for " + channel.name);
        }
        const orderedPosts = page.posts.slice().sort((a, b) => Number(a.sourcePostId) - Number(b.sourcePostId));
        const changedPosts = [];
        for (const post of orderedPosts) {
          const postId = String(post.sourcePostId || "").trim();
          if (!postId) continue;
          const postText = String(post.text || "");
          const contentHash = await sha256Hex(postText + "\nlinks:" + (post.links || []).join("\n") + "\nvideo:" + (post.videoUrls || []).join("\n"));
          if (hashMap[postId] !== contentHash) changedPosts.push({ ...post, sourcePostId: postId, text: postText, contentHash: contentHash });
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
          NDS_SIGNAL_PATTERN.lastIndex = 0;
          return post.text.trim().length >= 120 && NDS_SIGNAL_PATTERN.test(post.text);
        });
        const eligibleIds = new Set(eligiblePosts.map(post => String(post.sourcePostId)));
        const ineligiblePosts = batch.filter(post => !eligibleIds.has(String(post.sourcePostId)));
        for (const post of ineligiblePosts) {
          nextDeferred.push({
            sourcePostId: post.sourcePostId,
            sourcePostUrl: post.sourcePostUrl,
            contentHash: post.contentHash,
            links: (post.links || []).slice(0, 10),
            youtubeLinks: (post.youtubeLinks || []).slice(0, 5),
            videoUrls: (post.videoUrls || []).slice(0, 5),
            reason: post.text.trim().length < 120 ? "insufficient_text_or_video_transcript_missing" : "no_nds_signal",
            recordedAt: new Date().toISOString()
          });
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
        const parsed = extractJSON(await runAI(env, prompt));
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
          additions.push({
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
          });
          addedForChannel++;
        }
        for (const post of batch) nextHashMap[String(post.sourcePostId)] = post.contentHas --- TRUNCATED --- 32,150 chars