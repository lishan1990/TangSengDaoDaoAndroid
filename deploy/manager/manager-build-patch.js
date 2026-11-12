/**
 * 唐僧叨叨管理后台补丁 v2：「客户端生成」+「注册设置」两个菜单
 * 注入点：index-3da832da.js 末尾追加，不改动任何原有代码
 * 功能：
 *  1. 登录后侧边栏自动出现「客户端生成」与「注册设置」菜单项（克隆现有菜单项样式）
 *  2. 客户端生成：按钮 → 进度条（轮询 GitHub Actions）→ 下载按钮（gh-proxy 加速）
 *  3. 注册设置：内嵌同源页面 /gw-admin.html，直接管理验证码模式、文件大小限制等
 * 说明：网关管理页不再单独占用 9002 端口，接口统一走主业务端口 8112（CORS 已开放）
 */
(function () {
  "use strict";
  if (window.__TSDD_BUILD_PATCH__) return;
  window.__TSDD_BUILD_PATCH__ = true;

  var GW_BASE = location.protocol + "//" + location.hostname + ":8112";
  var SETTINGS_PAGE = "/gw-admin.html";
  var PROXY_PREFIX = "https://v4.gh-proxy.org/";
  var POLL_MS = 10000;

  var PHONE_SVG = '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 3v12h10V5H7zm5 13.5a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z" fill="currentColor"></path></svg>';
  var GEAR_SVG = '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9.4 4c0-.5 0-1-.1-1.5l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L13.9 2h-3.8l-.4 2.5c-1 .3-1.8.8-2.6 1.5l-2.4-1-2 3.4 2 1.6a8 8 0 0 0 0 3l-2 1.6 2 3.4 2.4-1c.8.7 1.6 1.2 2.6 1.5l.4 2.5h3.8l.4-2.5c1-.3 1.8-.8 2.6-1.5l2.4 1 2-3.4-2-1.6c.1-.5.1-1 .1-1.5z" fill="currentColor"></path></svg>';

  /* ---------------- 客户端生成弹层 ---------------- */
  function ensureOverlay() {
    if (document.getElementById("tsdd-build-mask")) return;
    var mask = document.createElement("div");
    mask.id = "tsdd-build-mask";
    mask.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99999;display:none;align-items:center;justify-content:center;";
    mask.innerHTML =
      '<div style="background:#fff;border-radius:12px;width:520px;max-width:92vw;padding:28px 32px;box-shadow:0 8px 40px rgba(0,0,0,.2)">' +
      '<div style="display:flex;align-items:center;justify-content:space-between">' +
      '<div style="font-size:18px;font-weight:600;color:#303133">生成安卓客户端</div>' +
      '<div id="tsdd-build-close" style="cursor:pointer;font-size:20px;color:#909399;padding:0 4px">✕</div></div>' +
      '<div style="font-size:13px;color:#909399;margin-top:6px">在 GitHub 云端自动编译（注入服务器地址 182.44.6.48），完成后生成下载链接</div>' +
      '<div style="margin-top:20px">' +
      '<button id="tsdd-build-start" style="width:100%;height:42px;border:none;border-radius:6px;background:#fc4b35;color:#fff;font-size:15px;cursor:pointer">生成安卓客户端</button>' +
      "</div>" +
      '<div id="tsdd-build-progress-wrap" style="display:none;margin-top:20px">' +
      '<div style="height:10px;background:#eee;border-radius:5px;overflow:hidden">' +
      '<div id="tsdd-build-progress" style="height:100%;width:0;background:linear-gradient(90deg,#fc8f35,#fc4b35);border-radius:5px;transition:width .6s"></div></div>' +
      '<div id="tsdd-build-status" style="font-size:13px;color:#606266;margin-top:10px">准备中…</div>' +
      "</div>" +
      '<div id="tsdd-build-result" style="display:none;margin-top:20px;text-align:center">' +
      '<a id="tsdd-build-download" href="#" style="display:block;width:100%;height:42px;line-height:42px;border:none;border-radius:6px;background:#fc4b35;color:#fff;font-size:15px;text-decoration:none;box-sizing:border-box">下载安卓客户端 APK</a>' +
      '<div id="tsdd-build-log" style="margin-top:10px;font-size:12px"><a href="#" target="_blank" style="color:#3d7fff;text-decoration:none">查看构建日志</a></div>' +
      "</div>" +
      '<div id="tsdd-build-msg" style="font-size:13px;color:#f56c6c;margin-top:12px;min-height:16px;text-align:center"></div>' +
      "</div>";
    document.body.appendChild(mask);
    mask.querySelector("#tsdd-build-close").onclick = function () { mask.style.display = "none"; stopPoll(); };
    mask.addEventListener("click", function (e) { if (e.target === mask) { mask.style.display = "none"; stopPoll(); } });

    var timer = null;
    function stopPoll() { if (timer) { clearInterval(timer); timer = null; } }
    function setProgress(p, text) {
      mask.querySelector("#tsdd-build-progress").style.width = p + "%";
      mask.querySelector("#tsdd-build-status").textContent = text;
    }
    function showResult(run) {
      mask.querySelector("#tsdd-build-result").style.display = "block";
      var a = mask.querySelector("#tsdd-build-download");
      a.href = PROXY_PREFIX + run.apkUrl;
      a.textContent = "下载安卓客户端 APK（v" + run.runNumber + "）";
      mask.querySelector("#tsdd-build-log a").href = run.runUrl || "#";
    }
    function poll() {
      fetch(GW_BASE + "/gw/build/status").then(function (r) { return r.json(); }).then(function (j) {
        if (j.state === "none") return;
        if (j.state === "queued") { setProgress(6, "排队中，等待 GitHub 分配构建机…"); return; }
        if (j.state === "in_progress") {
          var elapsed = (Date.now() - new Date(j.createdAt).getTime()) / 1000;
          var p = Math.min(92, 12 + elapsed / 9);
          setProgress(p, "正在云端编译（已进行 " + Math.round(elapsed / 60) + " 分钟）…");
          return;
        }
        if (j.state === "completed") {
          stopPoll();
          if (j.conclusion === "success" && j.apkUrl) {
            setProgress(100, "编译完成！");
            showResult(j);
          } else {
            setProgress(100, "编译失败，可点击下方按钮重新生成");
            mask.querySelector("#tsdd-build-progress").style.background = "#f56c6c";
            mask.querySelector("#tsdd-build-start").textContent = "重新生成";
            mask.querySelector("#tsdd-build-start").disabled = false;
          }
        }
      }).catch(function () {});
    }
    mask.querySelector("#tsdd-build-start").onclick = function () {
      var btn = this;
      var msg = mask.querySelector("#tsdd-build-msg");
      msg.textContent = "";
      btn.disabled = true;
      btn.textContent = "正在触发云端编译…";
      fetch(GW_BASE + "/gw/build/start", { method: "POST" }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.status === 200) {
          mask.querySelector("#tsdd-build-progress-wrap").style.display = "block";
          mask.querySelector("#tsdd-build-result").style.display = "none";
          mask.querySelector("#tsdd-build-progress").style.background = "linear-gradient(90deg,#fc8f35,#fc4b35)";
          setProgress(3, "已触发，等待 GitHub 响应…");
          stopPoll();
          setTimeout(poll, 5000);
          timer = setInterval(poll, POLL_MS);
        } else {
          msg.textContent = j.msg || "触发失败";
          btn.disabled = false;
          btn.textContent = "生成安卓客户端";
        }
      }).catch(function () {
        msg.textContent = "网络错误，无法连接构建网关";
        btn.disabled = false;
        btn.textContent = "生成安卓客户端";
      });
    };
    mask.addEventListener("tsdd-open", function () {
      fetch(GW_BASE + "/gw/build/status").then(function (r) { return r.json(); }).then(function (j) {
        if (j.state === "queued" || j.state === "in_progress") {
          mask.querySelector("#tsdd-build-progress-wrap").style.display = "block";
          mask.querySelector("#tsdd-build-start").disabled = true;
          btnTextRefresh();
          stopPoll();
          poll();
          timer = setInterval(poll, POLL_MS);
        } else if (j.state === "completed" && j.conclusion === "success" && j.apkUrl) {
          mask.querySelector("#tsdd-build-progress-wrap").style.display = "block";
          setProgress(100, "最近一次编译已完成");
          showResult(j);
        }
      }).catch(function () {});
      function btnTextRefresh() {
        var b = mask.querySelector("#tsdd-build-start");
        if (b && b.disabled) b.textContent = "云端编译中…";
      }
    });
  }

  function openBuild() {
    ensureOverlay();
    var mask = document.getElementById("tsdd-build-mask");
    mask.style.display = "flex";
    mask.dispatchEvent(new Event("tsdd-open"));
  }

  /* ---------------- 注册设置弹层（内嵌 8110 同源页面） ---------------- */
  function ensureSettingsOverlay() {
    if (document.getElementById("tsdd-settings-mask")) return;
    var mask = document.createElement("div");
    mask.id = "tsdd-settings-mask";
    mask.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100000;display:none;align-items:center;justify-content:center;";
    mask.innerHTML =
      '<div style="background:#fff;border-radius:12px;width:440px;max-width:92vw;padding:20px 22px 22px;box-shadow:0 8px 40px rgba(0,0,0,.2)">' +
      '<div style="display:flex;align-items:center;justify-content:space-between">' +
      '<div style="font-size:18px;font-weight:600;color:#303133">注册设置</div>' +
      '<div id="tsdd-settings-close" style="cursor:pointer;font-size:20px;color:#909399;padding:0 4px">✕</div></div>' +
      '<div style="font-size:12px;color:#909399;margin-top:4px">验证码模式、IP 注册限制与客户端文件大小上限</div>' +
      '<iframe id="tsdd-settings-frame" src="' + SETTINGS_PAGE + '" style="width:100%;height:500px;border:0;margin-top:12px"></iframe>' +
      "</div>";
    document.body.appendChild(mask);
    var close = function () { mask.style.display = "none"; };
    mask.querySelector("#tsdd-settings-close").onclick = close;
    mask.addEventListener("click", function (e) { if (e.target === mask) close(); });
  }

  function openSettings() {
    ensureSettingsOverlay();
    var mask = document.getElementById("tsdd-settings-mask");
    mask.style.display = "flex";
    var frame = mask.querySelector("#tsdd-settings-frame");
    if (frame) frame.src = SETTINGS_PAGE + "?t=" + Date.now();
  }

  /* ---------------- 菜单注入（支持多个自定义菜单） ---------------- */
  var MENUS = [
    { id: "build", title: "客户端生成", svg: PHONE_SVG, open: openBuild },
    { id: "settings", title: "注册设置", svg: GEAR_SVG, open: openSettings }
  ];

  function pickTpl(items) {
    for (var i = 0; i < items.length; i++) {
      var txt = items[i].innerText || "";
      if (txt.indexOf("设置") > -1 || txt.indexOf("工具") > -1) return items[i];
    }
    return items[items.length - 1];
  }

  function cloneItem(tpl, id, menu) {
    var el = tpl.cloneNode(true);
    el.id = id;
    el.className = String(tpl.className).replace(/split-active|is-active/g, "").trim();
    var svg = el.querySelector("svg");
    if (svg && menu.svg) svg.outerHTML = menu.svg;
    var title = el.querySelector(".title") || el.querySelector("span");
    if (title) {
      title.textContent = menu.title;
      title.style.cssText += "font-size:10px;white-space:nowrap;";
    }
    el.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      menu.open();
    });
    return el;
  }

  // 布局1：LayoutColumns（.split-list > .split-item）
  function injectSplit() {
    var list = document.querySelector(".split-list");
    if (!list || !list.children.length) return false;
    var items = Array.prototype.slice.call(list.querySelectorAll(".split-item"));
    if (!items.length) return false;
    var tpl = pickTpl(items);
    for (var i = 0; i < MENUS.length; i++) {
      var m = MENUS[i], id = "tsdd-menu-" + m.id + "-split";
      if (document.getElementById(id)) continue;
      list.appendChild(cloneItem(tpl, id, m));
    }
    return true;
  }

  // 布局2：经典 el-menu（Vertical/Classic）
  function injectElMenu() {
    var aside = document.querySelector("aside.el-aside") || document.querySelector(".el-aside");
    if (!aside) return false;
    var menu = aside.querySelector(".el-menu");
    if (!menu || !menu.children.length) return false;
    var items = Array.prototype.slice.call(menu.children).filter(function (li) {
      return /el-menu-item|el-sub-menu/.test(String(li.className));
    });
    if (!items.length) return false;
    var tpl = pickTpl(items);
    for (var i = 0; i < MENUS.length; i++) {
      var m = MENUS[i], id = "tsdd-menu-" + m.id;
      if (document.getElementById(id)) continue;
      menu.appendChild(cloneItem(tpl, id, m));
    }
    return true;
  }

  function injectMenu() {
    var a = injectSplit();
    var b = injectElMenu();
    return a || b;
  }

  var mo = new MutationObserver(function () { injectMenu(); });
  function startWatch() {
    injectMenu();
    mo.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startWatch);
  } else {
    startWatch();
  }
  console.log("[TSDD] 客户端生成 / 注册设置补丁已加载");
})();
