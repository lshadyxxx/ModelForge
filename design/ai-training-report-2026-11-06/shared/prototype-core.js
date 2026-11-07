window.MFUI = (() => {
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatMetric(value, digits = 4) {
    return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
  }

  function formatLr(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    return value < 0.001 ? value.toExponential(2) : value.toFixed(6);
  }

  function toast(message, duration = 2800) {
    let node = document.getElementById("mf-toast");
    if (!node) {
      node = document.createElement("div");
      node.id = "mf-toast";
      node.className = "mf-toast";
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.classList.add("show");
    window.clearTimeout(node._hideTimer);
    node._hideTimer = window.setTimeout(() => node.classList.remove("show"), duration);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      return copied;
    }
  }

  function initDialog(dialogRoot) {
    if (!dialogRoot) return {open: () => {}, close: () => {}};
    let opener = null;
    const focusable = () => [...dialogRoot.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((node) => node.offsetParent !== null);

    const close = () => {
      if (dialogRoot.hidden) return;
      dialogRoot.hidden = true;
      document.body.style.removeProperty("overflow");
      opener?.focus?.();
    };

    const open = (trigger) => {
      opener = trigger || document.activeElement;
      dialogRoot.hidden = false;
      document.body.style.overflow = "hidden";
      window.requestAnimationFrame(() => {
        (focusable()[0] || dialogRoot.querySelector("[role=dialog]"))?.focus?.();
      });
    };

    dialogRoot.addEventListener("click", (event) => {
      if (event.target === dialogRoot || event.target.closest("[data-dialog-close]")) close();
    });

    dialogRoot.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusable();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    return {open, close};
  }

  function linePath(values, width, height, padding, minimum, maximum) {
    if (!values.length) return "";
    const range = Math.max(maximum - minimum, 0.000001);
    return values.map((value, index) => {
      const x = padding.left + (index / Math.max(values.length - 1, 1)) * (width - padding.left - padding.right);
      const y = padding.top + (1 - (value - minimum) / range) * (height - padding.top - padding.bottom);
      return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");
  }

  function initAskBox(form, responseNode, messages) {
    if (!form) return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = form.querySelector("input, textarea");
      const value = input.value.trim();
      if (!value) {
        input.focus();
        return;
      }
      const reply = messages[value] || "原型示例：这里不会连接模型。建议先查看证据 E-01、E-07 与限制项，避免从单次 Loss 推出业务效果。";
      responseNode.textContent = reply;
      responseNode.hidden = false;
      input.value = "";
      input.focus();
    });
  }

  return {
    escapeHtml,
    formatMetric,
    formatLr,
    toast,
    copyText,
    initDialog,
    linePath,
    initAskBox,
  };
})();
