---
inclusion: manual
---

# Rule: Cập nhật S3 Storage cho version mới GoChek CRM

Khi tạo version mới (V45, V46...) từ version cũ chưa có S3, áp dụng các bước sau:

## 1. Thêm import s3Storage.js

Thay dòng 3 (sau `import * as XLSX`):

```javascript
import { loadAll, saveAll, addItem, editItem, softDeleteItem, saveSettings as saveSettingsToS3, saveMarkets, alive, s3Flush, startAutoSync, stopAutoSync } from "./s3Storage.js";
```

## 2. Xóa storage layer nội bộ

Tìm block sau và **XÓA TOÀN BỘ**, thay bằng comment:

```javascript
// XÓA:
const _memStore = {};
const hasClaudeStorage = ...;
const storage = {
  get: async (key) => { ... },
  set: async (key, value) => { ... },
};

// THAY BẰNG:
// v[XX]: Storage được chuyển sang s3Storage.js (S3 + localStorage cache + memory fallback)
// Tất cả persistence đi qua: loadAll / saveAll / addItem / editItem / softDeleteItem
// Xem s3Storage.js để biết chi tiết bucket, region, debounce, auto-sync.
```

## 3. Thay data loading (trong useEffect mount)

```javascript
// CŨ:
let saved = await storage.get("crm_data_v38i");
if (!saved) {
  const LEGACY_VERSIONS = ["v38", ...];
  for (const v of LEGACY_VERSIONS) {
    const d = await storage.get(`crm_data_${v}`);
    if (d) { saved = d; migratedFrom = v; break; }
  }
}

// MỚI:
let saved = await loadAll();
if (!saved) {
  const LEGACY_VERSIONS = ["v38i", "v38", "v34", "v31", "v23", ...];
  for (const v of LEGACY_VERSIONS) {
    try {
      const raw = localStorage.getItem(`crm_data_${v}`);
      if (raw) { saved = JSON.parse(raw); migratedFrom = v; break; }
    } catch {}
  }
}
```

## 4. Thay tất cả `storage.set("crm_data_v38i", ...)` → `saveAll(...)`

Có 3 chỗ:
- Sau migration data loaded: `await saveAll(saved);`
- Sau init data mới: `await saveAll(init);`
- Trong hàm `save()`: `await saveAll(synced);`

## 5. Thay `storage.get("crm_data_v38i")` trong session restore → `loadAll()`

```javascript
// CŨ:
const dataToCheck = saved || (await storage.get("crm_data_v38i"));
// MỚI:
const dataToCheck = saved || (await loadAll());
```

## 6. Thêm Auto Sync useEffect (sau useEffect mount `[], []`)

```javascript
// v[XX]: Auto sync S3 — Push/Pull mỗi 2 phút + flush khi đóng tab
const dataRef = useRef(null);
dataRef.current = data;
useEffect(() => {
  if (!loaded) return;
  startAutoSync(() => dataRef.current, (newData) => setData(newData));
  const handleBeforeUnload = () => { s3Flush(dataRef.current); };
  window.addEventListener("beforeunload", handleBeforeUnload);
  return () => {
    stopAutoSync();
    window.removeEventListener("beforeunload", handleBeforeUnload);
  };
}, [loaded]);
```

## 7. Fix handleLogout — flush ngay lập tức

```javascript
// CŨ (BUG — debounce có thể chưa fire khi login lại):
const handleLogout = () => {
  if (user) {
    const log = logAudit("logout", user.username, user);
    save({ ...data, auditLog: [...data.auditLog, log] });
  }
  localStorage.removeItem("crm_session_v38g");
  setUser(null);
};

// MỚI (flush ngay):
const handleLogout = async () => {
  let finalData = data;
  if (user) {
    const log = logAudit("logout", user.username, user);
    finalData = {
      ...data,
      auditLog: [...data.auditLog, log],
      stockMovements: rebuildAutoMovements(data.shipments || [], data.warranties || [], data.stockMovements || []),
    };
    setData(finalData);
  }
  s3Flush(finalData);
  try { localStorage.removeItem("crm_session_v38g"); } catch (e) {}
  setUser(null);
};
```

## 8. Fix migration OB — KHÔNG xóa OB schema mới

```javascript
// CŨ (BUG — xóa TẤT CẢ OB khi flag chưa set):
const oldOBCount = (saved.openingBalances || []).length;
if (oldOBCount > 0 && !saved._v38i_migrated) {
  saved.openingBalances = [];
  saved._v38i_migrated = true;
}

// MỚI (chỉ xóa OB thiếu market/factoryId):
if (!saved._v38i_migrated) {
  const oldSchemaOBs = (saved.openingBalances || []).filter(o => !o.market || !o.factoryId);
  if (oldSchemaOBs.length > 0) {
    saved.openingBalances = (saved.openingBalances || []).filter(o => o.market && o.factoryId);
    saved._v38i_oldOBCount = oldSchemaOBs.length;
    console.warn(`[GoChek CRM v38i] MIGRATION: Đã xóa ${oldSchemaOBs.length} OB schema cũ.`);
  }
  saved._v38i_migrated = true;
}
```

