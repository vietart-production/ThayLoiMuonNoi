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

- **Số điện thoại người được gọi (callee) là trường bắt buộc khi đặt đơn** — trước đây bị thiếu hoàn toàn (cả `dat-don.html` lẫn `src/db.js`), nghĩa là người nói hộ nhận đơn có kịch bản và giá nhưng không biết gọi cho ai. Buyer nhập ở bước viết lời nhắn, chuẩn hóa về E.164 giống số đăng nhập (`toE164` trong `assets/firebase-client.js`). Đơn còn có thêm: tên người ấy, dịp, thời điểm hẹn gọi (`scheduledAt`, trong 60 ngày tới), và ghi chú riêng cho người nói hộ.
- **Ai thấy gì được quyết định ở server** (`freelancerOrderView`/`buyerOrderView` trong `src/routes.js`), không phải ở giao diện — trước đây API trả nguyên đơn và trang chỉ "giấu" bằng JS, tức dữ liệu đã tới trình duyệt. Người nói hộ: trước khi duyệt chỉ thấy 120 ký tự đầu lời nhắn; **số người nhận chỉ hiện đúng lúc đơn `da_duyet_cho_goi`** (lúc cần gọi), gọi xong là thôi hiện; ghi chú và tên người nhận hiện từ lúc duyệt; **không bao giờ thấy số của người thuê**. Người thuê: không thấy số cá nhân của người nói hộ. Ghi chú riêng cũng phải qua CSKH duyệt (admin thấy cùng lời nhắn), vì người nói hộ đọc được nó.
- **[CHƯA CHỐT — mặc định do Claude đặt, cần chủ dự án duyệt]** Huỷ đơn: buyer tự huỷ được khi lời nhắn **còn chờ duyệt** → hoàn tiền đủ ngay; người nói hộ **từ chối** được khi chờ duyệt hoặc đã duyệt nhưng chưa báo gọi (bắt buộc ghi lý do, buyer thấy lý do) → buyer được hoàn đủ. Trạng thái mới `da_huy` (`cancelledBy`: buyer/freelancer). Lý do chọn mặc định này: trước đây không có đường thoát nào — người nói hộ ốm hay trùng lịch thì đơn kẹt, tiền buyer kẹt. Chưa có chế tài cho người nói hộ từ chối nhiều lần.
- **[CHƯA CHỐT]** Không cho tự đặt đơn với chính mình (chặn tự tạo đánh giá ảo / xoay vòng tiền).
- Kiểm duyệt kịch bản (script) trước khi gọi.
- Ghi âm cuộc gọi làm bằng chứng mặc định — **người nói hộ dùng tính năng ghi âm cuộc gọi có sẵn của điện thoại** (chốt bởi chủ dự án, 18/11/2026), tức phương án (a) ở §6. File nằm trên máy người nói hộ, platform không tự có.
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
- [x] Giải pháp ghi âm cuộc gọi thật — chốt dùng ghi âm có sẵn của điện thoại người nói hộ (§5). Chủ dự án xác nhận các điểm phụ không quan trọng: "xoá ghi âm khi đóng đơn" chỉ áp dụng cho dữ liệu trên platform, file trên máy người nói hộ thì không đụng; việc iPhone/app Google phát thông báo ghi âm cho người được gọi là chấp nhận được. `freelancer.html` chỉ thêm dòng khuyên người nói hộ bật ghi âm trước khi gọi và giữ file ít nhất 48 giờ (bằng `CONFIRM_TIMEOUT_HOURS`, vì người thuê có thể báo tranh chấp tới lúc đó).
- [ ] Thay passcode admin cố định (`admin123` trong code) bằng tài khoản CSKH thật trước khi đưa cho ai ngoài dùng thử.
- [ ] Nối OTP thật — vướng Firebase Phone Auth cần gói Blaze mới gửi được SMS, chưa quyết định nâng gói hay đổi sang SMS provider khác. Đang chạy tạm bằng OTP mô phỏng, xem §12 (rủi ro + cách gỡ khi sẵn sàng).
- [ ] **Thông báo** — hiện không có SMS/email/push nào: người nói hộ phải tự mở trang mới biết có đơn mới hay đơn vừa được duyệt, buyer phải tự mở trang mới biết người nói hộ đã gọi. Với đơn hẹn giờ (đêm Giáng sinh) đây là rủi ro thật. Cần chọn kênh (Zalo OA, SMS, email, web push).
- [ ] Duyệt chính sách huỷ/từ chối và chặn tự đặt đơn (§5) — đang là mặc định Claude đặt.
- [ ] "Ghi âm làm bằng chứng" vẫn đang được quảng cáo ở trang chủ trong khi chưa có ghi âm thật (§6) — cân nhắc sửa câu chữ trước khi mở cho người dùng thật.
- [ ] Danh sách phong cách giọng (10 mục) và danh sách dịp (8 mục) trong `assets/catalog.js` là bản Claude soạn, chưa được duyệt.

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
- [x] Điền giá trị thật vào `assets/firebase-config.js` — xong.
- [ ] ~~Bật Phone ở Firebase Console~~ / ~~thêm Authorized domain~~ — không cần nữa trong lúc dùng OTP mô phỏng (§12), vì không dùng `signInWithPhoneNumber`/reCAPTCHA nữa. Cần làm lại khi chuyển sang Phone Auth thật.
- [ ] Set `ADMIN_PHONE_NUMBERS` trên Render (số điện thoại dạng `+84...`, có thể nhiều số cách nhau bằng dấu phẩy) để vào được `admin.html` — chưa xác nhận đã làm.
- [ ] **Cập nhật `PUBLIC_BASE_URL` trên Render thành `https://thayloimuonnoi-8d725.web.app`** — chưa xác nhận đã làm; vẫn cần đúng dù đang auto-success, vì `checkoutUrl` của payOS vẫn tạo thật.
- [ ] Test webhook payOS thật — đang chủ động bỏ qua, xem §13.

