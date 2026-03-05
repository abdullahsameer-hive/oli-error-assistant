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

    if (msg?.type === "OLI_KB_CLEAR_CACHE") {
      await chrome.storage.local.remove("kb_cache");
      return { ok: true };
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
      function norm2(x: any){ return String(x ?? "").toLowerCase().replace(/\s+/g," ").trim(); }
      function fcBoost(pageFc: string, item: any){
        const a = norm2(pageFc);
        if(!a) return 0;
        const b = norm2((item as any)?.fc ?? (item as any)?.FC ?? "");
        if(!b) return 0;
        return b.includes(a) ? 0.20 : 0;
      }
        const errorText = String(msg.errorText || "");
      const fcFromPage = String((msg as any)?.fcFromPage || "");
        const kb = await getKB();

        const norm = (x: any) => String(x || "").toLowerCase().replace(/\s+/g, " ").trim();

        function normMsg(x: any) {
          const t = norm(String(x ?? ""));
          return t
            .replace(/^["“”'’]+/, "")
            .replace(/["“”'’]+$/, "")
            .replace(/[!?.:;"”'’]+$/g, "")
            .trim();
        }


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

        
        // OLI_PRIMARY_ERROR_V2
        // Extract the human error message for matching (prefer quoted sentence-like strings)
        const extractPrimary = (raw: string) => {
          const t = String(raw || "").trim();

          // Prefer quoted strings that look like a real message (contain spaces)
          const quoted = Array.from(t.matchAll(/"([^"]{4,300})"/g)).map(m => (m[1] || "").trim());
          const human = quoted.filter(q => q.includes(" ") && !/^\w+_\w+/.test(q));
          if (human.length) {
            human.sort((a,b) => b.length - a.length);
            return human[0];
          }

          // Fallback: strip common Sendcloud prefix and metadata
          return t
            .replace(/^sendcloud\s+error\s+occurred\s*:\s*/i, "")
            .replace(/,\s*uncategorized\s*:\s*".*?"\s*$/i, "")
            .replace(/^non_field_errors\s*:\s*/i, "")
            .replace(/^to_service_point\s*:\s*/i, "")
            .trim();
        };

        const primaryText = extractPrimary(errorText);
        const primaryNorm = norm(primaryText);

const eTokens = new Set(normTokenize(primaryText || errorText));

        // OLI_TOKEN_OVERLAP_GATE_V2
        // Hard gate to prevent unrelated matches:
        // require 2+ token overlaps, or 1 overlap if it's a strong token.
        const stopTokens = new Set([
          "the","a","an","and","or","to","of","in","on","for","with","without",
          "please","we","cannot","can","not","is","are","be","this","that",
          "error","errors","message","messages"
        ]);

        const strongSingles = new Set([
          "sendcloud","consignee","to_service_point","service_point","house","number",
          "house_number","postal","postcode","city","email","phone","weight",
          "customs","eori","gls","dpd","ups","dhl","colissimo","mondial","relay","amazon"
        ]);

        const tokenSet = (txt: string) => {
          const toks = normTokenize(txt).map(t => t.toLowerCase());
          return new Set(toks.filter(t => t && t.length >= 3 && !stopTokens.has(t) && !/^\d+$/.test(t)));
        };

        const eTokSet = tokenSet(errorText);


        const scored = kb.items.map((it: any) => {
          const title = String(it?.title || "");
          const tNorm = normMsg(title);

          // Token overlap gate: drop items with no meaningful overlap
          const hay = title + " " + (Array.isArray(it?.patterns) ? it.patterns.join(" ") : "");
          const hTokSet = tokenSet(hay);
          let overlap = 0;
          let oneStrong = false;
          for (const t of eTokSet) {
            if (hTokSet.has(t)) {
              overlap++;
              if (strongSingles.has(t) || t.length >= 8) oneStrong = true;
            }
          }
          // If no overlap, never match this entry
          if (overlap === 0) return { item: it, score: 0 };
          // If only one overlap, require it to be strong
          if (overlap === 1 && !oneStrong) return { item: it, score: 0 };

          let sc = 0;

          // Regex patterns get strong score
          const patterns: string[] = Array.isArray(it?.patterns) ? it.patterns : [];
          for (const p of patterns) {
            const pp = String(p ?? "").trim();
            if (!pp) continue;
            if (pp === ".*" || pp === "^.*$") continue;
            try {
              if (new RegExp(pp, "i").test(primaryText || errorText)) {
                sc = Math.max(sc, 0.95);
                break;
              }
            } catch {}
          }

          // Title containment (medium-strong)
          if (tNorm && (primaryNorm || norm(errorText)).includes(tNorm)) {
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

          return {
  item: it,
  score: (() => {
    const base = sc;
    if (!(base > 0)) return base;
    const pageFc = String((msg as any)?.fcFromPage || "").toLowerCase().trim();
    if (!pageFc) return base;
    const itFc = String((it as any)?.fc ?? (it as any)?.FC ?? "").toLowerCase().trim();
    const boost = (itFc && itFc.includes(pageFc)) ? 0.12 : 0;
    return Math.min(1, base + boost);
  })()
};
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
          debugNormError: (typeof primaryText !== 'undefined' ? normMsg(primaryText) : eNorm).slice(0, 220)
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
