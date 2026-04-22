# GoChek · Triển khai lên Vercel

Dự án React + Vite + Tailwind, deploy lên Vercel miễn phí trong 5 phút.

## Cách 1 · Deploy qua GitHub (KHUYẾN NGHỊ)

Đây là cách phổ biến nhất, mỗi lần bạn update code Vercel tự deploy lại.

### Bước 1 · Tạo repo GitHub

1. Tạo tài khoản GitHub tại https://github.com nếu chưa có
2. Vào https://github.com/new
3. Repository name: `gochek` (hoặc tên tùy ý)
4. Chọn **Private** (để người khác không xem được code)
5. Không tick gì cả, bấm **Create repository**

### Bước 2 · Upload code lên GitHub

**Cách đơn giản nhất (không cần cài Git)**:

1. Unzip file `gochek-vercel.zip` ra máy tính
2. Vào trang repo vừa tạo trên GitHub
3. Bấm link **"uploading an existing file"**
4. Kéo thả **tất cả file và thư mục** (trừ `node_modules` nếu có) vào trang
5. Cuộn xuống bấm **Commit changes**

### Bước 3 · Connect Vercel với GitHub

1. Tạo tài khoản Vercel tại https://vercel.com (chọn **Continue with GitHub**)
2. Ở dashboard Vercel bấm **Add New...** → **Project**
3. Chọn repo `gochek` vừa tạo → **Import**
4. Vercel tự nhận diện là Vite project, không cần sửa gì
5. Bấm **Deploy**

Chờ khoảng 1-2 phút, Vercel sẽ cho bạn 1 URL dạng:
```
https://gochek-xxxxx.vercel.app
```

Đây là app của bạn, đã chạy thật trên internet!

### Bước 4 · Cập nhật code sau này

Mỗi lần muốn sửa code:
1. Edit file trên GitHub (bấm vào file → icon bút chì) HOẶC upload file mới
2. Commit
3. Vercel tự build + deploy lại trong 1-2 phút

## Cách 2 · Deploy qua Vercel CLI (nếu bạn quen terminal)

```bash
# Cài Node.js 18+ từ nodejs.org nếu chưa có

# Cài Vercel CLI 1 lần duy nhất
npm install -g vercel

# Vào thư mục dự án
cd gochek-vercel

# Cài dependencies
npm install

# Deploy
vercel

# Làm theo hướng dẫn:
# - Set up and deploy? Y
# - Which scope? chọn account của bạn
# - Link to existing project? N
# - Project name? gochek
# - Directory? ./
# - Override settings? N
```

Sau khi xong bạn sẽ có URL dạng `https://gochek-xxxxx.vercel.app`

Deploy production (không phải preview):
```bash
vercel --prod
```

## Cách 3 · Chạy thử local trước khi deploy

Nếu muốn test app trên máy trước:

```bash
cd gochek-vercel
npm install
npm run dev
```

Mở http://localhost:5173

## Custom domain (tùy chọn)

Nếu bạn đã mua domain riêng (ví dụ `gochek.vn`):

1. Vào Vercel project → **Settings** → **Domains**
2. Nhập domain → **Add**
3. Vercel sẽ chỉ dẫn cấu hình DNS với nhà cung cấp domain

## Giới hạn miễn phí của Vercel

Plan Hobby (miễn phí) đủ cho prototype:
- 100GB bandwidth/tháng
- Không giới hạn số deploy
- HTTPS tự động
- Global CDN

Nếu vượt quá mới cần upgrade lên Pro ($20/tháng).

## Bảo mật quan trọng

**Prototype này dùng mật khẩu plaintext hardcoded trong code.**

Ai xem được code (hoặc dùng F12 xem source) sẽ thấy user/pass của admin.
Đây là demo nội bộ nên OK, nhưng:

- ❌ **KHÔNG** dùng tài khoản thật, email thật, số liệu thật trong prototype này
- ❌ **KHÔNG** public link cho người ngoài khi chưa xóa seed data
- ✅ Chỉ dùng để demo nghiệp vụ, training nội bộ
- ✅ Khi lên production thật, dev phải thay bằng backend có database + password hash

## Tái khởi động app

App lưu trạng thái trong React state, **refresh browser là mất dữ liệu nhập thêm**.
Đây là prototype, không có persistence. Dev cần connect database khi production.

## Xử lý lỗi thường gặp

### Lỗi build trên Vercel
Kiểm tra Vercel log:
- Thiếu dependency → kiểm tra `package.json`
- Lỗi Tailwind → kiểm tra `tailwind.config.js` và `postcss.config.js`

### Trang trắng sau khi deploy
- F12 mở console xem lỗi JavaScript
- Thường do thiếu `index.css` hoặc `main.jsx` sai đường dẫn import

### Icon/font không hiển thị
- Thường do CDN chặn. Kiểm tra network tab F12.

## Hỗ trợ

Nếu dev của bạn cần giúp, gửi họ file này cùng README chính trong zip.
