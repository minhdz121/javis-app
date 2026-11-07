import CONFIG from "./config.js";
import { CONSENT_VERSION, CONSENT_ITEMS, CONSENT_NOTICES } from "./consent.js";
import { apiOrigin, resolvePointer, NoEd25519 } from "./pointer.js";

const HUB = CONFIG.hubName;
const root = document.getElementById("app");
const QR_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const TYPING = new Set(["onboarding", "consent"]);
const POLL_MS = { zalo: 2e3, starting: 2e3, unavailable: 4e3 };

// localStorage có thể bị chặn (chế độ riêng tư): vẫn chạy bằng bộ nhớ tạm.
const mem = {};
const store = {
  get: (k) => { try { return localStorage.getItem("javis." + k) ?? mem[k] ?? null; } catch { return mem[k] ?? null; } },
  set: (k, v) => { mem[k] = v; try { localStorage.setItem("javis." + k, v); } catch {} },
  del: (k) => { delete mem[k]; try { localStorage.removeItem("javis." + k); } catch {} },
};

// Mọi dữ liệu từ API chỉ vào DOM qua createTextNode/setAttribute, không bao giờ qua HTML.
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
class Offline extends Error {}
class NeedAddress extends Error {}
class Handled extends Error {}

let api = store.get("api");
let lastResolve = 0;
let noEd = false;

async function resolveApi(force) {
  if (api && !force) return api;
  if (Date.now() - lastResolve > 30e3 || !api) {
    lastResolve = Date.now();
    try {
      const p = await resolvePointer(CONFIG, CONFIG.apiHostSuffixes, Number(store.get("seq") ?? -1));
      if (p) { api = p.origin; store.set("api", api); store.set("seq", String(p.seq)); }
    } catch (e) {
      if (e instanceof NoEd25519) noEd = true; else throw e;
    }
  }
  if (!api) throw new NeedAddress();
  return api;
}

async function call(method, path, body, auth = true) {
  for (let attempt = 0; ; attempt++) {
    const base = await resolveApi(attempt > 0);
    const token = auth ? store.get("token") : null;
    let res;
    try {
      res = await fetch(base + "/m/api" + path, {
        method, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(15e3),
        headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      if (attempt === 0) continue;
      throw new Offline();
    }
    const j = await res.json().catch(() => null);
    if (res.status === 401 && auth) throw new ApiError(401, "");
    if (res.status >= 502 && !j) { if (attempt === 0) continue; throw new Offline(); }
    if (!res.ok) throw new ApiError(res.status, typeof j?.message === "string" && j.message.length <= 200 ? j.message : "Có lỗi xảy ra, hãy thử lại.");
    return j ?? {};
  }
}

const S = { invite: "", confirmed: "", pair: "", uninstall: false, flash: "", screen: "", key: "", timers: [], qrSeen: "", qrAt: 0, renewing: false, polling: false, pollTimer: 0 };
const every = (fn, ms) => S.timers.push(setInterval(fn, ms));
const later = (fn, ms) => S.timers.push(setTimeout(fn, ms));

function show(name, ...nodes) {
  S.timers.forEach((t) => { clearInterval(t); clearTimeout(t); });
  S.timers = [];
  root.replaceChildren(...nodes);
  if (name !== S.screen) { S.screen = name; const t = root.querySelector("h1"); if (t) { t.tabIndex = -1; t.focus({ preventScroll: true }); } window.scrollTo(0, 0); }
}

const card = (cls, ...kids) => h("div", { class: "card " + cls }, ...kids);

// Trả true nếu đã chuyển sang màn lỗi chung.
function fail(e, retry) {
  if (e instanceof ApiError && e.status === 401) { clearLocal(); revoked(); return true; }
  if (e instanceof Offline) { offline(retry); return true; }
  if (e instanceof NeedAddress) { address(retry); return true; }
  return false;
}
const msgOf = (e) => (e instanceof ApiError ? e.message : "Có lỗi xảy ra, hãy thử lại.");
const ago = (t) => {
  const m = Math.max(0, Math.round((Date.now() - Number(t || 0)) / 60000));
  return m < 1 ? "vừa xong" : m < 60 ? `${m} phút trước` : m < 1440 ? `${Math.round(m / 60)} giờ trước` : `${Math.round(m / 1440)} ngày trước`;
};

function clearLocal() {
  store.del("token");
  S.confirmed = ""; S.pair = ""; S.uninstall = false; S.screen = ""; S.key = "";
  clearTimeout(S.pollTimer);
  try { caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))); } catch {}
}