## 11. Tách deploy: Firebase Hosting (frontend) / Render (backend)

Theo yêu cầu, đã tách làm 2 thay vì gộp chung trong 1 Render app:
- **Frontend** → Firebase Hosting (`firebase deploy --only hosting`), domain `https://thayloimuonnoi-8d725.web.app`. Config qua `firebase.json` (ignore các file backend) + `.firebaserc` (chọn project `thayloimuonnoi-8d725`).
- **Backend** → Render, giờ **chỉ còn API** (`server.js` đã bỏ `express.static`), domain `https://thayloimuonnoi.onrender.com`.
- CORS trên backend giới hạn đúng 2 domain Firebase Hosting (`.web.app` và `.firebaseapp.com`) — đã test bằng tay: origin đúng thì có header `Access-Control-Allow-Origin`, origin lạ thì không.
- `assets/api-client.js` gọi API bằng URL tuyệt đối (`API_BASE_URL` trỏ sang Render) vì giờ khác domain với frontend.
- Deploy frontend từ nay là lệnh `firebase deploy --only hosting` (chạy tay hoặc nhờ Claude chạy), **không tự động theo git push** như backend trên Render — khác với backend, đây là điểm cần nhớ.

## 12. OTP mô phỏng (TẠM THỜI — chưa phải xác thực thật)

Firebase Phone Auth gửi SMS thật **bắt buộc phải có gói Blaze** (thẻ ngân hàng), không có cách né — khác với Cloud Functions, đây không phải do kiến trúc chọn sai mà là giới hạn cứng của Firebase. Chưa quyết định nâng Blaze, nên tạm thời dùng cơ chế mô phỏng:

- `src/db.js` (`requestSimulatedOtp`/`verifySimulatedOtp`): server tự sinh mã, **trả thẳng mã đó về cho người gọi** (không gửi SMS), lưu tạm trong Firestore (`otps/{phone}`, hết hạn 10 phút). Khi xác nhận đúng mã, server tạo **Firebase custom token** cho đúng số điện thoại đó (qua `auth.createUser`/`createCustomToken` — thao tác này không cần Blaze) rồi trả về client.
- `assets/firebase-client.js`: client đổi custom token lấy phiên đăng nhập Firebase thật qua `signInWithCustomToken` — từ đây về sau `getIdToken()`, `authMiddleware.js` hoạt động y hệt như Phone Auth thật, không cần sửa gì thêm.
- Đã test toàn bộ chuỗi thật từ ngoài (không qua trình duyệt): xin OTP → xác nhận → đổi lấy ID token qua Identity Toolkit REST API → gọi `/api/wallet` bằng token đó → **200, đúng**.

**Rủi ro — không được coi đây là xác thực thật:** ai biết một số điện thoại là tự "đăng nhập" được vào số đó, không có bước xác minh quyền sở hữu số nào cả. Tuyệt đối không public cho người dùng thật khi còn ở chế độ này.

**Cách quay lại thật:** chỉ cần sửa `assets/firebase-client.js` (đổi lại dùng `signInWithPhoneNumber` + `RecaptchaVerifier` như bản gốc), xoá 2 route `/api/auth/*` mô phỏng — không đụng gì tới `authMiddleware.js`, `src/routes.js` các route khác, hay bất kỳ logic nghiệp vụ nào.

