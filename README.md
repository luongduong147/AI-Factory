# AI Software Factory — skill/plugin cho harness (DeepSeek)

Plugin chạy một **software factory** ngay trong agent harness (model **v_deepseek**):
bạn chat tự do để lên ý tưởng, rồi kích hoạt factory để hệ thống tự **viết spec → build
→ review → approve** (hoặc đưa về người quyết — human-in-the-loop). Build theo đúng vòng
loop ý tưởng được đóng gói lại cho harness này + thêm **cầu claude.ai** cho các bước suy luận nặng.

```
feature (từ plan/free-chat) → spec-writer → builder → [security, ux, ui, code] → WAIT FOR ALL
                                       ▲                                      │
                                       └─ CHANGES: resume builder (≤ 2 lần)◄──┘
                                                                              ▼ all PASS
                     merge ←┤ approve (APPROVE) | → ESCALATE/needs-human → bạn quyết
```

## Bundle này có gì

```
<bundle>/                       ← repo AI-Factory (thư mục này)
├── SKILL.md                   ← runbook ORCHESTRATOR (skill của harness, frontmatter chuẩn)
├── skills/factory.md          ← bản đăng ký cho HARNESS_SKILL_DIR (cùng nội dung SKILL.md)
├── agents/                    ← 7 thẻ vai trò (prompt spawn subagent, chạy bằng v_deepseek)
│   ├── spec-writer.md            spec.md  (Context/Requirements/Acceptance/Out of scope/Assumptions)
│   ├── builder.md                code trên factory/<id> + build.md (STATUS: READY|BLOCKED)
│   ├── reviewer-security.md      round-N/review-security.md
│   ├── reviewer-ux.md            round-N/review-ux.md
│   ├── reviewer-ui.md            round-N/review-ui.md
│   ├── reviewer-code.md          round-N/review-code.md
│   ├── approver.md               decision.md (APPROVE | ESCALATE)
│   └── _README.md                cách đóng gói prompt cho subagent
├── bridge/                     ← CDP Chrome: claude_ask.mjs, start-bridge.ps1, bridge.mjs, claude_wait*.mjs
├── claude-bridge/
│   ├── BRIDGE.md                 cầu claude.ai bằng CDP Chrome local + tuyến MCP (reasoning tasks)
│   └── templates/
│       ├── reasoning-brief.md    bản mẫu "vấn đề / kẹt ở đâu / block thế nào / câu hỏi"
│       └── feedback-ingest.md    chắt lọc feedback → action items
└── factory/                      seed runtime (bản chạy thật ở <root>/factory/)
    ├── backlog.md                hàng chờ cho /factory next
    ├── dashboard.html            board visual (polls 2s, click card xem file)
    └── jobs/.gitkeep
```

## Cài đặt

### 1. Kích hoạt skill trong harness
Skill của harness đọc từ `HARNESS_SKILL_DIR` (1 skill = 1 file `.md` với frontmatter
`name/description/version` + tùy chọn `tools/triggers/model_invocable/user_invocable/rank`).
Repo này đã đóng sẵn `skills/factory.md` (cùng nội dung `SKILL.md`) — **chỉ cần trỏ
`HARNESS_SKILL_DIR` vào `<bundle>/skills`** (thư mục này chỉ chứa đúng 1 file .md):

```bash
# env (docker-compose harness hoặc khi chạy dev)
HARNESS_SKILL_DIR=<bundle>/skills
```

Vd bản thân máy này (`D:\Learning_space\AI-Factory`): bind-mount đúng folder skills
vào container:
```yaml
# harness service — thay thế volume named cho /data/skills bằng bind mount
volumes:
  - D:/Learning_space/AI-Factory/skills:/data/skills
```

Sau đó skill sẵn sàng (tên skill là `factory`): gõ `/factory …` hoặc nói *"chạy AI
software factory…"* (trigger NL), hoặc orchestrator tự gọi tool `skill {factory}`.

