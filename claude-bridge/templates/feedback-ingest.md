# Template — chắt lọc feedback từ claude.ai

Dùng sau khi nhận reply từ bridge. Mục tiêu: biến văn bản dài thành **action items
kiểm chứng được** cho vòng factory, và đánh dấu phần **không tin cậy** để không lan
vào spec/code.

## Đọc
1. Đọc hết reply lần một, không ghi chú.
2. Phân loại từng ý theo 3 nhóm: ÁP DỤNG · NGHI NGỜ · BỎ.
3. Với "ÁP DỤNG": biến thành **hành động cụ thể** có file/điều kiện kiểm chứng; nếu
   claude.ai nói về file không có trong repo → kiểm chứng bằng `glob`/`read` trước.

## Ghi `<job>/feedback.md`

```markdown
# Feedback <job-id>
Nguồn: claude.ai <thời điểm> · Vấn đề gửi: <1 dòng>

## Tóm tắt
<2–3 câu nói gọn "claude.ai đã trả lời gì">

## Action items (áp dụng được)
1. <file/hạng mục> <việc cần sửa/chọn> — <kiểm chứng thế nào>
2. …

## Phần nghi ngờ / bỏ
- <ý nào + vì sao nghi ngờ (sai sự thật repo, khác phạm vi, lỗi thời)>

## Quyết định của orchestrator
APPLY | PARTIAL | REJECT
<1 dòng lý do>
```

## Quy tắc
- **Đối chiếu với repo trước khi tin.** File/bảng/API mà claude.ai nêu không tồn
  tại trong repo = không áp dụng, ghi vào "Phần nghi ngờ".
- **Không chép nguyên văn** CÙNG ngôn ngữ vào spec; viết lại bằng giọng của repo.
- Ngược với acceptance criteria / Golden Rules (fail-open, draft-first, không in
  secret) → REJECT kèm lý do.
- APPLY/PARTIAL → đưa action item vào bước kế tiếp:
  - spec mơ hồ → yêu cầu spec-writer cập nhật `spec.md`;
  - reviewer tranh cãi → gửi action item cho builder trong lượt resume;
  - builder BLOCKED và bridge đã gỡ tắc → resume builder với ghi chú mới.
- REJECT → ghi lý do, không lan vào spec/code. Loop vẫn đi tiếp bình thường.
