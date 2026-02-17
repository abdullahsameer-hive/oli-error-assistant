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
  const url = browser.runtime.getURL("errors.json");
  const res = await fetch(url);
  return await res.json();
}

const REMOTE_KB_URL = ""; // TEMP disable remote to force bundled
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "OLI_PING") {
    sendResponse({ ok: true, pong: true });
    return true;
  }
});


chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "OLI_MATCH_ERROR_V2") {
        const errorText = String(msg.errorText || "");
        const kb = await getKB();

        const norm = (x: any) => String(x || "").toLowerCase().replace(/\s+/g, " ").trim();

        const eNorm = norm(errorText);

        const isSpecificTitle = (t: string) => {
          const tn = norm(t);
          if (!tn) return false;
          const toks = tn.split(/[^a-z0-9_]+/g).filter(Boolean).flatMap(x => x.split("_").filter(Boolean));
          return tn.length >= 18 || toks.length >= 3; // guard against tiny generic titles
        };

        const eNorm2 = norm(errorText);

        const exactHits = kb.items
          .filter((it: any) => {
            const tNorm = norm(it?.title || "");
            if (!tNorm || !eNorm2) return false;
            return tNorm === eNorm2 || tNorm.includes(eNorm2) || eNorm2.includes(tNorm);
          })
          .map((it: any) => ({ item: it, score: 1.0 }));

        const keywords = [
          "house_number","housenumber","street","address",
          "postal","postcode","zip",
          "city","state","province",
          "email","phone",
          "weight","dimension","length","width","height",
          "sendcloud","label","carrier","service",
          "hs","hscode","customs","ddp","dap","cod",
          "country","vat","eori"
        ];

        const normTokenize = (txt: string) =>
          norm(txt)
            .split(/[^a-z0-9_]+/g)
            .filter(Boolean)
            .flatMap(t => t.split("_").filter(Boolean));

        const eTokens = new Set(normTokenize(errorText));

        const scored = kb.items.map((it: any) => {
          const title = String(it?.title || "");
          const tNorm = norm(title);
          let sc = 0;

          // Regex patterns get strong score
          const patterns: string[] = Array.isArray(it?.patterns) ? it.patterns : [];
          for (const p of patterns) {
            const pp = String(p ?? "").trim();
            if (!pp) continue;
            if (pp === ".*" || pp === "^.*$") continue;
            try {
              if (new RegExp(pp, "i").test(errorText)) {
                sc = Math.max(sc, 0.95);
                break;
              }
            } catch {}
          }

          // Title containment (medium-strong)
          if (tNorm && norm(errorText).includes(tNorm)) {
            sc = Math.max(sc, 0.85);
          }

          // Keyword overlap (fallback)
          const tTokens = new Set(normTokenize(title));
          let hit = 0;
          for (const k of keywords) {
            const kk = k.replace(/_/g, "");
            const eHit = eTokens.has(k) || eTokens.has(kk);
            const tHit = tTokens.has(k) || tTokens.has(kk);
            if (eHit && tHit) hit++;
          }
          if (hit > 0) {
            sc = Math.max(sc, 0.55 + Math.min(0.35, hit * 0.08));
          }

          return { item: it, score: sc };
        });

        const fuzzy = scored
          .filter((x: any) => x.score > 0)
          .sort((a: any, b: any) => b.score - a.score)
          .slice(0, 5);

        sendResponse({
          ok: true,
          matches: exactHits.length ? exactHits : fuzzy,
          kbSource: kb.source,
          kbUpdatedAt: kb.updatedAt,
          debugExactCount: exactHits.length,
          debugExactTitles: exactHits.slice(0, 10).map((x: any) => x.item?.title || ""),
          debugNormError: eNorm.slice(0, 220)
        });
        return;
      }

      if (msg?.type === "OLI_KB_STATUS_V2") {
        const kb = await getKB();
        sendResponse({ ok: true, kbSource: kb.source, kbUpdatedAt: kb.updatedAt, count: kb.items.length });
        return;
      }
    } catch (e: any) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  return true;
});