function offline(retry) {
  clearTimeout(S.pollTimer);
  const btn = h("button", { class: "primary wide", onclick: () => retry() }, "Thử lại");
  show("offline", card("", h("h1", {}, "Máy chủ Javis đang tắt hoặc không kết nối"),
    h("p", {}, `Máy của ${HUB} có thể đang tắt, vừa khởi động lại hoặc mạng của bạn đang chập chờn. Dữ liệu của bạn vẫn an toàn, hãy thử lại sau ít phút.`),
    h("div", { class: "row" }, btn),
    h("p", { class: "muted" }, "Trang sẽ tự thử lại sau vài giây."),
    h("p", {}, h("button", { onclick: () => address(retry) }, "Nhập địa chỉ máy chủ thủ công"))));
  later(retry, 8e3);
}

function address(retry) {
  const err = h("p", { class: "err" });
  const input = h("input", { type: "text", id: "addr", placeholder: "https://ten-ngau-nhien.trycloudflare.com", autocomplete: "off", autocapitalize: "off", spellcheck: "false", inputmode: "url" });
  const save = () => {
    const o = apiOrigin(input.value, CONFIG.apiHostSuffixes);
    if (!o) { err.textContent = "Địa chỉ không hợp lệ: phải là https và kết thúc bằng " + CONFIG.apiHostSuffixes.join(", "); return; }
    api = o; store.set("api", o); retry();
  };
  show("address", card("", h("h1", {}, "Địa chỉ máy chủ Javis"),
    h("p", {}, noEd ? "Trình duyệt của bạn chưa hỗ trợ kiểm chữ ký để tự tìm địa chỉ an toàn." : "Chưa tìm thấy địa chỉ máy chủ."),
    h("p", {}, `Hãy nhập địa chỉ ${HUB} gửi cho bạn (https://....trycloudflare.com).`),
    h("label", { class: "field", for: "addr" }, "Địa chỉ"), input,
    h("div", { class: "row" }, h("button", { class: "primary", onclick: save }, "Lưu và thử lại")), err));
}

function revoked() {
  show("revoked", card("", h("h1", {}, "Phiên đã bị thu hồi"),
    h("p", {}, `Phiên của thiết bị này không còn hiệu lực (${HUB} đã thu hồi hoặc bạn đã gỡ). Dữ liệu đăng nhập trên thiết bị đã được xóa.`),
    h("div", { class: "row" }, h("button", { class: "primary", onclick: intro }, "Bắt đầu lại"))));
}

const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function intro() {
  show("intro",
    card("", h("h1", {}, "Chào mừng đến với Javis"),
      h("p", {}, `Javis là trợ lý Zalo do ${HUB} đào tạo: chạy trong nhóm Zalo của bạn và chỉ trả lời khi có người gọi tên Javis.`)),
    card("hint", h("h2", {}, "Trước tiên: thêm vào màn hình chính"),
      isStandalone() ? h("p", {}, "Bạn đang mở từ biểu tượng trên màn hình chính. Tốt, hãy tiếp tục.") : [
        h("p", {}, h("b", {}, "Thêm Javis vào màn hình chính trước rồi mở từ biểu tượng, đừng đăng ký trong trình duyệt."),
          " Trên iPhone, ứng dụng ở màn hình chính có kho lưu trữ riêng, tách khỏi Safari; đăng ký trong Safari rồi thêm vào màn hình chính sẽ phải làm lại từ đầu."),
        h("ol", { class: "steps" },
          h("li", {}, "iPhone (Safari): bấm nút Chia sẻ, chọn \"Thêm vào Màn hình chính\"."),
          h("li", {}, "Android (Chrome): bấm menu ba chấm, chọn \"Cài đặt ứng dụng\" hoặc \"Thêm vào màn hình chính\"."),
          h("li", {}, "Mở Javis từ biểu tượng vừa tạo."))]),
    h("div", { class: "row" },
      h("button", { class: "primary wide", onclick: () => consent() }, "Tiếp tục"),
      h("button", { class: "wide", onclick: redeem }, "Tôi đã có mã ghép thiết bị")));
}

