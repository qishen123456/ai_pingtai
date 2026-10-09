// AI + 标准化与优选件：物料目录、相似件检索、BOM 校验和历史
window.Views = window.Views || {};
window.Views.standardization = (function () {
  const title = "AI + 标准化与优选件";
  const state = { el: null, tab: "catalog", parts: [], query: "", similarity: [], bomResult: null, history: [] };
  const lifeLabels = { active: "有效", pending: "待审核", deprecated: "已停用" };
  const bomLabels = { compliant: "优选合规", non_preferred: "非优选待复核", pending: "待审核", deprecated: "已停用", not_found: "未登记" };

  async function render(el) {
    state.el = el;
    el.innerHTML = '<section class="std-shell"><div class="std-hero"><div><span class="module-kicker">PARTS INTELLIGENCE · LOCAL PILOT</span>' +
      '<h2>标准化与优选件工作台</h2><p>维护可追溯的本地物料目录，以确定性规则检索相似件、逐项校验 BOM 并提供候选优选件。</p></div>' +
      '<div class="std-hero-side"><span class="local-source-badge">本地规则试点</span><small>PLM 未接入 · 不作为量产放行结论</small></div></div>' +
      '<div class="std-tabs" id="stdTabs"><button class="tab active" data-tab="catalog">物料目录</button><button class="tab" data-tab="similar">相似件检索</button>' +
      '<button class="tab" data-tab="bom">BOM 合规校验</button><button class="tab" data-tab="history">校验历史</button></div>' +
      '<div id="stdPanel"><div class="empty">正在加载物料目录…</div></div></section>';
    el.querySelectorAll("#stdTabs [data-tab]").forEach(function (tab) {
      tab.addEventListener("click", function () { state.tab = tab.dataset.tab; renderActive(); });
    });
    await refresh();
  }

  async function refresh() {
    try {
      const data = await api.get("/api/standardization/parts?page_size=200");
      state.parts = data.items || [];
      renderActive();
    } catch (error) {
      const panel = state.el && state.el.querySelector("#stdPanel");
      if (panel) panel.innerHTML = '<div class="empty">物料目录加载失败：' + UI.esc(error.message) + '</div>';
    }
  }

  function renderActive() {
    state.el.querySelectorAll("#stdTabs [data-tab]").forEach(function (tab) {
      tab.classList.toggle("active", tab.dataset.tab === state.tab);
    });
    if (state.tab === "catalog") renderCatalog();
    else if (state.tab === "similar") renderSimilar();
    else if (state.tab === "bom") renderBom();
    else renderHistory();
  }

  function renderCatalog() {
    const panel = state.el.querySelector("#stdPanel");
    const q = document.getElementById("stdSearch") ? document.getElementById("stdSearch").value.trim() : "";
    const lifecycle = document.getElementById("stdLifeFilter") ? document.getElementById("stdLifeFilter").value : "";
    const preferred = document.getElementById("stdPreferredFilter") ? document.getElementById("stdPreferredFilter").value : "";
    const rows = state.parts.filter(function (p) {
      return (!lifecycle || p.lifecycle === lifecycle) && (!preferred || String(p.is_preferred) === preferred) &&
        (!q || [p.part_no, p.name, p.specification, p.category, p.manufacturer].join(" ").toLowerCase().includes(q.toLowerCase()));
    });
    const preferredCount = state.parts.filter(function (p) { return p.is_preferred && p.lifecycle === "active"; }).length;
    const pendingCount = state.parts.filter(function (p) { return p.lifecycle === "pending"; }).length;
    const deprecatedCount = state.parts.filter(function (p) { return p.lifecycle === "deprecated"; }).length;
    panel.innerHTML = '<div class="std-kpis"><div><span>物料档案</span><b>' + state.parts.length + '</b></div><div><span>有效优选件</span><b>' + preferredCount + '</b></div>' +
      '<div><span>待审核</span><b>' + pendingCount + '</b></div><div><span>已停用</span><b>' + deprecatedCount + '</b></div></div>' +
      '<div class="std-catalog-toolbar"><div><h3>物料主数据目录</h3><p>物料编码唯一；停用物料不会从历史 BOM 记录中删除。</p></div><button class="btn btn-primary" id="stdAddPart">' + UI.icon("plus") + ' 新增物料</button></div>' +
      '<div class="std-filterbar"><input class="input" id="stdSearch" placeholder="搜索编码、名称、规格或供应商" value="' + UI.esc(q) + '">' +
      '<select class="input" id="stdLifeFilter"><option value="">全部生命周期</option>' + Object.keys(lifeLabels).map(function (key) { return '<option value="' + key + '" ' + (lifecycle === key ? "selected" : "") + '>' + lifeLabels[key] + '</option>'; }).join("") + '</select>' +
      '<select class="input" id="stdPreferredFilter"><option value="">优选件：全部</option><option value="true" ' + (preferred === "true" ? "selected" : "") + '>仅优选件</option><option value="false" ' + (preferred === "false" ? "selected" : "") + '>非优选件</option></select>' +
      '<button class="btn" id="stdApplyFilter">筛选</button></div>' +
      (rows.length ? '<div class="table-wrap"><table class="data-table std-table"><thead><tr><th>物料编码</th><th>名称 / 规格</th><th>分类</th><th>制造商</th><th>生命周期</th><th>优选件</th><th>替代编码</th><th>操作</th></tr></thead><tbody>' +
      rows.map(function (p) {
        return '<tr><td><code>' + UI.esc(p.part_no) + '</code></td><td><b>' + UI.esc(p.name) + '</b><small class="std-cell-sub">' + UI.esc(p.specification || "未填写规格") + '</small></td>' +
          '<td>' + UI.esc(p.category || "-") + '</td><td>' + UI.esc(p.manufacturer || "-") + '</td><td><span class="std-life ' + UI.esc(p.lifecycle) + '">' + UI.esc(lifeLabels[p.lifecycle] || p.lifecycle) + '</span></td>' +
          '<td>' + (p.is_preferred ? '<span class="std-preferred">★ 优选</span>' : '<span class="muted">—</span>') + '</td><td>' + UI.esc(p.replacement_part_no || "-") + '</td>' +
          '<td><button class="btn btn-sm" data-edit-part="' + p.id + '">编辑</button></td></tr>';
      }).join("") + '</tbody></table></div>' :
      '<div class="std-empty"><div class="empty-ico">◫</div><strong>暂无物料档案</strong><p>添加经确认的物料编码和规格后，即可进行相似件检索与 BOM 检查。</p><button class="btn btn-primary" id="stdAddFirst">新增第一条物料</button></div>');
    panel.querySelector("#stdAddPart").addEventListener("click", function () { showPartForm(); });
    panel.querySelector("#stdApplyFilter").addEventListener("click", renderCatalog);
    panel.querySelector("#stdSearch").addEventListener("keydown", function (event) { if (event.key === "Enter") renderCatalog(); });
    const addFirst = panel.querySelector("#stdAddFirst");
    if (addFirst) addFirst.addEventListener("click", function () { showPartForm(); });
    panel.querySelectorAll("[data-edit-part]").forEach(function (button) {
      button.addEventListener("click", function () {
        showPartForm(state.parts.find(function (p) { return p.id === Number(button.dataset.editPart); }));
      });
    });
  }

  function renderSimilar() {
    const panel = state.el.querySelector("#stdPanel");
    panel.innerHTML = '<div class="std-work-card"><div class="std-section-head"><div><h3>相似物料检索</h3><p>综合比较名称、规格、分类和编码文本。算法可解释，但不替代工程师对技术参数与认证要求的核验。</p></div></div>' +
      '<div class="std-sim-form"><div class="form-group"><label class="form-label">目标物料名称 / 关键词 *</label><input class="input" id="simQuery" placeholder="例如：智能净水泵组件" value="' + UI.esc(state.query) + '"></div>' +
      '<div class="form-group"><label class="form-label">规格描述（选填）</label><input class="input" id="simSpec" placeholder="例如：24V、流量、尺寸、材质"></div>' +
      '<div class="form-group"><label class="form-label">物料分类（选填）</label><input class="input" id="simCategory" placeholder="例如：水泵"></div><button class="btn btn-primary" id="simRun">检索相似件</button></div>' +
      '<div id="simNotice" class="std-notice">检索结果使用本地物料库；匹配分值不是 AI 置信度。</div><div id="simResults"></div></div>';
    panel.querySelector("#simRun").addEventListener("click", runSimilarity);
    panel.querySelector("#simQuery").addEventListener("keydown", function (e) { if (e.key === "Enter") runSimilarity(); });
    if (state.similarity.length) showSimilarResults();
  }

  async function runSimilarity() {
    const panel = state.el.querySelector("#stdPanel");
    const query = panel.querySelector("#simQuery").value.trim();
    if (query.length < 2) return UI.toast("请输入至少 2 个字符的物料名称或关键词", "warn");
    state.query = query;
    try {
      const result = await api.post("/api/standardization/similarity", {
        query: query, specification: panel.querySelector("#simSpec").value.trim(),
        category: panel.querySelector("#simCategory").value.trim(), limit: 30
      });
      state.similarity = result.items || [];
      panel.querySelector("#simNotice").textContent = result.notice;
      showSimilarResults();
    } catch (error) { UI.toast(error.message, "error"); }
  }

  function showSimilarResults() {
    const host = state.el.querySelector("#simResults");
    if (!host) return;
    if (!state.similarity.length) {
      host.innerHTML = '<div class="std-empty"><strong>没有找到足够相似的候选物料</strong><p>可以调整名称、规格关键词或先维护物料目录。</p></div>';
      return;
    }
    host.innerHTML = '<div class="std-results-head"><h4>候选物料</h4><span>' + state.similarity.length + ' 条 · 按文本相似度排序</span></div>' +
      '<div class="std-match-list">' + state.similarity.map(function (p) {
        return '<article class="std-match-card"><div class="std-match-score">' + Math.round(p.similarity * 100) + '<small>匹配分</small></div><div class="std-match-main">' +
          '<div class="std-match-title"><code>' + UI.esc(p.part_no) + '</code><b>' + UI.esc(p.name) + '</b>' + (p.is_preferred ? '<span class="std-preferred">★ 优选</span>' : '') + '</div>' +
          '<p>' + UI.esc(p.specification || "未填写规格") + ' · ' + UI.esc(p.category || "未分类") + ' · ' + UI.esc(p.manufacturer || "未填写制造商") + '</p>' +
          '<div class="std-reasons">' + p.reasons.map(function (r) { return '<span>' + UI.esc(r) + '</span>'; }).join("") + '</div></div>' +
          '<span class="std-life ' + UI.esc(p.lifecycle) + '">' + UI.esc(lifeLabels[p.lifecycle] || p.lifecycle) + '</span></article>';
      }).join("") + '</div>';
  }

  function renderBom() {
    const panel = state.el.querySelector("#stdPanel");
    panel.innerHTML = '<div class="std-work-card"><div class="std-section-head"><div><h3>BOM 合规校验</h3><p>逐项比对本地物料档案、优选标记与生命周期；检查结果会保存到历史记录。</p></div><span class="local-source-badge">规则校验</span></div>' +
      '<div class="std-notice">校验结论只对当前本地物料档案负责。未接入 PLM，不能作为正式量产放行依据；替代件建议须复核规格、认证和供应链条件。</div>' +
      '<div class="form-group"><label class="form-label">BOM 名称 *</label><input class="input" id="bomName" placeholder="例如：净水器试制 BOM"></div>' +
      '<div class="std-bom-table"><table class="data-table"><thead><tr><th>物料编码 *</th><th>物料名称（用于找替代件）</th><th>分类（用于找替代件）</th><th>数量 *</th><th></th></tr></thead><tbody id="bomRows">' + bomRowHtml() + '</tbody></table></div>' +
      '<div class="std-bom-actions"><button class="btn" id="bomAddRow">' + UI.icon("plus") + ' 添加物料行</button><span class="spacer"></span><button class="btn btn-primary" id="bomCheck">运行合规检查</button></div>' +
      '<div id="bomResultHost"></div></div>';
    panel.querySelector("#bomAddRow").addEventListener("click", function () { addBomRow(); });
    panel.querySelector("#bomRows").addEventListener("click", function (event) {
      const button = event.target.closest("[data-remove-bom-row]");
      if (!button) return;
      const rows = panel.querySelectorAll(".std-bom-row");
      if (rows.length <= 1) {
        rows[0].querySelectorAll("input").forEach(function (input) { input.value = ""; });
      } else button.closest("tr").remove();
    });
    panel.querySelector("#bomCheck").addEventListener("click", runBomCheck);
    if (state.bomResult) showBomResult(state.bomResult);
  }

  function bomRowHtml() {
    return '<tr class="std-bom-row"><td><input class="input" data-part-no placeholder="物料编码"></td><td><input class="input" data-part-name placeholder="物料名称"></td>' +
      '<td><input class="input" data-part-category placeholder="分类"></td><td><input class="input" data-part-qty type="number" min="0.001" step="any" value="1"></td>' +
      '<td><button class="btn btn-sm" type="button" data-remove-bom-row aria-label="移除此行">移除</button></td></tr>';
  }

  function addBomRow() {
    const body = state.el.querySelector("#bomRows");
    body.insertAdjacentHTML("beforeend", bomRowHtml());
  }

  async function runBomCheck() {
    const panel = state.el.querySelector("#stdPanel");
    const name = panel.querySelector("#bomName").value.trim();
    const items = Array.from(panel.querySelectorAll(".std-bom-row")).map(function (row) {
      return {
        part_no: row.querySelector("[data-part-no]").value.trim(),
        name: row.querySelector("[data-part-name]").value.trim(),
        category: row.querySelector("[data-part-category]").value.trim(),
        quantity: Number(row.querySelector("[data-part-qty]").value || 1)
      };
    }).filter(function (item) { return item.part_no; });
    if (name.length < 2) return UI.toast("请填写 BOM 名称", "warn");
    if (!items.length) return UI.toast("请至少填写一条物料编码", "warn");
    if (items.some(function (item) { return !Number.isFinite(item.quantity) || item.quantity <= 0; })) return UI.toast("物料数量必须大于 0", "warn");
    try {
      const result = await api.post("/api/standardization/bom/check", { bom_name: name, items: items });
      state.bomResult = result;
      showBomResult(result);
      UI.toast("BOM 校验完成，结果已保存到历史记录", "success");
    } catch (error) { UI.toast(error.message, "error"); }
  }

  function showBomResult(result) {
    const host = state.el.querySelector("#bomResultHost");
    if (!host) return;
    host.innerHTML = '<div class="std-bom-summary"><div><span>优选合规</span><b class="good">' + result.compliant_items + '</b></div>' +
      '<div><span>待人工复核</span><b class="warning">' + result.review_items + '</b></div><div><span>拦截 / 未登记</span><b class="danger">' + result.blocked_items + '</b></div></div>' +
      '<div class="std-results-head"><h4>逐项检查结果 · ' + UI.esc(result.bom_name) + '</h4><span>检查编号 #' + result.id + '</span></div>' +
      '<div class="table-wrap"><table class="data-table std-table"><thead><tr><th>行</th><th>输入编码</th><th>匹配物料</th><th>判定</th><th>原因</th><th>替代优选件候选</th></tr></thead><tbody>' +
      result.results.map(function (item) {
        const p = item.matched_part;
        const alternatives = item.alternatives.length ? item.alternatives.map(function (a) {
          return '<div class="std-alt"><b>' + UI.esc(a.part_no) + '</b> ' + UI.esc(a.name) + '<small>' + UI.esc(a.reason) + '</small></div>';
        }).join("") : '<span class="muted">无可用候选</span>';
        const cls = item.status === "compliant" ? "good" : item.status === "not_found" || item.status === "deprecated" ? "danger" : "warning";
        return '<tr><td>' + item.row_number + '</td><td><code>' + UI.esc(item.input.part_no) + '</code><small class="std-cell-sub">数量 ' + item.input.quantity + '</small></td>' +
          '<td>' + (p ? '<b>' + UI.esc(p.name) + '</b><small class="std-cell-sub">' + UI.esc(p.specification || p.part_no) + '</small>' : '未匹配') + '</td>' +
          '<td><span class="pm-status ' + cls + '">' + UI.esc(bomLabels[item.status] || item.status) + '</span></td><td>' + UI.esc(item.message) + '</td><td>' + alternatives + '</td></tr>';
      }).join("") + '</tbody></table></div><p class="std-notice">' + UI.esc(result.notice) + '</p>';
  }

  async function renderHistory() {
    const panel = state.el.querySelector("#stdPanel");
    panel.innerHTML = '<div class="std-work-card"><div class="std-section-head"><div><h3>BOM 校验历史</h3><p>查看过往校验的统计结果和逐项判定。</p></div></div><div id="stdHistoryList" class="empty">正在读取历史记录…</div><div id="stdHistoryDetail"></div></div>';
    try {
      const result = await api.get("/api/standardization/bom/runs");
      state.history = result.items || [];
      const host = panel.querySelector("#stdHistoryList");
      if (!state.history.length) {
        host.className = "std-empty";
        host.innerHTML = '<strong>还没有 BOM 校验历史</strong><p>运行一次 BOM 合规检查后，结果将保存在这里。</p>';
        return;
      }
      host.className = "";
      host.innerHTML = '<div class="table-wrap"><table class="data-table std-table"><thead><tr><th>检查编号</th><th>BOM 名称</th><th>物料行</th><th>优选合规</th><th>待复核</th><th>拦截</th><th>时间</th><th></th></tr></thead><tbody>' +
        state.history.map(function (run) {
          return '<tr><td>#' + run.id + '</td><td><b>' + UI.esc(run.bom_name) + '</b></td><td>' + run.total_items + '</td><td>' + run.compliant_items + '</td><td>' + run.review_items + '</td><td>' + run.blocked_items + '</td><td>' + UI.esc(run.created_at) + '</td><td><button class="btn btn-sm" data-view-run="' + run.id + '">查看明细</button></td></tr>';
        }).join("") + '</tbody></table></div>';
      host.querySelectorAll("[data-view-run]").forEach(function (button) {
        button.addEventListener("click", async function () {
          try {
            const detail = await api.get("/api/standardization/bom/runs/" + button.dataset.viewRun);
            const detailHost = panel.querySelector("#stdHistoryDetail");
            state.bomResult = Object.assign({ results: detail.results }, detail);
            detailHost.innerHTML = '<div class="std-history-title"><h4>历史明细 · ' + UI.esc(detail.bom_name) + '</h4><button class="btn btn-sm" id="stdBackToBom">回到 BOM 校验</button></div><div id="stdHistoryResults"></div>';
            showBomResultIn(detailHost.querySelector("#stdHistoryResults"), state.bomResult);
            detailHost.querySelector("#stdBackToBom").addEventListener("click", function () { state.tab = "bom"; renderActive(); });
          } catch (error) { UI.toast(error.message, "error"); }
        });
      });
    } catch (error) {
      panel.querySelector("#stdHistoryList").textContent = "历史加载失败：" + error.message;
    }
  }

  function showBomResultIn(host, result) {
    if (!host) return;
    host.innerHTML = '<div class="std-bom-summary"><div><span>优选合规</span><b class="good">' + result.compliant_items + '</b></div><div><span>待人工复核</span><b class="warning">' + result.review_items + '</b></div><div><span>拦截 / 未登记</span><b class="danger">' + result.blocked_items + '</b></div></div>' +
      '<div class="table-wrap"><table class="data-table std-table"><thead><tr><th>行</th><th>输入编码</th><th>匹配物料</th><th>判定</th><th>原因</th><th>替代候选</th></tr></thead><tbody>' +
      result.results.map(function (item) {
        const p = item.matched_part;
        const alternatives = item.alternatives.length ? item.alternatives.map(function (a) { return UI.esc(a.part_no + " · " + a.name); }).join("<br>") : "无";
        const cls = item.status === "compliant" ? "good" : item.status === "not_found" || item.status === "deprecated" ? "danger" : "warning";
        return '<tr><td>' + item.row_number + '</td><td>' + UI.esc(item.input.part_no) + '</td><td>' + UI.esc(p ? p.name : "未匹配") + '</td>' +
          '<td><span class="pm-status ' + cls + '">' + UI.esc(bomLabels[item.status] || item.status) + '</span></td><td>' + UI.esc(item.message) + '</td><td>' + alternatives + '</td></tr>';
      }).join("") + '</tbody></table></div>';
  }

  function showPartForm(part) {
    const editing = !!part;
    const host = document.getElementById("modalHost");
    host.innerHTML = '<div class="modal-mask"><div class="modal-box std-form-modal"><div class="modal-head">' + (editing ? "编辑物料档案" : "新增物料档案") + '</div><div class="modal-body"><div class="std-form-grid">' +
      '<div class="form-group"><label class="form-label">物料编码 *</label><input class="input" id="sfNo" ' + (editing ? "disabled" : "") + ' value="' + UI.esc(part ? part.part_no : "") + '"></div>' +
      '<div class="form-group"><label class="form-label">物料名称 *</label><input class="input" id="sfName" value="' + UI.esc(part ? part.name : "") + '"></div>' +
      '<div class="form-group"><label class="form-label">规格 / 关键参数</label><input class="input" id="sfSpec" value="' + UI.esc(part ? part.specification : "") + '"></div>' +
      '<div class="form-group"><label class="form-label">分类</label><input class="input" id="sfCategory" value="' + UI.esc(part ? part.category : "未分类") + '"></div>' +
      '<div class="form-group"><label class="form-label">制造商 / 供应商</label><input class="input" id="sfManufacturer" value="' + UI.esc(part ? part.manufacturer : "") + '"></div>' +
      '<div class="form-group"><label class="form-label">生命周期</label><select class="input" id="sfLife">' + Object.keys(lifeLabels).map(function (key) { return '<option value="' + key + '" ' + (part && part.lifecycle === key ? "selected" : (!part && key === "active" ? "selected" : "")) + '>' + lifeLabels[key] + '</option>'; }).join("") + '</select></div>' +
      '<div class="form-group"><label class="form-label">替代物料编码</label><input class="input" id="sfReplacement" value="' + UI.esc(part ? part.replacement_part_no || "" : "") + '"></div>' +
      '<div class="form-group std-form-checkbox"><label><input type="checkbox" id="sfPreferred" ' + (part && part.is_preferred ? "checked" : "") + '> 标记为优选件</label></div>' +
      '<div class="form-group std-form-full"><label class="form-label">工程备注</label><textarea class="input" rows="3" id="sfNotes">' + UI.esc(part ? part.notes || "" : "") + '</textarea></div>' +
      '</div><p class="muted">物料数据只保存在本地试点库。正式优选目录需从 PLM 或受控主数据来源同步并通过工程审核。</p></div>' +
      '<div class="modal-foot"><button class="btn" id="sfCancel">取消</button><button class="btn btn-primary" id="sfSave">保存物料</button></div></div></div>';
    host.querySelector("#sfCancel").addEventListener("click", function () { host.innerHTML = ""; });
    host.querySelector("#sfSave").addEventListener("click", async function () {
      const no = host.querySelector("#sfNo").value.trim(), name = host.querySelector("#sfName").value.trim();
      if ((!editing && !no) || name.length < 2) return UI.toast("请填写物料编码和至少 2 个字符的名称", "warn");
      const payload = { name: name, specification: host.querySelector("#sfSpec").value.trim(),
        category: host.querySelector("#sfCategory").value.trim() || "未分类",
        manufacturer: host.querySelector("#sfManufacturer").value.trim(), lifecycle: host.querySelector("#sfLife").value,
        is_preferred: host.querySelector("#sfPreferred").checked,
        replacement_part_no: host.querySelector("#sfReplacement").value.trim() || null,
        notes: host.querySelector("#sfNotes").value.trim() };
      if (!editing) payload.part_no = no;
      try {
        await (editing ? api.patch("/api/standardization/parts/" + part.id, payload) : api.post("/api/standardization/parts", payload));
        host.innerHTML = ""; UI.toast(editing ? "物料档案已更新" : "物料已新增", "success"); await refresh();
      } catch (error) { UI.toast(error.message, "error"); }
    });
  }

  return { title: title, render: render };
})();
