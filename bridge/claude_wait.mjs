#!/usr/bin/env node
// claude_wait.mjs — CDP: chờ Claude trả xong câu trả lời MỚI NHẤT (len ổn định 2 lần đọc cách 15s),
// rồi lưu text vào file. Cách dùng: node claude_wait.mjs <out.txt> [maxSeconds]
const CDP = "http://127.0.0.1:9222";
const out = process.argv[2] || `${process.env.TEMP}\\claude_research_output.txt`;
const maxSec = Number(process.argv[3] || 540);
const HOST_RE = /claude\.ai/;

async function pageTargets() {
  const r = await fetch(`${CDP}/json/list`);
  const list = await r.json();
  return list.filter((t) => t.type === "page");
}
function call(wsUrl) {
  let id = 0;
  const pending = new Map();
  const ws = new WebSocket(wsUrl);
  return new Promise((resolve, reject) => {
    const t0 = setTimeout(() => reject(new Error("cdp ws timeout")), 15000);
    ws.addEventListener("open", () => { ws._open = true; });
    ws.addEventListener("message", (ev) => {
      let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.id && pending.has(m.id)) {
        const { resolve: r, reject: j } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) j(new Error(JSON.stringify(m.error))); else r(m.result ?? {});
        if (!pending.size) clearTimeout(t0);
      }
    });
    ws.addEventListener("error", () => reject(new Error("cdp ws error")));
    const ses = {
      send: (method, params = {}) =>
        new Promise((res, rej) => { id += 1; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); }),
      close: () => { try { ws.close(); } catch {} },
    };
    const chk = setInterval(() => { if (ws._open) { clearInterval(chk); resolve(ses); } }, 20);
    setTimeout(() => clearInterval(chk), 12000);
  });
}
async function lastAssistant(s) {
  const r = await s.send("Runtime.evaluate", {
    expression: `(() => { const m = document.querySelectorAll('[data-testid="assistant-message"]'); if (!m.length) return null; const last = m[m.length-1]; return { text: last.innerText, len: last.innerText.length }; })()`,
    returnByValue: true, awaitPromise: true,
  });
  return r.result?.value ?? null;
}
const t = (await pageTargets()).find((p) => HOST_RE.test(p.url)) || (await pageTargets())[0];
const s = await call(t.webSocketDebuggerUrl);
// ảnh chụp trạng thái trước khi chờ (biết đếm assistant-message hiện tại)
const before = await lastAssistant(s);
const startCount = (await s.send("Runtime.evaluate", { expression: `document.querySelectorAll('[data-testid="assistant-message"]').length`, returnByValue: true })).result?.value ?? 0;
console.log("before: msgCount=", startCount, "lastLen=", before?.len ?? -1);
const t0 = Date.now();
let prevLen = before?.len ?? 0;
let stable = 0;
let final = null;
while (Date.now() - t0 < maxSec * 1000) {
  await new Promise((r) => setTimeout(r, 15000));
  const cur = await lastAssistant(s);
  const curCount = (await s.send("Runtime.evaluate", { expression: `document.querySelectorAll('[data-testid="assistant-message"]').length`, returnByValue: true })).result?.value ?? 0;
  if (!cur) { console.log("... chưa có câu trả lời mới"); continue; }
  if (curCount > startCount && cur.len > 0 && cur.len === prevLen) {
    stable += 1;
    console.log("... ổn định lần", stable, "len=", cur.len);
    final = cur;
    if (stable >= 2) break;
  } else {
    stable = 0;
    prevLen = cur.len;
    console.log("... đang chạy, len=", cur.len, "delta=", cur.len - before.len, `(${Math.round((Date.now()-t0)/1000)}s)`);
  }
}
if (final) {
  const fs = await import("node:fs");
  fs.writeFileSync(out, final.text, "utf8");
  console.log("SAVED:", out, final.len, "chars");
} else {
  console.log("TIMEOUT — chưa ổn định. last=", prevLen);
}
s.close();
