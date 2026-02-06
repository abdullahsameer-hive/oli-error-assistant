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
  return await browser.runtime.sendMessage({ type: "OLI_MATCH_ERROR", errorText });
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

function renderMatch(item: any, score: number) {
  const card = document.createElement("div");
  card.style.border = "1px solid #ddd";
  card.style.padding = "10px";
  card.style.marginTop = "10px";
  card.style.borderRadius = "8px";

  const title = document.createElement("div");
  title.style.fontWeight = "600";
  title.textContent = `${item.title} (${Math.round(score * 100)}%)`;

  const steps = document.createElement("ol");
  for (const s of item.fixSteps || []) {
    const li = document.createElement("li");
    li.textContent = s;
    steps.appendChild(li);
  }

  card.appendChild(title);
  card.appendChild(steps);
  byId<HTMLDivElement>("results").appendChild(card);
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
});
