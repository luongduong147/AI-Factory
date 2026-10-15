#!/usr/bin/env node
/**
 * bridge.mjs — điều khiển Chrome (đã mở với --remote-debugging-port=9222) qua CDP,
 * KHÔNG cần MCP. Dùng fetch (HTTP) + WebSocket (Node >=22, global) thuần, không dep.
 *
 * Cách dùng (từ thư mục này):
 *   node bridge.mjs tabs                            -> liệt kê page tabs
 *   node bridge.mjs eval "<expression JS>"          -> Runtime.evaluate (returnByValue)
 *   node bridge.mjs navigate "<url>"
 *   node bridge.mjs send <file.txt>                 -> gõ nội dung file vào composer claude.ai + bấm Gửi
 *   node bridge.mjs read                            -> lấy text câu trả lời mới nhất của Claude
 *   node bridge.mjs screenshot <out.png>
 *
 * Fail-open: lỗi mỗi bước in rõ lý do; không thoát im lặng.
 */
const CDP = "http://127.0.0.1:9222";
const HOST_RE = /claude\.ai/;

async function pageTargets() {
  const res = await fetch(`${CDP}/json/list`);
  if (!res.ok) throw new Error(`CDP /json/list HTTP ${res.status}`);
  const list = await res.json();
  return list.filter((t) => t.type === "page");
}

async function claudeTarget() {
  const pages = await pageTargets();
  const hit = pages.find((t) => HOST_RE.test(t.url)) || pages[0];
  if (!hit) throw new Error("không có page nào để điều khiển");
  return hit;
}

/** Gọi CDP qua WebSocket; trả payload.result. */
function call(wsUrl) {
  let id = 0;
  const pending = new Map();
  const ws = new WebSocket(wsUrl);
  return new Promise((resolve, reject) => {
    const t0 = setTimeout(() => reject(new Error("CDP websocket timeout")), 20000);
    ws.addEventListener("open", () => {
      ws._open = true;
    });
    ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.id && pending.has(msg.id)) {
        const { resolve: r, reject: j } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) j(new Error(`CDP error: ${JSON.stringify(msg.error)}`));
        else r(msg.result ?? {});
        if (!pending.size) { clearTimeout(t0); }
      }
    });
    ws.addEventListener("error", () => reject(new Error("CDP websocket error")));
    const session = {
      send: (method, params = {}) =>
        new Promise((res, rej) => {
          id += 1;
          pending.set(id, { resolve: res, reject: rej });
          ws.send(JSON.stringify({ id, method, params }));
        }),
      close: () => { try { ws.close(); } catch {} },
    };
    // chờ open rồi trả session
    const check = setInterval(() => {
      if (ws._open) { clearInterval(check); resolve(session); }
    }, 20);
    setTimeout(() => { clearInterval(check); }, 15000);
  });
}

const arg = process.argv.slice(2);
const cmd = arg[0] || "";
const value = arg[1] || "";

