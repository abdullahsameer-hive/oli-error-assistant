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

function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

async function loadKB(): Promise<KBItem[]> {
  const url = browser.runtime.getURL("data/errors.json");
  const res = await fetch(url);
  return await res.json();
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

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(async (msg) => {
    if (msg?.type !== "OLI_MATCH_ERROR") return;

    const errorText: string = msg.errorText ?? "";
    const kb = await loadKB();

    const matches = kb
      .map((item) => ({ item, score: scoreMatch(errorText, item) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return { ok: true, matches };
  });
});
