// AI + 项目管理：项目组合、DCP 节点、风险闭环和本地报告
window.Views = window.Views || {};
window.Views.projects = (function () {
  const title = "AI + 项目管理";
  const state = { el: null, tab: "portfolio", projects: [], summary: null, gateProject: "", gateFilter: "all", riskFilter: "active", riskLevel: "all", riskQuery: "" };
  const stageLabels = ["预研", "立项", "开发", "验证", "试产", "量产"];
  const statusLabel = { normal: "正常", at_risk: "有风险", blocked: "阻塞", completed: "已完成" };
  const statusClass = { normal: "good", at_risk: "warning", blocked: "danger", completed: "muted" };
  const riskLabels = { high: "高", medium: "中", low: "低" };
  const riskStatus = { open: "待处理", monitoring: "跟进中", resolved: "已解决" };
  const gateStatus = { pending: "待评审", passed: "已通过", blocked: "阻塞" };

  function esc(value) { return UI.esc(value === null || value === undefined ? "" : String(value)); }

  function clampProgress(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
  }

  function shortDate(value) {
    return value ? String(value).replace(/-/g, ".") : "未设定";
  }

  function todayISO() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function projectStageIndex(project) {
    return stageLabels.indexOf(project.stage);
  }

  function gateOrder(gate) {
    const n = Number(String(gate || "").replace("DCP", ""));
    return Number.isFinite(n) ? n : 99;
  }

  function orderedMilestones(project) {
    return (project.milestones || []).slice().sort(function (a, b) {
      return gateOrder(a.gate) - gateOrder(b.gate) || String(a.planned_date || "").localeCompare(String(b.planned_date || ""));
    });
  }

  function gateVisualState(milestone) {
    if (milestone.status === "passed") return "passed";
    if (milestone.status === "blocked") return "blocked";
    if (milestone.planned_date && milestone.planned_date < todayISO()) return "overdue";
    return "pending";
  }

  function gateVisualLabel(milestone) {
    const status = gateVisualState(milestone);
    return status === "passed" ? "已通过" : status === "blocked" ? "阻塞" : status === "overdue" ? "已逾期" : "待评审";
  }

  function nextMilestone(project) {
    return orderedMilestones(project).find(function (m) { return m.status !== "passed"; }) || null;
  }

  function stageTrack(project) {
    const current = projectStageIndex(project);
    const complete = project.status === "completed";
    return '<div class="pm-stage-track" aria-label="项目阶段">' +
      stageLabels.map(function (stage, index) {
        const cls = complete || index < current ? "done" : index === current ? "current" : "future";
        return '<span class="pm-stage-node ' + cls + '"><i></i><small>' + esc(stage) + '</small></span>';
      }).join("") + '</div>';
  }

  function projectStatusClass(status) {
    return statusClass[status] || "muted";
  }

  function riskClass(level) {
    return level === "high" ? "high" : level === "low" ? "low" : "medium";
  }

  function renderStatusPill(status, label, extraClass) {
    return '<span class="pm-status ' + (extraClass || "muted") + '"><i></i>' + esc(label || status) + '</span>';
  }

  function renderMiniMetric(label, value, detail, tone) {
    return '<div class="pm-mini-metric ' + (tone || "") + '"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong><small>' + esc(detail || "") + '</small></div>';
  }

  async function render(el) {
    state.el = el;
    el.innerHTML =
      '<section class="pm-shell">' +
        '<header class="pm-hero">' +
          '<div class="pm-hero-copy">' +
            '<span class="module-kicker">PROJECT CONTROL / DELIVERY GOVERNANCE</span>' +
            '<h2>项目组合与交付控制</h2>' +
            '<p>从项目阶段、DCP 关口到风险责任，用一套工作视图掌握项目进度与需要决策的事项。</p>' +
            '<div class="pm-hero-meta"><span><i class="pm-live-dot"></i>本地试点工作区</span><span>数据源：门户本地数据库</span><span>独立 PM 系统未同步</span></div>' +
          '</div>' +
          '<div class="pm-hero-actions"><div class="pm-hero-stat"><span>PROJECT PORTFOLIO</span><strong id="pmHeroProjectCount">—</strong><small>已登记项目</small></div>' +
            '<button class="btn btn-primary" id="pmAddProject">' + UI.icon("plus") + ' 新建项目</button></div>' +
        '</header>' +
        '<nav class="pm-tabs" id="pmTabs" role="tablist" aria-label="项目管理工作区">' +
          '<button type="button" role="tab" aria-selected="true" class="tab active" data-tab="portfolio"><span class="pm-tab-label">项目组合</span><span class="pm-tab-count" id="pmTabProjectCount">0</span></button>' +
          '<button type="button" role="tab" aria-selected="false" class="tab" data-tab="gates"><span class="pm-tab-label">DCP 里程碑</span><span class="pm-tab-count" id="pmTabGateCount">0</span></button>' +
          '<button type="button" role="tab" aria-selected="false" class="tab" data-tab="risks"><span class="pm-tab-label">风险闭环</span><span class="pm-tab-count" id="pmTabRiskCount">0</span></button>' +
          '<button type="button" role="tab" aria-selected="false" class="tab" data-tab="report"><span class="pm-tab-label">报告中心</span></button>' +
        '</nav>' +
        '<div id="pmPanel"><div class="pm-loading"><span class="pm-loading-mark"></span><div><strong>正在加载项目工作区</strong><small>读取项目、DCP 与风险记录…</small></div></div></div>' +
      '</section>';
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
    const summaryStats = (state.summary && state.summary.stats) || {};
    const countProject = state.el.querySelector("#pmTabProjectCount");
    const countGates = state.el.querySelector("#pmTabGateCount");
    const countRisks = state.el.querySelector("#pmTabRiskCount");
    const heroCount = state.el.querySelector("#pmHeroProjectCount");
    if (countProject) countProject.textContent = String(state.projects.length);
    if (countGates) countGates.textContent = String(state.projects.reduce(function (n, project) { return n + (project.milestones || []).length; }, 0));
    if (countRisks) countRisks.textContent = String(summaryStats.open_risks || 0);
    if (heroCount) heroCount.textContent = String(state.projects.length);
    state.el.querySelectorAll("#pmTabs [data-tab]").forEach(function (tab) {
      const selected = tab.dataset.tab === state.tab;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    if (state.tab === "portfolio") renderPortfolio();
    else if (state.tab === "gates") renderGates();
    else if (state.tab === "risks") renderRisks();
    else renderReport();
  }

  function renderStats() {
    const stats = (state.summary && state.summary.stats) || {};
    const activeProjects = Number(stats.in_progress || 0);
    return '<section class="pm-kpis" aria-label="项目组合关键指标">' +
      '<div class="pm-kpi pm-kpi-primary"><div class="pm-kpi-primary-head"><span>项目组合规模</span><span class="pm-kpi-eyebrow">PORTFOLIO</span></div>' +
        '<div class="pm-kpi-primary-value"><strong>' + (stats.total_projects || 0) + '</strong><span>个项目</span></div>' +
        '<div class="pm-kpi-primary-foot"><span><i class="pm-dot blue"></i>' + activeProjects + ' 个进行中</span><span>' + (stats.total_projects ? Math.round((Number(stats.total_projects) - activeProjects) / Number(stats.total_projects) * 100) : 0) + '% 已完成或暂停</span></div></div>' +
      renderMiniMetric("风险项目", stats.at_risk || 0, "有风险或已阻塞", Number(stats.at_risk || 0) ? "warning" : "quiet") +
      renderMiniMetric("未关闭风险", stats.open_risks || 0, "待处理与跟进中", Number(stats.open_risks || 0) ? "danger" : "quiet") +
      renderMiniMetric("逾期风险", stats.overdue_risks || 0, "超过跟进截止日期", Number(stats.overdue_risks || 0) ? "danger" : "quiet") +
      renderMiniMetric("近期 DCP", stats.upcoming_gates || 0, "未来 14 天待评审", Number(stats.upcoming_gates || 0) ? "warning" : "quiet") +
    '</section>';
  }

  function renderPortfolio() {
    const panel = state.el.querySelector("#pmPanel");
    const stage = panel.querySelector("#pmStageFilter") ? panel.querySelector("#pmStageFilter").value : "";
    const status = panel.querySelector("#pmStatusFilter") ? panel.querySelector("#pmStatusFilter").value : "";
    const query = panel.querySelector("#pmSearch") ? panel.querySelector("#pmSearch").value.trim().toLowerCase() : "";
    const filtered = state.projects.filter(function (project) {
      return (!stage || project.stage === stage) && (!status || project.status === status) &&
        (!query || [project.code, project.name, project.owner, project.product_line].join(" ").toLowerCase().includes(query));
    });

    const cards = filtered.length ? filtered.map(function (project, index) {
      const gates = orderedMilestones(project);
      const passed = gates.filter(function (m) { return m.status === "passed"; }).length;
      const activeRisks = (project.risks || []).filter(function (risk) { return risk.status !== "resolved"; });
      const overdueRisks = activeRisks.filter(function (risk) { return risk.overdue; }).length;
      const progress = clampProgress(project.progress);
      const next = nextMilestone(project);
      const nextHtml = next
        ? '<div class="pm-next-gate"><span class="pm-next-gate-icon">' + UI.icon("calendar-clock") + '</span><div><small>' + (gateVisualState(next) === "overdue" ? "需要关注 · DCP 已逾期" : "下一个未完成关口") + '</small><strong>' + esc(next.gate) + ' · ' + esc(next.title) + '</strong><span>' + shortDate(next.planned_date) + '　·　' + esc(next.owner || "待指定") + '</span></div></div>'
        : '<div class="pm-next-gate is-clear"><span class="pm-next-gate-icon">' + UI.icon("check-circle") + '</span><div><small>里程碑</small><strong>' + (gates.length ? "所有 DCP 均已通过" : "尚未登记 DCP 里程碑") + '</strong><span>' + (gates.length ? "可继续维护后续项目动作" : "建立 DCP 计划以跟踪交付关口") + '</span></div></div>';

      return '<article class="pm-project-card' + (index === 0 ? ' is-featured' : '') + '">' +
        '<div class="pm-card-main">' +
          '<div class="pm-project-top"><span class="pm-project-code">' + esc(project.code) + '</span>' +
            renderStatusPill(project.status, statusLabel[project.status] || project.status, projectStatusClass(project.status)) +
          '</div>' +
          '<div class="pm-project-heading"><div class="pm-project-avatar">' + esc((project.name || "项").trim().slice(0, 1)) + '</div><div class="pm-project-heading-copy"><h3>' + esc(project.name) + '</h3><p>' + esc(project.product_line || "未设置产品线") + ' <span>·</span> 负责人 ' + esc(project.owner || "待指定") + '</p></div></div>' +
          '<div class="pm-card-progress"><div class="pm-progress-head"><span>项目整体进度</span><strong>' + progress + '<small>%</small></strong></div>' +
            '<div class="pm-progress" role="progressbar" aria-label="项目进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + progress + '"><span style="width:' + progress + '%"></span></div></div>' +
          stageTrack(project) +
          '<div class="pm-project-dates"><div><small>计划开始</small><strong>' + shortDate(project.planned_start) + '</strong></div><div><small>计划结束</small><strong>' + shortDate(project.planned_end) + '</strong></div></div>' +
        '</div>' +
        '<div class="pm-card-analytics">' +
          '<div class="pm-card-section-kicker">DELIVERY HEALTH <span>' + (index === 0 ? "最近更新" : "项目概况") + '</span></div>' +
          '<div class="pm-project-facts"><div><span>DCP 关口</span><strong>' + passed + '<small> / ' + gates.length + ' 已通过</small></strong></div>' +
            '<div><span>未关闭风险</span><strong class="' + (activeRisks.length ? "is-risk" : "is-good") + '">' + activeRisks.length + '<small> 项</small></strong></div>' +
            '<div><span>逾期风险</span><strong class="' + (overdueRisks ? "is-risk" : "") + '">' + overdueRisks + '<small> 项</small></strong></div></div>' +
          nextHtml +
          '<div class="pm-card-actions"><button type="button" class="btn btn-primary btn-sm" data-project-detail="' + project.id + '">查看项目档案 ' + UI.icon("arrow-up-right") + '</button>' +
            '<button type="button" class="btn btn-sm" data-edit-project="' + project.id + '">编辑</button>' +
            '<button type="button" class="btn btn-sm" data-add-gate="' + project.id + '">＋ DCP</button>' +
            '<button type="button" class="btn btn-sm" data-add-risk="' + project.id + '">＋ 风险</button></div>' +
        '</div>' +
      '</article>';
    }).join("") : '<div class="pm-empty"><div class="pm-empty-symbol">' + UI.icon("folder-search") + '</div><strong>' + (state.projects.length ? "没有符合条件的项目" : "项目组合尚未建立") + '</strong><p>' + (state.projects.length ? "尝试清除筛选条件，或调整关键词。" : "新增第一个项目后，即可维护项目阶段、DCP 关口和风险措施。") + '</p>' +
      (state.projects.length ? '<button type="button" class="btn" id="pmResetFilter">清除筛选</button>' : '<button type="button" class="btn btn-primary" id="pmEmptyAdd">新建第一个项目</button>') + '</div>';

    panel.innerHTML = renderStats() +
      '<section class="pm-portfolio-heading"><div><span class="pm-section-kicker">PORTFOLIO / OVERVIEW</span><h3>项目组合</h3><p>按阶段与交付状态查看项目；优先关注逾期关口和未关闭风险。</p></div>' +
        '<div class="pm-portfolio-meta"><span>' + filtered.length + ' / ' + state.projects.length + ' 个项目</span><span><i class="pm-live-dot"></i>数据来自本地试点库</span></div></section>' +
      '<section class="pm-filter-panel"><div class="pm-search-wrap"><span>' + UI.icon("search") + '</span><input class="input" id="pmSearch" placeholder="搜索项目编号、名称、负责人或产品线" value="' + esc(query) + '"></div>' +
        '<div class="pm-filters"><select class="input" id="pmStageFilter"><option value="">全部阶段</option>' + stageLabels.map(function (item) { return '<option value="' + esc(item) + '"' + (stage === item ? " selected" : "") + '>' + esc(item) + '</option>'; }).join("") + '</select>' +
          '<select class="input" id="pmStatusFilter"><option value="">全部状态</option>' + Object.keys(statusLabel).map(function (key) { return '<option value="' + key + '"' + (status === key ? " selected" : "") + '>' + esc(statusLabel[key]) + '</option>'; }).join("") + '</select>' +
          '<button type="button" class="btn btn-primary" id="pmApplyFilter">筛选项目</button>' +
          ((query || stage || status) ? '<button type="button" class="btn" id="pmClearFilter">重置</button>' : '') +
        '</div></section>' +
      '<section class="pm-project-grid" aria-label="项目列表">' + cards + '</section>';

    panel.querySelector("#pmApplyFilter").addEventListener("click", renderPortfolio);
    panel.querySelector("#pmSearch").addEventListener("keydown", function (event) { if (event.key === "Enter") renderPortfolio(); });
    const emptyAdd = panel.querySelector("#pmEmptyAdd");
    if (emptyAdd) emptyAdd.addEventListener("click", function () { showProjectForm(); });
    const reset = panel.querySelector("#pmResetFilter") || panel.querySelector("#pmClearFilter");
    if (reset) reset.addEventListener("click", function () {
      const search = panel.querySelector("#pmSearch");
      if (search) search.value = "";
      const stageSelect = panel.querySelector("#pmStageFilter");
      const statusSelect = panel.querySelector("#pmStatusFilter");
      if (stageSelect) stageSelect.value = "";
      if (statusSelect) statusSelect.value = "";
      renderPortfolio();
    });
    panel.querySelectorAll("[data-project-detail]").forEach(function (button) {
      button.addEventListener("click", function () {
        const project = state.projects.find(function (item) { return item.id === Number(button.dataset.projectDetail); });
        if (project) showProjectDetail(project);
      });
    });
    panel.querySelectorAll("[data-edit-project]").forEach(function (button) {
      button.addEventListener("click", function () {
        const project = state.projects.find(function (item) { return item.id === Number(button.dataset.editProject); });
        if (project) showProjectForm(project);
      });
    });
    panel.querySelectorAll("[data-add-gate]").forEach(function (button) {
      button.addEventListener("click", function () {
        const project = state.projects.find(function (item) { return item.id === Number(button.dataset.addGate); });
        if (project) showMilestoneForm(project);
      });
    });
    panel.querySelectorAll("[data-add-risk]").forEach(function (button) {
      button.addEventListener("click", function () {
        const project = state.projects.find(function (item) { return item.id === Number(button.dataset.addRisk); });
        if (project) showRiskForm(project);
      });
    });
  }

  function renderGates() {
    const panel = state.el.querySelector("#pmPanel");
    const allGates = state.projects.flatMap(function (project) {
      return (project.milestones || []).map(function (milestone) {
        return Object.assign({}, milestone, { project_name: project.name, project_code: project.code, project_id: project.id });
      });
    });
    const selectedProject = state.gateProject;
    const selectedStatus = state.gateFilter;
    const filtered = allGates.filter(function (milestone) {
      return (!selectedProject || String(milestone.project_id) === selectedProject) &&
        (selectedStatus === "all" || (selectedStatus === "active" ? milestone.status !== "passed" : milestone.status === selectedStatus));
    }).sort(function (a, b) {
      return String(a.planned_date || "").localeCompare(String(b.planned_date || "")) || gateOrder(a.gate) - gateOrder(b.gate);
    });
    const projectsHtml = state.projects.map(function (project) {
      const milestones = filtered.filter(function (milestone) { return milestone.project_id === project.id; })
        .sort(function (a, b) { return gateOrder(a.gate) - gateOrder(b.gate); });
      if (!milestones.length) return "";
      const passed = milestones.filter(function (milestone) { return milestone.status === "passed"; }).length;
      return '<section class="pm-gate-project"><header class="pm-gate-project-head"><div class="pm-gate-project-identity"><span class="pm-gate-project-code">' + esc(project.code) + '</span><h3>' + esc(project.name) + '</h3><p>' + esc(project.owner || "待指定") + ' · ' + esc(project.stage) + '阶段</p></div>' +
        '<div class="pm-gate-project-progress"><strong>' + passed + '<small> / ' + milestones.length + '</small></strong><span>已通过关口</span></div></header>' +
        '<div class="pm-timeline">' + milestones.map(function (milestone) {
          const visual = gateVisualState(milestone);
          const actual = milestone.actual_date ? '<span class="pm-date-confirmed">实际 ' + shortDate(milestone.actual_date) + '</span>' : "";
          return '<article class="pm-timeline-item ' + visual + '"><div class="pm-timeline-rail"><span class="pm-timeline-node">' + (visual === "passed" ? UI.icon("check") : visual === "blocked" ? UI.icon("lock") : esc(gateOrder(milestone.gate))) + '</span></div>' +
            '<div class="pm-timeline-content"><div class="pm-timeline-top"><div class="pm-timeline-name"><span class="pm-gate-chip">' + esc(milestone.gate) + '</span><h4>' + esc(milestone.title) + '</h4></div>' + renderStatusPill(visual, gateVisualLabel(milestone), visual === "passed" ? "good" : visual === "blocked" ? "danger" : visual === "overdue" ? "warning" : "muted") + '</div>' +
            '<div class="pm-timeline-meta"><span>' + UI.icon("calendar") + ' 计划 ' + shortDate(milestone.planned_date) + '</span>' + actual + '<span>' + UI.icon("user-round") + ' ' + esc(milestone.owner || "待指定") + '</span></div>' +
            (milestone.notes ? '<p class="pm-timeline-notes">' + esc(milestone.notes) + '</p>' : '') +
            '<div class="pm-timeline-actions">' +
              '<button type="button" class="btn btn-sm" data-edit-gate="' + milestone.id + '">编辑关口</button>' +
              (milestone.status === "pending" ? '<button type="button" class="btn btn-sm btn-primary" data-pass-gate="' + milestone.id + '">标记通过</button><button type="button" class="btn btn-sm" data-block-gate="' + milestone.id + '">标记阻塞</button>' :
                '<button type="button" class="btn btn-sm" data-reopen-gate="' + milestone.id + '">' + (milestone.status === "blocked" ? "恢复待评审" : "重新打开") + '</button>') +
            '</div></div></article>';
        }).join("") + '</div></section>';
    }).join("");

    const overdueCount = allGates.filter(function (milestone) { return gateVisualState(milestone) === "overdue"; }).length;
    const pendingCount = allGates.filter(function (milestone) { return milestone.status === "pending"; }).length;
    const passedCount = allGates.filter(function (milestone) { return milestone.status === "passed"; }).length;
    const blockedCount = allGates.filter(function (milestone) { return milestone.status === "blocked"; }).length;

    panel.innerHTML = '<section class="pm-view-header"><div><span class="pm-section-kicker">DCP / GATE TRACKING</span><h3>DCP 里程碑控制</h3><p>按项目查看 DCP0–DCP5 关口、计划日期、实际日期和评审状态。</p></div>' +
      '<div class="pm-view-actions"><select class="input" id="pmGateCreateProject" aria-label="选择要新增里程碑的项目"><option value="">选择项目</option>' + state.projects.map(function (project) { return '<option value="' + project.id + '">' + esc(project.code + " · " + project.name) + '</option>'; }).join("") + '</select><button type="button" class="btn btn-primary" id="pmCreateGate">' + UI.icon("plus") + ' 新增里程碑</button></div></section>' +
      '<section class="pm-mini-metrics">' +
        renderMiniMetric("全部关口", allGates.length, "项目 DCP 总量", "quiet") +
        renderMiniMetric("待评审", pendingCount, "未完成审核", pendingCount ? "warning" : "quiet") +
        renderMiniMetric("已逾期", overdueCount, "计划日期已过且未通过", overdueCount ? "danger" : "quiet") +
        renderMiniMetric("已通过", passedCount, "完成实际日期记录", "good") +
        renderMiniMetric("阻塞中", blockedCount, "需推动问题解决", blockedCount ? "danger" : "quiet") +
      '</section>' +
      '<section class="pm-filter-panel pm-gate-filter"><div class="pm-search-wrap"><span>' + UI.icon("folder-kanban") + '</span><select class="input" id="pmGateProjectFilter" aria-label="按项目筛选"><option value="">全部项目</option>' + state.projects.map(function (project) { return '<option value="' + project.id + '"' + (selectedProject === String(project.id) ? " selected" : "") + '>' + esc(project.code + " · " + project.name) + '</option>'; }).join("") + '</select></div>' +
      '<div class="pm-filters"><select class="input" id="pmGateStatusFilter" aria-label="按关口状态筛选">' +
        '<option value="all"' + (selectedStatus === "all" ? " selected" : "") + '>全部状态</option><option value="active"' + (selectedStatus === "active" ? " selected" : "") + '>未完成关口</option><option value="pending"' + (selectedStatus === "pending" ? " selected" : "") + '>待评审</option><option value="blocked"' + (selectedStatus === "blocked" ? " selected" : "") + '>阻塞中</option><option value="passed"' + (selectedStatus === "passed" ? " selected" : "") + '>已通过</option>' +
      '</select><button type="button" class="btn" id="pmGateApplyFilter">应用筛选</button></div></section>' +
      (projectsHtml || '<div class="pm-empty"><div class="pm-empty-symbol">' + UI.icon("calendar-days") + '</div><strong>' + (allGates.length ? "当前筛选下没有里程碑" : "还没有登记 DCP 里程碑") + '</strong><p>' + (allGates.length ? "尝试查看全部状态，或切换其他项目。" : "选择一个项目后，新增 DCP 关口以跟踪评审节点。") + '</p></div>');

    panel.querySelector("#pmGateApplyFilter").addEventListener("click", function () {
      state.gateProject = panel.querySelector("#pmGateProjectFilter").value;
      state.gateFilter = panel.querySelector("#pmGateStatusFilter").value;
      renderGates();
    });
    panel.querySelector("#pmGateProjectFilter").addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        state.gateProject = panel.querySelector("#pmGateProjectFilter").value;
        state.gateFilter = panel.querySelector("#pmGateStatusFilter").value;
        renderGates();
      }
    });
    panel.querySelector("#pmCreateGate").addEventListener("click", function () {
      const projectId = Number(panel.querySelector("#pmGateCreateProject").value || state.gateProject || (state.projects[0] && state.projects[0].id));
      const project = state.projects.find(function (item) { return item.id === projectId; });
      if (!project) return UI.toast("请先新建项目，再为它登记 DCP 里程碑。", "warn");
      showMilestoneForm(project);
    });
    panel.querySelectorAll("[data-edit-gate]").forEach(function (button) {
      button.addEventListener("click", function () {
        const milestoneId = Number(button.dataset.editGate);
        const project = state.projects.find(function (item) { return item.milestones.some(function (m) { return m.id === milestoneId; }); });
        const milestone = project && project.milestones.find(function (m) { return m.id === milestoneId; });
        if (project && milestone) showMilestoneForm(project, milestone);
      });
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
    const allRisks = state.projects.flatMap(function (project) {
      return (project.risks || []).map(function (risk) {
        return Object.assign({}, risk, { project_name: project.name, project_code: project.code, project_id: project.id });
      });
    });
    const query = state.riskQuery.trim().toLowerCase();
    const filtered = allRisks.filter(function (risk) {
      const queryMatch = !query || [risk.title, risk.owner, risk.mitigation, risk.project_name, risk.project_code].join(" ").toLowerCase().includes(query);
      const statusMatch = state.riskFilter === "all" || (state.riskFilter === "active" ? risk.status !== "resolved" : risk.status === state.riskFilter);
      const levelMatch = state.riskLevel === "all" || risk.level === state.riskLevel;
      return queryMatch && statusMatch && levelMatch;
    });
    const active = allRisks.filter(function (risk) { return risk.status !== "resolved"; });
    const overdue = active.filter(function (risk) { return risk.overdue; });
    const high = active.filter(function (risk) { return risk.level === "high"; });
    const boardStatuses = [
      { key: "open", title: "待处理", desc: "刚登记，尚未进入跟进", icon: "circle-dot" },
      { key: "monitoring", title: "跟进中", desc: "已明确跟进动作", icon: "activity" },
      { key: "resolved", title: "已解决", desc: "已闭环归档", icon: "check-circle" }
    ];
    const board = boardStatuses.map(function (bucket) {
      const items = filtered.filter(function (risk) { return risk.status === bucket.key; });
      return '<section class="pm-risk-column ' + bucket.key + '"><header class="pm-risk-column-head"><div><span class="pm-risk-column-icon">' + UI.icon(bucket.icon) + '</span><div><h4>' + bucket.title + '</h4><p>' + bucket.desc + '</p></div></div><span class="pm-risk-count">' + items.length + '</span></header>' +
        '<div class="pm-risk-column-body">' + (items.length ? items.map(function (risk) {
          const overdueFlag = risk.overdue ? '<span class="pm-risk-overdue"><i></i>逾期</span>' : '';
          const dueText = risk.due_date ? shortDate(risk.due_date) : "未设置截止日";
          const action = risk.status === "open"
            ? '<button type="button" class="btn btn-sm btn-primary" data-risk-status="' + risk.id + '" data-next-status="monitoring">开始跟进</button>'
            : risk.status === "monitoring"
              ? '<button type="button" class="btn btn-sm btn-primary" data-risk-status="' + risk.id + '" data-next-status="resolved">标记已解决</button>'
              : '<button type="button" class="btn btn-sm" data-risk-status="' + risk.id + '" data-next-status="open">重新打开</button>';
          return '<article class="pm-risk-card ' + riskClass(risk.level) + '"><div class="pm-risk-card-top"><span class="pm-risk-level ' + riskClass(risk.level) + '">' + esc(riskLabels[risk.level] || risk.level) + '风险</span>' + overdueFlag + '</div>' +
            '<h5>' + esc(risk.title) + '</h5><div class="pm-risk-project"><span>' + esc(risk.project_code) + '</span><b>' + esc(risk.project_name) + '</b></div>' +
            '<p class="pm-risk-mitigation">' + esc(risk.mitigation || "尚未填写应对措施。建议明确下一步动作与完成标准。") + '</p>' +
            '<div class="pm-risk-card-meta"><span>' + UI.icon("user-round") + esc(risk.owner || "待指定") + '</span><span class="' + (risk.overdue ? "is-overdue" : "") + '">' + UI.icon("calendar") + dueText + '</span></div>' +
            '<footer class="pm-risk-card-foot"><span class="pm-risk-state-dot ' + bucket.key + '"></span><span>' + esc(riskStatus[risk.status] || risk.status) + '</span><span class="spacer"></span>' + action + '</footer></article>';
        }).join("") : '<div class="pm-risk-column-empty">' + (allRisks.length ? "此状态下暂无风险" : "尚未登记风险") + '</div>') + '</div></section>';
    }).join("");

    panel.innerHTML = '<section class="pm-view-header"><div><span class="pm-section-kicker">RISK / MITIGATION</span><h3>风险闭环工作台</h3><p>风险必须具备等级、责任人、截止日期与应对措施，并通过状态流转持续跟进。</p></div>' +
      '<div class="pm-view-actions"><select class="input" id="pmRiskCreateProject" aria-label="选择风险所属项目"><option value="">选择项目</option>' + state.projects.map(function (project) { return '<option value="' + project.id + '">' + esc(project.code + " · " + project.name) + '</option>'; }).join("") + '</select><button type="button" class="btn btn-primary" id="pmCreateRisk">' + UI.icon("plus") + ' 登记风险</button></div></section>' +
      '<section class="pm-mini-metrics">' +
        renderMiniMetric("未关闭风险", active.length, "待处理 + 跟进中", active.length ? "danger" : "good") +
        renderMiniMetric("逾期风险", overdue.length, "截止日期已过", overdue.length ? "danger" : "quiet") +
        renderMiniMetric("高等级风险", high.length, "需要优先评估", high.length ? "warning" : "quiet") +
        renderMiniMetric("已解决", allRisks.length - active.length, "已闭环风险", "good") +
      '</section>' +
      '<section class="pm-filter-panel pm-risk-filter"><div class="pm-search-wrap"><span>' + UI.icon("search") + '</span><input class="input" id="pmRiskSearch" placeholder="搜索风险事项、项目、责任人或措施" value="' + esc(state.riskQuery) + '"></div>' +
        '<div class="pm-filters"><select class="input" id="pmRiskStatusFilter" aria-label="风险状态筛选"><option value="active"' + (state.riskFilter === "active" ? " selected" : "") + '>全部未关闭</option><option value="all"' + (state.riskFilter === "all" ? " selected" : "") + '>全部状态</option><option value="open"' + (state.riskFilter === "open" ? " selected" : "") + '>待处理</option><option value="monitoring"' + (state.riskFilter === "monitoring" ? " selected" : "") + '>跟进中</option><option value="resolved"' + (state.riskFilter === "resolved" ? " selected" : "") + '>已解决</option></select>' +
          '<select class="input" id="pmRiskLevelFilter" aria-label="风险等级筛选"><option value="all"' + (state.riskLevel === "all" ? " selected" : "") + '>全部等级</option><option value="high"' + (state.riskLevel === "high" ? " selected" : "") + '>高风险</option><option value="medium"' + (state.riskLevel === "medium" ? " selected" : "") + '>中风险</option><option value="low"' + (state.riskLevel === "low" ? " selected" : "") + '>低风险</option></select>' +
          '<button type="button" class="btn" id="pmRiskApplyFilter">应用筛选</button>' +
        '</div></section>' +
      (state.projects.length ? '<section class="pm-risk-board">' + board + '</section>' : '<div class="pm-empty"><strong>还没有项目</strong><p>先建立项目，再登记与该项目相关的风险。</p><button type="button" class="btn btn-primary" id="pmRiskCreateFirstProject">新建项目</button></div>') +
      (state.projects.length && !filtered.length ? '<div class="pm-risk-empty-filter">没有符合当前筛选条件的风险记录。</div>' : '');

    panel.querySelector("#pmRiskApplyFilter").addEventListener("click", function () {
      state.riskQuery = panel.querySelector("#pmRiskSearch").value;
      state.riskFilter = panel.querySelector("#pmRiskStatusFilter").value;
      state.riskLevel = panel.querySelector("#pmRiskLevelFilter").value;
      renderRisks();
    });
    panel.querySelector("#pmRiskSearch").addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        state.riskQuery = panel.querySelector("#pmRiskSearch").value;
        state.riskFilter = panel.querySelector("#pmRiskStatusFilter").value;
        state.riskLevel = panel.querySelector("#pmRiskLevelFilter").value;
        renderRisks();
      }
    });
    panel.querySelector("#pmCreateRisk").addEventListener("click", function () {
      const projectId = Number(panel.querySelector("#pmRiskCreateProject").value || (state.projects[0] && state.projects[0].id));
      const project = state.projects.find(function (item) { return item.id === projectId; });
      if (!project) return UI.toast("请先建立项目，再登记项目风险。", "warn");
      showRiskForm(project);
    });
    const firstProject = panel.querySelector("#pmRiskCreateFirstProject");
    if (firstProject) firstProject.addEventListener("click", function () { showProjectForm(); });
    panel.querySelectorAll("[data-risk-status]").forEach(function (button) {
      button.addEventListener("click", async function () {
        await patchRisk(button.dataset.riskStatus, { status: button.dataset.nextStatus });
      });
    });
  }

  async function patchRisk(id, body) {
    try { await api.patch("/api/projects/risks/" + id, body); UI.toast("风险状态已更新", "success"); await refresh(); }
    catch (error) { UI.toast(error.message, "error"); }
  }

  function renderReport() {
    const panel = state.el.querySelector("#pmPanel");
    const stats = (state.summary && state.summary.stats) || {};
    const projects = state.projects || [];
    const gates = projects.flatMap(function (project) {
      return (project.milestones || []).map(function (milestone) { return Object.assign({}, milestone, { project_code: project.code, project_name: project.name }); });
    });
    const risks = projects.flatMap(function (project) {
      return (project.risks || []).map(function (risk) { return Object.assign({}, risk, { project_code: project.code, project_name: project.name }); });
    });
    const openRisks = risks.filter(function (risk) { return risk.status !== "resolved"; });
    const overdueRisks = openRisks.filter(function (risk) { return risk.overdue; });
    const overdueGates = gates.filter(function (milestone) { return gateVisualState(milestone) === "overdue"; });
    const nextGates = gates.filter(function (milestone) {
      return milestone.status === "pending" && milestone.planned_date >= todayISO();
    }).sort(function (a, b) { return String(a.planned_date).localeCompare(String(b.planned_date)); }).slice(0, 5);
    const atRiskProjects = projects.filter(function (project) { return project.status === "at_risk" || project.status === "blocked"; });
    const attentionHtml = overdueRisks.slice(0, 5).map(function (risk) {
      return '<div class="pm-report-attention-row"><span class="pm-attention-mark danger">!</span><div><strong>' + esc(risk.title) + '</strong><small>' + esc(risk.project_code + " · " + risk.project_name) + '　·　责任人 ' + esc(risk.owner || "待指定") + '</small></div><span class="pm-report-date danger">' + shortDate(risk.due_date) + '</span></div>';
    }).join("");
    const gateHtml = overdueGates.slice(0, 5).map(function (milestone) {
      return '<div class="pm-report-attention-row"><span class="pm-attention-mark warning">' + esc(gateOrder(milestone.gate)) + '</span><div><strong>' + esc(milestone.gate + " · " + milestone.title) + '</strong><small>' + esc(milestone.project_code + " · " + milestone.project_name) + '</small></div><span class="pm-report-date warning">' + shortDate(milestone.planned_date) + '</span></div>';
    }).join("");
    const upcomingHtml = nextGates.map(function (milestone) {
      return '<div class="pm-report-upcoming-row"><span class="pm-gate-chip">' + esc(milestone.gate) + '</span><div><strong>' + esc(milestone.title) + '</strong><small>' + esc(milestone.project_code + " · " + milestone.project_name) + '</small></div><time>' + shortDate(milestone.planned_date) + '</time></div>';
    }).join("");

    panel.innerHTML = '<section class="pm-view-header"><div><span class="pm-section-kicker">REPORT / PORTFOLIO HEALTH</span><h3>项目组合报告</h3><p>将当前门户本地试点数据汇总为风险、关口和项目进度报告。</p></div><button type="button" class="btn btn-primary" id="pmExportReport">' + UI.icon("download") + ' 导出 Markdown 周报</button></section>' +
      '<section class="pm-report-banner"><div><span class="pm-section-kicker">CURRENT PORTFOLIO SNAPSHOT</span><h3>交付健康度概览</h3><p>生成于 ' + esc(new Date().toLocaleString()) + ' · 仅包含当前可见的本地项目数据</p></div><div class="pm-report-banner-stats"><div><strong>' + (stats.total_projects || 0) + '</strong><span>项目</span></div><div><strong class="' + (openRisks.length ? "danger" : "") + '">' + openRisks.length + '</strong><span>未关闭风险</span></div><div><strong class="' + (overdueRisks.length + overdueGates.length ? "danger" : "") + '">' + (overdueRisks.length + overdueGates.length) + '</strong><span>逾期事项</span></div></div></section>' +
      '<section class="pm-report-grid">' +
        '<article class="pm-report-panel pm-report-projects"><header><div><h4>项目状态分布</h4><p>按项目当前状态统计</p></div><button type="button" class="pm-text-link" data-report-tab="portfolio">查看项目组合 ' + UI.icon("arrow-up-right") + '</button></header>' +
          (projects.length ? projects.map(function (project) {
            const cls = projectStatusClass(project.status);
            return '<div class="pm-report-project-row"><div class="pm-report-project-identity"><span class="pm-report-project-dot ' + cls + '"></span><div><strong>' + esc(project.name) + '</strong><small>' + esc(project.code) + ' · ' + esc(project.stage) + '</small></div></div><div class="pm-report-project-progress"><div><span>' + esc(statusLabel[project.status] || project.status) + '</span><strong>' + clampProgress(project.progress) + '%</strong></div><div class="pm-progress"><span style="width:' + clampProgress(project.progress) + '%"></span></div></div></div>';
          }).join("") : '<div class="pm-report-blank">尚未建立项目组合。</div>') +
        '</article>' +
        '<article class="pm-report-panel pm-report-attention"><header><div><h4>风险与逾期提醒</h4><p>先处理已经超期的交付事项</p></div><span class="pm-report-count ' + (overdueRisks.length + overdueGates.length ? "danger" : "") + '">' + (overdueRisks.length + overdueGates.length) + '</span></header>' +
          '<div class="pm-report-subhead">逾期风险</div>' + (attentionHtml || '<div class="pm-report-blank is-good">当前没有逾期风险。</div>') +
          '<div class="pm-report-subhead">逾期 DCP 关口</div>' + (gateHtml || '<div class="pm-report-blank is-good">当前没有逾期 DCP 关口。</div>') +
          '<button type="button" class="btn pm-report-full-link" data-report-tab="risks">进入风险闭环 ' + UI.icon("arrow-right") + '</button>' +
        '</article>' +
        '<article class="pm-report-panel pm-report-upcoming"><header><div><h4>近期 DCP 关口</h4><p>按计划日期排序的未来待评审事项</p></div><button type="button" class="pm-text-link" data-report-tab="gates">查看里程碑 ' + UI.icon("arrow-up-right") + '</button></header>' +
          (upcomingHtml || '<div class="pm-report-blank">未来 14 天暂无待评审 DCP。</div>') +
        '</article>' +
        '<article class="pm-report-panel pm-report-principles"><header><div><h4>数据边界说明</h4><p>导出前应当确认报告来源和口径</p></div></header>' +
          '<div class="pm-report-boundary"><span>' + UI.icon("database") + '</span><div><strong>当前数据源</strong><p>门户本地试点数据库。配置独立 PM 地址只代表入口跳转，不表示项目、DCP 与风险数据已自动同步。</p></div></div>' +
          '<div class="pm-report-boundary"><span>' + UI.icon("shield-check") + '</span><div><strong>状态口径</strong><p>项目进度为操作者维护值；风险逾期依据截止日期；DCP 是否可通过还受当前 DCP 顺序策略影响。</p></div></div>' +
        '</article>' +
      '</section>';
    panel.querySelector("#pmExportReport").addEventListener("click", exportReport);
    panel.querySelectorAll("[data-report-tab]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.tab = button.dataset.reportTab;
        renderActiveTab();
      });
    });
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

  function closePmModal(host) {
    if (host && host._pmModalKeyHandler) {
      document.removeEventListener("keydown", host._pmModalKeyHandler);
      host._pmModalKeyHandler = null;
    }
    if (host) host.innerHTML = "";
  }

  function bindPmModal(host, focusSelector) {
    const close = function () { closePmModal(host); };
    host._pmModalKeyHandler = function (event) {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", host._pmModalKeyHandler);
    host.querySelectorAll("[data-pm-close]").forEach(function (button) { button.addEventListener("click", close); });
    const backdrop = host.querySelector(".pm-modal-backdrop");
    if (backdrop) backdrop.addEventListener("click", function (event) { if (event.target === backdrop) close(); });
    const focus = focusSelector ? host.querySelector(focusSelector) : null;
    if (focus) focus.focus();
  }

  function showProjectDetail(project) {
    const host = document.getElementById("modalHost");
    const gates = orderedMilestones(project);
    const risks = (project.risks || []).filter(function (risk) { return risk.status !== "resolved"; });
    const passed = gates.filter(function (milestone) { return milestone.status === "passed"; }).length;
    host.innerHTML = '<div class="modal-mask pm-modal-backdrop"><section class="modal-box pm-detail-modal" role="dialog" aria-modal="true" aria-labelledby="pmDetailTitle">' +
      '<header class="pm-detail-head"><div><span class="pm-section-kicker">PROJECT RECORD / ' + esc(project.code) + '</span><h2 id="pmDetailTitle">' + esc(project.name) + '</h2><p>' + esc(project.product_line || "未设置产品线") + ' · 项目负责人 ' + esc(project.owner || "待指定") + '</p></div>' +
      '<button type="button" class="pm-icon-button" data-pm-close aria-label="关闭项目档案">×</button></header>' +
      '<div class="pm-detail-body"><div class="pm-detail-status-row">' + renderStatusPill(project.status, statusLabel[project.status] || project.status, projectStatusClass(project.status)) +
        '<span class="pm-detail-updated">最近更新 ' + shortDate((project.updated_at || "").slice(0, 10)) + '</span></div>' +
        '<div class="pm-detail-progress"><div><span>整体完成度</span><strong>' + clampProgress(project.progress) + '%</strong></div><div class="pm-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + clampProgress(project.progress) + '"><span style="width:' + clampProgress(project.progress) + '%"></span></div></div>' +
        stageTrack(project) +
        '<div class="pm-detail-stat-grid">' + renderMiniMetric("DCP 关口", passed + " / " + gates.length, "已通过 / 全部关口", "quiet") +
          renderMiniMetric("未关闭风险", risks.length, "待处理与跟进中", risks.length ? "danger" : "good") +
          renderMiniMetric("计划起止", shortDate(project.planned_start) + " — " + shortDate(project.planned_end), "项目计划窗口", "quiet") + '</div>' +
        '<section class="pm-detail-section"><header><h3>交付关口</h3><span>' + gates.length + ' 个里程碑</span></header>' +
          (gates.length ? '<div class="pm-detail-gates">' + gates.map(function (milestone) { return '<div><span class="pm-gate-chip">' + esc(milestone.gate) + '</span><span class="pm-detail-gate-name">' + esc(milestone.title) + '</span><span class="pm-detail-gate-date">' + shortDate(milestone.planned_date) + '</span>' + renderStatusPill(gateVisualState(milestone), gateVisualLabel(milestone), gateVisualState(milestone) === "passed" ? "good" : gateVisualState(milestone) === "blocked" || gateVisualState(milestone) === "overdue" ? "danger" : "muted") + '</div>'; }).join("") + '</div>' : '<p class="pm-detail-empty">尚未建立 DCP 计划。</p>') +
        '</section><section class="pm-detail-section"><header><h3>未关闭风险</h3><span>' + risks.length + ' 项</span></header>' +
          (risks.length ? '<div class="pm-detail-risks">' + risks.slice(0, 5).map(function (risk) { return '<div><span class="pm-risk-level ' + riskClass(risk.level) + '">' + esc(riskLabels[risk.level] || risk.level) + '</span><span class="pm-detail-risk-title">' + esc(risk.title) + '</span><span class="' + (risk.overdue ? "is-overdue" : "") + '">' + shortDate(risk.due_date) + '</span></div>'; }).join("") + '</div>' : '<p class="pm-detail-empty">当前没有未关闭风险。</p>') +
        '</section><section class="pm-detail-section"><header><h3>项目说明</h3></header><p class="pm-detail-description">' + esc(project.description || "暂无项目说明。") + '</p></section>' +
      '</div><footer class="pm-detail-foot"><button type="button" class="btn" data-pm-close>关闭</button><button type="button" class="btn" data-detail-gate>新增 DCP</button><button type="button" class="btn" data-detail-risk>登记风险</button><button type="button" class="btn btn-primary" data-detail-edit>编辑项目</button></footer></section></div>';
    const close = function () {
      host.innerHTML = "";
      document.removeEventListener("keydown", onKeydown);
    };
    const onKeydown = function (event) { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKeydown);
    host.querySelectorAll("[data-pm-close]").forEach(function (button) { button.addEventListener("click", close); });
    host.querySelector(".pm-modal-backdrop").addEventListener("click", function (event) { if (event.target === this) close(); });
    host.querySelector("[data-detail-edit]").addEventListener("click", function () { close(); showProjectForm(project); });
    host.querySelector("[data-detail-gate]").addEventListener("click", function () { close(); showMilestoneForm(project); });
    host.querySelector("[data-detail-risk]").addEventListener("click", function () { close(); showRiskForm(project); });
    const closeButton = host.querySelector("[data-pm-close]");
    if (closeButton) closeButton.focus();
  }

  function showProjectForm(project) {
    const editing = !!project;
    const host = document.getElementById("modalHost");
    const modalHtml = '<div class="modal-mask pm-modal-backdrop"><section class="modal-box pm-form-modal" role="dialog" aria-modal="true" aria-labelledby="pmProjectFormTitle">' +
      '<header class="pm-form-head"><div><span class="pm-section-kicker">PROJECT RECORD / SETUP</span><h2 id="pmProjectFormTitle">' + (editing ? "编辑项目档案" : "创建项目") + '</h2><p>维护项目阶段、责任人与计划日期。进度为项目负责人维护值。</p></div><button type="button" class="pm-icon-button" data-pm-close aria-label="关闭">×</button></header>' +
      '<div class="modal-body"><div class="pm-form-grid">' +
      '<div class="form-group"><label class="form-label" for="pfCode">项目编号 <span class="required">*</span></label><input class="input" id="pfCode" ' + (editing ? "disabled" : "") + ' value="' + esc(project ? project.code : "") + '" placeholder="如 PRJ-2026-01" maxlength="32" autocomplete="off"></div>' +
      '<div class="form-group"><label class="form-label" for="pfName">项目名称 <span class="required">*</span></label><input class="input" id="pfName" value="' + esc(project ? project.name : "") + '" placeholder="输入项目名称" maxlength="160"></div>' +
      '<div class="form-group"><label class="form-label" for="pfLine">产品线</label><input class="input" id="pfLine" value="' + esc(project ? project.product_line : "") + '" placeholder="如：净水产品 / 智能家电" maxlength="100"></div>' +
      '<div class="form-group"><label class="form-label" for="pfOwner">项目负责人</label><input class="input" id="pfOwner" value="' + esc(project ? project.owner : "待指定") + '" placeholder="指定责任人" maxlength="80"></div>' +
      '<div class="form-group"><label class="form-label" for="pfStage">当前阶段</label><select class="input" id="pfStage">' + stageLabels.map(function (item) { return '<option' + (project && project.stage === item ? " selected" : "") + '>' + esc(item) + '</option>'; }).join("") + '</select></div>' +
      '<div class="form-group"><label class="form-label" for="pfStatus">项目状态</label><select class="input" id="pfStatus">' + Object.keys(statusLabel).map(function (key) { return '<option value="' + key + '"' + (project && project.status === key ? " selected" : (!project && key === "normal" ? " selected" : "")) + '>' + esc(statusLabel[key]) + '</option>'; }).join("") + '</select></div>' +
      '<div class="form-group"><label class="form-label" for="pfStart">计划开始日期</label><input class="input" type="date" id="pfStart" value="' + esc(project ? project.planned_start || "" : "") + '"></div>' +
      '<div class="form-group"><label class="form-label" for="pfEnd">计划结束日期</label><input class="input" type="date" id="pfEnd" value="' + esc(project ? project.planned_end || "" : "") + '"></div>' +
      '<div class="form-group pm-form-full"><div class="pm-progress-field-label"><label class="form-label" for="pfProgress">当前项目进度</label><span>0–100%</span></div><input class="input" type="number" min="0" max="100" step="1" id="pfProgress" value="' + clampProgress(project ? project.progress : 0) + '"></div>' +
      '<div class="form-group pm-form-full"><label class="form-label" for="pfDescription">项目说明</label><textarea class="input" rows="3" id="pfDescription" maxlength="2000" placeholder="说明项目目标、范围或关键依赖">' + esc(project ? project.description || "" : "") + '</textarea></div>' +
      '</div><div class="pm-form-footnote"><span>' + UI.icon("database") + '</span><p>当前维护的是门户本地试点数据，不会自动同步到独立项目管理系统。</p></div></div>' +
      '<footer class="modal-foot"><button type="button" class="btn" data-pm-close>取消</button><button type="button" class="btn btn-primary" id="pfSave">' + (editing ? "保存修改" : "创建项目") + '</button></footer></section></div>';
    host.innerHTML = modalHtml;
    bindPmModal(host, "#pfName");
    host.querySelector("#pfSave").addEventListener("click", async function () {
      const name = host.querySelector("#pfName").value.trim();
      const code = host.querySelector("#pfCode").value.trim();
      const start = host.querySelector("#pfStart").value || null;
      const end = host.querySelector("#pfEnd").value || null;
      const progressValue = host.querySelector("#pfProgress").value;
      const progress = progressValue === "" ? 0 : Number(progressValue);
      if (!editing && !/^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$/.test(code)) {
        return UI.toast("项目编号需为 2–32 位英文字母、数字、下划线或连字符。", "warn");
      }
      if (name.length < 2) return UI.toast("项目名称至少需要 2 个字符。", "warn");
      if (start && end && end < start) return UI.toast("计划结束日期不能早于开始日期。", "warn");
      if (!Number.isInteger(progress) || progress < 0 || progress > 100) return UI.toast("项目进度请输入 0 到 100 之间的整数。", "warn");
      const payload = {
        name: name,
        product_line: host.querySelector("#pfLine").value.trim(),
        owner: host.querySelector("#pfOwner").value.trim() || "待指定",
        stage: host.querySelector("#pfStage").value,
        status: host.querySelector("#pfStatus").value,
        planned_start: start,
        planned_end: end,
        progress: progress,
        description: host.querySelector("#pfDescription").value.trim()
      };
      if (!editing) payload.code = code;
      const save = host.querySelector("#pfSave");
      save.disabled = true;
      save.textContent = editing ? "保存中…" : "创建中…";
      try {
        await (editing ? api.patch("/api/projects/" + project.id, payload) : api.post("/api/projects", payload));
        closePmModal(host);
        UI.toast(editing ? "项目档案已更新" : "项目已创建", "success");
        await refresh();
      } catch (error) {
        UI.toast(error.message, "error");
      } finally {
        if (host.querySelector("#pfSave")) {
          save.disabled = false;
          save.textContent = editing ? "保存修改" : "创建项目";
        }
      }
    });
  }

  function showMilestoneForm(project, milestone) {
    const editing = !!milestone;
    const host = document.getElementById("modalHost");
    const gates = ["DCP0","DCP1","DCP2","DCP3","DCP4","DCP5"];
    host.innerHTML = '<div class="modal-mask pm-modal-backdrop"><section class="modal-box pm-form-modal" role="dialog" aria-modal="true" aria-labelledby="pmGateFormTitle">' +
      '<header class="pm-form-head"><div><span class="pm-section-kicker">DCP / GATE CONTROL</span><h2 id="pmGateFormTitle">' + (editing ? "编辑 DCP 关口" : "新增 DCP 里程碑") + '</h2><p>维护该项目的关口名称、计划日期、责任人与评审备注。</p></div><button type="button" class="pm-icon-button" data-pm-close aria-label="关闭">×</button></header>' +
      '<div class="modal-body"><div class="pm-linked-project"><span class="pm-linked-project-code">' + esc(project.code) + '</span><strong>' + esc(project.name) + '</strong><span>' + esc(project.stage) + '阶段</span></div>' +
      '<div class="pm-form-grid"><div class="form-group"><label class="form-label" for="mfGate">DCP 关口</label><select class="input" id="mfGate">' + gates.map(function (gate) { return '<option value="' + gate + '"' + (milestone && milestone.gate === gate ? " selected" : "") + '>' + gate + '</option>'; }).join("") + '</select></div>' +
      '<div class="form-group"><label class="form-label" for="mfTitle">里程碑名称 <span class="required">*</span></label><input class="input" id="mfTitle" maxlength="160" placeholder="例如：样机验证评审" value="' + esc(milestone ? milestone.title : "") + '"></div>' +
      '<div class="form-group"><label class="form-label" for="mfDate">计划日期 <span class="required">*</span></label><input class="input" type="date" id="mfDate" required value="' + esc(milestone ? milestone.planned_date : "") + '"></div>' +
      '<div class="form-group"><label class="form-label" for="mfOwner">关口负责人</label><input class="input" id="mfOwner" value="' + esc(milestone ? milestone.owner : "待指定") + '" maxlength="80"></div>' +
      '<div class="form-group pm-form-full"><label class="form-label" for="mfNotes">评审备注 / 通过条件</label><textarea class="input" rows="3" id="mfNotes" maxlength="2000" placeholder="补充评审条件、交付物或需要确认的事项">' + esc(milestone ? milestone.notes : "") + '</textarea></div></div>' +
      '<div class="pm-form-footnote"><span>' + UI.icon("shield-check") + '</span><p>标记为“已通过”时，系统会记录实际完成日期；当前配置的 DCP 顺序策略可能要求先通过前置关口。</p></div></div>' +
      '<footer class="modal-foot"><button type="button" class="btn" data-pm-close>取消</button><button type="button" class="btn btn-primary" id="mfSave">' + (editing ? "保存关口" : "创建关口") + '</button></footer></section></div>';
    bindPmModal(host, "#mfTitle");
    host.querySelector("#mfSave").addEventListener("click", async function () {
      const titleText = host.querySelector("#mfTitle").value.trim();
      const dateText = host.querySelector("#mfDate").value;
      if (titleText.length < 2 || !dateText) return UI.toast("请填写至少 2 个字符的里程碑名称和计划日期。", "warn");
      const payload = {
        gate: host.querySelector("#mfGate").value,
        title: titleText,
        planned_date: dateText,
        owner: host.querySelector("#mfOwner").value.trim() || "待指定",
        notes: host.querySelector("#mfNotes").value.trim()
      };
      const save = host.querySelector("#mfSave");
      save.disabled = true;
      save.textContent = "保存中…";
      try {
        await (editing ? api.patch("/api/projects/milestones/" + milestone.id, payload) : api.post("/api/projects/" + project.id + "/milestones", payload));
        closePmModal(host);
        UI.toast(editing ? "DCP 关口已更新" : "DCP 里程碑已创建", "success");
        state.tab = "gates";
        await refresh();
      } catch (error) {
        UI.toast(error.message, "error");
      } finally {
        if (host.querySelector("#mfSave")) {
          save.disabled = false;
          save.textContent = editing ? "保存关口" : "创建关口";
        }
      }
    });
  }

  function showRiskForm(project) {
    const host = document.getElementById("modalHost");
    host.innerHTML = '<div class="modal-mask pm-modal-backdrop"><section class="modal-box pm-form-modal" role="dialog" aria-modal="true" aria-labelledby="pmRiskFormTitle">' +
      '<header class="pm-form-head"><div><span class="pm-section-kicker">RISK / MITIGATION</span><h2 id="pmRiskFormTitle">登记项目风险</h2><p>请明确风险等级、责任人与截止日期，避免仅留下问题描述而没有下一步措施。</p></div><button type="button" class="pm-icon-button" data-pm-close aria-label="关闭">×</button></header>' +
      '<div class="modal-body"><div class="pm-linked-project"><span class="pm-linked-project-code">' + esc(project.code) + '</span><strong>' + esc(project.name) + '</strong><span>' + esc(project.stage) + '阶段</span></div>' +
      '<div class="form-group"><label class="form-label" for="rfTitle">风险事项 <span class="required">*</span></label><input class="input" id="rfTitle" maxlength="240" placeholder="描述可能影响交付、质量或成本的风险"></div>' +
      '<div class="pm-form-grid"><div class="form-group"><label class="form-label" for="rfLevel">风险等级</label><select class="input" id="rfLevel"><option value="high">高风险</option><option value="medium" selected>中风险</option><option value="low">低风险</option></select></div>' +
      '<div class="form-group"><label class="form-label" for="rfOwner">责任人</label><input class="input" id="rfOwner" value="待指定" maxlength="80" placeholder="明确跟进责任人"></div>' +
      '<div class="form-group"><label class="form-label" for="rfDate">跟进截止日期</label><input class="input" type="date" id="rfDate"></div>' +
      '<div class="form-group pm-form-full"><label class="form-label" for="rfMitigation">应对措施 / 下一步动作</label><textarea class="input" rows="4" id="rfMitigation" maxlength="3000" placeholder="写清缓解措施、依赖条件、下一步动作与完成标准"></textarea></div></div>' +
      '<div class="pm-form-footnote"><span>' + UI.icon("target") + '</span><p>风险创建后进入“待处理”状态，可进一步转入跟进中，或在确认解决后关闭。</p></div></div>' +
      '<footer class="modal-foot"><button type="button" class="btn" data-pm-close>取消</button><button type="button" class="btn btn-primary" id="rfSave">保存风险</button></footer></section></div>';
    bindPmModal(host, "#rfTitle");
    host.querySelector("#rfSave").addEventListener("click", async function () {
      const titleText = host.querySelector("#rfTitle").value.trim();
      if (titleText.length < 2) return UI.toast("风险事项至少需要 2 个字符。", "warn");
      const payload = {
        title: titleText,
        level: host.querySelector("#rfLevel").value,
        owner: host.querySelector("#rfOwner").value.trim() || "待指定",
        due_date: host.querySelector("#rfDate").value || null,
        mitigation: host.querySelector("#rfMitigation").value.trim()
      };
      const save = host.querySelector("#rfSave");
      save.disabled = true;
      save.textContent = "保存中…";
      try {
        await api.post("/api/projects/" + project.id + "/risks", payload);
        closePmModal(host);
        UI.toast("风险已登记", "success");
        state.tab = "risks";
        await refresh();
      } catch (error) {
        UI.toast(error.message, "error");
      } finally {
        if (host.querySelector("#rfSave")) {
          save.disabled = false;
          save.textContent = "保存风险";
        }
      }
    });
  }

  return { title: title, render: render };
})();
