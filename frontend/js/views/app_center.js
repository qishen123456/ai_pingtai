// AI 应用中心：统一管理与动态注册的平台级核心页面
window.Views = window.Views || {};

window.Views.app_center = (function () {
  const title = "AI 应用中心";
  
  // 简易前端路由状态
  let state = {
    apps: [],
    filterStatus: 'all',
    searchKw: ''
  };

  async function render(el) {
    el.innerHTML = '<div class="empty">加载应用注册中心数据…</div>';
    try {
      const res = await api.get("/api/apps");
      state.apps = res.items || [];
    } catch (e) {
      el.innerHTML = '<div class="empty"><div class="empty-ico">' + UI.icon("problems") + '</div>加载失败：' + UI.esc(e.message) + "</div>";
      return;
    }

    renderAppList(el);
  }

  function renderAppList(el, gridOnly = false) {
    const apps = state.apps.filter(a => {
      if (state.filterStatus !== 'all' && a.status !== state.filterStatus) return false;
      if (state.searchKw) {
        const query = state.searchKw.toLocaleLowerCase();
        const searchable = [a.name, a.owner, a.description, a.category, a.evidence_note]
          .filter(Boolean).join(" ").toLocaleLowerCase();
        if (!searchable.includes(query)) return false;
      }
      return true;
    });

    const appsHtml = apps.length ? apps.map((a) => {
      let iconName = a.icon || "appDefault";
      let statusCls = a.status === "active" ? "status-active" : a.status === "planned" ? "status-planned" : "status-draft";
      let statusText = a.status === "active" ? "服务可用" : a.status === "planned" ? "规划设计中" : "草稿状态";

      return '<div class="app-card registry-app-card registry-tone-' + (state.apps.indexOf(a) % 4) + '">' +
      '<div class="app-card-head">' +
        '<div class="app-ico">' + UI.icon(iconName) + '</div>' +
        '<div class="app-info">' +
          '<div class="app-name">' + UI.esc(a.name) + '</div>' +
          '<div class="app-cat">' + UI.esc(a.category) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="app-desc">' + UI.esc(a.description) + '</div>' +
      (a.evidence_note ? '<div class="registry-evidence">' + UI.esc(a.evidence_note) + '</div>' : '') +
      '<div class="app-foot">' +
        '<span class="app-status ' + statusCls + '">' + statusText + '</span>' +
        appAction(a) +
      '</div>' +
      '</div>';
    }).join("") : '<div class="empty" style="grid-column: 1 / -1;"><div class="empty-ico">🔍</div>未检索到符合条件的应用</div>';

    if (gridOnly) {
      const grid = el.querySelector("#registryGrid");
      if (grid) grid.innerHTML = appsHtml;
      bindAppActions(el);
      return;
    }

    el.innerHTML = 
      '<div class="registry-hero">' +
        '<div class="registry-orbit registry-orbit-a"></div><div class="registry-orbit registry-orbit-b"></div>' +
        '<div class="registry-head">' +
          '<div>' +
            '<span class="registry-kicker">APPLICATION REGISTRY</span><h2>应用，不只是功能列表。</h2>' +
            '<p>为每个业务场景保留独立边界、负责人、建设状态与可追溯入口。</p>' +
          '</div>' +
          '<button class="btn btn-primary" id="newAppBtn">' + UI.icon("plus") + ' 新增 AI 应用</button>' +
        '</div>' +
        '<div class="registry-tools">' +
          '<div class="registry-search"><span>' + UI.icon("search") + '</span><input type="text" id="searchApp" placeholder="搜索应用名称、负责人或描述" value="' + UI.esc(state.searchKw) + '"></div>' +
          '<div class="registry-tabs" id="statusFilter" role="tablist" aria-label="应用生命周期筛选">' +
            '<button type="button" role="tab" aria-selected="' + (state.filterStatus === 'all' ? 'true' : 'false') + '" class="tab ' + (state.filterStatus === 'all' ? 'active' : '') + '" data-status="all">全部生命周期</button>' +
            '<button type="button" role="tab" aria-selected="' + (state.filterStatus === 'active' ? 'true' : 'false') + '" class="tab ' + (state.filterStatus === 'active' ? 'active' : '') + '" data-status="active">服务可用</button>' +
            '<button type="button" role="tab" aria-selected="' + (state.filterStatus === 'planned' ? 'true' : 'false') + '" class="tab ' + (state.filterStatus === 'planned' ? 'active' : '') + '" data-status="planned">规划设计中</button>' +
            '<button type="button" role="tab" aria-selected="' + (state.filterStatus === 'draft' ? 'true' : 'false') + '" class="tab ' + (state.filterStatus === 'draft' ? 'active' : '') + '" data-status="draft">草稿 / 待授权</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="registry-grid" id="registryGrid">' + appsHtml + '</div>';

    // 绑定事件
    el.querySelector('#newAppBtn').addEventListener('click', () => showNewAppWizard(el));
    
    el.querySelector('#searchApp').addEventListener('input', (e) => {
      state.searchKw = e.target.value.trim();
      if (window.searchTid) clearTimeout(window.searchTid);
      // Update only the result grid; keep focus and IME composition stable while typing Chinese.
      window.searchTid = setTimeout(() => renderAppList(el, true), 140);
    });

    el.querySelectorAll('#statusFilter .tab').forEach(t => {
      t.addEventListener('click', () => {
        state.filterStatus = t.dataset.status;
        el.querySelectorAll('#statusFilter .tab').forEach(tab => {
          const selected = tab.dataset.status === state.filterStatus;
          tab.classList.toggle('active', selected);
          tab.setAttribute('aria-selected', String(selected));
        });
        renderAppList(el, true);
      });
    });

    bindAppActions(el);
  }

  function bindAppActions(el) {
    el.querySelectorAll('#registryGrid .open-app-btn').forEach(b => {
      b.addEventListener('click', () => {
        if (b.dataset.url) window.open(b.dataset.url, '_blank', 'noopener');
        else if (['problems', 'projects', 'standardization'].includes(b.dataset.route)) Router.go(b.dataset.route);
        else UI.toast('该模块尚未配置部署入口，已保留在应用注册中心。', 'warn');
      });
    });
  }

  function appAction(app) {
    if (app.status === 'planned') return '<span class="muted" style="font-size:12px;">' + UI.esc(app.evidence_note || '等待启动条件') + '</span>';
    if (app.status === 'draft') return '<span class="muted" style="font-size:12px;">草稿待审核</span>';
    const data = app.entry_url ? ' data-url="' + UI.esc(app.entry_url) + '"' : '';
    const label = app.entry_url ? '打开独立系统' : (['problems', 'projects', 'standardization'].includes(app.route_path) ? '进入本地试点' : '待配置入口');
    return '<button class="btn btn-sm btn-primary open-app-btn" data-route="' + UI.esc(app.route_path) + '"' + data + '>' + label + '</button>';
  }

  // --- 新增应用流程向导 ---
  function showNewAppWizard(el) {
    let appData = {
      id: '', name: '', description: '', category: '数据管理与处理', icon: 'appDefault', owner: 'admin', template_type: 'custom'
    };

    const step1Html = 
      '<div class="form-group">' +
        '<label class="form-label">应用唯一标识 (ID)</label>' +
        '<input class="input" id="app_id" placeholder="如: quality-audit, 必须英文">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">应用显示名称</label>' +
        '<input class="input" id="app_name" placeholder="如: AI 质量审计专家">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">简短描述</label>' +
        '<textarea class="input" id="app_desc" rows="3" placeholder="描述此 AI 应用解决的业务场景..."></textarea>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">业务分类</label>' +
        '<select class="input" id="app_cat">' +
          '<option value="数据管理与处理">数据管理与处理</option>' +
          '<option value="文档智能处理">文档智能处理</option>' +
          '<option value="知识问答">知识问答</option>' +
          '<option value="运营分析与预警">运营分析与预警</option>' +
          '<option value="自定义业务工作空间">自定义业务工作空间</option>' +
        '</select>' +
      '</div>';
      
    const modalHtml =
      '<div class="modal-mask"><section class="modal-box app-create-modal" role="dialog" aria-modal="true" aria-labelledby="appCreateTitle">' +
        '<div class="modal-head app-create-head"><div><span class="registry-kicker">APPLICATION SETUP</span><h2 id="appCreateTitle">新增 AI 应用</h2><p>先登记基本信息，保存后进入草稿审批。</p></div></div>' +
        '<div class="modal-body">' +
          '<div class="app-create-note"><strong>当前步骤：基础信息</strong><p>保存只会创建草稿，不会自动部署，也不会向用户开放入口。</p></div>' +
          step1Html +
        '</div>' +
        '<div class="modal-foot">' +
          '<button class="btn" id="cancelAppBtn" type="button">取消</button>' +
          '<button class="btn btn-primary" id="nextAppBtn" type="button">保存为草稿</button>' +
        '</div>' +
      '</section></div>';

    const host = document.getElementById('modalHost');
    const closeModal = () => {
      host.innerHTML = '';
      document.removeEventListener('keydown', handleEscape);
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') closeModal();
    };
    host.innerHTML = modalHtml;
    document.addEventListener('keydown', handleEscape);
    document.getElementById('app_id').focus();

    document.getElementById('cancelAppBtn').addEventListener('click', closeModal);
    document.getElementById('nextAppBtn').addEventListener('click', async () => {
      const id = document.getElementById('app_id').value.trim();
      const name = document.getElementById('app_name').value.trim();
      const desc = document.getElementById('app_desc').value.trim();
      const cat = document.getElementById('app_cat').value;

      if(!id || !name || !desc) {
        UI.toast("请填写完整应用信息", "warn");
        return;
      }

      appData.id = id;
      appData.name = name;
      appData.description = desc;
      appData.category = cat;

      try {
        const newApp = await api.post("/api/apps", appData);
        UI.toast("应用创建成功，已进入草稿状态，请等待平台授权激活业务模块", "success");
        closeModal();
        state.apps.push(newApp);
        
        // 更新侧边栏导航缓存
        window.PLATFORM_APPS = state.apps;
        renderAppList(el);
        
        // 强制刷新当前导航以显示草稿状态的菜单项 (如果需要)
        // Router.go("app_center"); 
      } catch (e) {
        UI.toast(e.message, "error");
      }
    });
  }

  return { title, render };
})();
