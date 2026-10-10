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
    if (domainKey === "quality" && app && app.status === "active" && app.entry_url) {
      return { label: "独立系统入口已配置", tone: "good", detail: "可从统一入口跳转到独立质量决策系统。" };
    }
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
    if (domainKey === "quality" && app && app.status === "active" && app.entry_url) {
      window.open(app.entry_url, "_blank", "noopener");
      return;
    }
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
    const result = message.result || {};
    if (result.kind === "loading") {
      return '<div class="assistant-message response"><div class="assistant-message-avatar assistant-avatar"><span>AI</span></div><div class="assistant-message-content"><div class="assistant-message-label">正在查询本地业务数据 <span>只读查询</span></div><div class="assistant-thinking"><span></span><div><strong>正在检索相关业务记录</strong><small>查询项目、问题经验或物料试点数据，并整理来源依据。</small></div></div></div></div>';
    }
    if (result.kind === "error") {
      return '<div class="assistant-message response"><div class="assistant-message-avatar assistant-avatar"><span>AI</span></div><div class="assistant-message-content"><div class="assistant-message-label">查询未完成 <span>服务异常</span></div><div class="assistant-result-card"><div class="assistant-readiness-note warning"><strong>' + esc(result.message || "暂时无法完成查询") + '</strong><p>请检查连接后重试，系统没有用生成内容替代实际数据。</p></div><div class="assistant-result-actions"><button type="button" class="btn" data-retry-question="' + index + '">重试查询</button></div></div></div></div>';
    }
    if (result.kind === "clarify") {
      return '<div class="assistant-message response"><div class="assistant-message-avatar assistant-avatar"><span>AI</span></div><div class="assistant-message-content"><div class="assistant-message-label">需要确认业务范围 <span>入口分流</span></div>' +
        '<div class="assistant-result-card"><div class="assistant-result-top"><span class="assistant-result-kicker">CLARIFY INTENT</span><span class="assistant-state warning">需要补充条件</span></div><div class="assistant-recommended"><div class="assistant-recommended-icon">' + UI.icon("message-square") + '</div><div><h4>你想查询哪一类业务？</h4><p>' + esc(result.message || "请选择一个业务域，继续查询。") + '</p></div></div>' +
        '<div class="assistant-route-options">' + (result.options || []).map(function (item) {
          const key = typeof item === "string" ? item : item.key;
          const label = typeof item === "string" ? (domains[item] ? domains[item].label : item) : item.label;
          const description = typeof item === "string" ? (domains[item] ? domains[item].description : "") : item.description;
          return '<button type="button" class="assistant-route-option" data-pick-domain="' + esc(key) + '" data-question-index="' + index + '"><span>' + esc(label) + '</span><small>' + esc(description) + '</small>' + UI.icon("arrow-right") + '</button>';
        }).join("") + '</div></div></div></div>';
    }

    const domainKey = result.domain || "quality";
    const spec = domains[domainKey] || { label: result.domain_label || "业务查询", description: "" };
    const statusTone = result.status === "no_data" ? "warning" : "good";
    const metricHtml = (result.metrics || []).map(function (metric) {
      return '<div class="assistant-answer-metric"><span>' + esc(metric.label) + '</span><strong>' + esc(metric.value) + '</strong><small>' + esc(metric.detail || "") + '</small></div>';
    }).join("");
    const groupsHtml = (result.groups || []).map(function (group) {
      const itemsHtml = (group.items || []).map(function (item) {
        const fields = (item.fields || []).map(function (field) {
          return '<span class="assistant-record-field"><small>' + esc(field.label) + '</small><strong>' + esc(field.value) + '</strong></span>';
        }).join("");
        return '<article class="assistant-record"><div class="assistant-record-main"><div><h5>' + esc(item.title) + '</h5><p>' + esc(item.subtitle || "") + '</p></div>' +
          '<span class="assistant-record-status ' + (String(item.status || "").includes("逾期") || String(item.status || "").includes("阻塞") ? "warning" : "") + '">' + esc(item.status || "记录") + '</span></div>' +
          (fields ? '<div class="assistant-record-fields">' + fields + '</div>' : '') +
          (item.detail ? '<p class="assistant-record-detail">' + esc(item.detail) + '</p>' : '') +
          '<footer><span>' + esc(item.source_name || group.source || "本地试点数据") + '</span><code>' + esc(item.source_id || "") + '</code></footer></article>';
      }).join("");
      return '<section class="assistant-answer-group"><header><div><h4>' + esc(group.title) + '</h4><p>' + esc(group.source || "本地试点数据") + '</p></div><span>' + esc(group.count || 0) + ' 条</span></header>' +
        (itemsHtml || '<div class="assistant-no-records">当前条件下没有匹配记录。</div>') + '</section>';
    }).join("");
    const caveatsHtml = (result.caveats || []).map(function (item) { return '<li>' + esc(item) + '</li>'; }).join("");
    const evidenceHtml = (result.evidence || []).length
      ? '<details class="assistant-evidence"><summary>查看数据来源与记录标识（' + esc(result.evidence_count || result.evidence.length) + ' 条）</summary><div>' +
        result.evidence.slice(0, 12).map(function (item) { return '<p><strong>' + esc(item.source_system) + '</strong><code>' + esc(item.record_id) + '</code><small>' + esc(item.updated_at) + '</small></p>'; }).join("") +
        ((result.evidence.length > 12) ? '<small>仅展示前 12 条引用，完整明细见上方结果卡片。</small>' : '') + '</div></details>'
      : "";
    return '<div class="assistant-message response"><div class="assistant-message-avatar assistant-avatar"><span>AI</span></div><div class="assistant-message-content"><div class="assistant-message-label">本地数据查询结果 <span>' + (result.query_mode === "read_only_local_pilot" ? "只读试点查询" : "查询结果") + '</span></div>' +
      '<div class="assistant-result-card assistant-live-result"><div class="assistant-result-top"><span class="assistant-result-kicker">QUERY RESULT / ' + esc(result.intent || "READ_ONLY") + '</span><span class="assistant-state ' + statusTone + '">' + (result.status === "no_data" ? "没有匹配记录" : "查询完成") + '</span></div>' +
      '<div class="assistant-answer-intro"><div class="assistant-recommended-icon">' + UI.icon(spec.icon || "sparkles") + '</div><div><h4>' + esc(result.intent_label || spec.label) + '</h4><p>' + esc(result.answer || "") + '</p></div></div>' +
      '<div class="assistant-answer-source-line"><span>查询范围</span><strong>' + esc(spec.label) + '</strong><span>业务条件</span><strong>' + esc((result.filters && result.filters.product_model) || "未限定机型") + ' · ' + esc((result.filters && result.filters.time_range) || "未限定时间") + '</strong></div>' +
      (metricHtml ? '<div class="assistant-answer-metrics">' + metricHtml + '</div>' : '') +
      '<div class="assistant-answer-groups">' + groupsHtml + '</div>' +
      (caveatsHtml ? '<div class="assistant-caveats"><strong>' + UI.icon("shield-check") + ' 使用说明与数据边界</strong><ul>' + caveatsHtml + '</ul></div>' : '') +
      evidenceHtml +
      '<div class="assistant-result-actions"><button type="button" class="btn btn-primary" data-open-domain="' + esc(domainKey) + '">' + (domainKey === "quality" ? "继续查看质量工作区" : "进入对应业务工作区") + ' ' + UI.icon("arrow-up-right") + '</button><button type="button" class="btn" data-use-scope="' + esc(domainKey) + '">后续问题继续问这个模块</button></div>' +
      ((result.suggested_questions || []).length ? '<div class="assistant-suggestions"><span>你还可以继续问</span>' + result.suggested_questions.slice(0, 3).map(function (question) { return '<button type="button" data-suggest-question="' + esc(question) + '" data-suggest-domain="' + esc(domainKey) + '">' + esc(question) + '</button>'; }).join("") + '</div>' : '') +
      '</div></div></div>';
  }

  function renderMessages() {
    const host = state.el.querySelector("#assistantConversation");
    if (!host) return;
    if (!state.messages.length) {
      host.innerHTML = '<div class="assistant-welcome"><div class="assistant-welcome-mark">' + UI.icon("sparkles") + '</div><span class="assistant-welcome-kicker">ONE ENTRY · INDEPENDENT SYSTEMS</span><h3>你想了解什么？</h3><p>提问后会优先查询门户当前可用的本地试点数据。真实 QMS、PLM、飞书与独立系统数据将在连接器接通后逐步纳入。</p>' +
        '<div class="assistant-example-grid">' + examples.map(function (item, index) { return '<button type="button" class="assistant-example" data-example="' + index + '"><span>' + esc(item.tag) + '</span><strong>' + esc(item.text) + '</strong>' + UI.icon("arrow-up-right") + '</button>'; }).join("") + '</div></div>';
    } else {
      host.innerHTML = '<div class="assistant-thread">' + state.messages.map(renderMessage).join("") + '</div>';
      host.scrollTop = host.scrollHeight;
      host.querySelectorAll("[data-pick-domain]").forEach(function (button) {
        button.addEventListener("click", async function () {
          const index = Number(button.dataset.questionIndex);
          const question = state.messages[index - 1] && state.messages[index - 1].role === "user" ? state.messages[index - 1].text : "";
          const key = button.dataset.pickDomain;
          if (!question) return;
          state.scope = key;
          const select = state.el.querySelector("#assistantScope");
          if (select) select.value = key;
          state.messages[index].result = { kind: "loading" };
          renderMessages();
          await runQuery(question, key, index);
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
          UI.toast("后续问题将优先查询“" + domains[state.scope].label + "”的数据。", "success");
        });
      });
      host.querySelectorAll("[data-suggest-question]").forEach(function (button) {
        button.addEventListener("click", function () {
          state.scope = button.dataset.suggestDomain || "auto";
          const select = state.el.querySelector("#assistantScope");
          const input = state.el.querySelector("#assistantInput");
          if (select) select.value = state.scope;
          if (input) { input.value = button.dataset.suggestQuestion; input.focus(); }
        });
      });
      host.querySelectorAll("[data-retry-question]").forEach(function (button) {
        button.addEventListener("click", async function () {
          const index = Number(button.dataset.retryQuestion);
          const userMessage = state.messages[index - 1];
          if (userMessage && userMessage.role === "user") {
            state.messages[index].result = { kind: "loading" };
            renderMessages();
            await runQuery(userMessage.text, state.scope, index);
          }
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

  async function runQuery(question, domain, replaceIndex) {
    const input = state.el.querySelector("#assistantInput");
    try {
      const response = await api.post("/api/assistant/query", {
        question: question,
        domain: domain || "auto",
        context: state.context || {}
      });
      if (replaceIndex !== undefined && state.messages[replaceIndex]) {
        state.messages[replaceIndex].result = response;
      } else {
        state.messages.push({ role: "assistant", result: response });
      }
      if (response.context) state.context = response.context;
    } catch (error) {
      const result = { kind: "error", status: "source_unavailable", message: error.message || "统一问答服务暂时不可用" };
      if (replaceIndex !== undefined && state.messages[replaceIndex]) state.messages[replaceIndex].result = result;
      else state.messages.push({ role: "assistant", result: result });
    }
    if (input) input.value = "";
    state.question = "";
    renderMessages();
  }

  async function submitQuestion() {
    const input = state.el.querySelector("#assistantInput");
    const question = (input ? input.value : state.question).trim();
    if (!question) {
      UI.toast("先输入你想查询的问题。", "warn");
      if (input) input.focus();
      return;
    }
    state.question = question;
    state.messages.push({ role: "user", text: question });
    state.messages.push({ role: "assistant", result: { kind: "loading" } });
    const responseIndex = state.messages.length - 1;
    renderMessages();
    await runQuery(question, state.scope, responseIndex);
  }

  function renderPage() {
    const el = state.el;
    const model = integration("model_gateway");
    const modelText = model && model.adapter_implemented ? "问答适配器已实现" : "真实问答服务待接入";
    el.innerHTML = '<section class="assistant-shell">' +
      '<header class="assistant-hero"><div class="assistant-hero-copy"><span class="assistant-kicker">UNIFIED AI WORKSPACE / ROUTING LAYER</span><h2>问题从一个地方问，<br><b>业务在各自系统里办。</b></h2>' +
        '<p>共享提问入口、对话体验与身份规则；问题经验、项目管理、标准化与质量数据继续由各自业务系统维护，不把所有系统合并成一个数据库。</p>' +
        '<div class="assistant-hero-tags"><span><i></i>统一入口</span><span>独立业务系统</span><span>回答需有来源依据</span></div></div>' +
        '<aside class="assistant-hero-status"><span class="assistant-status-icon">' + UI.icon("sparkles") + '</span><small>RUNTIME STATUS</small><strong>' + esc(modelText) + '</strong><p>当前可查询门户本地试点数据；跨系统 AI 问答将在模型网关与外部数据适配器接通后启用。</p></aside></header>' +
      '<div class="assistant-layout"><section class="assistant-chat-panel"><header class="assistant-chat-head"><div class="assistant-chat-avatar">' + UI.icon("sparkles") + '</div><div><h3>研发 AI 助手</h3><p>提问入口 · 本次页面会话</p></div><button type="button" class="assistant-new-session" id="assistantNewSession">' + UI.icon("plus") + ' 新建会话</button><span class="assistant-mode-pill">本地只读查询</span></header>' +
        '<div class="assistant-conversation" id="assistantConversation" aria-live="polite"></div>' +
        '<form class="assistant-composer" id="assistantForm"><div class="assistant-composer-meta"><label for="assistantScope">问题范围</label><select class="input" id="assistantScope"><option value="auto">自动判断业务域</option><option value="quality">质量决策助手</option><option value="projects">项目管理</option><option value="standardization">标准化与优选件</option><option value="problems">问题经验</option></select><span>Enter 发送 · Shift + Enter 换行</span></div>' +
          '<textarea id="assistantInput" rows="3" maxlength="2000" placeholder="例如：帮我汇总某机型本月质量问题、整改状态和项目 DCP 遗留事项…"></textarea>' +
          '<div class="assistant-composer-foot"><span>不要输入密码、令牌或未经授权的敏感信息。</span><button type="submit" class="btn btn-primary" id="assistantSend">' + UI.icon("arrow-up-right") + ' 查询本地数据</button></div></form>' +
        '<div class="assistant-privacy-note"><span>' + UI.icon("shield-check") + '</span><p>当前消息只保留在此页面会话内，不写入业务数据库。真实问答启用前，需要接入账号权限校验、数据源引用与审计策略。</p></div>' +
      '</section><aside class="assistant-side"><section class="assistant-side-panel"><header><span class="assistant-side-kicker">BUSINESS WORKSPACES</span><h3>独立业务入口</h3><p>一个入口发起问题，各模块保留自己的业务流程与数据主权。</p></header>' +
        '<div class="assistant-domain-list">' + domainCard("quality", false) + domainCard("projects", false) + domainCard("standardization", false) + domainCard("problems", false) + '</div></section>' +
        '<section class="assistant-side-panel assistant-architecture"><span class="assistant-side-kicker">INTEGRATION READINESS</span><h3>问答能力接入状态</h3><div class="assistant-readiness-list">' + readinessRows() + '</div><a href="#/app_center" class="assistant-status-link">查看应用注册中心 ' + UI.icon("arrow-up-right") + '</a></section></aside></div></section>';
    el.querySelector("#assistantNewSession").addEventListener("click", function () {
      state.messages = [];
      state.scope = "auto";
      state.context = {};
      const select = el.querySelector("#assistantScope");
      const input = el.querySelector("#assistantInput");
      if (select) select.value = "auto";
      if (input) { input.value = ""; input.focus(); }
      renderMessages();
    });
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
    state.context = {};
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