## 9. Xóa banner migration (nếu còn)

- Xóa state `migrationDismissed`
- Xóa hàm `onMigrationDismiss` (đặc biệt nếu nó set `_v38i_migrated: false`)
- Xóa props `migrationFlag` / `onMigrationDismiss` / `oldOBCount` khỏi `<OpeningBalances>`
- Component `OpeningBalances` chỉ nhận: `openingBalances, factories, markets, settings, onAdd, onEdit, onDelete, user`

## 10. Cập nhật main.jsx trỏ đến version mới

Sau khi hoàn tất các bước trên, cập nhật `src/main.jsx` để import version mới nhất:

```javascript
// CŨ:
import App from './GoChek_CRM_V44.jsx'

// MỚI (thay V44 bằng version vừa tạo):
import App from './GoChek_CRM_V45.jsx'
```

Đảm bảo app chạy đúng version mới khi build/dev.

## Checklist xác nhận

- [ ] Không còn `storage.get(` hoặc `storage.set(` trong code
- [ ] Không còn `_v38i_migrated.*false` (tránh trigger migration lại)
- [ ] `handleLogout` dùng `s3Flush()` thay vì `save()`
- [ ] Có `useEffect` auto-sync với `startAutoSync` + `beforeunload`
- [ ] Migration OB chỉ xóa record thiếu `market`/`factoryId`
- [ ] `main.jsx` import đúng version mới nhất
- [ ] Build pass (`npx vite build`)
- [ ] Không có diagnostics error

## 11. Bổ sung guard an toàn: KHÔNG PUT data rỗng / mất record lên S3

Tất cả đường ghi S3 phải đi qua `s3Put()` trong `s3Storage.js`. Không được ghi trực tiếp bằng `fetch(S3_URL, { method: "PUT" })`, `navigator.sendBeacon(S3_URL, ...)`, hoặc helper khác bỏ qua validation.

`s3Put()` bắt buộc validate trước khi PUT:

```javascript
const REQUIRED_KEYS = ["factories", "products", "pos", "shipments", "payments", "users", "settings"];

const PROTECTED_COLLECTION_KEYS = [
  "factories",
  "products",
  "pos",
  "shipments",
  "payments",
  "users",
  "markets",
  "carriers",
  "openingBalances",
  "feePayments",
  "warranties",
  "openingStock",
  "stockImportBatches",
  "stockOnHand",
  "marketTransfers",
];
```

Quy tắc validation bắt buộc:

- Không PUT nếu `data` null, không phải object, hoặc thiếu key bắt buộc.
- Không PUT nếu các collection chính không phải array.
- Không PUT nếu tổng dữ liệu nghiệp vụ rỗng.
- Trước khi PUT, GET bản hiện tại trên S3 để so sánh.
- Không PUT nếu collection protected bị giảm số lượng so với bản S3 hiện tại.
- Không PUT nếu record cũ biến mất khỏi collection. Muốn xóa phải giữ record và gắn marker.
- Delete thường phải gắn `deleted: true`, `deletedAt`, `deletedBy`.
- Hard delete UI cũng không được remove vật lý khỏi JSON; nếu cần phân biệt thì gắn thêm `hardDeleted: true`, `hardDeletedAt`, `hardDeletedBy`.
- UI/calculation phải dùng `alive(...)` hoặc `activeData` để ẩn record đã marker, nhưng file S3 vẫn giữ record.
- `s3Flush()` cũng phải gọi `s3Put(data)`, không dùng `sendBeacon` trực tiếp vì sẽ bỏ qua validation.

Ví dụ delete đúng:

```javascript
const now = new Date().toISOString();
const deletedBy = user?.id || user?.username || "unknown";

save({
  ...data,
  [key]: (data[key] || []).map(x => x.id === id
    ? { ...x, deleted: true, deletedAt: now, deletedBy }
    : x
  ),
  auditLog: newLog,
});
```

Ví dụ delete SAI, không được dùng:

```javascript
save({ ...data, [key]: data[key].filter(x => x.id !== id), auditLog: newLog });
```

Checklist bổ sung:

- [ ] `s3Put()` chặn data rỗng, thiếu key bắt buộc, collection không phải array
- [ ] `s3Put()` so sánh bản S3 hiện tại và block nếu collection bị giảm hoặc record cũ biến mất
- [ ] Không có đường PUT/flush nào bypass validation của `s3Put()`
- [ ] Delete thường/hard delete dùng marker `deleted:true` thay vì `.filter(...)` remove record
- [ ] UI/calculation dùng `alive(...)` hoặc `activeData` để ẩn record đã marker