switch (cmd) {
  case "tabs": {
    const pages = await pageTargets();
    for (const p of pages) console.log(`${p.id}  ${p.url}`);
    break;
  }
  case "eval": {
    const t = await claudeTarget();
    const s = await call(t.webSocketDebuggerUrl);
    // @file.mjs: đọc biểu thức JS từ file utf8 để tránh vỡ quoting/vietnamese khi đẩy qua dòng lệnh
    let expression = value;
    if (expression.startsWith("@")) {
      const fs = await import("node:fs");
      expression = fs.readFileSync(expression.slice(1), "utf8");
    }
    const r = await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    console.log(JSON.stringify(r.result ?? r, null, 2));
    s.close();
    break;
  }
  case "navigate": {
    const t = await claudeTarget();
    const s = await call(t.webSocketDebuggerUrl);
    await s.send("Page.enable").catch(() => {});
    await s.send("Page.navigate", { url: value });
    s.close();
    console.log("navigated:", value);
    break;
  }
  case "send": {
    // đọc text prompt từ file (utf8) để tránh escaping
    const fs = await import("node:fs");
    const text = fs.readFileSync(value, "utf8");
    const t = await claudeTarget();
    const s = await call(t.webSocketDebuggerUrl);
    // MỘT evaluate (awaitPromise + delay trong page) — tránh gọi 2 lần websocket
    const expr = `(async () => {
      const el = document.querySelector('[contenteditable="true"]');
      if (!el) return { ok: false, why: "khong tim thay composer" };
      if (el.innerText && el.innerText.trim().length > 10) {
        el.focus();
        document.execCommand('selectAll', false, null);
      }
      el.focus();
      document.execCommand('insertText', false, TEXT);
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(500); // React cập nhật state composer -> bật nút Gửi
      const info = {
        hasText: (el.innerText || el.textContent || "").trim().length,
        disabled: !!el.closest('form, div[class*=composer], div[class*=Composer]')?.querySelector('button[disabled]'),
      };
      // nút Gửi: ưu tiên data-testid send-button, sau đó nút gần composer không disabled
      let btn = document.querySelector('[data-testid="send-button"]')
            || Array.from(document.querySelectorAll('button')).find((b) => !b.disabled && (b.getAttribute('aria-label') || '').toLowerCase().includes('send'))
            || Array.from(document.querySelectorAll('button[class]')).find((b) => !b.disabled && /send/i.test(b.className));
      if (!btn) {
        // fallback: Enter với Shift? Không — bấm phím Enter kích hoạt React onSubmit
        el.focus();
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        await wait(300);
        return { ok: true, sent: "keydown", hasText: info.hasText, disabled: info.disabled, why: "no_button" };
      }
      btn.click();
      await wait(300);
      return { ok: true, sent: "click", hasText: info.hasText, disabled: info.disabled };
    })()`.replace(/TEXT/g, JSON.stringify(text));
    const r = await s.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    console.log(JSON.stringify(r.result?.value ?? r, null, 2));
    s.close();
    break;
  }
  case "readfile": {
    const t = await claudeTarget();
    const s = await call(t.webSocketDebuggerUrl);
    const fs = await import("node:fs");
    const expr = `(() => {
      const msgs = document.querySelectorAll('[data-testid="assistant-message"]');
      if (!msgs.length) return { ok: false, why: "chua co tra loi" };
      const last = msgs[msgs.length - 1];
      return { ok: true, len: last.innerText.length };
    })()`;
    const snap = await s.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    const has = snap.result?.value;
    if (has && has.ok) {
      // lấy text qua DOM (nếu copy textContent đúng) — dùng innerText nhưng lấy qua function
      const txt = await s.send("Runtime.evaluate", {
        expression: `(() => { const m = document.querySelectorAll('[data-testid="assistant-message"]'); const last = m[m.length-1]; return last.innerText; })()`,
        returnByValue: true, awaitPromise: true,
      });
      const text = String(txt.result?.value ?? "");
      fs.writeFileSync(value, text, "utf8");
      console.log("saved:", value, text.length, "chars");
    } else {
      console.log("no assistant message yet:", JSON.stringify(has ?? snap.result ?? snap));
    }
    s.close();
    break;
  }
  case "read": {
    const t = await claudeTarget();
    const s = await call(t.webSocketDebuggerUrl);
    const expr = `(() => {
      const msgs = document.querySelectorAll('[data-testid="assistant-message"]');
      if (!msgs.length) return { ok: false, why: "chua co tra loi" };
      const last = msgs[msgs.length - 1];
      return { ok: true, text: last.innerText, len: last.innerText.length };
    })()`;
    const r = await s.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    console.log(JSON.stringify(r.result?.value ?? r, null, 2));
    s.close();
    break;
  }
  case "screenshot": {
    const t = await claudeTarget();
    const s = await call(t.webSocketDebuggerUrl);
    const fs = await import("node:fs");
    await s.send("Page.enable").catch(() => {});
    const r = await s.send("Page.captureScreenshot", { format: "png" });
    const b64 = r.data;
    fs.writeFileSync(value, Buffer.from(b64, "base64"));
    console.log("saved:", value, Buffer.from(b64, "base64").length, "bytes");
    s.close();
    break;
  }
  default:
    console.log("unknown command:", cmd || "(rỗng)");
    process.exit(1);
}
