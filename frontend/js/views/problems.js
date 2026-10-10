// 问题与经验应用：问题管理首页 + Excel 导入向导 + 问题台账 + 导入批次历史
window.Views = window.Views || {};

window.Views.problems = (function () {
  const SEV_OK = { A: 1, B: 1, C: 1, "严重": 1, "一般": 1, "轻微": 1, 高: 1, 中: 1, 低: 1 };
  const DATE_RE = [
    /^\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2}$/,
    /^\d{4}年\d{1,2}月\d{1,2}日?$/,
  ];
  const FIELD_ORDER = [
    "description", "category", "dept", "model", "severity", "owner",
    "submitter", "due_date", "countermeasure", "result", "source", "stage",
  ];

  const state = {
    tab: "overview",
    batchId: null,
    sheets: [],
    preview: null,
    onlyErrors: false,
    lastResult: null,
  };

  function isBlank(v) {
    return v === null || v === undefined || ["/", "\\", "-", "--", "—", "无", ""].includes(String(v).trim());
  }

  function rowIssues(row) {
    const v = row.values || {};
    const issues = [];
    if (isBlank(v.description)) {
      issues.push({ field: "description", level: "error", message: "必填项「问题描述」为空" });
    }
    if (!isBlank(v.severity) && !SEV_OK[String(v.severity).trim().toUpperCase()] && !SEV_OK[String(v.severity).trim()]) {
      issues.push({ field: "severity", level: "error", message: "严重度须为 A-严重 / B-一般 / C-轻微" });
    }
    if (!isBlank(v.due_date) && !DATE_RE.some((re) => re.test(String(v.due_date).trim()))) {
      issues.push({ field: "due_date", level: "warning", message: "日期格式无法识别（如 2026-09-01），入库时将置空" });
    }
    return issues;
  }

  function refreshRow(row, tr) {
    const issues = rowIssues(row);
    row._issues = issues;
    tr.classList.toggle("row-excluded", !!row.excluded);
    tr.querySelectorAll("td.cell").forEach((td) => {
      const field = td.dataset.field;
      const hit = issues.find((i) => i.field === field);
      td.classList.remove("cell-err", "cell-warn");
      const mini = td.querySelector(".issue-mini");
      if (mini) mini.remove();
      if (hit && !row.excluded) {
        td.classList.add(hit.level === "error" ? "cell-err" : "cell-warn");
        const d = document.createElement("div");
        d.className = "issue-mini" + (hit.level === "warning" ? " warn" : "");
        d.textContent = hit.message;
        td.appendChild(d);
      }
    });
  }

  const title = "问题与经验";

  async function render(el, param) {
    el.innerHTML =
      '<section class="experience-shell">' +
      '<div class="experience-masthead"><div><span class="module-kicker">QUALITY EXPERIENCE · PILOT</span><h2>问题经验工作台</h2><p>从 Excel 智能导入到问题台账，以规则校验确保每一条记录可追溯。</p></div><div class="experience-mark">' + UI.icon("problems") + '<span>规则驱动<br><b>可审计</b></span></div></div>' +
      '<div class="experience-tabs" id="pTabs" role="tablist" aria-label="问题经验视图">' +
      '<button type="button" role="tab" aria-selected="false" class="tab" data-tab="overview">问题管理概览</button>' +
      '<button type="button" role="tab" aria-selected="false" class="tab" data-tab="import">Excel 智能导入</button>' +
      '<button type="button" role="tab" aria-selected="false" class="tab" data-tab="records">问题台账</button>' +
      '<button type="button" role="tab" aria-selected="false" class="tab" data-tab="history">导入历史批次</button></div>' +
      '<div id="pBody"></div></section>';

    el.querySelectorAll("#pTabs .tab").forEach((tab) => {
      tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    });

    if (param && ["overview", "import", "records", "history"].includes(param)) {
      state.tab = param;
    }
    switchTab(state.tab);
  }

  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll("#pTabs .tab").forEach((t) => {
      const selected = t.dataset.tab === tab;
      t.classList.toggle("active", selected);
      t.setAttribute("aria-selected", String(selected));
    });
    const body = document.querySelector("#pBody");
    if (!body) return;
    
    if (tab === "overview") renderOverview(body);
    else if (tab === "import") renderImport(body);
    else if (tab === "records") renderRecords(body);
    else renderHistory(body);
  }

  /* ---------------- 1. 问题管理首页 (Overview) ---------------- */

  async function renderOverview(body) {
    body.innerHTML = '<div class="empty">加载模块概览数据…</div>';
    let recordsData = { total: 0, items: [] };
    let historyData = { items: [] };
    try {
      recordsData = await api.get("/api/records?page=1&page_size=5");
      historyData = await api.get("/api/imports");
    } catch (e) {}

    const totalIssues = recordsData.total || 0;
    const totalBatches = historyData.items ? historyData.items.length : 0;
    const aCount = (recordsData.items || []).filter(r => r.severity === 'A').length;

    const quickActions =
      '<div class="experience-actions">' +
      '<button class="btn btn-primary" id="goImportBtn">' + UI.icon("upload") + ' <span style="margin-left:4px;">开始 Excel 智能导入</span></button>' +
      '<button class="btn" id="goRecordsBtn">' + UI.icon("records") + ' <span style="margin-left:4px;">查询问题台账库</span></button>' +
      '<button class="btn" id="goHistoryBtn">' + UI.icon("history") + ' <span style="margin-left:4px;">查看导入批次记录</span></button>' +
      '</div>';

    const recentRecordsHtml = (recordsData.items || []).map((r) =>
      '<tr><td><code>#' + r.batch_id + '</code></td>' +
      '<td style="font-weight:600; color:var(--text-1);">' + UI.esc(r.description) + '</td>' +
      '<td>' + UI.esc(r.category || '-') + '</td>' +
      '<td><span class="badge ' + (r.severity === 'A' ? 'badge-red' : r.severity === 'B' ? 'badge-amber' : 'badge-green') + '">' + UI.esc(r.severity || '-') + '</span></td>' +
      '<td>' + UI.esc(r.owner || '-') + '</td>' +
      '<td><button class="btn btn-sm view-rec-btn" data-id="' + r.id + '">查看明细</button></td></tr>'
    ).join("");

    body.innerHTML =
      '<div class="experience-metrics">' +
      '<div class="experience-metric metric-records"><div class="stat-label">问题库总记录 <span class="badge badge-green">测试环境</span></div><div class="stat-value">' + totalIssues + '<span class="unit">条</span></div><small>已确认写入的本地记录</small></div>' +
      '<div class="experience-metric metric-risk"><div class="stat-label">A 类严重问题</div><div class="stat-value">' + aCount + '<span class="unit">条</span></div><small>当前页数据中的严重等级</small></div>' +
      '<div class="experience-metric metric-batch"><div class="stat-label">导入批次</div><div class="stat-value">' + totalBatches + '<span class="unit">次</span></div><small>已保存的导入处理批次</small></div>' +
      '<div class="experience-metric metric-rule"><div class="stat-label">规则校验</div><div class="stat-value">规则<span class="unit">引擎</span></div><small>字段映射与校验可人工复核</small></div>' +
      '</div>' +

      '<div class="card experience-action-card"><div class="card-title">' + UI.icon("plus") + ' <span style="margin-left:6px;">问题与经验快捷业务流转</span></div>' +
      quickActions + '</div>' +

      '<div class="card experience-record-card"><div class="card-title">' + UI.icon("records") + ' <span style="margin-left:6px;">最新写入问题库台账记录</span></div>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>批次</th><th>问题描述</th><th>分类</th><th>严重度</th><th>负责人</th><th>操作</th></tr></thead>' +
      '<tbody>' + (recentRecordsHtml || '<tr><td colspan="6" class="empty">暂无数据</td></tr>') + '</tbody></table></div></div>';

    body.querySelector("#goImportBtn").addEventListener("click", () => switchTab("import"));
    body.querySelector("#goRecordsBtn").addEventListener("click", () => switchTab("records"));
    body.querySelector("#goHistoryBtn").addEventListener("click", () => switchTab("history"));

    body.querySelectorAll(".view-rec-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = (recordsData.items || []).find(x => String(x.id) === btn.dataset.id);
        if (item) showRecordDetail(item);
      });
    });
  }

  /* ---------------- 2. Excel 智能导入向导 ---------------- */

  function renderImport(body) {
    if (state.lastResult) return renderResult(body, state.lastResult);
    if (state.preview) return renderWizard(body);
    body.innerHTML =
      '<div class="steps">' + step(1, "上传 Excel 文件", "active") + line() + step(2, "智能字段映射") + line() +
      step(3, "数据校验与预览修正") + line() + step(4, "确认入库") + "</div>" +
      '<div class="card"><div class="card-title">' + UI.icon("upload") + ' <span style="margin-left:6px;">选择 / 拖拽问题点 Excel 文件</span></div>' +
      '<div class="uploader" id="uploader"><div class="up-ico">' + UI.icon("file") + '</div><div style="font-size:15px; font-weight:600; color:var(--text-1); margin-bottom:4px;">点击选择文件，或将 .xlsx 文件拖拽到此处</div>' +
      '<div class="up-hint">仅支持标准 .xlsx 格式文件，上限 20MB；表头列顺序与名称不限制，规则引擎将自动智能匹配</div></div>' +
      '<input type="file" id="fileInput" accept=".xlsx" style="display:none">' +
      '<div style="margin-top:16px; padding:12px 16px; background:var(--primary-soft); border:1px solid var(--primary-border); border-radius:var(--radius-sm);" class="muted">' +
      '💡 <b>测试数据提示：</b>若没有测试文件，可下载标准测试样本：<a href="/samples/问题导入演示样本.xlsx" download style="color:var(--primary); font-weight:600;">下载问题导入标准测试样本.xlsx</a> ' +
      '（包含正常数据行、缺必填行、非标准严重度、异化日期格式及同义词表头，支持验证完整校验流程）</div>' +
      '<div class="section-gap"><div class="card-title">自动识别字段规则体系</div>' +
      '<div style="display:flex; flex-wrap:wrap; gap:8px;">' +
      '<span class="chip" style="background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe;">问题描述（必填）</span>' +
      '<span class="chip">问题分类</span><span class="chip">责任部门</span>' +
      '<span class="chip">机型</span><span class="chip">严重度 (A/B/C)</span><span class="chip">负责人</span>' +
      '<span class="chip">提出人</span><span class="chip">计划完成日期</span><span class="chip">改善对策</span>' +
      '<span class="chip">改善结果</span><span class="chip">问题来源</span><span class="chip">阶段</span></div>' +
      '<div class="muted" style="margin-top:10px; line-height:1.5;">精准词与同义词自动映射；置信度不足时打上“待确认”标识由用户人工指定；未识别列不会静默写入。</div>' +
      "</div></div>";

    const uploader = body.querySelector("#uploader");
    const input = body.querySelector("#fileInput");
    uploader.addEventListener("click", () => input.click());
    input.addEventListener("change", () => input.files[0] && doUpload(input.files[0]));
    ["dragover", "dragenter"].forEach((ev) =>
      uploader.addEventListener(ev, (e) => { e.preventDefault(); uploader.classList.add("dragover"); }));
    ["dragleave", "drop"].forEach((ev) =>
      uploader.addEventListener(ev, (e) => { e.preventDefault(); uploader.classList.remove("dragover"); }));
    uploader.addEventListener("drop", (e) => {
      const f = e.dataTransfer.files[0];
      if (f) doUpload(f);
    });
  }

  async function doUpload(file) {
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      UI.toast("仅支持上传 .xlsx 文件", "error");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    UI.toast("正在解析 Excel 文件内容并匹配字段…");
    try {
      const resp = await api.upload("/api/imports/upload", fd);
      state.batchId = resp.batch_id;
      state.sheets = resp.sheets;
      state.preview = resp.preview;
      state.lastResult = null;
      UI.toast("文件解析完成，请核对字段映射与数据明细", "success");
      renderWizard(document.querySelector("#pBody"));
    } catch (e) {
      UI.toast(e.message, "error");
    }
  }

  function step(n, text, cls) {
    return '<div class="step ' + (cls || "") + '"><div class="step-num">' + (cls === "done" ? "✓" : n) + "</div><span>" + text + "</span></div>";
  }
  function line() { return '<div class="step-line"></div>'; }

  function renderWizard(body) {
    const p = state.preview;
    const labels = p.field_labels || {};
    const mappedFields = new Set(p.columns.filter((c) => c.field).map((c) => c.field));
    const pendingCols = p.columns.filter((c) => c.level === "medium");
    const unmappedCols = p.columns.filter((c) => !c.field && c.raw_header.trim());

    const stepsHtml =
      '<div class="steps">' + step(1, "上传 Excel 文件", "done") + line() + step(2, "智能字段映射", "active") + line() +
      step(3, "数据校验与预览修正", "active") + line() + step(4, "确认入库") + "</div>";

    const sheetsHtml = state.sheets.map((s) =>
      '<span class="chip ' + (s.name === p.sheet_name ? "badge-blue" : "") + '" style="cursor:pointer; padding:6px 12px;" data-sheet="' +
      UI.esc(s.name) + '">📄 ' + UI.esc(s.name) + "（" + s.data_rows + " 行）" +
      (s.recommended ? ' <b style="color:var(--success-dark)">[推荐]</b>' : "") +
      (s.matched_count < 3 ? ' <span class="muted">未识别为问题表</span>' : "") + "</span>"
    ).join("");

    const mapRows = p.columns.map((c) => {
      const confText = c.field
        ? (c.level === "high" ? '<span class="badge badge-green conf-high"><span class="conf-dot"></span>高置信匹配</span>'
          : '<span class="badge badge-amber conf-medium"><span class="conf-dot"></span>待人工确认</span>')
        : '<span class="badge badge-gray conf-none"><span class="conf-dot"></span>未映射（忽略）</span>';
      return '<tr><td style="min-width:180px; font-weight:600; color:var(--text-1);">' + UI.esc(c.raw_header || "（空表头）") + "</td><td style='color:var(--text-muted);'>→</td><td>" +
        '<select class="input col-select" data-col="' + c.index + '">' +
        FIELD_ORDER.map((f) =>
          '<option value="' + f + '"' + (c.field === f ? " selected" : "") + ">" + UI.esc(labels[f] || f) + "</option>").join("") +
        '<option value=""' + (!c.field ? " selected" : "") + ">不映射（忽略该列）</option></select></td>" +
        '<td>' + confText + (c.downgraded ? ' <span class="muted">（重复字段已保留首选列）</span>' : "") +
        (c.source === "manual" ? ' <span class="badge badge-purple">人工修改</span>' : "") + "</td></tr>";
    }).join("");

    const visibleFields = FIELD_ORDER.filter((f) => mappedFields.has(f));
    const rows = p.rows || [];
    const errorCount = rows.filter((r) => rowIssues(r).some((i) => i.level === "error") && !r.excluded).length;

    const truncationWarning = p.truncated
      ? '<div class="notice notice-warning" role="alert" style="margin:12px 0;padding:14px 16px;border:1px solid var(--warning,#d97706);border-radius:10px;background:var(--warning-bg,#fff7ed);color:var(--text-1);">' +
        '<strong>已达到预览行数上限，禁止确认导入</strong><div style="margin-top:6px;">' + UI.esc(p.truncation_warning || "当前工作表可能只读取了部分行。请拆分 Excel 后重新上传，不能把部分数据当作全量导入。") + '</div></div>'
      : "";

    body.innerHTML = stepsHtml +
      truncationWarning +
      '<div class="card" style="margin-bottom:18px;"><div class="card-title">① 选择 Excel 工作表</div>' + sheetsHtml + "</div>" +
      '<div class="card" style="margin-bottom:18px;"><div class="card-title">② 字段映射表（智能解析结果）' +
      (pendingCols.length ? ' <span class="badge badge-amber">' + pendingCols.length + " 列待确认</span>" : "") +
      (unmappedCols.length ? ' <span class="badge badge-gray">' + unmappedCols.length + " 列未映射</span>" : "") +
      "</div>" +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>Excel 原始表头</th><th></th><th>映射目标库字段</th><th>置信度与状态</th></tr></thead>' +
      '<tbody>' + mapRows + "</tbody></table></div></div>" +
      '<div class="card"><div class="card-title">③ 数据校验与在线预览修正' +
      '<span class="spacer"></span></div>' +
      '<div class="toolbar"><span class="badge badge-gray" style="font-size:12.5px;">总解析 ' + rows.length + " 行</span>" +
      '<span class="badge badge-red" style="font-size:12.5px;">错误行 ' + errorCount + "</span>" +
      '<label class="muted" style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;font-weight:500;">' +
      '<input type="checkbox" id="onlyErrors"> 仅高亮展示有问题的行</label>' +
      '<span class="spacer"></span>' +
      '<button class="btn" id="resetBtn">重新选择文件</button>' +
      '<button class="btn btn-primary" id="confirmBtn">确认提交入库（错误行将被自动拦截）</button></div>' +
      renderPreviewTable(rows, visibleFields) +
      '<div class="muted" style="margin-top:12px; line-height:1.5;">💡 提示：红色背景表示有必填项缺失或规则冲突，必须修正后方可入库；勾选“剔除”将主动放弃该行；单元格可直接点击内联编辑修正。</div>' +
      "</div>";

    body.querySelectorAll("[data-sheet]").forEach((chip) => {
      chip.addEventListener("click", () => reloadPreview({ sheet_name: chip.dataset.sheet }));
    });

    body.querySelectorAll(".col-select").forEach((sel) => {
      sel.addEventListener("change", () => {
        const overrides = {};
        body.querySelectorAll(".col-select").forEach((s) => { overrides[s.dataset.col] = s.value || null; });
        reloadPreview({ overrides });
      });
    });

    bindPreviewTable(body, rows, visibleFields);
    body.querySelector("#onlyErrors").checked = state.onlyErrors;
    applyRowFilter(body);
    body.querySelector("#onlyErrors").addEventListener("change", (e) => {
      state.onlyErrors = e.target.checked;
      applyRowFilter(body);
    });

    body.querySelector("#resetBtn").addEventListener("click", async () => {
      if (!(await UI.confirm("重新上传", "放弃当前批次的预览与修改，重新选择文件？"))) return;
      state.batchId = null; state.sheets = []; state.preview = null; state.lastResult = null;
      renderImport(body);
    });
    const confirmButton = body.querySelector("#confirmBtn");
    if (confirmButton && p.truncated) {
      confirmButton.disabled = true;
      confirmButton.title = "工作表超过预览上限，请拆分文件后重新上传";
      confirmButton.textContent = "已超预览上限，禁止导入";
    }
    if (confirmButton && !p.truncated) confirmButton.addEventListener("click", () => doConfirm(body, rows));
  }

  function renderPreviewTable(rows, fields) {
    const head = "<tr><th style='width:40px;'>行号</th><th style='width:50px; text-align:center;'>剔除</th>" +
      fields.map((f) => '<th data-th="' + f + '">' + fieldLabel(f) + "</th>").join("") + "</tr>";
    const bodyHtml = rows.map((r) => {
      const issues = rowIssues(r);
      const errFields = new Set(issues.filter((i) => i.level === "error").map((i) => i.field));
      const warnFields = new Set(issues.filter((i) => i.level === "warning").map((i) => i.field));
      const tds = fields.map((f) => {
        const cls = errFields.has(f) ? "cell-err" : warnFields.has(f) ? "cell-warn" : "";
        const val = r.values && r.values[f] !== null && r.values[f] !== undefined ? r.values[f] : "";
        const issue = issues.find((i) => i.field === f);
        return '<td class="cell ' + cls + '" data-field="' + f + '">' +
          '<input class="cell-input" value="' + UI.esc(val) + '">' +
          (issue ? '<div class="issue-mini' + (issue.level === "warning" ? " warn" : "") + '">' + UI.esc(issue.message) + "</div>" : "") +
          "</td>";
      }).join("");
      return '<tr data-row="' + r.excel_row + '" class="' + (r.excluded ? "row-excluded" : "") + '">' +
        "<td>" + r.excel_row + '</td><td style="text-align:center;"><input type="checkbox" class="row-exclude" ' +
        (r.excluded ? "checked" : "") + "></td>" + tds + "</tr>";
    }).join("");
    return '<div class="table-wrap"><table class="data-table preview-table"><thead>' + head + "</thead><tbody>" +
      bodyHtml + "</tbody></table></div>";
  }

  function fieldLabel(f) {
    const labels = (state.preview && state.preview.field_labels) || {};
    const map = { description: "问题描述", category: "问题分类", dept: "责任部门", model: "机型",
      severity: "严重度", owner: "负责人", submitter: "提出人", due_date: "完成日期",
      countermeasure: "改善对策", result: "改善结果", source: "问题来源", stage: "阶段" };
    return labels[f] || map[f] || f;
  }

  function bindPreviewTable(body, rows) {
    const byRow = {};
    rows.forEach((r) => { byRow[r.excel_row] = r; });
    body.querySelectorAll("tr[data-row]").forEach((tr) => {
      const row = byRow[tr.dataset.row];
      tr.querySelectorAll(".cell-input").forEach((inp) => {
        inp.addEventListener("input", () => {
          const td = inp.closest("td");
          row.values[td.dataset.field] = inp.value;
          refreshRow(row, tr);
        });
      });
      tr.querySelector(".row-exclude").addEventListener("change", (e) => {
        row.excluded = e.target.checked;
        refreshRow(row, tr);
        applyRowFilter(body);
      });
    });
  }

  function applyRowFilter(body) {
    body.querySelectorAll("tr[data-row]").forEach((tr) => {
      const row = state.preview.rows.find((r) => String(r.excel_row) === tr.dataset.row);
      if (!row) return;
      const hasErr = rowIssues(row).some((i) => i.level === "error");
      tr.style.display = state.onlyErrors && (!hasErr || row.excluded) ? "none" : "";
    });
  }

  async function reloadPreview(payload) {
    try {
      const resp = await api.post("/api/imports/" + state.batchId + "/preview", payload);
      state.preview = resp.preview;
      renderWizard(document.querySelector("#pBody"));
    } catch (e) {
      UI.toast(e.message, "error");
    }
  }

  async function doConfirm(body, rows) {
    const active = rows.filter((r) => !r.excluded);
    const errN = active.filter((r) => rowIssues(r).some((i) => i.level === "error")).length;
    const tip = errN
      ? "仍有 " + errN + " 行存在规则错误，确认后这些行会被自动拦截剔除，其余合法数据行正常写入。是否继续？"
      : "共 " + active.length + " 行数据将提交写入问题台账库，确认提交？";
    if (!(await UI.confirm("确认提交导入", tip))) return;

    try {
      const resp = await api.post("/api/imports/" + state.batchId + "/confirm", {
        rows: rows.map((r) => ({ excel_row: r.excel_row, excluded: r.excluded, values: r.values })),
      });
      state.lastResult = resp;
      renderResult(body, resp);
    } catch (e) {
      UI.toast(e.message, "error");
    }
  }

  function renderResult(body, r) {
    const failedRows = (r.failed_details || []).map((f) =>
      "<tr><td>" + f.excel_row + "</td><td>" + UI.esc(f.values.description || "（空）") + "</td><td>" +
      (f.issues || []).map((i) =>
        '<span class="badge badge-' + (i.level === "error" ? "red" : "amber") + '">' + UI.esc(i.message) + "</span>"
      ).join(" ") + "</td></tr>").join("");

    body.innerHTML =
      '<div class="steps">' + step(1, "上传 Excel", "done") + line() + step(2, "字段映射", "done") + line() +
      step(3, "预览修正", "done") + line() + step(4, "确认入库", "done") + "</div>" +
      '<div class="card"><div class="card-title">导入处理完成（批次 #' + r.batch_id + "）</div>" +
      '<div class="result-cards">' +
      '<div class="result-card ok"><div class="num">' + r.imported + '</div><div class="lab">成功写入台账</div></div>' +
      '<div class="result-card fail"><div class="num">' + r.failed + '</div><div class="lab">规则拦截未写入</div></div>' +
      '<div class="result-card skip"><div class="num">' + r.excluded + '</div><div class="lab">人工勾选剔除</div></div>' +
      '<div class="result-card dup"><div class="num">' + r.duplicates + '</div><div class="lab">重复跳过</div></div></div>' +
      '<div class="muted">数据目标：' + UI.esc(r.target) + "</div>" +
      (r.failed ? '<div class="card-title section-gap">拦截明细列表</div><div class="table-wrap"><table class="data-table">' +
        "<thead><tr><th style='width:60px;'>行号</th><th>问题描述</th><th>未写入原因</th></tr></thead><tbody>" +
        failedRows + "</tbody></table></div>" : "") +
      '<div style="margin-top:20px; display:flex; gap:12px;">' +
      '<button class="btn btn-primary" id="goRecords">' + UI.icon("records") + ' 前往问题台账查看</button>' +
      '<button class="btn" id="goHistory">' + UI.icon("history") + ' 查看批次历史</button>' +
      '<button class="btn" id="againBtn">' + UI.icon("upload") + ' 再导入一批文件</button></div></div>';

    body.querySelector("#goRecords").addEventListener("click", () => switchTab("records"));
    body.querySelector("#goHistory").addEventListener("click", () => switchTab("history"));
    body.querySelector("#againBtn").addEventListener("click", () => {
      state.batchId = null; state.sheets = []; state.preview = null; state.lastResult = null;
      renderImport(body);
    });
  }

  /* ---------------- 3. 问题台账 (Records) ---------------- */

  const recState = { q: "", severity: "", batchId: "", page: 1, pageSize: 10, total: 0, batches: [] };

  async function renderRecords(body) {
    body.innerHTML = '<div class="card"><div class="card-title">' + UI.icon("records") + ' <span style="margin-left:6px;">问题台账总库</span></div>' +
      '<div class="toolbar"><input class="input" id="recQ" placeholder="搜索问题描述 / 负责人 / 机型 / 分类 / 部门" style="width:300px">' +
      '<select class="input" id="recSev"><option value="">全部严重度</option><option value="A">A-严重</option><option value="B">B-一般</option><option value="C">C-轻微</option></select>' +
      '<select class="input" id="recBatch"><option value="">全部批次</option></select>' +
      '<button class="btn btn-primary" id="recSearch">' + UI.icon("search") + ' <span style="margin-left:4px;">查询</span></button>' +
      '<span class="spacer"></span><button class="btn" id="toImportBtn">' + UI.icon("upload") + ' <span style="margin-left:4px;">导入新数据</span></button></div>' +
      '<div id="recList"><div class="empty">加载问题台账…</div></div></div>';

    body.querySelector("#toImportBtn").addEventListener("click", () => switchTab("import"));

    await loadBatches();
    const load = async () => {
      const params = new URLSearchParams();
      if (recState.q) params.set("q", recState.q);
      if (recState.severity) params.set("severity", recState.severity);
      if (recState.batchId) params.set("batch_id", recState.batchId);
      params.set("page", recState.page);
      params.set("page_size", recState.pageSize);
      const data = await api.get("/api/records?" + params.toString());
      recState.total = data.total;
      renderRecList(body, data);
    };

    body.querySelector("#recQ").value = recState.q;
    body.querySelector("#recSev").value = recState.severity;
    body.querySelector("#recSearch").addEventListener("click", () => { recState.page = 1; load(); });
    body.querySelector("#recQ").addEventListener("keydown", (e) => { if (e.key === "Enter") { recState.page = 1; load(); } });
    body.querySelector("#recSev").addEventListener("change", (e) => { recState.severity = e.target.value; recState.page = 1; load(); });
    body.querySelector("#recBatch").addEventListener("change", (e) => { recState.batchId = e.target.value; recState.page = 1; load(); });
    recState._load = load;
    load().catch((e) => UI.toast(e.message, "error"));
  }

  async function loadBatches() {
    if (!recState.batches.length) {
      const data = await api.get("/api/imports");
      recState.batches = data.items;
    }
    const sel = document.querySelector("#recBatch");
    if (sel && sel.options.length <= 1) {
      recState.batches.forEach((b) => {
        const opt = document.createElement("option");
        opt.value = b.id;
        opt.textContent = "#" + b.id + " " + b.filename;
        sel.appendChild(opt);
      });
      sel.value = recState.batchId;
    }
  }

  function renderRecList(body, data) {
    const host = body.querySelector("#recList");
    if (!data.items.length) {
      host.innerHTML = '<div class="empty"><div class="empty-ico">📭</div>未检索到符合条件的问题记录，请尝试调整搜索筛选或导入新 Excel</div>';
      return;
    }
    const sevMap = { A: '<span class="badge badge-red">A-严重</span>', B: '<span class="badge badge-amber">B-一般</span>', C: '<span class="badge badge-green">C-轻微</span>' };
    const pages = Math.max(Math.ceil(data.total / data.page_size), 1);
    
    host.innerHTML =
      '<div class="muted" style="margin-bottom:10px;">共检索到 <b>' + data.total + "</b> 条数据记录，第 " + data.page + " / " + pages + " 页</div>" +
      '<div class="table-wrap"><table class="data-table"><thead><tr>' +
      "<th>批次</th><th>问题描述</th><th>分类</th><th>责任部门</th><th>机型</th><th>严重度</th><th>负责人</th><th>完成日期</th><th>操作</th></tr></thead><tbody>" +
      data.items.map((r, idx) =>
        "<tr><td><code>#" + r.batch_id + "</code></td><td style='font-weight:600; max-width:280px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;'>" + UI.esc(r.description) + "</td><td>" + UI.esc(r.category || "-") +
        "</td><td>" + UI.esc(r.dept || "-") + "</td><td>" + UI.esc(r.model || "-") + "</td><td>" +
        (sevMap[r.severity] || UI.esc(r.severity || "-")) + "</td><td>" + UI.esc(r.owner || "-") + "</td><td>" +
        UI.esc(r.due_date || "-") + '</td><td><button class="btn btn-sm rec-detail-btn" data-idx="' + idx + '">查看详情</button></td></tr>').join("") +
      "</tbody></table></div>" +
      '<div class="toolbar" style="margin-top:14px;"><span class="spacer"></span>' +
      '<button class="btn btn-sm" id="prevPage" ' + (data.page <= 1 ? "disabled" : "") + ">上一页</button>" +
      '<button class="btn btn-sm" id="nextPage" ' + (data.page >= pages ? "disabled" : "") + ">下一页</button></div>";

    body.querySelectorAll(".rec-detail-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = data.items[parseInt(btn.dataset.idx, 10)];
        if (item) showRecordDetail(item);
      });
    });

    body.querySelector("#prevPage").addEventListener("click", () => { recState.page--; recState._load(); });
    body.querySelector("#nextPage").addEventListener("click", () => { recState.page++; recState._load(); });
  }

  function showRecordDetail(r) {
    const html =
      '<div style="display:flex; flex-direction:column; gap:14px;">' +
      '<div style="background:var(--canvas); padding:12px; border-radius:var(--radius-sm); border:1px solid var(--border);">' +
      '<div class="muted">问题描述</div><div style="font-weight:600; font-size:14px; margin-top:4px; color:var(--text-1);">' + UI.esc(r.description) + '</div></div>' +
      '<div class="grid grid-2">' +
      '<div><span class="muted">批次编号：</span><code>#' + r.batch_id + '</code></div>' +
      '<div><span class="muted">严重度等级：</span>' + UI.esc(r.severity || '未设定') + '</div>' +
      '<div><span class="muted">问题分类：</span>' + UI.esc(r.category || '未设定') + '</div>' +
      '<div><span class="muted">责任部门：</span>' + UI.esc(r.dept || '未设定') + '</div>' +
      '<div><span class="muted">适用的机型：</span>' + UI.esc(r.model || '未设定') + '</div>' +
      '<div><span class="muted">责任负责人：</span>' + UI.esc(r.owner || '未设定') + '</div>' +
      '<div><span class="muted">问题提出人：</span>' + UI.esc(r.submitter || '未设定') + '</div>' +
      '<div><span class="muted">计划完成日期：</span>' + UI.esc(r.due_date || '未设定') + '</div>' +
      '</div>' +
      '<div style="border-top:1px solid var(--border); padding-top:12px;">' +
      '<div class="muted">改善对策</div><div style="margin-top:4px;">' + UI.esc(r.countermeasure || '暂无对策记录') + '</div>' +
      '</div>' +
      '<div>' +
      '<div class="muted">改善结果</div><div style="margin-top:4px;">' + UI.esc(r.result || '暂无结果记录') + '</div>' +
      '</div>' +
      '</div>';

    UI.drawer("问题明细记录详情", html);
  }

  /* ---------------- 4. 导入批次历史 (History) ---------------- */

  async function renderHistory(body) {
    body.innerHTML = '<div class="card"><div class="card-title">' + UI.icon("history") + ' <span style="margin-left:6px;">Excel 导入批次记录</span></div><div id="histList" class="empty">加载批次历史中…</div></div>';
    const data = await api.get("/api/imports");
    const host = body.querySelector("#histList");
    if (!data.items.length) {
      host.className = "empty";
      host.innerHTML = '<div class="empty-ico">🗂</div>还没有导入批次记录';
      return;
    }
    host.className = "";
    host.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
      "<th>批次编号</th><th>原始文件名</th><th>工作表名</th><th>状态</th><th>成功入库</th><th>规则拦截</th><th>剔除行</th><th>上传时间</th><th>操作</th></tr></thead><tbody>" +
      data.items.map((b) =>
        "<tr><td><code>#" + b.id + "</code></td><td><b>" + UI.esc(b.filename) + "</b></td><td>" + UI.esc(b.sheet_name || "-") + "</td><td>" +
        (b.status === "confirmed"
          ? '<span class="badge badge-green">已完成入库</span>'
          : '<span class="badge badge-amber">解析待确认</span>') +
        "</td><td style='color:var(--success-dark); font-weight:600;'>" + b.imported_rows + "</td><td style='color:var(--danger-dark); font-weight:600;'>" + b.failed_rows + "</td><td>" + b.excluded_rows + "</td><td>" +
        UI.esc(b.created_at) + '</td><td>' +
        (b.status === "draft" ? '<button class="btn btn-sm cont-btn btn-primary" data-id="' + b.id + '">继续处理</button>' : '<button class="btn btn-sm view-batch-btn" data-id="' + b.id + '">明细</button>') +
        "</td></tr>").join("") + "</tbody></table></div>";

    host.querySelectorAll(".cont-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const detail = await api.get("/api/imports/" + btn.dataset.id);
          state.batchId = detail.id;
          state.preview = detail.preview;
          state.sheets = [{ name: detail.sheet_name }];
          state.lastResult = null;
          switchTab("import");
        } catch (e) {
          UI.toast(e.message, "error");
        }
      });
    });

    host.querySelectorAll(".view-batch-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const detail = await api.get("/api/imports/" + btn.dataset.id);
          const p = detail.preview || {};
          const html =
            '<div>' +
            '<p style="margin-bottom:10px;">文件名：<b>' + UI.esc(detail.filename) + '</b>（工作表：' + UI.esc(detail.sheet_name) + '）</p>' +
            '<div class="result-cards" style="margin-bottom:16px;">' +
            '<div class="result-card ok"><div class="num">' + detail.imported_rows + '</div><div class="lab">成功入库</div></div>' +
            '<div class="result-card fail"><div class="num">' + detail.failed_rows + '</div><div class="lab">拦截失败</div></div>' +
            '</div>' +
            '<button class="btn btn-sm btn-primary" id="viewBatchRecords" data-id="' + detail.id + '">查看该批次写入的台账</button>' +
            '</div>';
          UI.drawer("批次 #" + detail.id + " 导入详情", html);
          document.getElementById("viewBatchRecords").addEventListener("click", () => {
            recState.batchId = String(detail.id);
            document.getElementById("modalHost").innerHTML = "";
            switchTab("records");
          });
        } catch (e) {
          UI.toast(e.message, "error");
        }
      });
    });
  }

  return { title, render };
})();
