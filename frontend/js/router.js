// 极简 hash 路由：#/view 或 #/view/param
const Router = (function () {
  const handlers = [];
  function parse() {
    const raw = (location.hash || "#/dashboard").replace(/^#\/?/, "");
    const parts = raw.split("/").filter(Boolean);
    return { view: parts[0] || "dashboard", param: parts[1] || "" };
  }
  window.addEventListener("hashchange", emit);
  function emit() {
    const route = parse();
    handlers.forEach((fn) => fn(route));
  }
  return {
    onChange(fn) { handlers.push(fn); },
    go(view, param) { location.hash = "#/" + view + (param ? "/" + param : ""); },
    current: parse,
    emit,
  };
})();
