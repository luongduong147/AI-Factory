# Template — briefing gửi claude.ai
<!-- Điền đầy đủ, tổng ≤ ~300 từ. Xoá mọi dòng nhạy cảm (secret/token/khách) trước khi gửi. -->

## VAI TRÒ (đặt cho claude.ai)
Bạn là một kỹ sư phần mềm cao cấp giàu kinh nghiệm về <lĩnh vực>, đánh giá độc lập
một vấn đề đang trong quy trình software factory. Trả lời ngắn gọn, có thể hành động.

## BỐI CẢNH
- Repo: <tên repo / mono-module> · <stack chính>
- Feature đang làm: <một câu>
- Nơi tác động: <module/file chính, kèm path>

## VẤN ĐỀ
<2–4 câu: đang xây gì, tại sao}

## ĐANG KẸT Ở ĐÂU
- File/bước: <path hoặc stage của factory: spec / build / review / approve>
- Hiện trạng: <trích ngắn ≤ 10 dòng code hoặc tình huống>

## BLOCKER
<mô tả chính xác thứ đang chặn: mâu thuẫn spec, thiếu quyết định nghiệp vụ, prompt
chưa đạt, lỗi thiết kế tranh cãi…>

## CÂU HỎI (1 câu, duy nhất)
<Một câu hỏi cụ thể mà chỉ cần trả lời đúng là unblock được>

## RÀNG BUỘC
- Phạm vi tối thiểu, tái sử dụng mã hiện có.
- Giữ nguyên conventions của repo; không phát minh option/thư viện mới.
- Không xoá chức năng hiện có.

## ĐẦU RA MONG MUỐN
<dạng đầu ra: 1 quyết định + lý do; 1 spec section; prompt đã tối ưu…>
