# Meridian · Supply Chain Management

**Prototype v0.35** — Hệ thống quản lý chuỗi cung ứng cho công ty nhập khẩu drop-ship từ NCC Trung Quốc đến 4 nước ASEAN (VN/TH/MY/PH).

---

## Mục lục

1. [Chạy prototype](#1-chạy-prototype)
2. [Tính năng đã có](#2-tính-năng-đã-có)
3. [Kiến trúc hiện tại](#3-kiến-trúc-hiện-tại)
4. [Schema dữ liệu](#4-schema-dữ-liệu)
5. [Nghiệp vụ cốt lõi](#5-nghiệp-vụ-cốt-lõi)
6. [Lộ trình phát triển backend](#6-lộ-trình-phát-triển-backend)
7. [Stack đề xuất cho production](#7-stack-đề-xuất-cho-production)
8. [Notes cho dev](#8-notes-cho-dev)

---

## 1. Chạy prototype

### Yêu cầu
- Node.js 18+ (https://nodejs.org)
- npm (cài kèm Node.js)

### Cài đặt
```bash
npm install
```

### Chạy local
```bash
npm run dev
```
Mở http://localhost:5173

### Build production
```bash
npm run build
```
Output trong thư mục `dist/`

### Deploy nhanh
- **Vercel**: Push repo lên GitHub → Vercel tự build
- **Netlify**: Kéo thả thư mục `dist` lên https://app.netlify.com/drop
- **Tự host**: Serve thư mục `dist/` bằng nginx/apache

---

## 2. Tính năng đã có

### 7 Modules (sidebar)

| Module | Chức năng |
|---|---|
| **Tổng quan** | Dashboard KPI: công nợ kép, giá trị tồn kho, hàng đang chuyển, PO đang mở, biểu đồ công nợ 30 ngày, cảnh báo |
| **Đơn đặt hàng** | List PO + thẻ NCC · Chi tiết PO · Xuất Excel song ngữ EN+中文 · Tạo PO mới (wizard 3 bước) · Panel chi tiết NCC với 4 tab |
| **Giao hàng** | List delivery đa quốc gia · Tạo delivery (wizard 3 bước) · Xác nhận hàng về · Sửa tracking inline (click icon bút chì) |
| **Tồn kho** | Lot-level view · Filter theo nước · Landed cost (FOB + freight + VAT) per country |
| **Sản phẩm** | CRUD SKU · 3 ngôn ngữ (VI/EN/CN) · Upload ảnh (base64 ≤500KB hoặc URL) · Trọng lượng (g) · Active/discontinued · Sửa mã SKU với cascade rename |
| **Nhà cung cấp** | CRUD NCC · Tên TQ · Contact đầy đủ (email, phone, WeChat, địa chỉ nhà máy) · Active/Inactive |
| **Công nợ** | Dual debt (cam kết + thực tế) · Payment history · Ghi nhận thanh toán (3 fund sources: Pingpong / Tiền nhập khẩu / Khác) · 3 apply modes (Auto FIFO / Single PO / Multi PO) |

### Cross-cutting features
- **Pagination** 5-10 items/trang ở tất cả bảng lớn
- **Sorting thông minh**: Cái cần xử lý lên đầu (in-transit cũ nhất, PO chờ lâu nhất)
- **Visual indicators**: Border trái cam (pending) / xanh (done), opacity cho completed
- **Sidebar collapsible**: 64px ↔ 256px
- **Excel export PO**: Song ngữ EN+中文, tự đặt tên file theo PO + NCC
- **Modal overlays**: 98% opacity xanh dương + backdrop blur

---

## 3. Kiến trúc hiện tại

**Frontend-only React SPA, không có backend.**

```
┌─────────────────────────────────┐
│         src/App.jsx             │
│  (Single-file, ~4000 lines)     │
│                                 │
│  ┌─────────────────────────┐   │
│  │  State (React useState) │   │
│  │  - pos                   │   │
│  │  - deliveries            │   │
│  │  - payments              │   │
│  │  - skus (sync w/ SEED)   │   │
│  │  - suppliers (sync)      │   │
│  └─────────────────────────┘   │
│                                 │
│  Derived (useMemo):             │
│  - lots (from deliveries)       │
│  - inventory (from lots)        │
│  - supplierDebts (pos+payments) │
└─────────────────────────────────┘
```

### Hạn chế hiện tại

- **Không có database**: F5 mất dữ liệu, về seed
- **No auth**: Demo single-user
- **SEED_* arrays bị mutate trực tiếp**: Handlers sửa trong SEED array + setState để trigger rerender. **Phải thay bằng API calls khi có backend.**

---

## 4. Schema dữ liệu

### SKU (Product)
```ts
{
  id: string              // "SKU-001" — có thể sửa với cascade
  name: string            // Tiếng Việt
  name_en: string         // Tiếng Anh
  name_cn: string         // Tiếng Trung (hiển thị trong Excel PO)
  unit: string            // "cái", "bộ", "thùng"
  price_cny: number       // Giá gợi ý mua từ NCC
  weight_g: number        // Trọng lượng (gram)
  image_url: string       // URL hoặc base64 data URI (giới hạn 500KB)
  status: "active" | "discontinued"
}
```

### Supplier
```ts
{
  id: string              // "S001"
  name: string            // Tên tiếng Anh/quốc tế
  name_cn: string         // Tên 中文 (dùng trong Excel PO)
  country: string         // "CN"
  currency: string        // "CNY"
  terms: number           // Điều khoản thanh toán (ngày)
  contact_name: string
  email: string
  wechat: string
  phone: string
  factory_address: string
  status: "active" | "inactive"
}
```

### PurchaseOrder (PO)
```ts
{
  id: string              // "PO-YYYY-MM-DD-NNN" (NNN reset mỗi ngày)
  supplier_id: string
  po_date: string         // "YYYY-MM-DD"
  status: "draft" | "confirmed" | "partial_delivered" | "received" | "closed"
  currency: "CNY"
  notes?: string
  lines: POLine[]
}

// POLine
{
  id: string              // "POL-PO-YYYY-MM-DD-NNN-{idx}"
  sku_id: string
  qty: number
  price: number
  delivered: number       // Cập nhật khi tạo/hủy delivery
}
```

### Delivery
```ts
{
  id: string              // "DEL-001" (global counter)
  destination_id: string  // "W-VN" | "W-TH" | "W-MY" | "W-PH"
  shipped_date: string    // "YYYY-MM-DD"
  arrived_date: string | null
  tracking: string        // Sửa inline được
  status: "in_transit" | "arrived"
  lines: DeliveryLine[]
}

// DeliveryLine
{
  po_line_id: string      // Link tới POLine
  sku_id: string
  qty: number
  unit_price: number      // Snapshot giá từ PO line tại thời điểm tạo
}
```

### Warehouse (hardcoded, 4 nước đích)
```ts
{
  id: "W-VN" | "W-TH" | "W-MY" | "W-PH"
  type: "destination"
  country: string
  code: string            // "VN-HCM", "TH-BKK", ...
  flag: string            // Emoji
  freightRate: number     // CNY/cái
  vat: number             // 0.08 = 8%
}
```

Seed values:
- VN (VN-HCM): freight ¥2.5, VAT 8%
- TH (TH-BKK): freight ¥3, VAT 7%
- MY (MY-KUL): freight ¥3.5, VAT 6%
- PH (PH-MNL): freight ¥4, VAT 12%

### Lot (derived — tự sinh khi delivery arrived)
```ts
{
  id: string              // "LOT-{delivery_id}-{sku_id}"
  sku_id: string
  delivery_id: string
  warehouse_id: string
  received_date: string
  qty: number
  base_cost_cny: number   // Landed cost per cái
}
```

### Inventory (derived from lots)
```ts
{
  sku_id: string
  warehouse_id: string
  lot_id: string
  qty: number
  committed: number       // Đã đặt bán nhưng chưa xuất (prototype: hardcode 0)
}
```

### Payment
```ts
{
  id: string              // "PAY-001"
  supplier_id: string
  date: string
  amount_cny: number
  rate: number            // Tỷ giá CNY/VND tại ngày thanh toán (hiện fix 3550)
  fund_source: "pingpong" | "tien_nhap_khau" | "khac"
  applied_po: string[]    // PO IDs được apply
  apply_mode: "auto" | "single" | "multi"
  note?: string
}
```

### Công nợ (computed)
```ts
supplierDebts[supplier_id] = {
  committed: number   // Tổng PO chưa ship
  shipped: number     // Tổng đã ship
  paid: number        // Tổng đã trả
}

// Dashboard hiển thị:
// Cam kết = Σ committed
// Thực tế = Σ (shipped - paid)
```

---

## 5. Nghiệp vụ cốt lõi

### Quy trình chuẩn

```
1. Tạo PO        → supplier_id + lines (sku, qty, price)
   ↓
2. NCC ship hàng → Tạo Delivery (chọn destination + chọn lines từ 1+ PO)
   ↓              po.lines[].delivered += qty
                  Công nợ cam kết ↓, công nợ thực tế ↑
   ↓
3. Hàng về nước  → "Xác nhận đã về" → sinh Lots → cộng vào Inventory
   ↓              delivery.status = "arrived"
   ↓
4. Thanh toán    → Ghi nhận Payment (fund source + apply mode)
                  Công nợ thực tế ↓
```

### Landed cost formula
```
base_cost_cny (per cái) = unit_price + freight_rate + (unit_price × vat)
```

Ví dụ SKU ¥85 về VN (freight ¥2.5, VAT 8%):
- landed = 85 + 2.5 + 85×0.08 = **¥94.3/cái**

### Dual debt (quan trọng!)
- **Cam kết**: Phần PO **chưa ship** — chưa phát sinh nghĩa vụ pháp lý
- **Thực tế**: Phần PO **đã ship** — NCC đã giao, mình nợ thật

Khi delivery tạo → cam kết ↓, thực tế ↑
Khi payment ghi nhận → chỉ thực tế ↓ (không đụng cam kết)

### Format ID
- PO: `PO-YYYY-MM-DD-NNN` (NNN reset mỗi ngày)
- POLine: `POL-YYYY-MM-DD-NNN-{idx}`
- Delivery: `DEL-NNN` (global counter)
- Payment: `PAY-NNN`
- Lot: `LOT-{delivery_id}-{sku_id}`

### Cascade rename SKU
Khi user sửa `sku.id` từ "SKU-001" → "SKU-A01":
1. Update `SEED_SKUS[idx] = newSku`
2. Forall `po.lines[]` có `sku_id === "SKU-001"` → đổi thành "SKU-A01"
3. Forall `deliveries.lines[]` có `sku_id === "SKU-001"` → đổi thành "SKU-A01"

Validation: Không cho đổi nếu mã mới đã tồn tại ở SKU khác.

---

## 6. Lộ trình phát triển backend

Prototype hiện **không thể dùng cho production** do:
- Không lưu persistent
- Không auth
- Không multi-user
- Không sync với platform bán hàng

### Phase 1 — Backend MVP (2-3 tuần)

1. **Database** (PostgreSQL / Supabase)
   - Tạo schema theo mục 4
   - Indexes: po_date, supplier_id, sku_id, warehouse_id
   - Constraints: FK, UNIQUE(sku_id, supplier_id), etc.

2. **Backend API** (Node.js + NestJS/Fastify, hoặc Python + FastAPI)
   - REST endpoints:
     - `/skus` CRUD + rename cascade transaction
     - `/suppliers` CRUD
     - `/pos` CRUD + status transitions
     - `/deliveries` CRUD + mark arrival → auto create lots
     - `/inventory` read + snapshot import
     - `/payments` CRUD + apply logic
     - `/debts` computed endpoint
   - Auth: JWT hoặc session-based

3. **Frontend**: Thay state local → API calls
   - React Query / SWR cho cache + revalidate
   - Optimistic updates
   - Error handling + retry

### Phase 2 — Sync tồn kho đa kênh (1-3 tháng)

**Đây là feature quan trọng nhất business owner cần.**

Business owner đang bán trên nhiều platform khác nhau ở 4 nước (Shopee VN/TH/MY/PH, Lazada, TikTok Shop, KiotViet, Sapo, etc.), cần tồn kho cập nhật để dự báo đặt hàng.

3 layers từ đơn giản → advanced:

#### Layer 1: Import Excel thủ công (làm ngay)
- User upload file Excel tồn kho mỗi ngày từ từng platform
- Backend parse (format chuẩn: SKU code + country + qty)
- Lưu snapshot kèm timestamp
- Tồn kho hiển thị = snapshot gần nhất
- **Velocity** = chênh lệch giữa các snapshot theo ngày

#### Layer 2: Paste / Email import (nâng cấp)
- Copy-paste trực tiếp từ bảng của platform vào UI
- Hoặc gửi email file Excel → backend parse (Mailgun/SendGrid inbound)

#### Layer 3: API integration (lý tưởng)
- Shopee Open API, Lazada Open Platform, TikTok Shop API
- Scheduled jobs (BullMQ/Celery) mỗi 15 phút
- Credentials lưu encrypted (vault/KMS)
- Rate limit handling, retry, alerts

### Phase 3 — Module Dự báo đặt hàng (1-2 tuần sau Phase 2)

- Velocity = Σ qty_sold_per_day / window_days
- Recommended order = velocity × lead_time × safety_factor − (stock + incoming)
- Priority: critical (<7 days), warning (<30 days), ok (>30 days)
- UI: Dashboard "Dự báo" với filter theo nước, sort mức khẩn cấp
- Bonus: 1-click "Tạo PO từ dự báo" — auto pre-fill form

### Phase 4 — Serial/IMEI tracking (nếu cần cho điện tử)

```ts
Serial {
  id: string
  sku_id: string
  lot_id: string
  status: "in_stock" | "sold" | "defective"
  sold_order_id?: string
}
```

- Khi delivery arrived: sinh bulk serial theo qty (hoặc scan barcode)
- Khi bán ra: mark serial = sold
- Trace: "IMEI này thuộc PO nào, về ngày nào, bán ngày nào"

### Phase 5 — AI features (optional, dùng Anthropic Claude API)

- Chat tư vấn: "SKU nào bán chạy nhất ở VN?"
- Anomaly detection: tồn kho giảm bất thường → cảnh báo
- Auto-generate email cho NCC khi có vấn đề
- Tóm tắt report hàng tuần

---

## 7. Stack đề xuất cho production

### Option A: Full JavaScript (khuyến nghị)

```
Frontend:  React 18 + Vite + Tailwind + shadcn/ui
Backend:   NestJS (Node.js)
Database:  PostgreSQL 15+ (Supabase managed)
Cache:     Redis
Jobs:      BullMQ (scheduled sync)
Auth:      Supabase Auth / NextAuth / Lucia
Deploy:    Vercel (FE) + Railway/Fly.io (BE) + Supabase (DB)
```

### Option B: Python backend

```
Frontend:  React 18 + Vite + Tailwind
Backend:   FastAPI
Database:  PostgreSQL 15+
Cache:     Redis
Jobs:      Celery + Redis broker
Deploy:    Vercel (FE) + Fly.io/Railway (BE+DB)
```

### Option C: Low-code (team non-tech)

```
Frontend:  Giữ React hiện tại
Backend:   Supabase (DB + Auth + Storage + Edge Functions)
Jobs:      Supabase Cron / n8n.io
Deploy:    Vercel + Supabase
```

### Cost estimate (USD/tháng, 10-50 users)

- Supabase Pro: $25
- Vercel Pro: $20 (free tier đủ cho nhỏ)
- Fly.io/Railway: $5-20
- **Tổng: ~$50-100/tháng**

---

## 8. Notes cho dev

### File structure hiện tại
```
meridian-app/
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── README.md               (file này)
└── src/
    ├── main.jsx            React entry
    ├── index.css           Tailwind directives
    └── App.jsx             TOÀN BỘ APP (~4000 lines)
```

### Refactoring priority (trước khi thêm feature)

1. **Tách App.jsx** thành nhiều file:
   ```
   src/
   ├── components/   (DualDebtKPI, NavItem, Pagination, ...)
   ├── views/        (Dashboard, POView, DeliveriesView, ...)
   ├── modals/       (NewPOModal, NewDeliveryModal, ...)
   ├── lib/          (helpers, excel export, formatters)
   ├── types.ts      (interfaces)
   └── App.tsx
   ```

2. **Chuyển sang TypeScript**: Có types đầy đủ → ít bug

3. **State management**: Zustand hoặc Jotai thay cho prop drilling

4. **Routing**: React Router / TanStack Router thay cho `activeView` state

### Design tokens
```css
--navy:        #1a2332   /* Primary dark, sidebar, modal header */
--mustard:     #c4a962   /* Accent, CTA */
--cream:       #f5f2eb   /* Main bg */
--paper:       #faf8f2   /* Secondary bg */
--border:      #e5dfd1   /* Default border */
--text-muted:  #5a6578   /* Secondary text */
--text-label:  #8a7c4f   /* Labels, uppercase small */

--red:         #d97757   /* Danger, in-transit, pending */
--green:       #4a7c59   /* Success, arrived, completed */
--blue:        #4a7bb8   /* Selected state */
--blue-bg:     #dbe8f5   /* Selected bg */
```

### Font stack
- **Fraunces** (serif) — heading, body
- **JetBrains Mono** — code, numbers (class `.mono`)

### Libraries
- `react` 18
- `lucide-react` (icons)
- `recharts` (charts)
- `xlsx` (Excel export — SheetJS)
- `tailwindcss` 3 (không dùng v4)

### Known issues / tech debt

- **SEED_* arrays bị mutate**: Chấp nhận được trong prototype, phải thay khi có backend
- **Global helpers** (`getSupplier`, `getSKU`): Cần wrap trong Context khi scale
- **Không có test**: Ưu tiên thêm khi refactor (Vitest + Testing Library)
- **Không có error boundary**: App crash silently nếu component throw
- **`window.confirm()` ở vài chỗ** (delete serial...): Thay bằng React modal
- **Mixed Tailwind + inline style**: Do Tailwind JIT arbitrary values không ổn định trong artifact. Trong Vite project sẽ OK, có thể refactor về Tailwind hoàn toàn.
- **Date hardcode**: "2026-04-20" xuất hiện ở vài nơi (demo data). Thay bằng `new Date()` khi production.
- **CNY_VND_RATE = 3550** hardcode: Cần fetch từ API tỷ giá hoặc cho admin config.

### Tài liệu tham khảo

- Vite: https://vitejs.dev
- Tailwind v3: https://v3.tailwindcss.com
- lucide-react: https://lucide.dev
- recharts: https://recharts.org
- SheetJS: https://sheetjs.com
- Supabase: https://supabase.com/docs
- NestJS: https://docs.nestjs.com

---

**Prototype version**: v0.35
**Last updated**: 21/04/2026
