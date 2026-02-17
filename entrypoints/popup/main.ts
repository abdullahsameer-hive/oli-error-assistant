async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function safeCapture(tabId: number) {
  try {
    const res = await browser.tabs.sendMessage(tabId, { type: "OLI_CAPTURE_ERROR_TEXT" });
    return { ok: true as const, res };
  } catch (e: any) {
    return { ok: false as const, error: String(e?.message || e) };
  }
}

async function matchError(errorText: string) {
  return await browser.runtime.sendMessage({ type: "OLI_MATCH_ERROR_V2", errorText });
}

function byId<T extends HTMLElement>(id: string) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: #${id}`);
  return el as T;
}

function setText(id: string, text: string) {
  byId<HTMLElement>(id).textContent = text;
}

function clearResults() {
  byId<HTMLDivElement>("results").innerHTML = "";
}

function sanitizeUrl(raw: string): string {
  const t = String(raw || "").trim();

  // Match markdown link: [label](url)
  const md = t.match(/^\[[^\]]*\]\((https?:\/\/[^)]+)\)$/i);
  if (md) return md[1];

  // If it's something like: [https://..](https://..)
  const md2 = t.match(/^\[(https?:\/\/[^\]]+)\]\((https?:\/\/[^)]+)\)$/i);
  if (md2) return md2[2];

  // If it contains a url inside, extract the first http(s) url
  const any = t.match(/https?:\/\/\S+/i);
  if (any) return any[0].replace(/[)\]]+$/g, "");

  return t;
}

function renderMatch(item: any, score: number) {
  const results = document.getElementById("results");
  if (!results) throw new Error("Missing element: #results");

  const container = document.createElement("div");
  container.style.border = "1px solid #ddd";
  container.style.padding = "10px";
  container.style.marginTop = "10px";
  container.style.borderRadius = "8px";

  const header = document.createElement("div");
  header.style.fontWeight = "600";
  header.textContent = `${item?.title ?? "Untitled"} (${Math.round((score ?? 0) * 100)}%)`;
  container.appendChild(header);

  const steps = document.createElement("ol");
  for (const step of (item?.fixSteps ?? [])) {
    const li = document.createElement("li");
    li.textContent = String(step);
    steps.appendChild(li);
  }
  container.appendChild(steps);

  // Links (from KB URL column -> item.links[])
  const links = item?.links;
  if (Array.isArray(links) && links.length) {
    const linksContainer = document.createElement("div");
    linksContainer.style.display = "flex";
    linksContainer.style.flexWrap = "wrap";
    linksContainer.style.gap = "8px";
    linksContainer.style.marginTop = "10px";

    for (const link of links) {
      const url = sanitizeUrl(String(link?.url || ""));
      if (!url) continue;

      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = String(link?.label || "Open link");
      a.style.display = "inline-block";
      a.style.padding = "6px 10px";
      a.style.border = "1px solid #ddd";
      a.style.borderRadius = "8px";
      a.style.textDecoration = "none";

      linksContainer.appendChild(a);
    }

    if (linksContainer.childElementCount > 0) {
      container.appendChild(linksContainer);
    }
  }

  results.appendChild(container);
}

function buildOutboundPayload(args: {
  errorText: string;
  source?: string;
  url?: string;
  pageTitle?: string;
}) {
  const normalized = args.errorText.replace(/\s+/g, " ").trim();
  return {
    error_text: normalized,
    source: args.source || "unknown",
    url: args.url || "",
    page_title: args.pageTitle || "",
    timestamp: new Date().toISOString(),
  };
}

async function run() {
  const btn = byId<HTMLButtonElement>("runBtn");
  btn.disabled = true;

  clearResults();
  setText("status", "");
  setText("captured", "");
  setText("payload", "");

  const tab = await getActiveTab();
  if (!tab?.id) {
    setText("status", "No active tab.");
    btn.disabled = false;
    return;
  }

  setText("status", "Capturing error text...");
  const cap = await safeCapture(tab.id);

  if (!cap.ok) {
    setText(
      "status",
      "Could not message the page. Most likely the content script is not injected. Error: " + cap.error
    );
    btn.disabled = false;
    return;
  }

  const res: any = cap.res;
  if (!res?.ok) {
    setText("status", `Capture ran but found nothing: ${res?.reason ?? "Unknown"}`);
    btn.disabled = false;
    return;
  }

  const errorText = String(res.errorText || "");
  setText("captured", errorText);

  const payload = buildOutboundPayload({
    errorText,
    source: res.source,
    url: tab.url,
    pageTitle: tab.title,
  });

  setText("payload", JSON.stringify(payload, null, 2));

  setText("status", "Searching knowledge base...");
  const matchRes: any = await matchError(errorText);
  setText("kbinfo", `KB source: ${matchRes?.kbSource ?? "unknown"}  Updated: ${matchRes?.kbUpdatedAt ?? "-"}`);

  const matches = matchRes?.matches ?? [];
  if (!matches.length) {
    setText("status", "No match found.");
    btn.disabled = false;
    return;
  }

  setText("status", `Found ${matches.length} match(es).`);
  for (const m of matches) renderMatch(m.item, m.score);

  btn.disabled = false;
}

document.addEventListener("DOMContentLoaded", () => {
  byId<HTMLButtonElement>("runBtn").addEventListener("click", run);

  // Manual search
  const searchBtn = document.getElementById("searchBtn") as HTMLButtonElement | null;
  const searchInput = document.getElementById("searchInput") as HTMLInputElement | null;

  async function runManualSearch() {
    const q = (searchInput?.value || "").trim();
    if (!q) {
      setText("status", "Type something to search.");
      return;
    }
    clearResults();
    setText("captured", q);
    setText("payload", "");
    setText("status", "Searching knowledge base...");
    const matchRes = await matchError(q);
    setText("kbinfo", `KB source: ${matchRes?.kbSource ?? "unknown"}  Updated: ${matchRes?.kbUpdatedAt ?? "-"}`);
    const matches = matchRes?.matches ?? [];
    if (!matches.length) {
      setText("status", "No match found.");
      return;
    }
    setText("status", `Found ${matches.length} match(es).`);
    for (const m of matches) renderMatch(m.item, m.score);
  }

  searchBtn?.addEventListener("click", runManualSearch);
  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runManualSearch();
  });

});