## 13. Nạp ví: tiền thật qua payOS (đã tắt auto-success, 18/11/2026)

Trước đây `/api/wallet/topup-link` tạo link payOS thật rồi **tự cộng ví luôn** không chờ thanh toán. Đã tắt theo yêu cầu chủ dự án ("ngoài OTP, nối thật hết"). Giờ:

- `/api/wallet/topup-link` chỉ tạo link và trả `checkoutUrl` + `orderCode`; `dat-don.html` luôn chuyển sang trang thanh toán của payOS.
- **Chỉ webhook `/api/payos/webhook` cộng tiền**, và chỉ khi: chữ ký hợp lệ, `code === '00'` (thanh toán thành công), `orderCode` là giao dịch mình đã tạo, và số tiền khớp đúng số đã tạo link. Ví được cộng số tiền đã lưu, không phải số trong webhook. Gọi lặp (payOS retry) không cộng 2 lần.
- `orderCode` lạ (payOS gửi request thử khi đăng ký URL webhook) được trả 200 mà không cộng gì — trả lỗi thì payOS sẽ không nhận URL.
- Quay về `dat-don.html?topup=done`, trang hỏi `GET /api/wallet/topups/:orderCode` mỗi 3 giây (tối đa 1 phút) tới khi giao dịch `credited`.

**Bắt buộc làm 1 lần ở my.payos.vn:** khai báo Webhook URL `https://thayloimuonnoi.onrender.com/api/payos/webhook` cho kênh thanh toán đang dùng. Chưa khai báo thì người thuê chuyển tiền xong ví vẫn không lên.

**Chưa test với tiền thật:** `api.selftest.js` giả lập webhook (đúng/sai mã, thiếu tiền, gọi lặp, ping đăng ký), nhưng webhook thật chưa nhận giao dịch nào. Cần nạp thử một khoản nhỏ sau khi khai báo URL.

Mốc tự xác nhận đơn sau `CONFIRM_TIMEOUT_HOURS` (§5) giờ chạy tự động trong `server.js` (lúc khởi động và mỗi giờ) thay vì chờ admin bấm nút. Render gói free ngủ khi không có truy cập nên mốc này có thể trễ tới lần truy cập kế tiếp.

## 14. Nâng cấp marketplace (2026-11) — học theo Playerduo, Cameo, Fiverr

Lý do: danh sách người nói hộ chỉ là một lưới thẻ trong `dat-don.html` với vài trường tự gõ, không nghe được giọng, không có hồ sơ, không có đánh giá có lời. Các sàn thuê người tương tự đều đi theo cùng một luồng: **duyệt danh sách có bộ lọc → xem hồ sơ (mẫu giọng/video, đánh giá) → đặt với form "cho ai, dịp gì, khi nào" → theo dõi đơn theo bước**. Đã dựng đúng luồng đó.

**Trang mới**
- `nguoi-noi-ho.html` — danh sách công khai, không cần đăng nhập. Lọc theo: phong cách giọng (chip), giọng nam/nữ, vùng miền, nhà mạng, giá khởi điểm, đánh giá tối thiểu, chỉ số đẹp, có giọng mẫu, chỉ người đang nhận đơn. Sắp xếp: Gợi ý / đánh giá / nhiều cuộc gọi / giá / mới tham gia. Trạng thái lọc nằm trên URL nên chia sẻ được. "Gợi ý" kéo điểm đánh giá về 4,5 khi còn ít đánh giá, để một đánh giá 5★ không vượt mặt năm mươi đánh giá 4,9★.
- `ho-so.html?id=…` — hồ sơ công khai: giới thiệu, giọng mẫu, thông tin, đánh giá có lời nhận xét (số người thuê bị che `090•••567`, lời nhắn không bao giờ hiện), nút đặt, nút sao chép liên kết để người nói hộ tự chia sẻ.

