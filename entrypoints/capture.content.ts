function normalize(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function isVisible(el: Element) {
  const h = el as HTMLElement;
  const style = window.getComputedStyle(h);
  return style.display !== "none" && style.visibility !== "hidden";
}

function getSelectionText(): string | null {
  const t = window.getSelection()?.toString() || "";
  const n = normalize(t);
  return n.length ? n : null;
}

function findIssueNoteMessage(): string | null {
  const labelEls = Array.from(document.querySelectorAll("body *"))
    .filter(isVisible)
    .filter((el) => normalize(el.textContent || "").toUpperCase() === "ISSUE NOTE");

  for (const labelEl of labelEls) {
    const parent = labelEl.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children);
      const idx = siblings.indexOf(labelEl as Element);
      for (let i = idx + 1; i < siblings.length; i++) {
        const t = normalize(siblings[i].textContent || "");
        if (t.length > 20) return t;
      }
    }

    const container =
      labelEl.closest("section") ||
      labelEl.closest("article") ||
      labelEl.closest("[role='region']") ||
      labelEl.closest("div");

    if (!container) continue;

    const candidates = Array.from(container.querySelectorAll("p, pre, li, span, div"))
      .filter(isVisible)
      .map((el) => normalize(el.textContent || ""))
      .filter((t) => t.length > 20)
      .filter((t) => t.toUpperCase() !== "ISSUE NOTE");

    const strong = candidates.find((t) => /error|failed|invalid|exception|not available|cannot/i.test(t));
    if (strong) return strong;

    if (candidates.length) {
      candidates.sort((a, b) => b.length - a.length);
      return candidates[0];
    }
  }

  return null;
}

function findGenericErrorMessage(): string | null {
  const selectors = [
    "[role='alert']",
    "[aria-live='assertive']",
    ".toast, .toaster, .notification, .alert",
    ".error, .error-message, .error-banner, .error-summary",
    "[data-testid*=error], [class*=error], [id*=error]"
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el || !isVisible(el)) continue;
    const t = normalize(el.textContent || "");
    if (t.length > 10) return t;
  }

  const text = document.body?.innerText || "";
  const lines = text
    .split("\n")
    .map((l) => normalize(l))
    .filter((l) => l.length > 20);

  const errorLines = lines.filter((l) => /error|failed|invalid|not available|cannot|exception/i.test(l));
  if (errorLines.length) {
    errorLines.sort((a, b) => b.length - a.length);
    return errorLines[0];
  }

  return null;
}

export default defineContentScript({
  matches: ["https://fc.hive.app/*"],
  runAt: "document_idle",
  main() {
    const handler = (msg: any, _sender: any, sendResponse: (res: any) => void) => {
      if (msg?.type === "OLI_PING") {
        sendResponse({ ok: true, pong: true });
        return true;
      }

      if (msg?.type !== "OLI_CAPTURE_ERROR_TEXT") return;

      const selection = getSelectionText();
      if (selection) {
        sendResponse({ ok: true, errorText: selection, source: "selection" });
        return true;
      }

      const issueNote = findIssueNoteMessage();
      if (issueNote) {
        sendResponse({ ok: true, errorText: issueNote, source: "issue_note" });
        return true;
      }

      const generic = findGenericErrorMessage();
      if (generic) {
        sendResponse({ ok: true, errorText: generic, source: "generic" });
        return true;
      }

      sendResponse({ ok: false, reason: "No error message found on page." });
      return true;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rt: any =
      (globalThis as any).chrome?.runtime ? (globalThis as any).chrome.runtime : (globalThis as any).browser?.runtime;

    rt?.onMessage?.addListener?.(handler);
  }
});
