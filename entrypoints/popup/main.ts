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

async function matchError(errorText: string, fcFromPage?: any) {
  return await browser.runtime.sendMessage({ type: "OLI_MATCH_ERROR_V2", errorText, fcFromPage });
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


function getFcTag(item: any): string | null {
  const v = item?.fc ?? item?.FC ?? item?.fulfillmentCenter ?? item?.warehouse ?? item?.warehouses ?? item?.warehouseIds ?? null;
  if (!v) return null;
  if (Array.isArray(v)) {
    const arr = v.map((x: any) => String(x).trim()).filter(Boolean);
    return arr.length ? arr.join(", ") : null;
  }
  const str = String(v).trim();
  return str || null;
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

  // FC chip
  const fc = getFcTag(item);
  if (fc) {
    const chips = document.createElement("div");
    chips.style.display = "flex";
    chips.style.flexWrap = "wrap";
    chips.style.gap = "6px";
    chips.style.marginTop = "8px";

    const chip = document.createElement("span");
    chip.textContent = "FC: " + fc;
    chip.style.display = "inline-block";
    chip.style.padding = "3px 8px";
    chip.style.border = "1px solid #ddd";
    chip.style.borderRadius = "999px";
    chip.style.fontSize = "12px";

    chips.appendChild(chip);
    container.appendChild(chips);
  }

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


function carrierFromMethod(method: any): string | null {
  const t = String(method || "").toLowerCase();
  if (!t) return null;

  if (t.includes("dhl")) return "DHL";
  if (t.includes("dpd")) return "DPD";
  if (t.includes("gls")) return "GLS";
  if (t.includes("ups")) return "UPS";
  if (t.includes("colissimo")) return "Colissimo";
  if (t.includes("mondial")) return "Mondial Relay";
  if (t.includes("correos")) return "Correos";
  if (t.includes("delivengo")) return "Delivengo";
  if (t.includes("spring")) return "Spring";
  if (t.includes("amazon")) return "Amazon";
  if (t.includes("parcelforce") || t.includes("parcel force")) return "Parcelforce";
  if (t.includes("royal mail")) return "Royal Mail";
  if (t.includes("paack")) return "Paack";
  if (t.includes("inpost") || t.includes("in post")) return "InPost";
  if (t.includes("meineinkauf") || t.includes("mein einkauf") || t.includes("meinenkauf")) return "MeinEinkauf";

  // Sendcloud is a label platform, not a carrier.
  return null;
}

function setChip(id: string, text: string | null) {
  const el = document.getElementById(id) as HTMLElement | null;
  if (!el) return;
  const v = String(text || "").trim();
  if (!v) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.textContent = v;
  el.style.display = "inline-block";
}

function setPageContext(fc: any, country: any, shippingMethod: any) {
  const fcVal = String(fc || "").trim();
  const cVal = String(country || "").trim();
  const mVal = String(shippingMethod || "").trim();

  setChip("fcChip", fcVal ? "FC: " + fcVal : null);
  setChip("countryChip", cVal ? "Country: " + cVal : null);

  const carrier = carrierFromMethod(mVal);
  setChip("carrierChip", mVal ? "Carrier: " + mVal : null);
}


function setHints(errorText: string, countryFromPage: any, fcFromPage: any, shippingMethodFromPage: any) {
  const el = document.getElementById("hints");
  if (!el) return;

  const hints: string[] = [];
  const e = String(errorText || "");

  // Hint 1: Retry for transient errors
  if (/(\bapi\b|\b500\b|\bserver\b)/i.test(e)) {
    hints.push("<div class=\"hint\"><b>Hint:</b> Hit Retry (this often resolves transient API/server errors).</div>");
  }

  // Hint 2: Check past orders for uncommon destinations
  const allowed = new Set([
    "united kingdom","uk","great britain","england",
    "france","germany","italy","spain","poland","austria","netherlands","the netherlands","portugal"
  ]);

  const cRaw = String(countryFromPage || "").trim();
  const c = cRaw.toLowerCase();

  if (cRaw && !allowed.has(c)) {
    hints.push("<div class=\"hint\"><b>Hint:</b> Check past orders sent to this destination from the FC (same carrier/method) for a working precedent.</div>");
  }

  // OLI_DOMESTIC_INTL_METHOD_HINT_V1
  // Domestic detection: FC country == destination country
  const fc = String(fcFromPage || "").trim().toUpperCase();
  const method = String(shippingMethodFromPage || "").trim();
  const destRaw = String(countryFromPage || "").trim();

  const fcToCountry: Record<string, string> = {
    POZ1: "poland",
    POZ2: "poland",
    BER3: "germany",
    MAD3: "spain",
    MAD4: "spain",
    MIL1: "italy",
    NOT1: "united kingdom",
    MAN1: "united kingdom",
    AMS1: "netherlands",
    PAR1: "france",
  };

  const normalizeCountry = (c: string) => {
    const x = c.toLowerCase().trim();
    if (["uk","u.k.","great britain","britain","england","scotland","wales","northern ireland","united kingdom"].includes(x)) return "united kingdom";
    if (["the netherlands","netherlands","holland"].includes(x)) return "netherlands";
    return x;
  };

  const fcCountry = fcToCountry[fc] || "";
  const destCountry = normalizeCountry(destRaw);
  const isDomestic = fcCountry && destCountry && fcCountry === destCountry;

  const looksInternational = /\b(global|international|intl|worldwide|europe)\b/i.test(method);

  if (isDomestic && looksInternational) {
    hints.push("<div class=\"hint\"><b>Hint:</b> This shipping method looks international for a domestic order. Double-check the delivery rules / selected method.</div>");
  }

  el.innerHTML = hints.length ? hints.join("") : "";
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
  const fcFromPage = ((res as any)?.fcFromPage ?? null) as any;

  setText("captured", errorText);
  setHints(
    errorText,
    (res as any)?.countryFromPage ?? null,
    (res as any)?.fcFromPage ?? null,
    (res as any)?.shippingMethodFromPage ?? null
  );

  setPageContext((res as any)?.fcFromPage ?? null, (res as any)?.countryFromPage ?? null, (res as any)?.shippingMethodFromPage ?? null);


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

  // Payload dropdown
  const payloadToggle = document.getElementById("payloadToggle") as HTMLButtonElement | null;
  const payloadWrap = document.getElementById("payloadWrap") as HTMLDivElement | null;
  payloadToggle?.addEventListener("click", () => {
    if (!payloadWrap) return;
    const open = payloadWrap.style.display !== "none";
    payloadWrap.style.display = open ? "none" : "block";
  });

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
    setHints(q, null, null, null);

    setPageContext(null, null, null);
    setText("payload", "");
    setText("status", "Searching knowledge base...");
    const matchRes = await matchError(q, null);
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
  

  // Refresh KB button (no await)
  document.getElementById("refreshBtn")?.addEventListener("click", () => {
    const statusEl = document.getElementById("status");
    const kbinfoEl = document.getElementById("kbinfo");
    if (statusEl) statusEl.textContent = "Refreshing KB...";
    chrome.runtime.sendMessage({ type: "OLI_KB_CLEAR_CACHE" })
      .then(() => chrome.runtime.sendMessage({ type: "OLI_KB_STATUS" }))
      .then((st) => {
        if (kbinfoEl) kbinfoEl.textContent = `KB source: ${st?.kbSource ?? "unknown"}  Updated: ${st?.kbUpdatedAt ?? "-"}`;
        if (statusEl) statusEl.textContent = "KB refreshed.";
      })
      .catch((e) => {
        if (statusEl) statusEl.textContent = "Failed to refresh KB: " + String(e?.message || e);
      });
  });

});

});
