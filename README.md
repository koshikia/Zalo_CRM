# Zalo CRM - Module 1

Node.js + Express + zca-js 2.2.0 + MySQL.

## Chức năng

- QR login bằng zca-js.
- Lưu credential sau QR login để lần sau server tự restore phiên.
- Credential được mã hóa AES-256-GCM trước khi lưu MySQL.
- Dashboard.
- Listener nhận direct message.
- Khi khách hàng nhắn tin:
  - lấy `threadId` làm Zalo ID;
  - gọi `api.getUserInfo(zaloUserId)`;
  - lưu tên / số điện thoại nếu Zalo trả về;
  - cập nhật `last_interaction_at`.
- Không lưu nội dung tin nhắn.
- Không xử lý group message.

## Yêu cầu

- Node.js 20+
- MySQL 8+
- Một tài khoản Zalo có thể đăng nhập QR.

## Cài đặt

```bash
npm install
```

Tạo database:

```bash
mysql -u root -p < database/schema.sql
```

Tạo `.env`:

```bash
copy .env.example .env
```

Linux/macOS:

```bash
cp .env.example .env
```

Tạo encryption key 32 bytes:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Dán kết quả vào `CREDENTIAL_ENCRYPTION_KEY`.

Đổi `SESSION_SECRET`.

Sau đó:

```bash
npm start
```

Mở:

http://localhost:3000

## Lưu ý quan trọng

`zca-js` là API không chính thức mô phỏng Zalo Web. Tài liệu upstream cảnh báo việc sử dụng có thể khiến tài khoản bị khóa/ban.

Số điện thoại không được coi là bắt buộc: `getUserInfo()` có thể không trả phone cho một người dùng. Database vì vậy cho phép `phone = NULL`.

## Luồng

Browser -> Express -> ZaloSessionService -> zca-js -> Zalo

Khách nhắn -> listener -> getUserInfo -> upsert customers.

Nội dung message không được ghi vào database.

