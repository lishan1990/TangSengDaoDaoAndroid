/**
 * 唐僧叨叨管理后台补丁：「客户端生成」菜单 + 安卓 APK 在线构建页面
 * 注入点：index-3da832da.js 末尾追加，不改动任何原有代码
 * 功能：
 *  1. 登录后侧边栏自动出现「客户端生成」菜单项（克隆现有菜单项样式）
 *  2. 点击后弹出构建页：生成安卓客户端按钮 → 进度条（轮询 GitHub Actions 状态）→ 下载按钮
 *  3. 下载链接自动加前缀 https://v4.gh-proxy.org/（国内加速）
 * 依赖：网关 /gw/build/start 与 /gw/build/status（CORS 已开放）
 */
(function () {
  "use strict";
  if (window.__TSDD_BUILD_PATCH__) return;
  window.__TSDD_BUILD_PATCH__ = true;

  var GW_BASE = location.protocol + "//" + location.hostname + ":9002";
  var PROXY_PREFIX = "https://v4.gh-proxy.org/";
  var POLL_MS = 10000;

  /* ---------------- 构建页 UI ---------------- */
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
          var p = Math.min(92, 12 + elapsed / 9); // 约 12 分钟到 90%
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
    // 打开页面时若有正在进行的构建则恢复进度显示
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

  /* ---------------- 菜单注入 ---------------- */
  var PHONE_SVG = '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 3v12h10V5H7zm5 13.5a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z" fill="currentColor"></path></svg>';

  // 布局1：LayoutColumns（.split-list > .split-item，图标+竖排文字）
  function injectSplit() {
    var list = document.querySelector(".split-list");
    if (!list || !list.children.length || document.getElementById("tsdd-menu-build-split")) return;
    var tpl = null;
    var items = Array.prototype.slice.call(list.querySelectorAll(".split-item"));
    for (var i = 0; i < items.length; i++) {
      if ((items[i].innerText || "").indexOf("设置") > -1 || (items[i].innerText || "").indexOf("工具") > -1) { tpl = items[i]; break; }
    }
    if (!tpl) tpl = items[items.length - 1];
    var el = tpl.cloneNode(true);
    el.id = "tsdd-menu-build-split";
    el.className = String(tpl.className).replace("split-active", "").trim();
    var svg = el.querySelector("svg");
    if (svg) {
      svg.outerHTML = PHONE_SVG;
    }
    var title = el.querySelector(".title");
    if (title) { title.textContent = "客户端生成"; title.style.cssText += "font-size:10px;white-space:nowrap;"; }
    el.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      openBuild();
    });
    list.appendChild(el);
  }
  // 布局2：经典 el-menu（Vertical/Classic 布局）
  function injectElMenu() {
    if (document.getElementById("tsdd-menu-build")) return true;
    var aside = document.querySelector("aside.el-aside") || document.querySelector(".el-aside");
    if (!aside) return false;
    var menu = aside.querySelector(".el-menu");
    if (!menu || !menu.children.length) return false;
    var items = Array.prototype.slice.call(menu.children).filter(function (li) {
      return /el-menu-item|el-sub-menu/.test(String(li.className));
    });
    if (!items.length) return false;
    var tpl = null;
    for (var i = 0; i < items.length; i++) {
      if ((items[i].innerText || "").indexOf("设置") > -1 || (items[i].innerText || "").indexOf("工具") > -1) { tpl = items[i]; break; }
    }
    if (!tpl) tpl = items[items.length - 1];
    var li = tpl.cloneNode(true);
    li.id = "tsdd-menu-build";
    li.className = String(tpl.className).replace("is-active", "").trim();
    var svg = li.querySelector("svg");
    if (svg) svg.outerHTML = PHONE_SVG;
    var span = li.querySelector("span");
    if (!span) { span = document.createElement("span"); li.appendChild(span); }
    span.textContent = "客户端生成";
    li.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      openBuild();
    });
    menu.appendChild(li);
    return true;
  }
  function injectMenu() {
    injectSplit();
    return injectElMenu();
  }

  var mo = new MutationObserver(function () { injectMenu(); });
  function startWatch() {
    if (injectMenu()) return;
    mo.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startWatch);
  } else {
    startWatch();
  }
  console.log("[TSDD] 客户端生成补丁已加载");
})();
