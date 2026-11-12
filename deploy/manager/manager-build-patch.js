/**
 * 唐僧叨叨管理后台补丁 v4
 * 注入点：index-3da832da.js 末尾追加，不改动任何原有代码
 *
 * 1. 左侧一级图标栏新增「客户端生成」「注册设置」，样式与原生 split-item 完全一致
 * 2. 两个功能不再是全屏弹窗，而是内嵌到后台主内容区（顶栏/侧边栏保持可见可点击）
 * 3. 客户端生成页支持自定义：名称、平台（PC / 安卓 / iOS）、图标；
 *    配置经网关 /gw/client/config 持久化到服务器，下次进入自动回填
 * 4. 云端编译保留进度条与 https://v4.gh-proxy.org/ 加速下载
 *
 * v4 变更：菜单恢复原生 14px 字号与 68×62 尺寸；去掉 ?v=3 版本号（会导致主包重复加载白屏）；
 *         删除 v2/v3 的全屏 mask 弹层；新增客户端配置读写。
 */
(function () {
  "use strict";
  if (window.__TSDD_BUILD_PATCH__) return;
  window.__TSDD_BUILD_PATCH__ = true;

  var GW_BASE = location.protocol + "//" + location.hostname + ":8112";
  var SETTINGS_PAGE = "/gw-admin.html";
  var PROXY_PREFIX = "https://v4.gh-proxy.org/";
  var POLL_MS = 10000;
  var PLATFORM_LABEL = { pc: "PC", android: "安卓", ios: "iOS" };

  /* 图标统一使用官方风格：48 viewBox + currentColor 描边 + stroke-width 4 */
  var PHONE_SVG = '<svg width="1em" height="1em" viewBox="0 0 48 48" fill="none"><rect x="12" y="4" width="24" height="40" rx="3" stroke="currentColor" stroke-width="4"></rect><path d="M20 38h8" stroke="currentColor" stroke-width="4" stroke-linecap="round"></path><path d="M20 11h8" stroke="currentColor" stroke-width="4" stroke-linecap="round"></path></svg>';
  var GEAR_SVG = '<svg width="1em" height="1em" viewBox="0 0 48 48" fill="none"><rect x="9" y="6" width="30" height="36" rx="3" stroke="currentColor" stroke-width="4"></rect><path d="M17 18h14M17 27h14M17 34h8" stroke="currentColor" stroke-width="4" stroke-linecap="round"></path></svg>';

  var DEFAULT_ICON = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72"><rect width="72" height="72" fill="#f5f7fa"/><rect x="25" y="12" width="22" height="48" rx="4" fill="none" stroke="#c0c4cc" stroke-width="3"/><path d="M32 54h8" stroke="#c0c4cc" stroke-width="3" stroke-linecap="round"/></svg>'
  );

  /* ================= 内嵌页容器 ================= */
  var pageEl = null;
  var pageRO = null;
  var pollTimer = null;

  function findHost() {
    return document.querySelector("main.el-main") || document.querySelector(".el-main");
  }

  function ensurePageStyle() {
    if (document.getElementById("tsdd-page-style")) return;
    var st = document.createElement("style");
    st.id = "tsdd-page-style";
    st.textContent = [
      "#tsdd-page{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:#303133;font-size:14px}",
      ".tsdd-head{height:56px;background:#fff;border-bottom:1px solid #ebeef5;display:flex;align-items:center;justify-content:space-between;padding:0 22px;box-sizing:border-box}",
      ".tsdd-head h2{font-size:17px;font-weight:600;margin:0}",
      ".tsdd-back{cursor:pointer;font-size:13px;color:#909399;border:1px solid #dcdfe6;border-radius:5px;padding:6px 12px;background:#fff}",
      ".tsdd-back:hover{color:#fc4b35;border-color:#fc4b35}",
      ".tsdd-body{padding:20px 22px 34px}",
      ".tsdd-card{background:#fff;border-radius:8px;padding:20px 22px;margin-bottom:18px;box-shadow:0 1px 4px rgba(0,0,0,.05)}",
      ".tsdd-card h3{font-size:15px;font-weight:600;margin:0 0 18px}",
      ".tsdd-card h3 small{font-size:12px;color:#909399;font-weight:400;margin-left:10px}",
      ".tsdd-row{margin-bottom:18px}",
      ".tsdd-row>label{display:block;font-size:13px;color:#606266;margin-bottom:8px}",
      ".tsdd-input{width:300px;max-width:100%;height:38px;box-sizing:border-box;border:1px solid #dcdfe6;border-radius:6px;padding:0 12px;font-size:14px;outline:none}",
      ".tsdd-input:focus{border-color:#fc4b35}",
      ".tsdd-platforms{display:flex;gap:26px;flex-wrap:wrap}",
      ".tsdd-platforms label{display:flex;align-items:center;gap:7px;font-size:14px;cursor:pointer}",
      ".tsdd-icon-row{display:flex;align-items:center;gap:16px}",
      "#tsdd-icon-preview{width:72px;height:72px;border:1px solid #ebeef5;border-radius:10px;object-fit:cover;background:#f7f8fa;flex-shrink:0}",
      ".tsdd-btn{height:38px;border:none;border-radius:6px;padding:0 20px;font-size:14px;cursor:pointer}",
      ".tsdd-btn-primary{background:#fc4b35;color:#fff}",
      ".tsdd-btn-primary:hover{background:#f36c5a}",
      ".tsdd-btn-ghost{background:#f5f7fa;color:#606266;border:1px solid #dcdfe6}",
      ".tsdd-btn:disabled{opacity:.6;cursor:default}",
      ".tsdd-hint{font-size:12px;color:#909399;line-height:1.7;margin-top:8px}",
      ".tsdd-msg{font-size:13px;min-height:18px;margin-left:12px;color:#67c23a}",
      ".tsdd-current{font-size:13px;color:#606266;margin-bottom:14px}",
      ".tsdd-progress-wrap{display:none;margin-top:18px}",
      ".tsdd-progress{height:10px;background:#eee;border-radius:5px;overflow:hidden}",
      ".tsdd-progress>div{height:100%;width:0;background:linear-gradient(90deg,#fc8f35,#fc4b35);border-radius:5px;transition:width .6s}",
      ".tsdd-status{font-size:13px;color:#606266;margin-top:10px}",
      "#tsdd-build-result{display:none;margin-top:18px}",
      "#tsdd-build-download{display:inline-block;height:38px;line-height:38px;padding:0 22px;border-radius:6px;background:#fc4b35;color:#fff;text-decoration:none;font-size:14px}",
      "#tsdd-build-log{display:inline-block;margin-left:16px;color:#3d7fff;font-size:13px;text-decoration:none}",
      "#tsdd-settings-frame{width:100%;height:600px;border:0;background:transparent}",
      ".tsdd-divider{height:1px;background:#ebeef5;margin:0 0 18px}"
    ].join("");
    document.head.appendChild(st);
  }

  function positionPage() {
    var host = findHost();
    if (!host || !pageEl) return;
    var r = host.getBoundingClientRect();
    pageEl.style.left = r.left + "px";
    pageEl.style.top = r.top + "px";
    pageEl.style.width = r.width + "px";
    pageEl.style.height = r.height + "px";
  }

  function ensurePage() {
    if (pageEl && pageEl.parentNode) return pageEl;
    ensurePageStyle();
    pageEl = document.createElement("div");
    pageEl.id = "tsdd-page";
    pageEl.style.cssText = "position:fixed;z-index:900;background:#f5f6fa;overflow:auto;display:none;box-sizing:border-box;";
    document.body.appendChild(pageEl);
    window.addEventListener("resize", positionPage);
    var host = findHost();
    if (window.ResizeObserver && host) {
      if (pageRO) pageRO.disconnect();
      pageRO = new ResizeObserver(positionPage);
      pageRO.observe(host);
    }
    return pageEl;
  }

  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function clearActiveMenu() {
    var list = document.querySelectorAll('[data-tsdd-split="1"]');
    for (var i = 0; i < list.length; i++) list[i].classList.remove("split-active");
  }

  function closePage() {
    if (pageEl) pageEl.style.display = "none";
    stopPoll();
    clearActiveMenu();
  }

  function openPage(title, bodyHTML, menuId, onReady) {
    stopPoll();
    var el = ensurePage();
    el.innerHTML =
      '<div class="tsdd-head"><h2>' + title + '</h2><div class="tsdd-back" id="tsdd-page-close">返回后台</div></div>' +
      '<div class="tsdd-body">' + bodyHTML + "</div>";
    el.style.display = "block";
    positionPage();
    el.scrollTop = 0;
    el.querySelector("#tsdd-page-close").onclick = closePage;
    clearActiveMenu();
    if (menuId) {
      var m = document.getElementById(menuId);
      if (m) m.classList.add("split-active");
    }
    if (onReady) onReady(el);
  }

  /* 点击其它菜单时收起内嵌页，保持与后台路由行为一致 */
  document.addEventListener("click", function (e) {
    if (!pageEl || pageEl.style.display === "none") return;
    var t = e.target;
    if (pageEl.contains(t)) return;
    if (t.closest && t.closest('[data-tsdd-split="1"]')) return;
    if (t.closest && (t.closest(".split-list") || t.closest(".el-menu") ||
                      t.closest(".tabs-box") || t.closest(".el-header"))) closePage();
  }, true);

  /* ================= 客户端生成页 ================= */
  function clientPageHTML() {
    return '' +
      '<div class="tsdd-card">' +
      '  <h3>客户端配置<small>保存后下次进入本页自动加载</small></h3>' +
      '  <div class="tsdd-row"><label>客户端名称</label>' +
      '    <input class="tsdd-input" id="tsdd-client-name" type="text" maxlength="40" placeholder="例如：唐僧叨叨"></div>' +
      '  <div class="tsdd-row"><label>客户端平台</label>' +
      '    <div class="tsdd-platforms">' +
      '      <label><input type="radio" name="tsdd-platform" value="pc"> PC</label>' +
      '      <label><input type="radio" name="tsdd-platform" value="android"> 安卓</label>' +
      '      <label><input type="radio" name="tsdd-platform" value="ios"> iOS</label>' +
      '    </div></div>' +
      '  <div class="tsdd-row"><label>客户端图标</label>' +
      '    <div class="tsdd-icon-row">' +
      '      <img id="tsdd-icon-preview" alt="图标预览">' +
      '      <div>' +
      '        <input type="file" id="tsdd-icon-file" accept="image/png,image/jpeg,image/webp" style="display:none">' +
      '        <button class="tsdd-btn tsdd-btn-ghost" id="tsdd-icon-pick">选择图片</button>' +
      '        <button class="tsdd-btn tsdd-btn-ghost" id="tsdd-icon-clear" style="margin-left:8px">移除</button>' +
      '        <div class="tsdd-hint">建议正方形 PNG / JPEG / WebP；自动压缩为 192×192。名称会写入 APK 应用名。</div>' +
      '      </div></div></div>' +
      '  <div style="display:flex;align-items:center">' +
      '    <button class="tsdd-btn tsdd-btn-primary" id="tsdd-client-save">保存配置</button>' +
      '    <span class="tsdd-msg" id="tsdd-client-msg"></span></div>' +
      '</div>' +
      '<div class="tsdd-card">' +
      '  <h3>云端编译</h3>' +
      '  <div class="tsdd-current" id="tsdd-build-current">当前配置：—</div>' +
      '  <button class="tsdd-btn tsdd-btn-primary" id="tsdd-build-start">生成客户端</button>' +
      '  <div class="tsdd-progress-wrap" id="tsdd-build-progress-wrap">' +
      '    <div class="tsdd-progress"><div id="tsdd-build-progress"></div></div>' +
      '    <div class="tsdd-status" id="tsdd-build-status">准备中…</div></div>' +
      '  <div id="tsdd-build-result">' +
      '    <a id="tsdd-build-download" href="#" target="_blank">下载安卓客户端 APK</a>' +
      '    <a id="tsdd-build-log" href="#" target="_blank">查看构建日志</a></div>' +
      '  <div class="tsdd-msg" id="tsdd-build-msg" style="margin:12px 0 0"></div>' +
      '  <div class="tsdd-hint">当前云端编译流水线仅支持安卓；选择 PC / iOS 时配置照常保存，但不会触发编译。</div>' +
      '</div>';
  }

  function initClientPage(el) {
    var $ = function (id) { return el.querySelector("#" + id); };
    var state = { name: "唐僧叨叨", platform: "android", icon: "" };

    function setMsg(text, ok) {
      var m = $("tsdd-client-msg");
      m.textContent = text;
      m.style.color = ok ? "#67c23a" : "#f56c6c";
    }
    function setBuildMsg(text, ok) {
      var m = $("tsdd-build-msg");
      m.textContent = text;
      m.style.color = ok ? "#67c23a" : "#f56c6c";
    }
    function renderIcon() { $("tsdd-icon-preview").src = state.icon || DEFAULT_ICON; }
    function renderCurrent() {
      $("tsdd-build-current").textContent = "当前配置：" + state.name + " / " +
        (PLATFORM_LABEL[state.platform] || state.platform) +
        (state.icon ? " / 已设置图标" : " / 默认图标");
    }
    function collect() {
      var radio = el.querySelector('input[name="tsdd-platform"]:checked');
      return {
        name: $("tsdd-client-name").value.trim() || "唐僧叨叨",
        platform: radio ? radio.value : state.platform,
        icon: state.icon
      };
    }
    function fill(c) {
      state = {
        name: c.name || "唐僧叨叨",
        platform: PLATFORM_LABEL[c.platform] ? c.platform : "android",
        icon: c.icon || ""
      };
      $("tsdd-client-name").value = state.name;
      var radio = el.querySelector('input[name="tsdd-platform"][value="' + state.platform + '"]');
      if (radio) radio.checked = true;
      renderIcon();
      renderCurrent();
    }
    function saveConfig(done) {
      var c = collect();
      return fetch(GW_BASE + "/gw/client/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c)
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.status === 200 && j.config) state = j.config;
        return j;
      });
    }

    /* 图标：读取 → canvas 等比压缩为 192×192 PNG → 预览 */
    $("tsdd-icon-pick").onclick = function () { $("tsdd-icon-file").click(); };
    $("tsdd-icon-file").onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { setMsg("图片不能超过 5MB", false); return; }
      var fr = new FileReader();
      fr.onload = function (ev) {
        var img = new Image();
        img.onload = function () {
          var S = 192, cv = document.createElement("canvas");
          cv.width = S; cv.height = S;
          var ctx = cv.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, S, S);
          var s = Math.min(S / img.width, S / img.height);
          var w = img.width * s, h = img.height * s;
          ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
          state.icon = cv.toDataURL("image/png");
          renderIcon(); renderCurrent();
          setMsg("图标已选择，点击「保存配置」生效", true);
        };
        img.onerror = function () { setMsg("图片读取失败", false); };
        img.src = ev.target.result;
      };
      fr.onerror = function () { setMsg("图片读取失败", false); };
      fr.readAsDataURL(f);
      e.target.value = "";
    };
    $("tsdd-icon-clear").onclick = function () {
      state.icon = "";
      renderIcon(); renderCurrent();
      setMsg("已移除图标，点击「保存配置」生效", true);
    };

    $("tsdd-client-save").onclick = function () {
      var btn = this;
      btn.disabled = true;
      setMsg("保存中…", true);
      saveConfig().then(function (j) {
        btn.disabled = false;
        if (j.status === 200) {
          setMsg("保存成功，下次进入自动加载", true);
          renderCurrent();
        } else setMsg(j.msg || "保存失败", false);
      }).catch(function () {
        btn.disabled = false;
        setMsg("网络错误，无法连接网关（需重启 registergateway）", false);
      });
    };

    /* 进入页面自动加载上次保存的配置 */
    fill(state);
    fetch(GW_BASE + "/gw/client/config", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j.status === 200 && j.config) fill(j.config); })
      .catch(function () { setMsg("无法读取已保存配置，请确认网关已重启", false); });

    /* ---------------- 云端编译 ---------------- */
    function setProgress(p, text) {
      var bar = $("tsdd-build-progress"), st = $("tsdd-build-status");
      if (bar) bar.style.width = p + "%";
      if (st) st.textContent = text;
    }
    function showResult(run) {
      var wrap = $("tsdd-build-result"), a = $("tsdd-build-download"), log = $("tsdd-build-log");
      if (wrap) wrap.style.display = "block";
      if (a) {
        a.href = PROXY_PREFIX + run.apkUrl;
        a.textContent = "下载安卓客户端 APK（v" + run.runNumber + "）";
      }
      if (log) log.href = run.runUrl || "#";
    }
    function poll() {
      fetch(GW_BASE + "/gw/build/status", { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!pageEl || pageEl.style.display === "none") return;
          if (!$("tsdd-build-progress")) return;
          if (j.state === "none") return;
          var wrap = $("tsdd-build-progress-wrap");
          if (wrap) wrap.style.display = "block";
          if (j.state === "queued") { setProgress(6, "排队中，等待 GitHub 分配构建机…"); return; }
          if (j.state === "in_progress") {
            var elapsed = (Date.now() - new Date(j.createdAt).getTime()) / 1000;
            setProgress(Math.min(92, 12 + elapsed / 9), "正在云端编译（已进行 " + Math.round(elapsed / 60) + " 分钟）…");
            return;
          }
          if (j.state === "completed") {
            stopPoll();
            var start = $("tsdd-build-start");
            if (start) { start.disabled = false; start.textContent = "重新生成客户端"; }
            if (j.conclusion === "success" && j.apkUrl) {
              setProgress(100, "编译完成！");
              showResult(j);
            } else {
              setProgress(100, "编译失败，可点击「重新生成客户端」重试");
              var bar = $("tsdd-build-progress");
              if (bar) bar.style.background = "#f56c6c";
            }
          }
        }).catch(function () {});
    }

    $("tsdd-build-start").onclick = function () {
      var btn = this;
      var c = collect();
      if (c.platform !== "android") {
        /* 非安卓平台：只保存配置，不触发安卓编译流水线 */
        btn.disabled = true;
        setBuildMsg("正在保存 " + PLATFORM_LABEL[c.platform] + " 平台配置…", true);
        saveConfig().then(function (j) {
          btn.disabled = false;
          setBuildMsg(j.status === 200
            ? PLATFORM_LABEL[c.platform] + " 配置已保存；当前云端编译仅支持安卓"
            : (j.msg || "保存失败"), j.status === 200);
        }).catch(function () {
          btn.disabled = false;
          setBuildMsg("网络错误，无法连接网关", false);
        });
        return;
      }
      btn.disabled = true;
      btn.textContent = "正在触发云端编译…";
      setBuildMsg("", true);
      /* 先落盘配置，再把名称/平台传给 GitHub Actions */
      saveConfig().then(function () {
        return fetch(GW_BASE + "/gw/build/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appName: c.name, platform: c.platform })
        });
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.status === 200) {
          $("tsdd-build-result").style.display = "none";
          $("tsdd-build-progress-wrap").style.display = "block";
          var bar = $("tsdd-build-progress");
          if (bar) bar.style.background = "linear-gradient(90deg,#fc8f35,#fc4b35)";
          setProgress(3, "已触发，等待 GitHub 响应…");
          stopPoll();
          setTimeout(poll, 5000);
          pollTimer = setInterval(poll, POLL_MS);
          setBuildMsg("已按当前客户端名称触发编译", true);
        } else {
          btn.disabled = false;
          btn.textContent = "生成客户端";
          setBuildMsg(j.msg || "触发失败", false);
        }
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = "生成客户端";
        setBuildMsg("网络错误，无法连接构建网关", false);
      });
    };

    /* 打开页面时恢复正在进行的构建状态 */
    fetch(GW_BASE + "/gw/build/status", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!pageEl || pageEl.style.display === "none") return;
        if (!$("tsdd-build-progress")) return;
        if (j.state === "queued" || j.state === "in_progress") {
          $("tsdd-build-progress-wrap").style.display = "block";
          $("tsdd-build-start").disabled = true;
          $("tsdd-build-start").textContent = "云端编译中…";
          stopPoll(); poll();
          pollTimer = setInterval(poll, POLL_MS);
        } else if (j.state === "completed" && j.conclusion === "success" && j.apkUrl) {
          $("tsdd-build-progress-wrap").style.display = "block";
          setProgress(100, "最近一次编译已完成");
          showResult(j);
        }
      }).catch(function () {});
  }

  function openClientPage() {
    openPage("客户端生成", clientPageHTML(), "tsdd-menu-build-split", initClientPage);
  }

  /* ================= 注册设置页（内嵌同源管理页） ================= */
  function openSettingsPage() {
    openPage("注册设置",
      '<iframe id="tsdd-settings-frame" src="' + SETTINGS_PAGE + '?t=' + Date.now() + '"></iframe>',
      "tsdd-menu-settings-split", null);
  }

  /* ================= 菜单注入 ================= */
  var MENUS = [
    { id: "build", title: "客户端生成", svg: PHONE_SVG, open: openClientPage },
    { id: "settings", title: "注册设置", svg: GEAR_SVG, open: openSettingsPage }
  ];

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
    var svg = el.querySelector("svg");
    if (svg && menu.svg) svg.outerHTML = menu.svg;
    var title = el.querySelector(".title");
    if (!title) {
      title = document.createElement("span");
      title.className = "title";
      if (el.querySelector("[data-v-337019ad]")) title.setAttribute("data-v-337019ad", "");
      el.appendChild(title);
    }
    title.textContent = menu.title;
    /* 保持原生 14px 字号与 62px 项高，仅用字距微调让 5 字标题在 68px 窄栏内不溢出 */
    title.style.whiteSpace = "nowrap";
    title.style.letterSpacing = "-1.2px";
    el.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      menu.open();
    });
    return el;
  }

  /* 清理 v2/v3 遗留节点：曾向 .el-menu 注入导致二级菜单出现重复项 */
  function cleanupLegacy() {
    var nodes = document.querySelectorAll('[id^="tsdd-menu-"]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.getAttribute("data-tsdd-split") === "1" && n.parentElement &&
          n.parentElement.classList.contains("split-list")) continue;
      if (n.parentNode) n.parentNode.removeChild(n);
    }
    /* 旧版全屏弹层若仍存在，一并移除 */
    var old = ["tsdd-build-mask", "tsdd-settings-mask"];
    for (var k = 0; k < old.length; k++) {
      var m = document.getElementById(old[k]);
      if (m && m.parentNode) m.parentNode.removeChild(m);
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
  console.log("[TSDD] 客户端生成 / 注册设置补丁 v4 已加载");
})();