function consent(next = invite) {
  const boxes = CONSENT_ITEMS.map((it) => h("input", { type: "checkbox", id: "c-" + it.id }));
  const btn = h("button", { class: "primary wide", disabled: true, onclick: next }, "Tôi đã hiểu, tiếp tục");
  const sync = () => (btn.disabled = !boxes.every((b) => b.checked));
  boxes.forEach((b) => b.addEventListener("change", sync));
  show("consent", card("", h("h1", {}, "Đồng ý có hiểu biết"),
    CONSENT_NOTICES.map((it) => h("p", { class: "notice" }, h("b", {}, it.title + " "), it.text)),
    h("p", {}, "Bấm vào từng ô để xác nhận bạn đã hiểu."),
    CONSENT_ITEMS.map((it, i) => h("label", { class: "tick", for: "c-" + it.id }, boxes[i], h("span", {}, h("b", {}, it.title), it.text)))),
    h("p", { class: "err" }, S.flash),
    h("div", { class: "row" }, btn));
}

const reconsent = () => act(() => call("POST", "/consent", { version: CONSENT_VERSION, ticks: CONSENT_ITEMS.map((i) => i.id) }));

function waiting(s) {
  const down = s.screen === "unavailable";
  show(s.screen, card("", h("h1", {}, down ? "Javis tạm thời không chạy được" : "Javis đang khởi động"),
    h("p", {}, down ? `Javis của bạn đang gặp sự cố trên máy của ${HUB}. ${HUB} sẽ kiểm tra; trang tự thử lại, bạn không cần làm gì.` : `Máy của ${HUB} đang chuẩn bị Javis cho bạn, thường mất vài giây. Trang tự thử lại.`)));
}

function invite() {
  const err = h("p", { class: "err" });
  const input = h("input", { type: "text", id: "inv", value: S.invite, placeholder: "ABCD-EFGH-IJKL", autocomplete: "off", autocapitalize: "characters", spellcheck: "false" });
  const go = async () => {
    const code = input.value.trim().toUpperCase();
    if (!code) { err.textContent = "Hãy nhập mã mời."; return; }
    S.invite = code; err.textContent = ""; btn.disabled = true;
    try {
      const r = await call("POST", "/claim", { invite: code, consent: { version: CONSENT_VERSION, ticks: CONSENT_ITEMS.map((i) => i.id) } }, false);
      if (typeof r.deviceToken !== "string" || !r.deviceToken) throw new ApiError(0, "Máy chủ trả lời không hợp lệ.");
      S.invite = "";
      store.set("token", r.deviceToken);
      poll(true);
    } catch (e) { if (!fail(e, invite)) { err.textContent = msgOf(e); btn.disabled = false; } }
  };
  const btn = h("button", { class: "primary wide", onclick: go }, "Tiếp tục");
  show("invite", card("", h("h1", {}, "Nhập mã mời"),
    h("p", {}, `Mã mời do ${HUB} gửi, dùng được một lần.`),
    h("label", { class: "field", for: "inv" }, "Mã mời"), input, err), h("div", { class: "row" }, btn));
}

