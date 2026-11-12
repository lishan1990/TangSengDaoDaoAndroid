/**
 * 唐僧叨叨注册网关 v1.0
 * 作用：
 *  1. 收口所有注册请求（Web 端 /api/v1/... 与 安卓端 /v1/...），实现：
 *     - 验证码模式开关（sms=短信验证码 / image=图片验证码），管理页可切换
 *     - image 模式校验图片验证码，转发注册请求时自动填入固定短信验证码（服务端无感知）
 *     - 同一 IP 每天最多注册 N 个账号（默认 1）
 *  2. 其余所有请求原样透传到 tangsengdaodaoserver:8090
 * 管理页：已内嵌到 8110 后台（/gw-admin.html），接口统一走唯一对外端口 8112
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CONF_PATH = path.join(__dirname, "config.json");
const CLIENT_CONF_PATH = path.join(__dirname, "client-config.json"); // 客户端生成页的自定义配置（名称/平台/图标）
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || "tangsengdaodaoserver";
const UPSTREAM_PORT = parseInt(process.env.UPSTREAM_PORT || "8090", 10);
const MINIO_HOST = process.env.MINIO_HOST || "minio";
const MINIO_PORT = parseInt(process.env.MINIO_PORT || "9000", 10);
const PORT = parseInt(process.env.PORT || "9000", 10);
// 服务端生成的头像/文件下载地址指向 EXTERNAL_IP:9000，而 9000 通常未对公网放行。
// 网关把 302 Location 改写为已放行的 8112/file/，并代理到内网 MinIO，避免图片全部加载失败。
const DEFAULT_PUBLIC_API_BASE = process.env.PUBLIC_API_BASE || "http://127.0.0.1:8112";
const DEFAULT_MINIO_PUBLIC_BASE = process.env.MINIO_PUBLIC_BASE || "http://127.0.0.1:9000";

/* ---------------- 配置（每次请求读取，FTP 改文件即时生效） ---------------- */
const DEFAULT_CONF = {
  captchaMode: "image",          // "sms" = 短信验证码 | "image" = 图片验证码
  adminPassword: process.env.GW_ADMIN_PASSWORD || "CHANGE_ME", // 管理页密码（部署时请在 config.json 覆盖）
  smsFixedCode: "123456",        // image 模式转发给服务端的固定短信验证码（对应 .env TS_SMSCODE）
  ipDailyLimit: 1,               // 同一 IP 每天允许注册的账号数
  internalSecret: process.env.GW_INTERNAL_SECRET || "CHANGE_ME", // nginx 内部标识，需与 nginx.conf.template 一致
  githubRepo: "lishan1990/TangSengDaoDaoAndroid", // 安卓源码仓库
  githubToken: "",               // 触发 Actions 构建用的 token（repo+workflow 权限）
  buildDailyLimit: 5,            // 每天最多触发的安卓构建次数
  fileSizeLimitMB: 20,           // 安卓端发送文件大小上限（MB）
};
function loadConf() {
  try {
    return Object.assign({}, DEFAULT_CONF, JSON.parse(fs.readFileSync(CONF_PATH, "utf8")));
  } catch (e) {
    return Object.assign({}, DEFAULT_CONF);
  }
}

/* ---------------- 客户端生成页配置（持久化到 client-config.json） ---------------- */
const DEFAULT_CLIENT_CONF = {
  name: "唐僧叨叨",     // 客户端名称
  platform: "android",  // pc | android | ios
  icon: "",             // dataURL（前端已压缩为 192×192 PNG）
  updatedAt: "",
};
const PLATFORMS = ["pc", "android", "ios"];
function loadClientConf() {
  try {
    const raw = JSON.parse(fs.readFileSync(CLIENT_CONF_PATH, "utf8"));
    const c = Object.assign({}, DEFAULT_CLIENT_CONF, raw);
    if (PLATFORMS.indexOf(c.platform) < 0) c.platform = "android";
    return c;
  } catch (e) {
    return Object.assign({}, DEFAULT_CLIENT_CONF);
  }
}

