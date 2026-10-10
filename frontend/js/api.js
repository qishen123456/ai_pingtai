// API 统一封装：JSON 与表单上传，错误转中文可读信息
const api = (function () {
  async function request(method, url, body, isForm) {
    const opts = { method, headers: {} };
    if (body !== undefined && body !== null) {
      if (isForm) {
        opts.body = body; // FormData
      } else {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(body);
      }
    }
    const resp = await fetch(url, opts);
    let data = null;
    const text = await resp.text();
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    }
    if (!resp.ok) {
      const message = (data && (data.detail || data.message)) || ("请求失败（HTTP %d）".replace("%d", resp.status));
      const err = new Error(message);
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  return {
    get: (url) => request("GET", url),
    post: (url, body) => request("POST", url, body || {}),
    patch: (url, body) => request("PATCH", url, body || {}),
    upload: (url, formData) => request("POST", url, formData, true),
  };
})();
