# 9Router

> Bản tóm tắt rút gọn đã dịch. Tài liệu chính thức viết bằng tiếng Anh, xem
> [README.md](../README.md) và [docs/README.md](../docs/README.md).

9Router là một cổng định tuyến AI chạy cục bộ kèm bảng điều khiển. Nó cung cấp
duy nhất một endpoint tương thích OpenAI tại `/v1/*`, dịch mỗi yêu cầu sang
định dạng mà nhà cung cấp được chọn mong đợi, và tự chuyển giữa các mô hình
cũng như giữa các tài khoản, nhờ vậy một cấu hình client duy nhất vẫn hoạt động
khi một nhà cung cấp hết hạn mức, chặn tốc độ hoặc gặp lỗi.

<p align="center">
  <img src="../images/9router.png" alt="Bảng điều khiển 9Router" width="800"/>
</p>

## Cài đặt

```bash
npm install -g 9router
9router
```

Bảng điều khiển nằm ở `http://localhost:20128/dashboard` và API tương thích
OpenAI ở `http://localhost:20128/v1`. Lần đăng nhập đầu tiên dùng
`INITIAL_PASSWORD`, giá trị mặc định là `123456`. Hãy đổi giá trị đó.

Hướng dẫn đầy đủ nằm trong
[docs/getting-started.md](../docs/getting-started.md).

## Tình trạng fork

Kho mã này là một bản fork được duy trì độc lập từ
[decolua/9router](https://github.com/decolua/9router). Nó bám theo dự án gốc
đồng thời mang các bản sửa lỗi và tích hợp riêng theo lịch của chính nó. Tên
9Router, lịch sử của dự án gốc, giấy phép và ghi công tác giả đều được giữ
nguyên.

Dự án gốc chỉ là tham chiếu ở chế độ đọc, mọi phát triển diễn ra tại đây. Bản
fork này không được dự án gốc bảo trợ và không phát ngôn thay cho dự án gốc.

Toàn văn, bao gồm quy trình đồng bộ, nằm ở mục "Fork status" trong
[README.md](../README.md) tiếng Anh.

## Tài liệu

- [README.md](../README.md), trang chính bằng tiếng Anh.
- [docs/README.md](../docs/README.md), mục lục tài liệu.

## Giấy phép

MIT, xem [LICENSE](../LICENSE).
