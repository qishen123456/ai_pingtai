// 平台总览：聚焦已验证状态、建设节奏与业务应用入口。
window.Views = window.Views || {};

window.Views.dashboard = {
  title: "平台总览",
  async render(el) {
    el.innerHTML = '<div class="empty">正在加载平台状态…</div>';
    let data;
    try { data = await api.get('/api/dashboard'); }
    catch (e) {
      el.innerHTML = '<div class="empty"><div class="empty-ico">!</div>平台状态加载失败：' + UI.esc(e.message) + '</div>';
      return;
    }

    const apps = window.PLATFORM_APPS || [];
    const platform = data.platform || {};
    const active = apps.filter((app) => app.status === 'active');
    const planned = apps.filter((app) => app.status === 'planned');
    const stats = (data.stats || []).map((stat, index) =>
      '<button class="metric-card metric-' + index + '" data-go="' + UI.esc(stat.view) + '">' +
        '<span class="metric-orbit"></span><span class="metric-label">' + UI.esc(stat.label) + '</span>' +
        '<strong>' + UI.esc(stat.value) + '<em>' + UI.esc(stat.unit) + '</em></strong>' +
        '<span class="metric-caption">' + (index < 2 ? '本地试点数据' : '平台注册状态') + '</span></button>'
    ).join('');
    const appCards = apps.map((app, index) => {
      const phase = app.status === 'active' ? '可用入口' : app.status === 'planned' ? '建设准备' : '草稿待审核';
      const action = app.entry_url ? '打开系统' : app.route_path === 'problems' ? '进入试点' : '查看条件';
      const destination = app.route_path === 'problems' ? 'problems' : 'app_center';
      return '<article class="mission-card mission-' + (index % 4) + '" data-go="' + destination + '">' +
        '<div class="mission-topline"><span class="mission-index">0' + (index + 1) + '</span><span class="mission-state ' + UI.esc(app.status) + '"><i></i>' + phase + '</span></div>' +
        '<div class="mission-icon">' + UI.icon(app.icon) + '</div><h3>' + UI.esc(app.name) + '</h3><p>' + UI.esc(app.description) + '</p>' +
        '<div class="mission-meta"><span>' + UI.esc(app.category) + '</span><span>' + UI.esc(app.owner) + '</span></div>' +
        '<div class="mission-action"><span>' + action + '</span>' + UI.icon('arrowRight') + '</div></article>';
    }).join('');
    const queue = planned.length ? planned.map((app, index) =>
      '<div class="build-row"><span class="build-number">0' + (index + 1) + '</span><div><strong>' + UI.esc(app.name) + '</strong><p>' + UI.esc(app.evidence_note || '待确认启动条件') + '</p></div><span class="build-tag">待条件齐备</span></div>'
    ).join('') : '<div class="build-empty">当前没有待启动模块。</div>';

    el.innerHTML =
      '<section class="command-hero"><div class="hero-grid"></div><div class="hero-glow hero-glow-a"></div><div class="hero-glow hero-glow-b"></div>' +
        '<div class="command-copy"><div class="eyebrow"><span></span>研发智能化 · 统一门户</div><h1>让每个业务场景，<br><b>拥有自己的 AI 工作空间。</b></h1>' +
        '<p>一个清晰的入口，连接已运行的业务系统与正在建设的智能模块。所有状态都以可验证的部署和数据为准。</p>' +
        '<div class="hero-actions"><button class="hero-button" id="goAppCenter">查看应用地图 ' + UI.icon('arrowRight') + '</button><button class="hero-link" id="goImport">' + UI.icon('upload') + ' 进入问题经验试点</button></div></div>' +
        '<div class="command-signal"><div class="signal-ring ring-1"></div><div class="signal-ring ring-2"></div><div class="signal-ring ring-3"></div><div class="signal-core"><span>AI</span><small>PLATFORM</small></div>' +
        '<div class="signal-label label-top">应用注册<br><b>' + (platform.registered_apps || apps.length) + '</b> 个</div><div class="signal-label label-bottom">可用入口<br><b>' + active.length + '</b> 个</div></div></section>' +
      '<section class="metric-grid">' + stats + '</section>' +
      '<section class="overview-layout"><div class="panel build-panel"><div class="panel-heading"><div><span class="panel-kicker">BUILD QUEUE</span><h2>建设优先序</h2></div><button class="text-action" data-go="app_center">查看应用中心 ' + UI.icon('arrowRight') + '</button></div><div class="build-list">' + queue + '</div></div>' +
      '<aside class="panel architecture-panel"><div class="panel-kicker">PLATFORM PULSE</div><h2>平台运行边界</h2><div class="pulse-rule"><span class="pulse-dot"></span><div><strong>已验证能力优先</strong><p>问题经验导入试点正在本门户运行。</p></div></div><div class="pulse-rule"><span class="pulse-dot amber"></span><div><strong>独立系统独立演进</strong><p>项目管理和企业版问题经验通过部署入口接入。</p></div></div><div class="pulse-rule"><span class="pulse-dot slate"></span><div><strong>AI 能力受控上线</strong><p>模型、数据源和规则均需通过配置与验收后启用。</p></div></div></aside></section>' +
      '<section class="section-heading"><div><span class="panel-kicker">APPLICATION MAP</span><h2>业务应用地图</h2></div><p>每个模块保持独立业务边界，共享平台规范与进入路径。</p></section><section class="mission-grid">' + appCards + '</section>';

    el.querySelector('#goAppCenter').addEventListener('click', () => Router.go('app_center'));
    el.querySelector('#goImport').addEventListener('click', () => Router.go('problems', 'import'));
    el.querySelectorAll('[data-go]').forEach((node) => node.addEventListener('click', () => Router.go(node.dataset.go)));
  },
};
