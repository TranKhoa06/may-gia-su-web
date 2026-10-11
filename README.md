# Mây — Gia sư theo học liệu

Web: https://trankhoa06.github.io/may-gia-su-web/

Mây là web tĩnh chạy trên GitHub Pages. Bạn mở bằng trình duyệt trên máy tính hoặc điện thoại, kể cả khi máy tính đã dùng để xây dựng web đang tắt. Không cần đăng nhập ChatGPT.

## Bắt đầu học

1. Mở **Cài đặt**, chọn Google Gemini hoặc OpenAI và model muốn dùng.
2. Nhập khóa API của dịch vụ bạn chọn rồi bấm **Lưu lựa chọn AI**. Khóa được lưu trong IndexedDB của trình duyệt; ứng dụng chỉ gửi khóa tới dịch vụ AI khi bạn sử dụng tính năng đó. Kho GitHub và bản web công khai không chứa khóa cá nhân.
3. Tạo môn học, tải PDF hoặc PPTX trong **Thư viện**, chọn học liệu và bấm **Tạo bài học cho tôi**. Bạn có thể đổi model ngay trên trang lớp học/thư viện bằng **Áp dụng model**.
4. Mở bài học rồi chọn **Trò chuyện bằng giọng nói**, cho phép micro. Bạn có thể ngắt lời, hỏi lại và yêu cầu giảng tiếp từng phần.

Hạn mức và phí API phụ thuộc tài khoản Gemini/OpenAI của bạn. GitHub Pages chỉ phục vụ mã và tài nguyên web.

## Dữ liệu cá nhân

Môn học, tài liệu gốc, nội dung trích xuất, bài học, hội thoại, tiến độ và cấu hình được lưu trong trình duyệt bằng IndexedDB. Chúng không được đẩy lên GitHub. Dữ liệu của trình duyệt này không tự xuất hiện trong trình duyệt hoặc thiết bị khác. Xóa dữ liệu trang web hoặc dùng chế độ riêng tư có thể làm mất dữ liệu đã lưu.

Web hỗ trợ PDF có văn bản hoặc ảnh quét và PPTX, tối đa 20 MB/tệp và 200 trang/slide. Mỗi trang PDF được dựng thành ảnh; ảnh raster trong PPTX được giữ cùng chú thích. Hình liên quan được gửi tới model để giải thích cùng văn bản. Bài giảng và câu trả lời có sơ đồ khái niệm với phần giải thích từng mối liên hệ. Một yêu cầu dùng tối đa 8 hình nguồn liên quan; tài liệu nhiều chương nên học theo chủ đề nhỏ. Chi tiết hình mờ hoặc nhỏ có thể cần kiểm tra lại trong tài liệu gốc.

Tổng hình lưu tối đa 10 MB/tài liệu; PPTX tối đa 6 hình/slide và 200 hình/tài liệu. Hình liên kết ngoài, SVG/EMF/WMF, biểu đồ và SmartArt chưa được dựng đầy đủ trong PPTX. Web thông báo trường hợp đó; xuất slide thành PDF để gia sư xem hình đầy đủ. Giọng đọc trình duyệt chỉ đọc chữ; với trang chỉ có hình, cần tạo bài học AI để nghe lời giải thích.

Link NotebookLM mở notebook Google ở tab riêng. Quyền đọc/chia sẻ của notebook cá nhân không nhập nội dung vào Mây. Tải cùng PDF/PPTX vào thư viện để gia sư này giảng; khóa Gemini không cấp quyền đọc NotebookLM. Không cần tài khoản ChatGPT để mở web.

**Kiểm tra kết nối AI** trong cài đặt gửi một yêu cầu nhỏ tới model đã lưu. Có khóa chưa đảm bảo model dùng được: khóa cần quyền và hạn mức còn lại. Giọng nói cần trình duyệt hỗ trợ micro và WebRTC/AudioContext, quyền micro, model Live/Realtime khả dụng. Khóa của mỗi dịch vụ chỉ gửi tới endpoint chính thức của dịch vụ đó.

## Phát triển

Cần Node.js 24 trở lên.

```sh
npm ci
npm run dev
npm test
npm run build
```

Workflow GitHub Actions xây dựng và xuất bản GitHub Pages khi nhánh `main` thay đổi. Không cần đặt khóa AI trong GitHub Actions hoặc Secrets.
