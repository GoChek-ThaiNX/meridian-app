# Review: migrate storage sang S3 cho `src/GoChek_CRM_V54.jsx`

- Vòng review: 1 (chưa có `.agents/tasks/v54-s3-review.json` trước đó)
- Bản tham chiếu chuẩn: `src/GoChek_CRM_V53.jsx` (đã migrate xong)
- Rule: `.kiro/steering/s3-migration-rule.md`
- File trong phạm vi: `src/GoChek_CRM_V54.jsx`, `src/s3Storage.js`, `src/main.jsx`
- Kết luận: **APPROVED** — không còn finding blocking.

## Bằng chứng xác minh của người implement

Đã đọc `.agents/tasks/v54-verification.txt` (không chạy lại build / không chạy lại bộ kiểm tra của họ):

- Có kết quả build đầy đủ: `npx vite build` → `833 modules transformed`, `built in 17.55s`, `EXITCODE=0`, không error.
  2 cảnh báo còn lại (caniuse-lite cũ, chunk > 500 kB) là cảnh báo có sẵn của dự án.
- Có bảng grep checklist và kết quả Compare-Object giữa V53/V54 theo từng khối.
→ Bằng chứng bắt buộc ĐẦY ĐỦ, không có lý do reject vì thiếu verification.

## Kiểm chứng độc lập (grep hẹp + diff chuẩn hoá)

Để không chỉ tin bảng Compare-Object của người implement, tôi dựng lại 2 bản chuẩn hoá
(thay `v53`/`v54` → `vXX`, `V41-7`/`V41-8` → `V41-X`, trim khoảng trắng cuối dòng) rồi `git diff --no-index`:

- Toàn file: 83 hunk / 1120 dòng diff. Lọc toàn bộ diff theo các từ khoá persistence
  (`readDataStrict|readMetaStrict|writeDataStrict|readDataWithRetry|deleteMarker|aliveData|applyRemoteData|fullDataRef|drainOutbox|drainPromiseRef|enqueueSync|syncWrite|computeLocalDiff|applyDiffToRemote|syncOpsPresent|healRenamedRefs|describeOutboxItem|startAutoSync|stopAutoSync|s3Flush|loadAllStrict|saveAllStrict|alive\(|outbox|_v38i_migrated|localStorage|LEGACY_VERSIONS|handleLogout|beforeunload`)
  → **không có dòng `+`/`-` nào thuộc lớp persistence**; chỉ có 3 dòng khớp và cả 3 đều là phần
  context `@@ ... @@` của hunk (hunk nội dung là CHANGELOG V41-8 và nhánh `qcReports` trong `healRenamedRefs`).
- Diff khoanh vùng khối "STORAGE & UTILS" + đồng bộ nhiều máy + outbox helpers
  (V53 2561–2961 vs V54 2634–3034, 401 dòng): **0 chênh lệch**.
- Các hunk duy nhất nằm trong `export default function App()` là: `qcReports: []` (state + `buildInitData`),
  `if (!Array.isArray(saved.qcReports)) saved.qcReports = []`, migration `_v418_perm_migrated`,
  nhãn/permission của `qcReports`, `ROLE_TAB_ALLOW` + `tabBlocked` (UI). Không hunk nào chạm
  `drainOutbox` / `enqueueSync` / `reloadFromRemote` / `save` / vòng poll / effect auto-sync /
  `onDelete` / `onHardDelete` / `handleLogout`.

Grep chống hồi quy trên cả V54 và V53 — **0 kết quả ở cả hai file**:
`storage.get(`, `storage.set(`, `const storage =`, `storageReadStrict|storageWriteStrict|storageReadWithRetry`,
`DATA_KEY`, `META_KEY`, `_memStore`, `hasClaudeStorage`, `_v38i_migrated = false` / `_v38i_migrated: false`,
`.filter(x => x.id !== id)`, `sendBeacon`.

Đường ghi S3: `Select-String 'method: "PUT"'` trên `src/*.js`,`src/*.jsx` → **duy nhất 1 kết quả**
`src/s3Storage.js:143` (trong `s3PutStrict`, sau `validateShapeBeforeSave` + `validateAgainstPreviousSave`).
V54 không dùng `loadAll(` / `saveAll(` bản không-strict ở bất kỳ đâu.
`src/indexedDbS3Storage.js` có export đủ 6 tên được import (`loadAllStrict`, `saveAllStrict`, `alive`,
`s3Flush`, `startAutoSync`, `stopAutoSync`).

## Kết quả từng mục 0–9