/* ---------------- 内存状态 ---------------- */
// IP 注册计数：{ "2026-11-12": { ip: count } }
let ipCounts = {};
let ipCountsDay = "";
// 图片验证码：token -> { code, expire }
const captchas = new Map();
// 安卓构建每日计数：{ "2026-11-12": count }
let buildCounts = {};
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of captchas) if (v.expire < now) captchas.delete(k);
}, 60 * 1000);

function today() { return new Date().toISOString().slice(0, 10); }
function getIP(req) {
  const conf = loadConf();
  if (req.headers["x-gw-internal"] === conf.internalSecret && req.headers["x-real-ip"]) {
    return String(req.headers["x-real-ip"]).split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}
function registerCount(ip) {
  const d = today();
  if (ipCountsDay !== d) { ipCounts = {}; ipCountsDay = d; }
  return ipCounts[d] && ipCounts[d][ip] || 0;
}
function addRegister(ip) {
  const d = today();
  if (ipCountsDay !== d) { ipCounts = {}; ipCountsDay = d; }
  ipCounts[d] = ipCounts[d] || {};
  ipCounts[d][ip] = (ipCounts[d][ip] || 0) + 1;
}

/* ---------------- 图片验证码 ---------------- */
function genCaptcha() {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[crypto.randomInt(chars.length)];
  const token = crypto.randomBytes(16).toString("hex");
  captchas.set(token, { code, expire: Date.now() + 5 * 60 * 1000 });

  const W = 110, H = 40;
  let glyphs = "";
  for (let i = 0; i < 4; i++) {
    const x = 14 + i * 22 + crypto.randomInt(6) - 3;
    const y = 27 + crypto.randomInt(8) - 4;
    const rot = crypto.randomInt(50) - 25;
    const col = ["#3d7fff", "#e6a23c", "#67c23a", "#909399", "#f56c6c"][crypto.randomInt(5)];
    glyphs += `<text x="${x}" y="${y}" font-size="26" font-family="Georgia,serif" fill="${col}" transform="rotate(${rot} ${x} ${y})" font-weight="bold">${code[i]}</text>`;
  }
  let lines = "";
  for (let i = 0; i < 4; i++) {
    lines += `<line x1="${crypto.randomInt(W)}" y1="${crypto.randomInt(H)}" x2="${crypto.randomInt(W)}" y2="${crypto.randomInt(H)}" stroke="#ccc" stroke-width="1"/>`;
  }
  let dots = "";
  for (let i = 0; i < 30; i++) {
    dots += `<circle cx="${crypto.randomInt(W)}" cy="${crypto.randomInt(H)}" r="1" fill="#ddd"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#f7f8fa"/>${dots}${lines}${glyphs}</svg>`;
  return { token, svg };
}

/* ---------------- HTTP 工具 ---------------- */
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/* ---------------- 注册请求处理 ---------------- */
async function handleRegister(req, res, urlPath) {
  const conf = loadConf();
  const ip = getIP(req);

  // 1. IP 每日限制
  if (registerCount(ip) >= conf.ipDailyLimit) {
    return sendJSON(res, 403, { status: 403, msg: `该 IP 今日注册次数已达上限（每天最多 ${conf.ipDailyLimit} 个账号）` });
  }

  // 2. 读取请求体
  let raw;
  try { raw = await readBody(req); } catch (e) { return sendJSON(res, 400, { status: 400, msg: "请求体过大" }); }
  let body = {};
  try { body = JSON.parse(raw.toString("utf8") || "{}"); } catch (e) { body = {}; }

  // 3. 验证码逻辑
  if (conf.captchaMode === "image") {
    const rec = body.captchaToken && captchas.get(String(body.captchaToken));
    const ok = rec && rec.expire > Date.now() &&
      String(body.captchaCode || "").toUpperCase() === rec.code;
    captchas.delete(String(body.captchaToken || ""));
    if (!ok) return sendJSON(res, 400, { status: 400, msg: "图片验证码错误或已过期" });
    delete body.captchaToken;
    delete body.captchaCode;
    body.code = conf.smsFixedCode; // 服务端仍按短信验证码校验，自动填固定值
  }

  // 4. 转发到业务服务
  const payload = Buffer.from(JSON.stringify(body));
  const fwdHeaders = Object.assign({}, req.headers, {
    "content-type": "application/json",
    "content-length": payload.length,
    host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}`,
  });
  delete fwdHeaders["transfer-encoding"];
  console.log(`[gw-reg] 转发注册请求 ip=${ip} mode=${conf.captchaMode}`);
  const upReq = http.request({
    host: UPSTREAM_HOST, port: UPSTREAM_PORT, path: urlPath, method: "POST",
    headers: fwdHeaders,
    timeout: 30000,
  }, (upRes) => {
    console.log(`[gw-reg] 上游响应 ${upRes.statusCode}`);
    const chunks = [];
    upRes.on("data", (c) => chunks.push(c));
    upRes.on("end", () => {
      const buf = Buffer.concat(chunks);
      let j = {};
      try { j = JSON.parse(buf.toString("utf8")); } catch (e) {}
      const success = (!j.status || j.status === 200) && upRes.statusCode === 200;
      if (success) addRegister(ip); // 注册成功才计数
      res.writeHead(upRes.statusCode, { "Content-Type": upRes.headers["content-type"] || "application/json" });
      res.end(buf);
    });
    upRes.on("error", () => sendJSON(res, 502, { status: 502, msg: "上游服务错误" }));
  });
  upReq.on("error", (e) => { console.log("[gw-reg] 转发错误:", e.message); sendJSON(res, 502, { status: 502, msg: "注册服务不可用" }); });
  upReq.on("timeout", () => { upReq.destroy(); sendJSON(res, 504, { status: 504, msg: "注册服务超时" }); });
  upReq.end(payload);
}

/* ---------------- 文件下载地址改写 ---------------- */
// 业务服务对 /v1/groups/:id/avatar、/v1/users/:id/avatar、聊天文件等返回 302，
// Location 指向 MinIO 的公网地址（EXTERNAL_IP:9000）。该端口未放行时图片一律加载失败，
// 表现为「群头像提示修改成功但一直不生效」。这里改写到网关自己的 /file/ 路径。
function rewriteMinioLocation(loc, conf) {
  if (typeof loc !== "string" || !loc) return loc;
  const publicApi = conf.publicApiBase || DEFAULT_PUBLIC_API_BASE;
  const minioPublic = conf.minioPublicBase || DEFAULT_MINIO_PUBLIC_BASE;
  if (loc.indexOf(minioPublic + "/") === 0) {
    return publicApi + "/file/" + loc.slice(minioPublic.length + 1);
  }
  // 兜底：任意 host 的 :9000 下载地址
  return loc.replace(/^https?:\/\/[^/]+:9000\//, publicApi + "/file/");
}

/* ---------------- 透传代理 ---------------- */
function proxy(req, res, conf, host, port, opts) {
  host = host || UPSTREAM_HOST;
  port = port || UPSTREAM_PORT;
  opts = opts || {};
  const upReq = http.request({
    host: host, port: port, path: req.url, method: req.method,
    headers: Object.assign({}, req.headers, { host: `${host}:${port}` }),
    timeout: 10 * 60 * 1000,
  }, (upRes) => {
    const headers = Object.assign({}, upRes.headers);
    delete headers["transfer-encoding"];
    delete headers["content-length"]; // 流式转发用 chunked
    if (!opts.noRewrite && headers.location) {
      headers.location = rewriteMinioLocation(headers.location, conf || loadConf());
    }
    if (opts.cors) headers["access-control-allow-origin"] = "*";
    res.writeHead(upRes.statusCode, headers);
    upRes.pipe(res);
  });
  upReq.on("error", () => {
    if (!res.headersSent) sendJSON(res, 502, { status: 502, msg: "上游服务错误" });
    else res.end();
  });
  upReq.on("timeout", () => { upReq.destroy(); });
  req.pipe(upReq);
}

/* ---------------- 安卓客户端构建（GitHub Actions） ---------------- */
const GH_HOST = "api.github.com";
function ghRequest(method, pathname, body, auth) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const headers = {
      "User-Agent": "tsdd-gateway",
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
    };
    if (auth) headers["Authorization"] = `token ${auth}`;
    if (payload) headers["Content-Length"] = payload.length;
    const rq = https.request({ host: GH_HOST, path: pathname, method, headers, timeout: 20000 }, (rs) => {
      const chunks = [];
      rs.on("data", (c) => chunks.push(c));
      rs.on("end", () => {
        let j = null;
        try { j = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (e) {}
        resolve({ statusCode: rs.statusCode, json: j });
      });
    });
    rq.on("error", reject);
    rq.on("timeout", () => { rq.destroy(); reject(new Error("github api timeout")); });
    if (payload) rq.write(payload);
    rq.end();
  });
}

const WORKFLOW_FILE = "android-build.yml";
async function handleBuildStart(req, res) {
  const conf = loadConf();
  const d = today();
  const used = buildCounts[d] || 0;
  if (used >= conf.buildDailyLimit) {
    return sendJSON(res, 429, { status: 429, msg: `今日构建次数已达上限（每天 ${conf.buildDailyLimit} 次）` });
  }
  if (!conf.githubToken) {
    return sendJSON(res, 500, { status: 500, msg: "网关未配置 GitHub token，无法触发构建" });
  }
  /* 前端可携带已保存的客户端配置；app_name 会注入 APK 的 app_name 资源 */
  let body = {};
  try { body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8")); } catch (e) {}
  const clientConf = loadClientConf();
  const inputs = {};
  const appName = String(body.appName || clientConf.name || "").trim().slice(0, 40);
  if (appName) inputs.app_name = appName;
  const platform = PLATFORMS.indexOf(body.platform) > -1 ? body.platform : clientConf.platform;
  inputs.platform = platform;
  let r;
  try {
    r = await ghRequest("POST", `/repos/${conf.githubRepo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, { ref: "master", inputs }, conf.githubToken);
  } catch (e) {
    return sendJSON(res, 502, { status: 502, msg: "请求 GitHub 失败：" + e.message });
  }
  if (r.statusCode === 204) {
    buildCounts[d] = used + 1;
    console.log(`[gw-build] 触发构建成功，今日第 ${buildCounts[d]} 次`);
    return sendJSON(res, 200, { status: 200, msg: "构建已触发" });
  }
  return sendJSON(res, r.statusCode, { status: r.statusCode, msg: `GitHub 返回 ${r.statusCode}` + (r.json && r.json.message ? `: ${r.json.message}` : "") });
}

async function handleBuildStatus(res) {
  const conf = loadConf();
  let r;
  try {
    r = await ghRequest("GET", `/repos/${conf.githubRepo}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=1`, null, null);
  } catch (e) {
    return sendJSON(res, 502, { status: 502, msg: "查询 GitHub 失败：" + e.message });
  }
  if (r.statusCode !== 200 || !r.json || !r.json.workflow_runs) {
    return sendJSON(res, 502, { status: 502, msg: `GitHub 返回 ${r.statusCode}` });
  }
  const run = r.json.workflow_runs[0];
  if (!run) return sendJSON(res, 200, { status: 200, state: "none" });
  let apkUrl = null;
  const tag = `v${run.run_number}`;
  if (run.status === "completed" && run.conclusion === "success") {
    try {
      const rel = await ghRequest("GET", `/repos/${conf.githubRepo}/releases/tags/${tag}`, null, null);
      if (rel.statusCode === 200 && rel.json.assets && rel.json.assets.length) {
        apkUrl = rel.json.assets[0].browser_download_url;
      }
    } catch (e) {}
  }
  return sendJSON(res, 200, {
    status: 200,
    state: run.status,            // queued | in_progress | completed | none
    conclusion: run.conclusion,   // success | failure | null
    runNumber: run.run_number,
    runUrl: run.html_url,
    apkUrl,                       // 原始下载地址（前端自动加 gh-proxy 前缀）
    tagName: tag,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    buildDailyLimit: conf.buildDailyLimit,
  });
}

/* ---------------- 管理页 ---------------- */
function adminPage() {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>注册设置 - 管理页</title>
<style>
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f6fa;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);padding:32px;width:360px}
h1{font-size:20px;margin:0 0 6px;text-align:center;color:#222}
p.tip{font-size:12px;color:#999;text-align:center;margin:0 0 20px}
label{font-size:14px;color:#333;display:block;margin:14px 0 6px}
input[type=text],input[type=password]{width:100%;box-sizing:border-box;height:40px;border:1px solid #ddd;border-radius:6px;padding:0 12px;font-size:14px;outline:none}
.radio{display:flex;align-items:center;gap:8px;margin:8px 0;font-size:14px;color:#333}
button{width:100%;height:42px;border:none;border-radius:6px;background:#3d7fff;color:#fff;font-size:15px;cursor:pointer;margin-top:20px}
.msg{font-size:13px;min-height:18px;margin-top:10px;text-align:center;color:#67c23a}
</style></head><body><div class="card">
<h1>注册设置</h1><p class="tip">验证码模式与 IP 注册限制</p>
<label>管理密码</label><input type="password" id="pwd" placeholder="管理密码">
<label>注册验证码模式</label>
<div class="radio"><input type="radio" name="mode" id="mSms" value="sms"><label for="mSms" style="margin:0">短信验证码（需配置短信服务商或使用固定验证码）</label></div>
<div class="radio"><input type="radio" name="mode" id="mImg" value="image"><label for="mImg" style="margin:0">图片验证码（推荐，短信未配置时使用）</label></div>
<label>安卓发送文件大小上限（MB，1~2048）</label><input type="text" id="fileLimit" placeholder="默认 20">
<button onclick="save()">保存</button><div class="msg" id="msg"></div>
</div><script>
fetch('/gw/config').then(r=>r.json()).then(c=>{ (c.captchaMode==='image'?document.getElementById('mImg'):document.getElementById('mSms')).checked=true; if(c.fileSizeLimitMB) document.getElementById('fileLimit').value=c.fileSizeLimitMB; });
async function save(){
  const pwd=document.getElementById('pwd').value;
  const captchaMode=document.getElementById('mImg').checked?'image':'sms';
  const fileLimitRaw=document.getElementById('fileLimit').value.trim();
  const body={password:pwd,captchaMode:captchaMode};
  if(fileLimitRaw!=='') body.fileSizeLimitMB=parseInt(fileLimitRaw,10);
  const msg=document.getElementById('msg');
  msg.style.color='#999'; msg.textContent='保存中…';
  try{
    const r=await fetch('/gw/admin/mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json();
    if(j.status===200){ msg.style.color='#67c23a'; msg.textContent='保存成功，立即生效'; }
    else { msg.style.color='#f56c6c'; msg.textContent=j.msg||'保存失败'; }
  }catch(e){ msg.style.color='#f56c6c'; msg.textContent='网络错误'; }
}
</script></body></html>`;
}

/* ---------------- 主服务 ---------------- */
const server = http.createServer(async (req, res) => {
  const conf = loadConf();
  let p = req.url.split("?")[0];

  // CORS 预检（后台管理页面跨域调用网关接口）
  if (req.method === "OPTIONS" && p.startsWith("/gw")) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
    return res.end();
  }

  // 兼容 nginx /api/ 前缀剥离后的路径
  // 路由：网关自有接口
  if (p === "/gw/config") {
    return sendJSON(res, 200, { captchaMode: conf.captchaMode, ipDailyLimit: conf.ipDailyLimit, fileSizeLimitMB: conf.fileSizeLimitMB });
  }
  // 客户端生成页：自定义名称 / 平台 / 图标，保存到服务器，下次进入自动回填
  if (p === "/gw/client/config" && req.method === "GET") {
    return sendJSON(res, 200, { status: 200, config: loadClientConf() });
  }
  if (p === "/gw/client/config" && req.method === "POST") {
    let body = {};
    try { body = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString("utf8")); } catch (e) {
      return sendJSON(res, 400, { status: 400, msg: "请求数据格式错误或图标过大" });
    }
    const prev = loadClientConf();
    const next = {
      name: String(body.name === undefined ? prev.name : body.name).trim().slice(0, 40) || prev.name,
      platform: PLATFORMS.indexOf(body.platform) > -1 ? body.platform : prev.platform,
      icon: typeof body.icon === "string" ? body.icon.slice(0, 3 * 1024 * 1024) : prev.icon,
      updatedAt: new Date().toISOString(),
    };
    if (next.icon && !/^data:image\/(png|jpeg|webp);base64,/.test(next.icon)) {
      return sendJSON(res, 400, { status: 400, msg: "图标格式不支持，请使用 PNG/JPEG/WebP 图片" });
    }
    try {
      fs.writeFileSync(CLIENT_CONF_PATH, JSON.stringify(next, null, 2));
    } catch (e) {
      return sendJSON(res, 500, { status: 500, msg: "配置保存失败：" + e.message });
    }
    return sendJSON(res, 200, { status: 200, msg: "保存成功", config: next });
  }
  if (p === "/gw/captcha") {
    const c = genCaptcha();
    return sendJSON(res, 200, { token: c.token, svg: c.svg });
  }
  if (p === "/gw-admin") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(adminPage());
  }
  if (p === "/gw/admin/mode") {
    if (req.method !== "POST") return sendJSON(res, 405, { status: 405, msg: "method not allowed" });
    let body = {};
    try { body = JSON.parse((await readBody(req)).toString("utf8")); } catch (e) {}
    if (String(body.password || "") !== String(conf.adminPassword)) {
      return sendJSON(res, 403, { status: 403, msg: "管理密码错误" });
    }
    if (body.captchaMode !== "sms" && body.captchaMode !== "image") {
      return sendJSON(res, 400, { status: 400, msg: "captchaMode 必须为 sms 或 image" });
    }
    const newConf = Object.assign({}, conf, { captchaMode: body.captchaMode });
    if (body.fileSizeLimitMB !== undefined) {
      const v = parseInt(body.fileSizeLimitMB, 10);
      if (isNaN(v) || v < 1 || v > 2048) {
        return sendJSON(res, 400, { status: 400, msg: "文件大小限制必须在 1~2048MB 之间" });
      }
      newConf.fileSizeLimitMB = v;
    }
    fs.writeFileSync(CONF_PATH, JSON.stringify(newConf, null, 2));
    return sendJSON(res, 200, { status: 200, msg: "ok", captchaMode: newConf.captchaMode, fileSizeLimitMB: newConf.fileSizeLimitMB });
  }

  if (p === "/gw/build/start" && req.method === "POST") {
    if (req.method === "OPTIONS") return sendJSON(res, 204, {});
    return handleBuildStart(req, res).catch(() => sendJSON(res, 500, { status: 500, msg: "网关内部错误" }));
  }
  if (p === "/gw/build/status") {
    return handleBuildStatus(res).catch(() => sendJSON(res, 500, { status: 500, msg: "网关内部错误" }));
  }

  // 规范化路径：兼容 /v1/...（安卓直连）与 /api/v1/...（万一上游未剥前缀）
  let regPath = null;
  if (p === "/v1/user/register") regPath = p;
  if (p === "/api/v1/user/register") regPath = "/v1/user/register";

  if (regPath && req.method === "POST") {
    return handleRegister(req, res, regPath).catch((e) => {
      sendJSON(res, 500, { status: 500, msg: "网关内部错误" });
    });
  }

  // 头像/文件：302 改写后的 /file/xxx 请求转发到内网 MinIO（9000 无需对公网开放）
  if (p.startsWith("/file/")) {
    req.url = req.url.replace(/^\/file\//, "/");
    return proxy(req, res, conf, MINIO_HOST, MINIO_PORT, { noRewrite: true, cors: true });
  }

  // 其余全部透传（保留原始 url，含 /api 前缀的请求转成 /v1 供上游）
  if (p.startsWith("/api/")) req.url = req.url.replace("/api/", "/");
  proxy(req, res, conf);
});

server.setTimeout(10 * 60 * 1000);
server.headersTimeout = 10 * 60 * 1000;
server.requestTimeout = 0;
server.listen(PORT, () => {
  console.log(`[TSDD-GW] listening on :${PORT}, captchaMode=${loadConf().captchaMode}`);
});