function redeem() {
  const err = h("p", { class: "err" });
  const input = h("input", { type: "text", id: "pair", maxlength: "8", placeholder: "8 ký tự", autocomplete: "off", autocapitalize: "characters", spellcheck: "false" });
  const btn = h("button", { class: "primary wide", onclick: async () => {
    const code = input.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) { err.textContent = "Mã ghép gồm đúng 8 ký tự."; return; }
    btn.disabled = true; err.textContent = "";
    try {
      const r = await call("POST", "/device/redeem", { code }, false);
      if (typeof r.deviceToken !== "string" || !r.deviceToken) throw new ApiError(0, "Máy chủ trả lời không hợp lệ.");
      store.set("token", r.deviceToken);
      poll(true);
    } catch (e) { if (!fail(e, redeem)) { err.textContent = msgOf(e); btn.disabled = false; } }
  } }, "Ghép thiết bị");
  show("redeem", card("", h("h1", {}, "Ghép thiết bị"),
    h("p", {}, "Trên thiết bị đã đăng nhập, vào Javis, chọn \"Tạo mã ghép thiết bị\" rồi nhập 8 ký tự vào đây."),
    h("label", { class: "field", for: "pair" }, "Mã ghép"), input, err),
    h("div", { class: "row" }, btn, h("button", { onclick: intro }, "Quay lại")));
}

async function poll(force) {
  if (S.polling) return;
  S.polling = true;
  clearTimeout(S.pollTimer);
  try {
    const s = await call("GET", "/state");
    if (!store.get("token")) return;
    if (!s || typeof s !== "object") throw new ApiError(0, "");
    render(s, force === true);
    S.pollTimer = setTimeout(poll, POLL_MS[s.screen] ?? 5e3);
  } catch (e) {
    if (!fail(e, () => poll(true))) S.pollTimer = setTimeout(poll, 8e3);
  } finally { S.polling = false; }
}

const act = async (fn) => {
  S.flash = "";
  try { await fn(); } catch (e) { if (e instanceof Handled || fail(e, () => poll(true))) return; S.flash = msgOf(e); }
  poll(true);
};

function render(s, force) {
  const key = JSON.stringify(s);
  const same = key === S.key && S.screen === s.screen;
  const keepTyping = TYPING.has(s.screen) && S.screen === s.screen;
  S.key = key;
  if (!force && (same || keepTyping)) return;
  const z = s.zalo ?? {};
  if (s.screen === "zalo") qrScreen(s);
  else if (s.screen === "onboarding") (S.confirmed && S.confirmed === String(z.name ?? "") ? nameScreen : confirmScreen)(s);
  else if (s.screen === "dashboard") dashboard(s);
  else if (s.screen === "consent") consent(reconsent);
  else if (s.screen === "starting" || s.screen === "unavailable") waiting(s);
  else if (s.screen === "revoked") { clearLocal(); revoked(); }
  else if (s.screen === "removed") { clearLocal(); show("removed", card("", h("h1", {}, "Đã xóa dữ liệu và gỡ Javis"), h("p", {}, "Dữ liệu của bạn đã bị xóa khỏi máy chủ. Hãy tự đăng xuất thiết bị lạ trong Zalo để chắc chắn."))); }
  else show("loading", card("", h("h1", {}, "Đang tải..."), h("p", { class: "muted" }, "Đang chờ máy chủ chuẩn bị.")));
}

const QR_TEXT = {
  qr_wait: "Đang tạo mã QR...", qr: "Làm theo các bước bên dưới để đăng nhập Zalo bằng mã này.", scanned: "Đã quét. Hãy bấm Xác nhận đăng nhập trong Zalo.",
  declined: "Đăng nhập bị từ chối. Hãy tạo mã mới.", error: "Đăng nhập không thành công. Hãy tạo mã mới.", need_qr: "Phiên cũ đã hết hạn, hãy quét mã mới.",
};

