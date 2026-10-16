#!/usr/bin/env node
/**
 * claude_ask.mjs — HỎI claude.ai NHƯ NGƯỜI THẬT, TIẾP TỤC PHIÊN ĐÃ CÓ (không tạo phiên mới).
 *
 * Chạy trên Chrome đã mở với --remote-debugging-port=9222 (xem start-bridge.ps1).
 * Dùng CDP trực tiếp (fetch + WebSocket global, Node >= 22) — KHÔNG cần MCP client.
 *
 * Cách dùng:
 *   node claude_ask.mjs --selftest
 *       kiểm tra kết nối CDP + tab claude + composer (KHÔNG gửi gì)
 *   node claude_ask.mjs <brief.txt> <out.txt> [maxSeconds]
 *       TIẾP TỤC phiên claude đang có: tìm TAB claude.ai có sẵn, chọn phiên tên
 *       "AI-Factory session" (nếu thấy trong sidebar), gõ brief, bấm Gửi, chờ câu
 *       trả lời MỚI xuất hiện rồi lưu. KHÔNG mở /new, CHỈ khi chưa có tab claude nào
 *       thì mới mở /new dự phòng.
 *   node claude_ask.mjs <brief.txt> <out.txt> 540 --close
 *       đóng tab sau khi lưu — CHỈ đóng tab do script tự tạo dự phòng, KHÔNG đóng tab
 *       claude bạn đang dùng.
 *
 * Phiên mặc định tên: "AI-Factory session" (đổi bằng env CLAUDE_SESSION_NAME).
 *
 * Mã thoát: 0 = OK (có file out). 1 = lỗi bước trong quy trình (fail-open có lý do rõ).
 * 2 = Chrome CDP không kết nối. 3 = claude.ai chưa đăng nhập / trang không vào được.
 */
const CDP = "http://127.0.0.1:9222";
const HOST_RE = /claude\.ai/;
const SESSION_NAME = process.env.CLAUDE_SESSION_NAME ?? "AI-Factory session";

// ---------- helper ----------
async function cdpList() {
  let res;
  try { res = await fetch(`${CDP}/json/list`); }
  catch (e) {
    throw Object.assign(new Error("Chrome CDP 9222 chưa kết nối (" + (e.message || e) + ") — chạy start-bridge.ps1 để mở Chrome"), { code: 2 });
  }
  if (!res.ok) throw Object.assign(new Error(`CDP /json/list HTTP ${res.status}`), { code: 2 });
  return res.json();
}
function call(wsUrl) {
  let id = 0;
  const pending = new Map();
  const ws = new WebSocket(wsUrl);
  return new Promise((resolve, reject) => {
    const t0 = setTimeout(() => reject(Object.assign(new Error("CDP websocket timeout"), { code: 1 })), 15000);
    ws.addEventListener("open", () => { ws._open = true; });
    ws.addEventListener("message", (ev) => {
      let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.id && pending.has(m.id)) {
        const { r, j } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) j(Object.assign(new Error(`CDP error: ${JSON.stringify(m.error)}`), { code: 1 }));
        else r(m.result ?? {});
        if (!pending.size) clearTimeout(t0);
      }
    });
    ws.addEventListener("error", () => reject(Object.assign(new Error("CDP websocket error"), { code: 1 })));
    const ses = {
      send: (method, params = {}) => new Promise((res, rej) => {
        id += 1; pending.set(id, { r: res, j: rej });
        ws.send(JSON.stringify({ id, method, params }));
      }),
      close: () => { try { ws.close(); } catch {} },
    };
    const chk = setInterval(() => { if (ws._open) { clearInterval(chk); resolve(ses); } }, 20);
    setTimeout(() => clearInterval(chk), 12000);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(s, expression) {
  const r = await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Object.assign(new Error("page evaluate error: " + (r.exceptionDetails.text || "?")), { code: 1 });
  return r.result?.value;
}

async function waitFor(s, expression, msMax, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < msMax) {
    try { if (await evaluate(s, expression)) return true; } catch { /* page chưa sẵn */ }
    await sleep(1500);
  }
  throw Object.assign(new Error(`timeout chờ "${label}"`), { code: 1 });
}

/** Đọc text câu trả lời của Claude MỚI NHẤT (assistant-message cuối). */
const LAST_MSG_EXPR = `(() => {
  const m = document.querySelectorAll('[data-testid="assistant-message"]');
  if (!m.length) return null;
  const last = m[m.length - 1];
  return { text: last.innerText, len: last.innerText.length };
})()`;

