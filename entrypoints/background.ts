type KBItem = {
  id: string;
  title: string;
  patterns: string[];
  symptoms?: string;
  rootCause?: string;
  fixSteps: string[];
  links?: { label: string; url: string }[];
  tags?: string[];
};

type CachedKB = { updatedAt: string; items: KBItem[] };

function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function scoreMatch(errorText: string, item: KBItem) {
  const raw = errorText || "";
  const t = normalize(raw);

  for (const p of item.patterns || []) {
    try {
      const re = new RegExp(p, "i");
      if (re.test(raw)) return 1.0;
    } catch {}
  }

  const title = normalize(item.title || "");
  if (title && t.includes(title)) return 0.85;

  return 0.0;
}

async function loadBundledKB(): Promise<KBItem[]> {
  const url = browser.runtime.getURL("data/errors.json");
  const res = await fetch(url);
  return await res.json();
}

const REMOTE_KB_URL = "https://abdullahsameer-hive.github.io/oli-error-assistant/errors.json";
const CACHE_TTL_MINUTES = 30;

async function loadCache(): Promise<CachedKB | null> {
  const r = await browser.storage.local.get("kb_cache");
  return (r?.kb_cache as CachedKB) || null;
}

async function saveCache(items: KBItem[]) {
  await browser.storage.local.set({
    kb_cache: { updatedAt: new Date().toISOString(), items },
  });
}

function cacheFresh(c: CachedKB) {
  const ageMs = Date.now() - new Date(c.updatedAt).getTime();
  return ageMs < CACHE_TTL_MINUTES * 60 * 1000;
}

async function loadRemote(): Promise<KBItem[] | null> {
  const res = await fetch(REMOTE_KB_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Remote KB fetch failed: ${res.status}`);
  return await res.json();
}

async function getKB(): Promise<{ items: KBItem[]; source: string; updatedAt?: string }> {
  const c = await loadCache();
  if (c && c.items?.length && cacheFresh(c)) return { items: c.items, source: "cache", updatedAt: c.updatedAt };

  try {
    const remote = await loadRemote();
    if (remote && remote.length) {
      await saveCache(remote);
      return { items: remote, source: "remote", updatedAt: new Date().toISOString() };
    }
  } catch {}

  const bundled = await loadBundledKB();
  return { items: bundled, source: "bundled" };
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(async (msg) => {
    if (msg?.type === "OLI_MATCH_ERROR") {
      const errorText: string = msg.errorText ?? "";
      const kb = await getKB();

      const matches = kb.items
        .map((item) => ({ item, score: scoreMatch(errorText, item) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      return { ok: true, matches, kbSource: kb.source, kbUpdatedAt: kb.updatedAt };
    }

    if (msg?.type === "OLI_KB_STATUS") {
      const kb = await getKB();
      return { ok: true, kbSource: kb.source, kbUpdatedAt: kb.updatedAt, count: kb.items.length };
    }
  });
});
