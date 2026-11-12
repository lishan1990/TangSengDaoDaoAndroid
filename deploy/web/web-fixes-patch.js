;/* ================== TSDD Web Fixes Patch v1.0 ================== */
;/* 1. 截图按钮：原实现在非 Electron 环境下 window.open("https://www.snipaste.com")， */
;/*    浏览器版会跳到外站。改为：优先用浏览器屏幕捕获，把截图直接送进聊天图片预览； */
;/*    HTTP 非安全上下文不支持屏幕捕获时，改为选择本地截图文件 + 提示 Ctrl+V 粘贴。 */
;/* 2. 表情面板图片由 ./emoji/*.png 提供（静态资源已随部署补齐）。              */
;(function () {
  "use strict";
  if (window.__TSDD_WEB_FIXES__) return;
  window.__TSDD_WEB_FIXES__ = true;

  var TIP_ID = "tsdd-web-tip";
  var tipTimer = null;

  function tip(text, ms) {
    var el = document.getElementById(TIP_ID);
    if (!el) {
      if (!document.body) return;
      el = document.createElement("div");
      el.id = TIP_ID;
      el.style.cssText = [
        "position:fixed", "left:50%", "top:22px", "transform:translateX(-50%)",
        "z-index:99999", "max-width:560px", "padding:10px 18px", "border-radius:8px",
        "background:rgba(48,49,51,.94)", "color:#fff", "box-shadow:0 6px 24px rgba(0,0,0,.22)",
        "font:13px/1.7 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif",
        "text-align:center", "pointer-events:none", "opacity:0", "transition:opacity .25s"
      ].join(";");
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = "1";
    clearTimeout(tipTimer);
    tipTimer = setTimeout(function () { el.style.opacity = "0"; }, ms || 6000);
  }

  /* 聊天窗口自带的隐藏图片上传控件（.wk-imagetoolbar 内） */
  function imageInput() {
    return document.querySelector(".wk-imagetoolbar input[type='file']") ||
           document.querySelector("input[type='file'][accept*='image']");
  }

  /* 把 Blob 塞进图片控件，复用原有的预览 + 发送逻辑 */
  function feedImage(blob) {
    var input = imageInput();
    if (!input) { tip("请先打开一个聊天窗口，再使用截图功能"); return; }
    try {
      var dt = new DataTransfer();
      dt.items.add(new File([blob], "screenshot.png", { type: "image/png" }));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      tip("截图已生成，请在预览框点击发送");
    } catch (e) {
      tip("截图处理失败：" + (e && e.message ? e.message : e));
    }
  }

  function fallback() {
    var input = imageInput();
    if (input) {
      try { input.click(); } catch (e) { /* 浏览器可能拦截，忽略 */ }
    }
    tip("浏览器版不支持直接截屏：可选择已有截图文件，或用系统截图后按 Ctrl+V 粘贴到输入框发送");
  }

  function captureScreen() {
    var md = navigator.mediaDevices;
    if (md && md.getDisplayMedia && window.isSecureContext) {
      md.getDisplayMedia({ video: { frameRate: 1 }, audio: false }).then(function (stream) {
        var video = document.createElement("video");
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        video.play().then(function () {
          setTimeout(function () {
            try {
              var w = video.videoWidth || 1280, h = video.videoHeight || 720;
              var cv = document.createElement("canvas");
              cv.width = w; cv.height = h;
              cv.getContext("2d").drawImage(video, 0, 0, w, h);
              cv.toBlob(function (blob) { if (blob) feedImage(blob); else tip("截图生成失败，请重试"); }, "image/png");
            } catch (e) { tip("截图处理失败，请重试"); }
            try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
          }, 400);
        }).catch(function () {
          try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
          fallback();
        });
      }).catch(function (e) {
        if (e && (e.name === "NotAllowedError" || e.name === "AbortError")) {
          tip("已取消截屏");
        } else fallback();
      });
      return;
    }
    fallback();
  }

  /* 只拦截截图按钮的外链，不影响其它 window.open 调用 */
  var origOpen = window.open;
  window.open = function (url) {
    if (typeof url === "string" && url.indexOf("snipaste.com") > -1) {
      captureScreen();
      return null;
    }
    return origOpen.apply(this, arguments);
  };
})();
/* ================== /TSDD Web Fixes Patch v1.0 ================== */