/** Tìm TAB claude.ai ĐANG MỞ (không tạo mới). Trả null nếu chưa có. */
async function findClaudeTab() {
  const pages = (await cdpList()).filter((t) => t.type === "page");
  return pages.find((p) => HOST_RE.test(p.url)) ?? null;
}

/** Chọn (click) phiên đang có theo TÊN trong sidebar claude.ai — không mở /new. */
const SELECT_SESSION_EXPR = (name) => `(() => {
  const q = ${JSON.stringify(name)};
  const all = Array.from(document.querySelectorAll('a,button,li,[role="treeitem"]')).filter((n) => (n.innerText || '').trim() !== '');
  const leaf = all.filter((n) => (n.innerText || '').trim() === q && !n.querySelector('a,button,li,[role="treeitem"]'));
  const target = leaf[0] || all.find((n) => (n.innerText || '').trim() === q);
  if (!target) return { ok: false, why: 'khong thay phien trong sidebar', name: q };
  target.click();
  return { ok: true, tag: target.tagName, name: q };
})()`;

// ---------- mode selftest ----------
if (process.argv.includes("--selftest")) {
  try {
    const pages = (await cdpList()).filter((t) => t.type === "page");
    console.log("[1/3] CDP 9222: OK (" + pages.length + " page tab)");
    const claude = pages.find((p) => HOST_RE.test(p.url));
    console.log("[2/3] claude tab: " + (claude ? "CÓ — " + claude.url : "chưa có (claude_ask sẽ tự mở /new dự phòng)"));
    if (claude) {
      const s = await call(claude.webSocketDebuggerUrl);
      const hasComposer = await evaluate(s, `!!document.querySelector('[contenteditable="true"]')`);
      console.log("[3/3] composer claude.ai: " + (hasComposer ? "OK" : "chưa thấy (cần login hoặc đang ở trang không có khung chat)"));
      s.close();
    } else {
      console.log("[3/3] composer claude.ai: chưa kiểm được (chưa có tab) — khi ask sẽ tự mở rồi kiểm");
    }
    console.log("(phiên mặc định sẽ dùng tên: \"" + SESSION_NAME + "\")");
    console.log("SELFTEST: PASS (chưa gửi gì)");
    process.exit(0);
  } catch (e) {
    console.log("SELFTEST: FAIL — " + (e.message || e) + (e.code === 2 ? " → chạy start-bridge.ps1 trước" : ""));
    process.exit(e.code || 1);
  }
}

// ---------- mode ask ----------
const args = process.argv.slice(2);
const brief = args[0] || "";
const out = args[1] || "";
const maxSec = Number(args[2] || 540);
const keepTab = !process.argv.includes("--close");
if (!brief || !out) {
  console.error("usage: node claude_ask.mjs <brief.txt> <out.txt> [maxSeconds] [--close]");
  process.exit(1);
}

