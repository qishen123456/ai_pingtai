// 待办与处理记录页面
window.Views = window.Views || {};

window.Views.todos = {
  title: "待办与处理记录",
  async render(el) {
    el.innerHTML = '<div class="empty">加载中…</div>';
    let data;
    try {
      data = await api.get("/api/dashboard");
    } catch (e) {
      el.innerHTML = '<div class="empty">数据加载失败：' + UI.esc(e.message) + "</div>";
      return;
    }

    const levelName = { high: "高风险", medium: "中风险", low: "低风险" };
    const levelBadge = { high: "badge-red", medium: "badge-amber", low: "badge-blue" };

    const todosHtml = data.todos.length ? data.todos.map((t, index) =>
      '<div class="work-item"><div class="work-seq">0' + (index + 1) + '</div><div class="work-copy"><div><span class="badge ' + (levelBadge[t.level] || 'badge-gray') + '">' + levelName[t.level] + '</span><span class="work-module">' + (t.module === 'problems' ? '问题与经验' : '平台建设') + '</span></div><strong>' + UI.esc(t.title) + '</strong></div><button class="btn btn-sm btn-primary" data-go="' + t.module + '">' + UI.esc(t.action_text) + ' ' + UI.icon('arrowRight') + '</button></div>'
    ).join("") : '<div class="work-empty">当前没有需要平台跟进的建设事项。</div>';

    // 获取导入批次记录作为处理历史
    let historyHtml = '<tr><td colspan="5" class="empty">暂无历史记录</td></tr>';
    try {
      const hist = await api.get("/api/imports");
      if (hist.items && hist.items.length) {
        historyHtml = hist.items.map((b) =>
          '<tr><td><code>#' + b.id + '</code></td>' +
          '<td><b>' + UI.esc(b.filename) + '</b></td>' +
          '<td>' + (b.status === 'confirmed' ? '<span class="badge badge-green">已入库</span>' : '<span class="badge badge-amber">待确认</span>') + '</td>' +
          '<td>成功 ' + b.imported_rows + ' / 失败 ' + b.failed_rows + ' / 剔除 ' + b.excluded_rows + '</td>' +
          '<td style="color:var(--text-3); font-size:12px;">' + UI.esc(b.created_at) + '</td></tr>'
        ).join("");
      }
    } catch (err) {}

    el.innerHTML =
      '<section class="worklog-shell"><div class="worklog-head"><span class="module-kicker">WORK QUEUE · TRACEABLE</span><h2>待办与处理记录</h2><p>把建设依赖与导入处理记录放在同一个可追溯视图中。</p></div>' +
      '<div class="grid grid-2 worklog-grid">' +
      '<div class="card work-queue-card"><div class="card-title">' + UI.icon("todos") + ' <span style="margin-left:6px;">当前建设待办</span><span class="work-count">' + data.todos.length + '</span></div>' +
      '<div class="work-list">' + todosHtml + '</div></div>' +
      '<div class="card work-history-card"><div class="card-title">' + UI.icon("history") + ' <span style="margin-left:6px;">最近导入处理记录</span></div>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>批次 ID</th><th>文件 / 操作名称</th><th>处理状态</th><th>数据明细</th><th>时间</th></tr></thead>' +
      '<tbody>' + historyHtml + '</tbody></table></div></div></div></section>';

    el.querySelectorAll("[data-go]").forEach((node) => {
      node.addEventListener("click", () => Router.go(node.dataset.go));
    });
  },
};
