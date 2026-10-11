# Mây — Gia sư theo học liệu

Web: https://trankhoa06.github.io/may-gia-su-web/

Mây là web tĩnh chạy trên GitHub Pages. Bạn mở bằng trình duyệt trên máy tính hoặc điện thoại, kể cả khi máy tính đã dùng để xây dựng web đang tắt. Không cần đăng nhập ChatGPT.

## Bắt đầu học

1. Mở **Cài đặt**, chọn Google Gemini hoặc OpenAI và model muốn dùng.
2. Nhập khóa API của dịch vụ bạn chọn rồi bấm **Lưu lựa chọn AI**. Khóa được lưu trong IndexedDB của trình duyệt; ứng dụng chỉ gửi khóa tới dịch vụ AI khi bạn sử dụng tính năng đó. Kho GitHub và bản web công khai không chứa khóa cá nhân.
3. Tạo môn học, tải PDF hoặc PPTX trong **Thư viện**, chọn học liệu và bấm **Tạo bài học cho tôi**.
4. Mở bài học rồi chọn **Trò chuyện bằng giọng nói**, cho phép micro. Bạn có thể ngắt lời, hỏi lại và yêu cầu giảng tiếp từng phần.

Hạn mức và phí API phụ thuộc tài khoản Gemini/OpenAI của bạn. GitHub Pages chỉ phục vụ mã và tài nguyên web.

## Dữ liệu cá nhân

Môn học, tài liệu gốc, nội dung trích xuất, bài học, hội thoại, tiến độ và cấu hình được lưu trong trình duyệt bằng IndexedDB. Chúng không được đẩy lên GitHub. Dữ liệu của trình duyệt này không tự xuất hiện trong trình duyệt hoặc thiết bị khác. Xóa dữ liệu trang web hoặc dùng chế độ riêng tư có thể làm mất dữ liệu đã lưu.

Web hỗ trợ PDF có văn bản và PPTX, tối đa 20 MB/tệp và 200 trang/slide. Học liệu scan cần OCR trước. Link NotebookLM mở notebook Google ở tab riêng; nội dung không tự đồng bộ sang Mây.

## Phát triển

Cần Node.js 24 trở lên.

```sh
npm ci
npm run dev
npm test
npm run build
```

Workflow GitHub Actions xây dựng và xuất bản GitHub Pages khi nhánh `main` thay đổi. Không cần đặt khóa AI trong GitHub Actions hoặc Secrets.
