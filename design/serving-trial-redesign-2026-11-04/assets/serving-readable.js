(() => {
  const MIN_FONT_PX = 12;
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "TEXT", "TSPAN"]);

  const hasDirectText = (element) =>
    [...element.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
    );

  function raiseSmallText(root) {
    if (!(root instanceof Element)) return;
    const elements = root.matches("*") ? [root, ...root.querySelectorAll("*")] : [];
    for (const element of elements) {
      if (SKIP_TAGS.has(element.tagName) || element.closest("svg") || element.closest(".sr-only")) {
        continue;
      }
      if (!hasDirectText(element)) continue;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const size = Number.parseFloat(style.fontSize);
      if (size > 0 && size < MIN_FONT_PX) {
        element.style.fontSize = `${MIN_FONT_PX}px`;
      }
    }
  }

  function start() {
    raiseSmallText(document.body);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") {
          raiseSmallText(record.target.parentElement);
          continue;
        }
        for (const node of record.addedNodes) {
          if (node instanceof Element) raiseSmallText(node);
        }
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
