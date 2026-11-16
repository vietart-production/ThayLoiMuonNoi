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
- **[CHƯA CHỐT]** Cần thêm mốc tự động xác nhận sau X giờ nếu buyer im lặng không phản hồi — nếu không, đơn không bao giờ đóng khi buyer quên xác nhận, tiền kẹt vĩnh viễn trong escrow, freelancer không được trả. Bản demo (xem §9) đã code cứng X = 48h để có cái chạy, nhưng số này vẫn chưa được bạn chốt chính thức — đổi `CONFIRM_TIMEOUT_HOURS` trong `assets/mock-backend.js` khi quyết định số khác.
- Có tổng đài CSKH xử lý tranh chấp (nghe lại ghi âm trong thời gian còn lưu để quyết định hoàn/giải ngân).

## 6. Vị trí pháp lý (theo quyết định của chủ dự án)

- Luật VN không cấm ghi âm cuộc gọi nếu nội dung hợp lệ (có kiểm duyệt trước) — quan điểm đã chốt của chủ dự án.
- Không áp dụng KYC bằng giấy tờ tùy thân cho người dùng; định danh qua SĐT+OTP khi đăng ký, qua số TK ngân hàng khi rút tiền.
- Rủi ro còn cần theo dõi (chưa có giải pháp cụ thể, ghi lại để không quên):
  - Kênh report/chặn cho callee: có bản nháp ở `report.html` (xem §9) — form công khai không cần đăng nhập, admin xem và có thể khóa tài khoản freelancer liên quan. Chưa có cách nào xác minh danh tính người gửi báo cáo, nên vẫn có thể bị spam/report sai.
  - Danh sách nội dung cấm: có bản nháp 7 mục trong `BANNED_CONTENT_CHECKLIST` (`assets/mock-backend.js`), hiển thị cho admin tick tay khi duyệt kịch bản — chưa review bởi ai có chuyên môn pháp lý, chỉ là danh sách hợp lý thông thường.
  - **Ghi âm cuộc gọi thực ra chưa có gì ở lớp kỹ thuật** — platform không tham gia vào cuộc gọi (freelancer gọi bằng SIM/điện thoại cá nhân của họ), nên không thể tự ghi âm server-side. "Có ghi âm hay không" hiện chỉ là một checkbox freelancer tự khai, không có file ghi âm thật nào được tạo/upload. Nếu muốn ghi âm thật làm bằng chứng, cần: (a) freelancer tự ghi âm bằng app ghi âm cuộc gọi trên máy họ rồi upload file lên platform, hoặc (b) platform làm cầu nối gọi qua VoIP để tự ghi âm — (b) là thay đổi lớn, không hợp với quyết định "freelancer dùng SIM của mình" ở §4.

## 7. Thị trường / đối thủ (đã research, chưa tìm thấy đối thủ trực tiếp)

- Gần nhất ở VN: "Lập trình yêu thương" (dự án cá nhân cũ, không phải platform, không rõ còn hoạt động).
- Quốc tế: Cameo (video celeb, không phải gọi điện thật), singing telegram qua điện thoại (Vocal Majority...), Fiverr "make a phone call for you" (mục đích công việc, không có yếu tố số đẹp/giọng), AI calling apps (Pally...).
- Kết luận: chưa có đối thủ trực tiếp kết hợp giọng + số đẹp + tính phí theo chữ/cảm xúc cho mục đích tình cảm cá nhân — lợi thế người đi đầu, nhưng mô hình chưa được ai kiểm chứng.

## 8. Việc còn mở (open items)