### Mục 0 — `src/s3Storage.js`: PROTECTED_COLLECTION_KEYS — ĐẠT
`src/s3Storage.js:43-66`. Diff git (`git diff src/s3Storage.js`) chỉ thêm 5 dòng:
`bankAccounts`, `carrierRefunds` (dòng 60-61, comment V41-7 tiếng Việt) và `qcReports`
(dòng 63, comment V41-8 tiếng Việt). Toàn bộ key cũ giữ nguyên, bao gồm `auditLog` (dòng 65)
và comment v53 ở dòng 64. Không xoá / không đổi thứ tự key cũ.

### Mục 1 — Import — ĐẠT
`src/GoChek_CRM_V54.jsx:4-5`, ngay sau `import * as XLSX from "xlsx";` (dòng 3):
```
// v54: Toàn bộ dữ liệu nằm trên S3 (1 file JSON) + cache IndexedDB. Xem indexedDbS3Storage.js / s3Storage.js.
import { loadAllStrict, saveAllStrict, alive, s3Flush, startAutoSync, stopAutoSync } from "./indexedDbS3Storage.js";
```
Giống hệt V53:4-5 (chỉ khác chuỗi `v53` → `v54`).

### Mục 2 — Xoá storage layer nội bộ — ĐẠT
`src/GoChek_CRM_V54.jsx:2645-2649` là khối comment giải thích (5 dòng, tiếng Việt), tương ứng
V53:2572-2576. Grep `_memStore`, `hasClaudeStorage`, `const storage =` → 0 kết quả trong V54.

### Mục 3 — Bỏ DATA_KEY/META_KEY, 4 hàm đọc/ghi + marker + mọi call site — ĐẠT
- `DATA_KEY` / `META_KEY`: 0 kết quả.
- 4 hàm đúng chữ ký và khớp V53: `readDataStrict({allowCache})` (2715 ↔ V53 2642),
  `readMetaStrict()` (2718 ↔ 2645), `writeDataStrict(value)` (2726 ↔ 2653),
  `readDataWithRetry(times = 3)` (2728 ↔ 2655).
- `deleteMarker(actor, hard = false)` (2688 ↔ 2615) trả `deleted/deletedAt/deletedBy`
  (+ `hardDeleted/hardDeletedAt/hardDeletedBy` khi `hard`); `aliveData(data)` (2697 ↔ 2624)
  lọc marker ở mọi collection cấp ngoài.
- Call site: `readDataWithRetry(3)` tại 23029; `readDataStrict()` tại 2875 và 2922 (trong `syncWriteOps`)
  và 23643 (`reloadFromRemote`); `writeDataStrict(...)` tại 2914, 23007, 23418, 23430.
- Vòng poll 30s (23680-23690) chỉ gọi `readMetaStrict()` (23686); **không còn nhánh fallback đọc DATA_KEY**,
  và trong `syncWriteOps` sau khi `writeDataStrict(merged)` thành công thì return luôn
  (2927-2930: comment "_meta nằm trong cùng file dữ liệu → ghi xong là đã có bản tóm tắt, không cần ghi thêm")
  → **không còn chỗ ghi `_meta` riêng**.
- `LEGACY_VERSIONS` (23114-23122): đọc trực tiếp `localStorage.getItem(\`crm_data_${v}\`)` trong `try/catch`,
  mảng bắt đầu bằng `"v38i"`.
- Session restore (23453-23455): `const dataToCheck = saved || fullDataRef.current || (await readDataStrict({ allowCache: true })).value;`
  và `const users = alive(dataToCheck?.users || SEED_USERS);` → tài khoản đã gắn marker không restore được phiên.

### Mục 4 — Xoá = gắn marker trong lớp đồng bộ — ĐẠT
- `computeLocalDiff(base, next, actor)` (2740): bản ghi biến mất khỏi `next` được push vào `changed`
  với `set: deleteMarker(actor)` (2765-2768), không còn sinh op "removed".
- `syncWrite(base, next, actor)` (2940) truyền actor xuống `syncWriteOps`.
- `enqueueSync` (23608-23610): `const actor = outboxSafeActor(userRef.current);` đứng **trước**
  `const ops = computeLocalDiff(base, next, actor);` → actor luôn có khi tính diff.
- `applyDiffToRemote(remote, ops, actor)` (2785): nhánh `op.removed` (2820-2826) gắn
  `{ ...arr[i], ...deleteMarker(actor) }` thay vì filter; nhánh `op.added` (2808-2818) ghi đè
  `arr[i] = { ...rec }` khi bản ghi cùng id đang là bản đã xoá (`arr[i]?.deleted && !rec.deleted`).
