// 应用外壳：统一路由、注册机制与侧边栏动态渲染
(async function () {
  const WORKSPACE_NAVS = [
    { key: "dashboard", icon: "dashboard", label: "工作台首页" },
    { key: "app_center", icon: "grid", label: "AI 应用中心" },
    { key: "todos", icon: "todos", label: "我的待办" },
  ];

  const PLATFORM_NAVS = [
    { key: "settings", icon: "settings", label: "平台设置", tag: "预留", status: "draft" },
  ];

  window.PLATFORM_APPS = []; // 缓存注册表数据

  // 获取图标的辅助函数 (简单复用现有的)
  function getAppIcon(name) {
    const iconMap = {
      problems: "problems",
      standardization: "standardization",
      projects: "projects",
    };
    return UI.icon(iconMap[name] || "appDefault"); // 假设有个 appDefault 图标
  }

  function renderNavGroup(containerId, items, isApp = false) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = items.map((n) => {
      const iconSvg = isApp ? getAppIcon(n.icon) : UI.icon(n.icon);
      if (n.status === "draft" && !isApp) {
        return '<div class="nav-item" style="opacity:0.5; cursor:not-allowed;" title="功能预留中">' +
          '<span class="nav-ico">' + iconSvg + '</span><span>' + (n.label || n.name) + '</span>' +
          '<span class="sys-badge draft">' + (n.tag || '草稿') + '</span></div>';
      }
      
      const tagHtml = n.status === "active" ? '<span class="sys-badge active">' + (n.entry_url || n.route_path === 'problems' ? '可用' : '待配置') + '</span>' : 
                      n.status === "planned" ? '<span class="sys-badge planned">规划中</span>' :
                      n.status === "draft" ? '<span class="sys-badge draft">草稿</span>' : '';
                      
      const label = isApp ? n.name : n.label;
      const key = isApp ? n.route_path : n.key;

      return '<div class="nav-item" data-key="' + key + '">' +
        '<span class="nav-ico">' + iconSvg + '</span><span>' + label + '</span>' + tagHtml + '</div>';
    }).join("");

    el.querySelectorAll(".nav-item[data-key]").forEach((item) => {
        item.addEventListener("click", () => {
          const app = isApp && items.find((candidate) => candidate.route_path === item.dataset.key);
          if (app && app.entry_url) window.open(app.entry_url, '_blank', 'noopener');
          else if (app && app.route_path !== 'problems') Router.go('app_center');
          else Router.go(item.dataset.key);
        });
    });
  }

  // 初始化加载
  async function init() {
    renderNavGroup("navWorkspace", WORKSPACE_NAVS);
    renderNavGroup("navPlatform", PLATFORM_NAVS);
    
    try {
      const res = await api.get("/api/apps");
      window.PLATFORM_APPS = res.items || [];
      renderNavGroup("navBusiness", window.PLATFORM_APPS, true);
    } catch (e) {
      console.error("Failed to load apps from registry", e);
      document.getElementById("navBusiness").innerHTML = '<div class="muted" style="padding:0 12px;">加载应用注册表失败</div>';
    }

    Router.onChange(async (route) => {
      const viewKey = route.view;
      const view = window.Views[viewKey] || window.Views.dashboard;
      
      document.querySelectorAll(".nav-item").forEach((n) =>
        n.classList.toggle("active", n.dataset.key === viewKey));
        
      const breadcrumbCategory = document.getElementById("breadcrumbCategory");
      if (breadcrumbCategory) {
        if (WORKSPACE_NAVS.find(n => n.key === viewKey)) breadcrumbCategory.textContent = "工作空间";
        else if (window.PLATFORM_APPS.find(n => n.route_path === viewKey)) breadcrumbCategory.textContent = "业务系统";
        else breadcrumbCategory.textContent = "系统配置";
      }
      
      document.getElementById("pageTitle").textContent = view.title || "";
      const content = document.getElementById("content");
      
      // 触发动画
      content.classList.remove("fade-in");
      void content.offsetWidth;
      content.classList.add("fade-in");
      
      content.innerHTML = "";
      window.scrollTo(0, 0);
      try {
        await view.render(content, route.param, route.subview);
      } catch (e) {
        content.innerHTML =
          '<div class="empty"><div class="empty-ico">' + UI.icon("problems") + '</div>页面加载异常：' + UI.esc(e.message) + "</div>";
      }
    });

    Router.emit();
  }

  init();
})();