- [ ] Chốt số giờ timeout tự xác nhận đơn (demo đang code cứng 48h).
- [x] payOS có chi hộ thật — đã kiểm tra trực tiếp trong `@payos/node@2.0.6` (type definitions), có `payos.payouts.create/get/list/estimateCredit`. Không dùng ngay vì đã chọn duyệt tay thủ công (§4), nhưng đây là lựa chọn thật để tự động hoá sau, không phải "chưa biết có hay không" như ghi trước đây.
- [x] Soạn danh sách nội dung cấm cụ thể cho kiểm duyệt kịch bản — bản nháp 7 mục, chưa qua review pháp lý (§6, §9).
- [x] Thiết kế kênh report/chặn cho callee — bản nháp `report.html` + admin, chưa xác minh được danh tính người báo cáo (§6, §9).
- [ ] Chốt % hoa hồng platform — demo đang để tạm 15% (`COMMISSION_RATE` trong `assets/mock-backend.js`), chưa phải số thật.
- [ ] Giải pháp ghi âm cuộc gọi thật (xem cảnh báo ở §6) — hiện chưa có gì, chỉ là checkbox tự khai.
- [ ] Thay passcode admin cố định (`admin123` trong code) bằng tài khoản CSKH thật trước khi đưa cho ai ngoài dùng thử.
- [ ] Nối OTP thật qua SMS provider — demo hiện hiển thị mã OTP ngay trên màn hình thay vì gửi SMS.

## 9. Bản demo "backend giả" (fake backend prototype)

Đã dựng toàn bộ luồng chính bằng HTML/JS thuần + Tailwind CDN (giữ đúng stack đã có ở `index.html`, không thêm framework/build step), dữ liệu lưu trong `localStorage` của trình duyệt — **không đồng bộ giữa máy/trình duyệt khác nhau, không phải dữ liệu thật**. Mục đích: đi hết luồng nghiệp vụ để test UX trước khi nối backend/thanh toán/SMS thật.

File mới:
- `assets/mock-backend.js` — toàn bộ logic nghiệp vụ (auth OTP giả, ví, đơn hàng + state machine escrow, rút tiền, report), set thiết kế để khi có backend thật chỉ cần thay phần thân từng hàm bằng `fetch(...)`, chữ ký hàm giữ nguyên. Có `TLMN._selfTest()` gọi tay trong console để kiểm tra nhanh luồng tạo đơn → duyệt → gọi → xác nhận → rút tiền có đúng số không.
- `assets/app.css`, `assets/auth-widget.js` — style và ô đăng nhập SĐT+OTP dùng chung giữa các trang.
- `dat-don.html` — luồng người thuê: chọn người nói hộ, viết kịch bản, tính giá, đặt đơn, nạp ví (giả), xác nhận/báo tranh chấp/chấm điểm.
- `freelancer.html` — luồng người cho thuê: tạo hồ sơ tự chấm giọng/số, xử lý đơn được giao, yêu cầu rút tiền.
- `admin.html` — CSKH: duyệt kịch bản (có checklist nội dung cấm), xử lý tranh chấp, duyệt lệnh rút tiền, xử lý report từ callee, nút chạy tay việc quét timeout 48h. Vào bằng passcode cố định trong code, chỉ dùng để demo.
- `report.html` — form công khai cho người nhận cuộc gọi (callee) báo cáo, không cần đăng nhập.

`index.html` (landing) đã được nối các nút CTA ("Đặt một cuộc gọi", "Trở thành người nói hộ", "Chọn người này" trên từng thẻ freelancer) sang các trang trên; phần giới thiệu/tính giá minh họa trên trang chủ giữ nguyên không đổi.

## 10. Backend thật (Express + Firestore + payOS) — đang dựng, chưa nối với frontend

Kiến trúc chốt: **Firebase Auth (Spark/free, OTP điện thoại thật) + Firestore (Spark/free, DB) + Node/Express (free trên Render, serve luôn file tĩnh + API) + payOS (thu tiền thật)**. Không dùng Cloud Functions (cần gói Blaze/thẻ) — xem lý do ở lịch sử chat, không lặp lại ở đây.

