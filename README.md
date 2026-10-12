# Mây — Gia sư theo học liệu

Web: https://trankhoa06.github.io/may-gia-su-web/

Mây là web tĩnh chạy trên GitHub Pages. Bạn mở bằng trình duyệt trên máy tính hoặc điện thoại, kể cả khi máy tính đã dùng để xây dựng web đang tắt. Không cần đăng nhập ChatGPT.

## Bắt đầu học

1. Mở **Cài đặt**, bấm **Thêm cấu hình AI**, chọn Google Gemini hoặc OpenAI, đặt tên, nhập khóa và chọn model cho cấu hình đó. Có thể thêm nhiều cấu hình cùng một dịch vụ, tối đa 20 cấu hình.
2. Để nhập nhanh, chọn **Dán nhiều khóa cùng lúc**, chọn dịch vụ rồi dán mỗi khóa trên một dòng. Bấm **Thêm các khóa**, chỉnh tên/model từng cấu hình và **Lưu các cấu hình AI**. Khóa được lưu trong IndexedDB của trình duyệt; ứng dụng chỉ gửi khóa tới dịch vụ tương ứng khi bạn sử dụng tính năng đó. Kho GitHub và bản web công khai không chứa khóa cá nhân.
3. Chọn cấu hình **Giảng bài và hỏi đáp** và **Trò chuyện giọng nói** độc lập. Ví dụ dùng Gemini để tạo bài giảng và OpenAI để trò chuyện. Có thể chọn hai khóa khác nhau của cùng dịch vụ. Tạo môn học, tải PDF hoặc PPTX trong **Thư viện**, chọn học liệu và bấm **Tạo bài học cho tôi**. Trong lớp học/thư viện, đổi cấu hình rồi bấm **Áp dụng lựa chọn**.
4. Mở bài học rồi chọn **Trò chuyện bằng giọng nói**, cho phép micro. Bạn có thể ngắt lời, hỏi lại và yêu cầu giảng tiếp từng phần.

## Theo dõi và hỏi trong buổi học

Mục lục hiển thị tên từng phần. **Bài giảng**, **Hỏi đáp**, **Luyện tập** có khung cuộn riêng; ô hỏi nằm ở tab **Hỏi đáp**, Enter gửi và Shift+Enter xuống dòng. Khi bạn đọc tin cũ, chat không tự kéo xuống; bấm **Tin nhắn mới** để quay về cuối.

Thanh **Đang học / Cần chú ý** giữ tên phần và các ý chính. Với AI giọng nói, gia sư dùng công cụ để báo ý/trang nguồn đang giải thích. Web chỉ chấp nhận nguồn và ý thuộc phần hiện tại; nếu gia sư chưa báo thì ghi rõ chưa có vị trí. **Theo gia sư** chuyển sang nguồn đã được báo; duyệt trang thủ công sẽ tắt chế độ theo, và bạn có thể bật lại. Các nút **Tôi đang ở đâu?**, **Chỉ giúp tôi phần cần nhìn**, **Giảng lại ý này** giúp yêu cầu định hướng lại.

Lời giảng được ghi lại trực tiếp nhưng chữ có thể xuất hiện trước tiếng nói. Điểm chú ý do model chọn, không phải đồng bộ chính xác từng từ với âm thanh. Với giọng đọc của trình duyệt, web chỉ đánh dấu đoạn khi có sự kiện vị trí đọc; nếu giọng đọc không báo vị trí thì không giả lập tiến độ. Khi chuyển phần, phiên giọng nói cũ dừng để tránh tiếp tục nói về phần cũ; bấm **Trò chuyện bằng giọng nói** để bắt đầu phần mới. Bài học đã lưu vẫn dùng được, các ý chính của bài cũ được lấy từ lời giải thích có sẵn.

Hạn mức và phí API phụ thuộc tài khoản Gemini/OpenAI của bạn. GitHub Pages chỉ phục vụ mã và tài nguyên web.

## Dữ liệu cá nhân

Môn học, tài liệu gốc, nội dung trích xuất, bài học, hội thoại, tiến độ và cấu hình được lưu trong trình duyệt bằng IndexedDB. Chúng không được đẩy lên GitHub. Dữ liệu của trình duyệt này không tự xuất hiện trong trình duyệt hoặc thiết bị khác. Xóa dữ liệu trang web hoặc dùng chế độ riêng tư có thể làm mất dữ liệu đã lưu.

Web hỗ trợ PDF có văn bản hoặc ảnh quét và PPTX, tối đa 20 MB/tệp và 200 trang/slide. Mỗi trang PDF được dựng thành ảnh; ảnh raster trong PPTX được giữ cùng chú thích. Hình liên quan được gửi tới model để giải thích cùng văn bản. Bài giảng và câu trả lời có sơ đồ khái niệm với phần giải thích từng mối liên hệ. Một yêu cầu dùng tối đa 8 hình nguồn liên quan; tài liệu nhiều chương nên học theo chủ đề nhỏ. Chi tiết hình mờ hoặc nhỏ có thể cần kiểm tra lại trong tài liệu gốc.

Tổng hình lưu tối đa 10 MB/tài liệu; PPTX tối đa 6 hình/slide và 200 hình/tài liệu. Hình liên kết ngoài, SVG/EMF/WMF, biểu đồ và SmartArt chưa được dựng đầy đủ trong PPTX. Web thông báo trường hợp đó; xuất slide thành PDF để gia sư xem hình đầy đủ. Giọng đọc trình duyệt chỉ đọc chữ; với trang chỉ có hình, cần tạo bài học AI để nghe lời giải thích.

Link NotebookLM mở notebook Google ở tab riêng. Quyền đọc/chia sẻ của notebook cá nhân không nhập nội dung vào Mây. Tải cùng PDF/PPTX vào thư viện để gia sư này giảng; khóa Gemini không cấp quyền đọc NotebookLM. Không cần tài khoản ChatGPT để mở web.

**Kiểm tra cấu hình** trên mỗi thẻ gửi một yêu cầu nhỏ bằng đúng khóa và model của thẻ đó; không đổi lựa chọn đang học. Có khóa chưa đảm bảo model dùng được: khóa cần quyền và hạn mức còn lại. Giọng nói cần trình duyệt hỗ trợ micro và WebRTC/AudioContext, quyền micro, model Live/Realtime khả dụng. Khóa của mỗi dịch vụ chỉ gửi tới endpoint chính thức của dịch vụ đó.

Khóa đã cấu hình trước đây tự chuyển thành thẻ có tên khi cập nhật. Ô mật khẩu đã lưu luôn để trống; sửa tên/model không cần dán lại khóa. Xóa một cấu hình có bước xác nhận và chỉ xóa thật khi bấm **Lưu các cấu hình AI**. Chọn chỉ dùng giọng đọc trình duyệt để tắt AI giọng nói mà vẫn giữ cấu hình hỏi đáp. Web dùng cấu hình bạn chọn, không tự xoay khóa hay đổi tài khoản khi hết hạn mức.

## Phát triển

Cần Node.js 24 trở lên.

```sh
npm ci
npm run dev
npm test
npm run build
```

Workflow GitHub Actions xây dựng và xuất bản GitHub Pages khi nhánh `main` thay đổi. Không cần đặt khóa AI trong GitHub Actions hoặc Secrets.
