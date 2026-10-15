#!/usr/bin/env node
// claude_wait2.mjs — CDP: chờ câu trả lời mới nhất của Claude ĐỔI RỒI ỔN ĐỊNH (len tăng sau đó không đổi
// 2 lần đọc cách 15s) → lưu text. Không phụ thuộc đếm message (Claude hay sửa ngay message cuối).
// Dùng: node claude_wait2.mjs <out.txt> [maxSeconds] [startLen]
const CDP = "http://127.0.0.1:9222";
const out = process.argv[2] || `${process.env.TEMP}\\claude_arch_output.txt`;
const maxSec = Number(process.argv[3] || 540);
const startLenRaw = Number(process.argv[4] || 0);
const HOST_RE = /claude\.ai/;
async function pageTargets() { const r = await fetch(`${CDP}/json/list`); const l = await r.json(); return l.filter((t) => t.type === "page"); }
function call(wsUrl) {
  let id = 0; const pending = new Map(); const ws = new WebSocket(wsUrl);
  return new Promise((resolve, reject) => {
    const t0 = setTimeout(() => reject(new Error("cdp ws timeout")), 15000);
    ws.addEventListener("open", () => { ws._open = true; });
    ws.addEventListener("message", (ev) => { let m; try { m = JSON.parse(String(ev.data)); } catch { return; } if (m.id && pending.has(m.id)) { const { resolve: r, reject: j } = pending.get(m.id); pending.delete(m.id); if (m.error) j(new Error(JSON.stringify(m.error))); else r(m.result ?? {}); if (!pending.size) clearTimeout(t0); } });
    ws.addEventListener("error", () => reject(new Error("cdp ws error")));
    const ses = { send: (method, params = {}) => new Promise((res, rej) => { id += 1; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); }), close: () => { try { ws.close(); } catch {} } };
    const chk = setInterval(() => { if (ws._open) { clearInterval(chk); resolve(ses); } }, 20);
    setTimeout(() => clearInterval(chk), 12000);
  });
}
async function last(s) { const r = await s.send("Runtime.evaluate", { expression: `(() => { const m = document.querySelectorAll('[data-testid="assistant-message"]'); if (!m.length) return null; const last = m[m.length-1]; return { text: last.innerText, len: last.innerText.length }; })()`, returnByValue: true, awaitPromise: true }); return r.result?.value ?? null; }
const t = (await pageTargets()).find((p) => HOST_RE.test(p.url)) || (await pageTargets())[0];
const s = await call(t.webSocketDebuggerUrl);
let startLen = startLenRaw, start = await last(s);
if (start) { if (!startLenRaw) startLen = start.len; console.log("start: len=", start.len, " (mốc chờ >", startLen, ")"); }
const t0 = Date.now();
let prev = startLen, changed = false, stable = 0, final = null;
while (Date.now() - t0 < maxSec * 1000) {
  await new Promise((r) => setTimeout(r, 15000));
  const cur = await last(s);
  if (!cur) continue;
  if (cur.len > startLen && cur.len !== prev) { changed = true; stable = 0; prev = cur.len; console.log(`... đang chạy len=${cur.len} (${Math.round((Date.now()-t0)/1000)}s)`); }
  else if (changed && cur.len === prev) { stable += 1; console.log(`... ổn định lần ${stable} len=${cur.len}`); final = cur; if (stable >= 2) break; }
}
if (final) { const fs = await import("node:fs"); fs.writeFileSync(out, final.text, "utf8"); console.log("SAVED:", out, final.len, "chars"); }
else console.log("TIMEOUT — không ổn định. lastLen=", prev);
s.close();
