// 统一 AI 问答入口：共享提问体验，业务模块与数据主权保持独立。
// 当前版本只做透明的业务域分流预览，不伪造模型答案或外部系统数据。
window.Views = window.Views || {};

window.Views.assistant = (function () {
  const title = "统一 AI 问答";
  const state = {
    el: null,
    scope: "auto",
    question: "",
    messages: [],
    integrations: [],
    apps: []
  };

  const domains = {
    projects: {
      label: "项目管理",
      description: "项目进度、任务提醒、DCP 遗留事项、周报/月报与结项报告",
      keywords: ["项目进度", "项目管理", "项目群", "任务", "逾期", "周报", "月报", "结项", "dcp", "规划及时率", "销售达标", "交付件", "进度预警"],
      route: "projects",
      icon: "projects",
      owner: "PMO"
    },
    quality: {
      label: "质量决策助手",
      description: "机型信息聚合、过程质量问题、整改情况、测试验证与检测报告",
      keywords: ["质量", "机型", "检验", "整改", "测试", "验证", "供应商", "售后", "质量问题", "失效", "检测报告", "雷区库", "核心质量", "制程", "客诉"],
      route: "quality-assistant",
      icon: "problems",
      owner: "质量团队"
    },
    standardization: {
      label: "标准化与优选件",
      description: "物料主数据、相似件查重、BOM 合规、优选件与替代建议",
      keywords: ["物料", "bom", "优选件", "优选库", "相似件", "编码申请", "替代件", "标准化", "零部件", "选型", "物料等级"],
      route: "standardization",
      icon: "standardization",
      owner: "标准化团队"
    },
    problems: {
      label: "问题经验",
      description: "历史问题检索、问题清单导入、字段识别与问题记录",
      keywords: ["问题经验", "问题库", "excel", "导入", "历史问题", "问题记录", "故障案例", "问题清单", "失效案例"],
      route: "problems",
      icon: "problems",
      owner: "质量团队"
    }
  };

  const examples = [
    { text: "这个机型最近有哪些质量问题？", scope: "quality", tag: "质量查询" },
    { text: "帮我看项目进度、逾期任务和下一个 DCP。", scope: "projects", tag: "项目管理" },
    { text: "这颗物料有没有相似件？优选件有哪些？", scope: "standardization", tag: "物料选型" },
    { text: "把这份 Excel 问题清单导入问题经验库。", scope: "problems", tag: "问题经验" },
    { text: "汇总某机型的项目进度、质量问题和整改情况。", scope: "auto", tag: "跨域汇总" }
  ];

  function esc(value) { return UI.esc(value === null || value === undefined ? "" : String(value)); }

  function findApp(route) {
    return state.apps.find(function (app) { return app.route_path === route || app.id === route; }) || null;
  }

  function integration(id) {
    return state.integrations.find(function (item) { return item.id === id; }) || null;
  }

  function modelReady() {
    const item = integration("model_gateway");
    return !!(item && item.adapter_implemented);
  }

  function moduleStatus(domainKey) {
    const spec = domains[domainKey];
    if (!spec) return { label: "需要确认", tone: "neutral", detail: "先确认主要业务域。" };
    const app = findApp(spec.route);
    if (domainKey === "quality") {
      return {
        label: "待接入",
        tone: "warning",
        detail: "质量决策助手仍处于规划阶段，QMS / PLM / 飞书与模型适配器尚未完成。"
      };
    }
    if (app && app.entry_url) {
      return { label: "独立系统入口已配置", tone: "good", detail: "可从统一入口跳转到独立业务系统。" };
    }
    if (["projects", "problems", "standardization"].includes(spec.route)) {
      return { label: "门户本地试点", tone: "pilot", detail: "可进入当前门户试点；不代表已同步企业源系统。" };
    }
    return { label: "入口待配置", tone: "neutral", detail: "当前尚无可用的业务系统入口。" };
  }

  function resolveRoute(question) {
    if (state.scope !== "auto") {
      return { kind: "route", domain: state.scope, method: "用户指定业务域", score: 1 };
    }

    const text = String(question || "").toLowerCase();
    if (/(综合|汇总|全维度|一键|整体情况|跨系统|跨域|一起看|同时看)/.test(text)) {
      return { kind: "route", domain: "quality", method: "识别到综合 / 跨域查询诉求", score: 1 };
    }

    const scored = Object.keys(domains).map(function (key) {
      const spec = domains[key];
      const matched = spec.keywords.filter(function (word) { return text.indexOf(word.toLowerCase()) >= 0; });
      return { domain: key, score: matched.reduce(function (sum, word) { return sum + (word.length >= 4 ? 2 : 1); }, 0), matched: matched };
    }).filter(function (item) { return item.score > 0; }).sort(function (a, b) { return b.score - a.score; });

    if (!scored.length) return { kind: "clarify", options: Object.keys(domains), method: "未找到明确的业务关键词" };
    if (scored.length > 1 && scored[0].score === scored[1].score) {
      return { kind: "clarify", options: scored.filter(function (item) { return item.score === scored[0].score; }).map(function (item) { return item.domain; }), method: "问题可能涉及多个业务域" };
    }
    return {
      kind: "route",
      domain: scored[0].domain,
      method: "基于当前规则词进行入口分流",
      matched: scored[0].matched,
      score: scored[0].score
    };
  }

  function openDomain(domainKey) {
    const spec = domains[domainKey];
    if (!spec) return;
    const app = findApp(spec.route);
    if (domainKey === "quality") {
      Router.go("app_center");
      UI.toast("质量决策助手仍待真实数据源与模型网关接入，已打开应用中心查看状态。", "warn");
      return;
    }
    if (app && app.entry_url) {
      window.open(app.entry_url, "_blank", "noopener");
      return;
    }
    Router.go(spec.route);
  }

  function domainCard(key, compact) {
    const spec = domains[key];
    const status = moduleStatus(key);
    return '<article class="assistant-domain-card ' + (compact ? "is-compact" : "") + '">' +
      '<div class="assistant-domain-icon">' + UI.icon(spec.icon) + '</div>' +
      '<div class="assistant-domain-copy"><div class="assistant-domain-title">' + esc(spec.label) + '<span class="assistant-state ' + status.tone + '">' + esc(status.label) + '</span></div>' +
        '<p>' + esc(spec.description) + '</p><small>' + esc(status.detail) + '</small></div>' +
      '<button type="button" class="assistant-domain-open" data-open-domain="' + key + '" aria-label="进入' + esc(spec.label) + '">' + UI.icon("arrow-up-right") + '</button></article>';
  }

  function renderMessage(message, index) {
    if (message.role === "user") {
      return '<div class="assistant-message user"><div class="assistant-message-avatar">我</div><div class="assistant-message-content"><div class="assistant-message-label">你的问题</div><p>' + esc(message.text) + '</p></div></div>';
    }
    if (message.result.kind === "clarify") {
      return '<div class="assistant-message response"><div class="assistant-message-avatar assistant-avatar"><span>AI</span></div><div class="assistant-message-content"><div class="assistant-message-label">需要确认业务范围 <span>入口分流预览</span></div>' +
        '<div class="assistant-result-card"><h4>这句话可能涉及多个模块</h4><p>为了避免把问题送到错误的业务系统，请选择你想先处理的方向。这里仅进行入口识别，不会伪造业务数据答案。</p>' +
        '<div class="assistant-route-options">' + message.result.options.map(function (key) { return '<button type="button" class="assistant-route-option" data-pick-domain="' + key + '" data-question-index="' + index + '"><span>' + esc(domains[key].label) + '</span><small>' + esc(domains[key].description) + '</small>' + UI.icon("arrow-right") + '</button>'; }).join("") + '</div></div></div></div>';
    }
    const key = message.result.domain;
    const spec = domains[key];
    const status = moduleStatus(key);
    const externalNote = key === "quality"
      ? '<div class="assistant-readiness-note warning"><strong>为什么暂时不直接回答？</strong><p>需求文档中的目标需要接入 QMS 质量数据、PLM 项目 / DCP / 检测报告、飞书文档与企业模型网关。当前仓库将这些适配器标记为未实现，因此不能可靠返回实时事实。</p></div>'
      : '<div class="assistant-readiness-note"><strong>当前可做什么</strong><p>' + esc(status.detail) + ' 当前入口仅负责分流；若需要事实型问答，后续仍需连接对应系统的数据适配器、权限校验与可追溯证据。</p></div>';
    return '<div class="assistant-message response"><div class="assistant-message-avatar assistant-avatar"><span>AI</span></div><div class="assistant-message-content"><div class="assistant-message-label">提问分流结果 <span>非 AI 答案</span></div>' +
      '<div class="assistant-result-card"><div class="assistant-result-top"><span class="assistant-result-kicker">RECOMMENDED WORKSPACE</span><span class="assistant-state ' + status.tone + '">' + esc(status.label) + '</span></div>' +
      '<div class="assistant-recommended"><div class="assistant-recommended-icon">' + UI.icon(spec.icon) + '</div><div><h4>' + esc(spec.label) + '</h4><p>' + esc(spec.description) + '</p></div></div>' +
      '<div class="assistant-intent-row"><span>分流依据</span><strong>' + esc(message.result.method) + '</strong></div>' +
      (message.result.matched && message.result.matched.length ? '<div class="assistant-keywords"><span>识别到的词</span>' + message.result.matched.map(function (word) { return '<code>' + esc(word) + '</code>'; }).join("") + '</div>' : '') +
      externalNote +
      '<div class="assistant-result-actions"><button type="button" class="btn btn-primary" data-open-domain="' + key + '">' + (key === "quality" ? "查看接入状态" : (findApp(spec.route) && findApp(spec.route).entry_url ? "打开独立系统" : "进入业务工作区")) + ' ' + UI.icon("arrow-up-right") + '</button><button type="button" class="btn" data-use-scope="' + key + '">后续问题继续问这个模块</button></div></div></div></div>';
  }

  function renderMessages() {
    const host = state.el.querySelector("#assistantConversation");
    if (!host) return;
    if (!state.messages.length) {
      host.innerHTML = '<div class="assistant-welcome"><div class="assistant-welcome-mark">' + UI.icon("sparkles") + '</div><span class="assistant-welcome-kicker">ONE ENTRY · INDEPENDENT SYSTEMS</span><h3>你想了解什么？</h3><p>直接用日常语言提问。统一入口先帮助你明确业务方向，再进入相应系统；真实问答能力将随数据接口和模型网关接入启用。</p>' +
        '<div class="assistant-example-grid">' + examples.map(function (item, index) { return '<button type="button" class="assistant-example" data-example="' + index + '"><span>' + esc(item.tag) + '</span><strong>' + esc(item.text) + '</strong>' + UI.icon("arrow-up-right") + '</button>'; }).join("") + '</div></div>';
    } else {
      host.innerHTML = '<div class="assistant-thread">' + state.messages.map(renderMessage).join("") + '</div>';
      host.scrollTop = host.scrollHeight;
      host.querySelectorAll("[data-pick-domain]").forEach(function (button) {
        button.addEventListener("click", function () {
          const index = Number(button.dataset.questionIndex);
          const key = button.dataset.pickDomain;
          if (state.messages[index] && state.messages[index].result) {
            state.messages[index].result = { kind: "route", domain: key, method: "你确认了业务域", score: 1 };
            state.messages[index].result.matched = [];
            // Preserve the original question and append the confirmed routing card.
            state.messages.push({ role: "assistant", result: { kind: "route", domain: key, method: "你确认了业务域", score: 1 } });
          }
          renderMessages();
        });
      });
      host.querySelectorAll("[data-open-domain]").forEach(function (button) {
        button.addEventListener("click", function () { openDomain(button.dataset.openDomain); });
      });
      host.querySelectorAll("[data-use-scope]").forEach(function (button) {
        button.addEventListener("click", function () {
          state.scope = button.dataset.useScope;
          const select = state.el.querySelector("#assistantScope");
          if (select) select.value = state.scope;
          UI.toast("后续问题将优先分流到“" + domains[state.scope].label + "”。", "success");
        });
      });
    }
    host.querySelectorAll("[data-example]").forEach(function (button) {
      button.addEventListener("click", function () {
        const item = examples[Number(button.dataset.example)];
        if (!item) return;
        state.scope = item.scope;
        const select = state.el.querySelector("#assistantScope");
        const input = state.el.querySelector("#assistantInput");
        if (select) select.value = state.scope;
        if (input) { input.value = item.text; input.focus(); }
        state.question = item.text;
      });
    });
  }

  function submitQuestion() {
    const input = state.el.querySelector("#assistantInput");
    const question = (input ? input.value : state.question).trim();
    if (!question) {
      UI.toast("先输入你想了解的问题。", "warn");
      if (input) input.focus();
      return;
    }
    state.question = question;
    state.messages.push({ role: "user", text: question });
    state.messages.push({ role: "assistant", result: resolveRoute(question) });
    if (input) input.value = "";
    state.question = "";
    renderMessages();
  }

  function renderPage() {
    const el = state.el;
    const model = integration("model_gateway");
    const modelText = model && model.adapter_implemented ? "问答适配器已实现" : "真实问答服务待接入";
    el.innerHTML = '<section class="assistant-shell">' +
      '<header class="assistant-hero"><div class="assistant-hero-copy"><span class="assistant-kicker">UNIFIED AI WORKSPACE / ROUTING LAYER</span><h2>问题从一个地方问，<br><b>业务在各自系统里办。</b></h2>' +
        '<p>共享提问入口、对话体验与身份规则；问题经验、项目管理、标准化与质量数据继续由各自业务系统维护，不把所有系统合并成一个数据库。</p>' +
        '<div class="assistant-hero-tags"><span><i></i>统一入口</span><span>独立业务系统</span><span>回答需有来源依据</span></div></div>' +
        '<aside class="assistant-hero-status"><span class="assistant-status-icon">' + UI.icon("sparkles") + '</span><small>RUNTIME STATUS</small><strong>' + esc(modelText) + '</strong><p>当前为入口分流预览，不会生成未经验证的业务结论。</p></aside></header>' +
      '<div class="assistant-layout"><section class="assistant-chat-panel"><header class="assistant-chat-head"><div class="assistant-chat-avatar">' + UI.icon("sparkles") + '</div><div><h3>研发 AI 助手</h3><p>提问入口 · 本次页面会话</p></div><span class="assistant-mode-pill">分流预览</span></header>' +
        '<div class="assistant-conversation" id="assistantConversation" aria-live="polite"></div>' +
        '<form class="assistant-composer" id="assistantForm"><div class="assistant-composer-meta"><label for="assistantScope">问题范围</label><select class="input" id="assistantScope"><option value="auto">自动判断业务域</option><option value="quality">质量决策助手</option><option value="projects">项目管理</option><option value="standardization">标准化与优选件</option><option value="problems">问题经验</option></select><span>Enter 发送 · Shift + Enter 换行</span></div>' +
          '<textarea id="assistantInput" rows="3" maxlength="2000" placeholder="例如：帮我汇总某机型本月质量问题、整改状态和项目 DCP 遗留事项…"></textarea>' +
          '<div class="assistant-composer-foot"><span>不要输入密码、令牌或未经授权的敏感信息。</span><button type="submit" class="btn btn-primary" id="assistantSend">' + UI.icon("arrow-up-right") + ' 识别问题方向</button></div></form>' +
        '<div class="assistant-privacy-note"><span>' + UI.icon("shield-check") + '</span><p>当前消息只保留在此页面会话内，不写入业务数据库。真实问答启用前，需要接入账号权限校验、数据源引用与审计策略。</p></div>' +
      '</section><aside class="assistant-side"><section class="assistant-side-panel"><header><span class="assistant-side-kicker">BUSINESS WORKSPACES</span><h3>独立业务入口</h3><p>一个入口发起问题，各模块保留自己的业务流程与数据主权。</p></header>' +
        '<div class="assistant-domain-list">' + domainCard("quality", false) + domainCard("projects", false) + domainCard("standardization", false) + domainCard("problems", false) + '</div></section>' +
        '<section class="assistant-side-panel assistant-architecture"><span class="assistant-side-kicker">INTEGRATION READINESS</span><h3>问答能力接入状态</h3><div class="assistant-readiness-list">' + readinessRows() + '</div><a href="#/app_center" class="assistant-status-link">查看应用注册中心 ' + UI.icon("arrow-up-right") + '</a></section></aside></div></section>';
    const form = el.querySelector("#assistantForm");
    form.addEventListener("submit", function (event) { event.preventDefault(); submitQuestion(); });
    el.querySelector("#assistantInput").addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submitQuestion();
      }
    });
    el.querySelector("#assistantScope").addEventListener("change", function () { state.scope = this.value; });
    el.querySelectorAll("[data-open-domain]").forEach(function (button) {
      button.addEventListener("click", function () { openDomain(button.dataset.openDomain); });
    });
    renderMessages();
  }

  function readinessRows() {
    const checks = [
      { id: "model_gateway", label: "企业模型网关", note: "意图识别、工具调用与答案生成" },
      { id: "qms", label: "QMS 质量数据", note: "研发 / 供应商 / 制程 / 售后质量" },
      { id: "plm", label: "PLM 项目与物料", note: "进度、DCP、检测报告、BOM / 物料" },
      { id: "pm_platform", label: "独立项目管理系统", note: "任务、节点、交付与项目群数据" },
      { id: "problem_hub", label: "独立问题经验系统", note: "问题库检索和历史案例" }
    ];
    return checks.map(function (item) {
      const current = integration(item.id);
      const configured = current && current.endpoint_configured;
      const implemented = current && current.adapter_implemented;
      const label = implemented ? "已实现" : configured ? "已填配置，待实现适配器" : "待接入";
      const tone = implemented ? "good" : configured ? "warning" : "neutral";
      return '<div class="assistant-readiness-row"><span class="assistant-readiness-dot ' + tone + '"></span><div><strong>' + esc(item.label) + '</strong><small>' + esc(item.note) + '</small></div><span class="assistant-state ' + tone + '">' + esc(label) + '</span></div>';
    }).join("");
  }

  async function render(el) {
    state.el = el;
    state.messages = [];
    state.scope = "auto";
    state.integrations = [];
    state.apps = window.PLATFORM_APPS || [];
    el.innerHTML = '<div class="assistant-loading"><span></span><div><strong>正在读取问答入口接入状态</strong><small>检查模型网关与业务系统适配器配置…</small></div></div>';
    try {
      const results = await Promise.all([
        api.get("/api/system/integrations"),
        api.get("/api/apps")
      ]);
      state.integrations = ((results[0] || {}).integrations || []);
      state.apps = ((results[1] || {}).items || state.apps || []);
    } catch (error) {
      // 页面仍可浏览；不把接口错误包装成“已接入”。
      state.integrations = [];
    }
    renderPage();
  }

  return { title: title, render: render };
})();