**Thay đổi lớn**
- **Mã công khai (`publicId`) thay cho số điện thoại** trong mọi thứ công khai — trước đây `GET /api/freelancers` trả số điện thoại cá nhân của mọi người nói hộ cho bất kỳ ai. Người nói hộ cũ được gán mã và đếm lại số cuộc gọi đã hoàn thành ngay lần đầu được đọc.
- **Hồ sơ dùng danh mục cố định** (`assets/catalog.js`) thay cho ô tự gõ, vì chữ tự do không lọc được. Thêm: giới thiệu, giọng nam/nữ, vùng miền, tối đa 5 phong cách giọng, ý nghĩa số đẹp, giờ có thể gọi, bật/tắt nhận đơn.
- **Giọng mẫu**: người nói hộ thu tối đa 20 giây ngay trên trình duyệt (MediaRecorder, 32 kbps) hoặc tải tệp lên. Lưu dạng data URL trong collection riêng `voiceDemos/{phone}` để danh sách vẫn nhẹ — giữ trong Firestore để không phải thêm dịch vụ lưu trữ tệp. Giới hạn 600.000 ký tự (~450 KB), dưới mức 1 MiB/document của Firestore.
- **Đánh giá có lời nhận xét**, công khai trên hồ sơ. Đếm `completedCount` khi đơn đóng (xác nhận, tự xác nhận 48h, hoặc CSKH giải ngân khi tranh chấp).
- `dat-don.html` thành trang đặt đơn + "Đơn của tôi": bảng tạm tính chi tiết, báo thiếu tiền kèm nút nạp đúng số thiếu, nháp lời nhắn giữ trong trình duyệt, đơn chia tab và có thanh tiến độ 4 bước, "Đặt lại" với người cũ.
- `freelancer.html` thành bảng điều khiển: số liệu, đơn nhóm theo việc cần làm (đơn cần gọi có nút bấm gọi, đếm ngược giờ hẹn, nút sao chép lời nhắn), tab hồ sơ + giọng mẫu, tab rút tiền.
- Trang chủ: bỏ 4 hồ sơ minh hoạ, lấy 4 người thật xếp theo "Gợi ý"; thêm mục câu hỏi thường gặp (mọi câu trả lời mô tả đúng cách hệ thống đang chạy, không hứa thêm).
- "Từ X đ" trên thẻ = giá của lời nhắn ~100 chữ, dưới 2 phút, mọi tuỳ chọn ở mức cơ bản, nhân hệ số giá — tính ở server (`fromPrice` trong `src/db.js`).

**Lỗ hổng tìm thấy và đã sửa trong lần này** (đều đã có kiểm thử tự động trong `api.selftest.js`, và kiểm thử đó *thất bại* khi chạy trên backend cũ):
- `POST /api/freelancer/profile` ghi thẳng mọi trường client gửi vào hồ sơ → ai đăng nhập cũng tự đặt được `withdrawable` (số dư rút được), tự gỡ `blocked`, tự sửa điểm đánh giá. Giờ chỉ nhận danh sách trường cho phép.
- Giá đơn tính theo `chars` do client gửi → gửi `chars: 1` kèm lời nhắn 2000 chữ là trả 1.000đ. Các hệ số `duration/speed/emotion/timing` cũng không kiểm → gửi `duration: 0.0001` là gần như miễn phí. Giờ server tự đếm chữ và chỉ nhận đúng các giá trị có trong form.
- Chấm sao không giới hạn (`stars: 1000` thổi phồng điểm). Giờ chỉ nhận số nguyên 1–5.
- Lộ số điện thoại người nói hộ ra công khai (xem trên).

## 15. Hồ sơ người dùng chung (19/11/2026)

Một số điện thoại = một tài khoản, dù người đó chỉ thuê, chỉ nói hộ, hay cả hai — nên có **một trang hồ sơ chung `tai-khoan.html`** ("Hồ sơ của tôi"), mở từ icon người ở header trang chủ (chỉ hiện khi đã đăng nhập) và từ thanh nav các trang. Không nhầm với `ho-so.html?id=…` là hồ sơ *công khai* của một người nói hộ.

- Gồm: tên hiển thị + số điện thoại + ngày tham gia; khối "khi bạn thuê" (số dư ví, số đơn) ai cũng có; khối "khi bạn nói hộ" chỉ hiện số liệu nếu đã lập hồ sơ người nói hộ, chưa thì là lời mời bắt đầu.
- Trường duy nhất sửa được là **tên hiển thị** (`users/{phone}.name`, tối đa 40 ký tự, qua `GET/POST /api/me`; danh sách trường cho phép giống `profileFields`, không đụng được `walletBalance`). Số điện thoại lấy từ id tài khoản, không sửa được.
- **Tên này riêng tư**: chỉ chủ tài khoản thấy, không có trong `buyerOrderView`/`freelancerOrderView`/`publicFreelancerView`.
- **[CHƯA CHỐT]** Có nên cho người nói hộ thấy tên người thuê trên đơn không (để mở đầu cuộc gọi kiểu "tôi gọi thay anh Minh")? Hiện chưa — người nói hộ chỉ thấy tên người được gọi và lời nhắn, và quy tắc "không bao giờ thấy thông tin người thuê" (§5) vẫn giữ nguyên.
