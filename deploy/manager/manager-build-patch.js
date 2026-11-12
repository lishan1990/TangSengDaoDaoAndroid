/**
 * 唐僧叨叨管理后台补丁 v3：「客户端生成」+「注册设置」两个菜单
 * 注入点：index-3da832da.js 末尾追加，不改动任何原有代码
 * 功能：
 *  1. 左侧一级图标栏底部出现「客户端生成」与「注册设置」（与原生 split-item 同款样式）
 *  2. 客户端生成：按钮 → 进度条（轮询 GitHub Actions）→ 下载按钮（gh-proxy 加速）
 *  3. 注册设置：内嵌同源页面 /gw-admin.html，直接管理验证码模式、文件大小限制等
 * 说明：网关管理页不再单独占用 9002 端口，接口统一走主业务端口 8112（CORS 已开放）
 * v3 修复：v2 同时向 .split-list 与 .el-menu 注入，导致二级菜单出现重复项且标题拼接成
 *         「注册设置管理员」；且自绘图标为实心 24 viewBox、文字被压到 10px，与原生
 *         线性图标不一致。v3 仅在 .split-list 注入，并清理历史遗留的重复节点。
 */
(function () {
  "use strict";
  if (window.__TSDD_BUILD_PATCH__) return;
  window.__TSDD_BUILD_PATCH__ = true;

  var GW_BASE = location.protocol + "//" + location.hostname + ":8112";
  var SETTINGS_PAGE = "/gw-admin.html";
  var PROXY_PREFIX = "https://v4.gh-proxy.org/";
  var POLL_MS = 10000;

  /* 图标统一使用官方风格：48 viewBox + currentColor 描边 + stroke-width 4 */
  var PHONE_SVG = '<svg width="1em" height="1em" viewBox="0 0 48 48" fill="none"><rect x="12" y="4" width="24" height="40" rx="3" stroke="currentColor" stroke-width="4"></rect><path d="M20 38h8" stroke="currentColor" stroke-width="4" stroke-linecap="round"></path><path d="M20 11h8" stroke="currentColor" stroke-width="4" stroke-linecap="round"></path></svg>';
  var GEAR_SVG = '<svg width="1em" height="1em" viewBox="0 0 48 48" fill="none"><rect x="9" y="6" width="30" height="36" rx="3" stroke="currentColor" stroke-width="4"></rect><path d="M17 18h14M17 27h14M17 34h8" stroke="currentColor" stroke-width="4" stroke-linecap="round"></path></svg>';

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

  /* ---------------- 菜单注入：只在左侧一级图标栏出现一次 ---------------- */
  var MENUS = [
    { id: "build", title: "客户端生成", svg: PHONE_SVG, open: openBuild },
    { id: "settings", title: "注册设置", svg: GEAR_SVG, open: openSettings }
  ];

  /* 取一个原生、未选中的一级菜单项做模板，保留 scoped 属性让原生样式生效 */
  function pickTpl(items) {
    for (var i = 0; i < items.length; i++) {
      var txt = items[i].innerText || "";
      if (txt.indexOf("设置") > -1 || txt.indexOf("工具") > -1) return items[i];
    }
    return items[0] || null;
  }

  function cloneItem(tpl, id, menu) {
    var el = tpl.cloneNode(true);
    el.id = id;
    el.setAttribute("data-tsdd-split", "1");
    el.setAttribute("title", menu.title);
    el.className = String(tpl.className).replace(/split-active|is-active/g, "").trim();
    /* 保留官方 <span class="i-icon"> 容器，只替换内部 SVG */
    var svg = el.querySelector("svg");
    if (svg && menu.svg) svg.outerHTML = menu.svg;
    /* 只替换标题文字，图标尺寸/描边风格与其余项完全一致 */
    var title = el.querySelector(".title");
    if (!title) {
      title = document.createElement("span");
      title.className = "title";
      var ref = el.querySelector("[data-v-337019ad]");
      if (ref) title.setAttribute("data-v-337019ad", "");
      el.appendChild(title);
    }
    title.textContent = menu.title;
    title.style.whiteSpace = "nowrap";
    title.style.fontSize = "12px";
    title.style.letterSpacing = "-.2px";
    el.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      menu.open();
    });
    return el;
  }

  /* v2 会同时向 .el-menu（中间二级菜单）注入，标题还会拼成「注册设置管理员」。
     主动清理这些历史节点，保证任何页面状态下都只有左侧一处入口。 */
  function cleanupLegacy() {
    var nodes = document.querySelectorAll('[id^="tsdd-menu-"]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.getAttribute("data-tsdd-split") === "1" && n.parentElement &&
          n.parentElement.classList.contains("split-list")) continue;
      if (n.parentNode) n.parentNode.removeChild(n);
    }
  }

  function injectSplit() {
    var list = document.querySelector(".split-list");
    if (!list) return false;
    var own = Array.prototype.slice.call(list.children).filter(function (c) {
      return c.classList && c.classList.contains("split-item") &&
             c.getAttribute("data-tsdd-split") !== "1";
    });
    if (!own.length) return false;
    var tpl = pickTpl(own);
    if (!tpl) return false;
    for (var i = 0; i < MENUS.length; i++) {
      var m = MENUS[i], id = "tsdd-menu-" + m.id + "-split";
      var old = document.getElementById(id);
      if (old) {
        /* 已是 v3 节点则跳过，避免 MutationObserver 反复重建导致闪烁 */
        if (old.getAttribute("data-tsdd-split") === "1") continue;
        old.parentNode.removeChild(old);
      }
      list.appendChild(cloneItem(tpl, id, m));
    }
    return true;
  }

  function injectMenu() {
    cleanupLegacy();
    return injectSplit();
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
  console.log("[TSDD] 客户端生成 / 注册设置补丁 v3 已加载");
})();