function b64ToBytes(dataUrl) {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function qrFullscreen(src) {
  const close = h("button", { class: "primary wide", onclick: () => ov.remove() }, "Đóng");
  const ov = h("div", { class: "overlay", role: "dialog", "aria-modal": "true", "aria-label": "Ảnh mã QR" },
    h("p", {}, h("b", {}, "Nhấn giữ vào ảnh rồi chọn \"Lưu vào Ảnh\" (iPhone) hoặc \"Tải hình ảnh xuống\" (Android).")),
    h("img", { src, alt: "Mã QR đăng nhập Zalo" }), h("div", { class: "row" }, close));
  ov.addEventListener("keydown", (e) => e.key === "Escape" && ov.remove());
  document.body.append(ov);
  close.focus();
}

async function saveQr(src) {
  try {
    const file = new File([b64ToBytes(src)], "javis-qr.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (e) { if (e?.name === "AbortError") return; }
  qrFullscreen(src);
}

function qrScreen(s) {
  const z = s.zalo ?? {};
  const src = typeof z.qr === "string" && z.qr.length < 3e5 && QR_RE.test(z.qr) ? z.qr : "";
  const total = CONFIG.qrSeconds;
  if (src !== S.qrSeen) { S.qrSeen = src; S.qrAt = Date.now(); }
  const count = h("p", { class: "count", role: "timer" });
  const bar = h("progress", { max: String(total), value: String(total), "aria-hidden": "true" });
  const renew = () => { S.qrAt = Date.now(); return act(() => call("POST", "/zalo/login", {})); };
  const tick = () => {
    const left = Math.max(0, total - Math.floor((Date.now() - S.qrAt) / 1000));
    count.textContent = z.status === "scanned" ? "Đang chờ bạn xác nhận trong Zalo" : `Mã hết hạn sau ${left} giây`;
    bar.value = left;
    if (left === 0 && !document.hidden && z.status !== "scanned" && !S.renewing) { S.renewing = true; renew().finally(() => (S.renewing = false)); }
  };
  const box = h("div", { class: "qrbox" }, src ? h("img", { src, alt: "Mã QR đăng nhập Zalo" }) : h("span", { class: "muted" }, "Đang tạo mã..."));
  // Tự xin mã khi vào màn hình (PWA cũ không tự gọi nên đứng ở "Đang tạo mã..." mãi).
  // Thử lại có giãn cách để không đốt hạn mức 40 lượt/giờ; quá 5 lần thì để người dùng bấm nút.
  if (src) { S.qrTries = 0; S.qrTryAt = 0; }
  else if (!document.hidden && !S.renewing && (S.qrTries ?? 0) < 5 && (z.status === "idle" || z.status === "need_qr" || z.status === "qr_wait")) {
    const delay = [0, 6000, 15000, 40000, 90000][Math.min(S.qrTries ?? 0, 4)];
    if (!S.qrTryAt || Date.now() - S.qrTryAt >= delay) {
      S.qrTries = (S.qrTries ?? 0) + 1;
      S.qrTryAt = Date.now();
      renew();
    }
  }
  show("qr", card("", h("h1", {}, "Đăng nhập Zalo"),
    h("p", {}, QR_TEXT[z.status] ?? "Đang chờ..."), box, src ? [count, bar] : null,
    h("p", { class: "err" }, z.error ? String(z.error) : ""),
    !src && (S.qrTries ?? 0) >= 3 ? h("p", { class: "muted" }, "Chậm hơn bình thường — bấm \"Tạo mã mới\" nếu sau ~15 giây vẫn chưa có mã.") : null,
    h("div", { class: "row" },
      h("button", { class: "primary wide", disabled: !src, onclick: () => saveQr(src) }, "Lưu ảnh QR"),
      h("button", { class: "wide", onclick: renew }, "Tạo mã mới"))),
    card("", h("h2", {}, "Cách đăng nhập"),
      h("ol", { class: "steps" },
        h("li", {}, "Bấm \"Lưu ảnh QR\" để lưu mã vào thư viện ảnh."),
        h("li", {}, "Mở Zalo, chọn quét mã QR."),
        h("li", {}, "Chọn ảnh từ thư viện, chọn ảnh vừa lưu."),
        h("li", {}, "Bấm Xác nhận đăng nhập.")),
      h("p", { class: "muted" }, "Dự phòng: mở trang này trên máy tính hoặc máy khác rồi quét mã bằng Zalo trên điện thoại.")));
  if (src) { tick(); every(tick, 1000); }
}

function confirmScreen(s) {
  const name = String(s.zalo?.name ?? "");
  show("confirm", card("", h("h1", {}, "Đúng tài khoản của bạn?"),
    h("p", {}, "Zalo vừa đăng nhập với tên:"), h("p", {}, h("b", {}, name || "(không rõ tên)")),
    h("div", { class: "row" },
      h("button", { class: "primary wide", onclick: () => { S.confirmed = name; render(s, true); } }, "Đúng, là tôi"),
      h("button", { class: "wide", onclick: () => act(() => call("POST", "/zalo/login", {})) }, "Không phải, đăng nhập lại"))));
}

function nameScreen(s) {
  const err = h("p", { class: "err" });
  const input = h("input", { type: "text", id: "nm", maxlength: "40", value: String(s.suggestedName ?? ""), placeholder: "Tên của bạn", autocomplete: "off", "aria-label": "Tên của bạn" });
  const form = h("form", { class: "chatform", onsubmit: async (ev) => {
    ev.preventDefault();
    const name = input.value.trim();
    if (!name) { err.textContent = "Hãy nhập tên."; return; }
    err.textContent = "";
    try { await call("POST", "/name", { name }); poll(true); } catch (e) { if (!fail(e, () => poll(true))) err.textContent = msgOf(e); }
  } }, input, h("button", { class: "primary wide", type: "submit" }, "Gửi"));
  show("onboarding", card("", h("h1", {}, "Làm quen với Javis"),
    h("div", { class: "chat" }, h("div", { class: "bubble" }, String(s.greeting ?? "Chủ nhân tên là gì ạ?"))), form, err));
}

const STATUS = {
  online: ["ok", "Javis đang chạy"], paused: ["warn", "Javis đang tạm dừng"], "hub-offline": ["bad", `Mất kết nối tới máy của ${HUB}, Javis tạm im lặng`],
  "zalo-offline": ["warn", "Zalo đang kết nối lại"], revoked: ["bad", "Javis đã bị thu hồi"],
};

function toggle(checked, label, onchange, disabled) {
  const i = h("input", { type: "checkbox", role: "switch", "aria-label": label, checked, disabled: !!disabled });
  i.addEventListener("change", () => onchange(i.checked));
  return h("label", { class: "switch" }, i, h("span", { class: "track" }));
}

function dashboard(s) {
  const z = s.zalo ?? {};
  const [cls, label] = STATUS[s.status] ?? ["warn", String(s.status ?? "")];
  const groups = Array.isArray(s.groups) ? s.groups : [];
  const devices = Array.isArray(s.devices) ? s.devices : [];
  const on = groups.filter((g) => g.on).length;
  const post = (path, body) => act(() => call("POST", path, body));
  const cards = [
    card("", h("span", { class: "pill " + cls }, label),
      h("p", {}, "Tài khoản Zalo: ", h("b", {}, String(z.name || "(chưa rõ)")), s.ownerName ? [h("br"), "Chủ nhân: ", h("b", {}, String(s.ownerName))] : null),
      s.status === "hub-offline" ? h("p", { class: "muted" }, `Nếu ${HUB} vừa khởi động lại máy, Javis sẽ tự tìm lại địa chỉ máy chủ.`) : null,
      h("p", { class: "err" }, S.flash)),
  ];
  if (s.notice) cards.push(card("banner", h("h2", {}, "Thông báo từ " + HUB), h("p", {}, String(s.notice))));
  cards.push(h("button", { class: "big " + (s.paused ? "primary" : ""), onclick: () => post("/pause", { paused: !s.paused }) }, s.paused ? "Tiếp tục Javis" : "Tạm dừng Javis"));
  cards.push(card("", h("h2", {}, `Nhóm của bạn (${on}/${groups.length} đang bật)`),
    h("p", { class: "muted" }, "Javis chỉ trả lời khi có người gọi tên. Tắt nhóm nào thì Javis im lặng hoàn toàn ở nhóm đó."),
    groups.length ? h("div", { class: "list" }, groups.map((g) => h("div", { class: "grp" }, h("span", { class: "name" }, String(g.name)),
      toggle(!!g.on, "Bật Javis ở nhóm " + g.name, (c) => post("/group", { id: g.id, on: c })))))
      : h("p", { class: "muted" }, "Chưa có nhóm nào.")));
  cards.push(card("", h("div", { class: "setting" },
    h("div", {}, h("b", {}, "Cho phép nói tục khi bị chửi trước"), h("div", { class: "muted" }, s.roughAllowed ? "Mặc định tắt." : `${HUB} chưa cho phép tính năng này.`)),
    toggle(!!s.roughOptIn && !!s.roughAllowed, "Cho phép nói tục khi bị chửi trước", (c) => post("/rough", { on: c }), !s.roughAllowed))));
  cards.push(card("", h("h2", {}, `Thiết bị đăng nhập (${devices.length}/${s.maxDevices ?? 3})`),
    h("p", { class: "muted" }, "Mỗi thiết bị giữ một token riêng. Máy lạ thì thu hồi ngay tại đây."),
    devices.length ? h("div", { class: "list" }, devices.map((d) => h("div", { class: "setting" },
      h("div", {}, h("b", {}, String(d.label || "Điện thoại")), h("div", { class: "muted" }, (d.current ? "Thiết bị này · " : "") + "hoạt động " + ago(d.lastSeen))),
      d.current ? null : h("button", { class: "wide", onclick: () => act(async () => { await call("POST", "/devices/revoke", { id: String(d.id) }); }) }, "Thu hồi"))))
      : h("p", { class: "muted" }, "Chưa có thiết bị nào.")));
  cards.push(card("", h("h2", {}, "Ghép thiết bị khác"),
    h("p", { class: "muted" }, "Tạo mã 8 ký tự rồi nhập ở thiết bị mới (chọn \"Tôi đã có mã ghép thiết bị\")."),
    S.pair ? h("div", { class: "code", "aria-label": "Mã ghép thiết bị" }, S.pair) : null,
    h("button", { class: "wide", onclick: () => act(async () => {
      const r = await call("POST", "/device/pair-code", {});
      if (typeof r.code !== "string" || !/^[A-Za-z0-9]{8}$/.test(r.code)) throw new ApiError(0, "Máy chủ trả lời không hợp lệ.");
      S.pair = r.code;
    }) }, S.pair ? "Tạo mã mới" : "Tạo mã ghép thiết bị")));
  cards.push(card("", h("h2", {}, "Đăng xuất"),
    h("p", { class: "muted" }, "Chỉ đăng xuất thiết bị này; Javis vẫn chạy cho tài khoản của bạn."),
    h("button", { class: "wide", onclick: () => act(async () => { await call("POST", "/logout", {}); clearLocal(); intro(); throw new Handled(); }) }, "Đăng xuất thiết bị này")));
  cards.push(card("danger-zone", h("h2", {}, "Xóa dữ liệu và gỡ"),
    S.uninstall ? [
      h("p", {}, h("b", {}, "Việc này xóa phiên Zalo và mọi dữ liệu của bạn khỏi máy chủ, không hoàn tác được.")),
      h("p", {}, "Sau đó hãy tự đăng xuất thiết bị lạ trong phần thiết bị đã đăng nhập của Zalo để chắc chắn phiên cũ không còn."),
      h("div", { class: "row" },
        h("button", { class: "danger wide", onclick: () => act(async () => { await call("POST", "/uninstall", {}); clearLocal(); render({ screen: "removed" }, true); throw new Handled(); }) }, "Xác nhận xóa tất cả"),
        h("button", { class: "wide", onclick: () => { S.uninstall = false; dashboard(s); } }, "Hủy")),
    ] : [
      h("p", {}, "Xóa phiên Zalo và dữ liệu của bạn khỏi máy của " + HUB + "."),
      h("button", { class: "danger wide", onclick: () => { S.uninstall = true; dashboard(s); } }, "Xóa dữ liệu của tôi và gỡ")]));
  show("dashboard", ...cards);
}

document.addEventListener("visibilitychange", () => { if (!document.hidden && store.get("token")) poll(true); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

const m = /^#(?:invite=)?([A-Za-z0-9-]{4,40})$/.exec(location.hash);
if (m) { S.invite = m[1].toUpperCase(); history.replaceState(null, "", location.pathname); }
if (store.get("token")) poll(true); else intro();
