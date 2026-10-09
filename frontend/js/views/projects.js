// AI + 项目管理：项目组合、DCP 节点、风险闭环和本地报告
window.Views = window.Views || {};
window.Views.projects = (function () {
  const title = "AI + 项目管理";
  const state = { el: null, tab: "portfolio", projects: [], summary: null };
  const stageLabels = ["预研", "立项", "开发", "验证", "试产", "量产"];
  const statusLabel = { normal: "正常", at_risk: "有风险", blocked: "阻塞", completed: "已完成" };
  const statusClass = { normal: "good", at_risk: "warning", blocked: "danger", completed: "muted" };
  const riskLabels = { high: "高", medium: "中", low: "低" };
  const riskStatus = { open: "待处理", monitoring: "跟进中", resolved: "已解决" };
  const gateStatus = { pending: "待评审", passed: "已通过", blocked: "阻塞" };

  async function render(el) {
    state.el = el;
    el.innerHTML =
      '<section class="pm-shell">' +
        '<div class="pm-hero"><div><span class="module-kicker">PROJECT CONTROL · LOCAL PILOT</span>' +
        '<h2>项目组合与交付控制</h2><p>统一查看项目阶段、DCP 里程碑和风险责任。当前记录保存在门户本地试点库，不会自动同步至独立项目管理系统。</p></div>' +
        '<div class="pm-hero-actions"><span class="local-source-badge">本地试点数据</span><button class="btn btn-primary" id="pmAddProject">' + UI.icon("plus") + ' 新建项目</button></div></div>' +
        '<div class="pm-tabs" id="pmTabs">' +
          '<button class="tab active" data-tab="portfolio">项目组合</button><button class="tab" data-tab="gates">DCP 里程碑</button>' +
          '<button class="tab" data-tab="risks">风险闭环</button><button class="tab" data-tab="report">报告中心</button>' +
        '</div><div id="pmPanel"><div class="empty">正在加载项目数据…</div></div></section>';
    el.querySelectorAll("#pmTabs [data-tab]").forEach(function (tab) {
      tab.addEventListener("click", function () { state.tab = tab.dataset.tab; renderActiveTab(); });
    });
    el.querySelector("#pmAddProject").addEventListener("click", function () { showProjectForm(); });
    await refresh();
  }

  async function refresh() {
    try {
      const response = await api.get("/api/projects/summary");
      state.summary = response;
      state.projects = response.projects || [];
      renderActiveTab();
    } catch (error) {
      const panel = state.el && state.el.querySelector("#pmPanel");
      if (panel) panel.innerHTML = '<div class="empty">项目数据加载失败：' + UI.esc(error.message) + '</div>';
    }
  }

  function renderActiveTab() {
    if (!state.el) return;
    state.el.querySelectorAll("#pmTabs [data-tab]").forEach(function (tab) {
      tab.classList.toggle("active", tab.dataset.tab === state.tab);
    });
    if (state.tab === "portfolio") renderPortfolio();
    else if (state.tab === "gates") renderGates();
    else if (state.tab === "risks") renderRisks();
    else renderReport();
  }

  function renderStats() {
    const s = (state.summary && state.summary.stats) || {};
    const list = [
      ["项目总数", s.total_projects || 0, "当前组合"],
      ["进行中", s.in_progress || 0, "未完成项目"],
      ["风险项目", s.at_risk || 0, "有风险或阻塞"],
      ["未关闭风险", s.open_risks || 0, "含待处理与跟进中"]
    ];
    return '<div class="pm-kpis">' + list.map(function (item, index) {
      return '<div class="pm-kpi pm-kpi-' + index + '"><span>' + item[0] + '</span><strong>' + item[1] +
        '</strong><small>' + item[2] + '</small></div>';
    }).join("") + '</div>';
  }

  function renderPortfolio() {
    const panel = state.el.querySelector("#pmPanel");
    const stage = document.getElementById("pmStageFilter") ? document.getElementById("pmStageFilter").value : "";
    const status = document.getElementById("pmStatusFilter") ? document.getElementById("pmStatusFilter").value : "";
    const query = document.getElementById("pmSearch") ? document.getElementById("pmSearch").value.trim().toLowerCase() : "";
    const filtered = state.projects.filter(function (p) {
      return (!stage || p.stage === stage) && (!status || p.status === status) &&
        (!query || [p.code, p.name, p.owner, p.product_line].join(" ").toLowerCase().includes(query));
    });
    const cards = filtered.length ? filtered.map(function (p) {
      const activeRisks = p.risks.filter(function (r) { return r.status !== "resolved"; }).length;
      const gatesDone = p.milestones.filter(function (m) { return m.status === "passed"; }).length;
      return '<article class="pm-project-card">' +
        '<div class="pm-project-top"><span class="pm-project-code">' + UI.esc(p.code) + '</span>' +
        '<span class="pm-status ' + (statusClass[p.status] || "muted") + '">' + UI.esc(statusLabel[p.status] || p.status) + '</span></div>' +
        '<h3>' + UI.esc(p.name) + '</h3><div class="pm-project-sub">' + UI.esc(p.product_line || "未填写产品线") +
        ' · 负责人 ' + UI.esc(p.owner || "待指定") + '</div>' +
        '<div class="pm-progress-head"><span>项目进度</span><b>' + p.progress + '%</b></div>' +
        '<div class="pm-progress"><span style="width:' + p.progress + '%"></span></div>' +
        '<div class="pm-project-meta"><span>阶段 <b>' + UI.esc(p.stage) + '</b></span><span>计划结束 <b>' + UI.esc(p.planned_end || "未设定") + '</b></span></div>' +
        '<div class="pm-project-foot"><span>' + p.milestones.length + ' 个 DCP · 已通过 ' + gatesDone + '</span>' +
        '<span class="' + (activeRisks ? "pm-risk-text" : "pm-ok-text") + '">' + activeRisks + ' 个未关闭风险</span></div>' +
        '<div class="pm-card-actions"><button class="btn btn-sm" data-edit-project="' + p.id + '">编辑项目</button>' +
        '<button class="btn btn-sm" data-add-gate="' + p.id + '">新增 DCP</button><button class="btn btn-sm" data-add-risk="' + p.id + '">登记风险</button></div></article>';
    }).join("") : '<div class="pm-empty"><div class="empty-ico">▦</div><strong>还没有符合条件的项目</strong><p>新增项目后，可以维护阶段、DCP 节点和风险措施。</p><button class="btn btn-primary" id="pmEmptyAdd">新建第一个项目</button></div>';

    panel.innerHTML = renderStats() +
      '<div class="pm-toolbar"><div><h3>项目台账</h3><p>通过状态、阶段和关键词快速定位项目。</p></div>' +
      '<div class="pm-filters"><input class="input" id="pmSearch" placeholder="搜索编号、项目、产品线、负责人" value="' + UI.esc(query) + '">' +
      '<select class="input" id="pmStageFilter"><option value="">全部阶段</option>' + stageLabels.map(function (s) {
        return '<option ' + (stage === s ? "selected" : "") + '>' + s + '</option>';
      }).join("") + '</select>' +
      '<select class="input" id="pmStatusFilter"><option value="">全部状态</option>' +
      Object.keys(statusLabel).map(function (s) { return '<option value="' + s + '" ' + (status === s ? "selected" : "") + '>' + statusLabel[s] + '</option>'; }).join("") +
      '</select><button class="btn" id="pmApplyFilter">筛选</button></div></div>' +
      '<div class="pm-project-grid">' + cards + '</div>';

    panel.querySelector("#pmApplyFilter").addEventListener("click", renderPortfolio);
    panel.querySelector("#pmSearch").addEventListener("keydown", function (event) { if (event.key === "Enter") renderPortfolio(); });
    const emptyAdd = panel.querySelector("#pmEmptyAdd");
    if (emptyAdd) emptyAdd.addEventListener("click", function () { showProjectForm(); });
    panel.querySelectorAll("[data-edit-project]").forEach(function (button) {
      button.addEventListener("click", function () {
        showProjectForm(state.projects.find(function (p) { return p.id === Number(button.dataset.editProject); }));
      });
    });
    panel.querySelectorAll("[data-add-gate]").forEach(function (button) {
      button.addEventListener("click", function () {
        const project = state.projects.find(function (p) { return p.id === Number(button.dataset.addGate); });
        if (project) showMilestoneForm(project);
      });
    });
    panel.querySelectorAll("[data-add-risk]").forEach(function (button) {
      button.addEventListener("click", function () {
        const project = state.projects.find(function (p) { return p.id === Number(button.dataset.addRisk); });
        if (project) showRiskForm(project);
      });
    });
  }

  function renderGates() {
    const panel = state.el.querySelector("#pmPanel");
    const projectById = {};
    state.projects.forEach(function (p) { projectById[p.id] = p; });
    const gates = state.projects.flatMap(function (p) {
      return p.milestones.map(function (m) { return Object.assign({}, m, { project_name: p.name, project_code: p.code }); });
    });
    panel.innerHTML = '<div class="pm-section-head"><div><h3>DCP 关口台账</h3><p>里程碑日期、责任人及评审状态。通过关口会自动记录实际完成日期。</p></div>' +
      '<span class="local-source-badge">本地 DCP 记录</span></div>' +
      (gates.length ? '<div class="table-wrap"><table class="data-table pm-table"><thead><tr><th>项目</th><th>关口</th><th>里程碑</th><th>计划日期</th><th>实际日期</th><th>负责人</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
      gates.map(function (m) {
        const overdue = m.status === "pending" && m.planned_date < new Date().toISOString().slice(0, 10);
        return '<tr><td><b>' + UI.esc(m.project_code) + '</b><small class="pm-cell-sub">' + UI.esc(m.project_name) + '</small></td>' +
          '<td><span class="pm-gate-chip">' + UI.esc(m.gate) + '</span></td><td>' + UI.esc(m.title) + (overdue ? '<small class="pm-overdue">已逾期</small>' : '') + '</td>' +
          '<td>' + UI.esc(m.planned_date) + '</td><td>' + UI.esc(m.actual_date || "-") + '</td><td>' + UI.esc(m.owner) + '</td>' +
          '<td><span class="pm-status ' + (m.status === "passed" ? "good" : m.status === "blocked" ? "danger" : overdue ? "warning" : "muted") + '">' + UI.esc(gateStatus[m.status] || m.status) + '</span></td>' +
          '<td>' + (m.status === "pending" ? '<button class="btn btn-sm btn-primary" data-pass-gate="' + m.id + '">标记通过</button> <button class="btn btn-sm" data-block-gate="' + m.id + '">阻塞</button>' : '<button class="btn btn-sm" data-reopen-gate="' + m.id + '">改为待评审</button>') + '</td></tr>';
      }).join("") + '</tbody></table></div>' :
      '<div class="pm-empty"><div class="empty-ico">◷</div><strong>暂无 DCP 节点</strong><p>在项目组合卡片中点击“新增 DCP”，建立计划关口和负责人。</p><button class="btn btn-primary" id="pmGateAddFirst">选择项目并新增</button></div>');
    const first = panel.querySelector("#pmGateAddFirst");
    if (first) first.addEventListener("click", function () {
      if (!state.projects.length) return UI.toast("请先新建项目", "warn");
      showMilestoneForm(state.projects[0]);
    });
    panel.querySelectorAll("[data-pass-gate]").forEach(function (button) {
      button.addEventListener("click", async function () { await patchGate(button.dataset.passGate, { status: "passed" }); });
    });
    panel.querySelectorAll("[data-block-gate]").forEach(function (button) {
      button.addEventListener("click", async function () { await patchGate(button.dataset.blockGate, { status: "blocked" }); });
    });
    panel.querySelectorAll("[data-reopen-gate]").forEach(function (button) {
      button.addEventListener("click", async function () { await patchGate(button.dataset.reopenGate, { status: "pending", actual_date: null }); });
    });
  }

  async function patchGate(id, body) {
    try { await api.patch("/api/projects/milestones/" + id, body); UI.toast("DCP 状态已更新", "success"); await refresh(); }
    catch (error) { UI.toast(error.message, "error"); }
  }

  function renderRisks() {
    const panel = state.el.querySelector("#pmPanel");
    const rows = state.projects.flatMap(function (p) {
      return p.risks.map(function (r) { return Object.assign({}, r, { project_name: p.name, project_code: p.code }); });
    });
    const active = rows.filter(function (r) { return r.status !== "resolved"; });
    panel.innerHTML = '<div class="pm-section-head"><div><h3>项目风险与措施</h3><p>每条风险都保留等级、责任人、截止日期和应对措施，直至责任人关闭。</p></div>' +
      '<span class="pm-risk-summary">未关闭 ' + active.length + ' · 逾期 ' + active.filter(function (r) { return r.overdue; }).length + '</span></div>' +
      (rows.length ? '<div class="table-wrap"><table class="data-table pm-table"><thead><tr><th>项目</th><th>风险事项</th><th>等级</th><th>责任人</th><th>截止日期</th><th>状态</th><th>应对措施</th><th>操作</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td><b>' + UI.esc(r.project_code) + '</b><small class="pm-cell-sub">' + UI.esc(r.project_name) + '</small></td>' +
          '<td>' + UI.esc(r.title) + '</td><td><span class="pm-risk-level ' + UI.esc(r.level) + '">' + UI.esc(riskLabels[r.level] || r.level) + '</span></td>' +
          '<td>' + UI.esc(r.owner) + '</td><td>' + UI.esc(r.due_date || "-") + (r.overdue ? '<small class="pm-overdue">已逾期</small>' : '') + '</td>' +
          '<td>' + UI.esc(riskStatus[r.status] || r.status) + '</td><td class="pm-mitigation">' + UI.esc(r.mitigation || "待补充") + '</td>' +
          '<td>' + (r.status === "resolved" ? '<span class="pm-ok-text">已闭环</span>' : '<button class="btn btn-sm" data-monitor-risk="' + r.id + '">跟进中</button> <button class="btn btn-sm btn-primary" data-resolve-risk="' + r.id + '">关闭风险</button>') + '</td></tr>';
      }).join("") + '</tbody></table></div>' :
      '<div class="pm-empty"><div class="empty-ico">◇</div><strong>暂未登记风险</strong><p>项目组合卡片中可新增风险、责任人和应对措施。</p></div>');
    panel.querySelectorAll("[data-monitor-risk]").forEach(function (button) {
      button.addEventListener("click", async function () { await patchRisk(button.dataset.monitorRisk, { status: "monitoring" }); });
    });
    panel.querySelectorAll("[data-resolve-risk]").forEach(function (button) {
      button.addEventListener("click", async function () { await patchRisk(button.dataset.resolveRisk, { status: "resolved" }); });
    });
  }

  async function patchRisk(id, body) {
    try { await api.patch("/api/projects/risks/" + id, body); UI.toast("风险状态已更新", "success"); await refresh(); }
    catch (error) { UI.toast(error.message, "error"); }
  }

  function renderReport() {
    const panel = state.el.querySelector("#pmPanel");
    const s = (state.summary && state.summary.stats) || {};
    const gateCount = state.projects.reduce(function (n, p) { return n + p.milestones.length; }, 0);
    const riskCount = state.projects.reduce(function (n, p) { return n + p.risks.filter(function (r) { return r.status !== "resolved"; }).length; }, 0);
    panel.innerHTML = '<div class="pm-report-layout"><div class="pm-report-card"><span class="panel-kicker">PROJECT REPORT</span>' +
      '<h3>项目组合周报</h3><p>基于当前本地试点项目、DCP 和风险记录生成，可下载 Markdown 后继续编辑。</p>' +
      '<div class="pm-report-stats"><span>项目 <b>' + (s.total_projects || 0) + '</b></span><span>未关闭风险 <b>' + riskCount + '</b></span><span>DCP 节点 <b>' + gateCount + '</b></span></div>' +
      '<button class="btn btn-primary" id="pmExportReport">' + UI.icon("file") + ' 导出 Markdown 周报</button></div>' +
      '<div class="pm-report-outline"><h4>报告将包含</h4><div>01　组合进度与项目状态</div><div>02　DCP 关口与逾期节点</div><div>03　高/中/低风险及应对措施</div><div>04　数据来源与试点边界说明</div></div></div>';
    panel.querySelector("#pmExportReport").addEventListener("click", exportReport);
  }

  function exportReport() {
    const s = (state.summary && state.summary.stats) || {};
    const lines = ["# 项目管理试点周报", "", "生成时间：" + new Date().toLocaleString(),
      "", "> 数据来源：门户本地试点数据库；未与独立项目管理系统自动同步。", "",
      "## 一、组合概览", "", "- 项目总数：" + (s.total_projects || 0),
      "- 未完成项目：" + (s.in_progress || 0), "- 风险项目：" + (s.at_risk || 0),
      "- 未关闭风险：" + (s.open_risks || 0), "- 逾期风险：" + (s.overdue_risks || 0), "", "## 二、项目进展", ""];
    if (!state.projects.length) lines.push("暂无项目记录。", "");
    state.projects.forEach(function (p) {
      lines.push("### " + p.code + " · " + p.name, "",
        "- 产品线：" + (p.product_line || "未填写"),
        "- 阶段/状态：" + p.stage + " / " + (statusLabel[p.status] || p.status),
        "- 负责人：" + p.owner, "- 进度：" + p.progress + "%",
        "- 计划结束：" + (p.planned_end || "未设定"), "");
      lines.push("DCP：");
      if (!p.milestones.length) lines.push("- 暂无关口");
      p.milestones.forEach(function (m) { lines.push("- " + m.gate + " " + m.title + "｜计划 " + m.planned_date + "｜状态 " + (gateStatus[m.status] || m.status)); });
      lines.push("", "风险：");
      const risks = p.risks.filter(function (r) { return r.status !== "resolved"; });
      if (!risks.length) lines.push("- 暂无未关闭风险");
      risks.forEach(function (r) { lines.push("- [" + (riskLabels[r.level] || r.level) + "] " + r.title + "｜责任人 " + r.owner + "｜截止 " + (r.due_date || "未设定") + "｜措施 " + (r.mitigation || "待补充")); });
      lines.push("");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "项目管理试点周报-" + new Date().toISOString().slice(0, 10) + ".md";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    UI.toast("周报已生成，请确认其中的本地试点数据后再转发。", "success");
  }

  function showProjectForm(project) {
    const editing = !!project;
    const host = document.getElementById("modalHost");
    host.innerHTML = '<div class="modal-mask"><div class="modal-box pm-form-modal"><div class="modal-head">' + (editing ? "编辑项目" : "新建项目") + '</div>' +
      '<div class="modal-body"><div class="pm-form-grid">' +
      '<div class="form-group"><label class="form-label">项目编号 *</label><input class="input" id="pfCode" ' + (editing ? "disabled" : "") + ' value="' + UI.esc(project ? project.code : "") + '" placeholder="如 PRJ-2026-01"></div>' +
      '<div class="form-group"><label class="form-label">项目名称 *</label><input class="input" id="pfName" value="' + UI.esc(project ? project.name : "") + '"></div>' +
      '<div class="form-group"><label class="form-label">产品线</label><input class="input" id="pfLine" value="' + UI.esc(project ? project.product_line : "") + '"></div>' +
      '<div class="form-group"><label class="form-label">项目负责人</label><input class="input" id="pfOwner" value="' + UI.esc(project ? project.owner : "待指定") + '"></div>' +
      '<div class="form-group"><label class="form-label">阶段</label><select class="input" id="pfStage">' + stageLabels.map(function (s) { return '<option ' + (project && project.stage === s ? "selected" : "") + '>' + s + '</option>'; }).join("") + '</select></div>' +
      '<div class="form-group"><label class="form-label">状态</label><select class="input" id="pfStatus">' + Object.keys(statusLabel).map(function (s) { return '<option value="' + s + '" ' + (project && project.status === s ? "selected" : (!project && s === "normal" ? "selected" : "")) + '>' + statusLabel[s] + '</option>'; }).join("") + '</select></div>' +
      '<div class="form-group"><label class="form-label">计划开始</label><input class="input" type="date" id="pfStart" value="' + UI.esc(project ? project.planned_start || "" : "") + '"></div>' +
      '<div class="form-group"><label class="form-label">计划结束</label><input class="input" type="date" id="pfEnd" value="' + UI.esc(project ? project.planned_end || "" : "") + '"></div>' +
      '<div class="form-group pm-form-full"><label class="form-label">当前进度（0–100）</label><input class="input" type="number" min="0" max="100" id="pfProgress" value="' + (project ? project.progress : 0) + '"></div>' +
      '<div class="form-group pm-form-full"><label class="form-label">项目说明</label><textarea class="input" rows="3" id="pfDescription">' + UI.esc(project ? project.description || "" : "") + '</textarea></div>' +
      '</div><p class="muted">本表仅维护门户本地试点数据。</p></div><div class="modal-foot"><button class="btn" id="pfCancel">取消</button><button class="btn btn-primary" id="pfSave">保存项目</button></div></div></div>';
    host.querySelector("#pfCancel").addEventListener("click", function () { host.innerHTML = ""; });
    host.querySelector("#pfSave").addEventListener("click", async function () {
      const name = host.querySelector("#pfName").value.trim();
      const code = host.querySelector("#pfCode").value.trim();
      const start = host.querySelector("#pfStart").value || null;
      const end = host.querySelector("#pfEnd").value || null;
      if ((!editing && !code) || !name) return UI.toast("请填写项目编号和项目名称", "warn");
      if (start && end && end < start) return UI.toast("计划结束日期不能早于开始日期", "warn");
      const payload = { name: name, product_line: host.querySelector("#pfLine").value.trim(),
        owner: host.querySelector("#pfOwner").value.trim() || "待指定", stage: host.querySelector("#pfStage").value,
        status: host.querySelector("#pfStatus").value, planned_start: start, planned_end: end,
        progress: Number(host.querySelector("#pfProgress").value || 0),
        description: host.querySelector("#pfDescription").value.trim() };
      if (!editing) payload.code = code;
      try {
        await (editing ? api.patch("/api/projects/" + project.id, payload) : api.post("/api/projects", payload));
        host.innerHTML = ""; UI.toast(editing ? "项目已更新" : "项目已创建", "success"); await refresh();
      } catch (error) { UI.toast(error.message, "error"); }
    });
  }

  function showMilestoneForm(project) {
    const host = document.getElementById("modalHost");
    host.innerHTML = '<div class="modal-mask"><div class="modal-box"><div class="modal-head">新增 DCP 里程碑</div><div class="modal-body">' +
      '<p class="muted" style="margin-bottom:16px;">项目：' + UI.esc(project.code + " · " + project.name) + '</p>' +
      '<div class="form-group"><label class="form-label">DCP 关口</label><select class="input" id="mfGate">' + ["DCP0","DCP1","DCP2","DCP3","DCP4","DCP5"].map(function (g) { return '<option>' + g + '</option>'; }).join("") + '</select></div>' +
      '<div class="form-group"><label class="form-label">里程碑名称 *</label><input class="input" id="mfTitle" placeholder="例如：样机验证评审"></div>' +
      '<div class="form-group"><label class="form-label">计划日期 *</label><input class="input" type="date" id="mfDate" required></div>' +
      '<div class="form-group"><label class="form-label">负责人</label><input class="input" id="mfOwner" value="待指定"></div>' +
      '<div class="form-group"><label class="form-label">评审备注</label><textarea class="input" rows="3" id="mfNotes"></textarea></div></div>' +
      '<div class="modal-foot"><button class="btn" id="mfCancel">取消</button><button class="btn btn-primary" id="mfSave">保存节点</button></div></div></div>';
    host.querySelector("#mfCancel").addEventListener("click", function () { host.innerHTML = ""; });
    host.querySelector("#mfSave").addEventListener("click", async function () {
      const titleText = host.querySelector("#mfTitle").value.trim(), dateText = host.querySelector("#mfDate").value;
      if (!titleText || !dateText) return UI.toast("请填写里程碑名称和计划日期", "warn");
      try {
        await api.post("/api/projects/" + project.id + "/milestones", {
          gate: host.querySelector("#mfGate").value, title: titleText, planned_date: dateText,
          owner: host.querySelector("#mfOwner").value.trim() || "待指定", notes: host.querySelector("#mfNotes").value.trim()
        });
        host.innerHTML = ""; UI.toast("DCP 节点已添加", "success"); state.tab = "gates"; await refresh();
      } catch (error) { UI.toast(error.message, "error"); }
    });
  }

  function showRiskForm(project) {
    const host = document.getElementById("modalHost");
    host.innerHTML = '<div class="modal-mask"><div class="modal-box"><div class="modal-head">登记项目风险</div><div class="modal-body">' +
      '<p class="muted" style="margin-bottom:16px;">项目：' + UI.esc(project.code + " · " + project.name) + '</p>' +
      '<div class="form-group"><label class="form-label">风险事项 *</label><input class="input" id="rfTitle" placeholder="描述可能影响交付的风险"></div>' +
      '<div class="form-group"><label class="form-label">风险等级</label><select class="input" id="rfLevel"><option value="high">高</option><option value="medium" selected>中</option><option value="low">低</option></select></div>' +
      '<div class="form-group"><label class="form-label">责任人</label><input class="input" id="rfOwner" value="待指定"></div>' +
      '<div class="form-group"><label class="form-label">跟进截止日</label><input class="input" type="date" id="rfDate"></div>' +
      '<div class="form-group"><label class="form-label">应对措施</label><textarea class="input" rows="3" id="rfMitigation" placeholder="写清缓解措施、依赖和下一步"></textarea></div></div>' +
      '<div class="modal-foot"><button class="btn" id="rfCancel">取消</button><button class="btn btn-primary" id="rfSave">保存风险</button></div></div></div>';
    host.querySelector("#rfCancel").addEventListener("click", function () { host.innerHTML = ""; });
    host.querySelector("#rfSave").addEventListener("click", async function () {
      const titleText = host.querySelector("#rfTitle").value.trim();
      if (!titleText) return UI.toast("请填写风险事项", "warn");
      try {
        await api.post("/api/projects/" + project.id + "/risks", {
          title: titleText, level: host.querySelector("#rfLevel").value,
          owner: host.querySelector("#rfOwner").value.trim() || "待指定",
          due_date: host.querySelector("#rfDate").value || null,
          mitigation: host.querySelector("#rfMitigation").value.trim()
        });
        host.innerHTML = ""; UI.toast("风险已登记", "success"); state.tab = "risks"; await refresh();
      } catch (error) { UI.toast(error.message, "error"); }
    });
  }

  return { title: title, render: render };
})();
