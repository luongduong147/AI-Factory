# Agent cards — cách dùng

Mỗi file là một **thẻ vai trò** cho vòng loop AI Software Factory. Định dạng là
markdown có frontmatter `---` (giữ cho thẻ cũng dùng được ở Claude Code / Agents
dạng file). Khi spawn **subagent** trong harness:

1. Bỏ dòng frontmatter (`---` … `---`), chỉ dùng **phần thân** làm prompt.
2. Mở đầu prompt bằng câu dẫn vị trí (xem `SKILL.md` → **Spawn agent**):
   `Job folder: <abs>. Root: <abs>. Branch: factory/<job-id>.` (+ `Port: <port>`
   cho builder/reviewer-ux/reviewer-ui).
3. Reviewer round: spawn 4 reviewer **trong cùng một message** để chạy song song.
4. Builder: spawn với `description: builder-<job-id>`, giữ agent id để resume qua
   `send_message`.

Tất cả thẻ chạy trên **model mặc định của harness (v_deepseek)** — không hard-code
model. Các thẻ nặng suy luận (spec-writer, reviewer-security, approver) có thể được
mở rộng suy luận sâu (deep thinking) nếu harness hỗ trợ; không bắt buộc.
