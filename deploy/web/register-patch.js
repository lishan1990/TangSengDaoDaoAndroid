
;/* ================== TSDD Register Patch v3.0 ================== */
;/* 登录页注入"注册账号"小文字链接（参考蓝奏云：登录按钮下方右对齐） */
;/* 注册弹窗保持不变；验证码模式由网关配置决定                      */
;(function () {
  if (window.__TSDD_REGISTER_PATCH__) return;
  window.__TSDD_REGISTER_PATCH__ = true;

  var API = "/api/v1/";
  var GW = "/api/gw/";

  function h(tag, style, attrs) {
    var e = document.createElement(tag);
    if (style) e.style.cssText = style;
    if (attrs) {
      for (var k in attrs) {
        if (k === "text") e.textContent = attrs[k];
        else if (k === "html") e.innerHTML = attrs[k];
        else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]);
        else e.setAttribute(k, attrs[k]);
      }
    }
    return e;
  }

  function fetchJSON(url, data) {
    return fetch(url, data ? {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    } : {}).then(function (r) { return r.json(); });
  }

  /* ---------- 注册弹窗 ---------- */
  function openModal() {
    if (document.getElementById("tsdd-register-mask")) return;
    fetchJSON(GW + "config").catch(function () { return { captchaMode: "sms" }; }).then(function (cfg) {
      cfg = cfg || {};
      render(cfg.captchaMode === "image" ? "image" : "sms");
    });

    function render(mode) {
      var mask = h("div", "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99999;display:flex;align-items:center;justify-content:center;");
      mask.id = "tsdd-register-mask";
      var card = h("div", "background:#fff;border-radius:12px;padding:28px 30px;width:340px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;position:relative;max-height:92vh;overflow-y:auto;");
      card.appendChild(h("div", "position:absolute;right:14px;top:10px;font-size:20px;color:#999;cursor:pointer;line-height:1;", { text: "×", onclick: close }));
      card.appendChild(h("div", "font-size:20px;font-weight:600;color:#222;text-align:center;margin-bottom:4px;", { text: "注册账号" }));
      card.appendChild(h("div", "font-size:12px;color:#999;text-align:center;margin-bottom:18px;", { text: "使用手机号注册，注册后即可登录" }));

      function field(placeholder, type, value) {
        return h("input", "width:100%;box-sizing:border-box;height:40px;border:1px solid #ddd;border-radius:6px;padding:0 12px;font-size:14px;margin-bottom:12px;outline:none;", {
          placeholder: placeholder, type: type || "text", value: value || "",
        });
      }
      var inpZone = field("区号，如 +86", "text", "+86");
      var inpPhone = field("手机号", "tel");
      var inpName = field("昵称（选填）");
      var inpPwd = field("密码（至少 6 位）", "password");
      var inpPwd2 = field("确认密码", "password");
      [inpZone, inpPhone, inpName, inpPwd, inpPwd2].forEach(function (i) { card.appendChild(i); });

      var msg = h("div", "font-size:13px;min-height:18px;margin-bottom:10px;color:#f56c6c;");
      var btnOk = h("button", "width:100%;height:42px;border:none;border-radius:6px;background:#3d7fff;color:#fff;font-size:15px;cursor:pointer;", { text: "注 册", type: "button" });
      var captchaToken = null;
      var timer = null, btnSend = null;

      if (mode === "sms") {
        var codeRow = h("div", "display:flex;gap:8px;margin-bottom:12px;");
        var inpCode = h("input", "flex:1;height:40px;border:1px solid #ddd;border-radius:6px;padding:0 12px;font-size:14px;outline:none;box-sizing:border-box;", { placeholder: "短信验证码" });
        btnSend = h("button", "height:40px;border:none;border-radius:6px;background:#3d7fff;color:#fff;font-size:13px;cursor:pointer;padding:0 12px;white-space:nowrap;", { text: "获取验证码", type: "button" });
        codeRow.appendChild(inpCode); codeRow.appendChild(btnSend);
        var hint = h("div", "font-size:12px;color:#e6a23c;line-height:1.5;margin:-6px 0 12px;display:none;", { text: "短信服务未配置，发送失败。请输入服务器配置的固定验证码（默认 123456，可在服务器 .env 的 TS_SMSCODE 中查看修改）。" });
        card.appendChild(codeRow); card.appendChild(hint);
        btnSend.addEventListener("click", function () {
          var zone = inpZone.value.trim() || "+86";
          var phone = inpPhone.value.trim();
          if (!/^\d{5,15}$/.test(phone)) return say("请输入正确的手机号");
          busy(true); say("发送中…");
          fetchJSON(API + "user/sms/registercode", { zone: zone, phone: phone }).then(function (j) {
            if (j.status && j.status !== 200) throw j;
            say("验证码已发送，请查收短信", true);
            var left = 60;
            btnSend.textContent = left + "s 后重发";
            timer = setInterval(function () {
              left--;
              if (left <= 0) { clearInterval(timer); btnSend.textContent = "获取验证码"; busy(false); }
              else btnSend.textContent = left + "s 后重发";
            }, 1000);
          }).catch(function (err) {
            busy(false);
            say((err && err.msg) || "发送失败");
            hint.style.display = "block";
          });
        });
      } else {
        /* 图片验证码 */
        var capRow = h("div", "display:flex;gap:8px;margin-bottom:12px;align-items:stretch;");
        var inpCap = h("input", "flex:1;min-width:0;height:40px;border:1px solid #ddd;border-radius:6px;padding:0 12px;font-size:14px;outline:none;box-sizing:border-box;", { placeholder: "图片验证码" });
        var capBox = h("div", "height:40px;width:118px;border:1px solid #ddd;border-radius:6px;overflow:hidden;cursor:pointer;display:flex;align-items:center;justify-content:center;background:#fafafa;flex-shrink:0;", { title: "点击刷新验证码" });
        capRow.appendChild(inpCap); capRow.appendChild(capBox);
        card.appendChild(capRow);
        function loadCaptcha() {
          capBox.innerHTML = '<span style="font-size:12px;color:#999">加载中…</span>';
          fetchJSON(GW + "captcha?ts=" + Date.now()).then(function (j) {
            captchaToken = j.token;
            capBox.innerHTML = j.svg;
            var sv = capBox.querySelector("svg");
            if (sv) { sv.style.width = "100%"; sv.style.height = "100%"; }
          }).catch(function () {
            capBox.innerHTML = '<span style="font-size:12px;color:#f56c6c">加载失败</span>';
          });
        }
        capBox.addEventListener("click", loadCaptcha);
        loadCaptcha();
        inpCap.addEventListener("keydown", function (e) { if (e.key === "Enter") btnOk.click(); });
      }

      card.appendChild(msg);
      card.appendChild(btnOk);
      mask.appendChild(card);
      mask.addEventListener("click", function (e) { if (e.target === mask) close(); });
      document.body.appendChild(mask);
      inpZone.focus();

      function close() { mask.remove(); if (timer) clearInterval(timer); }
      function say(t, ok) { msg.textContent = t; msg.style.color = ok ? "#67c23a" : "#f56c6c"; }
      function busy(b) { btnOk.disabled = b; btnOk.style.opacity = b ? ".6" : "1"; if (btnSend) btnSend.disabled = b; }

      btnOk.addEventListener("click", function () {
        var zone = inpZone.value.trim() || "+86";
        var phone = inpPhone.value.trim();
        var pwd = inpPwd.value, pwd2 = inpPwd2.value;
        if (!/^\d{5,15}$/.test(phone)) return say("请输入正确的手机号");
        if (!pwd || pwd.length < 6) return say("密码至少 6 位");
        if (pwd !== pwd2) return say("两次输入的密码不一致");
        var body = { zone: zone, phone: phone, password: pwd, name: inpName.value.trim() || "", flag: 1 };
        if (mode === "sms") {
          if (!document.querySelector("#tsdd-register-mask input[placeholder='短信验证码']").value.trim()) return say("请输入验证码");
          body.code = document.querySelector("#tsdd-register-mask input[placeholder='短信验证码']").value.trim();
        } else {
          var cap = inpCap.value.trim();
          if (!cap) return say("请输入图片验证码");
          if (!captchaToken) return say("图片验证码未加载，请点击刷新");
          body.captchaToken = captchaToken;
          body.captchaCode = cap;
        }
        busy(true); say("提交中…");
        fetchJSON(API + "user/register", body).then(function (res) {
          if (res.status && res.status !== 200) throw res;
          say("注册成功，请使用手机号登录", true);
          var u = document.querySelector(".wk-login-content-form input");
          if (u && /^\d{11}$/.test(phone)) u.value = phone;
          setTimeout(close, 1200);
        }).catch(function (err) {
          busy(false);
          say((err && err.msg) || "注册失败");
          if (mode === "image") loadCaptcha();
        });
      });
    }
  }

  /* ---------- 登录页注入小号文字链接（参考蓝奏云「创建新账户?」） ---------- */
  function inject() {
    if (document.getElementById("tsdd-register-link")) return;
    var form = document.querySelector(".wk-login-content-form");
    var row = form && form.querySelector(".wk-login-content-form-buttons");
    if (!form || !row) return;

    /* 兼容旧版本残留：移除 v2 的大按钮与其样式，恢复登录按钮原生布局 */
    var oldBtn = document.getElementById("tsdd-register-btn");
    if (oldBtn) oldBtn.remove();
    var oldStyle = document.getElementById("tsdd-register-style");
    if (oldStyle) oldStyle.remove();

    var wrap = h("div", "width:320px;max-width:100%;box-sizing:border-box;margin:8px auto 0;padding-right:4px;text-align:right;");
    var link = h("a", "font-size:12px;line-height:18px;color:#606266;text-decoration:underline;cursor:pointer;background:none;border:0;padding:0;", {
      text: "注册账号", href: "#", onclick: function (e) { e.preventDefault(); openModal(); },
    });
    link.id = "tsdd-register-link";
    wrap.appendChild(link);

    /* 放在登录按钮下方、扫描登录上方，右对齐 */
    var others = form.querySelector(".wk-login-content-form-others");
    if (others) form.insertBefore(wrap, others);
    else form.appendChild(wrap);
  }

  var mo = new MutationObserver(inject);
  if (document.documentElement) mo.observe(document.documentElement, { childList: true, subtree: true });
  inject();
})();
/* ================== /TSDD Register Patch v3.0 ================== */
