(() => {
  const stateMeta = {
    queued: { label: "排队", short: "排队", tone: "waiting", stage: 0 },
    waiting_instance: { label: "等待手动创建实例", short: "等待实例", tone: "waiting", stage: 1 },
    preparing: { label: "准备推理", short: "准备中", tone: "preparing", stage: 2 },
    ready: { label: "可试用", short: "可试用", tone: "ready", stage: 3 },
    stopping: { label: "停止并回收中", short: "回收中", tone: "stopping", stage: 4 },
    stopped: { label: "已结束", short: "已结束", tone: "stopped", stage: 5 },
    blocked: { label: "需要处理", short: "需处理", tone: "blocked", stage: 3 },
  };

  const trials = [
    {
      id: "fdb5a28c",
      state: "ready",
      adapter: "adapter-best-01",
      adapterRole: "Best",
      attempt: "A#7",
      evalLoss: "0.3218",
      instance: "u-4090-11-c2a1",
      base: "Qwen3-0.6B",
      baseFingerprint: "Qwen3-0.6B-20261102-r1",
      adapterFingerprint: "best-fingerprint",
      createdAt: "今天 13:42",
      gpu: "RTX 4090 · 1 卡",
      runtime: "vLLM · lock-20261102",
      modelLength: "4096",
      maxTokens: "2048",
    },
    {
      id: "77c4e8a2",
      state: "waiting_instance",
      adapter: "adapter-final-01",
      adapterRole: "Final",
      attempt: "A#6",
      evalLoss: "0.3401",
      instance: "待关联",
      base: "Qwen3-0.6B",
      baseFingerprint: "Qwen3-0.6B-20261102-r1",
      adapterFingerprint: "final-fingerprint",
      createdAt: "今天 12:18",
      gpu: "RTX 4090 · 1 卡",
      runtime: "vLLM · lock-20261102",
      modelLength: "4096",
      maxTokens: "2048",
    },
    {
      id: "5ae019bd",
      state: "blocked",
      adapter: "adapter-best-04",
      adapterRole: "Best",
      attempt: "A#4",
      evalLoss: "0.3870",
      instance: "u-4090-08-4d21",
      base: "Qwen3-0.6B",
      baseFingerprint: "Qwen3-0.6B-20261102-r1",
      adapterFingerprint: "best-a4-fingerprint",
      createdAt: "昨天 21:06",
      gpu: "RTX 4090 · 1 卡",
      runtime: "vLLM · lock-20261102",
      modelLength: "4096",
      maxTokens: "2048",
      error: "runtime_exited",
    },
  ];

  const scenarios = {
    empty: { id: null, view: "empty", label: "空状态" },
    loading: { id: null, view: "loading", label: "加载中" },
    create: { id: "fdb5a28c", view: "workspace", label: "创建试用", dialog: "create" },
    waiting: { id: "77c4e8a2", view: "waiting", label: "等待实例" },
    preparing: { id: "77c4e8a2", view: "preparing", label: "准备推理" },
    ready: { id: "fdb5a28c", view: "workspace", label: "可试用" },
    streaming: { id: "fdb5a28c", view: "workspace", label: "流式生成" },
    blocked: { id: "5ae019bd", view: "blocked", label: "失败" },
    stopping: { id: "fdb5a28c", view: "stopping", label: "回收中", stateOverride: "stopping" },
    stopped: { id: "fdb5a28c", view: "stopped", label: "成功回收", stateOverride: "stopped" },
  };

  const initialUser = "我们有一个 7 天无理由退款政策。用户已经拆封，但说商品与描述不符。请给出一段既解释规则、又避免直接承诺退款的客服回复。";
  const demoReply = "可以先确认具体不符点，再说明核验流程：\n\n“理解您对商品描述的疑虑。为了准确处理，请提供外包装、商品实物和描述不一致处的照片。我们会在 1 个工作日内完成核验；若确认存在描述不符，将按平台规则为您安排退款。若仅因个人原因退货，已拆封商品仍需按 7 天无理由政策的完好性要求判断。”\n\n建议下一句追问：您最希望我们优先核对哪一处差异？";

  const iconPaths = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect>',
    database: '<ellipse cx="12" cy="5" rx="7.5" ry="3"></ellipse><path d="M4.5 5v7c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V5"></path><path d="M4.5 12v7c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-7"></path>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"></path><path d="m3 12 9 5 9-5"></path><path d="m3 16 9 5 9-5"></path>',
    monitor: '<rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8M12 17v4"></path>',
    trend: '<path d="m3 17 6-6 4 4 8-9"></path><path d="M17 6h4v4"></path>',
    message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z"></path>',
    plus: '<path d="M12 5v14M5 12h14"></path>',
    play: '<path d="m8 5 11 7-11 7V5Z"></path>',
    clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1"></rect>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"></path><path d="M20 4v7h-7"></path>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"></path>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>',
    close: '<path d="m6 6 12 12M18 6 6 18"></path>',
    check: '<path d="m5 12 4 4L19 6"></path>',
    alert: '<path d="M12 4 3 20h18L12 4Z"></path><path d="M12 9v5M12 17h.01"></path>',
    chevron: '<path d="m8 10 4 4 4-4"></path>',
    more: '<circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M15 4v16"></path>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"></path><path d="M3 6h.01M3 12h.01M3 18h.01"></path>',
    external: '<path d="M14 4h6v6"></path><path d="m20 4-9 9"></path><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"></path>',
    spark: '<path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z"></path>',
    edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"></path>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"></path><path d="M10 11v5M14 11v5"></path>',
    pin: '<path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"></path><circle cx="12" cy="9" r="2.5"></circle>',
    shield: '<path d="M12 3 4 6v5c0 5.2 3.5 8.6 8 10 4.5-1.4 8-4.8 8-10V6l-8-3Z"></path><path d="m9 12 2 2 4-4"></path>',
    wifi: '<path d="M5 12.5a10 10 0 0 1 14 0"></path><path d="M8.5 16a5 5 0 0 1 7 0"></path><path d="M12 20h.01"></path>',
  };

  let activeScenario = "ready";
  let activeTrialId = "fdb5a28c";
  let stateOverride = null;
  let messages = [];
  let streamTimer = null;
  let idleSeconds = 872;
  let idleTimer = null;

  function sprite() {
    const symbols = Object.entries(iconPaths).map(([name, content]) => (
      `<symbol id="serving-icon-${name}" viewBox="0 0 24 24">${content}</symbol>`
    )).join("");
    const wrap = document.createElement("div");
    wrap.innerHTML = `<svg aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden"><defs>${symbols}</defs></svg>`;
    document.body.prepend(wrap.firstElementChild);
  }

  function hydrateIcons(root = document) {
    root.querySelectorAll("[data-icon]").forEach((node) => {
      if (node.querySelector("svg")) return;
      const name = node.getAttribute("data-icon");
      if (!iconPaths[name]) return;
      node.innerHTML = `<svg aria-hidden="true"><use href="#serving-icon-${name}"></use></svg>`;
    });
  }

  function byId(id) {
    return trials.find((trial) => trial.id === id) || null;
  }

  function activeTrial() {
    return byId(activeTrialId);
  }

  function currentState(trial) {
    if (!trial) return null;
    return stateOverride || trial.state;
  }

  function currentMeta(trial) {
    const state = currentState(trial);
    return stateMeta[state] || stateMeta.ready;
  }

  function parseScenario() {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("scenario");
    return scenarios[requested] ? requested : "ready";
  }

  function setScenario(name, options = {}) {
    const scenario = scenarios[name] || scenarios.ready;
    activeScenario = name in scenarios ? name : "ready";
    activeTrialId = scenario.id;
    stateOverride = scenario.stateOverride || null;
    messages = [];
    stopStream();
    closeAllDialogs();
    resetWorkbench();
    document.body.dataset.scenario = activeScenario;
    document.querySelectorAll("[data-scenario-button]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.scenarioButton === activeScenario));
    });
    setView(scenario.view);
    renderTrials();
    renderCurrent();
    if (options.silent !== true) {
      const url = new URL(window.location.href);
      url.searchParams.set("scenario", activeScenario);
      history.replaceState(null, "", url);
    }
    if (scenario.dialog === "create") {
      window.setTimeout(() => openDialog("create"), 40);
    }
    if (activeScenario === "streaming") {
      window.setTimeout(() => startDemoStream(), 160);
    }
  }

  function setView(view) {
    document.querySelectorAll("[data-view]").forEach((section) => {
      section.hidden = section.dataset.view !== view;
    });
  }

  function resetWorkbench() {
    document.querySelectorAll("[data-chat-log]").forEach((log) => {
      log.innerHTML = "";
    });
    document.querySelectorAll("[data-empty-chat]").forEach((empty) => {
      empty.hidden = false;
    });
    document.body.classList.remove("is-streaming");
    document.querySelectorAll("[data-chat-input]").forEach((input) => {
      input.value = "";
      input.disabled = false;
    });
    document.querySelectorAll("[data-composer-submit]").forEach((button) => {
      button.disabled = false;
    });
    document.querySelectorAll("[data-stream-only]").forEach((node) => {
      node.hidden = true;
    });
    document.querySelectorAll("[id$='-create-error']").forEach((node) => {
      node.hidden = true;
      node.textContent = "";
    });
    document.querySelectorAll("[id$='-bind-error']").forEach((node) => {
      node.hidden = true;
      node.textContent = "";
    });
  }

  function renderTrials() {
    const empty = activeScenario === "empty" || activeScenario === "loading";
    document.querySelectorAll("[data-trial-list]").forEach((list) => {
      list.hidden = empty;
    });
    document.querySelectorAll("[data-empty-trial-list]").forEach((node) => {
      node.hidden = !empty;
    });
    document.querySelectorAll("[data-trial-id]").forEach((node) => {
      const trial = byId(node.dataset.trialId);
      if (!trial) return;
      node.hidden = empty;
      const button = node.matches("button") ? node : node.querySelector("button");
      const displayState = trial.id === activeTrialId ? currentState(trial) : trial.state;
      if (button) {
        button.setAttribute("aria-current", String(trial.id === activeTrialId));
        button.dataset.state = displayState;
      }
      node.querySelectorAll("[data-trial-state]").forEach((label) => {
        label.textContent = stateMeta[displayState]?.short || displayState;
        label.dataset.state = displayState;
      });
    });
    document.querySelectorAll("[data-current-badge]").forEach((badge) => {
      const trial = activeTrial();
      if (!trial) {
        badge.textContent = "无活动试用";
        badge.dataset.tone = "neutral";
        badge.dataset.pulse = "false";
        return;
      }
      const state = currentState(trial);
      const meta = currentMeta(trial);
      badge.textContent = meta.label;
      badge.dataset.tone = meta.tone;
      badge.dataset.pulse = String(!["ready", "stopped", "blocked"].includes(state));
    });
    document.querySelectorAll("[data-trial-count]").forEach((node) => {
      node.textContent = empty ? "0 / 200" : `${trials.length} / 200`;
    });
  }

  function setText(selector, value) {
    document.querySelectorAll(selector).forEach((node) => {
      node.textContent = value;
    });
  }

  function setCode(selector, value) {
    document.querySelectorAll(selector).forEach((node) => {
      node.textContent = value || "—";
    });
  }

  function renderCurrent() {
    const trial = activeTrial();
    const state = currentState(trial);
    const meta = currentMeta(trial);
    if (!trial) {
      setText("[data-current-id]", "无活动试用");
      setText("[data-current-short-id]", "—");
      setText("[data-current-adapter]", "—");
      setText("[data-current-instance]", "—");
      setText("[data-current-base]", "—");
      setCode("[data-current-base-fingerprint]", "—");
      setCode("[data-current-adapter-fingerprint]", "—");
      setText("[data-current-attempt]", "—");
      setText("[data-current-eval-loss]", "—");
      setText("[data-current-state]", "无活动试用");
      setText("[data-current-request]", "idle");
      document.querySelectorAll("[data-stage-track] li").forEach((item) => {
        item.dataset.stage = "";
      });
      return;
    }
    setText("[data-current-id]", trial.id);
    setText("[data-current-short-id]", trial.id.slice(0, 8));
    setText("[data-current-adapter]", `${trial.adapterRole} · ${trial.attempt} · ${trial.adapter}`);
    setText("[data-current-instance]", trial.instance);
    setText("[data-current-base]", trial.base);
    setCode("[data-current-base-fingerprint]", trial.baseFingerprint);
    setCode("[data-current-adapter-fingerprint]", trial.adapterFingerprint);
    setText("[data-current-attempt]", trial.attempt);
    setText("[data-current-eval-loss]", trial.evalLoss);
    setText("[data-current-state]", meta.label);
    setText("[data-current-request]", state === "preparing" ? "starting" : "idle");
    setText("[data-current-gpu]", trial.gpu);
    setText("[data-current-runtime]", trial.runtime);
    setText("[data-current-max-tokens]", trial.maxTokens);
    setText("[data-current-created]", trial.createdAt);
    setText("[data-current-error]", trial.error || "无");
    document.querySelectorAll("[data-current-badge]").forEach((badge) => {
      badge.textContent = meta.label;
      badge.dataset.tone = meta.tone;
    });
    document.querySelectorAll("[data-stage-track] li").forEach((item, index) => {
      const stage = Number(item.dataset.stageIndex ?? index);
      if (state === "blocked") {
        item.dataset.stage = stage <= 3 ? "done" : "";
      } else if (state === "stopped") {
        item.dataset.stage = "done";
      } else if (state === "stopping") {
        item.dataset.stage = stage < 4 ? "done" : stage === 4 ? "active" : "";
      } else if (state === "terminal") {
        item.dataset.stage = "";
      } else {
        item.dataset.stage = stage < meta.stage ? "done" : stage === meta.stage ? "active" : "";
      }
    });
    updateIdle();
  }

  function updateIdle() {
    const output = document.querySelectorAll("[data-idle-clock]");
    const state = currentState(activeTrial());
    output.forEach((node) => {
      if (state !== "ready") {
        node.textContent = "—";
      } else {
        const minutes = Math.floor(idleSeconds / 60);
        const seconds = idleSeconds % 60;
        node.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      }
    });
    document.querySelectorAll("[data-idle-label]").forEach((node) => {
      node.textContent = state === "ready" ? "空闲后自动回收" : state === "stopped" ? "实例已回收" : "就绪后开始计时";
    });
  }

  function startIdleTimer() {
    window.clearInterval(idleTimer);
    idleTimer = window.setInterval(() => {
      if (idleSeconds > 0) idleSeconds -= 1;
      updateIdle();
    }, 1000);
  }

  function messageTime() {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Shanghai",
    }).format(new Date());
  }

  function renderMessages() {
    const logs = document.querySelectorAll("[data-chat-log]");
    logs.forEach((log) => {
      log.innerHTML = messages.map((message, index) => {
        const role = message.role === "user" ? "user" : "assistant";
        const roleLabel = role === "user" ? "你" : "Adapter";
        const streaming = message.streaming ? ' data-streaming="true"' : "";
        const partialV1 = message.partial ? '<span class="v1-partial-tag">已停止 · 保留部分输出</span>' : "";
        const partialV2 = message.partial ? '<span class="v2-partial-tag">已停止生成，保留部分输出</span>' : "";
        const partialV3 = message.partial ? '<span class="v3-partial-tag">PARTIAL · 已停止生成</span>' : "";
        if (log.closest(".v2-session")) {
          return `<article class="v2-message ${role}" data-message-index="${index}"${streaming}>
            <div class="v2-message-head"><span>${roleLabel}</span><time>${message.time || messageTime()}</time></div>
            <p class="v2-message-body">${escapeHtml(message.content)}</p>${partialV2}
            ${role === "assistant" && !message.streaming ? '<div class="v2-message-tools"><button type="button" data-verdict="useful" aria-pressed="false">有用</button><button type="button" data-verdict="off-topic" aria-pressed="false">偏题</button><button type="button" data-verdict="unsafe" aria-pressed="false">不安全</button></div>' : ""}
          </article>`;
        }
        if (log.closest(".v3-console")) {
          return `<article class="v3-message ${role}" data-message-index="${index}"${streaming}>
            <div class="v3-message-meta"><span>${roleLabel}</span><time>${message.time || messageTime()}</time><span>${role === "assistant" ? "STREAM / READY" : "INPUT"}</span></div>
            <p class="v3-message-copy">${escapeHtml(message.content)}</p>${partialV3}
          </article>`;
        }
        return `<article class="v1-message ${role}" data-message-index="${index}"${streaming}>
          <div class="v1-message-role">${role === "user" ? "你" : "A"}</div>
          <div class="v1-message-body"><div class="v1-message-label"><span>${roleLabel}</span><time>${message.time || messageTime()}</time></div><p class="v1-message-copy">${escapeHtml(message.content)}</p>${partialV1}</div>
        </article>`;
      }).join("");
    });
    document.querySelectorAll("[data-empty-chat]").forEach((empty) => {
      empty.hidden = messages.length > 0;
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function addUserMessage(text) {
    messages.push({ role: "user", content: text, time: messageTime() });
    renderMessages();
    scrollChat();
  }

  function startDemoStream() {
    if (document.body.classList.contains("is-streaming")) return;
    addUserMessage(initialUser);
    streamAssistant(demoReply);
  }

  function streamAssistant(fullText) {
    stopStream();
    document.body.classList.add("is-streaming");
    document.querySelectorAll("[data-stream-only]").forEach((node) => {
      node.hidden = false;
    });
    document.querySelectorAll("[data-composer-submit]").forEach((button) => {
      button.disabled = true;
    });
    const assistant = { role: "assistant", content: "", time: messageTime(), streaming: true };
    messages.push(assistant);
    renderMessages();
    const segments = fullText.match(/[^。！？\n]+[。！？\n]?/g) || [fullText];
    let segmentIndex = 0;
    streamTimer = window.setInterval(() => {
      if (segmentIndex >= segments.length) {
        finishStream();
        return;
      }
      assistant.content += segments[segmentIndex];
      segmentIndex += 1;
      renderMessages();
      scrollChat();
    }, 120);
  }

  function finishStream() {
    stopStream(false);
    const assistant = [...messages].reverse().find((message) => message.role === "assistant");
    if (assistant) {
      assistant.streaming = false;
    }
    document.body.classList.remove("is-streaming");
    document.querySelectorAll("[data-stream-only]").forEach((node) => {
      node.hidden = true;
    });
    document.querySelectorAll("[data-composer-submit]").forEach((button) => {
      button.disabled = false;
    });
    renderMessages();
    showToast("生成完成；本页会话已保留输出");
  }

  function stopStream(render = true) {
    if (streamTimer) {
      window.clearInterval(streamTimer);
      streamTimer = null;
    }
    document.body.classList.remove("is-streaming");
    document.querySelectorAll("[data-stream-only]").forEach((node) => {
      node.hidden = true;
    });
    document.querySelectorAll("[data-composer-submit]").forEach((button) => {
      button.disabled = false;
    });
    if (render) {
      const assistant = [...messages].reverse().find((message) => message.role === "assistant" && message.streaming);
      if (assistant) {
        assistant.streaming = false;
        assistant.partial = true;
        renderMessages();
      }
    }
  }

  function cancelGeneration() {
    if (!streamTimer) return;
    stopStream(true);
    showToast("已请求停止生成，保留当前部分输出");
  }

  function scrollChat() {
    document.querySelectorAll("[data-chat-scroll]").forEach((node) => {
      node.scrollTop = node.scrollHeight;
    });
  }

  function submitComposer(button) {
    const scope = button.closest("[data-chat-scope]") || document;
    const input = scope.querySelector("[data-chat-input]");
    const text = input?.value.trim();
    if (!text) {
      input?.focus();
      showToast("请输入一个问题后再发送");
      return;
    }
    input.value = "";
    addUserMessage(text);
    streamAssistant(demoReply);
  }

  function showToast(message) {
    document.querySelectorAll(".toast-region").forEach((region) => {
      const toast = document.createElement("div");
      toast.className = "toast";
      toast.setAttribute("role", "status");
      toast.textContent = message;
      region.append(toast);
      window.setTimeout(() => toast.remove(), 2800);
    });
  }

  function openDialog(name) {
    const target = document.querySelector(`#${name}-dialog`);
    if (!target) return;
    if (typeof target.showModal === "function" && !target.open) {
      target.showModal();
    }
    hydrateIcons(target);
    window.setTimeout(() => {
      const focusable = target.querySelector("input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])");
      focusable?.focus();
    }, 30);
  }

  function closeDialog(target) {
    if (!target) return;
    if (typeof target.close === "function" && target.open) target.close();
  }

  function closeAllDialogs() {
    document.querySelectorAll("dialog[open]").forEach(closeDialog);
  }

  function submitCreate(form) {
    const selected = form.querySelector('input[name="adapter-choice"]:checked:not(:disabled)');
    const error = form.querySelector("[data-create-error]");
    if (!selected) {
      if (error) {
        error.hidden = false;
        error.textContent = "先选择一个已验证的 Best 或 Final Adapter。";
      }
      return;
    }
    if (error) error.hidden = true;
    const submit = form.querySelector("[data-submit-create]");
    if (submit) {
      submit.disabled = true;
      submit.textContent = "正在创建试用记录…";
    }
    window.setTimeout(() => {
      closeDialog(form.closest("dialog"));
      setScenario("waiting");
      showToast("试用记录已创建；下一步在优云创建实例");
      if (submit) {
        submit.disabled = false;
        submit.textContent = "确认并生成实例要求";
      }
    }, 850);
  }

  function submitBind(form) {
    const input = form.querySelector("[data-bind-input]");
    const ack = form.querySelector("[data-bind-ack]");
    const error = form.querySelector("[data-bind-error]");
    let message = "";
    if (!input.value.trim()) message = "填写优云控制台里的实例 ID。";
    else if (!/^[A-Za-z0-9_-]+$/.test(input.value.trim())) message = "实例 ID 只能包含字母、数字、下划线和连字符。";
    else if (!ack.checked) message = "确认授权平台在该实例完成或取消后停止、删除它。";
    if (message) {
      error.hidden = false;
      error.textContent = message;
      return;
    }
    error.hidden = true;
    const submit = form.querySelector("[data-submit-bind]");
    if (submit) {
      submit.disabled = true;
      submit.textContent = "正在核对实例…";
    }
    window.setTimeout(() => {
      closeDialog(form.closest("dialog"));
      const trial = byId("77c4e8a2");
      trial.instance = input.value.trim();
      setScenario("preparing");
      showToast("实例已关联；正在校验运行时并准备推理");
      window.setTimeout(() => {
        if (activeScenario === "preparing") setScenario("ready");
      }, 2200);
      if (submit) {
        submit.disabled = false;
        submit.textContent = "核对并关联实例";
      }
    }, 850);
  }

  function requestRetry(button) {
    button.disabled = true;
    setScenario("preparing");
    showToast("正在重新检查运行时和 Adapter 指纹");
    window.setTimeout(() => {
      if (activeScenario === "preparing") setScenario("ready");
      button.disabled = false;
    }, 1800);
  }

  function confirmStop(button) {
    closeAllDialogs();
    setScenario("stopping");
    button.disabled = true;
    showToast("停止请求已提交；等待推理进程退出");
    window.setTimeout(() => {
      if (activeScenario === "stopping") setScenario("stopped");
      button.disabled = false;
    }, 1900);
  }

  function copyFromButton(button) {
    const selector = button.dataset.copyTarget;
    const node = selector ? document.querySelector(selector) : null;
    const text = node?.textContent?.trim();
    if (!text) return;
    const finish = () => showToast("已复制到剪贴板");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(finish).catch(finish);
    } else {
      finish();
    }
  }

  function selectTrial(id) {
    const trial = byId(id);
    if (!trial) return;
    activeTrialId = id;
    activeScenario = ({
      ready: "ready",
      waiting_instance: "waiting",
      preparing: "preparing",
      blocked: "blocked",
      stopping: "stopping",
      stopped: "stopped",
      queued: "preparing",
    })[trial.state] || "ready";
    stateOverride = null;
    messages = [];
    stopStream();
    resetWorkbench();
    setView(trial.state === "ready" ? "workspace" : activeScenario === "preparing" ? "preparing" : activeScenario === "waiting" ? "waiting" : activeScenario === "blocked" ? "blocked" : activeScenario === "stopped" ? "stopped" : activeScenario === "stopping" ? "stopping" : "workspace");
    renderTrials();
    renderCurrent();
    document.querySelectorAll("[data-scenario-button]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.scenarioButton === activeScenario));
    });
    closeAllDialogs();
  }

  function setMobileTrialList() {
    document.querySelectorAll("[data-mobile-trials]").forEach((list) => {
      list.innerHTML = trials.map((trial) => {
        const meta = stateMeta[trial.state];
        return `<li class="v1-trial" data-mobile-trial="${trial.id}"><button type="button" data-select-trial="${trial.id}" aria-current="${trial.id === activeTrialId}">
          <span class="v1-trial-id">${trial.id.slice(0, 8)}</span><span class="mini-state" data-state="${trial.state}">${meta.short}</span>
          <span class="v1-trial-adapter">${trial.adapterRole} · ${trial.attempt} · ${trial.adapter}</span>
        </button></li>`;
      }).join("");
    });
  }

  function init() {
    sprite();
    hydrateIcons();
    startIdleTimer();
    const initial = parseScenario();
    setScenario(initial, { silent: true });
    setMobileTrialList();

    document.addEventListener("click", (event) => {
      const sandboxLink = event.target.closest("a[data-sandbox-action]");
      if (sandboxLink) {
        event.preventDefault();
        showToast(sandboxLink.dataset.sandboxAction);
        return;
      }
      const button = event.target.closest("button");
      if (!button) return;
      if (button.matches("[data-state-toggle]")) {
        const panel = document.querySelector("[data-state-panel]");
        panel.hidden = !panel.hidden;
        button.setAttribute("aria-expanded", String(!panel.hidden));
        return;
      }
      if (button.matches("[data-scenario-button]")) {
        setScenario(button.dataset.scenarioButton);
        return;
      }
      if (button.matches("[data-open-create], [data-create-again]")) {
        closeAllDialogs();
        openDialog("create");
        return;
      }
      if (button.matches("[dataOpenDialog]")) {
        openDialog(button.dataset.openDialog);
        return;
      }
      if (button.matches("[data-close-dialog]")) {
        closeDialog(button.closest("dialog"));
        return;
      }
      if (button.matches("[data-submit-create]")) {
        submitCreate(button.closest("form"));
        return;
      }
      if (button.matches("[data-open-bind]")) {
        openDialog("bind");
        return;
      }
      if (button.matches("[data-submit-bind]")) {
        submitBind(button.closest("form"));
        return;
      }
      if (button.matches("[data-request-stop]")) {
        openDialog("stop");
        return;
      }
      if (button.matches("[data-confirm-stop]")) {
        confirmStop(button);
        return;
      }
      if (button.matches("[data-retry-trial]")) {
        requestRetry(button);
        return;
      }
      if (button.matches("[data-prompt]")) {
        const scope = button.closest("[data-chat-scope]") || document;
        const input = scope.querySelector("[data-chat-input]");
        if (input) input.value = button.dataset.prompt;
        input?.focus();
        return;
      }
      if (button.matches("[data-composer-submit]")) {
        submitComposer(button);
        return;
      }
      if (button.matches("[data-cancel-generation]")) {
        cancelGeneration();
        return;
      }
      if (button.matches("[data-clear-session]")) {
        messages = [];
        resetWorkbench();
        renderMessages();
        showToast("页面会话已清空");
        return;
      }
      if (button.matches("[data-copy]")) {
        copyFromButton(button);
        return;
      }
      if (button.matches("[data-verdict]")) {
        const group = button.parentElement.querySelectorAll("[data-verdict]");
        group.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
        showToast("验收标记已记录在本页原型中");
        return;
      }
      if (button.matches("[data-select-trial]")) {
        selectTrial(button.dataset.selectTrial);
        setMobileTrialList();
        closeAllDialogs();
        return;
      }
      if (button.matches("[data-open-queue]")) {
        setMobileTrialList();
        openDialog("mobile-queue");
        return;
      }
      if (button.matches("[data-open-context]")) {
        openDialog("mobile-context");
        return;
      }
      if (button.matches("[data-sandbox-action]")) {
        showToast(button.dataset.sandboxAction);
      }
    });

    document.addEventListener("keydown", (event) => {
      const textarea = event.target.closest("[data-chat-input]");
      if (!textarea) return;
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        const scope = textarea.closest("[data-chat-scope]") || document;
        const submit = scope.querySelector("[data-composer-submit]");
        if (submit) submitComposer(submit);
      }
    });

    document.querySelectorAll("dialog").forEach((dialog) => {
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) closeDialog(dialog);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