- `syncOpsPresent` (2850-2856): `op.removed.every(r => { const cur = map.get(r.id); return !cur || !!cur.deleted; })`
  → kiểm tra marker.
- `syncWriteOps` (2898): `merged.stockMovements = rebuildAutoMovements(alive(merged.shipments), alive(merged.warranties), merged.stockMovements || [])`.
- `healRenamedRefs` (4547-4592): build `posAlive = alive(d.pos)`, `shipmentsAlive = alive(d.shipments)`,
  `poMap/shMap/poIds/shIds` đều từ bản còn sống; nhánh `qcReports` riêng của V41-8 **vẫn giữ nguyên**
  (4583-4590 + return 4592) đúng yêu cầu.
- `describeOutboxItem` (2975-2983): tách `dels` (`c.set.deleted === true`) và `edits`, `delCount = dels.length + op.removed.length`
  → hiển thị đúng chữ "xoá".

### Mục 5 — App component — ĐẠT
- `fullDataRef` (22963), `drainPromiseRef` (22964), `applyRemoteData(full, { merge = true } = {})` (22967-22972):
  lưu bản đầy đủ vào ref, đẩy `aliveData(full)` lên state.
- Mọi đường dữ liệu kho → state đi qua `applyRemoteData`, tham số merge khớp V53:
  `forceInitFromErrorScreen` 23009 `{ merge: false }`; nhánh có dữ liệu/migration 23409 (merge mặc định);
  nhánh init mới 23428 `{ merge: false }`; `reloadFromRemote` 23646 (mặc định);
  `drainOutbox` 23600 `applyRemoteData(lastMerged)` + `fullDataRef.current = res.merged` (23564);
  callback `startAutoSync` 23742 (mặc định).
- `rawRemote` (23039): `(saved && !mainRead.fromCache) ? JSON.parse(JSON.stringify(saved)) : null` — có điều kiện `!mainRead.fromCache`.
- `save(next)` (23660-23666): `rebuildAutoMovements(alive(next.shipments), alive(next.warranties), next.stockMovements || [])`
  rồi `setData(aliveData(synced))`, cuối hàm `enqueueSync(base, synced)` (gửi nguyên marker lên kho).
- `drainOutbox()` (23507-23513) là wrapper trả promise qua `drainPromiseRef`, phần việc thật nằm
  trong `drainOutboxOnce()` (23514).
- `onDelete` (23909): `data[key].map(x => x.id === id ? { ...x, ...deleteMarker(user) } : x)` (23924).
  `onHardDelete` (23934): `(data[key] || []).map(x => x.id === id ? { ...x, ...deleteMarker(user, true) } : x)` (23954)
  — `hard = true` đúng yêu cầu.

### Mục 6 — useEffect tự đồng bộ S3 — ĐẠT
`src/GoChek_CRM_V54.jsx:23717-23750`. Khối comment "v54: TỰ ĐỒNG BỘ S3 — Push/Pull mỗi 2 phút + chốt hạ khi đóng tab",
`startAutoSync(() => fullDataRef.current, (newData) => { if (hasPendingSync() || !newData) return; ... applyRemoteData(newData); })`
(guard `hasPendingSync()` đúng), `beforeunload` → `if (fullDataRef.current) s3Flush(fullDataRef.current)` (23745-23746),
cleanup `stopAutoSync()` + `removeEventListener` (23747-23750), deps `[loaded, loadError]` (23750).
Vị trí: ngay trước effect `// v41-2: Mở app → tự gửi các mục chờ "hệ thống"` (23752).

### Mục 7 — handleLogout — ĐẠT
`src/GoChek_CRM_V54.jsx:24636-24649`: `const handleLogout = async () => {`,
`save({ ...data, auditLog: [...data.auditLog, log] })` khi có user,
`try { await drainOutbox(); } catch (e) { console.warn("[v54] Gửi nốt hộp chờ khi đăng xuất thất bại", e); }` (24641),
`if (fullDataRef.current) s3Flush(fullDataRef.current);` (24642), rồi mới
`localStorage.removeItem("crm_session_v38g")` (24645) và `setUser(null)` (24648). Thứ tự đúng.

