export class NoEd25519 extends Error {}

const hexToBytes = (h) => Uint8Array.from(h.match(/../g), (b) => parseInt(b, 16));
const b64uToBytes = (s) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

// Chỉ nhận https, không cổng/tài khoản, và tên miền khớp danh sách cho phép; trả origin hoặc null.
export function apiOrigin(input, suffixes) {
  try {
    const u = new URL(String(input).trim());
    const ok = u.protocol === "https:" && !u.username && !u.password && !u.port && suffixes.some((s) => u.hostname.endsWith(s) && u.hostname.length > s.length);
    return ok ? u.origin : null;
  } catch {
    return null;
  }
}

async function importKey(publicKeyHex) {
  try {
    return await crypto.subtle.importKey("raw", hexToBytes(publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
  } catch (e) {
    throw new NoEd25519(String(e?.message || e));
  }
}

// Cùng định dạng với child/pointer.js: ký Ed25519 trên "javis-hub-pointer|v1|url|seq".
export async function verifyPointer(message, key) {
  try {
    const m = typeof message === "string" ? JSON.parse(message) : message;
    if (m?.v !== 1 || typeof m.url !== "string" || m.url.length > 200 || !Number.isSafeInteger(m.seq) || m.seq < 0 || typeof m.sig !== "string") return null;
    const ok = await crypto.subtle.verify("Ed25519", key, b64uToBytes(m.sig), new TextEncoder().encode(`javis-hub-pointer|v1|${m.url}|${m.seq}`));
    return ok ? { url: m.url, seq: m.seq } : null;
  } catch {
    return null;
  }
}

// Trả {origin, seq} của con trỏ ký đúng mới nhất; null nếu không có; ném NoEd25519 nếu trình duyệt không kiểm được chữ ký.
export async function resolvePointer(cfg, suffixes, lastSeq = -1) {
  const { server, topic, publicKey } = cfg.ntfy;
  if (!topic || !/^[0-9a-f]{64}$/i.test(publicKey) || !/^[A-Za-z0-9_-]{1,64}$/.test(topic) || server !== "https://ntfy.sh") return null;
  if (!globalThis.crypto?.subtle) throw new NoEd25519("no subtle");
  const key = await importKey(publicKey);
  let text;
  try {
    const res = await fetch(`${server}/${topic}/json?poll=1&since=12h`, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    text = (await res.text()).slice(0, 1e6);
  } catch {
    return null;
  }
  let best = null;
  for (const line of text.split("\n")) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.event !== "message" || typeof ev.message !== "string") continue;
    const p = await verifyPointer(ev.message, key);
    const origin = p && apiOrigin(p.url, suffixes);
    if (origin && p.seq > lastSeq && (!best || p.seq > best.seq)) best = { origin, seq: p.seq };
  }
  return best;
}
