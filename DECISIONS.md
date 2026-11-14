# Thay Lời Muốn Nói — Spec & quyết định sản phẩm

Tài liệu tổng hợp mô hình và các quyết định đã chốt qua thảo luận, để tiếp tục làm việc từ máy khác có đủ context.

## 1. Mô hình

Nền tảng marketplace 2 chiều cho thuê người gọi điện thoại nói lời hộ (tỏ tình, xin lỗi, chúc mừng...) tới một người thứ ba (người được gọi / "em").

- **Người cho thuê (freelancer):** đăng ký SĐT + demo giọng nói, tự chấm loại giọng và loại số (đẹp/có ý nghĩa, ví dụ trùng ngày sinh), ghi nhà mạng.
- **Người thuê (buyer):** đặt đơn, trả tiền theo: số chữ muốn nói, thời lượng cuộc gọi, tốc độ nói, cảm xúc, cước gọi theo phút của nhà mạng, thời điểm muốn cuộc gọi diễn ra.
- **Người nhận cuộc gọi (callee):** bên thứ ba, không phải user của platform, không ký điều khoản gì — mọi rủi ro pháp lý/niềm tin xoay quanh nhóm này.

## 2. Giá

- Giá sàn cố định: **1.000đ / 20 chữ**.
- Biến phí cộng thêm: thời lượng, tốc độ nói, cảm xúc, cước gọi nhà mạng, giờ gọi mong muốn.
- Cước gọi do **freelancer tự chịu** (như shipper tự chịu xăng xe) — tất yếu của mô hình, không bù.

## 3. Vận hành & tài chính

- Buyer nạp tiền vào ví platform theo gói (1k–100k).
- Platform ăn % hoa hồng mỗi đơn.
- Khi tạo đơn: **giam tiền trung gian (escrow)**.
- Giải ngân hoặc hoàn tiền dựa theo **kết quả đơn hàng** (xem mục 5).
- Có hệ thống đánh giá (rating) cho freelancer.

## 4. Thanh toán — đã chốt kiến trúc

- **Nạp tiền (buyer → platform):** qua payOS (cổng thu tiền VietQR), tự động.
- **Rút tiền (freelancer → nhận):** freelancer tạo lệnh rút kèm **số tài khoản ngân hàng + tên chủ TK** → admin duyệt tay → chuyển khoản thủ công (không qua API disbursement của payOS — payOS chưa xác nhận hỗ trợ chi hộ nhiều người nhận).
  - Lý do bỏ KYC bằng CCCD: đăng ký tài khoản (cả buyer và freelancer) qua **SĐT + OTP** là đủ chặn tài khoản rác; số TK ngân hàng khi rút tiền là nơi neo định danh thật (ngân hàng đã tự KYC chủ tài khoản đó).
  - Khóa tài khoản là chế tài cao nhất cho vi phạm.
  - Admin chỉ duyệt lệnh rút cho đơn **đã đóng thật** (xem mục 5), không duyệt khi đơn còn trong thời gian chờ xác nhận/tranh chấp.
  - Ngưỡng duyệt tay này chấp nhận được ở quy mô MVP; cần tự động hoá khi số lệnh rút/ngày vượt khả năng duyệt tay.

## 5. Bằng chứng & đóng đơn

- Kiểm duyệt kịch bản (script) trước khi gọi.
- Ghi âm cuộc gọi làm bằng chứng mặc định.
- Nếu lỡ không ghi âm được: tick "yêu cầu người thuê xác nhận" — hợp lệ khi buyer (a) xác nhận đã đạt mục đích, hoặc (b) có mặt nghe trực tiếp lúc gọi diễn ra, hoặc (c) hỏi lại người được gọi sau đó.
- **Đóng đơn = khi buyer xác nhận.** Ghi âm chỉ lưu tới khi đơn đóng, đóng đơn thì xóa ghi âm ngay.
- **[CHƯA CHỐT]** Cần thêm mốc tự động xác nhận sau X giờ nếu buyer im lặng không phản hồi — nếu không, đơn không bao giờ đóng khi buyer quên xác nhận, tiền kẹt vĩnh viễn trong escrow, freelancer không được trả. Giá trị X giờ đang đề xuất 48h, chưa chốt số cuối.
- Có tổng đài CSKH xử lý tranh chấp (nghe lại ghi âm trong thời gian còn lưu để quyết định hoàn/giải ngân).

## 6. Vị trí pháp lý (theo quyết định của chủ dự án)

- Luật VN không cấm ghi âm cuộc gọi nếu nội dung hợp lệ (có kiểm duyệt trước) — quan điểm đã chốt của chủ dự án.
- Không áp dụng KYC bằng giấy tờ tùy thân cho người dùng; định danh qua SĐT+OTP khi đăng ký, qua số TK ngân hàng khi rút tiền.
- Rủi ro còn cần theo dõi (chưa có giải pháp cụ thể, ghi lại để không quên):
  - Chưa có kênh riêng cho callee (người thứ ba bị gọi) report/chặn nếu không muốn nhận cuộc gọi dạng này nữa.
  - Chưa có danh sách cụ thể nội dung bị cấm trong kiểm duyệt kịch bản (đe dọa, đòi nợ, mạo danh, nội dung với người dưới 18 tuổi...).

## 7. Thị trường / đối thủ (đã research, chưa tìm thấy đối thủ trực tiếp)

- Gần nhất ở VN: "Lập trình yêu thương" (dự án cá nhân cũ, không phải platform, không rõ còn hoạt động).
- Quốc tế: Cameo (video celeb, không phải gọi điện thật), singing telegram qua điện thoại (Vocal Majority...), Fiverr "make a phone call for you" (mục đích công việc, không có yếu tố số đẹp/giọng), AI calling apps (Pally...).
- Kết luận: chưa có đối thủ trực tiếp kết hợp giọng + số đẹp + tính phí theo chữ/cảm xúc cho mục đích tình cảm cá nhân — lợi thế người đi đầu, nhưng mô hình chưa được ai kiểm chứng.

## 8. Việc còn mở (open items)

- [ ] Chốt số giờ timeout tự xác nhận đơn.
- [ ] Xác nhận docs payOS có hỗ trợ chi hộ (disbursement) hay không — hiện tại không cần vì đang duyệt tay thủ công.
- [ ] Soạn danh sách nội dung cấm cụ thể cho kiểm duyệt kịch bản.
- [ ] Thiết kế kênh report/chặn cho callee.