### Mục 8 — Migration OB — ĐẠT
`src/GoChek_CRM_V54.jsx:23307-23324`: trong `if (!saved._v38i_migrated)` chỉ lọc
`oldSchemaOBs = (saved.openingBalances || []).filter(o => !o.market || !o.factoryId)`,
loại bằng `.map` + `deleteMarker({ username: "migration v38i" })` + `deleteReason` (23316-23319),
ghi `saved._v38i_oldOBCount`, và **luôn** `saved._v38i_migrated = true;` (23323) bên ngoài nhánh `if (oldSchemaOBs.length > 0)`.
Grep `_v38i_migrated` + `false` → 0 kết quả trong toàn file.

### Mục 9 — `src/main.jsx` — ĐẠT
`git diff src/main.jsx`: dòng 3 `import App from './GoChek_CRM_V53.jsx'` → `'./GoChek_CRM_V54.jsx'`.

## Bộ máy đồng bộ v41 còn nguyên — ĐẠT

Còn đủ và không bị thay bằng loadAll/saveAll đơn giản:
- Outbox trên máy: `OUTBOX_KEY = "crm_outbox_v41"` (2949), `outboxReadAll/WriteAll/Add/Update/Remove` (2951-2967),
  claim theo tab + TTL 2 phút (2970-2974), `SYNC_RETRY_DELAYS_MS = [10000, 30000, 60000]` (2950).
- Diff theo từng bản ghi: `computeLocalDiff` / `applyDiffToRemote` / `syncOpsPresent` / `syncWriteOps`
  với `SYNC_MAX_RETRY = 3`, `_meta.rev` + `writeToken` kiểm chứng sau ghi (2869-2940).
- Vòng poll 30s: `SYNC_POLL_MS = 30000` (2667) + effect 23679-23715 (`setInterval(tick, SYNC_POLL_MS)`,
  `pollFailRef` báo offline sau 2 lần lỗi, `syncIsUserBusy()` → chỉ báo thay vì tự tải lại,
  listener `online`/`offline`).
- `drainOutbox`/`drainOutboxOnce` giữ đúng thứ tự thao tác, dừng khi mục đầu chưa gửi được, `scheduleRetry()`,
  nhật ký `sync_recovered`, hộp thoại xung đột.

## Comment tiếng Việt — ĐẠT
Mọi comment mới trong V54 đều tiếng Việt: khối 2645-2649, 2680-2687, 2710-2714, 2765, 2808-2811, 2820-2821,
2851, 2898, 2927-2928, 2975, 4548-4549, 22967, 23036-23038, 23309-23311, 23454, 23717-23721, 23738, 23920-23921,
23951-23952, 24634-24635; `src/s3Storage.js:60,62`.

## Vệ sinh repo — ĐẠT
`git status --porcelain --untracked-files=all`:
```
 M src/main.jsx
 M src/s3Storage.js
?? .agents/tasks/v54-verification.txt
?? src/GoChek_CRM_V54.jsx
?? src/crm_data.json
```
Không có file markdown báo cáo mới trong repo, không có `.tmp/.bak/.orig/~`.
`src/crm_data.json` là file có sẵn từ 08-Jun (trước đợt làm việc ngày 21-Oct) → không phải file tạm của thay đổi này.

## Ghi nhận không-blocking (không yêu cầu sửa)

- `SYNC_KEY_LABELS` (2996-3004) chưa có nhãn cho `qcReports`, `bankAccounts`, `carrierRefunds`
  → thông báo xung đột/hộp chờ hiển thị tên key thô. Chỉ là nhãn hiển thị, giống hệt tình trạng của
  bản tham chiếu V53 (V53 cũng thiếu `bankAccounts`/`carrierRefunds`), không gây mất/ghi sai dữ liệu.
- Migration v40 (`_v40_adj_migrated`, 23349-23375) vẫn xoá vật lý bản ghi khỏi `openingBalances`
  bằng `.filter(o => !movedIds.has(o.id))` khi chuyển sang `debtAdjustments`. Đây là **code giống
  byte-for-byte với V53** (không có hunk diff ở vùng này), tức hành vi đã được chấp nhận ở bản
  tham chiếu, chạy một lần theo cờ, và `validateAgainstPreviousSave` trong `s3Storage.js` vẫn là
  chốt chặn cuối. Ngoài phạm vi review này; nêu ra để lưu vết.

## Verdict

**APPROVED.** Lớp persistence của V54 đồng nhất với V53 (diff chuẩn hoá: 0 chênh lệch trong toàn bộ
vùng persistence; mọi chênh lệch còn lại là tính năng V41-7/V41-8 và UI). Đủ 10/10 mục 0–9 đạt,
bộ máy đồng bộ v41 nguyên vẹn, bằng chứng build `EXITCODE=0` có trong
`.agents/tasks/v54-verification.txt`. Không còn finding blocking.