> Lưu ý: KHÔNG trỏ `HARNESS_SKILL_DIR` thẳng vào root `<bundle>` (AI-Factory) — loader
> đăng ký **mọi** `.md` (agent cards/README…) thành skill. Chỉ trỏ vào `<bundle>/skills`.

### 2. Claude.ai bridge — Chrome CDP (chạy thật, "hỏi như người thật")
Bridge dùng **CDP trực tiếp vào Chrome** — KHÔNG cần MCP client — nên harness (dsh) gọi được ngay qua
`pwsh`/`node`. Scripts nằm tại `<bundle>/bridge/` (đã có sẵn trong repo này):

| File | Vai trò |
|---|---|
| `bridge/start-bridge.ps1` | mở Chrome với `--remote-debugging-port=9222` + **profile cố định `.chrome-profile/`** |
| `bridge/claude_ask.mjs` | lệnh ask trọn gói: mở tab claude.ai mới → gõ brief → bấm Gửi → chờ trả lời stream xong → lưu nguyên văn |
| `bridge/bridge.mjs` | bộ CDP cấp thấp (tabs/eval/navigate/send/read/screenshot) để thao tác tay |
| `bridge/claude_wait.mjs` / `bridge/claude_wait2.mjs` | chờ câu trả lời ổn định (tách rời) |

`bridge/start-bridge.ps1` dùng profile `.chrome-profile` đặt **cạnh script** (trong `<bundle>/bridge/`)
và không nhìn thấy profile cũ đã login ở folder cũ `tools/mcp/chrome-devtools-mcp/` — nếu bạn đã đăng
nhập ở đó, copy nguyên folder `.chrome-profile` sang `<bundle>/bridge/` (hoặc đăng nhập lại 1 lần).

**Đăng nhập 1 lần:** `claude.ai` dùng Google SSO (password + có thể 2FA) — agent **không thay bạn**
được; bạn tự đăng nhập trong profile `.chrome-profile` 1 lần (chạy `start-bridge.ps1`, đăng nhập, khép tab),
sau đó mỗi ask vào thẳng. `.mcp.json` ở root repo chỉ dành cho tuyến B (client MCP có sẵn tool
`take_snapshot`/`fill`… trong VS Code/Claude Code/Cursor).

```pwsh
# kiểm tra nhanh (không gửi gì) — kỳ vọng ladder [1/3][2/3][3/3] trừ khi Chrome chưa bật
node bridge\claude_ask.mjs --selftest
# gửi thật: brief.txt → claude.ai → lưu kết quả vào out.txt (chờ tối đa 540s)
& .\bridge\start-bridge.ps1
node bridge\claude_ask.mjs <brief.txt> <out.txt> 540
```
Mã thoát: `0` OK · `1` lỗi bước · `2` Chrome CDP chưa chạy (→ `start-bridge.ps1`) · `3` claude.ai chưa
vào được (chưa login).

## Cách dùng — luồng 3 giai đoạn

### Giai đoạn 1 — PLAN (chat tự do, free mode)
Trong harness (agent dsh), bạn chat thoải mái để phát triển ý tưởng: mục tiêu, đối
tượng, ràng buộc, các quyết định đã bàn, các lựa chọn bị loại. Không cần format gì —
đây là bước "tổng hợp ý tưởng" của bạn.

### Giai đoạn 2 — kích hoạt factory
Khi ý tưởng đã chín, nói với agent, ví dụ:

- `/factory Làm tính năng đọc-giờ-cho blog posts`
- `Chạy AI software factory cho ý tưởng chat CSKH đa kênh vừa bàn`
- `/factory next` (lấy feature đầu tiên trong `<root>/factory/backlog.md`)

Orchestrator sẽ: chắt lọc hội thoại thành `jobs/<id>/idea.md` (đầu vào plan phase), tạo
job, và bắt đầu vòng: spec → build → 4 reviewer song song → (CHANGES: resume builder,
tối đa 2) → approver → **APPROVE: merge** / **ESCALATE: needs-human**.

