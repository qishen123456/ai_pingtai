// 应用外壳：统一路由、注册机制与侧边栏动态渲染
(async function () {
  const WORKSPACE_NAVS = [
    { key: "dashboard", icon: "dashboard", label: "工作台首页" },
    { key: "assistant", icon: "message-square", label: "统一 AI 问答" },
    { key: "app_center", icon: "grid", label: "AI 应用中心" },
    { key: "todos", icon: "todos", label: "我的待办" },
  ];

  const PLATFORM_NAVS = [
    { key: "settings", icon: "settings", label: "平台设置", tag: "预留", status: "draft" },
  ];

  window.PLATFORM_APPS = []; // 缓存注册表数据

  function setMobileNavOpen(open) {
    const sidebar = document.querySelector(".sidebar");
    const backdrop = document.getElementById("mobileNavBackdrop");
    const toggle = document.getElementById("mobileNavToggle");
    if (sidebar) sidebar.classList.toggle("mobile-open", open);
    if (backdrop) backdrop.classList.toggle("visible", open);
    if (toggle) {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
    }
    document.body.classList.toggle("nav-open", open);
  }

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
        return '<button type="button" class="nav-item is-disabled" disabled title="功能预留中" aria-disabled="true">' +
          '<span class="nav-ico">' + iconSvg + '</span><span>' + UI.esc(n.label || n.name) + '</span>' +
          '<span class="sys-badge draft">' + UI.esc(n.tag || '草稿') + '</span></button>';
      }
      
      const tagHtml = n.status === "active" ? '<span class="sys-badge active">' + (n.entry_url || ['problems', 'projects', 'standardization'].includes(n.route_path) ? '可用' : '待配置') + '</span>' : 
                      n.status === "planned" ? '<span class="sys-badge planned">规划中</span>' :
                      n.status === "draft" ? '<span class="sys-badge draft">草稿</span>' : '';
                      
      const label = isApp ? n.name : n.label;
      const key = isApp ? n.route_path : n.key;

      return '<button type="button" class="nav-item" data-key="' + UI.esc(key) + '">' +
        '<span class="nav-ico">' + iconSvg + '</span><span>' + UI.esc(label || "") + '</span>' + tagHtml + '</button>';
    }).join("");

    el.querySelectorAll(".nav-item[data-key]").forEach((item) => {
        item.addEventListener("click", () => {
          setMobileNavOpen(false);
          const app = isApp && items.find((candidate) => candidate.route_path === item.dataset.key);
          if (app && app.entry_url) window.open(app.entry_url, '_blank', 'noopener');
          else if (app && ['problems', 'projects', 'standardization'].includes(app.route_path)) Router.go(item.dataset.key);
          else if (app) Router.go('app_center');
          else Router.go(item.dataset.key);
        });
    });
  }

  // 初始化加载
  async function init() {
    const mobileToggle = document.getElementById("mobileNavToggle");
    const mobileBackdrop = document.getElementById("mobileNavBackdrop");
    if (mobileToggle) mobileToggle.addEventListener("click", () => {
      setMobileNavOpen(!document.querySelector(".sidebar")?.classList.contains("mobile-open"));
    });
    if (mobileBackdrop) mobileBackdrop.addEventListener("click", () => setMobileNavOpen(false));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    });

    renderNavGroup("navWorkspace", WORKSPACE_NAVS);
    renderNavGroup("navPlatform", PLATFORM_NAVS);

    // Display the server-authenticated principal; never infer or hard-code an employee identity.
    try {
      const session = await api.get("/api/system/session");
      const nameEl = document.getElementById("currentUserName");
      const avatarEl = document.getElementById("currentUserAvatar");
      if (nameEl) nameEl.textContent = session.actor || "已认证用户";
      if (avatarEl) avatarEl.textContent = String(session.actor || "?").trim().slice(0, 1).toUpperCase() || "?";
      const envEl = document.getElementById("envBadge");
      const runtimeEl = document.getElementById("runtimeBadge");
      if (envEl) envEl.textContent = session.production ? "生产环境" : "开发 / 试点环境";
      if (runtimeEl) {
        runtimeEl.textContent = session.production ? "生产环境 · 已认证" : "开发 / 试点环境";
        runtimeEl.classList.toggle("is-production", !!session.production);
        runtimeEl.classList.toggle("is-development", !session.production);
      }
    } catch (error) {
      const nameEl = document.getElementById("currentUserName");
      const runtimeEl = document.getElementById("runtimeBadge");
      if (nameEl) nameEl.textContent = "当前会话不可用";
      if (runtimeEl) {
        runtimeEl.textContent = "认证状态不可用";
        runtimeEl.classList.remove("is-production", "is-development");
      }
    }
    
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