try {
  // 0) kết nối Chrome
  let targets;
  try { targets = await cdpList(); }
  catch (e) { console.error("ASK_FAILED chrome chưa chạy CDP (9222) — chạy start-bridge.ps1 rồi thử lại. (" + (e.message || e) + ")"); process.exit(2); }
  const pages = targets.filter((t) => t.type === "page");

  // 1) TÁI DÙNG tab claude.ai đang mở (tiếp tục phiên đã có); chỉ mở /new khi chưa có tab nào
  const existing = pages.find((p) => HOST_RE.test(p.url));
  let s; let createdTab = false;
  if (existing) {
    s = await call(existing.webSocketDebuggerUrl);
    await s.send("Page.enable").catch(() => {});
    console.log("dùng tab claude.ai có sẵn (tiếp tục phiên): " + existing.url);
  } else {
    const fs0 = await import("node:fs");
    const putRes = await fetch(`${CDP}/json/new?${encodeURIComponent("https://claude.ai/new")}`, { method: "PUT" });
    if (!putRes.ok) throw Object.assign(new Error(`CDP /json/new HTTP ${putRes.status}`), { code: 1 });
    const fresh = await putRes.json();
    s = await call(fresh.webSocketDebuggerUrl);
    await s.send("Page.enable").catch(() => {});
    await s.send("Page.navigate", { url: "https://claude.ai/new" }).catch(() => {});
    createdTab = true;
    console.log("chưa có tab claude.ai → mở /new dự phòng (tab này do script tạo)");
  }

  // 2) chọn đúng PHIÊN đã có theo tên (chỉ với tab cũ); rồi chờ composer sẵn sàng
  if (!createdTab) {
    try {
      const sel = await evaluate(s, SELECT_SESSION_EXPR(SESSION_NAME));
      console.log("chọn phiên \"" + SESSION_NAME + "\": " + (sel && sel.ok ? "OK (đã click " + sel.tag + ")" : ((sel && sel.why) || "?") + " — tiếp tục dùng tab hiện tại"));
    } catch (e) { console.log("chọn phiên cảnh báo: " + (e.message || e) + " — tiếp tục dùng tab hiện tại"); }
  }
  await waitFor(s, `document.querySelector('[contenteditable="true"]') !== null`, 45000, "composer claude.ai (nếu lâu → chưa login?)").catch((e) => {
    console.error(`ASK_FAILED ${e.message} — đăng nhập claude.ai trong Chrome (start-bridge.ps1) rồi chạy lại`);
    process.exit(3);
  });

  // 3) mốc TRƯỚC khi gửi (text câu trả lời cũ ở phiên đã có — để sau đó phân biệt câu trả lời MỚI)
  const fs = await import("node:fs");
  const text = fs.readFileSync(brief, "utf8");
  let before = null; try { before = await evaluate(s, LAST_MSG_EXPR); } catch { /* chưa có tin cũ */ }
  const beforeLen = (before && before.len) || 0;
  console.log("mốc trước khi gửi: lastLen=" + beforeLen + (createdTab ? " (phiên mới)" : " (phiên đã có)"));

  // 4) gõ câu hỏi vào composer + bấm Gửi (một evaluate, như người gõ thật; xoá text thừa nếu có)
  const expr = `(async () => {
    const el = document.querySelector('[contenteditable="true"]');
    if (!el) return { ok: false, why: "khong tim thay composer" };
    el.focus();
    if ((el.innerText || '').trim().length > 0) document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, ${JSON.stringify(text)});
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(600);
    let btn = document.querySelector('[data-testid="send-button"]')
          || Array.from(document.querySelectorAll('button')).find((b) => !b.disabled && ((b.getAttribute('aria-label')||'').toLowerCase().includes('send') || /send/i.test(b.className)));
    if (!btn) {
      el.focus();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      await wait(400);
      return { ok: true, sent: "keydown" };
    }
    btn.click();
    await wait(400);
    return { ok: true, sent: "click" };
  })()`;
  const sent = await evaluate(s, expr);
  if (!sent || !sent.ok) throw Object.assign(new Error(sent?.why || "gửi thất bại, không thấy nút Gửi"), { code: 1 });
  console.log("ask đã gửi (" + sent.sent + ") — chờ câu trả lời MỚI trong phiên (tối đa " + maxSec + "s)…");

  // 5) chờ trả lời MỚI xong: câu cuối đổi so với mốc trước khi gửi, rồi ổn định 2 lần đọc (như claude_wait2)
  const t0 = Date.now();
  let prev = beforeLen, changed = false, stable = 0, final = null;
  while (Date.now() - t0 < maxSec * 1000) {
    await sleep(12000);
    let cur = null;
    try { cur = await evaluate(s, LAST_MSG_EXPR); } catch { /* page đang bận */ }
    if (!cur || cur.len <= 0) { console.log("... chưa thấy câu trả lời (" + Math.round((Date.now() - t0) / 1000) + "s)"); continue; }
    if (cur.len !== beforeLen && cur.len !== prev) { changed = true; stable = 0; prev = cur.len; console.log("... đã có câu trả lời mới len=" + cur.len + " (" + Math.round((Date.now() - t0) / 1000) + "s)"); }
    else if (changed && cur.len === prev) { stable += 1; final = cur; console.log("... ổn định lần " + stable + " len=" + cur.len); if (stable >= 2) break; }
  }
  if (!final) throw Object.assign(new Error("TIMEOUT — claude.ai chưa trả lời xong (lastLen=" + prev + ")"), { code: 1 });

  // 6) lưu + báo. --close chỉ đóng tab do script tự tạo dự phòng; tab claude bạn dùng GIỮ NGUYÊN.
  fs.writeFileSync(out, final.text, "utf8");
  console.log("ASK_OK " + out + " " + final.len + " chars " + Math.round((Date.now() - t0) / 1000) + "s");
  if (createdTab && !keepTab) { await s.send("Page.close").catch(() => {}); }
  s.close();
  process.exit(0);
} catch (e) {
  console.error("ASK_FAILED " + (e.message || e));
  process.exit(e.code || 1);
}