### Giai đoạn 3 — kiểm soát
- `/factory approve <job-id>` — merge một job đang `needs-human` vào nhánh chính.
- `/factory rework <job-id> <note>` — đẩy lại builder với ghi chú của bạn.
- `/factory bridge <job-id>` — gửi vấn đề của job sang claude.ai lấy ý kiến.
- `/factory status` — xem trạng thái mọi job.
- Mở `factory/dashboard.html` (`cd <root>/factory && python -m http.server`) để xem
  board visual: card di chuyển qua các stage, chip verdict điền dần, job "cần bạn" nổi bật.

Trong khi factory chạy, orchestrator báo 1 dòng ngắn mỗi lần chuyển stage, vd:
`007-reading-time: round 2, security CHANGES, ux/ui/code PASS → resuming builder`.

## Claude.ai bridge — khi nào và thế nào

Các bước **suy luận nặng** của factory (viết spec mơ hồ, tối ưu prompt, suy luận
nghiệp vụ, tranh chấp reviewer, builder BLOCKED) có thể được đẩy sang claude.ai để
lấy **ý kiến thứ hai**. Cơ chế (chi tiết: `claude-bridge/BRIDGE.md`):

1. Orchestrator (hoặc chính subagent qua `ask_user_question`) nhận diện task suy luận.
2. Soạn briefing theo `templates/reasoning-brief.md`: **vấn đề → đang kẹt ở đâu
   (file/bước) → block thế nào → 1 câu hỏi + ràng buộc** (≤ ~400 từ, không secret) →
   ghi `<job>/bridge-brief.md`.
3. Hỏi claude web như người thật bằng bridge CDP local CHÍNH xác:
   `start-bridge.ps1` → `node claude_ask.mjs <job>/bridge-brief.md <job>/feedback-raw.md 540`
   (mở tab claude.ai, gõ, gửi, chờ trả lời xong, lưu nguyên văn — xem mục 2 ở trên).
   Máy nào có client MCP thì có thể dùng tuyến B (`chrome-devtools-mcp`, `BRIDGE.md`).
4. Chắt lọc feedback (`templates/feedback-ingest.md`) → `<job>/feedback.md` + action
   items → APPLY/PARTIAL/REJECT, rồi quyết định vòng tiếp theo.
5. **Fail-open**: Chrome CDP không chạy / chưa login / timeout / đổi giao diện → lưu
   briefing ra file, nhờ bạn tự dán, factory vẫn chạy. Feedback là dữ liệu ngoài,
   luôn đối chiếu với spec/repo trước khi dùng.

## Khác biệt so với bản gốc zazencodes

| Bản gốc (Claude Code) | Bản này (harness DeepSeek) |
|---|---|
| Skill `/factory` + subagent `type: opus/sonnet` | Skill `factory` (bundle `ai-software-factory`) + subagent chạy **v_deepseek** (model mặc định) |
| Orchestrator spawn bằng `subagent_type`, resume bằng `SendMessage` | Spawn bằng tool `subagent` (4 reviewer song song trong 1 message), resume builder bằng `send_message(agentId)` |
| Worktree git + branch `factory/<id>` | Giữ nguyên, có thêm **inline mode** khi repo không cho worktree |
| — | Tích hợp harness: `create_goal` cho job dài, `todo_write` theo dõi, `ask_user_question` cho quyết định người |
| — | **Claude.ai bridge** bằng CDP Chrome local (không cần MCP client) cho task suy luận |
| Dashboard đọc `jobs/<id>/job.json` | Giữ nguyên; file ranking thêm `idea.md`/`feedback.md` |

## Ghi chú vận hành (Golden Rules áp dụng)
- **Fail-open**: mọi nhánh lỗi trong loop phải ra kết quả an toàn, không sập job.
- **Không in secret**: agent/bridge/artifact không được chứa key/token (chỉ `file:line`).
- **Draft-first** (nếu feature chạm config của CRM): tạo `draft` → validate → `publish`.
- **Session log là nguồn chân lý**: mọi transition stage đều ghi vào `job.json`/file job.
- `factory/jobs/` là state runtime → thêm vào `.gitignore`.