File mới (ở cùng cấp với `index.html`, không có thư mục `server/` riêng):
- `package.json`, `.env.example` — deps: `express`, `firebase-admin`, `@payos/node`, `cors`, `dotenv`.
- `server.js` — Express app, serve file tĩnh từ gốc repo + mount `/api`.
- `src/firebaseAdmin.js` — khởi tạo Admin SDK (dùng API kiểu module mới `firebase-admin/app`, `/firestore`, `/auth` — bản `firebase-admin@14` không còn `admin.apps`/`admin.firestore()` kiểu cũ, đã test thật bằng server boot để bắt lỗi này).
- `src/authMiddleware.js` — xác minh Firebase ID token ở header `Authorization: Bearer ...`, lấy số điện thoại từ token đã verify (không tin số điện thoại do client tự gửi lên). `requireAdmin` kiểm theo danh sách số trong `ADMIN_PHONE_NUMBERS`.
- `src/payos.js` — wrapper quanh `@payos/node`; `createPaymentLink`/`webhooks.verify` đã được đọc trực tiếp từ type definition của package đã cài, không phải đoán.
- `src/db.js` — port 1:1 state machine từ `assets/mock-backend.js` (đã qua self-test) sang Firestore, dùng `db.runTransaction` cho mọi thao tác có kiểm tra-rồi-trừ tiền (tạo đơn, rút tiền) để tránh race condition khi 2 request đến cùng lúc.
- `src/routes.js` — REST API, **có kiểm tra quyền sở hữu đơn ở server** (`assertOrderParty`: chỉ đúng buyer/freelancer của đơn đó mới gọi được hành động trên đơn) — đây là lỗ hổng "ai cũng gọi được qua console" đã nêu ở bản fake backend, giờ đã chặn thật ở backend.

Đã test: `node --check` tất cả file, và **thật sự chạy `node server.js`** với một service-account giả (RSA key hợp lệ nhưng không phải tài khoản Google thật) để xác nhận server boot, serve file tĩnh (200), và 2 middleware (`requireAuth` chặn khi thiếu token, DB code chạy tới đúng bước gọi Firestore) hoạt động đúng — **chưa test được với Firebase/payOS thật** vì chưa có project/key thật.

Đã deploy lên Render: https://thayloimuonnoi.onrender.com — tự kiểm tra `GET /healthz` và `GET /` trả 200, `GET /api/*` trả 503 với thông báo rõ ràng (đúng ý đồ, vì chưa có env var Firebase/payOS).

Đã xong (2026-11): frontend rewiring hoàn tất. `dat-don.html`/`freelancer.html`/`admin.html`/`report.html` gọi thẳng `/api/*` qua `assets/api-client.js`, đăng nhập bằng Firebase Phone Auth thật qua `assets/firebase-client.js` (bỏ hẳn `assets/auth-widget.js` và passcode `admin123` — admin giờ gác bằng `ADMIN_PHONE_NUMBERS` trên server). `assets/mock-backend.js` không còn trang nào gọi tới, giữ lại chỉ để tham khảo.

Hai lỗi thật tìm ra khi rewiring, đã sửa:
- `GET /api/freelancers` (public) từng trả nguyên document Firestore, lộ `withdrawable` (số dư) của freelancer cho bất kỳ ai — đã thêm `publicFreelancerView()` lọc field trong `src/routes.js`.
- Firestore `Timestamp` không serialize được qua `JSON.stringify` (ra `{_seconds, _nanoseconds}` thay vì millis) — đã thêm bước `serialize()` chung trong `send()` ở `src/routes.js`, áp dụng cho mọi response.

Việc còn mở để chạy được end-to-end thật:
- [ ] Điền giá trị thật vào `assets/firebase-config.js` (apiKey, appId...) — lấy ở Firebase Console → Project settings → Your apps → Web app.
- [ ] Bật **Phone** ở Firebase Console → Authentication → Sign-in method (nếu chưa bật).
- [ ] Thêm domain `thayloimuonnoi.onrender.com` vào Firebase Console → Authentication → Settings → Authorized domains (reCAPTCHA sẽ chặn nếu thiếu).
- [ ] Set `ADMIN_PHONE_NUMBERS` trên Render (số điện thoại dạng `+84...`, có thể nhiều số cách nhau bằng dấu phẩy) để vào được `admin.html`.
- [ ] Test luồng payOS thật từ trình duyệt (tạo link nạp tiền → thanh toán thử → webhook cộng tiền).
