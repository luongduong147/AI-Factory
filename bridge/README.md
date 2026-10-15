# bridge — CDP bridge tới claude.ai (hỏi như người thật)

Bộ script điều khiển **Chrome thật** qua CDP (không cần MCP client) để mở claude web,
gõ câu hỏi, bấm Gửi, chờ câu trả lời stream xong rồi lưu nguyên văn.

Yêu cầu: **Node >= 22** (dùng `fetch` + global `WebSocket`). Chạy trên Windows (Script
PowerShell); nhánh macOS/Linux có thể dùng `start-bridge.ps1` qua `pwsh` hoặc tự mở
Chrome với `--remote-debugging-port=9222`.

## File

- `claude_ask.mjs` — lệnh ask trọn gói (khuôn chính của AI Software Factory bridge).
- `bridge.mjs` — CDP cấp thấp: `tabs`, `eval`, `navigate`, `send <file>`, `read`, `readfile`, `screenshot`.
- `claude_wait.mjs` / `claude_wait2.mjs` — chờ câu trả lời ổn định rồi lưu (đã tách từ bản scratch).
- `start-bridge.ps1` — mở Chrome với `--remote-debugging-port=9222` + profile cố định
  `.chrome-profile/` ngay cạnh script (đăng nhập claude.ai 1 lần → giữ phiên).

## Dùng nhanh

```powershell
# 1) mở Chrome (profile .chrome-profile); lần đầu đăng nhập claude.ai thủ công 1 lần
powershell -ExecutionPolicy Bypass -File start-bridge.ps1
#    hoặc:  .\start-bridge.ps1

# 2) kiểm tra nhanh (không gửi gì) — kỳ vọng SELFTEST: PASS
node claude_ask.mjs --selftest

# 3) gõ brief vào claude.ai + gửi + chờ trả lời xong + lưu nguyên văn (tối đa 540s)
node claude_ask.mjs <brief.txt> <out.txt> [maxSeconds] [--close]
```

`claude_ask.mjs` mở **tab claude.ai mới** (`/new`), không đụng tab bạn đang dùng. Một lần
gọi ghi ra stdout dòng `ASK_OK <path> <chars> <sec>`.

**Mã thoát:** `0` OK · `1` lỗi bước trong quy trình · `2` Chrome CDP chưa chạy (→ chạy
`start-bridge.ps1`) · `3` claude.ai chưa vào được (chưa đăng nhập trong profile).

## Ghi chú

- Nội dung trả về có thể kèm nhãn UI thừa (`Claude responded:`, icon lạ, `just now`)
  vì đọc qua `innerText` — bỏ khi chắt lọc (`claude-bridge/templates/feedback-ingest.md`).
- Profile `.chrome-profile/` là dữ liệu login riêng tư — đã nằm trong `.gitignore`, không commit.
- Tuyến B (khi dùng client MCP như VS Code/Claude Code/Cursor): chạy MCP server từ package này:
  `npm i` (trong thư mục `bridge/`) rồi `npm run mcp` — hoặc khai báo `npx -y chrome-devtools-mcp@latest` trong `.mcp.json` của client.
