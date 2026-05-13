import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, RadialBarChart, RadialBar } from "recharts";
import * as XLSX from "xlsx";  // v23b: Đọc file xlsx import từ user
import { loadAll, saveAll, addItem, editItem, softDeleteItem, saveSettings as saveSettingsToS3, saveMarkets, alive, s3Flush, startAutoSync, stopAutoSync } from "./s3Storage.js";

// ============================================================
// GoChek Factory CRM — Phiên bản V38k
// ============================================================
// CHANGELOG V38k (vs V38j) — 5 mục:
//
// MỤC TIÊU: Fix bug phiếu Nháp KHÔNG giữ chỗ hàng từ PO + thêm visibility.
//
// VẤN ĐỀ V38j: 2 chỗ loại "Nháp" khỏi tính alreadyShipped:
//   1. availableLines trong ShipmentForm (line 9430)
//   2. calcAtFactoryQty trong helpers V38j (line 2491)
// → Tạo phiếu Nháp A 100 cái → tạo tiếp phiếu Nháp B vẫn thấy hàng "available"
// → Có thể giữ chỗ trùng → khi đổi sang chính thức thì lệch số lượng.
//
// 5 MỤC V38k:
// 1. Fix availableLines: chỉ loại "Hủy", giữ "Nháp" trong alreadyShipped
// 2. Fix calcAtFactoryQty: chỉ loại "Hủy", giữ "Nháp"
// 3. Thêm helper calcReservedByDraft — tổng SL phiếu Nháp đang giữ chỗ
// 4. Thêm cột "Dự kiến xuất" vào bảng chi tiết PO + Shipment expand
// 5. Đổi thứ tự cột chi tiết PO: SKU → SP → SL đặt → Đã giao → Dự kiến xuất → Còn lại → Đơn giá → Giá trị
//
// LƯU Ý: Báo cáo Excel KHÔNG đổi (chị đã quyết — chỉ UI).
//
// ============================================================
// Phiên bản V38j (cũ)
// ============================================================
// CHANGELOG V38j (vs V38i) — 14 mục:
//
// MỤC TIÊU: Tab Tồn kho trở thành "bảng điều khiển vận hành" trả lời 4 câu hỏi:
//   1. Còn bao nhiêu hàng?
//   2. Đang về bao nhiêu?
//   3. Hàng nào cần tạo SH (PO còn hàng)?
//   4. Hàng nào cần đặt PO mới?
//
// SCHEMA THAY ĐỔI:
//   Product:
//     - warehouseTargets: { [whId]: { tonAnToan, khongTheoDoi, slBanNgay } }
//     - thoiGianSanXuat: số ngày NCC sản xuất (chị tự cài)
//     - thoiGianVanChuyen: số ngày vận chuyển (chị tự cài)
//     - soNgayDuKienBan: số ngày dự kiến bán (chị tự cài)
//   StockOnHand (mới): { id, productId, market, warehouseId, quantity, ... }
//
// 14 MỤC:
// 1. Schema Product mới + migration
// 2. Schema StockOnHand mới
// 3. UI cấu hình tồn kho trong ProductForm
// 4. Wizard cấu hình hàng loạt
// 5. Form đơn lẻ + Import Excel cho StockOnHand
// 6. Refactor bảng Tồn kho V23a sang 12 cột (3 mode)
// 7. Logic 2 cột Đề xuất
// 8. Logic 5 trạng thái với lead time
// 9. Bấm ô đề xuất → form prefill
// 10. Tooltip ⓘ
// 11. Filter Trạng thái
// 12. KPI Dashboard "Tồn kho cảnh báo"
// 13. Báo cáo Excel 4 sheets
// 14. Help docs + version_history + Tour
//
// 5 TRẠNG THÁI (ưu tiên: 🔴 > 🟡 > 🔵 > 🟢 > ⚪):
//   ⚪ Không theo dõi: khongTheoDoi=true HOẶC chưa cài tonAnToan
//   🔴 Đặt PO gấp: (Tồn kho + Đi đường + NCC) < SL bán × (SX + VC)
//   🟡 Cần giao về: (Tồn kho + Đi đường) < Ngưỡng VÀ Tồn NCC > 0
//   🔵 Đang về: Đi đường > 0 VÀ Tồn kho ≥ Ngưỡng
//   🟢 Đủ hàng: Tồn kho ≥ Ngưỡng
//
// MIGRATION: SP cũ tự gán warehouseTargets={} → mặc định ⚪ Không theo dõi.
// Chị cấu hình dần. Không phá data cũ.
//
// ============================================================
// Phiên bản V38i (cũ)
// ============================================================
// CHANGELOG V38i (vs V38h) — 9 mục + 4 invariant test:
//
// ⚠️ FIX LOGIC NGHIÊM TRỌNG: V38h có lỗi vô lý "TT đang nợ KHÔNG AI" — OB market
// chỉ tăng công nợ TT mà không làm tăng công nợ NCC tương ứng. V38i fix bằng cách
// chuyển OB sang model GIAO DỊCH TT × NCC: mỗi OB BẮT BUỘC ghi rõ TT nào nợ NCC nào.
// → Cùng 1 OB được dùng từ 2 góc nhìn: tab NCC cộng các TT đang nợ mình, tab TT
// cộng nợ với các NCC. Không thể lệch nhau vì là cùng 1 record.
//
// 1. [Schema MỚI] OpeningBalance bỏ entityType + warehouseId, BẮT BUỘC market + factoryId:
//    {
//      market: "Vietnam",       // BẮT BUỘC — TT đang nợ
//      factoryId: "f-shenzhen", // BẮT BUỘC — Nợ NCC nào
//      type: "debt" | "credit",
//      amount, currency, date, note, status
//    }
//    Hard migration: Storage key bump v38 → v38i, OB cũ XÓA SẠCH (chị đã chốt).
//
// 2. [Form] OpeningBalanceForm 1 mode duy nhất:
//    • Bỏ radio toggle NCC/TT
//    • Cả 2 trường "Thị trường nợ" + "NCC" đều BẮT BUỘC
//    • Bỏ field "Kho" (V38h)
//    • Loại: Nợ gốc (TT đang nợ NCC) / Quỹ TD (TT đã trả thừa cho NCC)
//
// 3. [calcFactoryBalance] Filter mới — cộng OB tất cả TT đang nợ NCC này:
//    openingDebt = OB.filter(o => o.factoryId === factoryId && o.type === "debt").sum
//    Bỏ điều kiện entityType !== "market" (V38h) vì giờ không còn entityType.
//
// 4. [calcMarketBalance] Filter mới — cộng OB của TT này nợ tất cả NCC:
//    openingDebt = OB.filter(o => o.market === market && o.type === "debt").sum
//    → Cùng 1 OB cộng vào CẢ 2 hàm — đảm bảo đối xứng tự nhiên.
//
// 5. [Tab Công nợ đầu kỳ] Refactor:
//    • 2 filter: TT + NCC (cả 2 dropdown luôn hiện)
//    • Cột "Đối tượng" → 2 cột riêng "🌍 TT" + "🏭 NCC"
//    • 4 KPI mới: Tổng nợ gốc CNY / Tổng quỹ TD CNY / Số TT có OB / Số NCC có OB
//    • Banner cảnh báo migration (nếu phát hiện storage cũ)
//
// 6. [Tab Công nợ NCC] Expand hiển thị OB breakdown theo TT:
//    🏭 Shenzhen Audio ▼
//      + OB nợ gốc 80K (cộng từ tất cả TT)
//        └─ 🌍 Vietnam: 50K
//        └─ 🌍 Thailand: 30K
//
// 7. [Tab Công nợ TT] Expand hiển thị OB breakdown theo NCC (thay khung "kho" V38h):
//    🌍 Vietnam ▼
//      + OB nợ gốc 70K (cộng từ tất cả NCC)
//        └─ 🏭 Shenzhen: 50K
//        └─ 🏭 Guangzhou: 20K
//
// 8. [Báo cáo Excel] Cả 2 báo cáo cộng OB đúng:
//    • exportAccountingReport (NCC): cộng OB của tất cả TT nợ NCC này (sheet 1)
//    • exportMarketReport (TT): cộng OB của TT này nợ tất cả NCC (sheet 1)
//    • Cả 2 báo cáo đều thêm sheet riêng "Chi tiết OB" với cột TT + NCC + Loại + Số tiền
//
// 9. [Help docs] Rewrite section opening_balance_v38i:
//    • Giải thích model TT × NCC mới
//    • Cảnh báo về data cũ đã bị xóa
//    • Workflow nhập OB
//    • Ví dụ Vietnam nợ Shenzhen + Guangzhou
//    • Bảng version_history thêm V38i
//    • Tour 5 phút update
//
// 4 INVARIANT TEST (chạy sau khi code):
//    INV1: ∑ OB từ NCC = ∑ OB từ TT (per type) — luôn cân
//    INV2: Tab NCC + Tab TT + Dashboard cùng số liệu OB
//    INV3: Báo cáo Excel NCC + TT cộng đúng OB
//    INV4: Hard delete NCC bị block khi có OB liên quan
//
// CHANGELOG V38h (vs V38g) — 9 mục:
//
// 1. [Schema] OpeningBalance extend với entityType + market + warehouseId:
//    • entityType: "factory" | "market" — phân biệt OB cho NCC vs TT
//    • factoryId — chỉ có khi entityType = "factory" (như cũ)
//    • market — chỉ có khi entityType = "market" (mới)
//    • warehouseId — OPTIONAL khi entityType = "market" (null = OB chung TT)
//    Migration: data cũ không có entityType → tự gán "factory" khi load
//
// 2. [UI Form] OpeningBalanceForm 2 mode:
//    • Mode NCC (như cũ) — chọn factory + nợ gốc/quỹ tín dụng
//    • Mode TT (mới) — chọn market + warehouse (tùy chọn) + nợ gốc/quỹ TD
//    Radio toggle giữa 2 mode, các field tương ứng hiện theo lựa chọn.
//
// 3. [Logic core] calcMarketBalance cộng OB market vào balance:
//    • openingDebtCNY = sum của OB market (type=debt) cho TT này (cả OB chung + OB từng kho)
//    • openingCreditCNY = sum của OB market (type=credit)
//    • remain = totalReceived + openingDebt - openingCredit - totalPaid - pendingPaid - warrantyPending
//    Trả về thêm: openingDebtCNY, openingCreditCNY trong return object.
//
// 4. [Defensive] calcFactoryBalance: filter OB factory thêm điều kiện
//    o.entityType !== "market" → tránh OB market lẫn vào balance NCC.
//    Tương thích ngược với data cũ (không có entityType → vẫn tính cho factory).
//
// 5. [Tab Công nợ đầu kỳ] Mở rộng:
//    • Filter dropdown: Tất cả / 🏭 NCC / 🌍 Thị trường
//    • Cột Đối tượng hiển thị: Icon + Tên (NCC tên, hoặc TT [→ Kho])
//    • Sort theo ngày desc giữ nguyên (V38b)
//
// 6. [Tab Công nợ TT] Thêm khung breakdown OB + theo kho khi expand:
//    • Tổng hợp: hiện thêm dòng "+ OB nợ gốc" và "- OB quỹ tín dụng"
//    • Khung "Breakdown theo kho" mới: hàng ship đến từng kho + OB riêng từng kho
//    • Note rõ: Payment chung TT, không tách kho được (giới hạn kỹ thuật V38h)
//
// 7. [Báo cáo Excel] Báo cáo Thị trường sheet 1 thêm 2 cột:
//    • "OB nợ gốc (CNY)" — OB market type=debt quy đổi CNY
//    • "OB quỹ TD (CNY)" — OB market type=credit quy đổi CNY
//    Cell "Còn phải trả" tự cộng vào theo công thức mới.
//
// 8. [Help docs] Cập nhật:
//    • Section mới opening_balance_v38h — giải thích 2 loại OB + cách tính
//    • Section debts_market — thêm note về OB + breakdown kho
//    • Bảng version_history — thêm dòng V38h
//
// 9. [Audit log] Không cần thêm action mới — create_opening_balance giữ nguyên
//    detail tự động chứa entityType + market + warehouseId qua existing logger.
//
// CHANGELOG V38g (vs V38f) — 8 mục:
//
// 1. [UX nhập số] Component <NumberInput /> mới thay thế <input type="number"> ở 7 chỗ
//    quan trọng (POForm SL+giá, ShipmentForm SL+packages+fee, WarrantyForm SL,
//    ConfirmArriveForm receivedQty). Đặc điểm:
//    • DISABLE scroll wheel (nguyên nhân #1 của nhập nhầm)
//    • DISABLE phím ↑↓ (gõ thủ công thôi)
//    • ẨN spinner ▲▼ qua CSS global (thêm style block)
//    • Vẫn validation min/max, vẫn auto-format
//
// 2. [UX không auto-fill] Bấm "+ Thêm SP" KHÔNG còn tự fill SP đầu tiên trong list.
//    Áp dụng cho POForm, ShipmentForm, WarrantyForm — user phải chọn SP qua Combobox.
//    Tránh được trường hợp user quên đổi SP → lưu nhầm SP đầu list.
//
// 3. [Validation save] Cảnh báo trước khi save nếu form có:
//    • Dòng SP với productId rỗng (chưa chọn)
//    • Dòng SP với SL = 0
//    Áp dụng cho POForm + ShipmentForm + WarrantyForm.
//
// 4. [Validation SL ≤ tồn] ShipmentForm + ConfirmArriveForm: nếu user gõ SL > max
//    (max = available của PO line / quantity đã giao):
//    • Input highlight đỏ + warning text "⚠ Vượt tồn (max: 50)"
//    • Có nút "→ Đặt = 50" để 1 click fix
//    • Block save (đã có sẵn validation, V38g chỉ thêm UX feedback)
//
// 5. [Đổi mật khẩu cá nhân] User tự đổi password — Phương án D:
//    • Nút "🔑 Đổi mật khẩu" trong UserMenu (sidebar, gần nút Đăng xuất)
//    • Modal: Mật khẩu hiện tại + Mật khẩu mới (≥ 6 ký tự) + Nhập lại
//    • Validate: pass cũ đúng + pass mới ≠ pass cũ + khớp xác nhận
//    • Audit log "change_own_password" (KHÔNG ghi password vào log)
//    • Sau đổi: tự logout sau 2s → bắt login lại với pass mới
//
// 6. [Session F5 không logout] Lưu session vào localStorage:
//    • Key 'crm_session_v38g' = { userId, loggedAt, expiresAt }
//    • Rolling 24h: mỗi action tự gia hạn session 24h từ now
//    • Mount app → đọc session → validate (user còn tồn tại + active + chưa hết hạn) → setUser
//    • Logout → xóa session
//    • Hard delete user / set status stopped / admin đổi pass user → invalidate session đó
//
// 7. [Audit log labels + filter] Sửa 2 lỗ hổng:
//    • actionLabelVi thêm 8 action mới: hard_delete_*, rename_*, change_own_password,
//      update_payment_stage → có icon + tiếng Việt
//    • Filter dropdown thêm 4 option: Xóa cứng, Đổi mã, Đổi mật khẩu, Stage TT
//
// 8. [Help docs cập nhật] Thêm 8 section mới + cập nhật bảng version_history + Tour 5 phút:
//    • sort_lists_v38b: thứ tự hiển thị danh sách
//    • reports_v38c: báo cáo Excel sort + cột Stage
//    • hard_delete_v38d: xóa cứng admin only
//    • combobox_v38e: tìm SP theo từ khoá
//    • rename_id_v38f: đổi mã PO/Shipment
//    • change_password_v38g: đổi mật khẩu cá nhân
//    • session_v38g: F5 không logout + session timeout
//    • qty_validation_v38g: nhập SL an toàn (no scroll, no spinner, no auto-fill)
//
// CHANGELOG V38f (vs V38e):
// 1. [Tính năng UX] Cho phép admin SỬA MÃ PO và MÃ ĐƠN GIAO HÀNG ở mọi trạng thái —
//    với điều kiện entity đó "sạch" (không có data con liên quan):
//    📋 PO: KHÔNG có shipment + KHÔNG có feePayment trỏ đến PO này
//    🚚 Shipment: KHÔNG có feePayment + KHÔNG có manual stockMovement trỏ đến
//
// 2. [2 Helper mới — reuse 80% logic từ V38d]
//    • canRenamePO(poId, data, newId) → { allowed, reasons[] }
//    • canRenameShipment(shipmentId, data, newId) → { allowed, reasons[] }
//    Khác canHardDelete*: KHÔNG check status (cho phép sửa mã ở mọi trạng thái).
//    Bonus: Check trùng ID nếu newId được pass — tránh đè lên ID khác.
//
// 3. [Component mới] <RenameIdDialog />
//    Tương tự HardDeleteDialog nhưng dùng cho rename:
//    • Nếu KHÔNG đủ điều kiện → hiện danh sách lý do (vd "Còn 3 shipment trỏ đến PO này")
//    • Nếu đủ điều kiện → bắt user gõ chính xác ID MỚI để xác nhận
//    • Có cảnh báo về báo cáo cũ vẫn ghi mã cũ
//
// 4. [UI POForm + ShipmentForm]
//    • Field ID giờ KHÔNG bị disable nữa khi sửa
//    • Disable có điều kiện: nếu user thường (không admin) → vẫn disable như cũ
//    • Nếu admin: input ID enable, có nút "🔄 Đổi mã" cạnh ô ID
//    • Bấm "🔄 Đổi mã" → mở RenameIdDialog
//
// 5. [Quyền] Chỉ admin sửa được mã ID (đồng bộ với Hard Delete V38d).
//    Lý do: rename ID là hành động cao rủi ro — báo cáo Excel cũ đã xuất sẽ
//    vẫn ghi mã CŨ, không update được. Audit log ghi "rename_po" / "rename_shipment"
//    với cả oldId + newId để truy cứu sau này.
//
// 6. [Audit log] 2 action mới:
//    • rename_po — detail: { oldId, newId, snapshot }
//    • rename_shipment — detail: { oldId, newId, snapshot }
//
// CHANGELOG V38e (vs V38d):
// 1. [Tính năng UX] Thay select dropdown cứng bằng combobox tìm kiếm theo từ khoá
//    cho 3 vị trí chọn sản phẩm:
//    a) POForm — chọn SP cho PO (lọc theo NCC)
//    b) WarrantyForm — chọn SP cho bảo hành (toàn bộ)
//    c) ShipmentForm — chọn dòng PO để giao hàng (search được PO ID + SKU + tên)
//
// 2. [Component mới]
//    • <Combobox /> — generic, dùng được cho mọi list. Props: items, value, onChange,
//      getKey, getLabel, getSearchText, renderItem, placeholder, excludeKeys, disabled
//    • Behavior: gõ filter realtime, ↑↓ Enter Esc, click ngoài để đóng,
//      bold phần match, scroll vào item đang highlight, hiển thị toàn bộ kết quả
//      (có scroll trong dropdown). Empty state: "Không tìm thấy '<keyword>'".
//
// 3. [Áp dụng]
//    • POForm: search theo sku + name + nameImport + category
//    • WarrantyForm: search theo sku + name + nameImport + category
//    • ShipmentForm: search theo po.id + sku + name (mỗi item hiện 2 dòng:
//      PO+SP / tồn+NCC+giá)
//
// CHANGELOG V38d (vs V38c):
// 1. [Tính năng mới] Hard Delete (xóa cứng) cho 4 đối tượng — chỉ admin có quyền:
//    🏭 NCC: status = stopped/cancelled + KHÔNG có (PO + Payment + Opening Balance + Warranty + FeePayment)
//    🚛 Đơn vị VC: status = stopped + KHÔNG có (Shipment + FeePayment)
//    📋 PO: status = Hủy + KHÔNG có (Shipment + Payment liên quan đến NCC qua PO)
//    🚚 Shipment: status = Hủy + KHÔNG có FeePayment
//
// 2. [Workflow] Khi admin bấm "🗑️ Xóa cứng":
//    a. App tự động check ALL điều kiện trên
//    b. Nếu fail → hiện danh sách CỤ THỂ những gì đang chặn (vd "Còn 3 PO + 5 payment")
//    c. Nếu pass → hiện dialog xác nhận với field bắt buộc gõ "DELETE"
//    d. Sau khi xóa: ghi audit log "hard_delete_*" với snapshot toàn bộ data đã xóa
//
// 3. [Helpers mới]
//    • canHardDeleteFactory(factoryId, data) → { allowed, reasons[] }
//    • canHardDeleteCarrier(carrierId, data) → { allowed, reasons[] }
//    • canHardDeletePO(poId, data) → { allowed, reasons[] }
//    • canHardDeleteShipment(shipmentId, data) → { allowed, reasons[] }
//
// 4. [UI] Component <HardDeleteDialog> — modal yêu cầu gõ "DELETE" để confirm.
//    Reuse được cho cả 4 đối tượng. Khi gõ sai → nút "Xóa vĩnh viễn" disabled.
//
// 5. [Audit log] 4 action mới:
//    hard_delete_factory / hard_delete_carrier / hard_delete_po / hard_delete_shipment
//    detail bao gồm: full snapshot của object trước khi xóa.
//
// 6. [Quyền] KHÔNG thêm permission key mới — chỉ check user.role === "admin".
//    Lý do: hard delete là hành động cực kỳ nhạy cảm, không nên giao cho role khác
//    kể cả manager. Admin override mọi permission khác.
//
// CHANGELOG V38c (vs V38b):
// 1. [Sort báo cáo] Tất cả báo cáo Excel xuất ra (4 file × nhiều sheet) đều sort
//    theo ngày nghiệp vụ DESC (mới nhất trên đầu) — đồng bộ với UI V38b.
//    Tie-break: ID lớn hơn lên trên (tạo sau).
//
//    Báo cáo NCC (exportAccountingReport):
//    • Sheet 2 "Chi tiết PO" — sort theo orderDate desc
//    • Sheet 3 "Chi tiết đơn giao hàng" — sort theo departDate desc
//    • Sheet 4 "Lịch sử thanh toán" — sort theo payDate desc
//
//    Báo cáo Tồn kho (exportInventoryReport):
//    • Sheet 2 "Biến động" — đảo từ ASC → DESC (chuẩn hoá)
//    • Sheet 4 "Lịch sử Import" — đã sẵn DESC, không đổi
//
//    Báo cáo Thị trường (exportMarketReport):
//    • Sheet 2 "Chi tiết shipment" — sort theo departDate desc
//    • Sheet 3 "Lịch sử thanh toán" — sort theo payDate desc + THÊM CỘT STAGE
//
//    Báo cáo PO (exportPOReport):
//    • Sheet 1 "Chi tiết PO" — sort theo orderDate desc
//    • Sheet 2 "Tổng hợp" — sort theo orderDate desc
//
// 2. [Fix V38] Báo cáo Thị trường sheet 3 "Lịch sử thanh toán" thiếu cột Stage
//    (V38 đã quên). V38c thêm cột "Stage" + tổng tách "Đã trả" vs "Đang TT" để
//    khớp với sheet 1 (Tổng hợp) sau Cách B.
//
// CHANGELOG V38b (vs V38):
// 1. [Chuẩn hoá thứ tự hiển thị] Toàn bộ 9 list trong app sort theo NGÀY NGHIỆP VỤ desc
//    (mới nhất trên đầu, cũ nhất xuống cuối). Tie-break (cùng ngày): ID lớn hơn lên trên
//    (= record nhập sau). Records không có ngày → đẩy xuống cuối.
//    Áp dụng cho:
//    1) 📋 POs — sort theo orderDate
//    2) 🚚 Shipments — sort theo departDate
//    3) 🔧 Warranties — sort theo sendDate (chuẩn hoá lại với pattern)
//    4) 💸 Payments — sort theo payDate (thay .slice().reverse())
//    5) 🧾 FeePayments trong ShipmentDetail — sort theo payDate
//    6) 💰 Lịch sử TT mỗi NCC trong tab Công nợ NCC — sort theo payDate
//    7) 📋 OpeningBalances — sort theo date
//    8) 📦 stockImportBatches — sort theo date
//    9) 📜 Audit Log — sort theo timestamp
//
// 2. [Helper mới] sortByDateDesc(arr, dateField, idField) — đảm bảo logic
//    đồng nhất + null-safe (record không có ngày → cuối list).
//    Tie-break bằng ID (vì ID có Date.now() — ID lớn = tạo sau).
//
// 3. [Hậu quả nghiệp vụ] Khi nhập payment cũ (vd payDate=01/03) sau payment mới
//    (vd payDate=15/04), payment cũ sẽ ở DƯỚI thay vì TRÊN như V38.
//    Đây là sửa cho ĐÚNG theo yêu cầu chị (sort theo ngày nghiệp vụ).
//
// CHANGELOG V38 (vs V37):
// 1. [Schema] Payment có thêm field paymentStage + stageHistory:
//    • paymentStage: "carrier" (Đã chuyển uỷ thác 🏦) | "transferring" (Đang chuyển QT 🌐) | "completed" (Hoàn tất ✅)
//    • stageHistory: [{stage, at, by}] — audit trail per-payment
//    • Áp dụng cho MARKET_TO_FACTORY only. INTER_FACTORY + Fee Payment auto = "completed"
// 2. [Migration v34 → v38] Mọi payment cũ → paymentStage="completed",
//    stageHistory=[{stage:"completed", at:payDate, by:"(migration)"}].
//    Storage key bump: crm_data_v34 → crm_data_v38. Behavior cũ KHÔNG đổi.
// 3. [Logic công nợ NCC] calcFactoryBalance trả thêm pendingPaidCNY + pendingPaidVND
//    (tổng payment stage 1+2). netPaid CHỈ tính stage 3.
//    stillOwed = totalDebt − netPaid_completed (công thức không đổi).
// 4. [Logic công nợ TT — Cách B] calcMarketBalance:
//    • "Đã trả" CHỈ tính payment stage 3 (completed)
//    • "Đang TT" mới = payment stage 1+2
//    • "Còn phải trả" = Tổng phải trả − Đã trả − Đang TT
//    Sau migration KHÔNG đổi vì payment cũ đều completed.
// 5. [UI Forms]
//    • Form Payment Market→Factory: thêm dropdown stage (default=completed)
//    • Form Payment Inter-Factory: không thêm UI (auto completed)
//    • Form sửa Payment: cho đổi stage, CHẶN quay lùi từ "completed"
// 6. [Tab Thanh toán] Cột "Trạng thái stage" mới + filter dropdown
// 7. [Tab Công nợ NCC] Cột mới "🟡 Đang TT" giữa "Đã trả" và "Còn phải trả"
// 8. [Tab Công nợ TT] Cột mới "🟡 Đang TT" + sửa logic theo Cách B
// 9. [Dashboard]
//    • KPI thứ 7 "🟡 Đang TT" (cạnh "💸 Đã thanh toán")
//    • Cảnh báo "tiền treo lâu": Stage 1 hoặc Stage 2 quá 4 ngày → báo
//      Đếm từ ngày vào stage hiện tại (RESET khi đổi stage). Stage 3 không báo.
//      Hiển thị: số giao dịch + tổng VND đang treo.
//    • Update KpiExplanationAccordion giải thích quan hệ "Đã TT / Đang TT / Còn phải trả"
// 10. [Báo cáo xuất file]
//    • exportAccountingReport: thêm cột "Stage" trong sheet "Lịch sử thanh toán",
//      thêm dòng "Đang TT" trong sheet "Tổng hợp"
//    • exportMarketReport: cập nhật theo Cách B
// 11. [Audit log] Action mới: "update_payment_stage" — log mỗi lần chuyển stage
// 12. [Hướng dẫn] Cập nhật 4 phần: Thanh toán, Công nợ NCC, Công nợ TT, Dashboard
//
// CHANGELOG V37 (vs V36):
// 1. [Tính năng mới] Tab Đặt hàng → nút 📥 Xuất báo cáo PO chi tiết (.xlsx):
//    • Mỗi SP trong PO = 1 dòng (1 PO có thể có nhiều dòng)
//    • 20 cột: Mã PO, Ngày tạo, Ngày duyệt, Người duyệt, Trạng thái, Mã/Tên NCC,
//      SKU, Tên SP, SL đặt, Đơn giá, Tiền tệ, Thành tiền, Ngày dự kiến giao,
//      SL đã giao, SL còn lại, Đã giao về thị trường (text), Đã giao về kho (text),
//      Số lô liên quan, Trạng thái lô
//    • Lọc theo filter hiện tại của tab (NCC / kỳ / trạng thái)
//    • File 2 sheet: "Chi tiết PO" + "Tổng hợp" (mỗi PO 1 dòng tóm tắt + tỷ lệ hoàn thành)
// 2. [Quyền] Yêu cầu quyền export_accounting_report — Admin/Manager/Accountant có sẵn
// 3. [Hướng dẫn] Cập nhật phần "📋 Đặt hàng (PO)" trong tab Hướng dẫn — bổ sung mô tả về xuất báo cáo
// 4. [Bonus fix] shippedFromItem() trước v37 KHÔNG loại trừ shipment Nháp/Hủy →
//    sai số ở Dashboard "Hàng chờ ship", Tab Sản phẩm cột "Đã giao", chi tiết item trong PO,
//    và calcFactoryBalance.expectedDebt. v37 đồng bộ với shippedFromPO (loại Nháp+Hủy).
//    Lưu ý: nếu chị có shipment Nháp đang tồn tại, các số trên có thể THAY ĐỔI NHẸ
//    so với V36 — đây là sửa cho ĐÚNG, không phải bug mới.
//
// CHANGELOG V36 (vs V35):
// 1. [Bug fix] Enforce giới hạn 1.000 dòng/file Import SP — báo lỗi rõ ràng nếu vượt.
// 2. [Bug fix] Reset <input type="file"> sau mỗi lần upload → có thể chọn lại CHÍNH file đó.
// 3. [Bug fix] Thay 12 alert() native bằng ConfirmDialog — đồng bộ UX, tránh sandbox chặn:
//    • ProductForm: upload ảnh > 2MB
//    • POForm: trùng mã PO
//    • ShipmentForm: trùng mã lô
//    • InventoryExportModal: lỗi xuất file
//    • Debts/MarketDebts: validate + thông báo xuất file
//    • MarketForm: trùng tên thị trường
// 4. [UX] Thêm loading spinner khi parse file Excel SP (file lớn 1.000 dòng có thể mất 2-5s).
// 5. [UX] Bảng errors trong ImportProductsModal: giới hạn render 100 dòng đầu + nút
//    "📥 Tải file lỗi (xlsx)" để xem hết — tránh lag khi file có nhiều lỗi.
// 6. [Tính năng mới] Mode "🔀 Upsert thông minh" — SKU mới → tạo, SKU đã có → cập nhật.
//    Cho phép import file hỗn hợp mà không cần tách thành 2 file.
//
// CHANGELOG V35 (vs V34):
// 1. [Tab Sản phẩm] Thêm chức năng Import Excel hàng loạt:
//    • Mode A: Tạo mới hàng loạt — tạo nhiều SKU mới cùng lúc
//    • Mode B: Cập nhật hàng loạt — update giá/kích thước/NCC cho SKU đã có
// 2. [Template] Tải template .xlsx có 2 sheet:
//    • Sheet "Sản phẩm" — header + 2 dòng ví dụ
//    • Sheet "Hướng dẫn" — danh sách NCC, danh mục, currency hợp lệ
// 3. [Validation] Modal Import có 3 bước: chọn mode → upload file → preview & confirm
//    • SKU trùng (mode tạo mới): báo lỗi từng dòng, user có thể bỏ qua
//    • NCC không tồn tại: báo lỗi (yêu cầu tạo NCC trước)
//    • Danh mục không tồn tại: TỰ ĐỘNG tạo mới
//    • Field trống (mode update): giữ giá trị cũ
//    • Tối đa 1000 dòng/file
// 4. [Audit] Mỗi lần import ghi 1 audit log mô tả số SP + tên file
// 5. [Quyền] Chỉ user có quyền manage_products mới thấy nút Import
//
// CHANGELOG V34 (vs V33):
// 1. [Tỷ giá payment] Mỗi Payment NCC giờ lưu tỷ giá riêng tại thời điểm trả:
//    - Field mới: payment.exchangeRate, payment.amountInVND
//    - Khi tạo payment: ô tỷ giá prefill từ settings (cnyToVnd...) → user có thể sửa
//    - Khi hiển thị: ưu tiên amountInVND lưu cứng, fallback toVND() nếu data cũ
// 2. [Hỗn hợp tỷ giá] Theo Phương án 1:
//    • KPI "💸 Đã thanh toán" trên Dashboard → tỷ giá payment (lưu cứng)
//    • 5 KPI khác (Hàng chờ ship/Đang VC/Đã về kho/Còn phải trả/Quỹ TD) → tỷ giá hệ thống
//    • Tab Công nợ NCC: cột "Đã trả" theo tỷ giá payment, cột "Còn phải trả" theo tỷ giá hệ thống
// 3. [Chỉ áp dụng Payment NCC] Không áp dụng cho Fee Payment, MarketBalance giữ nguyên
// 4. [Migration] V33 → V34: backfill exchangeRate + amountInVND cho payment cũ
//    bằng tỷ giá hệ thống hiện tại — đảm bảo behavior cũ không thay đổi
// 5. [UI minh bạch] Thêm ghi chú "(theo tỷ giá lúc trả)" / "(tỷ giá tham chiếu hôm nay)"
//    để người xem hiểu rõ nguồn gốc số VND đang hiển thị
//
// CHANGELOG V33 (vs V32):
// 1. [Dashboard] Tái cấu trúc 6 KPI tài chính NCC — không trùng lặp:
//    🟦 Hàng chờ ship (chưa ra NM) | 🚛 Hàng đang VC | 📦 Hàng đã về kho
//    🟦 Đã thanh toán | 🟥 Còn phải trả | 🟩 Quỹ tín dụng
//    Bỏ KPI "Dự kiến phải trả NCC" (sai logic, gộp lẫn 'chờ ship' + 'đã ship')
//    Đổi label "Còn phải trả (thực tế)" → "Còn phải trả" để đồng bộ tab Công nợ
// 2. [Dashboard] Thêm khu accordion "Cách tính các chỉ số" để minh bạch nghiệp vụ
// 3. [Bug fix] Sửa logic calcDuePayments — cảnh báo đến hạn tính cả 5 trạng thái
//    đã rời NM (Chờ xuất, Đang VC TQ, Đang TQ, Kiểm hoá, Đã TQ), không chỉ Đã về kho.
//    dueDate = (chưa về kho ? departDate : actualArriveDate) + paymentDays
// 4. [Bug fix] Công nợ đầu kỳ: summary tổng nợ + tổng TD loại trừ status="cancelled"
// 5. [Bug fix] Thuế phí nhập khẩu: filter shipments loại trừ Hủy + Nháp ở mọi bảng tổng
// 6. [Bug fix] Đơn giao hàng: summary totalCNY/totalVND + đếm lô về kho/đang VC
//    loại trừ Hủy. Hiển thị thêm dòng phụ "X lô đã hủy" để minh bạch nếu có.
//
// CHANGELOG V32 (vs V31):
// 1. [Data reset] Xóa toàn bộ seed dữ liệu test:
//    - SEED_FACTORIES, SEED_PRODUCTS, SEED_CARRIERS → []
//    - SEED_POS, SEED_SHIPMENTS, SEED_PAYMENTS → []
//    - SEED_WARRANTIES, SEED_OPENING_STOCK, SEED_FEE_PAYMENTS → []
//    - SEED_OPENING_BALANCES, SEED_STOCK_MOVEMENTS → []
//    - SEED_AUDIT_LOG → [] (vốn đã rỗng)
// 2. [Giữ lại] 1 admin user, 4 thị trường + 6 kho, DEFAULT_SETTINGS
// 3. [Storage] Bump key crm_data_v23 → crm_data_v31 để force load seed mới
//    Tự động migrate data cũ từ v23 (user đã nhập data thật) → v31
//
// CHANGELOG V31 (vs V30):
// 1. [Critical] Sửa seed `wh_vn_bd` (không tồn tại) → `wh_vn_dt` ở SEED_OPENING_STOCK
// 2. [Critical] Migration: tự động dọn opening stock + manual movements có warehouseId
//    không tồn tại — đánh dấu cancelled, ghi cancelReason, console.warn để theo dõi
// 3. [Improve] Refactor 14-cấp if-else lồng nhau ở migration storage thành for-loop gọn
// 4. [Improve] Thêm `min={0}` cho 13 number input quan trọng (giá, tỷ giá, ngày công nợ, ...)
// 5. [Fix] Avatar sidebar null-safe: (user.fullName || user.username || "U").charAt(0)
// 6. [Doc] Bổ sung header changelog này
// ============================================================

// ============================================================
// CONSTANTS
// ============================================================
const MARKETS_DEFAULT = ["Vietnam", "Thailand", "Malaysia", "Philippines"];
const getMarketNames = (markets) => (markets && markets.length > 0) ? markets.map(m => m.name) : MARKETS_DEFAULT;
// v13: Bỏ tracking sản xuất → còn 3 trạng thái đơn giản
const PO_STATUSES = ["Chờ duyệt", "Đã duyệt", "Hủy"];
const SHIPMENT_STATUSES = ["Nháp", "Chờ xuất", "Đang vận chuyển TQ", "Đang thông quan", "Kiểm hoá", "Đã thông quan", "Đã về kho", "Hủy"];
// v18: 5 trạng thái bảo hành. 3 trạng thái đầu = "đang treo công nợ TT"
const WARRANTY_STATUSES = ["Đang gửi NM", "NM đang sửa", "Đang trả về kho", "Đã trả về kho", "Hủy"];
// v18: Các trạng thái BH "treo" công nợ thị trường (giá trị hàng tạm thời không tính vào "Còn phải trả" của TT)
const WARRANTY_PENDING_STATUSES = ["Đang gửi NM", "NM đang sửa", "Đang trả về kho"];

// v19: Danh sách 9 loại chứng từ chuẩn cho đơn giao hàng. Không bắt buộc.
// v25b: Hợp đồng chuyển lên đầu (chứng từ gốc), bỏ "Chứng từ kiểm dịch"
const DOCUMENT_TYPES = [
  "Hợp đồng",
  "Commercial Invoice",
  "Packing List",
  "Vận đơn (B/L hoặc AWB)",
  "Tờ khai hải quan",
  "C/O - Giấy chứng nhận xuất xứ",
  "Phiếu nhập kho",
  "Hóa đơn vận chuyển",
  "Chứng từ thanh toán",
];

// v23b: Phần mềm bán hàng kết nối với kho
const POS_SYSTEMS = {
  manual: { id: "manual", label: "Tự quản lý (template CRM)", icon: "📄", color: "#6b7280" },
  nhanh:  { id: "nhanh",  label: "Nhanh.vn",                   icon: "🛒", color: "#2563eb" },
  pancake:{ id: "pancake",label: "Pancake POS",                icon: "🐼", color: "#ec4899" },
};

// v23b: Parser specs — định nghĩa cột map cho 3 nguồn
// Mỗi parser nhận 2D array (rows from Excel) → trả về [{sku, quantity, name?}]
const POS_PARSER_SPECS = {
  manual: {
    label: "Template CRM",
    skuHeaders: ["sku", "mã sp", "mã sản phẩm", "ma sp", "ma san pham"],
    qtyHeaders: ["số lượng", "sl", "sl thực tế", "so luong", "quantity", "qty"],
    nameHeaders: ["tên sp", "tên sản phẩm", "ten sp", "name"],
    noteHeaders: ["ghi chú", "note", "ghi chu"],
  },
  nhanh: {
    label: "Nhanh.vn",
    skuHeaders: ["mã sản phẩm", "ma san pham", "sku"],
    qtyHeaders: ["tồn trong kho", "ton trong kho", "tồn", "ton"],
    nameHeaders: ["tên sản phẩm", "ten san pham"],
  },
  pancake: {
    label: "Pancake POS",
    skuHeaders: ["mã sản phẩm", "ma san pham", "sku"],
    qtyHeaders: ["tồn kho", "ton kho"],
    nameHeaders: ["tên sản phẩm", "ten san pham"],
  },
};

// v23b: 2 mode import
const IMPORT_MODES = {
  opening: { id: "opening", label: "Đầu kỳ tồn kho", description: "Set tồn kho cho 1 thời điểm cụ thể (lần đầu khởi tạo)" },
  adjustment: { id: "adjustment", label: "Điều chỉnh tồn kho", description: "Kéo tồn kho về số đếm thực tế (sau kiểm kê)" },
};

// v36: Giới hạn dòng cho Import SP (Excel) — bảo vệ browser khỏi parse file quá to
const MAX_PRODUCT_IMPORT_ROWS = 1000;

// ============================================================
// v24: HELP CONTENT — Toàn bộ nội dung hướng dẫn sử dụng
// Cấu trúc: 5 phần lớn → mỗi phần có nhiều mục
// Mỗi mục có: id, title, icon, content (mảng các block)
// Block types: "p" (paragraph), "h" (heading), "list" (bullet list),
//              "steps" (numbered), "tip", "warn", "code", "table"
// ============================================================
const HELP_CONTENT = {
  // ============== PHẦN 1: BẮT ĐẦU ==============
  start: {
    label: "🚀 Bắt đầu",
    items: [
      {
        id: "intro",
        title: "Giới thiệu hệ thống",
        icon: "👋",
        keywords: ["intro", "gioi thieu", "tong quan", "overview", "he thong"],
        content: [
          { type: "p", text: "GoChek CRM là hệ thống quản lý nhập khẩu — kế toán nội bộ, được xây dựng riêng cho mô hình kinh doanh của GoChek: nhập hàng từ nhà máy Trung Quốc, phân phối qua nhiều thị trường (VN, TH, MY, PH), bán qua nhiều kênh (Shopee, TikTok, đại lý B2B)." },
          { type: "h", text: "Hệ thống quản lý:" },
          { type: "list", items: [
            "📋 Đặt hàng (PO) với nhà cung cấp Trung Quốc",
            "🚚 Đơn giao hàng (Shipment) — vận chuyển từ nhà máy về kho thị trường",
            "📄 Chứng từ XNK đi kèm mỗi lô (9 loại + N/A)",
            "💵 Thuế phí nhập khẩu + thanh toán",
            "💰 Công nợ với nhà cung cấp + công nợ với thị trường",
            "🔧 Bảo hành sản phẩm (gửi NM sửa)",
            "🏬 Tồn kho theo từng kho × từng SP",
            "📥 Đồng bộ tồn kho từ phần mềm bán hàng (Nhanh.vn / Pancake POS)",
          ]},
          { type: "h", text: "Triết lý vận hành:" },
          { type: "list", items: [
            "Mọi giao dịch đều có audit log — biết ai làm, lúc nào, sửa gì",
            "Không xóa thật — mọi entity quan trọng đều dùng cơ chế Hủy (giữ lại lịch sử)",
            "Tính toán theo ledger (sổ cái) — tồn kho và công nợ luôn truy vết được",
            "Đa tệ tính (CNY ↔ VND) — settings cấu hình tỷ giá",
          ]},
        ],
      },
      {
        id: "roles",
        title: "Phân quyền các role",
        icon: "🔐",
        keywords: ["role", "phan quyen", "quyen", "admin", "manager", "accountant", "staff"],
        content: [
          { type: "p", text: "Hệ thống có 5 role với quyền hạn khác nhau:" },
          { type: "table", headers: ["Role", "Quyền chính", "Đối tượng phù hợp"], rows: [
            ["👑 Admin", "Toàn quyền — bao gồm xóa, hủy bất kỳ entity nào, cấu hình hệ thống, quản lý tài khoản", "Liễu, Giám đốc"],
            ["👔 Manager", "Quản lý vận hành — tạo/sửa PO, shipment, payment, debt, không sửa được role/settings", "Trưởng phòng kế toán"],
            ["📊 Accountant", "Kế toán — nhập payment, fee payment, opening balance, xem báo cáo", "Kế toán viên"],
            ["✏️ Staff", "Tạo/sửa PO, shipment ở trạng thái Chờ xuất; xem các phần khác", "Nhân viên thu mua"],
            ["👁 Viewer", "Chỉ xem — không sửa được gì", "Quản lý cấp cao xem báo cáo"],
          ]},
          { type: "warn", text: "Khi tạo tài khoản mới, hãy chọn role phù hợp với phạm vi công việc — tránh trao quá nhiều quyền không cần thiết." },
        ],
      },
      {
        id: "tour",
        title: "Tour 5 phút — đi qua các tab",
        icon: "🧭",
        keywords: ["tour", "huong dan", "tab", "menu", "sidebar"],
        content: [
          { type: "p", text: "Sidebar bên trái được tổ chức theo nhóm chức năng cho dễ tìm:" },
          { type: "h", text: "🔵 Tổng quan" },
          { type: "list", items: [
            "📊 Dashboard — KPI + cảnh báo (tất cả user)",
          ]},
          { type: "h", text: "🟠 Vận hành (nhập hàng + kho)" },
          { type: "list", items: [
            "📋 Đơn đặt hàng — PO với NCC TQ + xuất báo cáo PO chi tiết (v37)",
            "🚚 Giao hàng — Lô hàng từ NM về kho + chứng từ (có Nháp để thử phân bổ)",
            "🔧 Bảo hành — Gửi NM sửa + theo dõi trả về",
            "🏬 Tồn kho — Tồn theo SP × kho + Import từ Nhanh/Pancake",
          ]},
          { type: "h", text: "🟡 Tài chính" },
          { type: "list", items: [
            "💸 Thanh toán — Lịch sử thanh toán cho NCC",
            "💰 Công nợ NCC — Còn nợ NM TQ bao nhiêu",
            "🌐 Công nợ thị trường — TT chưa chuyển tiền cho công ty",
            "💵 Thuế phí nhập khẩu — Thuế NK, VAT, phí carrier...",
            "📋 Công nợ đầu kỳ — Số đầu kỳ khi triển khai (1 lần)",
          ]},
          { type: "h", text: "🟢 Catalog" },
          { type: "list", items: [
            "📦 Sản phẩm — Catalog + ngưỡng tồn kho + mapping SKU",
          ]},
          { type: "h", text: "⚙️ Hệ thống" },
          { type: "list", items: [
            "📜 Nhật ký — Audit log toàn hệ thống",
            "⚙️ Cấu hình — Hub chứa 5 sub-tabs (xem dưới)",
            "📚 Hướng dẫn — Tab này",
          ]},
          { type: "h", text: "Tab Cấu hình có 5 sub-tabs:" },
          { type: "table", headers: ["Sub-tab", "Mục đích", "Quyền"], rows: [
            ["⚙️ Chung", "Tỷ giá, danh mục SP, trạng thái NCC...", "Admin"],
            ["🏭 Nhà cung cấp", "Quản lý NM Trung Quốc", "Manager"],
            ["🚛 Đơn vị vận chuyển", "Quản lý carrier (DHL, SF...)", "Manager"],
            ["🌍 Thị trường & Kho", "Quản lý TT + kho + cấu hình phần mềm BH", "Manager"],
            ["👥 Tài khoản", "Quản lý user", "Admin"],
          ]},
          { type: "tip", text: "4 mục NCC, Carrier, TT&Kho, Tài khoản trước đây ở sidebar — giờ gộp vào Cấu hình để sidebar gọn hơn (giảm từ 18 xuống 14 tab)." },
          { type: "h", text: "🛡️ Tính năng admin nâng cao (V38d → V38g)" },
          { type: "p", text: "Admin có 4 nhóm thao tác đặc biệt thông qua các nút riêng:" },
          { type: "list", items: [
            "🗑️ Xóa cứng (Hard Delete) — xóa vĩnh viễn NCC/VC/PO/Shipment khi entity 'sạch' (gõ 'DELETE' xác nhận)",
            "🔄 Đổi mã PO/Shipment — khi entity sạch, gõ ID mới để xác nhận",
            "🟡 Cập nhật stage thanh toán — chuyển payment qua 3 giai đoạn carrier → transferring → completed",
            "🔑 Đổi mật khẩu cá nhân — mọi user (nút bên sidebar)",
          ]},
          { type: "p", text: "Mọi thao tác đều có audit log truy cứu được. Xem chi tiết trong các section riêng (Hard Delete, Combobox, Đổi mã, Đổi mật khẩu, Session)." },
          { type: "h", text: "📋 Công nợ đầu kỳ V38i — Model TT × NCC" },
          { type: "p", text: "Mỗi OB là 1 GIAO DỊCH giữa TT × NCC. Bắt buộc ghi rõ TT nào nợ NCC nào. Cùng 1 OB tự động xuất hiện ở cả tab NCC + tab TT + Dashboard + báo cáo Excel — không thể lệch nhau." },
          { type: "warn", text: "V38h cũ có lỗi vô lý (TT đang nợ 'không ai') — V38i đã fix bằng schema mới. OB cũ đã bị xóa khi nâng cấp, vui lòng nhập lại theo cấu trúc mới (xem section 'Công nợ đầu kỳ — Model TT × NCC (V38i)')." },
          { type: "h", text: "🚨 Tồn kho cảnh báo & Đề xuất V38j" },
          { type: "p", text: "Tab Tồn kho có sub-tab mới '🚨 Cảnh báo & Đề xuất' với 12 cột + 5 trạng thái + 2 cột đề xuất tự tính (tạo SH/đặt PO). Bấm vào ô đề xuất → tự mở form với SL prefill." },
          { type: "p", text: "Trước khi dùng, chị cần cấu hình tồn an toàn cho SP: vào tab Sản phẩm → sửa SP → tab '📊 Cấu hình tồn kho'. Hoặc dùng wizard '🪄 Cấu hình tồn kho hàng loạt' để cài nhanh nhiều SP cùng lúc." },
          { type: "p", text: "Xem chi tiết section '📊 Cảnh báo tồn kho & Đề xuất vận hành (V38j)'." },
          { type: "h", text: "🔧 Phiếu Nháp giữ chỗ V38k" },
          { type: "p", text: "Phiếu Nháp giờ giữ chỗ hàng tạm thời (chưa phát sinh công nợ). Tránh trường hợp tạo phiếu trùng. Tab Đặt hàng → expand PO → bảng chi tiết có cột 'Dự kiến xuất' hiển thị SL đang giữ chỗ ở các phiếu Nháp." },
        ],
      },
    ],
  },

  // ============== PHẦN 2: THEO NGHIỆP VỤ ==============
  business: {
    label: "📋 Theo nghiệp vụ",
    items: [
      {
        id: "po",
        title: "Đặt hàng (PO)",
        icon: "📋",
        keywords: ["po", "purchase order", "dat hang", "don hang", "ncc", "supplier"],
        content: [
          { type: "h", text: "Khái niệm:" },
          { type: "p", text: "PO (Purchase Order) là đơn đặt hàng với nhà cung cấp Trung Quốc. Mỗi PO chứa nhiều SP, mỗi SP có giá CNY thỏa thuận." },
          { type: "h", text: "Tạo PO mới:" },
          { type: "steps", items: [
            "Vào tab Đặt hàng → bấm + Thêm PO",
            "Chọn NCC + nhập Mã PO (hoặc để trống tự sinh)",
            "Thêm SP: chọn từ catalog → nhập SL + đơn giá CNY",
            "Lưu",
          ]},
          { type: "tip", text: "Nếu giá NCC khác giá catalog mặc định, cứ nhập giá thực tế — hệ thống sẽ dùng giá trên PO khi tính công nợ. Catalog chỉ là giá tham khảo." },
          { type: "h", text: "Trạng thái PO:" },
          { type: "list", items: [
            "PO không có trạng thái riêng — chỉ là dữ liệu nguồn cho Shipment",
            "PO 'sống' khi có Shipment liên kết — Shipment mới phản ánh đã giao bao nhiêu",
          ]},
          { type: "warn", text: "Sau khi đã có Shipment liên kết, không nên xóa PO. Nếu cần — hãy hủy Shipment trước rồi mới sửa PO." },
          { type: "h", text: "📊 Bảng tổng hợp (v27):" },
          { type: "p", text: "Phía trên danh sách có khu vực '📊 Tổng hợp' với 4 chỉ số:" },
          { type: "list", items: [
            "📋 Số PO — đếm PO khớp filter",
            "💰 Tổng giá trị — Σ giá trị tất cả PO (CNY chính, VND phụ)",
            "🚚 Đã ship — giá trị hàng đã giao (loại trừ Hủy + Nháp)",
            "⏳ Còn lại — Tổng − Đã ship (= chưa giao xong)",
          ]},
          { type: "tip", text: "Tổng tự động cập nhật theo filter: thay đổi NCC / kỳ / trạng thái → tổng đổi ngay. Badge bên phải hiển thị filter đang áp dụng." },
          { type: "h", text: "📥 Xuất báo cáo PO chi tiết (v37):" },
          { type: "p", text: "Bấm nút \"📥 Xuất báo cáo\" ở góc trên phải để tải file Excel (.xlsx) chi tiết. File gồm 2 sheet:" },
          { type: "list", items: [
            "Sheet 1 \"Chi tiết PO\" — 20 cột, mỗi SP trong PO = 1 dòng (1 PO có thể có nhiều dòng): Mã PO · Ngày tạo · Ngày duyệt · Người duyệt · Trạng thái · Mã/Tên NCC · SKU · Tên SP · SL đặt · Đơn giá · Tiền tệ · Thành tiền · Ngày dự kiến giao · SL đã giao · SL còn lại · Đã giao về thị trường · Đã giao về kho · Số lô · Trạng thái lô.",
            "Sheet 2 \"Tổng hợp\" — mỗi PO 1 dòng tóm tắt: tổng giá trị, tổng SL đặt/đã giao/còn lại, tỷ lệ hoàn thành (%), liệt kê thị trường + kho đã giao đến.",
          ]},
          { type: "tip", text: "Modal xuất cho phép lọc thêm theo kỳ + NCC + trạng thái. Khi mở, các filter đang áp dụng ở tab sẽ tự điền sẵn — bấm Tải xuống là xong. Cột \"SL đã giao\" đã loại trừ shipment Nháp + Hủy để tránh sai số." },
          { type: "warn", text: "Quyền xuất báo cáo: dùng chung quyền export_accounting_report — Admin / Manager / Accountant có sẵn. Staff / Viewer không thấy nút." },
        ],
      },
      {
        id: "shipment",
        title: "Đơn giao hàng (Shipment) + Chứng từ",
        icon: "🚚",
        keywords: ["shipment", "lo hang", "giao hang", "chung tu", "documents", "tracking"],
        content: [
          { type: "h", text: "Khái niệm:" },
          { type: "p", text: "Shipment là 1 lô hàng cụ thể từ NM về kho thị trường. 1 PO có thể tách thành nhiều Shipment (giao nhiều lần)." },
          { type: "h", text: "7 trạng thái (forward-only):" },
          { type: "steps", items: [
            "📝 Nháp — vừa tạo, để kế toán thử phân bổ hàng. KHÔNG ảnh hưởng công nợ + tồn kho.",
            "🟠 Chờ xuất — đã duyệt, NM chưa giao. BẮT ĐẦU tính công nợ.",
            "🚚 Đang vận chuyển TQ — đang trong nội địa TQ",
            "🛂 Đang thông quan — đã đến biên giới VN",
            "🔍 Kiểm hoá — hải quan đang kiểm",
            "✅ Đã thông quan — xong thủ tục, đang về kho",
            "🏬 Đã về kho — hoàn tất, hàng nhập kho",
          ]},
          { type: "tip", text: "Mặc định khi tạo lô mới = Nháp. Khi chốt phương án phân bổ → bấm '✅ Lưu & Đẩy chờ xuất' trong Form, hoặc '✅ Duyệt' trên dòng để chuyển sang chính thức." },
          { type: "warn", text: "Trạng thái không quay ngược (trừ Hủy). Lô Chờ xuất KHÔNG thể quay về Nháp." },
          { type: "h", text: "📝 Trạng thái Nháp — đặc thù:" },
          { type: "list", items: [
            "Tạo Nháp để thử phân bổ hàng (vd: 1000 cái về VN/TH/MY/PH theo phương án nào tối ưu)",
            "KHÔNG tính vào công nợ NCC (cả hàng chờ ship và hàng đã ship)",
            "KHÔNG tính vào công nợ thị trường",
            "KHÔNG ảnh hưởng tồn kho (Nháp không thể chuyển sang 'Đã về kho')",
            "KHÔNG tính vào báo cáo Excel + Dashboard KPI",
            "Có sub-tab riêng '📝 Nháp' tách biệt với '🚚 Chính thức'",
            "Xóa Nháp = xóa hẳn (không lưu lịch sử) — vì chưa cam kết gì",
          ]},
          { type: "h", text: "Khi chuyển sang 'Đã về kho':" },
          { type: "list", items: [
            "Hệ thống bật popup nhập SL nhận thực tế cho từng SP",
            "Nếu SL nhận < SL giao → chọn cách xử lý: Hao hụt / Giao sau / Cảnh báo",
            "Tồn kho tự động cộng vào kho theo warehouseId của lô",
          ]},
          { type: "h", text: "Chứng từ (9 loại):" },
          { type: "list", items: [
            "Hợp đồng, Commercial Invoice, Packing List",
            "Vận đơn (B/L hoặc AWB), Tờ khai hải quan, C/O",
            "Phiếu nhập kho, Hóa đơn vận chuyển, Chứng từ thanh toán",
          ]},
          { type: "p", text: "Mỗi loại có 3 trạng thái: ✅ Đã có link / 🚫 Không áp dụng / ⏳ Chờ cập nhật. Bấm vào cell '📄' trên bảng hoặc nút '📝 Cập nhật chứng từ' trong card chi tiết để mở modal cập nhật — KHÔNG cần mở Form sửa lô." },
          { type: "tip", text: "Có thể cập nhật chứng từ KỂ CẢ khi lô đã 'Đã về kho'. Cảnh báo Dashboard chỉ tính các loại 'Chờ' và bỏ qua loại N/A." },
          { type: "h", text: "📊 Bảng tổng hợp (v27):" },
          { type: "p", text: "Phía trên danh sách có khu vực '📊 Tổng hợp' với 4 chỉ số:" },
          { type: "list", items: [
            "🚚 Số lô — đếm lô khớp filter",
            "💰 Tổng giá trị — Σ giá trị các lô (CNY chính, VND phụ)",
            "🏬 Đã về kho — đếm lô status 'Đã về kho'",
            "🛫 Đang vận chuyển — đếm lô đang trong các status VC TQ → Đã thông quan",
          ]},
          { type: "tip", text: "Khi xem sub-tab 📝 Nháp — tổng chỉ tính các lô Nháp. Khi xem 🚚 Chính thức — tổng chỉ tính các lô không phải Nháp. Filter đổi → tổng đổi tức thì." },
        ],
      },
      {
        id: "fees",
        title: "Thuế phí + Thanh toán phí",
        icon: "💵",
        keywords: ["fee", "thue", "phi", "thue nk", "import tax", "vat", "carrier"],
        content: [
          { type: "h", text: "Khái niệm:" },
          { type: "p", text: "Mỗi shipment có thể phát sinh nhiều loại phí: thuế NK, VAT, phí carrier, phí kho... Mỗi phí được lưu trong shipment.fees[]." },
          { type: "h", text: "Cách thêm phí:" },
          { type: "steps", items: [
            "Vào Form sửa Shipment → section 'Thuế phí'",
            "Bấm + Thêm phí → chọn loại + nhập số tiền + tệ",
            "Có thể gán phí cho carrier cụ thể hoặc để chung",
            "Lưu",
          ]},
          { type: "h", text: "Thanh toán từng phần:" },
          { type: "p", text: "1 phí có thể thanh toán nhiều lần (vd: thuế NK chia 2 đợt). Vào tab Thuế phí nhập khẩu → tìm phí → thêm Payment với số tiền + ngày." },
          { type: "tip", text: "Nếu hủy 1 fee payment → không tính vào tổng đã trả nữa. Nhưng phí gốc vẫn còn — chỉ là chưa được thanh toán." },
        ],
      },
      {
        id: "payment_stages_v38",
        title: "💸 Thanh toán & 3 trạng thái stage",
        icon: "💸",
        keywords: ["payment", "thanh toan", "stage", "carrier", "uy thac", "chuyen quoc te", "hoan tat", "v38"],
        content: [
          { type: "h", text: "Khái niệm 3 trạng thái (V38):" },
          { type: "p", text: "Khi GoChek thanh toán cho NCC, dòng tiền không tới ngay mà phải qua nhiều khâu. V38 chia thành 3 stage để Liễu theo dõi 'tiền treo' chính xác:" },
          { type: "list", items: [
            "🏦 Stage 1 — Đã chuyển uỷ thác: GoChek đã chuyển tiền cho carrier/đơn vị uỷ thác xuất của NM. Tiền đã rời TK GoChek nhưng NCC chưa nhận.",
            "🌐 Stage 2 — Đang chuyển quốc tế: Carrier đang chuyển tiền QT cho NCC. Tiền vẫn 'treo' chưa đến tài khoản NCC.",
            "✅ Stage 3 — Hoàn tất thanh toán: NCC xác nhận đã nhận đủ tiền. Công nợ NCC giảm tương ứng. KHÔNG thể quay lui từ trạng thái này.",
          ]},
          { type: "warn", text: "Áp dụng cho: chỉ payment loại 'Thị trường → Nhà máy' (MARKET_TO_FACTORY). Loại 'Liên nhà máy' (INTER_FACTORY) và Phí nhập khẩu auto = Hoàn tất, không có UI stage." },
          { type: "h", text: "Workflow chuyển stage:" },
          { type: "steps", items: [
            "Tạo payment → mặc định stage 'Hoàn tất' (giữ behavior cũ). Có thể đổi thành stage 1 nếu muốn tracking chi tiết.",
            "Nếu chọn stage 1/2 khi tạo: tab Thanh toán có nút quick-update để chuyển stage tiếp",
            "Bấm '→ Đang chuyển QT' khi tiền đã sang carrier → stage 2",
            "Bấm '→ Hoàn tất' khi NCC xác nhận nhận tiền → stage 3 (KHÓA)",
          ]},
          { type: "tip", text: "Có thể quay lui từ stage 2 → stage 1 (nếu phát hiện carrier chưa thực sự chuyển QT). KHÔNG quay lui được từ stage 3. Để sửa: hủy payment và tạo lại." },
          { type: "h", text: "Cảnh báo 'tiền treo lâu':" },
          { type: "p", text: "Dashboard cảnh báo nếu payment ở stage 1 hoặc 2 quá 4 ngày. Đếm từ ngày vào stage (RESET khi đổi stage):" },
          { type: "list", items: [
            "Stage 1 (🏦) > 4 ngày → ngày thứ 5 báo: tiền đã ra carrier nhưng chưa thấy chuyển QT — kiểm tra với uỷ thác",
            "Stage 2 (🌐) > 4 ngày → ngày thứ 5 báo: tiền đang chuyển QT lâu bất thường — verify với carrier",
            "Tổng workflow lý tưởng: ≤ 8 ngày từ tạo đến Hoàn tất",
          ]},
          { type: "tip", text: "Threshold 4 ngày có thể chỉnh trong Cấu hình → Chung → Threshold tiền treo." },
          { type: "h", text: "Migration data cũ (V38):" },
          { type: "p", text: "Mọi payment cũ (trước V38) tự động set stage = 'Hoàn tất' khi mở app lần đầu V38. Behavior cũ KHÔNG đổi. Stage workflow chỉ áp dụng cho payment tạo mới sau khi update V38." },
          { type: "h", text: "Liên hệ với các tab khác:" },
          { type: "list", items: [
            "Tab Thanh toán: cột mới 'Trạng thái' + filter dropdown stage + nút quick-update + highlight cam khi treo > threshold",
            "Tab Công nợ NCC: cột mới '🟡 Đang TT' giữa 'Đã trả' và 'Còn phải trả'",
            "Tab Công nợ thị trường: cột mới '🟡 Đang TT' (Cách B — không tính vào 'Đã trả')",
            "Dashboard: KPI thứ 7 '🟡 Đang TT' cạnh '💸 Đã thanh toán' + cảnh báo tiền treo lâu",
            "Báo cáo NCC + TT (.xls): có thêm cột 'Stage' và dòng 'Đang TT'",
          ]},
        ],
      },
      {
        id: "debts_supplier",
        title: "Công nợ NCC",
        icon: "💰",
        keywords: ["debt", "cong no", "ncc", "supplier", "no nha cung cap", "thanh toan"],
        content: [
          { type: "h", text: "Cách hệ thống tính (V38 cập nhật):" },
          { type: "code", text: "Còn nợ NCC = Đầu kỳ + Σ giá trị Shipment đã về kho − Σ Payment đã HOÀN TẤT − BH treo công nợ" },
          { type: "warn", text: "🆕 V38: CHỈ payment ở stage 'Hoàn tất thanh toán' ✅ mới giảm công nợ. Payment đang ở stage 1 (🏦 Đã chuyển uỷ thác) hoặc stage 2 (🌐 Đang chuyển QT) sẽ được tách riêng vào cột '🟡 Đang TT' — KHÔNG giảm 'Còn phải trả' cho đến khi NCC xác nhận nhận tiền." },
          { type: "h", text: "Các yếu tố:" },
          { type: "list", items: [
            "📋 Đầu kỳ — số nợ tại thời điểm triển khai (tab Công nợ đầu kỳ)",
            "🚚 Shipment 'Đã về kho' — tăng nợ theo (SL × đơn giá PO)",
            "✅ Payment stage 'Hoàn tất' (MARKET_TO_FACTORY) — giảm nợ",
            "🟡 Payment stage 1+2 — KHÔNG giảm nợ, hiển thị riêng cột 'Đang TT'",
            "🔧 Bảo hành treo công nợ — khi 3 lô bảo hành cùng NM ở trạng thái Pending → tạm treo",
          ]},
          { type: "tip", text: "📝 Lô Nháp KHÔNG tính vào công nợ NCC — cả 'Hàng chờ ship' và 'Hàng đã ship'. Chỉ khi duyệt Nháp → Chờ xuất mới bắt đầu tính." },
          { type: "h", text: "🟡 Cột 'Đang TT' (V38):" },
          { type: "p", text: "Hiển thị tổng tiền GoChek đã chuyển ra (cho carrier hoặc đang chuyển QT) nhưng NCC chưa xác nhận nhận được. Đây là tiền 'lơ lửng' — đã rời tài khoản TT nhưng chưa thực sự đến NCC." },
          { type: "list", items: [
            "Nếu cột này > 0 → có giao dịch đang treo, cần follow up với carrier",
            "Cảnh báo Dashboard: nếu tiền treo > 4 ngày ở stage 1 hoặc 2 → báo nhắc",
            "Khi user vào tab Thanh toán bấm chuyển sang 'Hoàn tất' → tiền chuyển từ 'Đang TT' sang 'Đã trả'",
          ]},
          { type: "h", text: "Quy đổi tệ:" },
          { type: "p", text: "Đơn giá thường tính bằng CNY, payment có thể VND/CNY. Hệ thống quy đổi tất cả về VND theo tỷ giá trong Cấu hình. Tỷ giá đổi hàng tháng → cập nhật để báo cáo chính xác." },
          { type: "warn", text: "Nếu sửa đơn giá trên PO sau khi đã có Shipment liên kết, công nợ sẽ thay đổi theo. Cẩn trọng khi sửa PO đã active." },
          { type: "h", text: "🔔 Cảnh báo thanh toán đến hạn (v29):" },
          { type: "p", text: "Hệ thống tự động phát hiện các lô đến hạn thanh toán dựa trên:" },
          { type: "list", items: [
            "Mỗi NCC có trường 'Thời gian công nợ (ngày)' — mặc định 30 (cấu hình tại Cấu hình → NCC)",
            "Hạn thanh toán = Ngày về kho + Số ngày công nợ",
            "Phân bổ payment theo FIFO — lô về kho trước được trả trước",
          ]},
          { type: "h", text: "3 mức cảnh báo:" },
          { type: "list", items: [
            "🔴 Quá hạn — đã vượt ngày hạn (Dashboard cảnh báo đỏ)",
            "⏰ Trong 7 ngày — sắp đến hạn gấp (Dashboard cảnh báo cam)",
            "📅 Trong 14 ngày — theo dõi (Dashboard cảnh báo xanh)",
          ]},
          { type: "tip", text: "Vào tab 💰 Công nợ NCC → khu vực 'Cảnh báo thanh toán' trên cùng → bấm 'Xem chi tiết' để xem danh sách đầy đủ các lô + ngày hạn + số tiền còn nợ." },
        ],
      },
      {
        id: "debts_market",
        title: "Công nợ thị trường",
        icon: "🌐",
        keywords: ["market debt", "cong no thi truong", "ban hang", "shopee", "tiktok"],
        content: [
          { type: "h", text: "Khái niệm:" },
          { type: "p", text: "Mỗi thị trường (VN, TH, MY, PH) như 1 'chi nhánh' — có doanh thu bán ra (B2C qua sàn + B2B đại lý) và phải thanh toán về công ty mẹ." },
          { type: "h", text: "Cách tính (V38 — Cách B):" },
          { type: "code", text: "TT đang nợ = Σ giá trị hàng đã ship − Σ Đã trả (stage Hoàn tất ✅) − Σ Đang TT (stage 1+2 🟡) − Hàng đang BH" },
          { type: "warn", text: "🆕 V38 Cách B: 'Đã trả' giờ CHỈ tính payment ở stage 'Hoàn tất' ✅. Stage 1 (🏦 Đã chuyển uỷ thác) + stage 2 (🌐 Đang chuyển QT) tách riêng vào cột '🟡 Đang TT' và CŨNG được trừ khỏi 'Còn phải trả' (vì tiền đã rời TT). Khác V37: trước gộp tất cả vào 'Đã trả'." },
          { type: "h", text: "Ví dụ minh hoạ:" },
          { type: "p", text: "TT VN nhận hàng trị giá 100M. Đã thanh toán 60M trong đó: 40M đã hoàn tất ✅ + 20M đang ở stage 'Đã chuyển uỷ thác' 🏦." },
          { type: "list", items: [
            "Tổng phải trả: 100M",
            "✅ Đã trả: 40M (chỉ stage Hoàn tất)",
            "🟡 Đang TT: 20M (đang treo, chưa đến NCC)",
            "🟥 Còn phải trả: 100M − 40M − 20M = 40M",
          ]},
          { type: "tip", text: "Tab Công nợ thị trường giúp Liễu theo dõi từng TT đã chuyển tiền đủ chưa. Nếu TT có credit fund (đã chuyển dư) → có thể đối trừ với lô tiếp theo. Cột '🟡 Đang TT' chỉ hiển thị khi > 0 (sau migration data cũ KHÔNG hiển thị vì đều ở stage Hoàn tất)." },
          { type: "h", text: "Bảo hành ảnh hưởng công nợ TT:" },
          { type: "p", text: "Khi 1 TT có >= 3 lô bảo hành đang Pending với NM cùng lúc → công nợ TT đó tạm treo (suspended) → không yêu cầu thanh toán mới cho đến khi BH giải quyết." },
          { type: "h", text: "🆕 V38i: Công nợ đầu kỳ — model TT × NCC" },
          { type: "p", text: "Tab Công nợ TT giờ tính cả OB đầu kỳ của TT. Mở rộng 1 TT (▶ → ▼) để xem khung 'Công thức tính' có dòng + OB nợ gốc / − OB quỹ TD." },
          { type: "p", text: "Mỗi OB là 1 GIAO DỊCH TT × NCC: ghi rõ TT nào nợ NCC nào. Cùng 1 OB tự động xuất hiện ở cả tab NCC + tab TT + Dashboard + báo cáo. Xem chi tiết section 'Công nợ đầu kỳ — Model TT × NCC (V38i)'." },
          { type: "h", text: "📋 Khung 'OB theo NCC' trong tab Công nợ TT" },
          { type: "p", text: "Mở rộng 1 TT hiện khung 'OB đầu kỳ — TT này nợ những NCC nào': mỗi dòng = 1 NCC mà TT này có OB với, kèm tổng nợ gốc + tổng quỹ TD theo từng NCC. Cộng dồn lên dòng '+ OB nợ gốc' trong khung công thức." },
        ],
      },
      {
        id: "warranty",
        title: "Bảo hành",
        icon: "🔧",
        keywords: ["warranty", "bao hanh", "loi", "sua chua", "tra hang", "return"],
        content: [
          { type: "h", text: "Quy trình:" },
          { type: "steps", items: [
            "Phát hiện hàng lỗi → tạo Warranty (chọn TT + kho gốc + NM + SP + SL)",
            "Status: 'Đang gửi NM' → hàng OUT khỏi kho",
            "NM nhận → đổi 'NM đang sửa'",
            "NM trả → đổi 'NM đã trả' (đang về VN)",
            "Hàng về kho → đổi 'Đã trả về kho' → IN lại kho",
          ]},
          { type: "warn", text: "Cảnh báo: nếu 3 warranty cùng NM ở trạng thái Pending (chưa 'Đã trả về kho' hoặc 'Hủy') → công nợ thanh toán NCC bị TREO. Khi 1 cái xong → tự động unblock." },
          { type: "h", text: "Hủy warranty:" },
          { type: "p", text: "Khi hủy: hệ thống coi như chưa từng gửi đi → tồn kho và công nợ phục hồi tự động. Cần lý do bắt buộc khi hủy." },
        ],
      },
      {
        id: "inventory",
        title: "Tồn kho + Import",
        icon: "🏬",
        keywords: ["inventory", "ton kho", "import", "stock", "kho", "nhanh", "pancake"],
        content: [
          { type: "h", text: "Cách tính tồn kho 1 SP × 1 kho:" },
          { type: "code", text: "Tồn = Đầu kỳ + Σ Nhập (Shipment đã về kho + BH trả về + Import IN) − Σ Xuất (BH gửi NM + Import OUT)" },
          { type: "h", text: "3 trạng thái cảnh báo:" },
          { type: "list", items: [
            "🔴 Âm — tồn ≤ 0, cần kiểm kê ngay",
            "⚠ Dưới ngưỡng — tồn < ngưỡng cấu hình ở Form sửa SP",
            "✅ Bình thường — tồn ≥ ngưỡng",
          ]},
          { type: "h", text: "Cấu hình ngưỡng cảnh báo:" },
          { type: "p", text: "Vào tab Sản phẩm → Sửa SP → cuộn xuống section '🚨 Ngưỡng cảnh báo tồn kho theo từng kho' → nhập ngưỡng riêng cho từng kho. Để trống/0 = không cảnh báo." },
          { type: "h", text: "Import tồn kho:" },
          { type: "p", text: "Vì hệ thống không biết đã bán bao nhiêu qua Shopee/TikTok, kế toán phải import định kỳ từ phần mềm bán hàng (Nhanh.vn / Pancake POS) hoặc đếm tay." },
          { type: "steps", items: [
            "Tab Tồn kho → bấm 📥 Import tồn kho",
            "Bước 1: Chọn kho cần cập nhật",
            "Bước 2: Chọn mode (Đầu kỳ / Điều chỉnh) → upload file .xlsx",
            "Bước 3: Preview — kiểm tra map SKU đúng → Xác nhận",
          ]},
          { type: "tip", text: "Mode 'Điều chỉnh' tính chênh lệch giữa file vs CRM rồi sinh IN/OUT tự động. Mode 'Đầu kỳ' override hoàn toàn (lần đầu khởi tạo). Nếu lỡ sai → vào Lịch sử Import → Hủy batch (admin only) → tồn kho hoàn lại." },
          { type: "h", text: "📥 Báo cáo Excel tồn kho (v30):" },
          { type: "p", text: "Bấm '📥 Xuất báo cáo' ở góc phải → chọn kho + kỳ → tải file .xls có 4 sheets:" },
          { type: "list", items: [
            "📊 Tổng hợp — SP × Kho × Đầu kỳ + Nhập + Xuất + Tồn cuối",
            "📋 Chi tiết biến động — tất cả movements trong kỳ với nguồn (lô về kho / BH / Import / thủ công)",
            "⚠️ Cảnh báo — tồn âm + tồn dưới ngưỡng",
            "📥 Lịch sử Import — các batch trong kỳ",
          ]},
          { type: "tip", text: "Để trống ngày → báo cáo toàn bộ. Có ngày 'Từ' → đầu kỳ tính tự động (tồn tại thời điểm đó). Có thể chọn 1 kho cụ thể hoặc tất cả kho." },
        ],
      },
      {
        id: "markets",
        title: "Cấu hình Thị trường & Kho",
        icon: "🌍",
        keywords: ["market", "thi truong", "warehouse", "kho", "cau hinh kho", "pos"],
        content: [
          { type: "h", text: "Cấu trúc:" },
          { type: "list", items: [
            "1 Thị trường (vd: Vietnam) chứa nhiều Kho (vd: Bình Dương, Hà Nội, HCM)",
            "Mỗi kho có cấu hình riêng: tên, địa chỉ, ⭐ default, kết nối phần mềm BH",
          ]},
          { type: "h", text: "🔌 Kết nối phần mềm bán hàng (v23b):" },
          { type: "p", text: "Mỗi kho có thể kết nối với 1 trong 3 nguồn:" },
          { type: "list", items: [
            "📄 Tự quản lý — không kết nối, dùng template CRM khi import",
            "🛒 Nhanh.vn — CRM tự dùng parser Nhanh.vn",
            "🐼 Pancake POS — CRM tự dùng parser Pancake",
          ]},
          { type: "tip", text: "Không cố định: kho 1 ở VN có thể dùng Nhanh, kho 2 ở VN dùng Pancake — tùy chị cấu hình. Mỗi tài khoản phần mềm = 1 kho." },
        ],
      },
      {
        id: "products",
        title: "Cấu hình Sản phẩm",
        icon: "📦",
        keywords: ["product", "san pham", "sku", "danh muc", "category", "mapping"],
        content: [
          { type: "h", text: "Thông tin SP cơ bản:" },
          { type: "list", items: [
            "SKU (mã chính) — duy nhất, dùng làm khóa map import",
            "Tên SP, tên Import (nếu khác — tên trên hóa đơn TQ)",
            "Danh mục, NM mặc định, đơn giá CNY, đơn vị (cái/bộ/...)",
            "Kích thước (DxRxC cm), SL/thùng — để tính cubic meter khi vận chuyển",
          ]},
          { type: "h", text: "🚨 Ngưỡng cảnh báo tồn kho theo kho:" },
          { type: "p", text: "Mỗi SP có thể cấu hình ngưỡng RIÊNG cho TỪNG kho. Vd: SP S24-02 ở Bình Dương ngưỡng 50, ở HCM ngưỡng 20." },
          { type: "h", text: "🔗 SKU bên phần mềm bán hàng:" },
          { type: "p", text: "Vì SKU bên Nhanh.vn (vd: 'S2402') khác bên Pancake (vd: 'GoChek S24-02') khác bên CRM (vd: 'S24-02') — cần map đối chiếu." },
          { type: "warn", text: "Khi import từ Nhanh/Pancake, nếu SP CRM chưa có SKU map tương ứng → CRM báo 'Chưa map SKU' và reject toàn bộ file. Phải vào đây thêm SKU map trước khi import." },
        ],
      },
      {
        id: "users",
        title: "Tài khoản + Phân quyền",
        icon: "👥",
        keywords: ["user", "tai khoan", "account", "permission", "phan quyen", "role"],
        content: [
          { type: "h", text: "Tạo tài khoản mới:" },
          { type: "steps", items: [
            "Tab Tài khoản → + Thêm user",
            "Nhập username + mật khẩu + tên đầy đủ + email",
            "Chọn Role (5 loại — xem mục 'Phân quyền các role')",
            "Lưu",
          ]},
          { type: "warn", text: "Mật khẩu được hash (SHA-256). Quên mật khẩu → admin reset (không khôi phục được mật khẩu cũ)." },
          { type: "h", text: "Khóa tài khoản:" },
          { type: "p", text: "Thay vì xóa user (mất audit log), admin có thể đặt isActive = false → user không đăng nhập được nhưng lịch sử thao tác vẫn còn." },
        ],
      },
    ],
  },

  // ============== PHẦN 3: TÌNH HUỐNG THỰC TẾ ==============
  scenarios: {
    label: "💡 Tình huống thực tế",
    items: [
      {
        id: "sc_short_qty",
        title: "Khi NM giao thiếu hàng",
        icon: "📉",
        keywords: ["thieu hang", "missing", "hao hut", "short", "tinh huong"],
        content: [
          { type: "p", text: "Tình huống: PO đặt 100 cái MIC-001, nhưng khi mở thùng chỉ có 95 cái." },
          { type: "steps", items: [
            "Khi chuyển Shipment sang 'Đã về kho' → popup 'Xác nhận về kho' bật ra",
            "Sửa SL nhận MIC-001 từ 100 → 95",
            "Hệ thống hỏi cách xử lý: Hao hụt / Giao sau / Cảnh báo",
            "Chọn theo nghiệp vụ thực tế:",
          ]},
          { type: "list", items: [
            "Hao hụt → coi như mất luôn 5 cái, công nợ giảm theo (NM không phải bù)",
            "Giao sau → còn nợ NM 5 cái, sẽ giao trong shipment sau",
            "Cảnh báo → ghi nhận thiếu, sẽ xử lý sau (không tự động giảm công nợ)",
          ]},
          { type: "tip", text: "Sau xác nhận, tồn kho cộng đúng 95 cái (không phải 100). Báo cáo chênh lệch xuất ra Excel để khiếu nại NM nếu cần." },
        ],
      },
      {
        id: "sc_cancel_arrived",
        title: "Khi cần hủy lô đã về kho",
        icon: "🚫",
        keywords: ["huy lo", "cancel shipment", "tra hang", "return", "tinh huong"],
        content: [
          { type: "warn", text: "Hủy lô 'Đã về kho' là thao tác nguy hiểm — chỉ admin mới làm được. Có thể ảnh hưởng tồn kho, công nợ, audit." },
          { type: "h", text: "Khi nào nên hủy:" },
          { type: "list", items: [
            "Lô bị nhầm lẫn data (sai NCC, sai TT, sai SL nghiêm trọng)",
            "Hàng về nhưng có vấn đề chất lượng quá nghiêm trọng → trả NM toàn bộ",
            "Sai sót kế toán cần điều chỉnh lại",
          ]},
          { type: "h", text: "Quy trình:" },
          { type: "steps", items: [
            "Đăng nhập admin → tab Giao hàng",
            "Tìm lô → menu Hành động → Hủy",
            "Nhập lý do bắt buộc (vd: 'Sai NCC, đã làm lô mới SH-2026-099')",
            "Xác nhận → status = 'Hủy'",
          ]},
          { type: "h", text: "Tác động:" },
          { type: "list", items: [
            "Tồn kho: movements liên quan tự đánh dấu cancelled → tồn về như chưa có lô này",
            "Công nợ: không tính lô hủy → công nợ NCC giảm",
            "Báo cáo: không hiện trong tổng hợp (có filter 'bao gồm cả hủy' nếu cần xem)",
            "Audit log: ghi rõ ai hủy, lúc nào, lý do gì",
          ]},
        ],
      },
      {
        id: "sc_stock_mismatch",
        title: "Khi tồn kho lệch thực tế",
        icon: "⚖️",
        keywords: ["lech ton kho", "stock mismatch", "kiem ke", "stock take", "dieu chinh"],
        content: [
          { type: "p", text: "Tình huống: Liễu kiểm kê thực tế kho Bình Dương → đếm 142 cái MIC-001, nhưng CRM hiển thị 150 cái." },
          { type: "h", text: "Cách 1 — Import file điều chỉnh:" },
          { type: "steps", items: [
            "Mở Excel mới với 3 cột: SKU, Tên SP, Số lượng",
            "Nhập: MIC-001 / Mic không dây / 142",
            "Vào tab Tồn kho → Import tồn kho → chọn kho Bình Dương → mode 'Điều chỉnh'",
            "Upload file → preview thấy chênh −8 → Xác nhận",
            "Hệ thống sinh OUT 8 cái với lý do 'Điều chỉnh từ batch...'",
          ]},
          { type: "h", text: "Cách 2 — Import từ Nhanh.vn / Pancake:" },
          { type: "p", text: "Nếu kho có kết nối phần mềm BH → xuất Excel từ Nhanh/Pancake → upload trực tiếp. CRM dùng parser tương ứng. Cũng có thể bấm 🔄 Sync ngay nếu đã setup URL." },
          { type: "tip", text: "Sau import, tồn kho khớp thực tế. Có batch trong Lịch sử Import — có thể audit hoặc hủy nếu sai." },
        ],
      },
      {
        id: "sc_warranty_block",
        title: "Khi công nợ NCC bị treo do bảo hành",
        icon: "🚧",
        keywords: ["bao hanh treo", "warranty block", "treo cong no", "suspended"],
        content: [
          { type: "p", text: "Tình huống: Liễu định thanh toán cho NM A 200 triệu, nhưng Dashboard cảnh báo 'Công nợ TT Vietnam đang treo do 3 lô BH chưa giải quyết'." },
          { type: "h", text: "Vì sao:" },
          { type: "p", text: "Quy tắc: nếu 1 thị trường có >= 3 warranty cùng NM ở trạng thái Pending (chưa 'Đã trả về kho' hoặc 'Hủy') → công nợ TT đó tạm treo. Quy tắc này tránh thanh toán hết nhưng NM không sửa hàng." },
          { type: "h", text: "Cách giải quyết:" },
          { type: "steps", items: [
            "Vào tab Bảo hành → lọc theo TT Vietnam + NCC = NM A",
            "Xem 3 warranty đang Pending — đẩy nhanh quy trình:",
            "Lô nào NM đã trả → cập nhật status sang 'Đã trả về kho'",
            "Lô nào không thể sửa được → hủy với lý do",
            "Khi còn ≤ 2 lô Pending → công nợ tự unblock → có thể thanh toán",
          ]},
        ],
      },
      {
        id: "sc_report_export",
        title: "Khi cần báo cáo cho sếp",
        icon: "📊",
        keywords: ["bao cao", "report", "excel", "xuat bao cao"],
        content: [
          { type: "p", text: "Hệ thống có nhiều báo cáo Excel sẵn:" },
          { type: "table", headers: ["Báo cáo", "Vị trí", "Nội dung"], rows: [
            ["Đối soát NCC", "Tab Công nợ NCC → Xuất Excel", "Chi tiết PO, Shipment, Payment với từng NM"],
            ["Công nợ TT", "Tab Công nợ TT → Xuất Excel", "Số dư từng TT theo kỳ"],
            ["Báo cáo lô hàng", "Tab Giao hàng → Xuất Excel", "Danh sách shipment + chứng từ"],
            ["Tỷ trọng SP nhập", "Dashboard", "% từng SP nhập theo kỳ"],
            ["Tăng trưởng TT", "Dashboard", "Doanh số PO theo TT theo tháng"],
          ]},
          { type: "tip", text: "Mọi báo cáo đều hỗ trợ filter khoảng kỳ (date range). Chọn kỳ trước khi xuất → file Excel có sheet tổng + sheet chi tiết." },
        ],
      },
    ],
  },

  // ============== PHẦN 4: FAQ ==============
  faq: {
    label: "❓ FAQ + Troubleshooting",
    items: [
      {
        id: "faq_general",
        title: "FAQ chung",
        icon: "💬",
        keywords: ["faq", "cau hoi", "thuong gap"],
        content: [
          { type: "h", text: "Q: Quên mật khẩu thì sao?" },
          { type: "p", text: "Liên hệ admin. Admin vào tab Tài khoản → tìm user → Reset mật khẩu (đặt mật khẩu mới). Mật khẩu cũ KHÔNG khôi phục được vì đã hash." },
          { type: "h", text: "Q: Đăng nhập sai nhiều lần có bị khóa không?" },
          { type: "p", text: "Hiện tại KHÔNG có chế độ tự khóa. Nếu cần thiết, admin có thể tạm chuyển user sang isActive=false." },
          { type: "h", text: "Q: Dữ liệu có tự backup không?" },
          { type: "p", text: "Dữ liệu lưu trong localStorage trình duyệt. Mỗi máy 1 kho dữ liệu riêng. Để backup → tab Cấu hình → Export toàn bộ data ra file JSON. Khuyến nghị backup hàng tuần." },
          { type: "warn", text: "Xóa lịch sử trình duyệt / cài lại Chrome có thể mất data. Backup định kỳ là điều bắt buộc." },
          { type: "h", text: "Q: 1 user có thể đăng nhập nhiều máy không?" },
          { type: "p", text: "Có. Nhưng dữ liệu KHÔNG đồng bộ giữa các máy — mỗi máy có data riêng. Để dùng chung, cần import/export thủ công hoặc đầu tư backend (xem mục Tương lai)." },
        ],
      },
      {
        id: "faq_draft",
        title: "FAQ về Nháp giao hàng",
        icon: "📝",
        keywords: ["nhap", "draft", "phan bo", "thu nghiem"],
        content: [
          { type: "h", text: "Q: Tại sao tạo lô mới mặc định là Nháp?" },
          { type: "p", text: "Để kế toán có thể thử nhiều phương án phân bổ hàng (vd: 1000 cái → VN/TH/MY tỷ lệ nào tối ưu) mà KHÔNG sợ ảnh hưởng công nợ. Khi chốt phương án → bấm 'Duyệt' để chuyển sang Chờ xuất." },
          { type: "h", text: "Q: Lô Nháp có ảnh hưởng gì không?" },
          { type: "p", text: "KHÔNG. Lô Nháp:" },
          { type: "list", items: [
            "Không tính vào công nợ NCC (cả 'Hàng chờ ship' và 'Hàng đã ship')",
            "Không tính vào công nợ thị trường",
            "Không ảnh hưởng tồn kho",
            "Không xuất hiện trong báo cáo Excel + Dashboard KPI",
          ]},
          { type: "h", text: "Q: Có thể chuyển lô Chờ xuất quay về Nháp không?" },
          { type: "p", text: "KHÔNG. Trạng thái forward-only. Nếu lô đã chuyển sang Chờ xuất mà muốn hủy bỏ → dùng chức năng Hủy (cần lý do)." },
          { type: "h", text: "Q: Xóa Nháp có hủy thật sự không?" },
          { type: "p", text: "Có — xóa hẳn, không lưu lại lịch sử. Vì Nháp chưa cam kết gì với NCC nên không cần audit. Khác với lô Chính thức — chỉ Hủy với lý do, không xóa được." },
          { type: "h", text: "Q: Mã lô Nháp có dùng được không?" },
          { type: "p", text: "Có. Mã `SH-2026-XXX` được cấp ngay khi tạo Nháp. Khi xóa Nháp, mã đó sẽ bị 'mất' (gap trong dãy số) — chấp nhận được." },
          { type: "h", text: "Q: Ai có thể duyệt Nháp → Chờ xuất?" },
          { type: "p", text: "Bất kỳ user có quyền `change_shipment_status` hoặc `edit_shipment` (mặc định: Staff trở lên)." },
        ],
      },
      {
        id: "faq_inventory",
        title: "FAQ về tồn kho",
        icon: "🏬",
        keywords: ["faq ton kho", "inventory faq"],
        content: [
          { type: "h", text: "Q: Tại sao tồn kho hiện tại âm?" },
          { type: "list", items: [
            "Đã bán nhiều hơn nhập (có Import OUT > IN)",
            "Bảo hành gửi đi nhưng chưa nhập đủ",
            "Đầu kỳ chưa khai báo → cần nhập đầu kỳ thực tế",
            "Đã hủy 1 shipment 'Đã về kho' nhưng tồn không tự về 0 (BUG → báo em)",
          ]},
          { type: "h", text: "Q: Import file Nhanh.vn báo lỗi 'Chưa map SKU'?" },
          { type: "steps", items: [
            "Vào tab Sản phẩm → Sửa SP có SKU CRM tương ứng",
            "Cuộn xuống section '🔗 SKU bên phần mềm bán hàng'",
            "Nhập SKU bên Nhanh.vn (vd: 'S2402') → Lưu",
            "Quay lại Import → upload lại file",
          ]},
          { type: "h", text: "Q: Sync URL không hoạt động?" },
          { type: "list", items: [
            "Kiểm tra URL có 'publish to web' không (không phải 'share')",
            "URL phải end với /export?format=csv",
            "Google Sheet phải public — không cần đăng nhập",
            "Apps Script đã chạy thành công — kiểm tra Sheet có data mới không",
          ]},
        ],
      },
    ],
  },

  // ============== PHẦN 5: PHỤ LỤC ==============
  appendix: {
    label: "📎 Phụ lục",
    items: [
      {
        id: "id_format",
        title: "Quy ước đặt mã",
        icon: "🏷️",
        keywords: ["ma", "id", "format", "quy uoc"],
        content: [
          { type: "table", headers: ["Entity", "Format", "Ví dụ"], rows: [
            ["PO", "PO-YYYY-NNNNN", "PO-2026-00123"],
            ["Shipment", "SH-YYYY-NNN", "SH-2026-001"],
            ["Payment NCC", "PAY-NNN", "PAY-001"],
            ["Fee Payment", "FPAY-NNN", "FPAY-001"],
            ["Warranty", "WR-YYYY-NNN", "WR-2026-001"],
            ["Stock Movement", "SM-BATCH-PRODID", "SM-BATCH-20260428-XXXX-p1"],
            ["Import Batch", "BATCH-YYYYMMDD-XXXX", "BATCH-20260428-A1B2"],
            ["Opening Balance", "OB-NNN", "OB-001"],
            ["Opening Stock", "OS-BATCH-PRODID", "OS-BATCH...-p1"],
          ]},
          { type: "tip", text: "Có thể nhập mã tự nhập khi tạo (Form có ô Mã ID). Để trống = hệ thống tự sinh theo format trên." },
        ],
      },
      {
        id: "import_format",
        title: "Định dạng file Import",
        icon: "📥",
        keywords: ["format file", "import excel", "template"],
        content: [
          { type: "h", text: "📄 Template CRM (Tự quản lý):" },
          { type: "list", items: [
            "Cột bắt buộc: SKU, Số lượng",
            "Cột tùy chọn: Tên SP, Ghi chú",
            "Có thể tải template chuẩn từ modal Import",
          ]},
          { type: "h", text: "🛒 Nhanh.vn:" },
          { type: "list", items: [
            "Cột SKU: 'Mã sản phẩm'",
            "Cột SL: 'Tồn trong kho' (KHÔNG dùng 'Tổng tồn' hay 'Có thể bán')",
            "Xuất từ: Báo cáo → Tồn kho → Excel",
          ]},
          { type: "h", text: "🐼 Pancake POS:" },
          { type: "list", items: [
            "Cột SKU: 'Mã sản phẩm'",
            "Cột SL: 'Tồn kho' (KHÔNG dùng 'Có thể bán' hay 'Tổng nhập')",
            "Xuất từ: Sản phẩm → Báo cáo tồn → Excel",
          ]},
          { type: "warn", text: "Chỉ chấp nhận file .xlsx. Reject toàn bộ nếu có lỗi (SKU không tồn tại, SL âm, thiếu cột bắt buộc)." },
        ],
      },
      {
        id: "pagination",
        title: "Phân trang (Pagination)",
        icon: "📄",
        keywords: ["pagination", "phan trang", "trang", "next", "prev", "page size"],
        content: [
          { type: "p", text: "Từ V28, các tab có nhiều dòng được phân trang để giữ tốc độ ổn định kể cả khi data đến hàng nghìn dòng." },
          { type: "h", text: "Tab có pagination:" },
          { type: "list", items: [
            "📋 Đơn đặt hàng — 50 dòng/trang",
            "🚚 Giao hàng — 50 dòng/trang",
            "🔧 Bảo hành — 50 dòng/trang",
            "💸 Thanh toán — 50 dòng/trang",
            "📜 Nhật ký — 100 dòng/trang (rows ngắn nên dày hơn)",
          ]},
          { type: "h", text: "Cách dùng:" },
          { type: "list", items: [
            "⏮ ◀ ▶ ⏭ — về trang đầu / lùi 1 / tiến 1 / cuối",
            "Click số trang để nhảy thẳng tới trang đó",
            "Dropdown 'Mỗi trang' — chọn 25/50/100/200 dòng",
            "Khi áp filter mới → tự về trang 1",
          ]},
          { type: "tip", text: "Pagination chỉ ảnh hưởng UI hiển thị. Tổng hợp ở SummaryBar tính trên TOÀN BỘ data đã lọc, không phải chỉ trang hiện tại. Khi xuất Excel cũng xuất tất cả." },
          { type: "warn", text: "Nếu data đạt 5.000+ dòng/tab → cân nhắc archive data cũ hoặc migrate sang backend (xem mục 'Tương lai')." },
        ],
      },
      {
        id: "shortcuts",
        title: "Phím tắt + mẹo nhanh",
        icon: "⚡",
        keywords: ["shortcut", "phim tat", "tip", "trick"],
        content: [
          { type: "list", items: [
            "Esc — đóng modal đang mở",
            "Click ngoài modal — đóng modal (trừ form đang nhập)",
            "Trong filter ngày: bấm 'Reset' để xóa nhanh",
            "Trong table: click cột Header để sort (nếu hỗ trợ)",
            "Bấm 'Tải' khi xuất Excel — file tự download",
            "Pagination: ⏮◀▶⏭ điều hướng, dropdown chọn 25/50/100/200 dòng",
          ]},
        ],
      },
      {
        // v38b
        id: "sort_lists_v38b",
        title: "Thứ tự hiển thị danh sách (V38b)",
        icon: "🔝",
        keywords: ["sort", "thu tu", "ngay", "moi nhat", "v38b"],
        content: [
          { type: "h", text: "Toàn app sort danh sách theo ngày DESC (mới nhất trên đầu)" },
          { type: "p", text: "Trước V38b: Một số list sort theo thứ tự nhập, một số theo ngày. Khó tìm khi data nhiều." },
          { type: "p", text: "Từ V38b: Chuẩn hóa 9 list quan trọng — luôn ưu tiên ngày mới nhất hiển thị trước." },
          { type: "h", text: "9 danh sách áp dụng" },
          { type: "ul", items: [
            "Tab Đặt hàng — sort theo orderDate desc",
            "Tab Giao hàng — sort theo departDate desc",
            "Tab Bảo hành — sort theo sendDate desc",
            "Tab Thanh toán — sort theo payDate desc",
            "Tab Phí vận chuyển (FeePayment) — sort theo payDate desc",
            "Lịch sử thanh toán cho 1 NCC — sort desc",
            "Lịch sử thanh toán cho 1 thị trường — sort desc",
            "Tab Đầu kỳ tồn kho — sort theo date desc",
            "Lịch sử Import tồn kho — sort theo date desc",
            "Nhật ký hoạt động (Audit log) — sort theo timestamp desc",
          ]},
          { type: "h", text: "Tie-break thông minh" },
          { type: "p", text: "Khi 2 record có cùng ngày, app sort theo ID giảm dần — nghĩa là record TẠO SAU sẽ hiển thị trên record TẠO TRƯỚC. Hữu ích khi nhập payment cùng ngày: payment vừa thêm sẽ luôn ở trên." },
        ],
      },
      {
        // v38c
        id: "reports_v38c",
        title: "Báo cáo Excel V38c — sort + cột Stage",
        icon: "📊",
        keywords: ["bao cao", "excel", "stage", "v38c"],
        content: [
          { type: "h", text: "Báo cáo Excel có cải thiện gì ở V38c" },
          { type: "ul", items: [
            "Tất cả sheet sort theo ngày desc (đồng bộ với UI app)",
            "Báo cáo Tồn kho: sheet 'Biến động' đảo từ ASC → DESC (mới nhất trước)",
            "Báo cáo Thị trường sheet 3 (Lịch sử thanh toán): thêm cột 'Stage' → biết payment đang ở giai đoạn nào",
          ]},
          { type: "h", text: "Cột Stage trong báo cáo TT (V38)" },
          { type: "p", text: "Báo cáo công nợ TT có 2 con số đối chiếu:" },
          { type: "ul", items: [
            "Sheet 1 (Tổng quan): cột 'Còn phải trả' = tính theo Cách B (tiền chưa rời tài khoản TT)",
            "Sheet 3 (Lịch sử payment): có cả 'Đã trả thực sự' (chỉ stage Hoàn tất) ↔ 'Đang TT' (stage 1+2)",
            "Tổng 2 cột này = tổng tiền đã chuyển đi, đối chiếu được với accounting",
          ]},
        ],
      },
      {
        // v38d
        id: "hard_delete_v38d",
        title: "Xóa cứng (Hard Delete) — Admin only",
        icon: "🗑️",
        keywords: ["xoa cung", "hard delete", "admin", "delete", "v38d"],
        content: [
          { type: "h", text: "Hard Delete là gì?" },
          { type: "p", text: "Khác với 'Hủy' (giữ data + trạng thái Hủy), Hard Delete xóa entity HOÀN TOÀN khỏi database. Không thể hoàn tác." },
          { type: "h", text: "Áp dụng cho 4 đối tượng" },
          { type: "ul", items: [
            "🏭 NCC: status = 'Đã ngừng' hoặc 'Hủy' + KHÔNG có (PO + Payment + Opening Balance + Warranty + FeePayment)",
            "🚛 Đơn vị VC: status = 'Đã ngừng' + KHÔNG có (Shipment + FeePayment)",
            "📋 PO: status = 'Hủy' + KHÔNG có Shipment trỏ đến (kể cả Nháp/Hủy)",
            "🚚 Đơn giao hàng: status = 'Hủy' + KHÔNG có (FeePayment + Manual stockMovement)",
          ]},
          { type: "h", text: "Workflow xóa cứng" },
          { type: "ol", items: [
            "Admin bấm '🗑️ Xóa cứng' trên row entity (chỉ hiện khi entity ở status phù hợp)",
            "App tự check ALL điều kiện liên quan",
            "Nếu KHÔNG đủ điều kiện → dialog đỏ liệt kê lý do cụ thể (vd 'Còn 3 PO + 5 payment liên quan')",
            "Nếu đủ điều kiện → dialog xác nhận với cảnh báo + ô nhập text",
            "Bắt buộc gõ chính xác chữ 'DELETE' (in hoa, không dấu cách) → mới mở khóa nút",
            "Bấm '🗑️ Xóa vĩnh viễn' → entity biến mất + audit log 'hard_delete_*' với SNAPSHOT toàn bộ data",
          ]},
          { type: "p", text: "Lưu ý: chỉ Admin mới thấy nút Xóa cứng. Manager/Staff không có quyền này (vì rủi ro cao)." },
        ],
      },
      {
        // v38e
        id: "combobox_v38e",
        title: "Tìm sản phẩm theo từ khoá (Combobox)",
        icon: "🔍",
        keywords: ["combobox", "tim san pham", "sku", "search", "v38e"],
        content: [
          { type: "h", text: "Combobox — Thay thế dropdown cứng cho 3 form" },
          { type: "ul", items: [
            "Tạo PO — chọn SP của NCC",
            "Tạo Bảo hành — chọn SP từ toàn bộ kho",
            "Tạo Đơn giao hàng — chọn dòng PO (PO ID + SKU + tên SP)",
          ]},
          { type: "h", text: "Search được những field nào?" },
          { type: "ul", items: [
            "SKU sản phẩm (vd 'S26-01')",
            "Tên sản phẩm tiếng Việt/Anh (vd 'Ultra')",
            "Tên tiếng Trung của SP (nameImport — vd '麦克' = micro)",
            "Danh mục (vd 'Tai nghe')",
            "Riêng ShipmentForm: cả Mã PO (vd 'PO-2026-001')",
          ]},
          { type: "h", text: "Phím tắt khi dùng Combobox" },
          { type: "ul", items: [
            "Click vào ô + gõ → filter ngay realtime",
            "↑ ↓ → di chuyển highlight giữa kết quả",
            "Enter → chọn item đang highlight",
            "Tab + có item highlight + đang gõ → chọn luôn rồi nhảy field",
            "Esc → đóng dropdown",
            "Click ngoài → đóng dropdown",
          ]},
          { type: "h", text: "Hiển thị highlight match" },
          { type: "p", text: "Phần text khớp với keyword được bold + nền vàng nhạt → dễ thấy item đúng giữa list dài." },
        ],
      },
      {
        // v38f
        id: "rename_id_v38f",
        title: "Đổi mã PO/Đơn giao hàng — Admin only",
        icon: "🔄",
        keywords: ["doi ma", "rename", "po id", "shipment id", "admin", "v38f"],
        content: [
          { type: "h", text: "Khi nào cho phép đổi mã?" },
          { type: "p", text: "Để tránh phá data liên quan, V38f chỉ cho admin đổi mã khi entity 'sạch' — chưa có data con tham chiếu đến mã đó." },
          { type: "h", text: "Điều kiện đổi mã" },
          { type: "ul", items: [
            "📋 PO: KHÔNG có shipment trỏ đến + KHÔNG có feePayment trỏ đến",
            "🚚 Đơn giao hàng: KHÔNG có feePayment + KHÔNG có MANUAL stockMovement",
            "Mã mới phải KHÔNG TRÙNG với PO/Shipment khác",
          ]},
          { type: "h", text: "Workflow đổi mã" },
          { type: "ol", items: [
            "Admin mở form 'Sửa PO' hoặc 'Sửa Đơn giao hàng'",
            "POForm: Bấm nút '🔄 Đổi mã' cạnh ô Mã PO → Modal hiện ra → gõ mã mới → live check → bấm '🔄 Đổi mã'",
            "ShipmentForm: Sửa trực tiếp ô Mã trong form → bấm Lưu → Modal xác nhận hiện ra → gõ chính xác mã mới → bấm '🔄 Đổi mã'",
            "Sau khi đổi: Audit log 'rename_po' / 'rename_shipment' với cả oldId + newId + snapshot",
          ]},
          { type: "h", text: "⚠️ Cảnh báo về báo cáo cũ" },
          { type: "p", text: "Báo cáo Excel cũ ĐÃ XUẤT trước đổi mã sẽ vẫn ghi mã CŨ — không tự cập nhật. Để có báo cáo mới, xuất lại sau khi đổi mã." },
          { type: "p", text: "Audit log lưu cả mã cũ + snapshot → có thể truy cứu được mọi thay đổi sau này." },
        ],
      },
      {
        // v38g
        id: "change_password_v38g",
        title: "Đổi mật khẩu cá nhân (V38g)",
        icon: "🔑",
        keywords: ["doi mat khau", "password", "change password", "v38g"],
        content: [
          { type: "h", text: "Cách đổi mật khẩu" },
          { type: "ol", items: [
            "Bấm nút '🔑 Đổi mật khẩu' ở thanh sidebar bên trái (gần nút Đăng xuất)",
            "Nhập mật khẩu hiện tại (để xác minh là chính chủ)",
            "Nhập mật khẩu mới (≥ 6 ký tự, khác mật khẩu cũ)",
            "Nhập lại mật khẩu mới để xác nhận khớp",
            "Bấm '🔑 Đổi mật khẩu' → app tự đăng xuất sau 2 giây",
            "Đăng nhập lại bằng mật khẩu mới",
          ]},
          { type: "h", text: "Bảo mật" },
          { type: "ul", items: [
            "Mỗi user tự đổi mật khẩu của mình — không cần admin",
            "Audit log ghi nhận hành động 'change_own_password' nhưng KHÔNG ghi password (đảm bảo bí mật)",
            "Sau đổi tự logout — phải login lại với mật khẩu mới",
            "Nếu quên mật khẩu cũ → liên hệ Admin để reset",
          ]},
          { type: "h", text: "Giới hạn (do app local)" },
          { type: "p", text: "App lưu data ở localStorage trên máy mỗi user. Mật khẩu được lưu plain text trong storage — tránh dùng mật khẩu trùng với Gmail/Facebook. Nếu cần bảo mật cao hơn, cần backend (project lớn, ngoài V38g)." },
        ],
      },
      {
        // v38g
        id: "session_v38g",
        title: "F5 không logout — Session 24h (V38g)",
        icon: "⏱️",
        keywords: ["f5", "reload", "session", "logout", "v38g"],
        content: [
          { type: "h", text: "Cách hoạt động" },
          { type: "p", text: "Trước V38g: F5 (refresh trang) → bị logout → phải login lại. Phiền khi đang làm việc." },
          { type: "p", text: "Từ V38g: Session lưu trong localStorage 24h. F5 → app vẫn nhớ user → load lại data + giữ login." },
          { type: "h", text: "Rolling session — không bao giờ timeout nếu dùng liên tục" },
          { type: "ul", items: [
            "Mỗi lần thao tác (tạo/sửa/xóa/duyệt...) → app tự gia hạn session 24h từ thời điểm đó",
            "Nếu user dùng app liên tục → session không bao giờ hết hạn",
            "Chỉ logout khi: KHÔNG hoạt động > 24 giờ, hoặc bấm nút Đăng xuất, hoặc admin xóa user/đổi pass",
          ]},
          { type: "h", text: "Khi nào session bị invalidate?" },
          { type: "ul", items: [
            "User bấm 'Đăng xuất' chủ động",
            "Quá 24 giờ không thao tác (auto-expire)",
            "Admin xóa cứng user (user F5 sẽ phải login lại)",
            "Admin đổi status user thành 'stopped' (user F5 sẽ bị logout)",
            "User tự đổi mật khẩu (auto logout sau 2s)",
          ]},
          { type: "h", text: "Bảo mật" },
          { type: "p", text: "Session lưu userId + thời gian hết hạn — KHÔNG lưu password. Nếu chia sẻ máy với người khác → nhớ logout trước khi rời máy." },
        ],
      },
      {
        // v38g
        id: "qty_validation_v38g",
        title: "Nhập số lượng an toàn (V38g)",
        icon: "🔢",
        keywords: ["nhap so", "so luong", "scroll", "spinner", "auto fill", "v38g"],
        content: [
          { type: "h", text: "3 nguyên nhân nhập SL nhầm — đã được khắc phục" },
          { type: "ul", items: [
            "Scroll wheel: User scroll xem dòng khác → focus vẫn ở input → SL tăng/giảm tự động → V38g DISABLE",
            "Phím ↑↓: Tab vào input rồi vô tình bấm ↑↓ → SL thay đổi → V38g DISABLE",
            "Spinner ▲▼ bên phải: Click nhầm → SL ±1 → V38g ẨN spinner qua CSS global",
          ]},
          { type: "h", text: "Áp dụng cho 7 input số quan trọng" },
          { type: "ul", items: [
            "POForm: SL + Đơn giá",
            "ShipmentForm: SL giao + Số kiện + Phí",
            "WarrantyForm: SL bảo hành",
            "ConfirmArriveForm: SL nhận thực tế khi về kho",
          ]},
          { type: "h", text: "Bonus: Validation thông minh" },
          { type: "ul", items: [
            "Bỏ auto-fill SP khi 'Thêm SP': Trước V38g → app tự fill SP đầu list → user dễ quên đổi → ship nhầm SP. V38g: ô SP RỖNG, user phải tự chọn qua Combobox.",
            "Cảnh báo SL=0 hoặc chưa chọn SP: Save button disabled cho đến khi tất cả dòng có SP + SL > 0",
            "ShipmentForm: SL > tồn → input đỏ + nút '→ Đặt = max' để 1 click fix nhanh",
            "ConfirmArriveForm: SL nhận > SL giao → input đỏ + nút '→ Đặt = max'",
          ]},
        ],
      },
      {
        // v38i
        id: "opening_balance_v38i",
        title: "Công nợ đầu kỳ — Model TT × NCC (V38i)",
        icon: "📋",
        keywords: ["opening balance", "cong no dau ky", "v38i", "thi truong", "ncc"],
        content: [
          { type: "warn", text: "⚠️ V38i đã thay đổi schema OB so với V38h. OB cũ đã được xóa khi nâng cấp. Vui lòng nhập lại theo cấu trúc mới." },
          { type: "h", text: "Công nợ đầu kỳ là gì?" },
          { type: "p", text: "Khi triển khai app lần đầu (hoặc sang kỳ kế toán mới), chị cần ghi nhận các khoản công nợ + quỹ tín dụng MANG SANG từ kỳ trước. App sẽ cộng dồn vào tổng công nợ hiện tại để có số chính xác." },
          { type: "h", text: "Schema MỚI (V38i)" },
          { type: "p", text: "Mỗi OB là 1 GIAO DỊCH giữa Thị trường × Nhà cung cấp. Bắt buộc ghi rõ:" },
          { type: "ul", items: [
            "🌍 Thị trường nào đang nợ (vd Vietnam, Thailand)",
            "🏭 Nợ Nhà cung cấp nào (vd Shenzhen Audio, Guangzhou Mic)",
            "Loại: Nợ gốc HOẶC Quỹ tín dụng",
            "Số tiền + tiền tệ",
          ]},
          { type: "h", text: "Tại sao thay đổi từ V38h?" },
          { type: "warn", text: "V38h có lỗi vô lý: TT đang nợ nhưng KHÔNG biết nợ ai. VD: Vietnam +100K nợ → tab Vietnam tăng 100K nhưng tab Shenzhen/Guangzhou KHÔNG đổi → kế toán không đối chiếu được." },
          { type: "p", text: "V38i fix bằng cách yêu cầu mỗi OB phải ghi rõ TT × NCC. Cùng 1 OB sẽ tự động xuất hiện ở CẢ 2 góc nhìn (tab NCC + tab TT) — không thể lệch nhau." },
          { type: "h", text: "Workflow nhập OB" },
          { type: "ol", items: [
            "Vào tab 'Công nợ đầu kỳ' → bấm '+ Thêm công nợ đầu kỳ'",
            "Chọn 🌍 Thị trường nợ (vd Vietnam)",
            "Chọn 🏭 Nhà cung cấp (vd Shenzhen Audio)",
            "Chọn loại: Nợ gốc / Quỹ tín dụng",
            "Nhập số tiền + tiền tệ + ngày + ghi chú",
            "Xem khung 'Xác nhận giao dịch' (preview) → Bấm Lưu",
          ]},
          { type: "h", text: "Ví dụ thực tế: Vietnam nợ 2 NCC" },
          { type: "p", text: "Vietnam đầu kỳ nợ Shenzhen Audio 50K CNY và nợ Guangzhou Mic 20K CNY:" },
          { type: "ul", items: [
            "Tạo OB-001: Vietnam × Shenzhen, Nợ gốc 50K CNY",
            "Tạo OB-002: Vietnam × Guangzhou, Nợ gốc 20K CNY",
            "→ Tab Công nợ TT Vietnam: + OB nợ gốc 70K (cộng từ tất cả NCC)",
            "→ Tab Công nợ NCC Shenzhen: + OB nợ gốc 50K (Vietnam đang nợ)",
            "→ Tab Công nợ NCC Guangzhou: + OB nợ gốc 20K (Vietnam đang nợ)",
          ]},
          { type: "h", text: "Công thức tính 'Còn phải trả' trong tab Công nợ TT" },
          { type: "p", text: "Mở rộng 1 TT (▶ → ▼) để xem khung 'Công thức tính':" },
          { type: "ul", items: [
            "+ Hàng đã ship",
            "+ OB nợ gốc đầu kỳ TT (cộng tất cả NCC)",
            "− OB quỹ tín dụng đầu kỳ TT",
            "− Đã thanh toán (stage Hoàn tất)",
            "− Đang TT (stage 1+2)",
            "− Hàng đang BH (treo)",
            "= Còn phải trả",
          ]},
          { type: "h", text: "Khung 'OB theo NCC' khi expand TT" },
          { type: "p", text: "Khi mở rộng 1 TT, có khung mới hiển thị TT đang nợ những NCC nào:" },
          { type: "ul", items: [
            "Mỗi dòng = 1 NCC mà TT này có OB với",
            "Cột: Tổng nợ gốc + Tổng quỹ TD theo từng NCC",
            "Cộng dồn lên dòng '+ OB nợ gốc' trong khung công thức",
          ]},
          { type: "h", text: "Khung table OB trong tab Công nợ NCC" },
          { type: "p", text: "Khi xem 1 NCC trong tab Công nợ NCC, có table 'Công nợ đầu kỳ — TT đang nợ NCC này':" },
          { type: "ul", items: [
            "Cột '🌍 TT đang nợ' hiển thị TT nào đang nợ NCC này",
            "Cộng dồn lên '(1) Nợ đầu kỳ' trong khung tổng hợp",
          ]},
          { type: "h", text: "Báo cáo Excel V38i" },
          { type: "p", text: "Cả 2 báo cáo cộng OB đúng + thêm sheet riêng:" },
          { type: "ul", items: [
            "Báo cáo NCC: thêm sheet 'OB theo TT' — list từng OB của NCC này (TT nào nợ + tổng hợp theo TT)",
            "Báo cáo TT: thêm sheet 'OB theo NCC' — list từng OB của TT này (NCC nào + tổng hợp cặp TT × NCC)",
          ]},
          { type: "h", text: "Migration data cũ" },
          { type: "warn", text: "OB cũ V38h đã được XÓA SẠCH (hard migration). Lý do: V38h chỉ có 1 chiều (chỉ market hoặc chỉ factory) → không thể tự động chuyển sang model TT × NCC mới. Chị cần nhập lại theo schema mới." },
          { type: "p", text: "Sau khi nâng cấp V38i, chị sẽ thấy banner cảnh báo trên tab. Bấm 'Đã hiểu, ẩn cảnh báo' để tắt." },
        ],
      },
      {
        id: "inventory_alert_v38j",
        title: "📊 Cảnh báo tồn kho & Đề xuất vận hành (V38j)",
        icon: "🚨",
        keywords: ["ton kho", "canh bao", "de xuat", "po gap", "tao sh", "v38j", "warehouse target"],
        content: [
          { type: "h", text: "Mục đích" },
          { type: "p", text: "Tab Tồn kho V38j giúp chị trả lời 4 câu hỏi vận hành quan trọng: (1) Còn bao nhiêu hàng? (2) Đang về bao nhiêu? (3) SP nào cần tạo SH (PO còn hàng)? (4) SP nào cần đặt PO mới?" },
          { type: "h", text: "Sub-tab '🚨 Cảnh báo & Đề xuất' (mới)" },
          { type: "p", text: "Vào tab Tồn kho → chuyển sang sub-tab '🚨 Cảnh báo & Đề xuất'. Đây là bảng vận hành thời điểm hiện tại — khác với sub-tab '📊 Tổng quan' (báo cáo kế toán theo kỳ)." },
          { type: "h", text: "12 cột trong bảng" },
          { type: "ul", items: [
            "SKU + Tên SP",
            "Hàng đã nhập — Σ shipment đã về kho",
            "Tồn ở NCC — Σ PO duyệt − Σ shipment (gắn theo TT)",
            "Hàng đi đường — shipment đang vận chuyển (5 trạng thái)",
            "Tồn trong kho — chị nhập tay/import (KHÔNG tự cộng từ shipments)",
            "Ngưỡng cảnh báo — lấy từ cấu hình SP",
            "Đề xuất tạo SH — bấm để mở form tạo SH với SL prefill",
            "Đề xuất đặt PO — bấm để mở form tạo PO với SL prefill",
            "Trạng thái — 1 trong 5 trạng thái",
          ]},
          { type: "h", text: "5 trạng thái cảnh báo (ưu tiên giảm dần)" },
          { type: "ul", items: [
            "🔴 Đặt PO gấp — (Tồn kho + Đi đường + NCC) < SL bán/ngày × (TG SX + TG VC). Nguy cơ hết hàng kể cả khi đặt PO ngay.",
            "🟡 Cần giao về — (Tồn kho + Đi đường) < Ngưỡng VÀ Tồn NCC > 0. Có hàng ở NCC, chỉ cần tạo SH.",
            "🔵 Đang về — Hàng đi đường > 0 VÀ Tồn kho ≥ Ngưỡng.",
            "🟢 Đủ hàng — Tồn kho ≥ Ngưỡng cảnh báo.",
            "⚪ Không theo dõi — chưa cấu hình HOẶC đánh dấu không theo dõi.",
          ]},
          { type: "h", text: "3 mode hiển thị (theo bộ lọc)" },
          { type: "ul", items: [
            "Toàn cầu (không filter): gộp tất cả kho, hiện trạng thái nguy hiểm nhất + dòng phụ liệt kê kho cảnh báo",
            "Theo TT (chọn TT): gộp kho thuộc TT, hiện trạng thái nguy hiểm nhất",
            "Theo Kho (TT + Kho): hiện trạng thái trực tiếp",
          ]},
          { type: "h", text: "Cấu hình tồn an toàn cho SP" },
          { type: "p", text: "Vào tab Sản phẩm → sửa SP → chuyển sang tab '📊 Cấu hình tồn kho':" },
          { type: "ul", items: [
            "3 thông số chung (SP × tất cả kho): Thời gian sản xuất, Thời gian vận chuyển, Số ngày dự kiến bán",
            "Bảng theo từng kho: Ngưỡng cảnh báo + SL bán/ngày + Không theo dõi",
            "Lead time = TG SX + TG VC (từ lúc đặt PO đến lúc hàng về kho)",
          ]},
          { type: "h", text: "Wizard cấu hình hàng loạt" },
          { type: "p", text: "Tab Sản phẩm → bấm '🪄 Cấu hình tồn kho hàng loạt' → chọn nhiều SP × 1 kho → nhập 1 lần áp cho tất cả. Tiết kiệm thời gian khi setup ban đầu." },
          { type: "h", text: "Cập nhật 'Tồn trong kho' thủ công" },
          { type: "p", text: "Trong sub-tab '🚨 Cảnh báo & Đề xuất', khi đã chọn 1 kho cụ thể (mode 'Theo Kho'), bấm vào ô Tồn trong kho có icon ✏️ → mở form cập nhật. Chị nhập số lượng kiểm đếm thực tế." },
          { type: "warn", text: "⚠️ Tồn trong kho KHÔNG tự cộng từ shipments. Chị phải cập nhật thủ công sau khi kiểm đếm. Nếu quên cập nhật → bảng sẽ hiển thị sai → có thể đề xuất tạo SH/PO sai." },
          { type: "h", text: "2 cột Đề xuất — công thức" },
          { type: "p", text: "Đề xuất tạo SH: cần thêm = Ngưỡng − Tồn kho − Đi đường. Cắt theo Tồn ở NCC (vì NCC chỉ có sẵn bấy nhiêu)." },
          { type: "p", text: "Đề xuất đặt PO: tổng nhu cầu = SL bán/ngày × Số ngày dự kiến bán. Trừ đi đã có (Tồn kho + Đi đường + NCC). Nếu chưa cài SL bán/ngày → hiện 'Cần cấu hình'." },
          { type: "h", text: "Bấm ô đề xuất → form prefill" },
          { type: "p", text: "Bấm vào ô đề xuất → app chuyển sang tab tương ứng + tự mở form tạo mới với SL prefill. Chị có thể sửa lại SL/đơn giá/note trước khi lưu." },
          { type: "h", text: "Báo cáo Excel 4 sheets" },
          { type: "p", text: "Trong sub-tab '🚨 Cảnh báo & Đề xuất' bấm '📥 Xuất báo cáo Excel':" },
          { type: "ul", items: [
            "Sheet 1: Tổng quan tồn kho (12 cột × tất cả SP × kho có cấu hình)",
            "Sheet 2: Cần đặt PO gấp — chỉ trạng thái 🔴",
            "Sheet 3: Cần tạo SH — chỉ trạng thái 🟡",
            "Sheet 4: Cấu hình tồn an toàn — toàn bộ tham số đã cài",
          ]},
          { type: "h", text: "KPI Dashboard mới" },
          { type: "p", text: "Trên Dashboard, khi có cảnh báo, sẽ hiện banner '🚨 Tồn kho cảnh báo' với 3 ô: 🔴 Đặt PO gấp + 🟡 Cần tạo SH + 🔵 Đang về. Bấm '→ Xem chi tiết' để mở thẳng tab Tồn kho." },
        ],
      },
      {
        id: "draft_reservation_v38k",
        title: "📋 Phiếu Nháp giữ chỗ hàng (V38k)",
        icon: "🔧",
        keywords: ["nhap", "giu cho", "phieu giao hang", "draft", "reserved", "du kien xuat", "v38k"],
        content: [
          { type: "h", text: "Mục đích phiếu Nháp" },
          { type: "p", text: "Phiếu Nháp giúp chị phân bổ thử hàng cho các bên (chưa giao lên NCC chưa phát sinh công nợ). Khi NCC giao hàng thực sự, chị mới đổi trạng thái thành 'Chờ xuất' để chính thức hóa." },
          { type: "h", text: "Vấn đề ở V38j" },
          { type: "warn", text: "V38j cũ: Phiếu Nháp KHÔNG giữ chỗ hàng. Khi chị tạo phiếu Nháp A với 100 cái từ PO X, rồi tạo phiếu Nháp B → vẫn thấy 100 cái đó là 'còn rảnh' → có thể giữ chỗ trùng → khi đổi sang chính thức thì lệch SL." },
          { type: "h", text: "V38k đã sửa" },
          { type: "ul", items: [
            "Phiếu Nháp GIỮ CHỖ hàng tạm thời (vẫn chưa phát sinh công nợ)",
            "Trong ShipmentForm, khi chọn dòng PO, hàng đã giữ ở phiếu Nháp khác sẽ bị trừ ra",
            "Khi chị xóa/hủy phiếu Nháp → hàng tự động giải phóng cho phiếu khác",
            "Tab Tồn kho V38j cũng đồng bộ — 'Tồn ở NCC' giờ trừ cả phần Nháp đang giữ chỗ",
          ]},
          { type: "h", text: "Cột 'Dự kiến xuất' mới" },
          { type: "p", text: "Tab Đặt hàng → expand 1 PO → bảng chi tiết SP có cột 'Dự kiến xuất' (màu tím):" },
          { type: "ul", items: [
            "Hiển thị tổng SL đang được giữ chỗ ở các phiếu Nháp",
            "Hover vào ô → tooltip hiện list phiếu Nháp + SL từng phiếu",
            "Khi = 0 → hiện '—'",
          ]},
          { type: "h", text: "Thứ tự cột mới" },
          { type: "p", text: "Chị đã yêu cầu đổi thứ tự cột để dễ đọc. V38k mới:" },
          { type: "ul", items: [
            "Bảng chi tiết PO (expand): SKU → SP → SL đặt → Đã giao → Dự kiến xuất → Còn lại → Đơn giá → Giá trị",
            "Bảng chi tiết Shipment (expand): PO → SKU → SP → SL giao → [SL nhận → Xử lý lệch] → Nhà máy → Giá trị (SL giao lên trước Nhà máy)",
          ]},
          { type: "h", text: "Công thức 'Còn lại' mới" },
          { type: "p", text: "Cột 'Còn lại' = SL đặt − Đã giao − Dự kiến xuất. Đây là số chị có thể tạo phiếu mới (cả Nháp lẫn chính thức)." },
          { type: "h", text: "Cách dọn phiếu Nháp bỏ quên" },
          { type: "p", text: "Nếu chị nhìn thấy cột 'Dự kiến xuất' của 1 PO có số lớn → có thể có phiếu Nháp tồn quá lâu. Hover vào ô → xem mã shipment → vào tab Giao hàng → xóa hoặc hủy các phiếu không dùng." },
        ],
      },
            {
        id: "version_history",
        title: "Lịch sử phiên bản",
        icon: "📋",
        keywords: ["version", "phien ban", "changelog", "history"],
        content: [
          { type: "table", headers: ["Phiên bản", "Tính năng chính"], rows: [
            ["V11", "Baseline — PO, Shipment, Payment, Debt"],
            ["V12", "Tài liệu hướng dẫn V12 (cũ)"],
            ["V13-V17", "Markets/Warehouses, Excel reports, Market debt"],
            ["V18", "Bảo hành + treo công nợ TT"],
            ["V19", "Đổi tên Đơn giao hàng + 9 loại Chứng từ"],
            ["V20", "Hủy thay Xóa cho 5 entity"],
            ["V21", "Audit log enrichment + Hủy Warranty"],
            ["V22", "Modal cập nhật chứng từ độc lập + N/A"],
            ["V23a", "Hạ tầng tồn kho + Tab Tồn kho"],
            ["V23b", "Import 3 nguồn (Manual/Nhanh/Pancake) + Sync URL"],
            ["V24", "Tab Hướng dẫn sử dụng tích hợp"],
            ["V25", "Tái cấu trúc sidebar: gọn còn 14 tab, gộp 4 mục cấu hình vào Cấu hình hub"],
            ["V25b", "Đổi 'Chứng từ kiểm dịch' → 'Hợp đồng' (chuyển lên đầu danh sách)"],
            ["V26", "Thêm trạng thái 'Nháp' cho lô giao hàng — kế toán thử phân bổ không ảnh hưởng công nợ + tồn kho"],
            ["V27", "Bảng tổng hợp 4 chỉ số cho tab Đặt hàng + Giao hàng (CNY lớn / VND nhỏ) tự cập nhật theo filter"],
            ["V28", "Pagination cho 5 tab nhiều dòng (PO/Shipment/Warranty/Payment/Audit) — sẵn sàng cho data 10k+ dòng"],
            ["V29", "Cảnh báo thanh toán đến hạn — Dashboard + tab Công nợ NCC tự phát hiện lô quá hạn / sắp hạn theo FIFO"],
            ["V30", "Báo cáo Excel tồn kho 4 sheets — Tổng hợp + Biến động + Cảnh báo + Lịch sử Import, lọc theo kho + kỳ"],
            ["V31", "Refactor migration loop + cải thiện performance load app"],
            ["V32", "Bump storage key + chuẩn hóa init data từ SEED hoặc migrate từ v23"],
            ["V33", "FIFO theo arriveDate (lô đã về kho ưu tiên trước) + Logic công nợ tinh chỉnh"],
            ["V34", "Lưu tỷ giá payment (lock-in rate) — báo cáo VND chính xác theo thời điểm trả"],
            ["V35-V36", "Cải thiện import upsert mode + fix bug + audit log enrichment"],
            ["V37", "Báo cáo PO chi tiết Excel (mỗi SP trong PO = 1 dòng)"],
            ["V38", "🆕 3-stage payment workflow (carrier/transferring/completed) + Cách B công nợ TT + Dashboard KPI thứ 7 + cảnh báo tiền treo lâu"],
            ["V38b", "Sort 9 list theo ngày desc (mới nhất trên đầu) — chuẩn hóa toàn app"],
            ["V38c", "Sort báo cáo Excel theo ngày desc + thêm cột Stage trong báo cáo TT (tách Đã trả thực sự ↔ Đang TT)"],
            ["V38d", "🛡️ Hard Delete (xóa cứng) cho NCC/VC/PO/Shipment — admin only, gõ 'DELETE' xác nhận"],
            ["V38e", "🔍 Combobox tìm SP theo từ khoá cho POForm + WarrantyForm + ShipmentForm (search SKU/tên/tên TQ/danh mục)"],
            ["V38f", "🔄 Đổi mã PO/Shipment — admin only, chỉ khi entity sạch (chưa có data con)"],
            ["V38g", "🔑 Đổi mật khẩu cá nhân + 🔄 F5 không logout (rolling session 24h) + UX nhập số an toàn (no scroll/spinner) + bỏ auto-fill SP + hoàn thiện help docs + audit labels"],
            ["V38h", "📋 Công nợ đầu kỳ cho cả NCC + Thị trường (có thể chia kho hoặc chung TT) + breakdown theo kho trong tab Công nợ TT + báo cáo Excel TT thêm 2 dòng OB"],
            ["V38i", "🔧 Fix lỗi V38h: OB chuyển sang model TT × NCC. Hard migration xóa OB cũ. Đồng bộ 2 chiều: 1 OB tự động xuất hiện cả tab NCC + tab TT + Dashboard + báo cáo Excel. Fix 3 bug crash từ V38f (POForm + ConfirmArriveForm + ShipmentForm rename)."],
            ["V38j", "🚨 Tồn kho cảnh báo & Đề xuất vận hành — Sub-tab mới 12 cột với 5 trạng thái + 2 cột đề xuất tự tính (tạo SH/đặt PO) + 3 mode hiển thị theo bộ lọc + Wizard cấu hình hàng loạt + Form/Import StockOnHand + KPI Dashboard + Báo cáo Excel 4 sheets. Schema mới: Product.warehouseTargets + 3 thời gian. StockOnHand mới — manual nhập/import."],
            ["V38k", "🔧 Fix bug phiếu Nháp không giữ chỗ hàng từ PO. Phiếu Nháp giờ giữ chỗ tạm thời để tránh tạo trùng (chưa phát sinh công nợ). Thêm cột 'Dự kiến xuất' vào bảng chi tiết PO + đổi thứ tự cột (SKU → SP → SL đặt → Đã giao → Dự kiến xuất → Còn lại → Đơn giá → Giá trị). Đổi thứ tự cột Shipment detail (SL giao trước Nhà máy)."],
          ]},
        ],
      },
    ],
  },
};

// Forward-only order (không cho quay ngược, trừ Hủy ở "Chờ xuất")
// v26: Thêm "Nháp" — trạng thái draft, KHÔNG ảnh hưởng công nợ/tồn kho/báo cáo
// Forward-only order: Nháp → Chờ xuất → ... → Đã về kho. Hủy có thể từ bất kỳ trạng thái.
const SHIPMENT_STATUS_ORDER = ["Nháp", "Chờ xuất", "Đang vận chuyển TQ", "Đang thông quan", "Kiểm hoá", "Đã thông quan", "Đã về kho"];

// v26: Helper kiểm tra shipment có tính vào nghiệp vụ không (loại trừ Hủy + Nháp)
// Dùng cho mọi calc công nợ, báo cáo, dashboard
const isOperationalShipment = (s) => s.status !== "Hủy" && s.status !== "Nháp";
// Xử lý khi SL nhận < SL giao
const QTY_DIFF_HANDLING = ["Hao hụt", "Giao sau", "Cảnh báo"];
// Country flags
const COUNTRY_FLAGS = { "Vietnam": "🇻🇳", "Thailand": "🇹🇭", "Malaysia": "🇲🇾", "Philippines": "🇵🇭", "Indonesia": "🇮🇩", "Trung Quốc": "🇨🇳", "China": "🇨🇳" };
const getFlag = (country) => COUNTRY_FLAGS[country] || "🏳️";
// v11: Loại hình vận chuyển
const CARRIER_TYPES = ["Đường biển", "Hàng không", "Đường bộ", "Chuyển phát nhanh", "Khác"];

const PAYMENT_TYPES = {
  MARKET_TO_FACTORY: "Thị trường → Nhà máy",
  INTER_FACTORY: "Chuyển nợ liên nhà máy",
};

// v38: 3 trạng thái dòng tiền cho payment MARKET_TO_FACTORY
// Áp dụng workflow: tạo (= stage 1) → bấm chuyển stage 2 → bấm chuyển stage 3
// Cảnh báo "tiền treo": > 4 ngày ở stage 1 hoặc stage 2 (đếm từ lúc vào stage, reset khi đổi)
const PAYMENT_STAGES = {
  carrier:      { id: "carrier",      label: "Đã chuyển uỷ thác",      icon: "🏦", color: "#F39C12", bg: "#FCEBD0", short: "Đã chuyển UT",
                   description: "GoChek đã chuyển tiền cho carrier/đơn vị uỷ thác xuất của nhà máy. Tiền đã rời thị trường nhưng NCC chưa nhận." },
  transferring: { id: "transferring", label: "Đang chuyển quốc tế",   icon: "🌐", color: "#3498DB", bg: "#D6EAF8", short: "Đang chuyển QT",
                   description: "Carrier đang chuyển tiền quốc tế cho NCC. Tiền vẫn 'treo' chưa đến tài khoản NCC." },
  completed:    { id: "completed",    label: "Hoàn tất thanh toán",   icon: "✅", color: "#3E8E3E", bg: "#E8F3E8", short: "Hoàn tất",
                   description: "NCC xác nhận đã nhận đủ tiền. Công nợ NCC giảm tương ứng. KHÔNG thể quay lui từ trạng thái này." },
};
// 2 stage "treo" — tiền đã rời GoChek nhưng NCC chưa nhận
const PAYMENT_PENDING_STAGES = ["carrier", "transferring"];
const PAYMENT_STAGE_ORDER = ["carrier", "transferring", "completed"];

// v38: Threshold cảnh báo tiền treo lâu (số ngày)
// User có thể override trong Settings (thuộc DEFAULT_SETTINGS)
const DEFAULT_PAYMENT_STAGE_THRESHOLDS = {
  carrier: 4,       // > 4 ngày ở stage carrier → cảnh báo
  transferring: 4,  // > 4 ngày ở stage transferring → cảnh báo
};

const FEE_TYPES = ["Thuế nhập khẩu", "VAT nhập khẩu", "Phí hải quan", "Phí vận chuyển quốc tế", "Phí kho bãi", "Phí khác"];

// Permissions system
const PERMISSIONS = {
  view_dashboard: { label: "Xem Dashboard", group: "Xem" },
  view_reports: { label: "Xem báo cáo", group: "Xem" },
  view_sensitive: { label: "Xem giá vốn / CNY", group: "Xem" },
  create_po: { label: "Tạo đơn đặt hàng", group: "PO" },
  edit_po: { label: "Sửa PO", group: "PO" },
  delete_po: { label: "Xóa PO", group: "PO" },
  create_shipment: { label: "Tạo đơn giao hàng", group: "Giao hàng" },
  edit_shipment: { label: "Sửa giao hàng", group: "Giao hàng" },
  delete_shipment: { label: "Xóa giao hàng", group: "Giao hàng" },
  create_payment: { label: "Tạo thanh toán", group: "Thanh toán" },
  delete_payment: { label: "Xóa thanh toán", group: "Thanh toán" },
  manage_products: { label: "Quản lý sản phẩm", group: "Sản phẩm" },
  manage_factories: { label: "Quản lý nhà máy", group: "Nhà máy" },
  manage_users: { label: "Quản lý tài khoản", group: "Hệ thống" },
  view_audit_log: { label: "Xem nhật ký", group: "Hệ thống" },
  manage_settings: { label: "Cấu hình hệ thống", group: "Hệ thống" },
  approve_po: { label: "Duyệt đơn đặt hàng", group: "PO" },
  manage_opening_balance: { label: "Quản lý công nợ đầu kỳ", group: "Công nợ" },
  change_shipment_status: { label: "Đổi trạng thái giao hàng", group: "Giao hàng" },
  create_fee_payment: { label: "Tạo thanh toán phí", group: "Thuế phí" },
  delete_fee_payment: { label: "Xóa thanh toán phí", group: "Thuế phí" },
  view_market_debt: { label: "Xem công nợ thị trường", group: "Thị trường" },
  manage_markets: { label: "Quản lý thị trường", group: "Thị trường" },
  manage_carriers: { label: "Quản lý đơn vị vận chuyển", group: "Vận chuyển" },
  export_accounting_report: { label: "Xuất báo cáo kế toán", group: "Báo cáo" },
};

const DEFAULT_ROLE_PERMS = {
  admin: Object.keys(PERMISSIONS),
  manager: ["view_dashboard", "view_reports", "view_sensitive", "create_po", "edit_po", "create_shipment", "edit_shipment", "change_shipment_status", "create_payment", "manage_products", "manage_factories", "manage_markets", "manage_carriers", "view_audit_log", "view_market_debt", "create_fee_payment", "export_accounting_report"],
  accountant: ["view_dashboard", "view_reports", "view_sensitive", "create_payment", "view_audit_log", "approve_po", "manage_opening_balance", "change_shipment_status", "create_fee_payment", "delete_fee_payment", "view_market_debt", "export_accounting_report", "manage_carriers"],
  staff: ["view_dashboard", "create_po", "create_shipment"],
  viewer: ["view_dashboard", "view_reports"],
};

const ROLE_LABELS = {
  admin: "Quản trị viên",
  manager: "Quản lý",
  accountant: "Kế toán",
  staff: "Nhân viên",
  viewer: "Chỉ xem",
};

// ============================================================
// SEED DATA
// ============================================================
// v32: Reset toàn bộ dữ liệu test → bắt đầu từ 1 admin user.
// Chị tự tạo user thật qua tab Cấu hình → Tài khoản (đổi mật khẩu mặc định ngay sau lần đầu đăng nhập).
const SEED_USERS = [
  { id: "u1", username: "admin", password: "gochek2026", fullName: "Đoàn Thị Liễu", email: "", role: "admin", status: "active", createdAt: "2026-01-01" },
];

// v32: Xóa toàn bộ NCC test → tạo NCC thật qua Cấu hình → Nhà cung cấp
const SEED_FACTORIES = [];

// v32: Xóa toàn bộ sản phẩm test → tạo SP thật qua tab Sản phẩm
const SEED_PRODUCTS = [];

// v32: Xóa toàn bộ Carrier test → tạo Carrier thật qua Cấu hình → Đơn vị vận chuyển
const SEED_CARRIERS = [];

// v32: Xóa toàn bộ PO test → tạo PO thật qua tab Đơn đặt hàng
const SEED_POS = [];

// v32: Xóa toàn bộ Shipment test → tạo Shipment thật qua tab Giao hàng
const SEED_SHIPMENTS = [];

// v32: Xóa toàn bộ Payment test → tạo Payment thật qua tab Thanh toán
const SEED_PAYMENTS = [];

// v18: Bảo hành — TT gửi hàng về NM bảo hành. Không ảnh hưởng công nợ NCC.
// v32: Xóa toàn bộ Warranty test → tạo qua tab Bảo hành
const SEED_WARRANTIES = [];

// v23: Đầu kỳ tồn kho — tồn tại thời điểm khởi tạo hệ thống
// v32: Xóa toàn bộ → tạo qua tab Tồn kho (chức năng "Đầu kỳ tồn kho")
const SEED_OPENING_STOCK = [];

// v23: Stock movements — sổ cái biến động tồn kho
// Sẽ được auto-sync từ shipments/warranties trong migration.
const SEED_STOCK_MOVEMENTS = [];

// v32: Xóa toàn bộ FeePayment test
const SEED_FEE_PAYMENTS = [];

const SEED_AUDIT_LOG = [];

// v32: Xóa toàn bộ Opening Balance test → tạo qua tab Công nợ đầu kỳ khi cần
const SEED_OPENING_BALANCES = [];

const SEED_MARKETS = [
  { id: "m_vn", name: "Vietnam", code: "VN", currency: "VND", note: "Thị trường chính",
    warehouses: [
      { id: "wh_vn_vh", name: "Kho Vũ Huy", address: "Hà Nội", note: "", isDefault: true },
      { id: "wh_vn_dt", name: "Kho DT", address: "TP.HCM", note: "", isDefault: false },
      { id: "wh_vn_kh", name: "Kho Khải Hoàn", address: "Đà Nẵng", note: "", isDefault: false },
    ]
  },
  { id: "m_th", name: "Thailand", code: "TH", currency: "THB", note: "Tăng trưởng cao",
    warehouses: [
      { id: "wh_th_redbox", name: "Redbox", address: "Bangkok", note: "", isDefault: true },
    ]
  },
  { id: "m_my", name: "Malaysia", code: "MY", currency: "MYR", note: "Đầu tư 2026",
    warehouses: [
      { id: "wh_my_main", name: "Kho Malaysia", address: "Kuala Lumpur", note: "", isDefault: true },
    ]
  },
  { id: "m_ph", name: "Philippines", code: "PH", currency: "PHP", note: "Đầu tư 2026",
    warehouses: [
      { id: "wh_ph_main", name: "Kho Philippines", address: "Manila", note: "", isDefault: true },
    ]
  },
];

const DEFAULT_SETTINGS = {
  cnyToVnd: 3550,
  thbToVnd: 720,
  myrToVnd: 5400,
  phpToVnd: 430,
  usdToVnd: 25000,
  productCategories: ["Micro", "Tai nghe", "Phụ kiện", "Giá đỡ", "Loa"],
  supplierStatuses: [
    { value: "active", label: "Đang hợp tác", color: "#10b981" },
    { value: "paused", label: "Tạm ngừng", color: "#f59e0b" },
    { value: "stopped", label: "Đã ngừng", color: "#6b7280" },
  ],
  // v38: Threshold cảnh báo "tiền treo lâu" cho payment MARKET_TO_FACTORY
  paymentStageThresholds: { ...DEFAULT_PAYMENT_STAGE_THRESHOLDS },
};

// ============================================================
// STORAGE & UTILS
// ============================================================
// v43: Storage được chuyển sang s3Storage.js (S3 + localStorage cache + memory fallback)
// Tất cả persistence đi qua: loadAll / saveAll / addItem / editItem / softDeleteItem
// Xem s3Storage.js để biết chi tiết bucket, region, debounce, auto-sync.

const fmt = (n, currency = "CNY") => {
  if (n === undefined || n === null || isNaN(n)) return "-";
  if (currency === "VND") return Math.round(n).toLocaleString("vi-VN") + " ₫";
  if (currency === "CNY") return "¥" + Math.round(n).toLocaleString("vi-VN");
  if (currency === "THB") return "฿" + Math.round(n).toLocaleString("vi-VN");
  if (currency === "MYR") return "RM" + Math.round(n).toLocaleString("vi-VN");
  if (currency === "PHP") return "₱" + Math.round(n).toLocaleString("vi-VN");
  if (currency === "USD") return "$" + Math.round(n).toLocaleString("en-US");
  return n.toLocaleString();
};

const fmtShort = (n) => {
  if (n === undefined || n === null || isNaN(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (abs >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return Math.round(n).toString();
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("vi-VN") : "-";
const fmtDateTime = (d) => d ? new Date(d).toLocaleString("vi-VN") : "-";
// v27: Format VND ngắn (M/B/T) cho summary bar
const fmtVND = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B ₫`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(0)}M ₫`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}K ₫`;
  return `${v.toLocaleString("vi-VN")} ₫`;
};
const uid = () => Math.random().toString(36).slice(2, 9).toUpperCase();

// Convert any currency to VND using settings
const toVND = (amount, currency, settings) => {
  if (!amount) return 0;
  const rates = { VND: 1, CNY: settings.cnyToVnd, THB: settings.thbToVnd, MYR: settings.myrToVnd, PHP: settings.phpToVnd, USD: settings.usdToVnd };
  return amount * (rates[currency] || 1);
};

// Get total shipped qty for a specific item in a PO
// v37: Loại trừ Nháp + Hủy — đồng bộ với shippedFromPO. Trước v37 không filter
// → sai khi có shipment Nháp tồn tại (Dashboard "Hàng chờ ship" + Tab Sản phẩm "Đã giao" + Tab PO chi tiết item).
// isOperationalShipment phải được định nghĩa trước file này — em check đảm bảo.
const shippedFromItem = (poId, itemId, shipments) =>
  shipments.filter(isOperationalShipment).flatMap(s => s.items || []).filter(i => i.poId === poId && i.itemId === itemId).reduce((sum, i) => sum + Number(i.quantity || 0), 0);

// Total qty shipped from entire PO (all items)
const shippedFromPO = (poId, shipments) =>
  // v26: Loại trừ Hủy + Nháp khỏi tính SL đã ship
  shipments.filter(isOperationalShipment).flatMap(s => s.items || []).filter(i => i.poId === poId).reduce((sum, i) => sum + Number(i.quantity || 0), 0);

// v38k: Helper mới — SL phiếu Nháp đang GIỮ CHỖ cho 1 item PO (chưa phát sinh công nợ)
// Phiếu Nháp = trạng thái "Nháp", chưa chuyển sang Chờ xuất.
// Trả về tổng SL của các phiếu Nháp đang giữ item này.
const reservedFromDraftItem = (poId, itemId, shipments) =>
  shipments.filter(s => s.status === "Nháp").flatMap(s => s.items || [])
    .filter(i => i.poId === poId && i.itemId === itemId).reduce((sum, i) => sum + Number(i.quantity || 0), 0);

// SL phiếu Nháp giữ chỗ toàn bộ PO
const reservedFromDraftPO = (poId, shipments) =>
  shipments.filter(s => s.status === "Nháp").flatMap(s => s.items || [])
    .filter(i => i.poId === poId).reduce((sum, i) => sum + Number(i.quantity || 0), 0);

// v38k: List các phiếu Nháp đang giữ chỗ item — dùng cho tooltip/expand
const draftShipmentsHoldingItem = (poId, itemId, shipments) =>
  shipments.filter(s => s.status === "Nháp")
    .filter(s => (s.items || []).some(i => i.poId === poId && i.itemId === itemId))
    .map(s => ({
      shipmentId: s.id,
      qty: (s.items || []).filter(i => i.poId === poId && i.itemId === itemId).reduce((sum, i) => sum + Number(i.quantity || 0), 0),
    }));

// Helper: get PO line items (handles both new and legacy structure)
const getPOItems = (po) => {
  if (po.items && Array.isArray(po.items)) return po.items;
  // Legacy single-item PO
  if (po.productId) return [{ id: "legacy", productId: po.productId, quantity: po.quantity, unitPrice: po.unitPrice }];
  return [];
};

// Total PO value (all items sum)
const poTotalValue = (po) => getPOItems(po).reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0);
const poTotalQuantity = (po) => getPOItems(po).reduce((s, it) => s + Number(it.quantity || 0), 0);
// v13: Bỏ poTotalProduced — không còn dùng. Số "đã giao" được tính qua shipments.

// v15: Quy đổi tiền tệ payment sang tiền tệ NCC (mặc định CNY).
// Trước v15: Chỉ cộng thẳng p.amount → SAI khi payment khác tiền tệ NCC.
// Lý do dùng tỷ giá hiện tại: nhất quán với báo cáo, không lưu tỷ giá lịch sử.
const paymentToFactoryCurrency = (payment, factoryCurrency, settings) => {
  const payCurrency = payment.currency || factoryCurrency;
  if (payCurrency === factoryCurrency) return Number(payment.amount || 0);
  // Bridge qua VND: payment → VND → factory currency
  const vnd = toVND(Number(payment.amount || 0), payCurrency, settings);
  const factoryToVndRate = settings[`${factoryCurrency.toLowerCase()}ToVnd`] || settings.cnyToVnd || 1;
  return vnd / factoryToVndRate;
};

// ============================================================
// v38: PAYMENT STAGE HELPERS
// ============================================================

// Lấy stage hiện tại của payment. Default = "completed" để backward-compatible
// (payment cũ chưa có field paymentStage → coi như đã hoàn tất, không treo).
const getPaymentStage = (p) => p?.paymentStage || "completed";

// Kiểm tra payment có ở 1 trong 2 stage "treo" không (carrier hoặc transferring)
const isPaymentPending = (p) => PAYMENT_PENDING_STAGES.includes(getPaymentStage(p));

// Lấy ngày bắt đầu vào stage hiện tại từ stageHistory (entry cuối cùng của stage hiện tại)
// Fallback: nếu không có history → dùng payDate
const getCurrentStageEnteredAt = (p) => {
  const stage = getPaymentStage(p);
  const history = Array.isArray(p?.stageHistory) ? p.stageHistory : [];
  // Tìm entry cuối cùng có stage trùng (có thể có nhiều entry nếu user lùi rồi tiến)
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].stage === stage) return history[i].at;
  }
  return p?.payDate || null;
};

// Đếm số ngày payment đã ở trong stage hiện tại
const daysInCurrentStage = (p, today = new Date()) => {
  const enteredAt = getCurrentStageEnteredAt(p);
  if (!enteredAt) return 0;
  const start = new Date(enteredAt);
  if (isNaN(start.getTime())) return 0;
  const ms = today.getTime() - start.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
};

// Kiểm tra payment có vượt threshold ở stage hiện tại không
// Trả về { exceeded, days, threshold } để UI hiển thị
const checkPaymentStageOverdue = (p, settings) => {
  const stage = getPaymentStage(p);
  if (stage === "completed") return { exceeded: false, days: 0, threshold: 0 };
  const thresholds = settings?.paymentStageThresholds || DEFAULT_PAYMENT_STAGE_THRESHOLDS;
  const threshold = thresholds[stage] ?? DEFAULT_PAYMENT_STAGE_THRESHOLDS[stage] ?? 4;
  const days = daysInCurrentStage(p);
  return { exceeded: days > threshold, days, threshold };
};

// Helper tạo entry stageHistory mới — dùng khi tạo payment hoặc đổi stage
const makeStageHistoryEntry = (stage, by) => ({
  stage,
  at: new Date().toISOString().slice(0, 10),
  by: by || "(system)",
});

const calcFactoryBalance = (factoryId, pos, shipments, payments, openingBalances = [], factories = [], settings = null, dateFrom = "", dateTo = "") => {
  const factory = factories.find(f => f.id === factoryId);
  const factoryCurrency = factory?.currency || "CNY";
  const factoryPOs = pos.filter(p => p.factoryId === factoryId);

  // v16: Phân loại shipment/payment theo thời gian (nếu có filter)
  // - hasFilter = true: chia 2 nhóm: trước kỳ (prev) và trong kỳ (inKy)
  // - hasFilter = false: tất cả gom vào "inKy" để giữ behavior cũ (V15)
  const hasFilter = !!(dateFrom || dateTo);

  // Helper: tính giá trị hàng đã ship của 1 PO trong tập shipments cụ thể
  const calcShippedValueInScope = (po, scopeShipments) => {
    if (po.status === "Hủy") return 0;
    const items = getPOItems(po);
    return items.reduce((s, it) => {
      // v26: Loại trừ cả Hủy + Nháp khỏi tính giá trị đã ship
      const shipped = po.items
        ? scopeShipments.filter(isOperationalShipment).flatMap(sh => sh.items || []).filter(i => i.poId === po.id && i.itemId === it.id).reduce((sum, i) => sum + Number(i.quantity || 0), 0)
        : scopeShipments.filter(isOperationalShipment).flatMap(sh => sh.items || []).filter(i => i.poId === po.id).reduce((sum, i) => sum + Number(i.quantity || 0), 0);
      return s + shipped * Number(it.unitPrice || 0);
    }, 0);
  };

  // v16: Hàng đã ship — tách trước kỳ vs trong kỳ
  let prevShippedValue = 0;
  let inKyShippedValue = 0;
  if (hasFilter) {
    const shipmentsBefore = shipments.filter(s => dateFrom && s.departDate && s.departDate < dateFrom);
    const shipmentsIn = shipments.filter(s => {
      if (!s.departDate) return false;
      if (dateFrom && s.departDate < dateFrom) return false;
      if (dateTo && s.departDate > dateTo) return false;
      return true;
    });
    factoryPOs.forEach(po => {
      prevShippedValue += calcShippedValueInScope(po, shipmentsBefore);
      inKyShippedValue += calcShippedValueInScope(po, shipmentsIn);
    });
  } else {
    factoryPOs.forEach(po => {
      inKyShippedValue += calcShippedValueInScope(po, shipments);
    });
  }
  const actualDebt = prevShippedValue + inKyShippedValue; // Tổng hàng đã ship lũy kế (giữ tương thích)

  // v16: Thanh toán — tách trước kỳ vs trong kỳ. Quy đổi sang tiền tệ NCC.
  const convertPay = (p) => settings ? paymentToFactoryCurrency(p, factoryCurrency, settings) : Number(p.amount);
  const inDateRange = (d) => {
    if (!d) return !hasFilter; // không có ngày → chỉ tính khi không filter
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };
  const beforeDateRange = (d) => {
    if (!hasFilter || !dateFrom) return false;
    return !!d && d < dateFrom;
  };

  let prevInbound = 0, prevOutbound = 0;
  let inKyInbound = 0, inKyOutbound = 0;
  // v38: Tách payment theo stage. CHỈ stage "completed" mới giảm công nợ.
  // Stage 1+2 ("carrier" + "transferring") → pendingPaid (đang treo).
  // Quy ước: INTER_FACTORY luôn coi là completed (không có UI stage cho loại này).
  let pendingInbound = 0, pendingOutbound = 0; // stage 1+2 quy ra tiền tệ NCC
  let pendingInboundVND = 0, pendingOutboundVND = 0; // stage 1+2 quy VND theo tỷ giá payment lưu cứng

  payments.forEach(p => {
    // v20: Bỏ qua thanh toán đã hủy
    if (p.status === "cancelled") return;
    const isInbound = (p.type === "MARKET_TO_FACTORY" && p.toFactoryId === factoryId) || (p.type === "INTER_FACTORY" && p.toFactoryId === factoryId);
    const isOutbound = p.type === "INTER_FACTORY" && p.fromFactoryId === factoryId;
    if (!isInbound && !isOutbound) return;
    const amt = convertPay(p);

    // v38: Phân loại theo stage. INTER_FACTORY luôn là completed.
    const stage = p.type === "INTER_FACTORY" ? "completed" : getPaymentStage(p);
    const isPending = PAYMENT_PENDING_STAGES.includes(stage);

    if (isPending) {
      // Stage 1+2 — tích lũy vào pendingPaid, KHÔNG cộng vào inbound/outbound
      // (vì inbound/outbound chỉ tính stage 3 "completed")
      const amtVND = Number(p.amountInVND ?? toVND(Number(p.amount || 0), p.currency || factoryCurrency, settings));
      if (isInbound) {
        pendingInbound += amt;
        pendingInboundVND += amtVND;
      } else {
        pendingOutbound += amt;
        pendingOutboundVND += amtVND;
      }
      return; // bỏ qua, không cộng vào in/out kỳ
    }

    // Stage 3 (completed) — cộng vào in/out kỳ như cũ
    if (hasFilter) {
      if (beforeDateRange(p.payDate)) {
        if (isInbound) prevInbound += amt; else prevOutbound += amt;
      } else if (inDateRange(p.payDate)) {
        if (isInbound) inKyInbound += amt; else inKyOutbound += amt;
      }
    } else {
      if (isInbound) inKyInbound += amt; else inKyOutbound += amt;
    }
  });
  const inbound = prevInbound + inKyInbound;
  const outbound = prevOutbound + inKyOutbound;
  const netPaid = inbound - outbound;
  const inKyNetPaid = inKyInbound - inKyOutbound;
  const prevNetPaid = prevInbound - prevOutbound;

  // v38: Tổng đang TT (stage 1+2) — quy CNY và VND
  const pendingPaidCNY = pendingInbound - pendingOutbound;
  const pendingPaidVND = pendingInboundVND - pendingOutboundVND;

  // v20: Bỏ qua openingBalances đã hủy
  // v38i: V38h schema có entityType — V38i bỏ vì giờ mọi OB đều là TT × NCC.
  // Filter đơn giản theo factoryId. Hard migration đã xóa OB cũ → an toàn.
  // Cộng OB của TẤT CẢ TT đang nợ NCC này (vd Shenzhen có OB từ Vietnam + Thailand → cộng cả 2).
  const openingDebt = openingBalances.filter(o => o.factoryId === factoryId && o.type === "debt" && o.status !== "cancelled").reduce((s, o) => s + Number(o.amount), 0);
  const openingCredit = openingBalances.filter(o => o.factoryId === factoryId && o.type === "credit" && o.status !== "cancelled").reduce((s, o) => s + Number(o.amount), 0);

  // v16: Số dư đầu kỳ lọc — gộp opening + giao dịch trước kỳ.
  // Nếu không có filter, prev = 0 nên prevDebt = openingDebt, prevCredit = openingCredit (giữ behavior cũ).
  const prevDebt = openingDebt + prevShippedValue;
  const prevCredit = openingCredit + prevNetPaid;

  // Tính tổng kết
  const totalDebt = prevDebt + inKyShippedValue;
  const totalAvailable = prevCredit + inKyNetPaid;
  const remain = totalDebt - totalAvailable;
  const creditFund = remain < 0 ? -remain : 0;
  const stillOwed = remain > 0 ? remain : 0;

  // v15: Hàng chờ ship — KHÔNG lọc theo thời gian (luôn tính hiện trạng tổng PO chưa ship)
  const expectedDebt = factoryPOs.reduce((sum, po) => {
    if (!po.approved || po.status === "Hủy") return sum;
    const items = getPOItems(po);
    return sum + items.reduce((s, it) => {
      const shipped = po.items ? shippedFromItem(po.id, it.id, shipments) : shippedFromPO(po.id, shipments);
      return s + Math.max(0, Number(it.quantity) - shipped) * Number(it.unitPrice || 0);
    }, 0);
  }, 0);

  return {
    actualDebt, inbound, outbound, netPaid, stillOwed, creditFund, expectedDebt, openingDebt, openingCredit,
    // v16: Mới — phục vụ hiển thị có filter
    prevDebt, prevCredit, prevShippedValue, prevInbound, prevOutbound, prevNetPaid,
    inKyShipped: inKyShippedValue, inKyInbound, inKyOutbound, inKyNetPaid,
    hasFilter,
    // v38: Tổng đang TT (stage 1+2)
    pendingPaidCNY, pendingPaidVND,
  };
};

// v18: Helper — tính tổng giá trị hàng đang BH (treo) cho 1 thị trường, quy đổi CNY
// Dùng đơn giá master products. 3 trạng thái treo: Đang gửi NM / NM đang sửa / Đang trả về kho
const calcWarrantyPendingValueCNY = (market, warranties, products, settings) => {
  if (!warranties || warranties.length === 0) return 0;
  const pendingWarranties = warranties.filter(w => w.marketFrom === market && WARRANTY_PENDING_STATUSES.includes(w.status));
  let totalCNY = 0;
  pendingWarranties.forEach(w => {
    (w.items || []).forEach(it => {
      const prod = products.find(p => p.id === it.productId);
      if (!prod) return;
      const valInProdCurrency = Number(it.quantity || 0) * Number(prod.unitPrice || 0);
      const valVND = toVND(valInProdCurrency, prod.currency || "CNY", settings);
      totalCNY += valVND / (settings.cnyToVnd || 1);
    });
  });
  return totalCNY;
};

// v29: Tính các lô đến hạn / quá hạn thanh toán cho NCC
// Logic: lô về kho rồi → hạn = arriveDate + factory.paymentDays
// Phân bổ payment theo FIFO (lô về trước → trả trước)
// Trả về danh sách { shipment, factory, dueDate, daysUntilDue, valueCNY, valueRemainCNY, urgency }
//   urgency: "overdue" (đã quá hạn), "urgent" (≤7 ngày), "warning" (≤14 ngày), null (chưa cần lo)
// v33: Các trạng thái shipment "đã rời nhà máy" → đã phát sinh công nợ NCC
// Theo nghiệp vụ GoChek: chỉ phát sinh công nợ khi hàng đã xuất khỏi nhà máy.
// Nháp và Hủy không tính. Các status còn lại đều đã ra khỏi NM → đã có công nợ.
const SHIPMENT_LEFT_FACTORY = ["Chờ xuất", "Đang vận chuyển TQ", "Đang vận chuyển", "Đang thông quan", "Kiểm hoá", "Đã thông quan", "Đã về kho"];
// v33: Các trạng thái shipment đang trên đường (đã rời NM, chưa về kho TT)
const SHIPMENT_IN_TRANSIT = ["Chờ xuất", "Đang vận chuyển TQ", "Đang vận chuyển", "Đang thông quan", "Kiểm hoá", "Đã thông quan"];

const calcDuePayments = (shipments, pos, factories, payments, products, settings, daysAhead = 14) => {
  if (!settings) return [];
  const today = new Date().toISOString().slice(0, 10);
  const result = [];

  // Group shipments by factory (qua PO)
  factories.forEach(factory => {
    const paymentDays = Number(factory.paymentDays || 30);
    // v33: Lấy TẤT CẢ shipment đã rời NM của NCC này (không chỉ "Đã về kho").
    //      Sắp xếp theo ngày phát sinh công nợ (FIFO) — ngày này = ngày về kho nếu đã về,
    //      hoặc ngày xuất xưởng (departDate) nếu chưa về kho.
    const factoryShipments = shipments
      .filter(s => SHIPMENT_LEFT_FACTORY.includes(s.status))
      .filter(s => {
        // Shipment có item nào liên kết PO của factory này
        return (s.items || []).some(i => {
          const po = pos.find(p => p.id === i.poId);
          return po && po.factoryId === factory.id;
        });
      })
      .map(s => {
        // Tính giá trị lô (theo currency NCC)
        let valueInFactoryCurrency = 0;
        (s.items || []).forEach(i => {
          const po = pos.find(p => p.id === i.poId);
          if (!po || po.factoryId !== factory.id) return;
          const poItems = getPOItems(po);
          const poItem = po.items ? poItems.find(x => x.id === i.itemId) : poItems[0];
          if (!poItem) return;
          // v33: Lô đã về kho → ưu tiên SL nhận thực tế. Lô chưa về kho → dùng SL giao theo kế hoạch.
          const qty = s.status === "Đã về kho"
            ? Number(i.receivedQty ?? i.quantity ?? 0)
            : Number(i.quantity ?? 0);
          const price = Number(poItem.unitPrice || 0);
          valueInFactoryCurrency += qty * price;
        });
        // v33: Tính dueDate theo trạng thái shipment.
        //  - Lô đã về kho: dueDate = (actualArriveDate || arriveDate) + paymentDays
        //  - Lô chưa về kho (đang đi đường, chờ xuất): dueDate = departDate + paymentDays
        //    → Nghiệp vụ: công nợ phát sinh từ lúc hàng RỜI nhà máy, nên đếm từ departDate.
        const isArrived = s.status === "Đã về kho";
        const baseDate = isArrived
          ? (s.actualArriveDate || s.arriveDate || s.departDate)
          : s.departDate;
        const dueDate = baseDate ? new Date(new Date(baseDate).getTime() + paymentDays * 86400000).toISOString().slice(0, 10) : null;
        // arriveDate dùng để sắp xếp FIFO — lô có ngày phát sinh sớm hơn được phân bổ payment trước
        const sortKey = baseDate || s.departDate || "";
        return { shipment: s, valueInFactoryCurrency, arriveDate: sortKey, dueDate, isArrived };
      })
      .filter(x => x.valueInFactoryCurrency > 0)
      .sort((a, b) => (a.arriveDate || "").localeCompare(b.arriveDate || ""));

    // Tổng đã trả NCC này
    const factoryCurrency = factory.currency || "CNY";
    const totalPaidInFactoryCurrency = payments
      .filter(p => p.status !== "cancelled")
      .filter(p => (p.type === "MARKET_TO_FACTORY" && p.toFactoryId === factory.id) || (p.type === "INTER_FACTORY" && p.toFactoryId === factory.id))
      .reduce((sum, p) => sum + paymentToFactoryCurrency(p, factoryCurrency, settings), 0);

    // Phân bổ payment theo FIFO
    let remainingPaid = totalPaidInFactoryCurrency;
    factoryShipments.forEach(item => {
      const paid = Math.min(remainingPaid, item.valueInFactoryCurrency);
      remainingPaid -= paid;
      const valueRemain = item.valueInFactoryCurrency - paid;

      if (valueRemain <= 0.01) return; // đã trả hết
      if (!item.dueDate) return;

      // Tính ngày còn đến hạn (âm = quá hạn)
      const dueDateObj = new Date(item.dueDate);
      const todayObj = new Date(today);
      const daysUntilDue = Math.floor((dueDateObj - todayObj) / 86400000);

      let urgency = null;
      if (daysUntilDue < 0) urgency = "overdue";
      else if (daysUntilDue <= 7) urgency = "urgent";
      else if (daysUntilDue <= daysAhead) urgency = "warning";

      if (urgency) {
        result.push({
          shipment: item.shipment,
          factory,
          arriveDate: item.arriveDate,
          dueDate: item.dueDate,
          daysUntilDue,
          valueCNY: factoryCurrency === "CNY" ? item.valueInFactoryCurrency : (item.valueInFactoryCurrency * (settings[`${factoryCurrency.toLowerCase()}ToVnd`] || 1)) / (settings.cnyToVnd || 1),
          valueRemainCNY: factoryCurrency === "CNY" ? valueRemain : (valueRemain * (settings[`${factoryCurrency.toLowerCase()}ToVnd`] || 1)) / (settings.cnyToVnd || 1),
          factoryCurrency,
          valueRemainInFactoryCurrency: valueRemain,
          urgency,
          // v33: Cờ phụ — giúp UI hiển thị badge "Đang VC" / "Đã về kho" khác nhau
          isArrived: item.isArrived,
        });
      }
    });
  });

  // Sắp xếp: overdue trước, sau đó urgent, warning; trong cùng nhóm thì lô gần hạn nhất đầu
  return result.sort((a, b) => {
    const order = { overdue: 0, urgent: 1, warning: 2 };
    const diff = order[a.urgency] - order[b.urgency];
    if (diff !== 0) return diff;
    return a.daysUntilDue - b.daysUntilDue;
  });
};

// Market debt: Market nhận hàng → nợ giá trị hàng (CNY). Trừ các khoản market đã thanh toán cho NM qua Thanh toán NM (MARKET_TO_FACTORY).
// v15: Loại trừ shipment "Hủy" để khớp UI khác
// v18: Thêm warranties + products → tính giá trị "Hàng đang BH" treo công nợ tạm thời
// v38h: Thêm openingBalances → cộng OB market (entityType="market", market === này) vào balance.
//       OB chung TT (warehouseId rỗng) + OB từng kho đều được cộng vào tổng TT.
const calcMarketBalance = (market, pos, shipments, payments, settings, warranties = [], products = [], openingBalances = []) => {
  // Total received in CNY (goods value) — tính theo SL đã ship
  let totalReceivedCNY = 0;
  // v26: Loại trừ cả Hủy + Nháp
  shipments.filter(s => s.market === market && isOperationalShipment(s)).forEach(s => {
    (s.items || []).forEach(i => {
      const po = pos.find(p => p.id === i.poId);
      if (!po) return;
      const poItems = getPOItems(po);
      const poItem = po.items ? poItems.find(x => x.id === i.itemId) : poItems[0];
      if (!poItem) return;
      const valInPoCurrency = Number(i.quantity) * Number(poItem.unitPrice || 0);
      // Convert to CNY via VND as bridge
      const valVND = toVND(valInPoCurrency, po.currency, settings);
      totalReceivedCNY += valVND / settings.cnyToVnd;
    });
  });
  // Total paid by market to factories (via MARKET_TO_FACTORY payments) — convert to CNY
  // v20: Bỏ qua thanh toán đã hủy
  // v38: Cách B — Tách stage 3 (completed) vs stage 1+2 (pending)
  // "Đã trả" = chỉ tính stage completed. "Đang TT" = stage carrier + transferring.
  let totalPaidCNY = 0;     // Stage 3 (completed) — đã thực sự đến NCC
  let pendingPaidCNY = 0;   // Stage 1+2 — tiền đã rời TT nhưng NCC chưa nhận
  payments.filter(p => p.type === "MARKET_TO_FACTORY" && p.fromMarket === market && p.status !== "cancelled")
    .forEach(p => {
      const vnd = toVND(Number(p.amount), p.currency, settings);
      const cny = vnd / settings.cnyToVnd;
      const stage = getPaymentStage(p);
      if (stage === "completed") totalPaidCNY += cny;
      else if (PAYMENT_PENDING_STAGES.includes(stage)) pendingPaidCNY += cny;
    });

  // v18: Hàng đang BH (treo) — trừ tạm thời khỏi công nợ thị trường
  const warrantyPendingCNY = calcWarrantyPendingValueCNY(market, warranties, products, settings);

  // v38i: V38h schema có entityType="market" — V38i bỏ vì giờ mọi OB đều là TT × NCC.
  // Filter đơn giản theo market. Cộng OB của TT này nợ TẤT CẢ NCC.
  // Cùng 1 OB record được cộng vào CẢ calcFactoryBalance (qua factoryId) lẫn calcMarketBalance (qua market)
  // → ĐẢM BẢO ĐỐI XỨNG TỰ NHIÊN: tab NCC + tab TT + Dashboard không thể lệch nhau.
  let openingDebtCNY = 0;
  let openingCreditCNY = 0;
  (openingBalances || []).filter(o =>
    o.market === market && o.status !== "cancelled"
  ).forEach(o => {
    const vnd = toVND(Number(o.amount || 0), o.currency || "CNY", settings);
    const cny = vnd / settings.cnyToVnd;
    if (o.type === "debt") openingDebtCNY += cny;
    else if (o.type === "credit") openingCreditCNY += cny;
  });

  // v18 + v38 + v38h: Còn phải trả =
  //   Hàng đã ship + OB nợ gốc - OB quỹ TD - Đã trả (stage 3) - Đang TT (stage 1+2) - Hàng đang BH
  const remain = totalReceivedCNY + openingDebtCNY - openingCreditCNY - totalPaidCNY - pendingPaidCNY - warrantyPendingCNY;
  const stillOwed = remain > 0 ? remain : 0;
  const creditFund = remain < 0 ? -remain : 0;
  return {
    totalReceived: totalReceivedCNY,
    totalPaid: totalPaidCNY,           // v38: chỉ stage completed
    pendingPaid: pendingPaidCNY,       // v38: stage 1+2 (mới)
    warrantyPending: warrantyPendingCNY,
    openingDebtCNY,                     // v38h
    openingCreditCNY,                   // v38h
    stillOwed,
    creditFund,
  };
};

// ============================================================
// v38j: INVENTORY HELPERS — Tính toán tồn kho theo SP × Kho/TT
// ============================================================
// Tất cả helper này xử lý 1 SP. Component sẽ loop qua từng SP để build bảng.

// 5 trạng thái + ưu tiên hiển thị
const INVENTORY_STATUS = {
  URGENT_PO: { id: "urgent_po", label: "Đặt PO gấp", icon: "🔴", color: "#DC2626", priority: 1 },
  NEED_SHIP: { id: "need_ship", label: "Cần giao về", icon: "🟡", color: "#F59E0B", priority: 2 },
  COMING:    { id: "coming",    label: "Đang về",    icon: "🔵", color: "#2563EB", priority: 3 },
  ENOUGH:    { id: "enough",    label: "Đủ hàng",    icon: "🟢", color: "#16A34A", priority: 4 },
  IGNORE:    { id: "ignore",    label: "Không theo dõi", icon: "⚪", color: "#9CA3AF", priority: 5 },
};

// Status của shipment được tính là "đã về kho"
const SHIPMENT_RECEIVED_STATUSES = ["Đã về kho"];
// Status được tính là "đang đi đường" (5 status chị chốt)
const SHIPMENT_IN_TRANSIT_STATUSES = ["Chờ xuất", "Đang vận chuyển TQ", "Đang thông quan", "Kiểm hoá", "Đã thông quan", "Đang vận chuyển"];

/**
 * Tính tổng "Hàng đã nhập" cho 1 SP, lọc theo kho hoặc TT.
 * @param {string} productId
 * @param {Array} shipments
 * @param {Array} pos - cần để map shipment item → product
 * @param {Object} filter - { warehouseId?, market? } — undefined = toàn bộ
 */
const calcReceivedQty = (productId, shipments, pos, filter = {}) => {
  let total = 0;
  shipments.forEach(s => {
    if (!SHIPMENT_RECEIVED_STATUSES.includes(s.status)) return;
    if (filter.warehouseId && s.warehouseId !== filter.warehouseId) return;
    if (filter.market && s.market !== filter.market) return;
    (s.items || []).forEach(it => {
      // Map shipment item → product qua PO
      const po = pos.find(p => p.id === it.poId);
      if (!po) return;
      const poItems = getPOItems(po);
      const poItem = po.items ? poItems.find(x => x.id === it.itemId) : poItems[0];
      if (!poItem || poItem.productId !== productId) return;
      // V18: Sử dụng receivedQty (số nhận thực tế) nếu có, fallback quantity
      total += Number(it.receivedQty != null ? it.receivedQty : it.quantity || 0);
    });
  });
  return total;
};

/**
 * Tính "Tồn ở NCC" cho 1 SP — gắn theo TT (vì PO không có warehouseId).
 * Toàn bộ tổng PO duyệt − tổng đã ship (mọi trạng thái non-cancelled).
 * @param {string} productId
 * @param {Array} pos - chỉ tính PO đã duyệt
 * @param {Array} shipments
 */
const calcAtFactoryQty = (productId, pos, shipments) => {
  let totalOrdered = 0;
  let totalShipped = 0;
  pos.forEach(po => {
    if (po.status !== "Đã duyệt") return; // chỉ PO duyệt
    const poItems = getPOItems(po);
    poItems.forEach(it => {
      if (it.productId !== productId) return;
      totalOrdered += Number(it.quantity || 0);
    });
  });
  shipments.forEach(s => {
    // v38k: Chỉ loại "Hủy". "Nháp" được tính (giữ chỗ tạm thời).
    // → Khi chị tạo phiếu Nháp A 100 cái → Tồn ở NCC giảm 100 ngay → bảng Tồn kho không đề xuất tạo SH thừa.
    if (s.status === "Hủy") return;
    (s.items || []).forEach(it => {
      const po = pos.find(p => p.id === it.poId);
      if (!po || po.status !== "Đã duyệt") return;
      const poItems = getPOItems(po);
      const poItem = po.items ? poItems.find(x => x.id === it.itemId) : poItems[0];
      if (!poItem || poItem.productId !== productId) return;
      totalShipped += Number(it.quantity || 0);
    });
  });
  return Math.max(0, totalOrdered - totalShipped);
};

/**
 * Tính "Hàng đi đường" cho 1 SP — shipment đang vận chuyển.
 * @param {string} productId
 * @param {Array} shipments
 * @param {Array} pos
 * @param {Object} filter - { warehouseId?, market? }
 */
const calcInTransitQty = (productId, shipments, pos, filter = {}) => {
  let total = 0;
  shipments.forEach(s => {
    if (!SHIPMENT_IN_TRANSIT_STATUSES.includes(s.status)) return;
    if (filter.warehouseId && s.warehouseId !== filter.warehouseId) return;
    if (filter.market && s.market !== filter.market) return;
    (s.items || []).forEach(it => {
      const po = pos.find(p => p.id === it.poId);
      if (!po) return;
      const poItems = getPOItems(po);
      const poItem = po.items ? poItems.find(x => x.id === it.itemId) : poItems[0];
      if (!poItem || poItem.productId !== productId) return;
      total += Number(it.quantity || 0);
    });
  });
  return total;
};

/**
 * Tính "Tồn trong kho" cho 1 SP — lấy từ stockOnHand (manual).
 * @param {string} productId
 * @param {Array} stockOnHand
 * @param {Object} filter - { warehouseId?, market? }
 */
const calcStockOnHandQty = (productId, stockOnHand, filter = {}) => {
  let total = 0;
  (stockOnHand || []).forEach(s => {
    if (s.productId !== productId) return;
    if (filter.warehouseId && s.warehouseId !== filter.warehouseId) return;
    if (filter.market && s.market !== filter.market) return;
    total += Number(s.quantity || 0);
  });
  return total;
};

/**
 * Tính ngưỡng cảnh báo cho 1 SP × phạm vi.
 * - Nếu chỉ định warehouseId → lấy targets[whId].tonAnToan
 * - Nếu market → cộng targets các kho thuộc market
 * - Nếu không filter → cộng tất cả targets
 * Returns { tonAnToan, slBanNgay, khongTheoDoi }
 *   khongTheoDoi = true khi tất cả kho relevant đều "không theo dõi"
 */
const calcThresholds = (product, allWarehouses, filter = {}) => {
  const targets = product.warehouseTargets || {};
  let tonAnToan = 0, slBanNgay = 0;
  let allIgnored = true;
  let hasAnyTarget = false;

  let whIds = [];
  if (filter.warehouseId) {
    whIds = [filter.warehouseId];
  } else if (filter.market) {
    whIds = allWarehouses.filter(w => w.marketName === filter.market).map(w => w.id);
  } else {
    whIds = allWarehouses.map(w => w.id);
  }

  whIds.forEach(whId => {
    const t = targets[whId];
    if (!t) return; // chưa cấu hình
    hasAnyTarget = true;
    if (!t.khongTheoDoi) {
      allIgnored = false;
      tonAnToan += Number(t.tonAnToan || 0);
      slBanNgay += Number(t.slBanNgay || 0);
    }
  });

  return {
    tonAnToan,
    slBanNgay,
    khongTheoDoi: !hasAnyTarget || allIgnored,
  };
};

/**
 * Tính trạng thái 1 mục (SP × phạm vi) với 5 trạng thái + lead time.
 * @param {Object} input - { stockInWarehouse, inTransit, atFactory, tonAnToan, slBanNgay, leadTimeDays, khongTheoDoi }
 * Returns: 1 trong 5 status object
 */
const calcInventoryStatus = (input) => {
  const {
    stockInWarehouse = 0,
    inTransit = 0,
    atFactory = 0,
    tonAnToan = 0,
    slBanNgay = 0,
    leadTimeDays = 0,
    khongTheoDoi = false,
  } = input;

  // ⚪ Không theo dõi
  if (khongTheoDoi || tonAnToan === 0) return INVENTORY_STATUS.IGNORE;

  // 🔴 Đặt PO gấp — sẽ hết hàng kể cả khi đặt PO ngay
  // Điều kiện: cần SL bán/ngày + lead time đã cấu hình
  if (slBanNgay > 0 && leadTimeDays > 0) {
    const needInLeadTime = slBanNgay * leadTimeDays;
    const totalAvailable = stockInWarehouse + inTransit + atFactory;
    if (totalAvailable < needInLeadTime) return INVENTORY_STATUS.URGENT_PO;
  }

  // 🟡 Cần giao về — tồn thấp nhưng có hàng ở NCC
  if ((stockInWarehouse + inTransit) < tonAnToan && atFactory > 0) {
    return INVENTORY_STATUS.NEED_SHIP;
  }

  // Nếu tồn kho < ngưỡng VÀ NCC = 0 → vẫn là 🔴 (cần đặt PO ngay)
  if ((stockInWarehouse + inTransit) < tonAnToan && atFactory === 0) {
    return INVENTORY_STATUS.URGENT_PO;
  }

  // 🔵 Đang về — có hàng đang vận chuyển + tồn kho đủ ngưỡng
  if (inTransit > 0 && stockInWarehouse >= tonAnToan) {
    return INVENTORY_STATUS.COMING;
  }

  // 🟢 Đủ hàng
  return INVENTORY_STATUS.ENOUGH;
};

/**
 * Đề xuất tạo Shipment.
 * Cần thêm = Ngưỡng − Tồn kho − Đi đường, cắt theo Tồn NCC.
 * @returns { qty, reason } — qty = 0 nếu không cần đề xuất
 */
const calcSuggestShipQty = (input) => {
  const { stockInWarehouse = 0, inTransit = 0, atFactory = 0, tonAnToan = 0 } = input;
  if (tonAnToan === 0) return { qty: 0, reason: "Chưa cài ngưỡng" };
  const needed = tonAnToan - stockInWarehouse - inTransit;
  if (needed <= 0) return { qty: 0, reason: "Đã đủ" };
  const qty = Math.min(needed, atFactory);
  if (atFactory === 0) return { qty: 0, reason: "Tồn NCC = 0, cần đặt PO trước" };
  if (qty < needed) {
    return { qty, reason: `Còn thiếu ${needed - qty} sau khi giao (NCC không đủ)` };
  }
  return { qty, reason: "" };
};

/**
 * Đề xuất đặt PO mới.
 * Tổng nhu cầu = SL bán/ngày × Số ngày dự kiến bán.
 * Đã có = Tồn kho + Đi đường + Tồn NCC.
 * Đề xuất = MAX(0, Nhu cầu − Đã có).
 * @returns { qty, reason } — qty = 0 hoặc -1 (chưa cấu hình)
 */
const calcSuggestPOQty = (input) => {
  const {
    stockInWarehouse = 0, inTransit = 0, atFactory = 0,
    slBanNgay = 0, soNgayDuKienBan = 0, leadTimeDays = 0,
  } = input;
  if (slBanNgay <= 0 || soNgayDuKienBan <= 0) {
    return { qty: -1, reason: "Cần cấu hình SL bán/ngày + Số ngày dự kiến bán" };
  }
  const totalNeed = slBanNgay * soNgayDuKienBan;
  const available = stockInWarehouse + inTransit + atFactory;
  const suggest = Math.max(0, totalNeed - available);
  // Cảnh báo nếu lead time vượt quá khả năng đáp ứng
  let warning = "";
  if (leadTimeDays > 0) {
    const dangerThreshold = slBanNgay * leadTimeDays;
    if ((stockInWarehouse + inTransit) < dangerThreshold) {
      warning = `⚠️ Đặt ngay — chỉ còn ${stockInWarehouse + inTransit} cái dùng được trong ${leadTimeDays} ngày SX+VC`;
    }
  }
  return { qty: suggest, reason: warning };
};


// Trả về: { allowed: bool, reasons: [] (danh sách lý do chặn nếu allowed=false) }
// Helpers nhận `data` object chứa toàn bộ store: { pos, shipments, payments,
// openingBalances, warranties, feePayments, factories, carriers }

// 🏭 NCC: status = stopped/cancelled + KHÔNG có PO + Payment + OpeningBalance + Warranty + FeePayment
const canHardDeleteFactory = (factoryId, data) => {
  const reasons = [];
  const factory = (data.factories || []).find(f => f.id === factoryId);
  if (!factory) return { allowed: false, reasons: ["Không tìm thấy NCC"] };

  // 1. Status check
  const okStatus = factory.status === "stopped" || factory.status === "cancelled";
  if (!okStatus) reasons.push(`NCC đang ở trạng thái "${factory.status || "active"}" — cần chuyển sang "Đã ngừng" (stopped) trước`);

  // 2. PO check
  const relatedPOs = (data.pos || []).filter(p => p.factoryId === factoryId);
  if (relatedPOs.length > 0) reasons.push(`Còn ${relatedPOs.length} PO liên quan (kể cả PO đã hủy) — cần xóa cứng PO trước`);

  // 3. Payment check (cả MARKET_TO_FACTORY + INTER_FACTORY in/out)
  const relatedPayments = (data.payments || []).filter(p =>
    p.toFactoryId === factoryId || p.fromFactoryId === factoryId
  );
  if (relatedPayments.length > 0) reasons.push(`Còn ${relatedPayments.length} thanh toán liên quan — cần xóa các thanh toán này trước`);

  // 4. Opening Balance check
  const relatedOB = (data.openingBalances || []).filter(o => o.factoryId === factoryId);
  if (relatedOB.length > 0) reasons.push(`Còn ${relatedOB.length} công nợ đầu kỳ liên quan`);

  // 5. Warranty check
  const relatedWarranties = (data.warranties || []).filter(w => w.factoryId === factoryId);
  if (relatedWarranties.length > 0) reasons.push(`Còn ${relatedWarranties.length} bảo hành liên quan`);

  // 6. FeePayment check (qua shipment)
  const factoryShipmentIds = new Set(
    (data.shipments || [])
      .filter(s => (s.items || []).some(it => {
        const po = (data.pos || []).find(p => p.id === it.poId);
        return po && po.factoryId === factoryId;
      }))
      .map(s => s.id)
  );
  const relatedFeePay = (data.feePayments || []).filter(fp => factoryShipmentIds.has(fp.shipmentId));
  if (relatedFeePay.length > 0) reasons.push(`Còn ${relatedFeePay.length} thanh toán phí liên quan`);

  return { allowed: reasons.length === 0, reasons };
};

// 🚛 Đơn vị VC: status = stopped + KHÔNG có Shipment + FeePayment
const canHardDeleteCarrier = (carrierId, data) => {
  const reasons = [];
  const carrier = (data.carriers || []).find(c => c.id === carrierId);
  if (!carrier) return { allowed: false, reasons: ["Không tìm thấy đơn vị VC"] };

  // 1. Status check
  if (carrier.status !== "stopped") {
    reasons.push(`Đơn vị VC đang ở trạng thái "${carrier.status || "active"}" — cần chuyển sang "Đã ngừng" trước`);
  }

  // 2. Shipment check (carrier liên quan qua field carrierId hoặc fees)
  const relatedShipments = (data.shipments || []).filter(s =>
    s.carrierId === carrierId || (s.fees || []).some(f => f.carrierId === carrierId)
  );
  if (relatedShipments.length > 0) reasons.push(`Còn ${relatedShipments.length} đơn giao hàng liên quan`);

  // 3. FeePayment check
  const relatedFeePay = (data.feePayments || []).filter(fp => fp.carrierId === carrierId);
  if (relatedFeePay.length > 0) reasons.push(`Còn ${relatedFeePay.length} thanh toán phí liên quan`);

  return { allowed: reasons.length === 0, reasons };
};

// 📋 PO: status = Hủy + KHÔNG có Shipment + Payment liên quan trực tiếp
const canHardDeletePO = (poId, data) => {
  const reasons = [];
  const po = (data.pos || []).find(p => p.id === poId);
  if (!po) return { allowed: false, reasons: ["Không tìm thấy PO"] };

  // 1. Status check
  if (po.status !== "Hủy") {
    reasons.push(`PO đang ở trạng thái "${po.status || "Chờ duyệt"}" — cần hủy PO trước (chuyển sang trạng thái "Hủy")`);
  }

  // 2. Shipment check — kể cả Nháp + Hủy (vì xóa cứng PO sẽ làm shipment trỏ tới null)
  const relatedShipments = (data.shipments || []).filter(s =>
    (s.items || []).some(it => it.poId === poId)
  );
  if (relatedShipments.length > 0) {
    reasons.push(`Còn ${relatedShipments.length} đơn giao hàng có item trỏ đến PO này (kể cả Nháp/Hủy)`);
  }

  // 3. Payment liên quan trực tiếp (qua PO id) — phòng trường hợp tương lai có ref poId
  // Hiện app chưa link payment trực tiếp đến PO, chỉ qua factoryId. Skip.

  return { allowed: reasons.length === 0, reasons };
};

// 🚚 Shipment: status = Hủy + KHÔNG có FeePayment
const canHardDeleteShipment = (shipmentId, data) => {
  const reasons = [];
  const shipment = (data.shipments || []).find(s => s.id === shipmentId);
  if (!shipment) return { allowed: false, reasons: ["Không tìm thấy đơn giao hàng"] };

  // 1. Status check
  if (shipment.status !== "Hủy") {
    reasons.push(`Đơn giao hàng đang ở trạng thái "${shipment.status || "Chờ xuất"}" — cần hủy trước`);
  }

  // 2. FeePayment check — kể cả cancelled (vì xóa shipment sẽ làm fp.shipmentId trỏ null)
  const relatedFeePay = (data.feePayments || []).filter(fp => fp.shipmentId === shipmentId);
  if (relatedFeePay.length > 0) {
    reasons.push(`Còn ${relatedFeePay.length} thanh toán phí liên quan đến đơn này`);
  }

  // 3. StockMovements check (nếu shipment đã từng về kho và sinh AUTO movements)
  // AUTO movements được rebuild mỗi save nên xóa shipment = movements tự biến mất.
  // Nhưng nếu có MANUAL movement trỏ đến shipment thì cần check.
  const manualMovementsRef = (data.stockMovements || []).filter(m =>
    m.refType === "shipment_arrive" && m.refId === shipmentId && !String(m.id || "").startsWith("AUTO-")
  );
  if (manualMovementsRef.length > 0) {
    reasons.push(`Còn ${manualMovementsRef.length} bút toán tồn kho thủ công trỏ đến đơn này`);
  }

  return { allowed: reasons.length === 0, reasons };
};

// ============================================================
// v38f: RENAME ID HELPERS — Kiểm tra điều kiện sửa mã PO/Shipment
// ============================================================
// Khác canHardDelete*:
//   - KHÔNG check status (cho sửa mã ở mọi trạng thái)
//   - Bonus check trùng ID nếu newId truyền vào
//
// Nguyên tắc: chỉ cho rename khi entity "sạch" (chưa có data con liên quan).
// Tránh phải cascade update phức tạp + giảm rủi ro broken references.

// 📋 PO: KHÔNG có shipment + KHÔNG có feePayment trỏ đến PO này
const canRenamePO = (poId, data, newId = null) => {
  const reasons = [];
  const po = (data.pos || []).find(p => p.id === poId);
  if (!po) return { allowed: false, reasons: ["Không tìm thấy PO"] };

  // 1. Check trùng ID (nếu newId được truyền vào)
  if (newId !== null && newId !== undefined && newId !== "") {
    const trimmedNewId = String(newId).trim();
    if (trimmedNewId === poId) {
      // Không đổi gì — cho phép (no-op)
    } else if (!trimmedNewId) {
      reasons.push("Mã mới không được để trống");
    } else {
      // Check trùng với PO khác
      const dup = (data.pos || []).find(p => p.id === trimmedNewId && p.id !== poId);
      if (dup) reasons.push(`Mã "${trimmedNewId}" đã được dùng cho PO khác — vui lòng chọn mã khác`);
    }
  }

  // 2. Shipment check — kể cả Nháp + Hủy
  const relatedShipments = (data.shipments || []).filter(s =>
    (s.items || []).some(it => it.poId === poId)
  );
  if (relatedShipments.length > 0) {
    reasons.push(`Còn ${relatedShipments.length} đơn giao hàng có item trỏ đến PO này (kể cả Nháp/Hủy) — không thể đổi mã`);
  }

  // 3. FeePayment check (nếu có field poId trong feePayment — phòng cho tương lai)
  const relatedFeePay = (data.feePayments || []).filter(fp => fp.poId === poId);
  if (relatedFeePay.length > 0) {
    reasons.push(`Còn ${relatedFeePay.length} thanh toán phí liên quan trực tiếp đến PO này`);
  }

  return { allowed: reasons.length === 0, reasons };
};

// 🚚 Shipment: KHÔNG có feePayment + KHÔNG có MANUAL stockMovement trỏ đến
const canRenameShipment = (shipmentId, data, newId = null) => {
  const reasons = [];
  const shipment = (data.shipments || []).find(s => s.id === shipmentId);
  if (!shipment) return { allowed: false, reasons: ["Không tìm thấy đơn giao hàng"] };

  // 1. Check trùng ID
  if (newId !== null && newId !== undefined && newId !== "") {
    const trimmedNewId = String(newId).trim();
    if (trimmedNewId === shipmentId) {
      // Không đổi gì — cho phép (no-op)
    } else if (!trimmedNewId) {
      reasons.push("Mã mới không được để trống");
    } else {
      const dup = (data.shipments || []).find(s => s.id === trimmedNewId && s.id !== shipmentId);
      if (dup) reasons.push(`Mã "${trimmedNewId}" đã được dùng cho đơn giao hàng khác — vui lòng chọn mã khác`);
    }
  }

  // 2. FeePayment check
  const relatedFeePay = (data.feePayments || []).filter(fp => fp.shipmentId === shipmentId);
  if (relatedFeePay.length > 0) {
    reasons.push(`Còn ${relatedFeePay.length} thanh toán phí liên quan đến đơn này`);
  }

  // 3. MANUAL stockMovement check (AUTO movements rebuild được nên không tính)
  const manualMovements = (data.stockMovements || []).filter(m =>
    m.refType === "shipment_arrive" && m.refId === shipmentId && !String(m.id || "").startsWith("AUTO-")
  );
  if (manualMovements.length > 0) {
    reasons.push(`Còn ${manualMovements.length} bút toán tồn kho thủ công trỏ đến đơn này`);
  }

  return { allowed: reasons.length === 0, reasons };
};

// Fee balance: A fee can be paid in multiple installments
// v20: Bỏ qua feePayment đã hủy
const calcFeeBalance = (shipmentId, feeId, feePayments, settings) => {
  const pays = feePayments.filter(p => p.shipmentId === shipmentId && p.feeId === feeId && p.status !== "cancelled");
  const totalPaid = pays.reduce((s, p) => s + toVND(Number(p.amount), p.currency, settings), 0);
  return { totalPaid, count: pays.length };
};

// ============================================================
// v23: STOCK / INVENTORY HELPERS
// ============================================================

// v23: Sinh stockMovements tự động từ shipments + warranties
// Quy ước:
// - Movement auto sẽ có id "AUTO-..." để phân biệt với manual
// - Migration / save sẽ rebuild các AUTO movements để tránh lệch
// - Movements với refType khác "shipment_arrive" / "warranty_*" được giữ nguyên
// v23b: Đọc file xlsx → trả về 2D array (rows of values)
// File có thể có nhiều sheet — lấy sheet đầu tiên
const readXlsxFile = async (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Không đọc được file"));
    reader.readAsArrayBuffer(file);
  });
};

// v23b: Parse CSV text → 2D array (cho Sync URL)
const parseCsvText = (text) => {
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    // Simple CSV parser — handles quoted fields with commas
    const cells = [];
    let cur = "", inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuote = false;
        else cur += ch;
      } else {
        if (ch === '"') inQuote = true;
        else if (ch === ",") { cells.push(cur); cur = ""; }
        else cur += ch;
      }
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
};

// v23b: Tìm column index theo header keywords (case-insensitive, accent-insensitive)
const normalizeHeader = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const findColIndex = (headerRow, candidateHeaders) => {
  const norms = headerRow.map(normalizeHeader);
  for (const cand of candidateHeaders) {
    const candNorm = normalizeHeader(cand);
    const idx = norms.indexOf(candNorm);
    if (idx >= 0) return idx;
  }
  return -1;
};

// ============================================================
// v35: PRODUCT IMPORT FROM EXCEL — helpers + validation
// ============================================================

// v35: Spec mapping cho header → field name. Mỗi key là field nội bộ, value là array các header có thể gặp.
const PRODUCT_IMPORT_SPEC = {
  sku:           ["sku", "ma sku", "ma sp", "ma san pham", "ma"],
  name:          ["ten sp", "ten san pham", "ten sp noi bo", "ten noi bo", "name", "ten"],
  nameImport:    ["ten khai bao nk", "ten khai bao", "ten nk", "name import", "ten hai quan"],
  factoryCode:   ["ma ncc", "ma nha cung cap", "supplier code"],
  factoryName:   ["ten ncc", "ten nha cung cap", "ncc", "factory"],
  unitPrice:     ["gia mua", "gia", "price", "unit price"],
  currency:      ["tien te", "currency", "don vi tien"],
  cost:          ["gia von", "cost", "von"],
  unit:          ["don vi", "unit", "dvt"],
  category:      ["danh muc", "category", "loai"],
  description:   ["mo ta", "description", "ghi chu sp"],
  lengthCm:      ["dai cm", "dai", "length", "length cm"],
  widthCm:       ["rong cm", "rong", "width", "width cm"],
  heightCm:      ["cao cm", "cao", "height", "height cm"],
  qtyPerCarton:  ["sl/thung", "sl thung", "qty per carton", "qty thung", "so luong thung"],
  imageUrl:      ["url anh", "anh", "image url", "image", "link anh"],
};

// v35: Parse rows từ Excel SP — trả về { items, errors } (chưa kiểm tra business logic)
// v36: Enforce giới hạn MAX_PRODUCT_IMPORT_ROWS — báo lỗi sớm nếu file quá to
const parseProductRows = (rows) => {
  if (!rows || rows.length < 2) {
    return { items: [], errors: [{ rowIdx: 0, reason: "File rỗng hoặc không có dữ liệu" }] };
  }
  // v36: Cảnh báo file quá lớn — header + dữ liệu > MAX + 1
  // Đếm dòng dữ liệu thực tế (loại trừ dòng trống) thay vì dùng rows.length thô
  // vì Excel hay có hàng trắng cuối file (XLSX library padding)
  const dataRowCount = rows.slice(1).filter(r => r && r.some(c => String(c || "").trim() !== "")).length;
  if (dataRowCount > MAX_PRODUCT_IMPORT_ROWS) {
    return {
      items: [],
      errors: [{
        rowIdx: 0,
        reason: `File có ${dataRowCount.toLocaleString()} dòng dữ liệu — vượt giới hạn ${MAX_PRODUCT_IMPORT_ROWS.toLocaleString()} dòng/file. Vui lòng chia nhỏ file rồi import nhiều lần.`
      }]
    };
  }
  const headerRow = rows[0];
  const colMap = {};
  for (const [field, candidates] of Object.entries(PRODUCT_IMPORT_SPEC)) {
    colMap[field] = findColIndex(headerRow, candidates);
  }
  if (colMap.sku === -1) {
    return { items: [], errors: [{ rowIdx: 0, reason: "Không tìm thấy cột SKU. Header phải có cột 'SKU' hoặc 'Mã SKU'." }] };
  }
  if (colMap.name === -1) {
    return { items: [], errors: [{ rowIdx: 0, reason: "Không tìm thấy cột Tên SP. Header phải có cột 'Tên SP nội bộ' hoặc 'Tên'." }] };
  }
  if (colMap.factoryCode === -1 && colMap.factoryName === -1) {
    return { items: [], errors: [{ rowIdx: 0, reason: "Phải có ít nhất 1 cột 'Mã NCC' hoặc 'Tên NCC' để xác định nhà cung cấp." }] };
  }
  if (colMap.unitPrice === -1) {
    return { items: [], errors: [{ rowIdx: 0, reason: "Không tìm thấy cột Giá mua." }] };
  }

  const items = [];
  const errors = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(c => String(c || "").trim() === "")) continue;
    const rowIdx = r + 1;
    const get = (field) => {
      const idx = colMap[field];
      if (idx === -1 || idx === undefined) return "";
      return String(row[idx] || "").trim();
    };
    const sku = get("sku");
    const name = get("name");
    const factoryCode = get("factoryCode");
    const factoryName = get("factoryName");
    const priceStr = get("unitPrice");

    if (!sku) { errors.push({ rowIdx, reason: "Thiếu SKU" }); continue; }
    if (!name) { errors.push({ rowIdx, reason: "Thiếu Tên SP" }); continue; }
    if (!factoryCode && !factoryName) { errors.push({ rowIdx, reason: "Thiếu Mã NCC và Tên NCC" }); continue; }
    const unitPrice = parseFloat(priceStr.replace(/[,\s]/g, ""));
    if (priceStr && (isNaN(unitPrice) || unitPrice < 0)) {
      errors.push({ rowIdx, reason: `Giá mua không hợp lệ: "${priceStr}"` });
      continue;
    }

    const parseNum = (s) => {
      if (!s) return "";
      const n = parseFloat(String(s).replace(/[,\s]/g, ""));
      return isNaN(n) ? "" : n;
    };

    items.push({
      rowIdx,
      sku,
      name,
      nameImport: get("nameImport"),
      factoryCode: factoryCode || null,
      factoryName: factoryName || null,
      unitPrice: priceStr ? unitPrice : "",
      currency: get("currency").toUpperCase() || "CNY",
      cost: parseNum(get("cost")),
      unit: get("unit") || "cái",
      category: get("category"),
      description: get("description"),
      lengthCm: parseNum(get("lengthCm")),
      widthCm: parseNum(get("widthCm")),
      heightCm: parseNum(get("heightCm")),
      qtyPerCarton: parseNum(get("qtyPerCarton")),
      imageUrl: get("imageUrl"),
    });
  }
  return { items, errors };
};

// v35: Validate batch — kiểm tra business logic theo mode
const validateProductImportBatch = (items, products, factories, settings, mode) => {
  const validItems = [];
  const invalidItems = [];
  const ALLOWED_CURRENCIES = ["CNY", "VND", "USD", "THB", "MYR", "PHP"];
  const skusInFile = new Set();
  const existingCategories = new Set(settings.productCategories || []);
  const newCategoriesSet = new Set();

  for (const it of items) {
    if (!ALLOWED_CURRENCIES.includes(it.currency)) {
      invalidItems.push({ ...it, status: "error", errorReason: `Tiền tệ không hợp lệ: "${it.currency}". Chỉ chấp nhận: ${ALLOWED_CURRENCIES.join(", ")}` });
      continue;
    }
    if (skusInFile.has(it.sku)) {
      invalidItems.push({ ...it, status: "error", errorReason: `SKU "${it.sku}" trùng lặp trong cùng file (đã có ở dòng trước)` });
      continue;
    }
    skusInFile.add(it.sku);

    let factory = null;
    if (it.factoryCode) factory = factories.find(f => (f.supplierCode || "").toLowerCase() === it.factoryCode.toLowerCase());
    if (!factory && it.factoryName) factory = factories.find(f => (f.name || "").toLowerCase() === it.factoryName.toLowerCase());
    if (!factory) {
      invalidItems.push({
        ...it, status: "error",
        errorReason: `Không tìm thấy NCC ${it.factoryCode ? `mã "${it.factoryCode}"` : ""}${it.factoryName ? ` tên "${it.factoryName}"` : ""}. Vui lòng tạo NCC trước khi import.`
      });
      continue;
    }

    const existingProduct = products.find(p => p.sku === it.sku);
    // v36: Mode upsert — auto-route từng SKU sang create hoặc update
    // - SKU chưa có → effectiveMode = "create" (yêu cầu Giá mua)
    // - SKU đã có → effectiveMode = "update" (cho phép cột trống)
    const effectiveMode = mode === "upsert"
      ? (existingProduct ? "update" : "create")
      : mode;

    if (effectiveMode === "create" && existingProduct && mode === "create") {
      invalidItems.push({ ...it, status: "error", errorReason: `SKU "${it.sku}" đã tồn tại trong hệ thống. Đổi mode sang "Cập nhật" hoặc "Upsert thông minh" để xử lý.` });
      continue;
    }
    if (effectiveMode === "update" && !existingProduct && mode === "update") {
      invalidItems.push({ ...it, status: "error", errorReason: `SKU "${it.sku}" chưa tồn tại trong hệ thống. Đổi mode sang "Tạo mới" hoặc "Upsert thông minh" để xử lý.` });
      continue;
    }

    if (it.category && !existingCategories.has(it.category)) {
      newCategoriesSet.add(it.category);
    }

    if (effectiveMode === "create" && (it.unitPrice === "" || it.unitPrice === null || it.unitPrice === undefined)) {
      invalidItems.push({ ...it, status: "error", errorReason: "Tạo mới phải có Giá mua" });
      continue;
    }

    validItems.push({
      ...it,
      factoryId: factory.id,
      factoryDisplay: factory.name,
      existingProductId: existingProduct?.id || null,
      // v36: status = effectiveMode (cho mode upsert thì biết SP cụ thể là tạo hay update)
      status: effectiveMode,
    });
  }

  return {
    validItems,
    invalidItems,
    newCategoriesToCreate: Array.from(newCategoriesSet),
  };
};

// v23b: Parse rows theo POS_PARSER_SPECS — trả về { items, errors }
// items: [{ sku, quantity, name, note, rowIdx }]
// errors: [{ rowIdx, reason }]
const parseStockRows = (rows, posSystem) => {
  const spec = POS_PARSER_SPECS[posSystem] || POS_PARSER_SPECS.manual;
  if (!rows || rows.length < 2) {
    return { items: [], errors: [{ rowIdx: 0, reason: "File rỗng hoặc không có dữ liệu" }] };
  }
  const headerRow = rows[0];
  const skuIdx = findColIndex(headerRow, spec.skuHeaders);
  const qtyIdx = findColIndex(headerRow, spec.qtyHeaders);
  const nameIdx = spec.nameHeaders ? findColIndex(headerRow, spec.nameHeaders) : -1;
  const noteIdx = spec.noteHeaders ? findColIndex(headerRow, spec.noteHeaders) : -1;

  const errors = [];
  if (skuIdx < 0) errors.push({ rowIdx: 0, reason: `Không tìm thấy cột SKU. Cần 1 trong các cột: ${spec.skuHeaders.join(", ")}` });
  if (qtyIdx < 0) errors.push({ rowIdx: 0, reason: `Không tìm thấy cột số lượng. Cần 1 trong các cột: ${spec.qtyHeaders.join(", ")}` });
  if (errors.length > 0) return { items: [], errors };

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const sku = String(row[skuIdx] || "").trim();
    const qtyRaw = row[qtyIdx];
    const qtyStr = String(qtyRaw || "").trim();

    // Bỏ qua dòng trống hoàn toàn
    if (!sku && !qtyStr) continue;

    if (!sku) {
      errors.push({ rowIdx: i + 1, reason: `Thiếu SKU` });
      continue;
    }
    if (qtyStr === "") {
      errors.push({ rowIdx: i + 1, reason: `Thiếu số lượng (SKU: ${sku})` });
      continue;
    }
    const qty = Number(qtyStr.replace(/,/g, ""));
    if (isNaN(qty)) {
      errors.push({ rowIdx: i + 1, reason: `Số lượng không hợp lệ (SKU: ${sku}, giá trị: "${qtyStr}")` });
      continue;
    }
    if (qty < 0) {
      errors.push({ rowIdx: i + 1, reason: `Số lượng âm (SKU: ${sku}, SL: ${qty})` });
      continue;
    }
    items.push({
      sku,
      quantity: qty,
      name: nameIdx >= 0 ? String(row[nameIdx] || "").trim() : "",
      note: noteIdx >= 0 ? String(row[noteIdx] || "").trim() : "",
      rowIdx: i + 1,
    });
  }
  return { items, errors };
};

// v23b: Map SKU từ phần mềm bán hàng → product CRM
// posSystem = "manual" | "nhanh" | "pancake"
// Manual: match thẳng product.sku
// Nhanh/Pancake: match product.externalSkus[posSystem]
const findProductByExternalSku = (sku, products, posSystem) => {
  if (!sku) return null;
  if (posSystem === "manual") {
    return products.find(p => String(p.sku || "").trim().toLowerCase() === String(sku).trim().toLowerCase()) || null;
  }
  return products.find(p => {
    const ext = (p.externalSkus || {})[posSystem];
    return ext && String(ext).trim().toLowerCase() === String(sku).trim().toLowerCase();
  }) || null;
};

// v23b: Validate batch import — trả về { mappedItems, unmappedErrors }
// mappedItems: [{ sku, quantity, product, name, note, rowIdx }]
// unmappedErrors: [{ rowIdx, sku, reason }]
const validateImportBatch = (parsedItems, products, posSystem) => {
  const mappedItems = [];
  const unmappedErrors = [];
  for (const it of parsedItems) {
    const product = findProductByExternalSku(it.sku, products, posSystem);
    if (!product) {
      unmappedErrors.push({
        rowIdx: it.rowIdx,
        sku: it.sku,
        reason: posSystem === "manual"
          ? `SKU "${it.sku}" không tồn tại trong CRM`
          : `SKU "${it.sku}" chưa được map với SP CRM nào (vào tab Mapping SKU để cấu hình)`,
      });
    } else {
      mappedItems.push({ ...it, product });
    }
  }
  return { mappedItems, unmappedErrors };
};

const rebuildAutoMovements = (shipments, warranties, manualMovements) => {
  const result = [];

  // Giữ lại các movement KHÔNG phải auto (manual + import + sale)
  (manualMovements || []).forEach(m => {
    if (m.refType !== "shipment_arrive" && m.refType !== "warranty_send" && m.refType !== "warranty_return") {
      result.push(m);
    }
  });

  // Auto-sync shipments: shipment "Đã về kho" → IN cho từng item theo warehouseId + receivedQty
  (shipments || []).forEach(s => {
    if (s.status !== "Đã về kho") return;
    const arriveDate = s.actualArriveDate || s.arriveDate || s.departDate || "";
    const wh = s.warehouseId || "";
    if (!wh) return;
    (s.items || []).forEach((it, idx) => {
      const qty = Number(it.receivedQty !== undefined && it.receivedQty !== "" ? it.receivedQty : it.quantity || 0);
      if (qty <= 0) return;
      result.push({
        id: `AUTO-SH-${s.id}-${idx}`,
        date: arriveDate,
        warehouseId: wh,
        productId: it.productId,
        type: "IN",
        source: "shipment_arrive",
        refType: "shipment_arrive",
        refId: s.id,
        quantity: qty,
        status: "active",
        note: `Nhập từ đơn giao hàng ${s.id}`,
      });
    });
  });

  // Auto-sync warranties:
  // - Khi tạo warranty (status != "Hủy"): OUT từ warehouseFromId (hàng tạm rời kho đi BH)
  // - Khi status = "Đã trả về kho": IN lại về warehouseFromId
  // - Khi status = "Hủy": KHÔNG sinh movement nào (coi như chưa từng gửi đi)
  (warranties || []).forEach(w => {
    if (w.status === "Hủy") return;
    const wh = w.warehouseFromId || "";
    if (!wh) return;

    // OUT khi gửi đi
    (w.items || []).forEach((it, idx) => {
      const qty = Number(it.quantity || 0);
      if (qty <= 0) return;
      result.push({
        id: `AUTO-WR-OUT-${w.id}-${idx}`,
        date: w.sendDate || "",
        warehouseId: wh,
        productId: it.productId,
        type: "OUT",
        source: "warranty_send",
        refType: "warranty_send",
        refId: w.id,
        quantity: qty,
        status: "active",
        note: `Gửi NM bảo hành ${w.id}`,
      });
    });

    // IN khi đã trả về kho
    if (w.status === "Đã trả về kho") {
      (w.items || []).forEach((it, idx) => {
        const qty = Number(it.quantity || 0);
        if (qty <= 0) return;
        result.push({
          id: `AUTO-WR-IN-${w.id}-${idx}`,
          date: w.returnDate || w.sendDate || "",
          warehouseId: wh,
          productId: it.productId,
          type: "IN",
          source: "warranty_return",
          refType: "warranty_return",
          refId: w.id,
          quantity: qty,
          status: "active",
          note: `Nhận BH về kho từ ${w.id}`,
        });
      });
    }
  });

  return result;
};

// Tính tồn kho hiện tại cho 1 cặp (productId, warehouseId)
// = Đầu kỳ (active) + Σ IN active − Σ OUT active
const calcStockOnHand = (productId, warehouseId, openingStock, stockMovements) => {
  const opening = (openingStock || [])
    .filter(o => o.productId === productId && o.warehouseId === warehouseId && o.status !== "cancelled")
    .reduce((s, o) => s + Number(o.quantity || 0), 0);
  const totalIn = (stockMovements || [])
    .filter(m => m.productId === productId && m.warehouseId === warehouseId && m.type === "IN" && m.status !== "cancelled")
    .reduce((s, m) => s + Number(m.quantity || 0), 0);
  const totalOut = (stockMovements || [])
    .filter(m => m.productId === productId && m.warehouseId === warehouseId && m.type === "OUT" && m.status !== "cancelled")
    .reduce((s, m) => s + Number(m.quantity || 0), 0);
  return { opening, totalIn, totalOut, onHand: opening + totalIn - totalOut };
};

// Tính tồn kho cho 1 cặp (productId, warehouseId) trong 1 khoảng kỳ
// "Đầu kỳ" = tồn tại thời điểm dateFrom; "Nhập kỳ" / "Xuất kỳ" = trong khoảng [from, to]; "Tồn hiện tại" = đầu kỳ + nhập kỳ - xuất kỳ
const calcStockInPeriod = (productId, warehouseId, openingStock, stockMovements, dateFrom, dateTo) => {
  const allMovements = (stockMovements || [])
    .filter(m => m.productId === productId && m.warehouseId === warehouseId && m.status !== "cancelled");
  const allOpenings = (openingStock || [])
    .filter(o => o.productId === productId && o.warehouseId === warehouseId && o.status !== "cancelled");

  // Nếu không có filter ngày → trả về tổng cumulative
  if (!dateFrom && !dateTo) {
    const opening = allOpenings.reduce((s, o) => s + Number(o.quantity || 0), 0);
    const totalIn = allMovements.filter(m => m.type === "IN").reduce((s, m) => s + Number(m.quantity || 0), 0);
    const totalOut = allMovements.filter(m => m.type === "OUT").reduce((s, m) => s + Number(m.quantity || 0), 0);
    return { opening, totalIn, totalOut, onHand: opening + totalIn - totalOut };
  }

  // Có filter ngày: tính đầu kỳ là tồn tới ngay TRƯỚC dateFrom
  // Đầu kỳ = (Tổng opening trước/đúng ngày dateFrom) + (IN trước dateFrom) − (OUT trước dateFrom)
  const openingBeforeFrom = allOpenings
    .filter(o => !dateFrom || (o.date || "") < dateFrom)
    .reduce((s, o) => s + Number(o.quantity || 0), 0);
  const inBeforeFrom = allMovements
    .filter(m => m.type === "IN" && (!dateFrom || (m.date || "") < dateFrom))
    .reduce((s, m) => s + Number(m.quantity || 0), 0);
  const outBeforeFrom = allMovements
    .filter(m => m.type === "OUT" && (!dateFrom || (m.date || "") < dateFrom))
    .reduce((s, m) => s + Number(m.quantity || 0), 0);
  const opening = openingBeforeFrom + inBeforeFrom - outBeforeFrom;

  // Trong kỳ [dateFrom, dateTo]
  const inRange = (d) => {
    if (!d) return false;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };
  // Opening sinh trong kỳ → tính như IN trong kỳ
  const openingInPeriod = allOpenings
    .filter(o => inRange(o.date))
    .reduce((s, o) => s + Number(o.quantity || 0), 0);
  const totalIn = openingInPeriod + allMovements
    .filter(m => m.type === "IN" && inRange(m.date))
    .reduce((s, m) => s + Number(m.quantity || 0), 0);
  const totalOut = allMovements
    .filter(m => m.type === "OUT" && inRange(m.date))
    .reduce((s, m) => s + Number(m.quantity || 0), 0);

  return { opening, totalIn, totalOut, onHand: opening + totalIn - totalOut };
};

// Lấy ngưỡng cảnh báo cho 1 cặp (productId, warehouseId)
// product.warehouseThresholds = { [warehouseId]: number } — mặc định 0 nếu chưa cấu hình
const getStockThreshold = (product, warehouseId) => {
  if (!product || !product.warehouseThresholds) return 0;
  const v = product.warehouseThresholds[warehouseId];
  return v !== undefined && v !== null && !isNaN(Number(v)) ? Number(v) : 0;
};

// Phân loại trạng thái tồn kho — 3 trạng thái
const classifyStockStatus = (onHand, threshold) => {
  if (onHand <= 0) return "negative"; // 🔴 Âm hoặc bằng 0
  if (threshold > 0 && onHand < threshold) return "low"; // ⚠ Dưới ngưỡng
  return "normal"; // ✅ Bình thường
};

const STOCK_STATUS_LABELS = {
  negative: "🔴 Âm",
  low: "⚠ Dưới ngưỡng",
  normal: "✅ Bình thường",
};

const filterByDateRange = (items, dateKey, from, to) => {
  return items.filter(x => {
    const d = x[dateKey];
    if (!d) return true;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
};

// v38b: Sort danh sách theo ngày nghiệp vụ desc (mới nhất trên đầu).
// Tie-break: ID lớn hơn lên trên (vì ID chứa Date.now() — ID lớn = tạo sau).
// Null-safe: records không có ngày → đẩy xuống CUỐI list.
// dateField: tên field chứa ngày nghiệp vụ ("orderDate" / "departDate" / "sendDate" / "payDate" / "date" / "timestamp")
// idField: tên field ID (default "id"). Set null nếu không có ID.
const sortByDateDesc = (arr, dateField, idField = "id") => {
  if (!Array.isArray(arr)) return [];
  return arr.slice().sort((a, b) => {
    const da = a?.[dateField] || "";
    const db = b?.[dateField] || "";
    // Null-safe: record không có ngày → xuống cuối
    if (!da && !db) {
      // Cả 2 đều null → so ID
      if (idField) return String(b?.[idField] || "").localeCompare(String(a?.[idField] || ""));
      return 0;
    }
    if (!da) return 1;  // a không có ngày → a xuống dưới
    if (!db) return -1; // b không có ngày → b xuống dưới
    // Cả 2 có ngày → so ngày desc
    if (da !== db) return db.localeCompare(da);
    // Cùng ngày → so ID desc (ID lớn = nhập sau → trên)
    if (idField) return String(b?.[idField] || "").localeCompare(String(a?.[idField] || ""));
    return 0;
  });
};

// v10: Warehouse helpers
const getAllWarehouses = (markets) => {
  const out = [];
  (markets || []).forEach(m => (m.warehouses || []).forEach(w => out.push({ ...w, marketName: m.name, marketId: m.id })));
  return out;
};
const getWarehouseName = (warehouseId, markets) => {
  for (const m of (markets || [])) {
    const w = (m.warehouses || []).find(w => w.id === warehouseId);
    if (w) return `${getFlag(m.name)} ${m.name} - ${w.name}`;
  }
  return "—";
};
const getMarketWarehouses = (marketName, markets) => {
  const m = (markets || []).find(x => x.name === marketName);
  return (m?.warehouses || []);
};

// v12: Lấy kho mặc định của 1 thị trường (dùng khi tạo shipment mới, auto-arrive, ...)
// Quy tắc: (1) Kho có isDefault=true; (2) Nếu không có, lấy kho đầu tiên; (3) Nếu không có kho, trả "".
const getDefaultWarehouseId = (marketName, markets) => {
  const whs = getMarketWarehouses(marketName, markets);
  if (whs.length === 0) return "";
  const defaultWh = whs.find(w => w.isDefault);
  return (defaultWh || whs[0]).id;
};

// v12: Đếm số shipment đang dùng 1 warehouse (dùng khi xóa kho để cảnh báo)
const countShipmentsUsingWarehouse = (warehouseId, shipments) => {
  if (!warehouseId) return 0;
  return (shipments || []).filter(s => s.warehouseId === warehouseId).length;
};

// v10: Auto-gen mã NCC
const nextSupplierCode = (factories) => {
  const nums = (factories || []).map(f => {
    const m = String(f.supplierCode || "").match(/^NCC-(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
  });
  const max = nums.length ? Math.max(...nums) : 0;
  return `NCC-${String(max + 1).padStart(3, "0")}`;
};

// v10: So sánh thứ tự shipment status (forward only)
const shipmentStatusIndex = (status) => SHIPMENT_STATUS_ORDER.indexOf(status);
const canMoveShipmentTo = (currentStatus, newStatus) => {
  // v20: Cho phép hủy ở MỌI trạng thái (trừ đã hủy)
  if (newStatus === "Hủy") return currentStatus !== "Hủy";
  if (currentStatus === "Hủy") return false; // không hồi sinh từ Hủy
  const iCur = shipmentStatusIndex(currentStatus);
  const iNew = shipmentStatusIndex(newStatus);
  if (iCur < 0 || iNew < 0) return false;
  return iNew >= iCur; // chỉ cho tiến tới
};

// v11: Thể tích sản phẩm (cm³ và m³)
const productVolumeCm3 = (p) => {
  const l = Number(p?.lengthCm || 0), w = Number(p?.widthCm || 0), h = Number(p?.heightCm || 0);
  return l * w * h;
};
const cm3ToM3 = (cm3) => cm3 / 1_000_000;

// v11: Tính tổng CBM cho 1 shipment (dựa vào products)
const shipmentTotalCBM = (shipment, pos, products) => {
  let cm3 = 0;
  (shipment?.items || []).forEach(it => {
    const po = pos.find(p => p.id === it.poId);
    if (!po) return;
    const poItems = getPOItems(po);
    const poItem = po.items ? poItems.find(x => x.id === it.itemId) : poItems[0];
    const prod = products.find(x => x.id === poItem?.productId);
    if (!prod) return;
    cm3 += Number(it.quantity || 0) * productVolumeCm3(prod);
  });
  return cm3ToM3(cm3);
};

// v11: Carrier helpers
const getCarrier = (carrierId, carriers) => (carriers || []).find(c => c.id === carrierId);
const getCarrierName = (carrierId, carriers) => {
  const c = getCarrier(carrierId, carriers);
  return c ? c.name : "";
};

// v12: Xuất báo cáo kế toán đối soát với NCC — dùng SpreadsheetML XML (.xls)
// Lý do không dùng SheetJS: CDN bị chặn trong artifact sandbox, download cũng bị chặn với thư viện ngoài.
// Cách làm: Tự build XML theo chuẩn SpreadsheetML 2003 của Microsoft → nhiều sheet trong 1 file, mở được bằng Excel/Google Sheets.

// Escape XML entities trong value
const xmlEscape = (v) => {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

// Build 1 cell XML: tự detect Number vs String
const xmlCell = (val, opts = {}) => {
  const { styleId, formula, forceString } = opts;
  const attrs = [];
  if (styleId) attrs.push(`ss:StyleID="${styleId}"`);
  if (formula) attrs.push(`ss:Formula="${xmlEscape(formula)}"`);
  const attrStr = attrs.length ? " " + attrs.join(" ") : "";

  if (val === null || val === undefined || val === "") {
    return `<Cell${attrStr}/>`;
  }
  const isNum = !forceString && typeof val === "number" && Number.isFinite(val);
  if (isNum) {
    return `<Cell${attrStr}><Data ss:Type="Number">${val}</Data></Cell>`;
  }
  return `<Cell${attrStr}><Data ss:Type="String">${xmlEscape(val)}</Data></Cell>`;
};

// Build 1 row: rowData = array of values HOẶC array of {value, style, mergeAcross}
const xmlRow = (cells) => {
  const cellStr = cells.map(c => {
    if (c && typeof c === "object" && !Array.isArray(c) && "value" in c) {
      let cellXml = xmlCell(c.value, { styleId: c.style, forceString: c.forceString });
      if (c.mergeAcross) {
        cellXml = cellXml.replace("<Cell", `<Cell ss:MergeAcross="${c.mergeAcross}"`);
      }
      return cellXml;
    }
    return xmlCell(c);
  }).join("");
  return `<Row>${cellStr}</Row>`;
};

// Build 1 worksheet
const xmlWorksheet = (name, rows, colWidths = []) => {
  const colsXml = colWidths.map(w => `<Column ss:Width="${w}"/>`).join("");
  const rowsXml = rows.map(r => xmlRow(r)).join("\n");
  // Tên sheet trong XML không được chứa: \ / ? * [ ] và không dài quá 31 ký tự
  const safeName = xmlEscape(name.replace(/[\\/?*[\]]/g, "_").slice(0, 31));
  return `<Worksheet ss:Name="${safeName}"><Table>${colsXml}${rowsXml}</Table></Worksheet>`;
};

// Styles dùng chung cho toàn bộ workbook
const XLS_STYLES = `
<Styles>
 <Style ss:ID="Default" ss:Name="Normal">
  <Font ss:FontName="Calibri" ss:Size="11"/>
  <Alignment ss:Vertical="Center"/>
 </Style>
 <Style ss:ID="sTitle">
  <Font ss:FontName="Calibri" ss:Size="16" ss:Bold="1" ss:Color="#1F5E1F"/>
  <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
 </Style>
 <Style ss:ID="sSubtitle">
  <Font ss:FontName="Calibri" ss:Size="11" ss:Italic="1" ss:Color="#5A6D5A"/>
 </Style>
 <Style ss:ID="sHeader">
  <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
  <Interior ss:Color="#3E8E3E" ss:Pattern="Solid"/>
  <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
  <Borders>
   <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
   <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
   <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
   <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
  </Borders>
 </Style>
 <Style ss:ID="sLabel">
  <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1"/>
  <Interior ss:Color="#E8F3E8" ss:Pattern="Solid"/>
  <Borders>
   <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D4E0D4"/>
   <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D4E0D4"/>
   <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D4E0D4"/>
  </Borders>
 </Style>
 <Style ss:ID="sCell">
  <Borders>
   <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D4E0D4"/>
   <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D4E0D4"/>
   <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D4E0D4"/>
  </Borders>
 </Style>
 <Style ss:ID="sCellNum">
  <NumberFormat ss:Format="#,##0"/>
  <Alignment ss:Horizontal="Right"/>
  <Borders>
   <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D4E0D4"/>
   <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D4E0D4"/>
   <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D4E0D4"/>
  </Borders>
 </Style>
 <Style ss:ID="sTotal">
  <Font ss:FontName="Calibri" ss:Size="12" ss:Bold="1" ss:Color="#FFFFFF"/>
  <Interior ss:Color="#1F5E1F" ss:Pattern="Solid"/>
  <NumberFormat ss:Format="#,##0"/>
  <Alignment ss:Horizontal="Right"/>
 </Style>
 <Style ss:ID="sTotalLabel">
  <Font ss:FontName="Calibri" ss:Size="12" ss:Bold="1" ss:Color="#FFFFFF"/>
  <Interior ss:Color="#1F5E1F" ss:Pattern="Solid"/>
 </Style>
 <Style ss:ID="sRed">
  <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#C0392B"/>
  <NumberFormat ss:Format="#,##0"/>
  <Alignment ss:Horizontal="Right"/>
 </Style>
 <Style ss:ID="sGreen">
  <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#1F5E1F"/>
  <NumberFormat ss:Format="#,##0"/>
  <Alignment ss:Horizontal="Right"/>
 </Style>
 <Style ss:ID="sSection">
  <Font ss:FontName="Calibri" ss:Size="13" ss:Bold="1" ss:Color="#FFFFFF"/>
  <Interior ss:Color="#2F7A2F" ss:Pattern="Solid"/>
  <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
 </Style>
</Styles>
`;

// Tải xuống file .xls bằng blob + anchor download (phương pháp chuẩn, hoạt động trong mọi sandbox cho phép blob URL)
const downloadXlsFile = (xmlContent, filename) => {
  // BOM UTF-8 để Excel nhận đúng tiếng Việt
  const bom = "\uFEFF";
  const fullXml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
${XLS_STYLES}
${xmlContent}
</Workbook>`;

  const blob = new Blob([bom + fullXml], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
};

const exportAccountingReport = async ({ factory, pos, shipments, payments, feePayments, openingBalances, products, carriers, markets, dateFrom, dateTo, settings, exportedBy }) => {
  // Lọc data theo factory + kỳ
  const inRange = (d) => {
    if (!d) return true;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };

  const currency = factory.currency || "CNY";
  const rateKey = `${currency.toLowerCase()}ToVnd`;
  const rate = settings[rateKey] || settings.cnyToVnd || 1;

  const factoryPOs = pos.filter(p => p.factoryId === factory.id && p.status !== "Hủy" && inRange(p.orderDate));
  const factoryShipments = shipments.filter(s => {
    // v26: Loại trừ cả Hủy + Nháp khỏi báo cáo NCC
    if (!isOperationalShipment(s)) return false;
    return (s.items || []).some(it => factoryPOs.some(p => p.id === it.poId)) && inRange(s.departDate);
  });
  // v20: Loại trừ payment + opening đã hủy trong báo cáo
  const factoryPayments = payments.filter(p => {
    if (p.status === "cancelled") return false;
    if (p.toFactoryId !== factory.id && p.fromFactoryId !== factory.id) return false;
    return inRange(p.payDate);
  });
  const factoryOpenings = openingBalances.filter(o => o.factoryId === factory.id && o.status !== "cancelled");

  // === Tính số tổng hợp ===
  const openingDebt = factoryOpenings.filter(o => o.type === "debt").reduce((s, o) => s + Number(o.amount || 0), 0);
  const openingCredit = factoryOpenings.filter(o => o.type === "credit").reduce((s, o) => s + Number(o.amount || 0), 0);

  // v15: Hàng đã SHIP trong kỳ — khớp với chính sách kế toán (công nợ phát sinh khi NCC giao hàng đi)
  // Dùng `it.quantity` (SL ship), không phụ thuộc trạng thái "Đã về kho"
  let periodShippedValue = 0;
  let periodReceivedValue = 0; // Riêng — tham chiếu cho kế toán đối chiếu hao hụt
  factoryShipments.forEach(s => {
    const isArrived = s.status === "Đã về kho";
    (s.items || []).forEach(it => {
      const po = factoryPOs.find(p => p.id === it.poId);
      if (!po) return;
      const poItems = getPOItems(po);
      const poItem = po.items ? poItems.find(x => x.id === it.itemId) : poItems[0];
      const unitPrice = Number(poItem?.unitPrice || 0);
      const shippedQty = Number(it.quantity || 0);
      const receivedQty = isArrived ? Number(it.receivedQty ?? shippedQty) : 0;
      periodShippedValue += shippedQty * unitPrice;
      periodReceivedValue += receivedQty * unitPrice;
    });
  });

  // v15: Thanh toán trong kỳ — quy đổi sang tiền tệ NCC (mặc định CNY)
  // Trước: cộng thẳng p.amount → sai khi payment khác CNY
  const factoryCurrency = factory.currency || "CNY";
  const convertPay = (p) => paymentToFactoryCurrency(p, factoryCurrency, settings);
  // v38: Tách payment theo stage. CHỈ stage "completed" mới tính vào netPaid (giảm công nợ).
  // Stage 1+2 → pendingPaid (treo, chưa giảm).
  // INTER_FACTORY luôn coi là completed.
  const isCompletedStage = (p) => p.type === "INTER_FACTORY" || (p.paymentStage || "completed") === "completed";

  const marketToFactoryIn = factoryPayments
    .filter(p => p.type === "MARKET_TO_FACTORY" && p.toFactoryId === factory.id && isCompletedStage(p))
    .reduce((s, p) => s + convertPay(p), 0);
  const interFactoryIn = factoryPayments
    .filter(p => p.type === "INTER_FACTORY" && p.toFactoryId === factory.id)
    .reduce((s, p) => s + convertPay(p), 0);
  const interFactoryOut = factoryPayments
    .filter(p => p.type === "INTER_FACTORY" && p.fromFactoryId === factory.id)
    .reduce((s, p) => s + convertPay(p), 0);
  // v38: Đang TT (stage 1+2) — chỉ MARKET_TO_FACTORY có stage này
  const pendingPaid = factoryPayments
    .filter(p => p.type === "MARKET_TO_FACTORY" && p.toFactoryId === factory.id && !isCompletedStage(p))
    .reduce((s, p) => s + convertPay(p), 0);
  const netPaid = marketToFactoryIn + interFactoryIn - interFactoryOut;

  // v15 + v38: Công nợ tính trên "đã ship" — chỉ trừ stage Hoàn tất, KHÔNG trừ Đang TT
  const closingOwed = Math.max(0, openingDebt + periodShippedValue - openingCredit - netPaid);
  const closingCredit = Math.max(0, openingCredit + netPaid - openingDebt - periodShippedValue);

  // === SHEET 1: TỔNG HỢP ĐỐI SOÁT ===
  const s1Rows = [];
  s1Rows.push([{ value: "BÁO CÁO ĐỐI SOÁT CÔNG NỢ", style: "sTitle", mergeAcross: 3 }]);
  s1Rows.push([]);
  s1Rows.push([
    { value: "Nhà cung cấp:", style: "sLabel" },
    { value: factory.name, style: "sCell", mergeAcross: 2 },
  ]);
  s1Rows.push([
    { value: "Mã NCC:", style: "sLabel" },
    { value: factory.supplierCode || "-", style: "sCell", mergeAcross: 2 },
  ]);
  s1Rows.push([
    { value: "Quốc gia:", style: "sLabel" },
    { value: factory.country || "-", style: "sCell", mergeAcross: 2 },
  ]);
  s1Rows.push([
    { value: "Người liên hệ:", style: "sLabel" },
    { value: `${factory.contactPerson || factory.contact || "-"} · ${factory.phone || ""} · ${factory.email || ""}`, style: "sCell", mergeAcross: 2 },
  ]);
  s1Rows.push([
    { value: "Thông tin ngân hàng:", style: "sLabel" },
    { value: factory.bankInfo || "-", style: "sCell", mergeAcross: 2 },
  ]);
  s1Rows.push([
    { value: "Tiền tệ:", style: "sLabel" },
    { value: currency, style: "sCell" },
    { value: "Tỷ giá áp dụng:", style: "sLabel" },
    { value: `1 ${currency} = ${rate.toLocaleString("vi-VN")} VND`, style: "sCell" },
  ]);
  s1Rows.push([
    { value: "Kỳ báo cáo:", style: "sLabel" },
    { value: `Từ ${dateFrom || "(không giới hạn)"} đến ${dateTo || "(hôm nay)"}`, style: "sCell", mergeAcross: 2 },
  ]);
  s1Rows.push([
    { value: "Người xuất:", style: "sLabel" },
    { value: exportedBy || "-", style: "sCell" },
    { value: "Ngày xuất:", style: "sLabel" },
    { value: new Date().toLocaleString("vi-VN"), style: "sCell" },
  ]);
  s1Rows.push([]);
  s1Rows.push([{ value: "BẢNG CÔNG NỢ", style: "sSection", mergeAcross: 3 }]);
  s1Rows.push([
    { value: "KHOẢN MỤC", style: "sHeader" },
    { value: `Số tiền (${currency})`, style: "sHeader" },
    { value: "Quy đổi VND", style: "sHeader" },
    { value: "Ghi chú", style: "sHeader" },
  ]);

  const pushMoneyRow = (label, amount, note = "", isTotal = false) => {
    const styleLabel = isTotal ? "sTotalLabel" : "sLabel";
    const styleNum = isTotal ? "sTotal" : "sCellNum";
    s1Rows.push([
      { value: label, style: styleLabel },
      { value: Math.round(amount), style: styleNum },
      { value: Math.round(amount * rate), style: styleNum },
      { value: note, style: "sCell" },
    ]);
  };

  pushMoneyRow("(1) Nợ đầu kỳ", openingDebt, "Công nợ chuyển sang từ kỳ trước");
  pushMoneyRow("(2) Quỹ tín dụng đầu kỳ", openingCredit, "Số dư có lợi cho công ty");
  pushMoneyRow("(3) Hàng đã ship trong kỳ", periodShippedValue, "Tổng giá trị NCC giao đi (đang VC + đã về kho) — phát sinh công nợ");
  pushMoneyRow("(4) Tham chiếu — Hàng đã NHẬN về kho", periodReceivedValue, "Để đối chiếu hao hụt với (3)");
  pushMoneyRow("(5) ✅ Thanh toán: Thị trường → NCC (chỉ stage Hoàn tất)", marketToFactoryIn, `v38: chỉ payment đã hoàn tất. Stage 1+2 xem dòng (5b)`);
  // v38: Dòng mới cho Đang TT
  pushMoneyRow("(5b) 🟡 Đang TT (stage 🏦 + 🌐) — chưa giảm công nợ", pendingPaid, "Tiền GoChek đã chuyển nhưng NCC chưa nhận — không trừ vào nợ");
  pushMoneyRow("(6) Thanh toán: Liên NM — vào (NCC khác trả hộ)", interFactoryIn, "Chuyển nợ từ NCC khác sang");
  pushMoneyRow("(7) Thanh toán: Liên NM — ra (NCC này trả hộ)", interFactoryOut, "NCC này trả hộ NCC khác");
  pushMoneyRow("(8) Thanh toán ròng = (5)+(6)−(7)", netPaid, "Chỉ tính stage Hoàn tất ✅");
  s1Rows.push([]);
  pushMoneyRow("NỢ CUỐI KỲ", closingOwed, "(1) + (3) − (2) − (8). KHÔNG trừ (5b) Đang TT.", true);
  pushMoneyRow("QUỸ TÍN DỤNG CUỐI KỲ", closingCredit, "Nếu đã trả dư", true);

  const sheet1 = xmlWorksheet("Tổng hợp đối soát", s1Rows, [220, 140, 140, 260]);

  // === SHEET 2: CHI TIẾT PO ===
  const s2Rows = [];
  s2Rows.push([{ value: `CHI TIẾT ĐƠN ĐẶT HÀNG — ${factory.name}`, style: "sTitle", mergeAcross: 14 }]);
  s2Rows.push([]);
  // v13: Bỏ cột "Đã SX" — không còn tracking sản xuất
  const s2Headers = ["Mã PO", "Ngày đặt", "Hạn HT", "Trạng thái", "Duyệt", "SKU", "Tên sản phẩm", "ĐVT", "SL đặt", "Đã ship", "Đã về kho", "Đơn giá", "Thành tiền", "Tiền tệ", "Ghi chú"];
  s2Rows.push(s2Headers.map(h => ({ value: h, style: "sHeader" })));

  let s2TotalValue = 0;
  // v38c: Sort PO theo orderDate desc (mới nhất trên đầu, tie-break ID)
  sortByDateDesc(factoryPOs, "orderDate", "id").forEach(p => {
    const items = getPOItems(p);
    items.forEach((it, idx) => {
      const prod = products.find(x => x.id === it.productId);
      const shipped = p.items ? shippedFromItem(p.id, it.id, shipments) : shippedFromPO(p.id, shipments);
      // Tính đã về kho (chỉ tính shipment status = Đã về kho)
      const arrived = shipments
        .filter(s => s.status === "Đã về kho")
        .flatMap(s => s.items || [])
        .filter(i => i.poId === p.id && (p.items ? i.itemId === it.id : true))
        .reduce((sum, i) => sum + Number(i.receivedQty ?? i.quantity ?? 0), 0);
      const lineValue = Number(it.quantity || 0) * Number(it.unitPrice || 0);
      s2TotalValue += lineValue;
      s2Rows.push([
        { value: idx === 0 ? p.id : "", style: "sCell" },
        { value: idx === 0 ? p.orderDate : "", style: "sCell" },
        { value: idx === 0 ? (p.expectedDate || "") : "", style: "sCell" },
        { value: idx === 0 ? p.status : "", style: "sCell" },
        { value: idx === 0 ? (p.approved ? "Đã duyệt" : "Chờ") : "", style: "sCell" },
        { value: prod?.sku || "", style: "sCell" },
        { value: prod?.name || "", style: "sCell" },
        { value: prod?.unit || "", style: "sCell" },
        { value: Number(it.quantity || 0), style: "sCellNum" },
        { value: shipped, style: "sCellNum" },
        { value: arrived, style: "sCellNum" },
        { value: Number(it.unitPrice || 0), style: "sCellNum" },
        { value: Math.round(lineValue), style: "sCellNum" },
        { value: p.currency, style: "sCell" },
        { value: idx === 0 ? (p.note || "") : "", style: "sCell" },
      ]);
    });
  });
  if (factoryPOs.length === 0) {
    s2Rows.push([{ value: "(Không có PO nào trong kỳ)", style: "sSubtitle", mergeAcross: 14 }]);
  } else {
    s2Rows.push([
      { value: "TỔNG CỘNG", style: "sTotalLabel", mergeAcross: 11 },
      { value: "", style: "sTotal" },
      { value: Math.round(s2TotalValue), style: "sTotal" },
      { value: currency, style: "sTotalLabel" },
      { value: "", style: "sTotalLabel" },
    ]);
  }
  const sheet2 = xmlWorksheet("Chi tiết PO", s2Rows, [110, 75, 75, 95, 65, 80, 180, 55, 60, 60, 70, 70, 90, 55, 140]);

  // === SHEET 3: CHI TIẾT LÔ GIAO HÀNG ===
  const s3Rows = [];
  s3Rows.push([{ value: `CHI TIẾT LÔ GIAO HÀNG — ${factory.name}`, style: "sTitle", mergeAcross: 17 }]);
  s3Rows.push([]);
  const s3Headers = ["Mã đơn giao hàng", "Thị trường", "Kho nhận", "Đơn vị VC", "Tracking", "Ngày xuất", "Ngày nhận TT", "Trạng thái", "Số kiện", "Mã PO", "SKU", "SL giao", "SL nhận", "Chênh", "Xử lý chênh", "Đơn giá", "Thành tiền", "Tiền tệ"];
  s3Rows.push(s3Headers.map(h => ({ value: h, style: "sHeader" })));

  let s3TotalValue = 0;
  // v38c: Sort shipment theo departDate desc
  sortByDateDesc(factoryShipments, "departDate", "id").forEach(s => {
    const carrier = carriers?.find(c => c.id === s.carrierId);
    const whName = s.warehouseId ? (getWarehouseName(s.warehouseId, markets) || "") : "";
    (s.items || []).forEach((it, idx) => {
      const po = factoryPOs.find(p => p.id === it.poId);
      if (!po) return;
      const poItems = getPOItems(po);
      const poItem = po.items ? poItems.find(x => x.id === it.itemId) : poItems[0];
      const prod = products.find(x => x.id === poItem?.productId);
      const shippedQty = Number(it.quantity || 0);
      const receivedQty = s.status === "Đã về kho" ? Number(it.receivedQty ?? shippedQty) : shippedQty;
      const diff = shippedQty - receivedQty;
      const unitPrice = Number(poItem?.unitPrice || 0);
      const lineValue = shippedQty * unitPrice;
      s3TotalValue += lineValue;
      s3Rows.push([
        { value: idx === 0 ? s.id : "", style: "sCell" },
        { value: idx === 0 ? (s.market || "") : "", style: "sCell" },
        { value: idx === 0 ? whName : "", style: "sCell" },
        { value: idx === 0 ? (carrier?.name || s.carrier || "") : "", style: "sCell" },
        { value: idx === 0 ? (s.trackingNo || "") : "", style: "sCell" },
        { value: idx === 0 ? (s.departDate || "") : "", style: "sCell" },
        { value: idx === 0 ? (s.actualArriveDate || s.arriveDate || "") : "", style: "sCell" },
        { value: idx === 0 ? s.status : "", style: "sCell" },
        { value: idx === 0 ? Number(s.packages || 0) : "", style: "sCellNum" },
        { value: it.poId, style: "sCell" },
        { value: prod?.sku || "", style: "sCell" },
        { value: shippedQty, style: "sCellNum" },
        { value: receivedQty, style: "sCellNum" },
        { value: diff, style: diff > 0 ? "sRed" : "sCellNum" },
        { value: it.diffHandling || "", style: "sCell" },
        { value: unitPrice, style: "sCellNum" },
        { value: Math.round(lineValue), style: "sCellNum" },
        { value: po.currency, style: "sCell" },
      ]);
    });
  });
  if (factoryShipments.length === 0) {
    s3Rows.push([{ value: "(Không có đơn giao hàng nào trong kỳ)", style: "sSubtitle", mergeAcross: 17 }]);
  } else {
    s3Rows.push([
      { value: "TỔNG CỘNG", style: "sTotalLabel", mergeAcross: 15 },
      { value: "", style: "sTotal" },
      { value: Math.round(s3TotalValue), style: "sTotal" },
      { value: currency, style: "sTotalLabel" },
    ]);
  }
  const sheet3 = xmlWorksheet("Chi tiết đơn giao hàng", s3Rows, [110, 85, 140, 110, 110, 75, 75, 100, 60, 110, 80, 60, 60, 55, 95, 70, 90, 55]);

  // === SHEET 4: LỊCH SỬ THANH TOÁN ===
  const s4Rows = [];
  s4Rows.push([{ value: `LỊCH SỬ THANH TOÁN — ${factory.name}`, style: "sTitle", mergeAcross: 10 }]);
  s4Rows.push([]);
  // v38: Thêm cột "Stage" giữa "Tỷ giá" và "Tương đương CNY"
  const s4Headers = ["Mã TT", "Ngày", "Loại giao dịch", "Đối tác", "Số tiền", "Tiền tệ", "Tỷ giá", "Stage", "Tương đương CNY", "Tương đương VND", "Ghi chú"];
  s4Rows.push(s4Headers.map(h => ({ value: h, style: "sHeader" })));

  let s4TotalIn = 0, s4TotalOut = 0;
  // v38: Tổng theo stage để hiển thị ở cuối sheet
  let s4PendingIn = 0, s4PendingOut = 0;
  // v38c: Sort payment theo payDate desc (mới nhất trên đầu, tie-break ID)
  sortByDateDesc(factoryPayments, "payDate", "id").forEach(p => {
    const isToThis = p.toFactoryId === factory.id;
    const payRate = settings[`${p.currency.toLowerCase()}ToVnd`] || settings.cnyToVnd || 1;
    const vnd = Number(p.amount || 0) * payRate;
    const cny = vnd / (settings.cnyToVnd || 1);
    let loaiGd = "";
    let partner = "";
    if (isToThis && p.type === "MARKET_TO_FACTORY") {
      loaiGd = "Thị trường → NCC (vào)";
      partner = p.fromMarket || "-";
      s4TotalIn += cny;
    } else if (isToThis && p.type === "INTER_FACTORY") {
      loaiGd = "Liên NM — vào";
      const fromFac = factoryPOs[0] ? null : null; // placeholder
      partner = "NCC khác trả hộ"; // sẽ resolve bằng factories bên ngoài, xem bên dưới
      s4TotalIn += cny;
    } else if (!isToThis && p.type === "INTER_FACTORY") {
      loaiGd = "Liên NM — ra (trả hộ NCC khác)";
      partner = "Trả hộ NCC khác";
      s4TotalOut += cny;
    }
    // v38: Stage label
    const stage = p.type === "INTER_FACTORY" ? "completed" : (p.paymentStage || "completed");
    const stageInfo = PAYMENT_STAGES[stage] || PAYMENT_STAGES.completed;
    const stageLabel = `${stageInfo.icon} ${stageInfo.short}`;
    // Pending (stage 1+2) tách ra
    if (stage !== "completed") {
      if (isToThis) s4PendingIn += cny;
      else s4PendingOut += cny;
    }
    s4Rows.push([
      { value: p.id, style: "sCell" },
      { value: p.payDate || "", style: "sCell" },
      { value: loaiGd, style: "sCell" },
      { value: partner, style: "sCell" },
      { value: Number(p.amount || 0), style: "sCellNum" },
      { value: p.currency, style: "sCell" },
      { value: payRate, style: "sCellNum" },
      { value: stageLabel, style: "sCell" },
      { value: Math.round(cny), style: "sCellNum" },
      { value: Math.round(vnd), style: "sCellNum" },
      { value: p.note || "", style: "sCell" },
    ]);
  });
  if (factoryPayments.length === 0) {
    s4Rows.push([{ value: "(Không có thanh toán nào trong kỳ)", style: "sSubtitle", mergeAcross: 11 }]);
  } else {
    s4Rows.push([]);
    s4Rows.push([
      { value: "Tổng tiền vào (CNY) — tất cả stage", style: "sTotalLabel", mergeAcross: 7 },
      { value: Math.round(s4TotalIn), style: "sTotal" },
      { value: Math.round(s4TotalIn * (settings.cnyToVnd || 1)), style: "sTotal" },
      { value: "", style: "sTotalLabel" },
    ]);
    s4Rows.push([
      { value: "Tổng tiền ra (CNY) — tất cả stage", style: "sTotalLabel", mergeAcross: 7 },
      { value: Math.round(s4TotalOut), style: "sTotal" },
      { value: Math.round(s4TotalOut * (settings.cnyToVnd || 1)), style: "sTotal" },
      { value: "", style: "sTotalLabel" },
    ]);
    // v38: Hiển thị thêm số đang TT (stage 1+2)
    if (s4PendingIn > 0 || s4PendingOut > 0) {
      s4Rows.push([
        { value: "🟡 Trong đó đang TT (stage 1+2)", style: "sTotalLabel", mergeAcross: 7 },
        { value: Math.round(s4PendingIn - s4PendingOut), style: "sTotal" },
        { value: Math.round((s4PendingIn - s4PendingOut) * (settings.cnyToVnd || 1)), style: "sTotal" },
        { value: "Tiền treo, NCC chưa nhận", style: "sTotalLabel" },
      ]);
    }
    s4Rows.push([
      { value: "✅ THANH TOÁN RÒNG (chỉ stage Hoàn tất)", style: "sTotalLabel", mergeAcross: 7 },
      { value: Math.round((s4TotalIn - s4PendingIn) - (s4TotalOut - s4PendingOut)), style: "sTotal" },
      { value: Math.round(((s4TotalIn - s4PendingIn) - (s4TotalOut - s4PendingOut)) * (settings.cnyToVnd || 1)), style: "sTotal" },
      { value: "Đã giảm công nợ", style: "sTotalLabel" },
    ]);
  }
  const sheet4 = xmlWorksheet("Lịch sử thanh toán", s4Rows, [110, 80, 190, 220, 100, 60, 70, 110, 110, 130, 220]);

  // === SHEET 5: PHÍ NHẬP KHẨU LIÊN QUAN ===
  const s5Rows = [];
  s5Rows.push([{ value: `PHÍ NHẬP KHẨU LIÊN QUAN — ${factory.name}`, style: "sTitle", mergeAcross: 11 }]);
  s5Rows.push([]);
  const s5Headers = ["Mã đơn giao hàng", "Ngày xuất", "Thị trường", "Loại phí", "Đơn vị VC", "Người thụ hưởng", "Số tiền", "Tiền tệ", "Quy đổi VND", "Đã TT (VND)", "Còn phải trả (VND)", "Ghi chú"];
  s5Rows.push(s5Headers.map(h => ({ value: h, style: "sHeader" })));

  let s5TotalFeeVND = 0;
  let s5TotalPaidVND = 0;
  let s5TotalRemainVND = 0;
  factoryShipments.forEach(s => {
    const carrier = carriers?.find(c => c.id === s.carrierId);
    (s.fees || []).forEach(fee => {
      const feeCurrency = fee.currency || "VND";
      const feeRate = settings[`${feeCurrency.toLowerCase()}ToVnd`] || 1;
      const feeVnd = Number(fee.amount || 0) * feeRate;
      // Tổng đã thanh toán cho phí này
      const paidVnd = (feePayments || [])
        .filter(fp => fp.shipmentId === s.id && fp.feeId === fee.id)
        .reduce((sum, fp) => {
          const r = settings[`${(fp.currency || "VND").toLowerCase()}ToVnd`] || 1;
          return sum + Number(fp.amount || 0) * r;
        }, 0);
      const remainVnd = Math.max(0, feeVnd - paidVnd);
      const feeCarrier = carriers?.find(c => c.id === fee.carrierId);

      s5TotalFeeVND += feeVnd;
      s5TotalPaidVND += paidVnd;
      s5TotalRemainVND += remainVnd;

      s5Rows.push([
        { value: s.id, style: "sCell" },
        { value: s.departDate || "", style: "sCell" },
        { value: s.market || "", style: "sCell" },
        { value: fee.type || "", style: "sCell" },
        { value: feeCarrier?.name || carrier?.name || "", style: "sCell" },
        { value: fee.payee || "", style: "sCell" },
        { value: Number(fee.amount || 0), style: "sCellNum" },
        { value: feeCurrency, style: "sCell" },
        { value: Math.round(feeVnd), style: "sCellNum" },
        { value: Math.round(paidVnd), style: "sCellNum" },
        { value: Math.round(remainVnd), style: remainVnd > 0 ? "sRed" : "sCellNum" },
        { value: fee.note || "", style: "sCell" },
      ]);
    });
  });

  const totalFeeItems = factoryShipments.reduce((n, s) => n + (s.fees || []).length, 0);
  if (totalFeeItems === 0) {
    s5Rows.push([{ value: "(Không có phí nhập khẩu nào trong kỳ)", style: "sSubtitle", mergeAcross: 11 }]);
  } else {
    s5Rows.push([]);
    s5Rows.push([
      { value: "TỔNG CỘNG (VND)", style: "sTotalLabel", mergeAcross: 8 },
      { value: Math.round(s5TotalFeeVND), style: "sTotal" },
      { value: Math.round(s5TotalPaidVND), style: "sTotal" },
      { value: Math.round(s5TotalRemainVND), style: "sTotal" },
      { value: "", style: "sTotalLabel" },
    ]);
  }
  const sheet5 = xmlWorksheet("Phí nhập khẩu", s5Rows, [110, 80, 85, 130, 130, 150, 80, 55, 110, 110, 130, 180]);

  // v38i: Sheet 6 — Chi tiết OB theo TT (mỗi OB là TT nào nợ NCC này bao nhiêu)
  const s6Rows = [];
  s6Rows.push([{ value: `CÔNG NỢ ĐẦU KỲ — ${factory.name} — Chi tiết theo TT`, style: "sTitle", mergeAcross: 6 }]);
  s6Rows.push([{ value: "(Mỗi dòng = 1 thị trường đang nợ NCC này)", style: "sCell", mergeAcross: 6 }]);
  s6Rows.push([]);
  s6Rows.push([
    { value: "Mã OB", style: "sHeader" },
    { value: "🌍 Thị trường nợ", style: "sHeader" },
    { value: "Loại", style: "sHeader" },
    { value: "Ngày", style: "sHeader" },
    { value: "Số tiền", style: "sHeader" },
    { value: "Tiền tệ", style: "sHeader" },
    { value: "Ghi chú", style: "sHeader" },
  ]);
  if (factoryOpenings.length === 0) {
    s6Rows.push([{ value: "(Không có công nợ đầu kỳ cho NCC này)", style: "sCell", mergeAcross: 7 }]);
  } else {
    sortByDateDesc(factoryOpenings, "date", "id").forEach(o => {
      s6Rows.push([
        { value: o.id, style: "sCell" },
        { value: o.market || "(Chưa chọn)", style: "sCell" },
        { value: o.type === "debt" ? "Nợ gốc" : "Quỹ tín dụng", style: o.type === "debt" ? "sRed" : "sGreen" },
        { value: o.date, style: "sCell" },
        { value: Number(o.amount || 0), style: "sCellNum" },
        { value: o.currency || "CNY", style: "sCell" },
        { value: o.note || "", style: "sCell" },
      ]);
    });
    s6Rows.push([]);
    // Tổng hợp theo TT
    const byMarket = {};
    factoryOpenings.forEach(o => {
      if (!byMarket[o.market]) byMarket[o.market] = { debt: 0, credit: 0 };
      const cny = toVND(Number(o.amount || 0), o.currency || "CNY", settings) / settings.cnyToVnd;
      if (o.type === "debt") byMarket[o.market].debt += cny;
      else byMarket[o.market].credit += cny;
    });
    s6Rows.push([{ value: "TỔNG HỢP THEO THỊ TRƯỜNG (CNY)", style: "sSection", mergeAcross: 6 }]);
    s6Rows.push([
      { value: "🌍 Thị trường", style: "sHeader" },
      { value: "Tổng nợ gốc (CNY)", style: "sHeader" },
      { value: "Tổng quỹ TD (CNY)", style: "sHeader" },
      { value: "", style: "sHeader" },
      { value: "", style: "sHeader" },
      { value: "", style: "sHeader" },
      { value: "", style: "sHeader" },
    ]);
    Object.entries(byMarket).forEach(([m, v]) => {
      s6Rows.push([
        { value: m || "(Chưa chọn)", style: "sLabel" },
        { value: Math.round(v.debt), style: v.debt > 0 ? "sRed" : "sCellNum" },
        { value: Math.round(v.credit), style: v.credit > 0 ? "sGreen" : "sCellNum" },
        { value: "", style: "sCell" },
        { value: "", style: "sCell" },
        { value: "", style: "sCell" },
        { value: "", style: "sCell" },
      ]);
    });
  }
  const sheet6 = xmlWorksheet("OB theo TT", s6Rows, [90, 130, 100, 75, 110, 60, 220]);

  // === Build file ===
  const allSheets = [sheet1, sheet2, sheet3, sheet4, sheet5, sheet6].join("\n");
  const safeFactoryCode = (factory.supplierCode || factory.id || "NCC").replace(/[^A-Za-z0-9_-]/g, "_");
  const today = new Date().toISOString().slice(0, 10);
  const filename = `BaoCao_DoiSoat_${safeFactoryCode}_${today}.xls`;
  downloadXlsFile(allSheets, filename);
  return filename;
};

// v30: Xuất báo cáo Excel tồn kho — 4 sheets
// 1. Tổng hợp: SP × Kho × (đầu kỳ + nhập + xuất + tồn cuối)
// 2. Biến động: tất cả movements trong kỳ với nguồn
// 3. Cảnh báo: tồn dưới ngưỡng + tồn âm
// 4. Lịch sử Import: các batch trong kỳ
const exportInventoryReport = async ({ products, openingStock, stockMovements, stockImportBatches, markets, warehouseFilter, dateFrom, dateTo, settings, exportedBy }) => {
  const inRange = (d) => {
    if (!d) return true;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };

  // Lấy danh sách kho cần báo cáo
  const allWarehouses = [];
  (markets || []).forEach(m => {
    (m.warehouses || []).forEach(w => {
      if (!warehouseFilter || warehouseFilter === w.id) {
        allWarehouses.push({ ...w, marketName: m.name });
      }
    });
  });

  const today = new Date().toISOString().slice(0, 10);
  const periodLabel = dateFrom || dateTo
    ? `Kỳ: ${dateFrom || "..."} → ${dateTo || "..."}`
    : "Tất cả thời gian";
  const whLabel = warehouseFilter
    ? allWarehouses[0]?.name || "kho được chọn"
    : "Tất cả kho";

  // Sheet 1 — Tổng hợp
  const summaryRows = [];
  summaryRows.push([{ value: "📊 BÁO CÁO TỒN KHO — TỔNG HỢP", style: "sTitle", mergeAcross: 6 }]);
  summaryRows.push([{ value: `${periodLabel} · ${whLabel}`, style: "sSubtitle", mergeAcross: 6 }]);
  summaryRows.push([{ value: `Xuất bởi: ${exportedBy || "--"} · ${today}`, style: "sSubtitle", mergeAcross: 6 }]);
  summaryRows.push([]);
  summaryRows.push([
    { value: "Mã SP", style: "sHeader" },
    { value: "Tên SP", style: "sHeader" },
    { value: "Thị trường", style: "sHeader" },
    { value: "Kho", style: "sHeader" },
    { value: "Đầu kỳ", style: "sHeader" },
    { value: "Nhập", style: "sHeader" },
    { value: "Xuất", style: "sHeader" },
    { value: "Tồn cuối", style: "sHeader" },
    { value: "Trạng thái", style: "sHeader" },
  ]);

  let grandIn = 0, grandOut = 0, grandClosing = 0, grandOpening = 0;
  const lowStockRows = []; // dùng cho Sheet 3
  const negativeRows = [];

  products.forEach(p => {
    allWarehouses.forEach(w => {
      // Đầu kỳ tại thời điểm dateFrom (nếu có) hoặc đầu kỳ data
      // Nếu có dateFrom: opening = đầu kỳ thực + tất cả movements trước dateFrom
      // Nếu không có: opening chỉ là openingStock entry
      let opening = 0;
      const obEntries = (openingStock || []).filter(o => o.productId === p.id && o.warehouseId === w.id && o.status !== "cancelled");
      obEntries.forEach(ob => { opening += Number(ob.quantity || 0); });

      // Movements trước dateFrom được cộng vào opening
      if (dateFrom) {
        (stockMovements || []).filter(m =>
          m.productId === p.id && m.warehouseId === w.id &&
          m.status !== "cancelled" && m.date && m.date < dateFrom
        ).forEach(m => {
          if (m.type === "IN") opening += Number(m.quantity || 0);
          else if (m.type === "OUT") opening -= Number(m.quantity || 0);
        });
      }

      // Movements trong kỳ
      let inQty = 0, outQty = 0;
      (stockMovements || []).filter(m =>
        m.productId === p.id && m.warehouseId === w.id &&
        m.status !== "cancelled" && inRange(m.date)
      ).forEach(m => {
        if (m.type === "IN") inQty += Number(m.quantity || 0);
        else if (m.type === "OUT") outQty += Number(m.quantity || 0);
      });

      const closing = opening + inQty - outQty;

      // Bỏ qua dòng không có biến động và không có tồn
      if (opening === 0 && inQty === 0 && outQty === 0 && closing === 0) return;

      // Trạng thái cảnh báo
      const threshold = (p.warehouseThresholds && p.warehouseThresholds[w.id]) || 0;
      let statusText = "✅ Bình thường";
      let statusStyle = "sGreen";
      if (closing < 0) { statusText = "🔴 Âm"; statusStyle = "sRed"; negativeRows.push({ p, w, opening, inQty, outQty, closing, threshold }); }
      else if (threshold > 0 && closing < threshold) { statusText = `⚠ Dưới ngưỡng (${threshold})`; statusStyle = "sRed"; lowStockRows.push({ p, w, opening, inQty, outQty, closing, threshold }); }

      summaryRows.push([
        { value: p.sku || "", style: "sCell" },
        { value: p.name || "", style: "sCell" },
        { value: w.marketName || "", style: "sCell" },
        { value: w.name || "", style: "sCell" },
        { value: opening, style: "sCellNum" },
        { value: inQty, style: "sCellNum" },
        { value: outQty, style: "sCellNum" },
        { value: closing, style: closing < 0 ? "sRed" : "sCellNum" },
        { value: statusText, style: "sCell" },
      ]);

      grandOpening += opening;
      grandIn += inQty;
      grandOut += outQty;
      grandClosing += closing;
    });
  });

  summaryRows.push([
    { value: "TỔNG CỘNG", style: "sTotalLabel", mergeAcross: 3 },
    { value: grandOpening, style: "sTotal" },
    { value: grandIn, style: "sTotal" },
    { value: grandOut, style: "sTotal" },
    { value: grandClosing, style: "sTotal" },
    { value: "", style: "sTotalLabel" },
  ]);

  // Sheet 2 — Biến động chi tiết
  const movementRows = [];
  movementRows.push([{ value: "📋 BÁO CÁO TỒN KHO — CHI TIẾT BIẾN ĐỘNG", style: "sTitle", mergeAcross: 7 }]);
  movementRows.push([{ value: `${periodLabel} · ${whLabel}`, style: "sSubtitle", mergeAcross: 7 }]);
  movementRows.push([]);
  movementRows.push([
    { value: "Ngày", style: "sHeader" },
    { value: "Mã SP", style: "sHeader" },
    { value: "Tên SP", style: "sHeader" },
    { value: "Kho", style: "sHeader" },
    { value: "Loại", style: "sHeader" },
    { value: "Số lượng", style: "sHeader" },
    { value: "Nguồn", style: "sHeader" },
    { value: "Mã tham chiếu", style: "sHeader" },
    { value: "Ghi chú", style: "sHeader" },
  ]);

  // v38c: Đảo từ ASC → DESC để chuẩn hoá với các báo cáo khác (mới trên đầu)
  const movementsInRange = sortByDateDesc(
    (stockMovements || []).filter(m =>
      m.status !== "cancelled" && inRange(m.date) &&
      (!warehouseFilter || m.warehouseId === warehouseFilter)
    ),
    "date", "id"
  );

  const sourceLabels = {
    shipment_arrive: "🚚 Lô về kho",
    warranty_send: "🔧 Gửi BH",
    warranty_return: "🔧 BH trả về",
    stock_import_batch: "📥 Import",
    manual: "✏️ Thủ công",
  };

  movementsInRange.forEach(m => {
    const product = products.find(p => p.id === m.productId);
    const wh = allWarehouses.find(w => w.id === m.warehouseId) || (markets || []).flatMap(mk => (mk.warehouses || [])).find(w => w.id === m.warehouseId);
    movementRows.push([
      { value: m.date || "", style: "sCell" },
      { value: product?.sku || "", style: "sCell" },
      { value: product?.name || "", style: "sCell" },
      { value: wh?.name || "", style: "sCell" },
      { value: m.type === "IN" ? "➕ Nhập" : "➖ Xuất", style: "sCell" },
      { value: Number(m.quantity || 0), style: m.type === "IN" ? "sGreen" : "sRed" },
      { value: sourceLabels[m.source] || m.source || "", style: "sCell" },
      { value: m.refId || "", style: "sCell" },
      { value: m.note || "", style: "sCell" },
    ]);
  });

  if (movementsInRange.length === 0) {
    movementRows.push([{ value: "Không có biến động trong kỳ", style: "sCell", mergeAcross: 8 }]);
  }

  // Sheet 3 — Cảnh báo
  const alertRows = [];
  alertRows.push([{ value: "⚠️ BÁO CÁO TỒN KHO — CẢNH BÁO", style: "sTitle", mergeAcross: 5 }]);
  alertRows.push([{ value: `${periodLabel} · ${whLabel}`, style: "sSubtitle", mergeAcross: 5 }]);
  alertRows.push([]);

  if (negativeRows.length > 0) {
    alertRows.push([{ value: "🔴 TỒN ÂM (cần kiểm kê NGAY)", style: "sSection", mergeAcross: 5 }]);
    alertRows.push([
      { value: "Mã SP", style: "sHeader" },
      { value: "Tên SP", style: "sHeader" },
      { value: "Kho", style: "sHeader" },
      { value: "Tồn hiện tại", style: "sHeader" },
      { value: "Đầu kỳ", style: "sHeader" },
      { value: "Nhập", style: "sHeader" },
      { value: "Xuất", style: "sHeader" },
    ]);
    negativeRows.forEach(r => {
      alertRows.push([
        { value: r.p.sku || "", style: "sCell" },
        { value: r.p.name || "", style: "sCell" },
        { value: r.w.name || "", style: "sCell" },
        { value: r.closing, style: "sRed" },
        { value: r.opening, style: "sCellNum" },
        { value: r.inQty, style: "sCellNum" },
        { value: r.outQty, style: "sCellNum" },
      ]);
    });
    alertRows.push([]);
  }

  if (lowStockRows.length > 0) {
    alertRows.push([{ value: "⚠ TỒN DƯỚI NGƯỠNG", style: "sSection", mergeAcross: 6 }]);
    alertRows.push([
      { value: "Mã SP", style: "sHeader" },
      { value: "Tên SP", style: "sHeader" },
      { value: "Kho", style: "sHeader" },
      { value: "Tồn hiện tại", style: "sHeader" },
      { value: "Ngưỡng", style: "sHeader" },
      { value: "Thiếu", style: "sHeader" },
    ]);
    lowStockRows.forEach(r => {
      alertRows.push([
        { value: r.p.sku || "", style: "sCell" },
        { value: r.p.name || "", style: "sCell" },
        { value: r.w.name || "", style: "sCell" },
        { value: r.closing, style: "sRed" },
        { value: r.threshold, style: "sCellNum" },
        { value: r.threshold - r.closing, style: "sRed" },
      ]);
    });
  }

  if (negativeRows.length === 0 && lowStockRows.length === 0) {
    alertRows.push([{ value: "✅ Không có cảnh báo. Tất cả tồn kho ổn.", style: "sLabel", mergeAcross: 5 }]);
  }

  // Sheet 4 — Lịch sử Import
  const importRows = [];
  importRows.push([{ value: "📥 BÁO CÁO TỒN KHO — LỊCH SỬ IMPORT", style: "sTitle", mergeAcross: 7 }]);
  importRows.push([{ value: `${periodLabel} · ${whLabel}`, style: "sSubtitle", mergeAcross: 7 }]);
  importRows.push([]);
  importRows.push([
    { value: "Mã batch", style: "sHeader" },
    { value: "Ngày import", style: "sHeader" },
    { value: "Kho", style: "sHeader" },
    { value: "Mode", style: "sHeader" },
    { value: "Nguồn", style: "sHeader" },
    { value: "Số dòng sinh", style: "sHeader" },
    { value: "Trạng thái", style: "sHeader" },
    { value: "Người import", style: "sHeader" },
  ]);

  // v38c: Chuẩn hoá dùng helper (giữ DESC như cũ, thêm tie-break ID)
  const batchesInRange = sortByDateDesc(
    (stockImportBatches || []).filter(b =>
      inRange(b.date) && (!warehouseFilter || b.warehouseId === warehouseFilter)
    ),
    "date", "id"
  );

  batchesInRange.forEach(b => {
    const wh = allWarehouses.find(w => w.id === b.warehouseId) || (markets || []).flatMap(mk => (mk.warehouses || [])).find(w => w.id === b.warehouseId);
    importRows.push([
      { value: b.id || "", style: "sCell" },
      { value: b.date || "", style: "sCell" },
      { value: wh?.name || "", style: "sCell" },
      { value: b.mode === "opening" ? "Đầu kỳ" : "Điều chỉnh", style: "sCell" },
      { value: b.posSystem === "manual" ? "Template" : (b.posSystem === "nhanh" ? "Nhanh.vn" : (b.posSystem === "pancake" ? "Pancake" : b.posSystem)), style: "sCell" },
      { value: Number(b.generatedItems || 0), style: "sCellNum" },
      { value: b.status === "cancelled" ? "🚫 Đã hủy" : "✅ Active", style: b.status === "cancelled" ? "sRed" : "sGreen" },
      { value: b.importedBy || "", style: "sCell" },
    ]);
  });

  if (batchesInRange.length === 0) {
    importRows.push([{ value: "Không có batch import trong kỳ", style: "sCell", mergeAcross: 7 }]);
  }

  const allSheets = [
    xmlWorksheet("Tong hop", summaryRows, [80, 80, 220, 80, 100, 70, 70, 70, 80, 130]),
    xmlWorksheet("Bien dong", movementRows, [70, 80, 220, 100, 70, 70, 100, 100, 200]),
    xmlWorksheet("Canh bao", alertRows, [80, 220, 100, 80, 80, 80, 80]),
    xmlWorksheet("Lich su Import", importRows, [180, 80, 100, 80, 80, 80, 80, 100]),
  ].join("\n");

  const filename = `BaoCao_TonKho_${today}${warehouseFilter ? `_${(allWarehouses[0]?.name || "").replace(/[^\w]/g, "_")}` : ""}.xls`;
  downloadXlsFile(allSheets, filename);
  return filename;
};

// ============================================================
// v38j: exportInventoryAlertReport — Báo cáo Cảnh báo & Đề xuất 4 sheets
// ============================================================
// Sheet 1: Tổng quan tồn kho × kho (12 cột)
// Sheet 2: Cần đặt PO gấp (chỉ 🔴)
// Sheet 3: Cần tạo SH (chỉ 🟡)
// Sheet 4: Cấu hình tồn an toàn
const exportInventoryAlertReport = async ({ products, pos, shipments, stockOnHand, markets, settings, exportedBy }) => {
  const today = new Date().toISOString().slice(0, 10);
  const allWh = [];
  (markets || []).forEach(m => (m.warehouses || []).forEach(w => allWh.push({ ...w, marketName: m.name })));

  // Build all rows: SP × kho có warehouseTargets
  const allRows = [];
  (products || []).forEach(p => {
    allWh.forEach(w => {
      const target = (p.warehouseTargets || {})[w.id];
      if (!target) return; // SP chưa cấu hình kho này → bỏ qua
      const stockInWarehouse = calcStockOnHandQty(p.id, stockOnHand, { warehouseId: w.id });
      const inTransit = calcInTransitQty(p.id, shipments, pos, { warehouseId: w.id });
      const received = calcReceivedQty(p.id, shipments, pos, { warehouseId: w.id });
      const atFactory = calcAtFactoryQty(p.id, pos, shipments);
      const leadTime = Number(p.thoiGianSanXuat || 0) + Number(p.thoiGianVanChuyen || 0);
      const status = calcInventoryStatus({
        stockInWarehouse, inTransit, atFactory,
        tonAnToan: Number(target.tonAnToan || 0),
        slBanNgay: Number(target.slBanNgay || 0),
        leadTimeDays: leadTime,
        khongTheoDoi: !!target.khongTheoDoi,
      });
      const suggestSH = calcSuggestShipQty({
        stockInWarehouse, inTransit, atFactory, tonAnToan: Number(target.tonAnToan || 0),
      });
      const suggestPO = calcSuggestPOQty({
        stockInWarehouse, inTransit, atFactory,
        slBanNgay: Number(target.slBanNgay || 0),
        soNgayDuKienBan: Number(p.soNgayDuKienBan || 0),
        leadTimeDays: leadTime,
      });
      allRows.push({
        product: p, warehouse: w,
        target,
        stockInWarehouse, inTransit, received, atFactory,
        status, suggestSH, suggestPO,
        leadTime,
      });
    });
  });

  // Sort: status priority asc, then SKU
  allRows.sort((a, b) => {
    if (a.status.priority !== b.status.priority) return a.status.priority - b.status.priority;
    return (a.product.sku || "").localeCompare(b.product.sku || "");
  });

  // === Sheet 1: Tổng quan tồn kho ===
  const s1Rows = [];
  s1Rows.push([{ value: `BÁO CÁO TỒN KHO — CẢNH BÁO & ĐỀ XUẤT (V38j)`, style: "sTitle", mergeAcross: 11 }]);
  s1Rows.push([{ value: `Xuất ngày: ${today}${exportedBy ? ` · Bởi: ${exportedBy}` : ""}`, style: "sCell", mergeAcross: 11 }]);
  s1Rows.push([]);
  s1Rows.push([
    { value: "🌍 TT", style: "sHeader" },
    { value: "🏪 Kho", style: "sHeader" },
    { value: "SKU", style: "sHeader" },
    { value: "Tên SP", style: "sHeader" },
    { value: "Hàng đã nhập", style: "sHeader" },
    { value: "Tồn ở NCC (chung TT)", style: "sHeader" },
    { value: "Hàng đi đường", style: "sHeader" },
    { value: "Tồn trong kho", style: "sHeader" },
    { value: "Ngưỡng cảnh báo", style: "sHeader" },
    { value: "Đề xuất tạo SH", style: "sHeader" },
    { value: "Đề xuất đặt PO", style: "sHeader" },
    { value: "Trạng thái", style: "sHeader" },
  ]);
  if (allRows.length === 0) {
    s1Rows.push([{ value: "(Chưa có SP nào được cấu hình tồn an toàn)", style: "sCell", mergeAcross: 11 }]);
  } else {
    allRows.forEach(r => {
      const statusStyle = r.status.id === "urgent_po" ? "sRed" : r.status.id === "need_ship" ? "sCellNum" : r.status.id === "coming" ? "sCellNum" : "sGreen";
      s1Rows.push([
        { value: r.warehouse.marketName, style: "sCell" },
        { value: r.warehouse.name, style: "sCell" },
        { value: r.product.sku, style: "sLabel" },
        { value: r.product.name, style: "sCell" },
        { value: r.received, style: "sCellNum" },
        { value: r.atFactory, style: "sCellNum" },
        { value: r.inTransit, style: "sCellNum" },
        { value: r.stockInWarehouse, style: "sCellNum" },
        { value: r.target.khongTheoDoi ? "—" : Number(r.target.tonAnToan || 0), style: "sCellNum" },
        { value: r.suggestSH.qty > 0 ? r.suggestSH.qty : (r.suggestSH.reason || "—"), style: r.suggestSH.qty > 0 ? "sCellNum" : "sCell" },
        { value: r.suggestPO.qty > 0 ? r.suggestPO.qty : (r.suggestPO.qty === -1 ? "Cần cấu hình" : "—"), style: r.suggestPO.qty > 0 ? "sRed" : "sCell" },
        { value: `${r.status.icon} ${r.status.label}`, style: statusStyle },
      ]);
    });
  }
  const sheet1 = xmlWorksheet("Tổng quan tồn kho", s1Rows, [80, 110, 90, 200, 90, 110, 90, 90, 100, 100, 100, 130]);

  // === Sheet 2: Cần đặt PO gấp (🔴) ===
  const urgentRows = allRows.filter(r => r.status.id === "urgent_po");
  const s2Rows = [];
  s2Rows.push([{ value: "CẦN ĐẶT PO GẤP — SP × Kho cần đặt PO ngay (sẽ hết hàng trong lead time)", style: "sTitle", mergeAcross: 7 }]);
  s2Rows.push([{ value: `${urgentRows.length} mục cảnh báo`, style: "sCell", mergeAcross: 7 }]);
  s2Rows.push([]);
  s2Rows.push([
    { value: "🌍 TT", style: "sHeader" },
    { value: "🏪 Kho", style: "sHeader" },
    { value: "SKU", style: "sHeader" },
    { value: "Tên SP", style: "sHeader" },
    { value: "Tồn kho", style: "sHeader" },
    { value: "Đi đường", style: "sHeader" },
    { value: "Tồn NCC", style: "sHeader" },
    { value: "SL đề xuất đặt PO", style: "sHeader" },
  ]);
  if (urgentRows.length === 0) {
    s2Rows.push([{ value: "✅ Không có SP nào cần đặt PO gấp", style: "sGreen", mergeAcross: 7 }]);
  } else {
    urgentRows.forEach(r => {
      s2Rows.push([
        { value: r.warehouse.marketName, style: "sCell" },
        { value: r.warehouse.name, style: "sCell" },
        { value: r.product.sku, style: "sLabel" },
        { value: r.product.name, style: "sCell" },
        { value: r.stockInWarehouse, style: "sCellNum" },
        { value: r.inTransit, style: "sCellNum" },
        { value: r.atFactory, style: "sCellNum" },
        { value: r.suggestPO.qty > 0 ? r.suggestPO.qty : "Cần cấu hình SL bán/ngày", style: r.suggestPO.qty > 0 ? "sRed" : "sCell" },
      ]);
    });
  }
  const sheet2 = xmlWorksheet("Cần đặt PO gấp", s2Rows, [80, 110, 90, 220, 80, 80, 80, 130]);

  // === Sheet 3: Cần tạo SH (🟡) ===
  const needShipRows = allRows.filter(r => r.status.id === "need_ship");
  const s3Rows = [];
  s3Rows.push([{ value: "CẦN TẠO ĐƠN GIAO HÀNG — SP × Kho có hàng ở NCC, chỉ cần tạo SH về kho", style: "sTitle", mergeAcross: 7 }]);
  s3Rows.push([{ value: `${needShipRows.length} mục cần xử lý`, style: "sCell", mergeAcross: 7 }]);
  s3Rows.push([]);
  s3Rows.push([
    { value: "🌍 TT", style: "sHeader" },
    { value: "🏪 Kho", style: "sHeader" },
    { value: "SKU", style: "sHeader" },
    { value: "Tên SP", style: "sHeader" },
    { value: "Tồn kho", style: "sHeader" },
    { value: "Đi đường", style: "sHeader" },
    { value: "Tồn NCC", style: "sHeader" },
    { value: "SL đề xuất tạo SH", style: "sHeader" },
  ]);
  if (needShipRows.length === 0) {
    s3Rows.push([{ value: "✅ Không có SP nào cần tạo SH", style: "sGreen", mergeAcross: 7 }]);
  } else {
    needShipRows.forEach(r => {
      s3Rows.push([
        { value: r.warehouse.marketName, style: "sCell" },
        { value: r.warehouse.name, style: "sCell" },
        { value: r.product.sku, style: "sLabel" },
        { value: r.product.name, style: "sCell" },
        { value: r.stockInWarehouse, style: "sCellNum" },
        { value: r.inTransit, style: "sCellNum" },
        { value: r.atFactory, style: "sCellNum" },
        { value: r.suggestSH.qty, style: r.suggestSH.qty > 0 ? "sLabel" : "sCell" },
      ]);
    });
  }
  const sheet3 = xmlWorksheet("Cần tạo SH", s3Rows, [80, 110, 90, 220, 80, 80, 80, 130]);

  // === Sheet 4: Cấu hình tồn an toàn ===
  const s4Rows = [];
  s4Rows.push([{ value: "CẤU HÌNH TỒN AN TOÀN — Tham số cho từng SP × Kho", style: "sTitle", mergeAcross: 8 }]);
  s4Rows.push([]);
  s4Rows.push([
    { value: "SKU", style: "sHeader" },
    { value: "Tên SP", style: "sHeader" },
    { value: "🌍 TT", style: "sHeader" },
    { value: "🏪 Kho", style: "sHeader" },
    { value: "Ngưỡng cảnh báo", style: "sHeader" },
    { value: "SL bán/ngày", style: "sHeader" },
    { value: "Theo dõi?", style: "sHeader" },
    { value: "TG SX (ngày)", style: "sHeader" },
    { value: "TG VC (ngày)", style: "sHeader" },
    { value: "Số ngày dự kiến bán", style: "sHeader" },
  ]);
  let hasAnyConfig = false;
  (products || []).forEach(p => {
    allWh.forEach(w => {
      const target = (p.warehouseTargets || {})[w.id];
      if (!target) return;
      hasAnyConfig = true;
      s4Rows.push([
        { value: p.sku, style: "sLabel" },
        { value: p.name, style: "sCell" },
        { value: w.marketName, style: "sCell" },
        { value: w.name, style: "sCell" },
        { value: Number(target.tonAnToan || 0), style: "sCellNum" },
        { value: Number(target.slBanNgay || 0), style: "sCellNum" },
        { value: target.khongTheoDoi ? "⚪ Không" : "✅ Có", style: target.khongTheoDoi ? "sCell" : "sGreen" },
        { value: Number(p.thoiGianSanXuat || 0), style: "sCellNum" },
        { value: Number(p.thoiGianVanChuyen || 0), style: "sCellNum" },
        { value: Number(p.soNgayDuKienBan || 0), style: "sCellNum" },
      ]);
    });
  });
  if (!hasAnyConfig) {
    s4Rows.push([{ value: "(Chưa có SP nào được cấu hình tồn an toàn)", style: "sCell", mergeAcross: 9 }]);
  }
  const sheet4 = xmlWorksheet("Cấu hình tồn an toàn", s4Rows, [90, 220, 80, 110, 110, 100, 90, 90, 90, 130]);

  // === Build file ===
  const allSheets = [sheet1, sheet2, sheet3, sheet4].join("\n");
  const filename = `BaoCao_CanhBao_TonKho_${today}.xls`;
  downloadXlsFile(allSheets, filename);
  return filename;
};

// v14: Xuất báo cáo công nợ thị trường — 5 sheets, hỗ trợ 1 thị trường hoặc tất cả thị trường
// Tỷ giá: Dùng tỷ giá hiện tại (nhất quán với báo cáo NCC)
const exportMarketReport = async ({ marketName, isAllMarkets, pos, shipments, payments, factories, products, markets, warranties = [], openingBalances = [], dateFrom, dateTo, settings, exportedBy }) => {
  const inRange = (d) => {
    if (!d) return true;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };

  // Danh sách thị trường cần xử lý
  const targetMarkets = isAllMarkets ? getMarketNames(markets) : [marketName];

  // Helper: tính giá trị 1 dòng shipment item theo CNY và VND
  const calcLineValueCNY = (poItem, qty, poCurrency) => {
    const valInPoCurrency = Number(qty) * Number(poItem.unitPrice || 0);
    const valVND = toVND(valInPoCurrency, poCurrency, settings);
    return valVND / (settings.cnyToVnd || 1);
  };

  // Lọc shipments + payments theo target markets + kỳ
  const allTargetShipments = shipments.filter(s => {
    // v26: Loại trừ cả Hủy + Nháp khỏi báo cáo TT
    if (!isOperationalShipment(s)) return false;
    if (!targetMarkets.includes(s.market)) return false;
    return inRange(s.departDate);
  });
  const allTargetPayments = payments.filter(p => {
    if (p.status === "cancelled") return false; // v20
    if (p.type !== "MARKET_TO_FACTORY") return false;
    if (!targetMarkets.includes(p.fromMarket)) return false;
    return inRange(p.payDate);
  });

  // === SHEET 1: TỔNG HỢP ===
  const s1Rows = [];
  s1Rows.push([{ value: "BÁO CÁO CÔNG NỢ THỊ TRƯỜNG", style: "sTitle", mergeAcross: 4 }]);
  s1Rows.push([]);

  if (isAllMarkets) {
    s1Rows.push([
      { value: "Phạm vi:", style: "sLabel" },
      { value: `Tất cả thị trường (${targetMarkets.length}: ${targetMarkets.join(", ")})`, style: "sCell", mergeAcross: 3 },
    ]);
  } else {
    const marketObj = markets.find(m => m.name === marketName);
    s1Rows.push([
      { value: "Thị trường:", style: "sLabel" },
      { value: marketName, style: "sCell" },
      { value: "Mã:", style: "sLabel" },
      { value: marketObj?.code || "-", style: "sCell" },
    ]);
    s1Rows.push([
      { value: "Tiền tệ chính:", style: "sLabel" },
      { value: marketObj?.currency || "VND", style: "sCell" },
      { value: "Số kho:", style: "sLabel" },
      { value: (marketObj?.warehouses || []).length, style: "sCellNum" },
    ]);
  }
  s1Rows.push([
    { value: "Kỳ báo cáo:", style: "sLabel" },
    { value: `Từ ${dateFrom || "(không giới hạn)"} đến ${dateTo || "(hôm nay)"}`, style: "sCell", mergeAcross: 3 },
  ]);
  s1Rows.push([
    { value: "Người xuất:", style: "sLabel" },
    { value: exportedBy || "-", style: "sCell" },
    { value: "Ngày xuất:", style: "sLabel" },
    { value: new Date().toLocaleString("vi-VN"), style: "sCell" },
  ]);
  s1Rows.push([
    { value: "Tỷ giá CNY → VND:", style: "sLabel" },
    { value: `1 CNY = ${(settings.cnyToVnd || 0).toLocaleString("vi-VN")} VND`, style: "sCell", mergeAcross: 3 },
  ]);
  s1Rows.push([]);

  // Tính chỉ số tổng hợp cho từng thị trường
  // v15: Đồng bộ với UI — công nợ phát sinh khi NCC giao hàng đi (đã ship), không chờ về kho
  const marketSummaries = {};
  let grandShippedCNY = 0, grandReceivedCNY = 0, grandPaidCNY = 0, grandPendingCNY = 0;

  targetMarkets.forEach(mName => {
    let shippedCNY = 0, receivedCNY = 0, paidCNY = 0;
    const mShipments = allTargetShipments.filter(s => s.market === mName);
    mShipments.forEach(s => {
      const isArrived = s.status === "Đã về kho";
      (s.items || []).forEach(it => {
        const po = pos.find(p => p.id === it.poId);
        if (!po) return;
        const poItems = getPOItems(po);
        const poItem = po.items ? poItems.find(x => x.id === it.itemId) : poItems[0];
        if (!poItem) return;
        const shippedQty = Number(it.quantity || 0);
        const receivedQty = isArrived ? Number(it.receivedQty ?? shippedQty) : 0;
        // v15: shipped → tính vào công nợ; received → tham chiếu hao hụt
        shippedCNY += calcLineValueCNY(poItem, shippedQty, po.currency);
        receivedCNY += calcLineValueCNY(poItem, receivedQty, po.currency);
      });
    });
    paidCNY = 0;
    let pendingCNY = 0;
    allTargetPayments.filter(p => p.fromMarket === mName).forEach(p => {
      const vnd = toVND(Number(p.amount || 0), p.currency, settings);
      const cny = vnd / (settings.cnyToVnd || 1);
      const stage = p.paymentStage || "completed";
      if (stage === "completed") paidCNY += cny;
      else pendingCNY += cny; // stage 1+2
    });
    marketSummaries[mName] = { shippedCNY, receivedCNY, paidCNY, pendingCNY };
    grandShippedCNY += shippedCNY;
    grandReceivedCNY += receivedCNY;
    grandPaidCNY += paidCNY;
    grandPendingCNY += pendingCNY;
  });

  s1Rows.push([{ value: "BẢNG CÔNG NỢ", style: "sSection", mergeAcross: 3 }]);
  s1Rows.push([
    { value: "KHOẢN MỤC", style: "sHeader" },
    { value: "Số tiền (CNY)", style: "sHeader" },
    { value: "Quy đổi VND", style: "sHeader" },
    { value: "Ghi chú", style: "sHeader" },
  ]);

  const pushMoneyRow = (label, amount, note = "", isTotal = false) => {
    const styleLabel = isTotal ? "sTotalLabel" : "sLabel";
    const styleNum = isTotal ? "sTotal" : "sCellNum";
    s1Rows.push([
      { value: label, style: styleLabel },
      { value: Math.round(amount), style: styleNum },
      { value: Math.round(amount * (settings.cnyToVnd || 1)), style: styleNum },
      { value: note, style: "sCell" },
    ]);
  };

  pushMoneyRow("(1) Hàng đã ship về thị trường", grandShippedCNY, "Tổng giá trị NCC giao đi (đang VC + đã về kho) — phát sinh công nợ");
  pushMoneyRow("(2) Tham chiếu — Hàng đã NHẬN về kho", grandReceivedCNY, "Để đối chiếu hao hụt với (1)");
  pushMoneyRow("(3) ✅ Đã thanh toán cho nhà máy (chỉ stage Hoàn tất)", grandPaidCNY, "v38: chỉ payment đã hoàn tất ✅ — TT đã đến NCC");
  // v38: Dòng mới — Đang TT
  pushMoneyRow("(3a) 🟡 Đang TT (stage 🏦 + 🌐) — chưa giảm nợ", grandPendingCNY, "v38 Cách B: Tiền TT đã chuyển nhưng NCC chưa nhận. KHÔNG trừ vào nợ.");

  // v18: Tính tổng giá trị hàng đang BH treo cho các thị trường target
  const grandWarrantyCNY = targetMarkets.reduce((sum, mName) => sum + calcWarrantyPendingValueCNY(mName, warranties, products, settings), 0);
  pushMoneyRow("(3.5) Hàng đang bảo hành (treo)", grandWarrantyCNY, "Hàng đang ở NM bảo hành — treo công nợ tạm thời. 3 trạng thái: Đang gửi NM / NM đang sửa / Đang trả về kho");

  // v38i: Tính tổng OB của TT — bỏ filter entityType (V38h cũ).
  // OB V38i có cả market + factoryId BẮT BUỘC → filter theo market đủ.
  let grandOpeningDebtCNY = 0;
  let grandOpeningCreditCNY = 0;
  (openingBalances || []).filter(o =>
    targetMarkets.includes(o.market) &&
    o.status !== "cancelled"
  ).forEach(o => {
    const vnd = toVND(Number(o.amount || 0), o.currency || "CNY", settings);
    const cny = vnd / (settings.cnyToVnd || 1);
    if (o.type === "debt") grandOpeningDebtCNY += cny;
    else if (o.type === "credit") grandOpeningCreditCNY += cny;
  });
  if (grandOpeningDebtCNY > 0) pushMoneyRow("(0a) ➕ OB nợ gốc đầu kỳ TT", grandOpeningDebtCNY, "v38i: Tổng số TT đang nợ các NCC từ kỳ trước (cộng vào nợ phải trả)");
  if (grandOpeningCreditCNY > 0) pushMoneyRow("(0b) ➖ OB quỹ tín dụng đầu kỳ TT", grandOpeningCreditCNY, "v38i: Tổng số TT đã trả thừa các NCC kỳ trước (trừ khỏi nợ phải trả)");

  s1Rows.push([]);

  // v38 + v38h: Còn phải trả = (1) + (0a) − (0b) − (3) − (3a) − (3.5) — Cách B + OB
  const stillOwed = Math.max(0, grandShippedCNY + grandOpeningDebtCNY - grandOpeningCreditCNY - grandPaidCNY - grandPendingCNY - grandWarrantyCNY);
  const creditFund = Math.max(0, grandPaidCNY + grandPendingCNY + grandWarrantyCNY + grandOpeningCreditCNY - grandShippedCNY - grandOpeningDebtCNY);
  pushMoneyRow("(4) CÒN PHẢI TRẢ", stillOwed, "= (1) + (0a) − (0b) − (3) − (3a) − (3.5), tối thiểu 0", true);
  pushMoneyRow("(5) QUỸ TÍN DỤNG THỊ TRƯỜNG", creditFund, "Nếu TT trả dư + treo BH so với hàng đã ship", true);

  // Nếu xuất tất cả → thêm bảng break-down theo từng thị trường
  if (isAllMarkets) {
    s1Rows.push([]);
    s1Rows.push([{ value: "PHÂN TÁCH THEO TỪNG THỊ TRƯỜNG", style: "sSection", mergeAcross: 4 }]);
    s1Rows.push([
      { value: "Thị trường", style: "sHeader" },
      { value: "Hàng đã ship (CNY)", style: "sHeader" },
      { value: "Đã thanh toán (CNY)", style: "sHeader" },
      { value: "Hàng đang BH (treo)", style: "sHeader" },
      { value: "Còn phải trả (CNY)", style: "sHeader" },
    ]);
    targetMarkets.forEach(mName => {
      const ms = marketSummaries[mName];
      const warrantyCNY = calcWarrantyPendingValueCNY(mName, warranties, products, settings);
      const owed = Math.max(0, ms.shippedCNY - ms.paidCNY - warrantyCNY);
      s1Rows.push([
        { value: mName, style: "sLabel" },
        { value: Math.round(ms.shippedCNY), style: "sCellNum" },
        { value: Math.round(ms.paidCNY), style: "sCellNum" },
        { value: Math.round(warrantyCNY), style: warrantyCNY > 0 ? "sCellNum" : "sCellNum" },
        { value: Math.round(owed), style: owed > 0 ? "sRed" : "sCellNum" },
      ]);
    });
  }

  const sheet1 = xmlWorksheet("Tổng hợp", s1Rows, [240, 140, 140, 140, 140]);

  // === SHEET 2: CHI TIẾT LÔ HÀNG ĐÃ NHẬN ===
  const s2Rows = [];
  const titleSuffix = isAllMarkets ? "TẤT CẢ THỊ TRƯỜNG" : marketName;
  s2Rows.push([{ value: `CHI TIẾT LÔ HÀNG ĐÃ NHẬN — ${titleSuffix}`, style: "sTitle", mergeAcross: 15 }]);
  s2Rows.push([]);
  // Cột "Thị trường" có khi xuất tất cả; bỏ khi xuất 1 thị trường
  const s2Headers = (isAllMarkets ? ["Thị trường"] : []).concat([
    "Mã đơn giao hàng", "Ngày xuất", "Ngày về kho TT", "Trạng thái", "Kho nhận",
    "NCC", "Mã PO", "SKU", "Tên SP", "SL giao", "SL nhận", "Đơn giá",
    "Thành tiền", "Tiền tệ PO", "Quy đổi CNY", "Quy đổi VND"
  ]);
  s2Rows.push(s2Headers.map(h => ({ value: h, style: "sHeader" })));

  let s2TotalCNY = 0;
  // v38c: Sort shipments theo departDate desc
  sortByDateDesc(allTargetShipments, "departDate", "id").forEach(s => {
    const isArrived = s.status === "Đã về kho";
    const whName = s.warehouseId ? (getWarehouseName(s.warehouseId, markets) || "") : "";
    (s.items || []).forEach((it, idx) => {
      const po = pos.find(p => p.id === it.poId);
      if (!po) return;
      const factory = factories.find(f => f.id === po.factoryId);
      const poItems = getPOItems(po);
      const poItem = po.items ? poItems.find(x => x.id === it.itemId) : poItems[0];
      if (!poItem) return;
      const prod = products.find(p => p.id === poItem.productId);
      const shippedQty = Number(it.quantity || 0);
      const receivedQty = isArrived ? Number(it.receivedQty ?? shippedQty) : shippedQty;
      const unitPrice = Number(poItem.unitPrice || 0);
      const lineValPo = shippedQty * unitPrice;
      const lineValCNY = calcLineValueCNY(poItem, shippedQty, po.currency);
      const lineValVND = lineValCNY * (settings.cnyToVnd || 1);
      s2TotalCNY += lineValCNY;

      const row = [];
      if (isAllMarkets) row.push({ value: idx === 0 ? s.market : "", style: "sCell" });
      row.push(
        { value: idx === 0 ? s.id : "", style: "sCell" },
        { value: idx === 0 ? (s.departDate || "") : "", style: "sCell" },
        { value: idx === 0 ? (s.actualArriveDate || s.arriveDate || "") : "", style: "sCell" },
        { value: idx === 0 ? s.status : "", style: "sCell" },
        { value: idx === 0 ? whName : "", style: "sCell" },
        { value: factory?.name || "", style: "sCell" },
        { value: it.poId, style: "sCell" },
        { value: prod?.sku || "", style: "sCell" },
        { value: prod?.name || "", style: "sCell" },
        { value: shippedQty, style: "sCellNum" },
        { value: receivedQty, style: "sCellNum" },
        { value: unitPrice, style: "sCellNum" },
        { value: Math.round(lineValPo), style: "sCellNum" },
        { value: po.currency, style: "sCell" },
        { value: Math.round(lineValCNY), style: "sCellNum" },
        { value: Math.round(lineValVND), style: "sCellNum" },
      );
      s2Rows.push(row);
    });
  });
  if (allTargetShipments.length === 0) {
    s2Rows.push([{ value: "(Không có lô nào trong kỳ)", style: "sSubtitle", mergeAcross: s2Headers.length - 1 }]);
  } else {
    const totalRow = [];
    const totalLabelMerge = isAllMarkets ? 13 : 12; // mergeAcross = số cột phía trước - 1
    totalRow.push({ value: "TỔNG CỘNG", style: "sTotalLabel", mergeAcross: totalLabelMerge });
    totalRow.push({ value: Math.round(s2TotalCNY), style: "sTotal" });
    totalRow.push({ value: Math.round(s2TotalCNY * (settings.cnyToVnd || 1)), style: "sTotal" });
    s2Rows.push(totalRow);
  }

  const s2ColWidths = (isAllMarkets ? [85] : []).concat([100, 75, 75, 95, 130, 150, 110, 75, 170, 60, 60, 65, 90, 55, 100, 120]);
  const sheet2 = xmlWorksheet("Chi tiết lô", s2Rows, s2ColWidths);

  // === SHEET 3: LỊCH SỬ THANH TOÁN CHO NCC ===
  const s3Rows = [];
  s3Rows.push([{ value: `LỊCH SỬ THANH TOÁN CHO NCC — ${titleSuffix}`, style: "sTitle", mergeAcross: 10 }]);
  s3Rows.push([]);
  // v38c: Thêm cột "Stage" giữa "Tỷ giá" và "Quy đổi CNY"
  const s3Headers = (isAllMarkets ? ["Thị trường"] : []).concat([
    "Mã TT", "Ngày", "NCC nhận", "Số tiền", "Tiền tệ", "Tỷ giá → VND",
    "Stage", "Quy đổi CNY", "Quy đổi VND", "Người TT", "Ghi chú"
  ]);
  s3Rows.push(s3Headers.map(h => ({ value: h, style: "sHeader" })));

  let s3TotalCNY = 0, s3TotalVND = 0;
  // v38c: Tách stage 3 vs stage 1+2 để khớp với sheet 1 (Tổng hợp) sau Cách B
  let s3PaidCNY = 0, s3PaidVND = 0;        // chỉ stage Hoàn tất
  let s3PendingCNY = 0, s3PendingVND = 0;  // stage 1+2
  // v38c: Sort theo payDate desc (mới nhất trên đầu, tie-break ID)
  sortByDateDesc(allTargetPayments, "payDate", "id").forEach(p => {
    const factory = factories.find(f => f.id === p.toFactoryId);
    const payRate = settings[`${(p.currency || "VND").toLowerCase()}ToVnd`] || 1;
    const vnd = Number(p.amount || 0) * payRate;
    const cny = vnd / (settings.cnyToVnd || 1);
    s3TotalCNY += cny;
    s3TotalVND += vnd;

    // v38c: Phân loại theo stage
    const stage = p.paymentStage || "completed";
    const stageInfo = PAYMENT_STAGES[stage] || PAYMENT_STAGES.completed;
    const stageLabel = `${stageInfo.icon} ${stageInfo.short}`;
    if (stage === "completed") {
      s3PaidCNY += cny;
      s3PaidVND += vnd;
    } else {
      s3PendingCNY += cny;
      s3PendingVND += vnd;
    }

    const row = [];
    if (isAllMarkets) row.push({ value: p.fromMarket || "", style: "sCell" });
    row.push(
      { value: p.id, style: "sCell" },
      { value: p.payDate || "", style: "sCell" },
      { value: factory?.name || "-", style: "sCell" },
      { value: Number(p.amount || 0), style: "sCellNum" },
      { value: p.currency, style: "sCell" },
      { value: payRate, style: "sCellNum" },
      { value: stageLabel, style: "sCell" },
      { value: Math.round(cny), style: "sCellNum" },
      { value: Math.round(vnd), style: "sCellNum" },
      { value: p.payer || "-", style: "sCell" },
      { value: p.note || "", style: "sCell" },
    );
    s3Rows.push(row);
  });
  if (allTargetPayments.length === 0) {
    s3Rows.push([{ value: "(Không có thanh toán nào trong kỳ)", style: "sSubtitle", mergeAcross: s3Headers.length - 1 }]);
  } else {
    s3Rows.push([]);
    // v38c: Total label cần merge thêm 1 cột vì có cột Stage mới (8 thay vì 7)
    const totalLabelMerge = isAllMarkets ? 8 : 7;
    s3Rows.push([
      { value: "TỔNG CỘNG (tất cả stage)", style: "sTotalLabel", mergeAcross: totalLabelMerge },
      { value: Math.round(s3TotalCNY), style: "sTotal" },
      { value: Math.round(s3TotalVND), style: "sTotal" },
      { value: "", style: "sTotalLabel", mergeAcross: 1 },
    ]);
    // v38c: Hiển thị thêm số đang TT (stage 1+2) — khớp với sheet 1 dòng (3a)
    if (s3PendingCNY > 0) {
      s3Rows.push([
        { value: "🟡 Trong đó đang TT (stage 1+2)", style: "sTotalLabel", mergeAcross: totalLabelMerge },
        { value: Math.round(s3PendingCNY), style: "sTotal" },
        { value: Math.round(s3PendingVND), style: "sTotal" },
        { value: "Tiền treo, NCC chưa nhận", style: "sTotalLabel" },
      ]);
    }
    s3Rows.push([
      { value: "✅ Đã trả thực sự (chỉ stage Hoàn tất)", style: "sTotalLabel", mergeAcross: totalLabelMerge },
      { value: Math.round(s3PaidCNY), style: "sTotal" },
      { value: Math.round(s3PaidVND), style: "sTotal" },
      { value: "Khớp dòng (3) sheet Tổng hợp", style: "sTotalLabel" },
    ]);
  }
  // v38c: Thêm 1 cột Stage → s3ColWidths cần thêm 1 width
  const s3ColWidths = (isAllMarkets ? [85] : []).concat([110, 80, 170, 100, 60, 95, 110, 110, 130, 110, 200]);
  const sheet3 = xmlWorksheet("Lịch sử thanh toán", s3Rows, s3ColWidths);

  // === SHEET 4: CÔNG NỢ THEO TỪNG NHÀ CUNG CẤP ===
  const s4Rows = [];
  s4Rows.push([{ value: `CÔNG NỢ THEO TỪNG NHÀ CUNG CẤP — ${titleSuffix}`, style: "sTitle", mergeAcross: 7 }]);
  s4Rows.push([]);
  const s4Headers = (isAllMarkets ? ["Thị trường"] : []).concat([
    "NCC", "Mã NCC", "Quốc gia", "Hàng đã ship (CNY)",
    "Đã trả (CNY)", "Còn phải trả (CNY)", "% Đã trả"
  ]);
  s4Rows.push(s4Headers.map(h => ({ value: h, style: "sHeader" })));

  // Group: Map<marketName, Map<factoryId, { received, paid }>>
  const marketFactoryMap = new Map();
  targetMarkets.forEach(mName => marketFactoryMap.set(mName, new Map()));

  // v15: Tính theo SL đã ship (không filter "Đã về kho") để đồng bộ với UI
  allTargetShipments.forEach(s => {
    (s.items || []).forEach(it => {
      const po = pos.find(p => p.id === it.poId);
      if (!po) return;
      const poItems = getPOItems(po);
      const poItem = po.items ? poItems.find(x => x.id === it.itemId) : poItems[0];
      if (!poItem) return;
      const shippedQty = Number(it.quantity || 0);
      const valCNY = calcLineValueCNY(poItem, shippedQty, po.currency);
      const facMap = marketFactoryMap.get(s.market);
      if (!facMap.has(po.factoryId)) facMap.set(po.factoryId, { received: 0, paid: 0 });
      facMap.get(po.factoryId).received += valCNY;
    });
  });
  allTargetPayments.forEach(p => {
    const factoryId = p.toFactoryId;
    if (!factoryId) return;
    const vnd = toVND(Number(p.amount || 0), p.currency, settings);
    const cny = vnd / (settings.cnyToVnd || 1);
    const facMap = marketFactoryMap.get(p.fromMarket);
    if (!facMap) return;
    if (!facMap.has(factoryId)) facMap.set(factoryId, { received: 0, paid: 0 });
    facMap.get(factoryId).paid += cny;
  });

  let s4HasData = false;
  let s4TotalReceived = 0, s4TotalPaid = 0, s4TotalOwed = 0;
  targetMarkets.forEach(mName => {
    const facMap = marketFactoryMap.get(mName);
    if (facMap.size === 0) return;
    // Sắp xếp giảm dần theo còn nợ
    const entries = Array.from(facMap.entries())
      .map(([fid, data]) => ({ factory: factories.find(f => f.id === fid), ...data }))
      .filter(e => e.factory)
      .sort((a, b) => (b.received - b.paid) - (a.received - a.paid));
    entries.forEach(e => {
      const owed = Math.max(0, e.received - e.paid);
      const pct = e.received > 0 ? (e.paid / e.received) * 100 : 0;
      s4HasData = true;
      s4TotalReceived += e.received;
      s4TotalPaid += e.paid;
      s4TotalOwed += owed;
      const row = [];
      if (isAllMarkets) row.push({ value: mName, style: "sCell" });
      row.push(
        { value: e.factory.name, style: "sCell" },
        { value: e.factory.supplierCode || "-", style: "sCell" },
        { value: e.factory.country || "-", style: "sCell" },
        { value: Math.round(e.received), style: "sCellNum" },
        { value: Math.round(e.paid), style: "sCellNum" },
        { value: Math.round(owed), style: owed > 0 ? "sRed" : "sCellNum" },
        { value: `${pct.toFixed(1)}%`, style: "sCell", forceString: true },
      );
      s4Rows.push(row);
    });
  });
  if (!s4HasData) {
    s4Rows.push([{ value: "(Chưa có hàng nào ship về thị trường)", style: "sSubtitle", mergeAcross: s4Headers.length - 1 }]);
  } else {
    s4Rows.push([]);
    const totalLabelMerge = isAllMarkets ? 4 : 3;
    s4Rows.push([
      { value: "TỔNG CỘNG", style: "sTotalLabel", mergeAcross: totalLabelMerge },
      { value: Math.round(s4TotalReceived), style: "sTotal" },
      { value: Math.round(s4TotalPaid), style: "sTotal" },
      { value: Math.round(s4TotalOwed), style: "sTotal" },
      { value: "", style: "sTotalLabel" },
    ]);
  }
  const s4ColWidths = (isAllMarkets ? [85] : []).concat([180, 90, 110, 120, 120, 130, 80]);
  const sheet4 = xmlWorksheet("Công nợ theo NCC", s4Rows, s4ColWidths);

  // === SHEET 5: TỒN KHO THEO SKU (chỉ tính hàng đã về kho) ===
  const s5Rows = [];
  s5Rows.push([{ value: `TỒN KHO THEO SKU — ${titleSuffix}`, style: "sTitle", mergeAcross: 6 }]);
  s5Rows.push([]);
  s5Rows.push([{ value: "Tổng hợp những SKU đã về kho thị trường — phục vụ kế toán đối chiếu kho thực tế", style: "sSubtitle", mergeAcross: 6 }]);
  s5Rows.push([]);
  const s5Headers = (isAllMarkets ? ["Thị trường"] : []).concat([
    "SKU", "Tên sản phẩm", "NCC", "Tổng SL nhận",
    "Đơn giá TB (CNY)", "Tổng giá trị (CNY)", "Tổng giá trị (VND)"
  ]);
  s5Rows.push(s5Headers.map(h => ({ value: h, style: "sHeader" })));

  // Group: Map<marketName, Map<productId, { totalQty, totalValueCNY, factoryIds: Set }>>
  const marketSkuMap = new Map();
  targetMarkets.forEach(mName => marketSkuMap.set(mName, new Map()));

  allTargetShipments.forEach(s => {
    if (s.status !== "Đã về kho") return;
    (s.items || []).forEach(it => {
      const po = pos.find(p => p.id === it.poId);
      if (!po) return;
      const poItems = getPOItems(po);
      const poItem = po.items ? poItems.find(x => x.id === it.itemId) : poItems[0];
      if (!poItem) return;
      const receivedQty = Number(it.receivedQty ?? it.quantity ?? 0);
      if (receivedQty <= 0) return;
      const valCNY = calcLineValueCNY(poItem, receivedQty, po.currency);
      const skuMap = marketSkuMap.get(s.market);
      const productId = poItem.productId;
      if (!skuMap.has(productId)) skuMap.set(productId, { totalQty: 0, totalValueCNY: 0, factoryId: po.factoryId });
      const entry = skuMap.get(productId);
      entry.totalQty += receivedQty;
      entry.totalValueCNY += valCNY;
    });
  });

  let s5HasData = false;
  let s5TotalQty = 0, s5TotalValueCNY = 0;
  targetMarkets.forEach(mName => {
    const skuMap = marketSkuMap.get(mName);
    const entries = Array.from(skuMap.entries())
      .map(([pid, data]) => ({ product: products.find(p => p.id === pid), ...data }))
      .filter(e => e.product)
      .sort((a, b) => b.totalValueCNY - a.totalValueCNY);
    entries.forEach(e => {
      const factory = factories.find(f => f.id === e.factoryId);
      const avgPriceCNY = e.totalQty > 0 ? e.totalValueCNY / e.totalQty : 0;
      s5HasData = true;
      s5TotalQty += e.totalQty;
      s5TotalValueCNY += e.totalValueCNY;
      const row = [];
      if (isAllMarkets) row.push({ value: mName, style: "sCell" });
      row.push(
        { value: e.product.sku, style: "sCell" },
        { value: e.product.name, style: "sCell" },
        { value: factory?.name || "-", style: "sCell" },
        { value: e.totalQty, style: "sCellNum" },
        { value: Math.round(avgPriceCNY * 100) / 100, style: "sCellNum" },
        { value: Math.round(e.totalValueCNY), style: "sCellNum" },
        { value: Math.round(e.totalValueCNY * (settings.cnyToVnd || 1)), style: "sCellNum" },
      );
      s5Rows.push(row);
    });
  });
  if (!s5HasData) {
    s5Rows.push([{ value: "(Chưa có hàng nào về kho thị trường)", style: "sSubtitle", mergeAcross: s5Headers.length - 1 }]);
  } else {
    s5Rows.push([]);
    const totalLabelMerge = isAllMarkets ? 4 : 3;
    s5Rows.push([
      { value: "TỔNG CỘNG", style: "sTotalLabel", mergeAcross: totalLabelMerge },
      { value: s5TotalQty, style: "sTotal" },
      { value: "", style: "sTotalLabel" },
      { value: Math.round(s5TotalValueCNY), style: "sTotal" },
      { value: Math.round(s5TotalValueCNY * (settings.cnyToVnd || 1)), style: "sTotal" },
    ]);
  }
  const s5ColWidths = (isAllMarkets ? [85] : []).concat([80, 200, 170, 100, 110, 130, 140]);
  const sheet5 = xmlWorksheet("Tồn kho theo SKU", s5Rows, s5ColWidths);

  // v38i: Sheet 6 — Chi tiết OB theo NCC (mỗi OB là TT này nợ NCC nào bao nhiêu)
  const s6Rows = [];
  const s6Title = isAllMarkets ? "CÔNG NỢ ĐẦU KỲ — TẤT CẢ TT — Chi tiết theo NCC" : `CÔNG NỢ ĐẦU KỲ — ${marketName} — Chi tiết theo NCC`;
  s6Rows.push([{ value: s6Title, style: "sTitle", mergeAcross: 7 }]);
  s6Rows.push([{ value: "(Mỗi dòng = 1 NCC mà TT này đang nợ)", style: "sCell", mergeAcross: 7 }]);
  s6Rows.push([]);
  s6Rows.push([
    { value: "Mã OB", style: "sHeader" },
    { value: "🌍 Thị trường", style: "sHeader" },
    { value: "🏭 NCC đang nợ", style: "sHeader" },
    { value: "Loại", style: "sHeader" },
    { value: "Ngày", style: "sHeader" },
    { value: "Số tiền", style: "sHeader" },
    { value: "Tiền tệ", style: "sHeader" },
    { value: "Ghi chú", style: "sHeader" },
  ]);
  const targetOB = (openingBalances || []).filter(o =>
    targetMarkets.includes(o.market) && o.status !== "cancelled"
  );
  if (targetOB.length === 0) {
    s6Rows.push([{ value: "(Không có công nợ đầu kỳ)", style: "sCell", mergeAcross: 7 }]);
  } else {
    sortByDateDesc(targetOB, "date", "id").forEach(o => {
      const fName = factories.find(f => f.id === o.factoryId)?.name || "(NCC không tồn tại)";
      s6Rows.push([
        { value: o.id, style: "sCell" },
        { value: o.market || "(Chưa chọn)", style: "sCell" },
        { value: fName, style: "sCell" },
        { value: o.type === "debt" ? "Nợ gốc" : "Quỹ tín dụng", style: o.type === "debt" ? "sRed" : "sGreen" },
        { value: o.date, style: "sCell" },
        { value: Number(o.amount || 0), style: "sCellNum" },
        { value: o.currency || "CNY", style: "sCell" },
        { value: o.note || "", style: "sCell" },
      ]);
    });
    // Tổng hợp theo cặp TT × NCC
    s6Rows.push([]);
    s6Rows.push([{ value: "TỔNG HỢP THEO CẶP TT × NCC (CNY)", style: "sSection", mergeAcross: 7 }]);
    s6Rows.push([
      { value: "🌍 TT", style: "sHeader" },
      { value: "🏭 NCC", style: "sHeader" },
      { value: "Tổng nợ gốc (CNY)", style: "sHeader" },
      { value: "Tổng quỹ TD (CNY)", style: "sHeader" },
      { value: "", style: "sHeader" },
      { value: "", style: "sHeader" },
      { value: "", style: "sHeader" },
      { value: "", style: "sHeader" },
    ]);
    const byPair = {};
    targetOB.forEach(o => {
      const key = `${o.market}|${o.factoryId}`;
      if (!byPair[key]) byPair[key] = { market: o.market, factoryId: o.factoryId, debt: 0, credit: 0 };
      const cny = toVND(Number(o.amount || 0), o.currency || "CNY", settings) / settings.cnyToVnd;
      if (o.type === "debt") byPair[key].debt += cny;
      else byPair[key].credit += cny;
    });
    Object.values(byPair).forEach(v => {
      const fName = factories.find(f => f.id === v.factoryId)?.name || "(NCC không tồn tại)";
      s6Rows.push([
        { value: v.market || "(Chưa chọn)", style: "sLabel" },
        { value: fName, style: "sLabel" },
        { value: Math.round(v.debt), style: v.debt > 0 ? "sRed" : "sCellNum" },
        { value: Math.round(v.credit), style: v.credit > 0 ? "sGreen" : "sCellNum" },
        { value: "", style: "sCell" },
        { value: "", style: "sCell" },
        { value: "", style: "sCell" },
        { value: "", style: "sCell" },
      ]);
    });
  }
  const sheet6 = xmlWorksheet("OB theo NCC", s6Rows, [90, 110, 160, 100, 75, 110, 60, 220]);

  // === Build file ===
  const allSheets = [sheet1, sheet2, sheet3, sheet4, sheet5, sheet6].join("\n");
  const safeMarketName = (isAllMarkets ? "TatCa" : (marketName || "ThiTruong")).replace(/[^A-Za-z0-9_-]/g, "_");
  const today = new Date().toISOString().slice(0, 10);
  const filename = `BaoCao_CongNo_ThiTruong_${safeMarketName}_${today}.xls`;
  downloadXlsFile(allSheets, filename);
  return filename;
};

// ============================================================
// v37: EXPORT PO DETAIL REPORT — Báo cáo chi tiết đơn đặt hàng (.xlsx)
// ============================================================
// Mỗi SP trong PO = 1 dòng. 1 PO có thể có nhiều dòng.
// File 2 sheet: "Chi tiết PO" (mỗi SP 1 dòng) + "Tổng hợp" (mỗi PO 1 dòng).
// Cột:
//  1. Mã PO
//  2. Ngày tạo PO (orderDate)
//  3. Ngày duyệt (approvedAt)
//  4. Người duyệt (approvedBy)
//  5. Trạng thái (Chờ duyệt / Đã duyệt / Hủy)
//  6. Mã NCC
//  7. Tên NCC
//  8. SKU
//  9. Tên SP
// 10. SL đặt
// 11. Đơn giá
// 12. Tiền tệ (gắn theo NCC)
// 13. Thành tiền (qty × đơn giá)
// 14. Ngày dự kiến giao (expectedDate)
// 15. SL đã giao (cộng từ shipments — loại Hủy + Nháp)
// 16. SL còn lại (đặt − đã giao)
// 17. Đã giao về thị trường (text dạng "VN: 100; TH: 50")
// 18. Đã giao về kho (text dạng "Kho HCM: 80; Kho HN: 20")
// 19. Số lô liên quan (đếm shipments đụng tới PO này, không tính Hủy/Nháp)
// 20. Trạng thái lô (text dạng "2 đã về kho · 1 đang VC · 1 chờ xuất")
const exportPOReport = async ({ pos, factories, products, shipments, markets, settings, dateFrom, dateTo, factoryFilter, statusFilter, exportedBy }) => {
  // 1. Lọc PO theo filter từ tab (giống logic trong POs component)
  let filtered = filterByDateRange(pos, "orderDate", dateFrom, dateTo);
  if (factoryFilter) filtered = filtered.filter(p => p.factoryId === factoryFilter);
  if (statusFilter) filtered = filtered.filter(p => (p.status || "") === statusFilter);
  // v38c: Sort theo orderDate desc — đồng bộ với UI tab Đặt hàng (V38b)
  filtered = sortByDateDesc(filtered, "orderDate", "id");

  // 2. Header
  const detailHeader = [
    "Mã PO", "Ngày tạo PO", "Ngày duyệt", "Người duyệt", "Trạng thái",
    "Mã NCC", "Tên NCC",
    "SKU", "Tên SP",
    "SL đặt", "Đơn giá", "Tiền tệ", "Thành tiền",
    "Ngày dự kiến giao",
    "SL đã giao", "SL còn lại",
    "Đã giao về thị trường", "Đã giao về kho",
    "Số lô liên quan", "Trạng thái lô"
  ];

  // 3. Build rows — mỗi (PO × SP) = 1 dòng
  const detailRows = [];
  const summaryRows = [];

  filtered.forEach(po => {
    const factory = factories.find(f => f.id === po.factoryId);
    const factoryName = factory?.name || "—";
    const factoryCode = factory?.supplierCode || "—";
    const poCurrency = factory?.currency || po.currency || "CNY";

    const poItems = getPOItems(po);
    const statusLabel = po.status || (po.approved ? "Đã duyệt" : "Chờ duyệt");

    // Tổng SL ship cho cả PO + breakdown theo market/warehouse/status
    let totalShippedAllItems = 0;
    let totalQtyAllItems = 0;
    const poShipments = shipments.filter(s =>
      isOperationalShipment(s) && (s.items || []).some(i => i.poId === po.id)
    );

    // Status breakdown của PO (số shipment theo status)
    const statusCount = {};
    poShipments.forEach(s => {
      statusCount[s.status] = (statusCount[s.status] || 0) + 1;
    });
    const statusText = Object.entries(statusCount).map(([k, v]) => `${v} ${k}`).join(" · ") || "—";

    poItems.forEach(it => {
      const product = products.find(p => p.id === it.productId);
      const sku = product?.sku || "(không tìm thấy SP)";
      const name = product?.name || "—";
      const qty = Number(it.quantity || 0);
      const unitPrice = Number(it.unitPrice || 0);
      const lineValue = qty * unitPrice;
      const shipped = po.items ? shippedFromItem(po.id, it.id, shipments) : shippedFromPO(po.id, shipments);
      // Lưu ý: shippedFromItem KHÔNG loại Nháp/Hủy → cần lọc lại
      // Vì shippedFromPO đã loại còn shippedFromItem chưa → tính lại đúng:
      const shippedClean = shipments
        .filter(isOperationalShipment)
        .flatMap(s => s.items || [])
        .filter(i => i.poId === po.id && i.itemId === it.id)
        .reduce((sum, i) => sum + Number(i.quantity || 0), 0);
      const remaining = Math.max(0, qty - shippedClean);

      // Breakdown theo market & warehouse cho item này
      const marketBreakdown = {}; // {marketName: qty}
      const warehouseBreakdown = {}; // {warehouseLabel: qty}
      shipments.filter(isOperationalShipment).forEach(s => {
        (s.items || []).forEach(si => {
          if (si.poId !== po.id || si.itemId !== it.id) return;
          const q = Number(si.quantity || 0);
          if (q <= 0) return;
          const market = s.market || "(chưa rõ)";
          marketBreakdown[market] = (marketBreakdown[market] || 0) + q;
          // Warehouse name (kèm flag market)
          const whName = s.warehouseId ? getWarehouseName(s.warehouseId, markets || []) : "";
          // Ở đây dùng s.warehouseId làm key fallback
          const whKey = whName || s.warehouseId || "(chưa gán kho)";
          warehouseBreakdown[whKey] = (warehouseBreakdown[whKey] || 0) + q;
        });
      });
      const marketText = Object.entries(marketBreakdown).map(([k, v]) => `${k}: ${v}`).join("; ") || "—";
      const warehouseText = Object.entries(warehouseBreakdown).map(([k, v]) => `${k}: ${v}`).join("; ") || "—";

      detailRows.push([
        po.id,
        po.orderDate || "",
        po.approvedAt || "",
        po.approvedBy || "",
        statusLabel,
        factoryCode, factoryName,
        sku, name,
        qty, unitPrice, poCurrency, lineValue,
        po.expectedDate || "",
        shippedClean, remaining,
        marketText, warehouseText,
        poShipments.length,
        statusText,
      ]);

      totalShippedAllItems += shippedClean;
      totalQtyAllItems += qty;
    });

    // Summary row cho PO này (1 dòng / PO)
    const totalValue = poTotalValue(po);
    const totalRemaining = Math.max(0, totalQtyAllItems - totalShippedAllItems);
    const completionPct = totalQtyAllItems > 0 ? Math.round((totalShippedAllItems / totalQtyAllItems) * 100) : 0;

    // Aggregate market/warehouse breakdown cho cả PO
    const allMarkets = {};
    const allWarehouses = {};
    poShipments.forEach(s => {
      const market = s.market || "(chưa rõ)";
      const whName = s.warehouseId ? getWarehouseName(s.warehouseId, markets || []) : "";
      const whKey = whName || s.warehouseId || "(chưa gán)";
      let totalShipQty = 0;
      (s.items || []).forEach(si => { if (si.poId === po.id) totalShipQty += Number(si.quantity || 0); });
      if (totalShipQty > 0) {
        allMarkets[market] = (allMarkets[market] || 0) + totalShipQty;
        allWarehouses[whKey] = (allWarehouses[whKey] || 0) + totalShipQty;
      }
    });
    const summaryMarketText = Object.entries(allMarkets).map(([k, v]) => `${k}: ${v}`).join("; ") || "—";
    const summaryWhText = Object.entries(allWarehouses).map(([k, v]) => `${k}: ${v}`).join("; ") || "—";

    summaryRows.push([
      po.id,
      po.orderDate || "",
      po.approvedAt || "",
      statusLabel,
      factoryCode, factoryName,
      poItems.length, // Số SP trong PO
      totalQtyAllItems, // Tổng SL đặt
      totalValue, // Tổng giá trị
      poCurrency,
      po.expectedDate || "",
      totalShippedAllItems, // Tổng SL đã giao
      totalRemaining, // Tổng còn lại
      `${completionPct}%`,
      summaryMarketText,
      summaryWhText,
      poShipments.length,
      statusText,
    ]);
  });

  // 4. Build Excel workbook
  const wb = XLSX.utils.book_new();

  // Sheet 1: Chi tiết
  const detailWs = XLSX.utils.aoa_to_sheet([
    [`📊 BÁO CÁO CHI TIẾT ĐƠN ĐẶT HÀNG (PO)`],
    [`Xuất bởi: ${exportedBy || "—"} · Ngày xuất: ${new Date().toLocaleString("vi-VN")}`],
    [`Tổng số PO: ${filtered.length} · Tổng số dòng SP: ${detailRows.length}`],
    [`Bộ lọc: ${factoryFilter ? `NCC = ${factories.find(f => f.id === factoryFilter)?.name || factoryFilter}` : "Tất cả NCC"} · ${dateFrom ? `Từ ${dateFrom}` : ""}${dateTo ? ` Đến ${dateTo}` : ""}${(!dateFrom && !dateTo) ? "Tất cả thời gian" : ""}${statusFilter ? ` · TT: ${statusFilter}` : ""}`],
    [],
    detailHeader,
    ...detailRows,
  ]);
  // Column widths
  detailWs["!cols"] = [
    { wch: 16 }, { wch: 11 }, { wch: 11 }, { wch: 14 }, { wch: 12 },
    { wch: 10 }, { wch: 22 },
    { wch: 12 }, { wch: 28 },
    { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 14 },
    { wch: 11 },
    { wch: 10 }, { wch: 10 },
    { wch: 30 }, { wch: 30 },
    { wch: 8 }, { wch: 30 },
  ];
  // Merge title across columns
  detailWs["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 19 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 19 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 19 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 19 } },
  ];
  XLSX.utils.book_append_sheet(wb, detailWs, "Chi tiết PO");

  // Sheet 2: Tổng hợp
  const summaryHeader = [
    "Mã PO", "Ngày tạo", "Ngày duyệt", "Trạng thái",
    "Mã NCC", "Tên NCC",
    "Số SP", "Tổng SL đặt", "Tổng giá trị", "Tiền tệ",
    "Ngày dự kiến", "Tổng SL đã giao", "Tổng SL còn lại", "Tỷ lệ hoàn thành",
    "Đã giao về thị trường", "Đã giao về kho",
    "Số lô", "Trạng thái lô"
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet([
    [`📋 TỔNG HỢP ĐƠN ĐẶT HÀNG (mỗi PO 1 dòng)`],
    [`Tổng số PO: ${filtered.length}`],
    [],
    summaryHeader,
    ...summaryRows,
  ]);
  summaryWs["!cols"] = [
    { wch: 16 }, { wch: 11 }, { wch: 11 }, { wch: 12 },
    { wch: 10 }, { wch: 22 },
    { wch: 7 }, { wch: 10 }, { wch: 14 }, { wch: 8 },
    { wch: 11 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 30 }, { wch: 30 },
    { wch: 7 }, { wch: 30 },
  ];
  summaryWs["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 17 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 17 } },
  ];
  XLSX.utils.book_append_sheet(wb, summaryWs, "Tổng hợp");

  // 5. Generate filename + download
  const today = new Date().toISOString().slice(0, 10);
  const safeFactory = factoryFilter ? `_${(factories.find(f => f.id === factoryFilter)?.supplierCode || "NCC").replace(/[^A-Za-z0-9_-]/g, "_")}` : "";
  const filename = `BaoCao_PO${safeFactory}_${today}.xlsx`;
  XLSX.writeFile(wb, filename);
  return filename;
};

// Permission check
const can = (user, perm) => {
  if (!user || user.status !== "active") return false;
  if (user.role === "admin") return true;
  const perms = user.permissions || DEFAULT_ROLE_PERMS[user.role] || [];
  return perms.includes(perm);
};

// Audit log helper
const logAudit = (action, target, user, detail = {}) => ({
  id: `LOG-${Date.now()}-${uid()}`,
  timestamp: new Date().toISOString(),
  userId: user?.id,
  userName: user?.fullName || user?.username,
  action,
  target,
  detail: JSON.stringify(detail),
});

// ============================================================
// DESIGN TOKENS — Green theme
// ============================================================
const C = {
  // Greens (primary)
  green50: "#E8F3E8",
  green100: "#D4E9D4",
  green200: "#A8D3A8",
  green300: "#7CBC7C",
  green400: "#5BA55B",
  green500: "#3E8E3E",     // primary
  green600: "#2F7A2F",
  green700: "#1F5E1F",
  green800: "#0F3D0F",
  // Accent
  gold: "#C9A84C",
  red: "#E74C3C",
  redBg: "#FADBD8",
  orange: "#F39C12",
  orangeBg: "#FCEBD0",
  blue: "#3498DB",
  blueBg: "#D6EAF8",
  purple: "#9B59B6",
  purpleBg: "#E8DAEF",
  // UI
  bg: "#F5F9F5",
  white: "#FFFFFF",
  text: "#1C3A1C",
  textMuted: "#5A6D5A",
  textLight: "#8FA08F",
  border: "#D4E0D4",
  borderLight: "#E8F0E8",
  // Sidebar
  sidebar: "#1F3D1F",
  sidebarHover: "#2D522D",
};

const CHART_GREENS = ["#3E8E3E", "#5BA55B", "#7CBC7C", "#A8D3A8", "#D4E9D4", "#2F7A2F", "#1F5E1F"];
const CHART_MIX = ["#3E8E3E", "#5BA55B", "#7CBC7C", "#A8D3A8", "#C9A84C"];

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${C.bg}; color: ${C.text}; font-family: 'Be Vietnam Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: ${C.bg}; }
  ::-webkit-scrollbar-thumb { background: ${C.green200}; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: ${C.green300}; }

  input, select, textarea {
    background: ${C.white}; border: 1px solid ${C.border}; color: ${C.text};
    font-family: 'Be Vietnam Pro', sans-serif; font-size: 13px; padding: 9px 12px; border-radius: 8px;
    outline: none; width: 100%; transition: all 0.15s;
  }
  input:focus, select:focus, textarea:focus { border-color: ${C.green500}; box-shadow: 0 0 0 3px ${C.green50}; }
  input:disabled, select:disabled { background: ${C.bg}; cursor: not-allowed; opacity: 0.6; }
  select option { background: ${C.white}; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th {
    background: ${C.green50}; color: ${C.green700}; font-weight: 600;
    text-transform: uppercase; font-size: 10.5px; letter-spacing: 0.06em;
    padding: 12px 16px; text-align: left; border-bottom: 2px solid ${C.green500};
  }
  td { padding: 13px 16px; border-bottom: 1px solid ${C.borderLight}; color: ${C.text}; }
  tr:hover td { background: ${C.green50}; }
  tr.expanded td { background: ${C.green50}; }

  .badge { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 99px; font-size: 11px; font-weight: 600; }

  .btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 9px 16px; border-radius: 8px; border: none; cursor: pointer;
    font-family: 'Be Vietnam Pro', sans-serif; font-size: 13px; font-weight: 600; transition: all 0.15s;
  }
  .btn-primary { background: ${C.green500}; color: ${C.white}; box-shadow: 0 2px 6px ${C.green500}40; }
  .btn-primary:hover { background: ${C.green600}; }
  .btn-primary:disabled { background: ${C.textLight}; cursor: not-allowed; box-shadow: none; }
  .btn-ghost { background: ${C.white}; color: ${C.textMuted}; border: 1px solid ${C.border}; }
  .btn-ghost:hover { border-color: ${C.green500}; color: ${C.green600}; background: ${C.green50}; }
  .btn-danger { background: ${C.white}; color: ${C.red}; border: 1px solid ${C.redBg}; }
  .btn-danger:hover { background: ${C.redBg}; }
  .btn-purple { background: ${C.purple}; color: ${C.white}; }
  .btn-purple:hover { background: #8E44AD; }

  .card { background: ${C.white}; border: 1px solid ${C.border}; border-radius: 16px; padding: 20px; box-shadow: 0 2px 8px rgba(30, 60, 30, 0.04); }

  .card-green-header {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    background: ${C.green500}; color: ${C.white};
    padding: 8px 20px; border-radius: 20px; font-size: 13px; font-weight: 700;
    margin-bottom: 14px;
    box-shadow: 0 2px 6px ${C.green500}30;
  }

  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .form-group { display: flex; flex-direction: column; gap: 6px; }
  .form-group label { font-size: 11px; color: ${C.textMuted}; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }

  .modal-overlay {
    position: fixed; inset: 0; background: rgba(31, 61, 31, 0.4); backdrop-filter: blur(4px);
    z-index: 100; display: flex; align-items: center; justify-content: center; padding: 20px;
  }
  .modal { background: ${C.white}; border-radius: 20px; width: 100%; max-width: 760px; max-height: 92vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.2); }
  .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 22px 28px; border-bottom: 1px solid ${C.borderLight}; position: sticky; top: 0; background: ${C.white}; z-index: 2; border-radius: 20px 20px 0 0; }
  .modal-body { padding: 24px 28px; display: flex; flex-direction: column; gap: 16px; }
  .modal-footer { padding: 18px 28px; border-top: 1px solid ${C.borderLight}; display: flex; gap: 10px; justify-content: flex-end; position: sticky; bottom: 0; background: ${C.white}; border-radius: 0 0 20px 20px; }

  .progress-bar { height: 8px; background: ${C.green50}; border-radius: 4px; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }

  .alert { padding: 12px 16px; border-radius: 10px; font-size: 13px; line-height: 1.5; }
  .alert-info { background: ${C.blueBg}; color: #1B4F72; border: 1px solid ${C.blue}40; }
  .alert-warn { background: ${C.orangeBg}; color: #7E5109; border: 1px solid ${C.orange}40; }
  .alert-danger { background: ${C.redBg}; color: #922B21; border: 1px solid ${C.red}40; }
  .alert-success { background: ${C.green50}; color: ${C.green700}; border: 1px solid ${C.green300}; }

  /* v38g: Ẩn spinner ▲▼ của input number — tránh user click nhầm tăng/giảm số */
  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  input[type="number"] {
    -moz-appearance: textfield;
  }
`;

// ============================================================
// SHARED COMPONENTS
// ============================================================
const Badge = ({ label, color, bg }) => (
  <span className="badge" style={{ background: bg || color + "22", color }}>{label}</span>
);

const GreenPill = ({ children }) => (
  <div className="card-green-header">{children}</div>
);

const SectionHeader = ({ title, subtitle, action }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 800, color: C.green800, letterSpacing: "-0.02em" }}>{title}</h2>
      {subtitle && <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>{subtitle}</div>}
    </div>
    {action}
  </div>
);

// v27: SummaryBar — hiển thị 3-4 chỉ số tổng theo filter cho các tab cần
// items: [{ label, primary, secondary, color, icon }]
// hint: badge text giải thích filter đang áp dụng (vd: "📅 Đã lọc: T1/2026 · NCC F1") hoặc null
const SummaryBar = ({ items, hint }) => (
  <div className="card" style={{ padding: "10px 14px", marginBottom: 14, background: "linear-gradient(to right, #f0fdf4, #ffffff)" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.green800, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        📊 Tổng hợp
      </div>
      {hint && (
        <div style={{ fontSize: 10, color: C.textMuted, padding: "3px 8px", background: C.white, borderRadius: 99, border: `1px solid ${C.borderLight}` }}>
          {hint}
        </div>
      )}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 10 }}>
      {items.map((it, i) => (
        <div key={i} style={{
          padding: "8px 12px",
          background: C.white,
          borderRadius: 8,
          borderLeft: `3px solid ${it.color || C.green600}`,
          minHeight: 56,
        }}>
          <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 2 }}>
            {it.icon && <span style={{ marginRight: 4 }}>{it.icon}</span>}{it.label}
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: it.color || C.green700, lineHeight: 1.2 }}>
            {it.primary}
          </div>
          {it.secondary && (
            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 1 }}>
              {it.secondary}
            </div>
          )}
        </div>
      ))}
    </div>
  </div>
);

// v28: Pagination component dùng chung — Prev/Next + chọn page size + nhảy trang
const Pagination = ({ page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions = [25, 50, 100, 200] }) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const fromIdx = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const toIdx = Math.min(safePage * pageSize, total);

  const pages = useMemo(() => {
    const arr = [];
    const window = 2;
    const start = Math.max(1, safePage - window);
    const end = Math.min(totalPages, safePage + window);
    if (start > 1) arr.push(1);
    if (start > 2) arr.push("...");
    for (let i = start; i <= end; i++) arr.push(i);
    if (end < totalPages - 1) arr.push("...");
    if (end < totalPages) arr.push(totalPages);
    return arr;
  }, [safePage, totalPages]);

  if (total === 0) return null;

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 12, padding: "12px 16px", background: C.green50,
      borderTop: `1px solid ${C.borderLight}`, fontSize: 12, flexWrap: "wrap",
    }}>
      <div style={{ color: C.textMuted }}>
        Hiển thị <b>{fromIdx}</b>–<b>{toIdx}</b> / <b>{total.toLocaleString()}</b> dòng
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button className="btn btn-ghost" disabled={safePage === 1} onClick={() => onPageChange(1)}
          style={{ padding: "5px 9px", fontSize: 11, opacity: safePage === 1 ? 0.4 : 1 }}>⏮</button>
        <button className="btn btn-ghost" disabled={safePage === 1} onClick={() => onPageChange(safePage - 1)}
          style={{ padding: "5px 9px", fontSize: 11, opacity: safePage === 1 ? 0.4 : 1 }}>◀</button>
        {pages.map((p, i) => (
          p === "..." ? (
            <span key={`dot-${i}`} style={{ padding: "5px 4px", color: C.textMuted }}>…</span>
          ) : (
            <button key={p} onClick={() => onPageChange(p)} className="btn btn-ghost"
              style={{
                padding: "5px 10px", fontSize: 11,
                background: p === safePage ? C.green600 : "transparent",
                color: p === safePage ? C.white : C.text,
                fontWeight: p === safePage ? 700 : 500,
                minWidth: 28,
              }}>
              {p}
            </button>
          )
        ))}
        <button className="btn btn-ghost" disabled={safePage === totalPages} onClick={() => onPageChange(safePage + 1)}
          style={{ padding: "5px 9px", fontSize: 11, opacity: safePage === totalPages ? 0.4 : 1 }}>▶</button>
        <button className="btn btn-ghost" disabled={safePage === totalPages} onClick={() => onPageChange(totalPages)}
          style={{ padding: "5px 9px", fontSize: 11, opacity: safePage === totalPages ? 0.4 : 1 }}>⏭</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: C.textMuted }}>Mỗi trang:</span>
        <select value={pageSize} onChange={e => onPageSizeChange(Number(e.target.value))}
          style={{ width: "auto", padding: "4px 8px", fontSize: 12 }}>
          {pageSizeOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
    </div>
  );
};

// v28: Hook usePagination — quản lý state page + pageSize + tự reset khi data thay đổi
const usePagination = (items, defaultPageSize = 50) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const totalPages = Math.max(1, Math.ceil((items?.length || 0) / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages]); // eslint-disable-line
  const paginatedItems = useMemo(() => {
    if (!items) return [];
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);
  return { page, setPage, pageSize, setPageSize, paginatedItems, totalPages };
};

const ProgressBar = ({ value, max, color = C.green500 }) => {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%`, background: color }} /></div>;
};

const Modal = ({ title, subtitle, onClose, onSave, saveLabel = "Lưu", saveDisabled, extraButton, children, width = 760 }) => (
  <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
    <div className="modal" style={{ maxWidth: width }}>
      <div className="modal-header">
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.green800 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>{subtitle}</div>}
        </div>
        <button className="btn btn-ghost" style={{ padding: "6px 10px" }} onClick={onClose}>✕</button>
      </div>
      <div className="modal-body">{children}</div>
      {(onSave || extraButton) && (
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Hủy</button>
          {extraButton}
          {onSave && <button className="btn btn-primary" disabled={saveDisabled} onClick={onSave}>{saveLabel}</button>}
        </div>
      )}
    </div>
  </div>
);

const ConfirmDialog = ({ title, message, confirmLabel = "Xác nhận", cancelLabel = "Hủy", danger, onConfirm, onClose }) => (
  <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
    <div className="modal" style={{ maxWidth: 440 }}>
      <div className="modal-header">
        <div style={{ fontSize: 17, fontWeight: 700, color: danger ? C.red : C.green800 }}>
          {danger ? "⚠️ " : ""}{title}
        </div>
        <button className="btn btn-ghost" style={{ padding: "6px 10px" }} onClick={onClose}>✕</button>
      </div>
      <div className="modal-body">
        <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{message}</div>
      </div>
      <div className="modal-footer">
        {cancelLabel && <button className="btn btn-ghost" onClick={onClose}>{cancelLabel}</button>}
        <button
          className={danger ? "btn" : "btn btn-primary"}
          style={danger ? { background: C.red, color: "white" } : {}}
          onClick={() => { onConfirm(); onClose(); }}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

// v11.2: PromptDialog — thay thế native prompt() vì artifact/iframe sandbox chặn
const PromptDialog = ({ title, message, placeholder, defaultValue = "", confirmLabel = "OK", cancelLabel = "Hủy", required = true, multiline = false, onConfirm, onClose }) => {
  const [value, setValue] = useState(defaultValue);
  const handleOk = () => {
    const trimmed = value.trim();
    if (required && !trimmed) return;
    onConfirm(trimmed);
    onClose();
  };
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <div style={{ fontSize: 17, fontWeight: 700, color: C.green800 }}>{title}</div>
          <button className="btn btn-ghost" style={{ padding: "6px 10px" }} onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {message && <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 10 }}>{message}</div>}
          {multiline ? (
            <textarea autoFocus rows={4} value={value} onChange={e => setValue(e.target.value)} placeholder={placeholder}
              onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleOk(); }} />
          ) : (
            <input autoFocus value={value} onChange={e => setValue(e.target.value)} placeholder={placeholder}
              onKeyDown={e => { if (e.key === "Enter") handleOk(); }} />
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>{cancelLabel}</button>
          <button className="btn btn-primary" onClick={handleOk} disabled={required && !value.trim()}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
};

// v38d: HardDeleteDialog — Modal yêu cầu gõ "DELETE" để xác nhận xóa cứng
// Reuse cho cả 4 đối tượng (NCC, Carrier, PO, Shipment)
//
// Props:
//   - title:          string  ("Xóa cứng NCC: ...")
//   - subtitle:       string? (mô tả ngắn về đối tượng đang xóa)
//   - objectSummary:  string? (tóm tắt object: tên, mã, ...)
//   - canDelete:      bool    (true = pass mọi check, false = không cho xóa)
//   - reasons:        string[] (nếu canDelete=false, hiển thị danh sách lý do)
//   - onConfirm:      function (gọi khi user gõ "DELETE" + bấm Xóa vĩnh viễn)
//   - onClose:        function
const HardDeleteDialog = ({ title, subtitle, objectSummary, canDelete, reasons = [], onConfirm, onClose }) => {
  const [confirmText, setConfirmText] = useState("");
  const isMatch = confirmText.trim() === "DELETE";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 540 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{ background: C.redBg, borderBottom: `2px solid ${C.red}` }}>
          <div>
            <h3 style={{ color: C.red, margin: 0 }}>🗑️ {title}</h3>
            {subtitle && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} className="btn btn-ghost" style={{ padding: "4px 10px" }}>✕</button>
        </div>
        <div style={{ padding: "20px 24px" }}>
          {objectSummary && (
            <div style={{ background: C.bg, padding: "12px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
              <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>Đối tượng sẽ bị xóa:</div>
              <div style={{ fontWeight: 600 }}>{objectSummary}</div>
            </div>
          )}

          {!canDelete ? (
            <>
              <div className="alert alert-danger" style={{ marginBottom: 0 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>❌ Không thể xóa cứng — còn dữ liệu liên quan:</div>
                <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
                  {reasons.map((r, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>{r}</li>
                  ))}
                </ul>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 10, fontStyle: "italic" }}>
                  💡 Cần xử lý các dữ liệu liên quan trước (xóa cứng / hủy / di chuyển) rồi mới xóa được đối tượng này.
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="alert alert-danger" style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>⚠️ HÀNH ĐỘNG NGUY HIỂM — KHÔNG THỂ HOÀN TÁC</div>
                <div style={{ fontSize: 13, lineHeight: 1.55 }}>
                  Đối tượng này sẽ bị xóa <b>vĩnh viễn</b> khỏi hệ thống. Audit log sẽ ghi nhận hành động này
                  cùng với snapshot toàn bộ dữ liệu trước khi xóa, nhưng đối tượng đã xóa <b>không thể phục hồi</b>.
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontWeight: 600 }}>
                  Để xác nhận, gõ chính xác <code style={{ background: C.redBg, color: C.red, padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}>DELETE</code> bên dưới:
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  placeholder='Gõ "DELETE" để mở khóa nút xóa'
                  autoFocus
                  style={{
                    fontSize: 14, fontWeight: 600,
                    borderColor: isMatch ? C.green600 : (confirmText ? C.red : C.border),
                    color: isMatch ? C.green700 : (confirmText ? C.red : C.text),
                  }}
                />
                {confirmText && !isMatch && (
                  <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>
                    Chữ chưa đúng (lưu ý IN HOA, không có khoảng trắng)
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Đóng</button>
          {canDelete && (
            <button
              className="btn btn-danger"
              disabled={!isMatch}
              onClick={() => {
                onConfirm();
                onClose();
              }}
              style={{ opacity: isMatch ? 1 : 0.5 }}
            >
              🗑️ Xóa vĩnh viễn
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// v38f: RenameIdDialog — Modal yêu cầu gõ ID MỚI để xác nhận đổi mã
// ============================================================
// Reuse pattern của HardDeleteDialog nhưng cho rename ID.
// Khác:
//   - Confirm bằng cách gõ chính xác ID MỚI (không phải "DELETE")
//   - Sau khi confirm, gọi onConfirm(newId) thay vì xóa
//   - Có cảnh báo về báo cáo cũ vẫn ghi mã CŨ
//
// Props:
//   - title:          string  ("Đổi mã PO: PO-001")
//   - subtitle:       string? (mô tả ngắn về đối tượng đang đổi)
//   - oldId:          string  (mã cũ — hiển thị)
//   - newId:          string  (mã mới — chính là target để user gõ confirm)
//   - canRename:      bool    (true = pass mọi check, false = không cho đổi)
//   - reasons:        string[] (nếu canRename=false, hiển thị danh sách lý do)
//   - onConfirm:      function (gọi khi user gõ đúng ID mới + bấm Đổi mã)
//   - onClose:        function
const RenameIdDialog = ({ title, subtitle, oldId, newId, canRename, reasons = [], onConfirm, onClose }) => {
  const [confirmText, setConfirmText] = useState("");
  const isMatch = confirmText.trim() === String(newId || "").trim();
  const trimmedNewId = String(newId || "").trim();
  const isSameAsOld = trimmedNewId === oldId;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 540 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{ background: C.orangeBg, borderBottom: `2px solid ${C.orange}` }}>
          <div>
            <h3 style={{ color: C.orange, margin: 0 }}>🔄 {title}</h3>
            {subtitle && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} className="btn btn-ghost" style={{ padding: "4px 10px" }}>✕</button>
        </div>
        <div style={{ padding: "20px 24px" }}>
          <div style={{ background: C.bg, padding: "12px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
            <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Đổi mã:</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <code style={{ background: C.white, padding: "4px 10px", borderRadius: 4, fontWeight: 600, color: C.textMuted }}>{oldId}</code>
              <span style={{ color: C.textMuted }}>→</span>
              <code style={{ background: isSameAsOld ? C.bg : C.green50, padding: "4px 10px", borderRadius: 4, fontWeight: 700, color: isSameAsOld ? C.textMuted : C.green700 }}>{trimmedNewId || "(chưa nhập)"}</code>
            </div>
          </div>

          {!canRename ? (
            <div className="alert alert-danger" style={{ marginBottom: 0 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>❌ Không thể đổi mã — vướng ràng buộc:</div>
              <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
                {reasons.map((r, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{r}</li>
                ))}
              </ul>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 10, fontStyle: "italic" }}>
                💡 Để đổi mã, cần xử lý các data liên quan trước (xóa cứng / hủy / di chuyển), hoặc chọn mã mới khác.
              </div>
            </div>
          ) : isSameAsOld ? (
            <div className="alert alert-info" style={{ marginBottom: 0 }}>
              💡 Mã mới giống mã cũ — không có gì để thay đổi.
            </div>
          ) : (
            <>
              <div className="alert alert-warn" style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>⚠️ Cảnh báo trước khi đổi mã</div>
                <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: 13, lineHeight: 1.55 }}>
                  <li>Mã sẽ thay đổi <b>vĩnh viễn</b>. Audit log ghi nhận cả mã cũ + mới.</li>
                  <li>Báo cáo Excel cũ đã xuất sẽ <b>vẫn ghi mã cũ</b> ({oldId}) — không tự cập nhật.</li>
                  <li>Có thể đổi lại mã sau (theo cùng quy trình này).</li>
                </ul>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontWeight: 600 }}>
                  Để xác nhận, gõ chính xác mã mới <code style={{ background: C.green50, color: C.green700, padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}>{trimmedNewId}</code> bên dưới:
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  placeholder={`Gõ "${trimmedNewId}" để mở khóa nút đổi mã`}
                  autoFocus
                  style={{
                    fontSize: 14, fontWeight: 600,
                    borderColor: isMatch ? C.green600 : (confirmText ? C.red : C.border),
                    color: isMatch ? C.green700 : (confirmText ? C.red : C.text),
                  }}
                />
                {confirmText && !isMatch && (
                  <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>
                    Chữ chưa khớp với mã mới (lưu ý phân biệt hoa/thường)
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Đóng</button>
          {canRename && !isSameAsOld && (
            <button
              className="btn btn-primary"
              disabled={!isMatch}
              onClick={() => {
                onConfirm(trimmedNewId);
                onClose();
              }}
              style={{ opacity: isMatch ? 1 : 0.5, background: C.orange, borderColor: C.orange }}
            >
              🔄 Đổi mã
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// v38g: ChangeOwnPasswordModal — User tự đổi mật khẩu cá nhân
// ============================================================
// Phương án D: Yêu cầu nhập password CŨ + password MỚI + xác nhận lại.
// Không gửi email (vì app local), nhưng có audit log + auto-logout sau khi đổi.
//
// Props:
//   user: user hiện tại (để check password cũ)
//   onConfirm: (newPassword) => void — gọi khi user đổi xong
//   onClose
const ChangeOwnPasswordModal = ({ user, onConfirm, onClose }) => {
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);

  // Validation
  const errors = [];
  if (!oldPass) errors.push("Nhập mật khẩu hiện tại");
  else if (oldPass !== user.password) errors.push("Mật khẩu hiện tại không đúng");
  if (!newPass) errors.push("Nhập mật khẩu mới");
  else if (newPass.length < 6) errors.push("Mật khẩu mới phải ≥ 6 ký tự");
  else if (newPass === oldPass) errors.push("Mật khẩu mới phải khác mật khẩu cũ");
  if (!confirmPass) errors.push("Nhập lại mật khẩu mới");
  else if (newPass && confirmPass !== newPass) errors.push("Xác nhận không khớp");

  const isValid = errors.length === 0;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.green800 }}>🔑 Đổi mật khẩu</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>
              Tài khoản: <b>{user.fullName || user.username}</b>
            </div>
          </div>
          <button className="btn btn-ghost" style={{ padding: "6px 10px" }} onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="alert alert-info" style={{ marginBottom: 14, fontSize: 12 }}>
            💡 Sau khi đổi mật khẩu, hệ thống sẽ tự đăng xuất. Hãy đăng nhập lại bằng mật khẩu mới.
          </div>

          <div className="form-group">
            <label>Mật khẩu hiện tại *</label>
            <div style={{ position: "relative" }}>
              <input
                type={showOld ? "text" : "password"}
                value={oldPass}
                onChange={e => setOldPass(e.target.value)}
                placeholder="Nhập mật khẩu hiện tại"
                autoFocus
                style={{ paddingRight: 50 }}
              />
              <button
                type="button"
                onClick={() => setShowOld(!showOld)}
                style={{
                  position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                  border: "none", background: "transparent", cursor: "pointer",
                  fontSize: 11, color: C.textMuted,
                }}
              >{showOld ? "🙈 Ẩn" : "👁 Hiện"}</button>
            </div>
          </div>

          <div className="form-group">
            <label>Mật khẩu mới * (≥ 6 ký tự)</label>
            <div style={{ position: "relative" }}>
              <input
                type={showNew ? "text" : "password"}
                value={newPass}
                onChange={e => setNewPass(e.target.value)}
                placeholder="Nhập mật khẩu mới"
                style={{ paddingRight: 50 }}
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                style={{
                  position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                  border: "none", background: "transparent", cursor: "pointer",
                  fontSize: 11, color: C.textMuted,
                }}
              >{showNew ? "🙈 Ẩn" : "👁 Hiện"}</button>
            </div>
          </div>

          <div className="form-group">
            <label>Nhập lại mật khẩu mới *</label>
            <input
              type={showNew ? "text" : "password"}
              value={confirmPass}
              onChange={e => setConfirmPass(e.target.value)}
              placeholder="Nhập lại để xác nhận"
              onKeyDown={e => { if (e.key === "Enter" && isValid) onConfirm(newPass); }}
            />
          </div>

          {errors.length > 0 && (oldPass || newPass || confirmPass) && (
            <div className="alert alert-danger" style={{ fontSize: 12 }}>
              {errors.map((e, i) => <div key={i}>• {e}</div>)}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Hủy</button>
          <button
            className="btn btn-primary"
            disabled={!isValid}
            onClick={() => onConfirm(newPass)}
          >🔑 Đổi mật khẩu</button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// v38e: Combobox — Generic searchable dropdown
// ============================================================
// Props:
//   items:        Array (toàn bộ items có thể chọn)
//   value:        any (key của item đang chọn — null/undefined = chưa chọn)
//   onChange:     (key) => void (gọi khi user chọn item)
//   getKey:       (item) => any (default: item.id)
//   getLabel:     (item) => string (text hiển thị 1 dòng khi đã chọn)
//   getSearchText: (item) => string (text dùng để filter — gộp các field cần search)
//   renderItem:   (item, isHighlighted, query) => JSX (cách render item trong dropdown)
//                 Nếu không pass → dùng getLabel với highlight match
//   placeholder:  string (text hint trong input khi rỗng)
//   excludeKeys:  Array (loại trừ items có key trong list này — dùng cho exclude SP đã chọn)
//   disabled:     bool
//   width:        string|number (default "100%")
//   emptyText:    string (default: "Không có dữ liệu")
const Combobox = ({
  items = [],
  value,
  onChange,
  getKey = (item) => item?.id,
  getLabel = (item) => String(item?.name || item?.id || ""),
  getSearchText = (item) => String(item?.name || item?.id || ""),
  renderItem,
  placeholder = "Tìm kiếm...",
  excludeKeys = [],
  disabled = false,
  width = "100%",
  emptyText = "Không có dữ liệu",
}) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const containerRef = useRef(null);

  // Item hiện đang chọn (theo value)
  const selectedItem = useMemo(
    () => items.find(it => getKey(it) === value),
    [items, value, getKey]
  );

  // List filter — exclude + search query
  const filtered = useMemo(() => {
    const excludeSet = new Set(excludeKeys);
    let list = items.filter(it => {
      const k = getKey(it);
      return k === value || !excludeSet.has(k); // luôn giữ item đang chọn
    });
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(it => getSearchText(it).toLowerCase().includes(q));
    }
    return list;
  }, [items, excludeKeys, query, value, getKey, getSearchText]);

  // Reset highlight khi list thay đổi
  useEffect(() => {
    setHighlightIdx(0);
  }, [query, open]);

  // Click ngoài để đóng dropdown
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Auto-scroll item đang highlight vào view
  useEffect(() => {
    if (!open || !dropdownRef.current) return;
    const el = dropdownRef.current.querySelector(`[data-idx="${highlightIdx}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [highlightIdx, open]);

  const handleSelect = (item) => {
    onChange(getKey(item));
    setOpen(false);
    setQuery("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setHighlightIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && filtered[highlightIdx]) handleSelect(filtered[highlightIdx]);
      else if (!open) setOpen(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    } else if (e.key === "Tab") {
      // Khi Tab + có item highlight + đang search → chọn luôn
      if (open && query && filtered[highlightIdx]) {
        e.preventDefault();
        handleSelect(filtered[highlightIdx]);
      }
    }
  };

  // Helper: highlight phần text match query (bold)
  const highlightMatch = (text, q) => {
    if (!q) return text;
    const lower = String(text).toLowerCase();
    const ql = q.toLowerCase();
    const i = lower.indexOf(ql);
    if (i < 0) return text;
    return (
      <>
        {text.slice(0, i)}
        <b style={{ background: "#FEF08A", color: C.text }}>{text.slice(i, i + q.length)}</b>
        {text.slice(i + q.length)}
      </>
    );
  };

  // Default renderItem nếu không có
  const defaultRenderItem = (item, isHighlighted, q) => (
    <div style={{
      padding: "8px 12px",
      background: isHighlighted ? C.green50 : "transparent",
      cursor: "pointer",
      fontSize: 13,
      borderBottom: `1px solid ${C.borderLight}`,
    }}>
      {highlightMatch(getLabel(item), q)}
    </div>
  );
  const itemRenderer = renderItem || defaultRenderItem;

  return (
    <div ref={containerRef} style={{ position: "relative", width }}>
      {/* Input — hiển thị label nếu đã chọn và chưa mở dropdown, hoặc query khi đang search */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "0 8px", border: `1px solid ${open ? C.green500 : C.border}`,
          borderRadius: 8, background: disabled ? C.bg : C.white,
          cursor: disabled ? "not-allowed" : "text",
        }}
        onClick={() => !disabled && (inputRef.current?.focus(), setOpen(true))}
      >
        {selectedItem && !open && (
          <div style={{ flex: 1, padding: "8px 0", fontSize: 13, color: C.text }}>
            {getLabel(selectedItem)}
          </div>
        )}
        {(!selectedItem || open) && (
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={selectedItem && open ? getLabel(selectedItem) : placeholder}
            disabled={disabled}
            style={{
              flex: 1, border: "none", outline: "none", padding: "8px 0",
              fontSize: 13, background: "transparent", minWidth: 0,
            }}
          />
        )}
        {selectedItem && !disabled && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(null); setQuery(""); }}
            style={{
              border: "none", background: "transparent", cursor: "pointer",
              fontSize: 14, color: C.textMuted, padding: "0 4px",
            }}
            title="Xóa lựa chọn"
          >✕</button>
        )}
        <span style={{ fontSize: 10, color: C.textMuted, pointerEvents: "none" }}>{open ? "▲" : "▼"}</span>
      </div>

      {/* Dropdown */}
      {open && !disabled && (
        <div
          ref={dropdownRef}
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
            background: C.white, border: `1px solid ${C.border}`, borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            maxHeight: 320, overflowY: "auto",
            zIndex: 100,
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: "16px 12px", color: C.textMuted, fontSize: 12, textAlign: "center" }}>
              {query ? `Không tìm thấy "${query}"` : emptyText}
            </div>
          ) : (
            filtered.map((item, idx) => (
              <div
                key={getKey(item)}
                data-idx={idx}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setHighlightIdx(idx)}
              >
                {itemRenderer(item, idx === highlightIdx, query)}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================
// v38g: NumberInput — Wrapper cho input number an toàn
// ============================================================
// Khắc phục các vấn đề của <input type="number"> mặc định:
//   • Disable scroll wheel (nguyên nhân #1 gây nhập nhầm — user scroll xem dòng khác,
//     focus vẫn ở input → tăng/giảm số ngoài ý muốn)
//   • Disable phím ↑↓ (chỉ cho gõ thủ công)
//   • Spinner ▲▼ ẩn qua CSS global (xem index.css của app)
//
// Hỗ trợ thêm:
//   • Highlight đỏ + warning khi vượt max (prop `errorIfOver`)
//   • Optional nút "Đặt = max" tiện 1-click fix (prop `showSetMaxButton`)
//
// Props:
//   value, onChange, min, max, step, placeholder, style, disabled, autoFocus, onBlur, onFocus
//   errorIfOver:      bool — nếu true, value > max → border đỏ + warning
//   showSetMaxButton: bool — hiển thị nút "Đặt = {max}" khi value > max
//   warningStyle:     object — style cho warning text (default màu đỏ, fontSize 11)
const NumberInput = ({
  value, onChange,
  min, max, step,
  placeholder, style = {}, disabled = false, autoFocus = false,
  onBlur, onFocus,
  errorIfOver = false,
  showSetMaxButton = false,
  warningStyle = {},
}) => {
  // Phát hiện vượt max
  const numValue = Number(value);
  const numMax = max === undefined || max === null ? Infinity : Number(max);
  const isOverMax = errorIfOver && !isNaN(numValue) && numValue > numMax;

  const handleKeyDown = (e) => {
    // Disable phím ↑↓ — không cho user dùng phím tăng/giảm số
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
    }
  };

  const handleWheel = (e) => {
    // Disable scroll wheel khi đang focus input — đây là nguyên nhân #1 gây nhập nhầm
    // User scroll xem dòng khác → focus vẫn ở input → tăng/giảm số.
    // Cách an toàn nhất: blur input để scroll wheel rơi ra ngoài.
    e.target.blur();
  };

  const baseStyle = {
    ...style,
    ...(isOverMax ? {
      borderColor: C.red,
      background: C.redBg,
      color: C.red,
      fontWeight: 600,
    } : {}),
  };

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 2 }}>
      <input
        type="number"
        value={value ?? ""}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
        onBlur={onBlur}
        onFocus={onFocus}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        style={baseStyle}
        disabled={disabled}
        autoFocus={autoFocus}
      />
      {isOverMax && (
        <div style={{ fontSize: 10, color: C.red, fontWeight: 600, lineHeight: 1.3, ...warningStyle }}>
          ⚠ Vượt tối đa (max: {Number(max).toLocaleString("vi-VN")})
          {showSetMaxButton && (
            <button
              type="button"
              onClick={() => onChange({ target: { value: String(numMax) } })}
              style={{
                marginLeft: 6, padding: "1px 8px", fontSize: 10,
                border: `1px solid ${C.red}`, borderRadius: 4,
                background: C.white, color: C.red, cursor: "pointer", fontWeight: 700,
              }}
            >→ Đặt = {Number(max).toLocaleString("vi-VN")}</button>
          )}
        </div>
      )}
    </div>
  );
};

const shipmentStatusColor = (s) => {
  const map = {
    "Nháp": "#94a3b8", // v26: xám đá phân biệt rõ với mọi trạng thái khác
    "Chờ xuất": C.orange,
    "Đang vận chuyển": C.blue,
    "Đang vận chuyển TQ": C.blue,
    "Đang thông quan": C.purple,
    "Kiểm hoá": C.gold,
    "Đã thông quan": "#16A085",
    "Đã về kho": C.green500,
    "Hủy": C.red,
  };
  return map[s] || C.textMuted;
};

const poStatusColor = (s) => {
  // v13: 3 trạng thái mới + map các trạng thái cũ (data legacy) về màu tương đương
  const map = {
    // Mới
    "Chờ duyệt": C.orange,
    "Đã duyệt": C.green500,
    "Hủy": C.red,
    // Cũ — fallback (không break UI nếu data v12 chưa migrate)
    "Chờ xác nhận": C.orange,
    "Đang sản xuất": C.green500,
    "SX một phần": C.green500,
    "Hoàn thành SX": C.green500,
  };
  return map[s] || C.textMuted;
};

const ChartTooltip = ({ active, payload, label, valuePrefix = "" }) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: C.white, border: `1px solid ${C.green300}`, borderRadius: 10, padding: "10px 14px", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
      <div style={{ fontSize: 12, color: C.green800, fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ fontSize: 12, color: p.color, fontWeight: 500 }}>
          {p.name}: {valuePrefix}{typeof p.value === "number" ? p.value.toLocaleString() : p.value}
        </div>
      ))}
    </div>
  );
};

// Date range filter component
const DateRangeFilter = ({ from, to, onFromChange, onToChange, onReset }) => {
  const setRange = (preset) => {
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    let start;
    if (preset === "7d") { start = new Date(now - 7 * 86400000).toISOString().slice(0, 10); }
    else if (preset === "30d") { start = new Date(now - 30 * 86400000).toISOString().slice(0, 10); }
    else if (preset === "90d") { start = new Date(now - 90 * 86400000).toISOString().slice(0, 10); }
    else if (preset === "ytd") { start = `${now.getFullYear()}-01-01`; }
    onFromChange(start); onToChange(end);
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 4 }}>
        {[["7d", "7 ngày"], ["30d", "30 ngày"], ["90d", "90 ngày"], ["ytd", "Từ đầu năm"]].map(([k, label]) => (
          <button key={k} className="btn btn-ghost" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => setRange(k)}>{label}</button>
        ))}
      </div>
      <input type="date" value={from} onChange={e => onFromChange(e.target.value)} style={{ width: 150 }} />
      <span style={{ color: C.textMuted }}>→</span>
      <input type="date" value={to} onChange={e => onToChange(e.target.value)} style={{ width: 150 }} />
      {(from || to) && <button className="btn btn-ghost" style={{ padding: "6px 10px", fontSize: 11 }} onClick={onReset}>✕ Xóa</button>}
    </div>
  );
};

// ============================================================
// LOGIN — Không hiện demo credentials
// ============================================================
const LoginScreen = ({ onLogin, users }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  const handle = () => {
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) { setErr("Sai tên đăng nhập hoặc mật khẩu"); return; }
    if (user.status !== "active") { setErr("Tài khoản đã bị khóa"); return; }
    onLogin(user);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(135deg, ${C.green50} 0%, ${C.green100} 100%)` }}>
      <div style={{ width: 420, background: C.white, borderRadius: 24, padding: 44, boxShadow: "0 20px 60px rgba(30, 60, 30, 0.15)" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 72, height: 72, borderRadius: 18, background: `linear-gradient(135deg, ${C.green400} 0%, ${C.green600} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px", color: "white", fontSize: 32, fontWeight: 800, boxShadow: `0 8px 20px ${C.green500}40` }}>G</div>
          <div style={{ fontSize: 26, color: C.green800, fontWeight: 800, letterSpacing: "-0.02em" }}>GoChek CRM</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 6 }}>Hệ thống quản lý nhà máy</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="form-group">
            <label>Tên đăng nhập</label>
            <input value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} placeholder="Nhập tên đăng nhập..." autoFocus />
          </div>
          <div className="form-group">
            <label>Mật khẩu</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} placeholder="Nhập mật khẩu..." />
          </div>
          {err && <div className="alert alert-danger">{err}</div>}
          <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 8, padding: "13px" }} onClick={handle}>Đăng nhập</button>
        </div>
        <div style={{ marginTop: 22, fontSize: 11, color: C.textLight, textAlign: "center" }}>
          Liên hệ quản trị viên để được cấp tài khoản
        </div>
      </div>
    </div>
  );
};

// ============================================================
// DASHBOARD — Green theme + dual currency
// ============================================================
const Dashboard = ({ pos, shipments, payments, factories, products, openingBalances, markets, carriers, feePayments, stockOnHand = [], settings, onNavigate }) => {
  const marketNames = getMarketNames(markets);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filteredPOs = useMemo(() => filterByDateRange(pos, "orderDate", dateFrom, dateTo), [pos, dateFrom, dateTo]);
  const filteredShipments = useMemo(() => filterByDateRange(shipments, "departDate", dateFrom, dateTo), [shipments, dateFrom, dateTo]);
  const filteredPayments = useMemo(() => filterByDateRange(payments, "payDate", dateFrom, dateTo), [payments, dateFrom, dateTo]);

  // v38j: KPI Tồn kho cảnh báo — đếm SP × Kho theo trạng thái
  const allWarehousesFlat = useMemo(() => {
    const out = [];
    (markets || []).forEach(m => (m.warehouses || []).forEach(w => out.push({ ...w, marketName: m.name })));
    return out;
  }, [markets]);
  const inventoryAlertKPI = useMemo(() => {
    const counts = { urgent_po: 0, need_ship: 0, coming: 0 };
    (products || []).forEach(p => {
      allWarehousesFlat.forEach(w => {
        const target = (p.warehouseTargets || {})[w.id];
        if (!target || target.khongTheoDoi || !target.tonAnToan) return;
        const stockInWarehouse = calcStockOnHandQty(p.id, stockOnHand, { warehouseId: w.id });
        const inTransit = calcInTransitQty(p.id, shipments, pos, { warehouseId: w.id });
        const atFactory = calcAtFactoryQty(p.id, pos, shipments);
        const leadTime = Number(p.thoiGianSanXuat || 0) + Number(p.thoiGianVanChuyen || 0);
        const status = calcInventoryStatus({
          stockInWarehouse, inTransit, atFactory,
          tonAnToan: Number(target.tonAnToan || 0),
          slBanNgay: Number(target.slBanNgay || 0),
          leadTimeDays: leadTime,
          khongTheoDoi: false,
        });
        if (counts[status.id] !== undefined) counts[status.id]++;
      });
    });
    return counts;
  }, [products, allWarehousesFlat, stockOnHand, shipments, pos]);

  const stats = useMemo(() => {
    // v33: Tái cấu trúc 6 KPI tài chính NCC theo Phương án 1 (không trùng lặp).
    // Hàng chờ ship + Hàng đang VC + Hàng đã về kho = TỔNG CAM KẾT NCC (không cộng dồn trùng).
    let expectedCNY = 0, actualRemainCNY = 0, totalCreditCNY = 0;
    let totalPaidNetCNY = 0; // v33: Đã thanh toán (ròng tới NCC, đã loại cancelled)

    factories.forEach(f => {
      const b = calcFactoryBalance(f.id, filteredPOs, filteredShipments, filteredPayments, openingBalances, factories, settings);
      expectedCNY += b.expectedDebt;       // 🟦 Hàng chờ ship — PO duyệt còn chưa ship
      actualRemainCNY += b.stillOwed;      // 🟥 Còn phải trả
      totalCreditCNY += b.creditFund;      // 🟩 Quỹ tín dụng
      totalPaidNetCNY += b.netPaid;        // 🟦 Đã thanh toán (ròng) — đã loại cancelled trong calcFactoryBalance
    });

    // v34: Tổng đã thanh toán theo VND THỰC TẾ (cộng từ payment.amountInVND lưu cứng).
    // Khác biệt với cách quy CNY → VND theo tỷ giá hệ thống: con số này phản ánh
    // chính xác số VND đã chuyển khỏi tài khoản — khớp sao kê NH.
    // Quy tắc: chỉ cộng payment "vào" NCC (MARKET_TO_FACTORY + INTER_FACTORY tới NCC),
    // trừ payment "ra" (INTER_FACTORY trả hộ NCC khác). Tương tự logic netPaid trong calcFactoryBalance.
    // v38: CHỈ cộng payment stage "completed". Stage 1+2 → tách vào pendingPaidVND.
    let totalPaidNetVND = 0;
    let pendingPaidVND = 0; // v38: Tổng VND đang TT (stage 1+2)
    filteredPayments.forEach(p => {
      if (p.status === "cancelled") return;
      const amtVND = Number(p.amountInVND ?? toVND(Number(p.amount || 0), p.currency || "CNY", settings));
      // INTER_FACTORY luôn coi là completed
      const stage = p.type === "INTER_FACTORY" ? "completed" : getPaymentStage(p);
      const isCompleted = stage === "completed";

      // Inbound (payment vào NCC) hoặc Outbound (NCC trả hộ)
      const isInbound = (p.type === "MARKET_TO_FACTORY" && p.toFactoryId) || (p.type === "INTER_FACTORY" && p.toFactoryId);
      const isOutbound = p.type === "INTER_FACTORY" && p.fromFactoryId;

      if (isCompleted) {
        if (isInbound) totalPaidNetVND += amtVND;
        if (isOutbound) totalPaidNetVND -= amtVND;
      } else {
        // Stage 1+2 → tách vào pendingPaidVND
        if (isInbound) pendingPaidVND += amtVND;
        if (isOutbound) pendingPaidVND -= amtVND;
      }
    });

    // v33: 🚛 Hàng đang vận chuyển (đã rời NM, chưa về kho) — quy CNY
    // 📦 Hàng đã về kho — quy CNY
    // Cách tính: duyệt từng shipment "vận hành" (loại Hủy + Nháp), nhân SL × đơn giá PO.
    let inTransitValueCNY = 0;
    let arrivedValueCNY = 0;
    filteredShipments.forEach(s => {
      if (!isOperationalShipment(s)) return; // bỏ Hủy + Nháp
      const isInTransit = SHIPMENT_IN_TRANSIT.includes(s.status);
      const isArrived = s.status === "Đã về kho";
      if (!isInTransit && !isArrived) return;

      let valueCNY = 0;
      (s.items || []).forEach(i => {
        const po = pos.find(p => p.id === i.poId);
        if (!po) return;
        const poItems = getPOItems(po);
        const poItem = po.items ? poItems.find(x => x.id === i.itemId) : poItems[0];
        if (!poItem) return;
        // Lô đã về kho → ưu tiên SL nhận thực tế. Lô chưa về kho → dùng SL kế hoạch.
        const qty = isArrived ? Number(i.receivedQty ?? i.quantity ?? 0) : Number(i.quantity ?? 0);
        const price = Number(poItem.unitPrice || 0);
        const factory = factories.find(f => f.id === po.factoryId);
        const poCurrency = factory?.currency || po.currency || "CNY";
        let priceInCNY = price;
        if (poCurrency !== "CNY" && settings) {
          const vnd = toVND(price, poCurrency, settings);
          priceInCNY = vnd / (settings.cnyToVnd || 1);
        }
        valueCNY += qty * priceInCNY;
      });
      if (isInTransit) inTransitValueCNY += valueCNY;
      else if (isArrived) arrivedValueCNY += valueCNY;
    });

    // v13: KPI "PO chờ giao" = PO đã duyệt + chưa hủy + chưa ship đủ
    const inProduction = filteredPOs.filter(p => {
      if (p.status === "Hủy" || !p.approved) return false;
      const totalQty = poTotalQuantity(p);
      const totalShipped = shippedFromPO(p.id, filteredShipments);
      return totalShipped < totalQty;
    }).length;
    const inTransit = filteredShipments.filter(s => ["Đang vận chuyển TQ", "Đang vận chuyển", "Đang thông quan", "Kiểm hoá", "Đã thông quan"].includes(s.status)).length;
    const delivered = filteredShipments.filter(s => s.status === "Đã về kho").length;
    return {
      expectedCNY,
      actualRemainCNY,
      totalCreditCNY,
      totalPaidNetCNY,        // v33
      totalPaidNetVND,        // v34: VND thực tế đã chuyển (theo tỷ giá payment lưu cứng) — chỉ stage completed (v38)
      pendingPaidVND,         // v38: Tổng VND ở stage 1+2 (tiền treo)
      inTransitValueCNY,      // v33
      arrivedValueCNY,        // v33
      inProduction, inTransit, delivered
    };
  }, [filteredPOs, filteredShipments, filteredPayments, factories, openingBalances, settings, pos]);

  // v11: Cảnh báo quan trọng (tính trên dữ liệu đầy đủ — không lọc theo thời gian vì cảnh báo cần real-time)
  const alerts = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const out = [];

    // v13: PO quá hạn = đã duyệt + chưa hủy + đã quá expectedDate + chưa ship đủ
    const overduePOs = pos.filter(p => {
      if (p.status === "Hủy" || !p.approved) return false;
      if (!p.expectedDate) return false;
      if (p.expectedDate >= today) return false;
      const totalQty = poTotalQuantity(p);
      const totalShipped = shippedFromPO(p.id, shipments);
      return totalShipped < totalQty;
    });
    if (overduePOs.length > 0) {
      out.push({
        type: "po_overdue", severity: "red",
        title: `${overduePOs.length} PO quá hạn dự kiến nhận`,
        detail: overduePOs.slice(0, 3).map(p => `${p.id} (hẹn ${fmtDate(p.expectedDate)})`).join(", ") + (overduePOs.length > 3 ? `, +${overduePOs.length - 3} nữa` : ""),
        action: "pos",
      });
    }

    // 2. NCC quá hạn công nợ (có công nợ + PO cũ hơn paymentDays)
    const ncOverdue = [];
    factories.forEach(f => {
      if (!f.paymentDays || f.status === "stopped") return;
      const b = calcFactoryBalance(f.id, pos, shipments, payments, openingBalances, factories, settings);
      if (b.stillOwed <= 0) return;
      // Tìm PO cũ nhất chưa trả hết
      const fPos = pos.filter(p => p.factoryId === f.id && p.status !== "Hủy" && p.approved);
      if (fPos.length === 0) return;
      const oldest = fPos.reduce((a, b) => (a.orderDate < b.orderDate ? a : b), fPos[0]);
      if (!oldest.orderDate) return;
      const orderDate = new Date(oldest.orderDate);
      const daysPassed = Math.floor((new Date() - orderDate) / (1000 * 60 * 60 * 24));
      if (daysPassed > Number(f.paymentDays)) {
        ncOverdue.push({ factory: f, days: daysPassed - Number(f.paymentDays), owed: b.stillOwed });
      }
    });
    if (ncOverdue.length > 0) {
      out.push({
        type: "factory_payment_overdue", severity: "red",
        title: `${ncOverdue.length} NCC quá hạn thanh toán`,
        detail: ncOverdue.slice(0, 3).map(x => `${x.factory.name} (quá ${x.days} ngày, ${fmt(x.owed, "CNY")})`).join(", "),
        action: "debts",
      });
    }

    // 3. Lô giao hàng có receivedQty < quantity (hao hụt)
    const shortShipments = shipments.filter(s => {
      if (s.status !== "Đã về kho") return false;
      return (s.items || []).some(it => Number(it.receivedQty ?? it.quantity) < Number(it.quantity));
    });
    if (shortShipments.length > 0) {
      out.push({
        type: "shipment_short", severity: "orange",
        title: `${shortShipments.length} lô hàng nhận thiếu (hao hụt)`,
        detail: shortShipments.slice(0, 3).map(s => `${s.id}`).join(", "),
        action: "shipments",
      });
    }

    // 4. Thuế phí chưa thanh toán
    let unpaidFees = 0, unpaidShipmentSet = new Set();
    shipments.forEach(s => {
      (s.fees || []).forEach(f => {
        const feeVND = toVND(Number(f.amount || 0), f.currency, settings);
        const bal = calcFeeBalance(s.id, f.id, feePayments || [], settings);
        const remain = feeVND - bal.totalPaid;
        if (remain > 0) {
          unpaidFees += remain;
          unpaidShipmentSet.add(s.id);
        }
      });
    });
    if (unpaidFees > 0) {
      out.push({
        type: "fees_unpaid", severity: "orange",
        title: `Thuế phí chưa thanh toán: ${fmt(unpaidFees, "VND")}`,
        detail: `${unpaidShipmentSet.size} lô hàng có phí còn nợ`,
        action: "fees",
      });
    }

    // 5. PO chờ duyệt
    const pendingPOs = pos.filter(p => !p.approved && p.status !== "Hủy");
    if (pendingPOs.length > 0) {
      out.push({
        type: "po_pending", severity: "blue",
        title: `${pendingPOs.length} PO chờ duyệt`,
        detail: pendingPOs.slice(0, 3).map(p => p.id).join(", "),
        action: "pos",
      });
    }

    // v22: 6. Đơn giao hàng "Đã về kho" thiếu chứng từ áp dụng
    // Chỉ đếm các loại chưa có URL VÀ không đánh dấu Không áp dụng
    const arrivedMissingDocs = shipments.filter(s => {
      if (s.status !== "Đã về kho") return false;
      const docs = s.documents || [];
      const docsByType = new Map(docs.map(d => [d.type, d]));
      // Đếm loại chưa có (không có URL và không phải N/A)
      const missingApplicable = DOCUMENT_TYPES.filter(t => {
        const d = docsByType.get(t);
        return !d?.notApplicable && !d?.url;
      });
      return missingApplicable.length > 0;
    });
    if (arrivedMissingDocs.length > 0) {
      out.push({
        type: "missing_docs", severity: "orange",
        title: `${arrivedMissingDocs.length} đơn giao hàng đã về kho nhưng thiếu chứng từ`,
        detail: arrivedMissingDocs.slice(0, 3).map(s => {
          const docs = s.documents || [];
          const docsByType = new Map(docs.map(d => [d.type, d]));
          const filledCount = DOCUMENT_TYPES.filter(t => docsByType.get(t)?.url).length;
          const naCount = DOCUMENT_TYPES.filter(t => docsByType.get(t)?.notApplicable).length;
          const applicable = DOCUMENT_TYPES.length - naCount;
          return `${s.id} (${filledCount}/${applicable}${naCount > 0 ? `, ${naCount} N/A` : ""})`;
        }).join(", ") + (arrivedMissingDocs.length > 3 ? `, +${arrivedMissingDocs.length - 3} nữa` : ""),
        action: "shipments",
      });
    }

    // v29: Cảnh báo thanh toán đến hạn / quá hạn
    const duePayments = calcDuePayments(shipments, pos, factories, payments, products, settings, 14);
    const overdueList = duePayments.filter(d => d.urgency === "overdue");
    const urgentList = duePayments.filter(d => d.urgency === "urgent");
    const warningList = duePayments.filter(d => d.urgency === "warning");

    if (overdueList.length > 0) {
      out.push({
        type: "payment_overdue", severity: "red",
        title: `🔴 ${overdueList.length} lô đã QUÁ HẠN thanh toán`,
        detail: overdueList.slice(0, 3).map(d => {
          const days = Math.abs(d.daysUntilDue);
          return `${d.shipment.id} (${d.factory.name}, quá ${days} ngày)`;
        }).join(", ") + (overdueList.length > 3 ? `, +${overdueList.length - 3} nữa` : ""),
        action: "debts",
      });
    }
    if (urgentList.length > 0) {
      out.push({
        type: "payment_urgent", severity: "orange",
        title: `⏰ ${urgentList.length} lô đến hạn thanh toán trong 7 ngày`,
        detail: urgentList.slice(0, 3).map(d => `${d.shipment.id} (${d.factory.name}, ${d.daysUntilDue}d)`).join(", ") + (urgentList.length > 3 ? `, +${urgentList.length - 3} nữa` : ""),
        action: "debts",
      });
    }
    if (warningList.length > 0) {
      out.push({
        type: "payment_warning", severity: "blue",
        title: `📅 ${warningList.length} lô đến hạn thanh toán trong 14 ngày`,
        detail: warningList.slice(0, 3).map(d => `${d.shipment.id} (${d.factory.name}, ${d.daysUntilDue}d)`).join(", ") + (warningList.length > 3 ? `, +${warningList.length - 3} nữa` : ""),
        action: "debts",
      });
    }

    // v38: Cảnh báo "tiền treo lâu" — payment ở stage 1 hoặc 2 quá threshold
    // Logic: đếm số ngày từ lúc vào stage hiện tại (RESET khi đổi stage).
    // Stage 1 (carrier) hoặc Stage 2 (transferring) > 4 ngày → cảnh báo.
    const overdueStagePayments = (payments || []).filter(p => {
      if (p.status === "cancelled" || p.type !== "MARKET_TO_FACTORY") return false;
      const overdue = checkPaymentStageOverdue(p, settings);
      return overdue.exceeded;
    });
    if (overdueStagePayments.length > 0) {
      // Tách theo stage
      const carrierOverdue = overdueStagePayments.filter(p => getPaymentStage(p) === "carrier");
      const transferOverdue = overdueStagePayments.filter(p => getPaymentStage(p) === "transferring");
      // Tổng VND đang treo lâu
      const totalStuckVND = overdueStagePayments.reduce((sum, p) => {
        const amtVND = Number(p.amountInVND ?? toVND(Number(p.amount || 0), p.currency || "CNY", settings));
        return sum + amtVND;
      }, 0);
      const detailParts = [];
      if (carrierOverdue.length > 0) detailParts.push(`🏦 ${carrierOverdue.length} GD ở "Đã chuyển uỷ thác" quá hạn`);
      if (transferOverdue.length > 0) detailParts.push(`🌐 ${transferOverdue.length} GD ở "Đang chuyển QT" quá hạn`);
      out.push({
        type: "payment_stage_overdue", severity: "orange",
        title: `🟡 ${overdueStagePayments.length} thanh toán treo quá ${settings?.paymentStageThresholds?.carrier || 4} ngày — tổng ${fmtVND(totalStuckVND)}`,
        detail: detailParts.join(" · ") + ` · Kiểm tra với carrier/đơn vị uỷ thác.`,
        action: "payments",
      });
    }

    return out;
  }, [pos, shipments, payments, factories, openingBalances, feePayments, settings, products]);

  // Market size growth (PO value over time)
  const poGrowth = useMemo(() => {
    const byMonth = {};
    filteredPOs.forEach(p => {
      const month = p.orderDate?.slice(0, 7);
      if (!month) return;
      const value = poTotalValue(p);
      byMonth[month] = (byMonth[month] || 0) + value;
    });
    const sorted = Object.entries(byMonth).sort().map(([month, value]) => ({ month, "Giá trị PO (CNY)": Math.round(value) }));
    return sorted.length > 0 ? sorted : [{ month: "2026-01", "Giá trị PO (CNY)": 0 }];
  }, [filteredPOs]);

  // Shipments by market (bar chart)
  const shipByMarket = useMemo(() => marketNames.map(m => {
    const qty = filteredShipments.filter(s => s.market === m).flatMap(s => s.items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0);
    return { market: m, qty };
  }), [filteredShipments, marketNames]);

  // PO status pie
  const poByStatus = useMemo(() => {
    const counts = {};
    filteredPOs.forEach(p => { counts[p.status] = (counts[p.status] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filteredPOs]);

  // Market share — factory debt share
  const factoryShare = useMemo(() => {
    const total = stats.actualRemainCNY || 1;
    return factories.map(f => {
      const b = calcFactoryBalance(f.id, filteredPOs, filteredShipments, filteredPayments, openingBalances, factories, settings);
      return { factory: f.name.split(" ")[0], percent: Math.round((b.stillOwed / total) * 100) };
    }).filter(x => x.percent > 0).slice(0, 5);
  }, [factories, filteredPOs, filteredShipments, filteredPayments, openingBalances, stats.actualRemainCNY]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header + Date filter */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>BÁO CÁO PHÂN TÍCH</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: C.green800, letterSpacing: "-0.02em" }}>Tổng quan 2026</div>
        </div>
        <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} onReset={() => { setDateFrom(""); setDateTo(""); }} />
      </div>

      {/* v11: Cảnh báo quan trọng */}
      {alerts.length > 0 && (
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div style={{ fontSize: 22 }}>🚨</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.red }}>Cảnh báo quan trọng</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginLeft: "auto" }}>{alerts.length} cảnh báo</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
            {alerts.map((a, idx) => {
              const colors = {
                red: { bg: C.redBg, border: C.red + "40", text: C.red, emoji: "🔴" },
                orange: { bg: "#fff7ed", border: C.orange + "50", text: C.orange, emoji: "🟠" },
                blue: { bg: "#e0f2fe", border: C.blue + "50", text: C.blue, emoji: "🔵" },
              };
              const clr = colors[a.severity] || colors.blue;
              return (
                <div key={idx} onClick={() => onNavigate && onNavigate(a.action)} style={{
                  background: clr.bg, border: `1px solid ${clr.border}`, borderRadius: 12,
                  padding: 14, cursor: "pointer", transition: "all 0.15s",
                }}
                onMouseEnter={e => e.currentTarget.style.transform = "translateY(-2px)"}
                onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ fontSize: 18 }}>{clr.emoji}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: clr.text, marginBottom: 4 }}>{a.title}</div>
                      <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.4 }}>{a.detail}</div>
                      <div style={{ fontSize: 10, color: clr.text, fontWeight: 600, marginTop: 6 }}>→ Xem chi tiết</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* v33: Hàng 1 — KPI vận hành (giữ 2 thẻ cốt lõi: PO + Shipment) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
        <KpiCard icon="📋" label="PO chờ giao" value={stats.inProduction} sub={`/ ${filteredPOs.length} tổng PO`} />
        <KpiCard icon="🚚" label="Số lô đang VC" value={stats.inTransit} sub={`${stats.delivered} lô đã về kho`} />
      </div>

      {/* v38j: KPI Tồn kho cảnh báo — chỉ hiện khi có cảnh báo */}
      {(inventoryAlertKPI.urgent_po + inventoryAlertKPI.need_ship + inventoryAlertKPI.coming) > 0 && (
        <div style={{ marginTop: 16, background: "linear-gradient(135deg, #FEF2F2 0%, #FEF3C7 50%, #DBEAFE 100%)", border: `1px solid ${C.orange}`, borderRadius: 12, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>🚨 Tồn kho cảnh báo</div>
            <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => onNavigate?.("inventory")}>→ Xem chi tiết</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div style={{ background: C.white, borderRadius: 10, padding: 12, borderLeft: `4px solid ${C.red}` }}>
              <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>🔴 Đặt PO gấp</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.red, marginTop: 4 }}>{inventoryAlertKPI.urgent_po}</div>
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>SP × Kho sắp hết hàng</div>
            </div>
            <div style={{ background: C.white, borderRadius: 10, padding: 12, borderLeft: `4px solid ${C.orange}` }}>
              <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>🟡 Cần tạo SH</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.orange, marginTop: 4 }}>{inventoryAlertKPI.need_ship}</div>
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>SP × Kho có hàng ở NCC</div>
            </div>
            <div style={{ background: C.white, borderRadius: 10, padding: 12, borderLeft: `4px solid ${C.blue}` }}>
              <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>🔵 Đang về</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.blue, marginTop: 4 }}>{inventoryAlertKPI.coming}</div>
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>SP × Kho có shipment đang VC</div>
            </div>
          </div>
        </div>
      )}

      {/* v33: Hàng 2 — 6 KPI tài chính NCC (Phương án 1, không trùng lặp) */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.green800, margin: "16px 0 10px", display: "flex", alignItems: "center", gap: 8 }}>
          💴 Tài chính nhà cung cấp
          <span style={{ fontSize: 11, fontWeight: 500, color: C.textMuted }}>
            (Hàng chờ ship + Hàng đang VC + Hàng đã về kho = Tổng cam kết với NCC)
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          <KpiCard icon="🟦" label="Hàng chờ ship" valueCNY={stats.expectedCNY} valueVND={toVND(stats.expectedCNY, "CNY", settings)} settings={settings} />
          <KpiCard icon="🚛" label="Hàng đang vận chuyển" valueCNY={stats.inTransitValueCNY} valueVND={toVND(stats.inTransitValueCNY, "CNY", settings)} settings={settings} />
          <KpiCard icon="📦" label="Hàng đã về kho" valueCNY={stats.arrivedValueCNY} valueVND={toVND(stats.arrivedValueCNY, "CNY", settings)} settings={settings} />
        </div>
        {/* v38: Hàng KPI 4 cột — thêm 🟡 Đang TT cạnh 💸 Đã thanh toán */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginTop: 16 }}>
          <KpiCard icon="💸" label="Đã thanh toán" valueCNY={stats.totalPaidNetCNY} valueVND={stats.totalPaidNetVND} settings={settings} />
          <KpiCard icon="🟡" label="Đang TT (treo)" valueCNY={(stats.pendingPaidVND || 0) / (settings.cnyToVnd || 1)} valueVND={stats.pendingPaidVND || 0} settings={settings} />
          <KpiCard icon="🟥" label="Còn phải trả" valueCNY={stats.actualRemainCNY} valueVND={toVND(stats.actualRemainCNY, "CNY", settings)} settings={settings} />
          <KpiCard icon="🟩" label="Quỹ tín dụng" valueCNY={stats.totalCreditCNY} valueVND={toVND(stats.totalCreditCNY, "CNY", settings)} settings={settings} />
        </div>

        {/* v33: Accordion chú giải cách tính */}
        <KpiExplanationAccordion />
      </div>

      {/* Row 2: 3 charts theo style MARKET ANALYSIS */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <div className="card">
          <div style={{ textAlign: "center" }}><GreenPill>Tăng trưởng PO</GreenPill></div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={poGrowth} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.borderLight} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: C.textMuted }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: C.textMuted }} axisLine={false} tickLine={false} tickFormatter={fmtShort} />
              <Tooltip content={<ChartTooltip valuePrefix="¥" />} />
              <Line type="monotone" dataKey="Giá trị PO (CNY)" stroke={C.green500} strokeWidth={3} dot={{ r: 5, fill: C.green500 }} activeDot={{ r: 7 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div style={{ textAlign: "center" }}><GreenPill>Trạng thái PO</GreenPill></div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={poByStatus} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2} dataKey="value" label={({ percent }) => `${Math.round(percent * 100)}%`}>
                {poByStatus.map((_, i) => <Cell key={i} fill={CHART_GREENS[i % CHART_GREENS.length]} />)}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 10, paddingTop: 6 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div style={{ textAlign: "center" }}><GreenPill>SL giao theo thị trường</GreenPill></div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={shipByMarket} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.borderLight} vertical={false} />
              <XAxis dataKey="market" tick={{ fontSize: 11, fill: C.textMuted }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: C.textMuted }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: C.green50 }} />
              <Bar dataKey="qty" name="Số lượng" fill={C.green500} radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 3: Competitive Share (factory debt share) */}
      <div className="card">
        <div style={{ textAlign: "center" }}><GreenPill>Tỷ trọng công nợ theo nhà máy</GreenPill></div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(factoryShare.length, 1)}, 1fr)`, gap: 20, marginTop: 10 }}>
          {factoryShare.length === 0 ? (
            <div style={{ textAlign: "center", color: C.textMuted, padding: 40 }}>Không có dữ liệu công nợ</div>
          ) : factoryShare.map((f, i) => (
            <div key={i} style={{ textAlign: "center" }}>
              <div style={{ position: "relative", width: 140, height: 80, margin: "0 auto" }}>
                <svg viewBox="0 0 140 80" width="140" height="80">
                  <path d="M 10 75 A 60 60 0 0 1 130 75" fill="none" stroke={C.green50} strokeWidth="14" strokeLinecap="round" />
                  <path d={`M 10 75 A 60 60 0 0 1 ${10 + 120 * (f.percent / 100)} ${75 - Math.sin(Math.PI * (f.percent / 100)) * 60}`}
                    fill="none" stroke={CHART_GREENS[i % CHART_GREENS.length]} strokeWidth="14" strokeLinecap="round" />
                </svg>
                <div style={{ position: "absolute", bottom: 4, left: 0, right: 0, textAlign: "center", fontSize: 24, fontWeight: 800, color: C.green800 }}>{f.percent}%</div>
              </div>
              <div style={{ fontSize: 13, color: C.textMuted, marginTop: 6, fontWeight: 500 }}>{f.factory}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Row 4: Regional Market Growth (market debt %) */}
      <div className="card">
        <div style={{ textAlign: "center" }}><GreenPill>Doanh số theo thị trường</GreenPill></div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${marketNames.length}, 1fr)`, gap: 20, marginTop: 14 }}>
          {marketNames.map(m => {
            const ships = filteredShipments.filter(s => s.market === m);
            const qty = ships.flatMap(s => s.items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0);
            const totalQty = filteredShipments.flatMap(s => s.items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0);
            const pct = totalQty > 0 ? Math.round((qty / totalQty) * 100) : 0;
            return (
              <div key={m} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 8, fontWeight: 500 }}>{m}</div>
                <div style={{ fontSize: 32, fontWeight: 800, color: C.green600 }}>{pct}%</div>
                <div style={{ fontSize: 12, color: C.textLight, marginTop: 4 }}>{qty.toLocaleString()} sản phẩm</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Factory balance table */}
      <div className="card">
        <div className="card-green-header">Tổng hợp công nợ theo nhà máy</div>
        <table>
          <thead><tr><th>Nhà máy</th><th>Dự kiến</th><th>Thực tế</th><th>Đã thanh toán ròng</th><th>Còn nợ</th><th>Quỹ tín dụng</th></tr></thead>
          <tbody>
            {factories.map(f => {
              const b = calcFactoryBalance(f.id, filteredPOs, filteredShipments, filteredPayments, openingBalances, factories, settings);
              return (
                <tr key={f.id}>
                  <td style={{ fontWeight: 600 }}>{f.name}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{fmt(b.expectedDebt, "CNY")}</div>
                    <div style={{ fontSize: 11, color: C.textMuted }}>≈ {fmt(toVND(b.expectedDebt, "CNY", settings), "VND")}</div>
                  </td>
                  <td>
                    <div style={{ color: C.orange, fontWeight: 600 }}>{fmt(b.actualDebt, "CNY")}</div>
                    <div style={{ fontSize: 11, color: C.textMuted }}>≈ {fmt(toVND(b.actualDebt, "CNY", settings), "VND")}</div>
                  </td>
                  <td style={{ color: C.blue, fontWeight: 600 }}>{fmt(b.netPaid, "CNY")}</td>
                  <td>
                    <div style={{ color: b.stillOwed > 0 ? C.red : C.textMuted, fontWeight: 700 }}>{fmt(b.stillOwed, "CNY")}</div>
                    <div style={{ fontSize: 11, color: C.textMuted }}>≈ {fmt(toVND(b.stillOwed, "CNY", settings), "VND")}</div>
                  </td>
                  <td style={{ color: b.creditFund > 0 ? C.green600 : C.textMuted, fontWeight: 700 }}>{fmt(b.creditFund, "CNY")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const KpiCard = ({ icon, label, value, sub, valueCNY, valueVND, settings }) => (
  <div className="card" style={{ padding: "20px 22px" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <div style={{ width: 42, height: 42, borderRadius: 12, background: C.green50, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{icon}</div>
      <div style={{ fontSize: 12, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
    </div>
    {valueCNY !== undefined ? (
      <>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.green800 }}>{fmt(valueCNY, "CNY")}</div>
        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>≈ {fmt(valueVND, "VND")}</div>
      </>
    ) : (
      <>
        <div style={{ fontSize: 32, fontWeight: 800, color: C.green800 }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>{sub}</div>}
      </>
    )}
  </div>
);

// v33: Accordion giải thích cách tính 6 KPI tài chính NCC trên Dashboard
// Mặc định ẩn để không choán Dashboard. Click để xem chi tiết.
const KpiExplanationAccordion = () => {
  const [open, setOpen] = useState(false);
  const items = [
    {
      icon: "🟦",
      label: "Hàng chờ ship",
      definition: "Giá trị hàng PO đã duyệt, NCC đang sản xuất hoặc đã sản xuất xong nhưng chưa rời nhà máy.",
      formula: "= Σ (PO duyệt, chưa hủy) × (SL kế hoạch − SL đã ship) × đơn giá",
      note: "Chưa phát sinh công nợ — chỉ là cam kết tài chính tương lai."
    },
    {
      icon: "🚛",
      label: "Hàng đang vận chuyển",
      definition: "Giá trị hàng đã rời NCC nhưng chưa về đến kho thị trường (đang trên đường VC hoặc làm thủ tục thông quan).",
      formula: "= Σ shipment có status ∈ {Chờ xuất, Đang VC TQ, Đang TQ, Kiểm hoá, Đã TQ} × đơn giá PO",
      note: "Đã phát sinh công nợ với NCC."
    },
    {
      icon: "📦",
      label: "Hàng đã về kho",
      definition: "Giá trị hàng đã về đến kho thị trường, sẵn sàng bán/sử dụng.",
      formula: "= Σ shipment có status = \"Đã về kho\" × đơn giá PO (ưu tiên SL nhận thực tế)",
      note: "Đã phát sinh công nợ. Cộng với Hàng đang VC = Tổng hàng đã ship."
    },
    {
      icon: "💸",
      label: "Đã thanh toán",
      definition: "Tổng tiền NCC đã thực sự nhận được (chỉ payment ở stage \"Hoàn tất thanh toán\" ✅), ròng (= Tiền nhận từ TT và NM khác − Tiền trả hộ NM khác).",
      formula: "VND: Σ payment.amountInVND của payment stage \"completed\" lưu cứng theo tỷ giá tại ngày trả · CNY: tổng nội bộ ròng theo NCC",
      note: "🆕 V38: CHỈ tính payment stage \"Hoàn tất\". Stage 1+2 (đang treo) → tách riêng vào \"Đang TT\". Đã loại payment cancelled."
    },
    {
      icon: "🟡",
      label: "Đang TT (treo)",
      definition: "Tổng tiền GoChek đã chuyển ra (cho carrier hoặc đang chuyển QT) nhưng NCC CHƯA xác nhận nhận được. Đây là tiền \"lơ lửng\" giữa GoChek và NCC.",
      formula: "= Σ payment.amountInVND của payment stage \"carrier\" 🏦 + \"transferring\" 🌐 (đã loại cancelled). INTER_FACTORY không tính.",
      note: "🆕 V38: Stage 1 & 2 không giảm \"Còn phải trả\" của NCC, chỉ chuyển sang sau khi user bấm \"Hoàn tất\". Cảnh báo nếu treo > 4 ngày."
    },
    {
      icon: "🟥",
      label: "Còn phải trả",
      definition: "Số tiền thực tế còn nợ NCC tại thời điểm xem.",
      formula: "= Hàng đã ship (đang VC + đã về kho) + Nợ đầu kỳ − Đã thanh toán (chỉ stage Hoàn tất ✅) − Quỹ TD đầu kỳ (tối thiểu 0)",
      note: "🆕 V38: KHÔNG trừ tiền đang ở stage 1+2 (mặc dù tiền đã ra khỏi GoChek). Chỉ trừ khi NCC xác nhận nhận tiền (stage 3)."
    },
    {
      icon: "🟩",
      label: "Quỹ tín dụng",
      definition: "Số tiền đã thanh toán dư cho NCC, sẽ được tự động bù trừ vào công nợ phát sinh sau.",
      formula: "= Số dương khi: (Đã thanh toán + Quỹ TD đầu kỳ) > (Hàng đã ship + Nợ đầu kỳ)",
      note: "Mỗi NCC tính riêng — không bù chéo giữa các NCC khác nhau."
    },
  ];

  return (
    <div style={{ marginTop: 16, background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", padding: "12px 18px", background: open ? C.green50 : "transparent",
          border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
          fontSize: 13, fontWeight: 600, color: C.green800, textAlign: "left", transition: "background 0.15s"
        }}
      >
        <span style={{ fontSize: 14 }}>📐</span>
        <span>Cách tính các chỉ số tài chính NCC</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: C.textMuted, fontWeight: 500 }}>
          {open ? "Bấm để ẩn" : "Bấm để xem"}
        </span>
        <span style={{ fontSize: 12, color: C.textMuted, transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0)" }}>▼</span>
      </button>
      {open && (
        <div style={{ padding: "16px 18px 18px", borderTop: `1px solid ${C.borderLight}` }}>
          <div style={{ display: "grid", gap: 14 }}>
            {items.map((item, i) => (
              <div key={i} style={{ paddingBottom: 14, borderBottom: i < items.length - 1 ? `1px dashed ${C.borderLight}` : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 16 }}>{item.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.green800 }}>{item.label}</span>
                </div>
                <div style={{ fontSize: 12, color: C.text, lineHeight: 1.6, marginBottom: 4 }}>
                  {item.definition}
                </div>
                <div style={{ fontSize: 11, color: C.green700, fontFamily: "monospace", background: C.green50, padding: "4px 8px", borderRadius: 4, marginBottom: 4, display: "inline-block" }}>
                  {item.formula}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, fontStyle: "italic" }}>
                  💡 {item.note}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, padding: "10px 12px", background: C.green50, borderRadius: 8, fontSize: 11, color: C.green800, lineHeight: 1.6 }}>
            <b>📌 Quan hệ giữa các chỉ số:</b><br/>
            • Tổng cam kết NCC = <b>Hàng chờ ship</b> + <b>Hàng đang VC</b> + <b>Hàng đã về kho</b> (3 chỉ số KHÔNG trùng lặp)<br/>
            • Hàng đã ship = Hàng đang VC + Hàng đã về kho (cơ sở phát sinh công nợ)<br/>
            • Còn phải trả + Quỹ tín dụng = chênh lệch giữa "Hàng đã ship" và "Đã thanh toán" (mỗi NCC tính riêng)<br/>
            • Lô shipment có status <b>Hủy</b> hoặc <b>Nháp</b> KHÔNG được tính vào bất kỳ chỉ số nào.<br/>
            <br/>
            <b>🆕 V34 — Cách quy đổi VND:</b><br/>
            • <b>Đã thanh toán (VND)</b>: cộng từ tỷ giá <i>thực tế lúc chuyển khoản</i> (lưu cứng từng payment) → khớp sao kê NH.<br/>
            • <b>Các chỉ số khác (VND)</b>: dùng tỷ giá <i>hệ thống hiện tại</i> ở Cấu hình → tham chiếu cho lập kế hoạch.<br/>
            • Vì 2 cách quy đổi khác nhau, phép cộng VND có thể không khớp tuyệt đối — đây là đặc tính bình thường của hệ thống đa tiền tệ. Để cộng dồn chính xác, dùng số <b>CNY</b>.
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// PRODUCTS v10 — ảnh (URL/upload), 2 tên, danh mục, filter category
// ============================================================
// v11 FIX: ImageHover dùng position:fixed (không phụ thuộc DOM tree) — ảnh to vẫn nổi lên trên bảng
const ImageHover = ({ src, size = 48 }) => {
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  if (!src) return (
    <div style={{ width: size, height: size, borderRadius: 8, background: C.green50, display: "flex", alignItems: "center", justifyContent: "center", color: C.textLight, fontSize: 18 }}>📦</div>
  );

  const handleEnter = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const popupW = 320; const popupH = 320;
    let x = rect.right + 12;
    let y = rect.top - 40;
    if (typeof window !== "undefined") {
      if (x + popupW > window.innerWidth) x = rect.left - popupW - 12;
      if (y < 10) y = 10;
      if (y + popupH > window.innerHeight) y = window.innerHeight - popupH - 10;
    }
    setPos({ x, y });
    setHover(true);
  };

  return (
    <div style={{ display: "inline-block" }} onMouseEnter={handleEnter} onMouseLeave={() => setHover(false)}>
      <img src={src} alt="" style={{ width: size, height: size, objectFit: "cover", borderRadius: 8, border: `1px solid ${C.border}`, background: "white", cursor: "zoom-in", display: "block" }}
           onError={(e) => { e.target.style.display = "none"; }} />
      {hover && (
        <div style={{
          position: "fixed", left: pos.x, top: pos.y, zIndex: 99999,
          background: "white", padding: 8, borderRadius: 12,
          boxShadow: "0 16px 48px rgba(0,0,0,0.35)", pointerEvents: "none",
          width: 320, height: 320, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <img src={src} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 6, background: "#f8f8f8" }} />
        </div>
      )}
    </div>
  );
};

const ProductForm = ({ initial, factories, markets = [], settings, onSave, onCreateCategory, onClose }) => {
  const [form, setForm] = useState(initial || {
    sku: "", name: "", nameImport: "", category: (settings.productCategories?.[0] || ""),
    imageUrl: "", factoryId: factories[0]?.id || "", unitPrice: "", currency: "CNY", unit: "cái", description: "", cost: "",
    lengthCm: "", widthCm: "", heightCm: "", qtyPerCarton: "",
    warehouseThresholds: {}, // v23 (giữ tương thích, nhưng V38j dùng warehouseTargets)
    warehouseTargets: {}, // v38j: { [whId]: { tonAnToan, slBanNgay, khongTheoDoi } }
    thoiGianSanXuat: 0, // v38j: ngày NCC sản xuất
    thoiGianVanChuyen: 0, // v38j: ngày vận chuyển NCC → kho
    soNgayDuKienBan: 0, // v38j: số ngày dự kiến bán
    externalSkus: {}, // v23b: SKU bên các phần mềm bán hàng
  });
  const [imgMode, setImgMode] = useState("url"); // url | upload
  const [showNewCat, setShowNewCat] = useState(false); // v11.2: popup tạo category
  const [newCatError, setNewCatError] = useState(null);
  // v36: Thay alert() bằng ConfirmDialog
  const [confirmDlg, setConfirmDlg] = useState(null);
  // v38j: Tab cấu hình
  const [activeTab, setActiveTab] = useState("info"); // "info" | "stock_config"
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const isValid = form.sku && form.name && form.factoryId && form.unitPrice;

  const handleFile = (file) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setConfirmDlg({ title: "Ảnh quá lớn", message: "Ảnh lớn hơn 2MB sẽ làm chậm hệ thống. Vui lòng chọn ảnh nhỏ hơn.", confirmLabel: "OK", cancelLabel: null, onConfirm: () => {} });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set("imageUrl", reader.result);
    reader.readAsDataURL(file);
  };

  const categories = settings.productCategories || [];

  // v11.2: Tạo danh mục mới — dùng PromptDialog thay native prompt
  const handleCreateCategory = () => {
    setNewCatError(null);
    setShowNewCat(true);
  };
  const onCreateCatConfirm = (name) => {
    if (!name) return;
    if (categories.some(c => c.toLowerCase() === name.toLowerCase())) {
      setNewCatError(`Danh mục "${name}" đã tồn tại`);
      return;
    }
    onCreateCategory?.(name);
    set("category", name);
    setShowNewCat(false);
  };

  // v11: Thể tích tính được
  const volCm3 = productVolumeCm3(form);
  const volM3 = cm3ToM3(volCm3);

  return (
    <Modal title={initial ? "Sửa sản phẩm" : "Thêm sản phẩm mới"} onClose={onClose} onSave={() => onSave(form)} saveDisabled={!isValid} width={920}>
      {/* v38j: Tab navigation */}
      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 18 }}>
        <button
          type="button"
          className={"btn " + (activeTab === "info" ? "btn-primary" : "btn-ghost")}
          style={{ borderRadius: 0, borderBottom: activeTab === "info" ? `2px solid ${C.green600}` : "none", fontSize: 12 }}
          onClick={() => setActiveTab("info")}
        >📦 Thông tin sản phẩm</button>
        <button
          type="button"
          className={"btn " + (activeTab === "stock_config" ? "btn-primary" : "btn-ghost")}
          style={{ borderRadius: 0, borderBottom: activeTab === "stock_config" ? `2px solid ${C.green600}` : "none", fontSize: 12 }}
          onClick={() => setActiveTab("stock_config")}
        >📊 Cấu hình tồn kho</button>
      </div>

      {activeTab === "info" && (
      <div className="form-grid">
        <div className="form-group"><label>Mã SKU *</label><input value={form.sku} onChange={e => set("sku", e.target.value)} placeholder="VD: S24-01" /></div>
        <div className="form-group"><label>Đơn vị</label><input value={form.unit} onChange={e => set("unit", e.target.value)} /></div>

        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Tên sản phẩm nội bộ *</label>
          <input value={form.name} onChange={e => set("name", e.target.value)} placeholder="VD: Ultra S24 Wireless Mic (Pro)" />
        </div>
        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Tên khai báo nhập khẩu</label>
          <input value={form.nameImport} onChange={e => set("nameImport", e.target.value)} placeholder="Tên dùng để khai báo hải quan" />
        </div>

        <div className="form-group">
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Danh mục</span>
            {onCreateCategory && (
              <button type="button" onClick={handleCreateCategory} style={{ background: "transparent", border: "none", color: C.green600, fontSize: 11, cursor: "pointer", fontWeight: 700 }}>+ Tạo mới</button>
            )}
          </label>
          <select value={form.category} onChange={e => set("category", e.target.value)}>
            <option value="">— Không chọn —</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Nhà cung cấp *</label>
          <select value={form.factoryId} onChange={e => set("factoryId", e.target.value)}>
            {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>

        {/* Image section */}
        <div className="form-group" style={{ gridColumn: "1/-1" }}>
          <label>Hình ảnh sản phẩm</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button type="button" className={`btn ${imgMode === "url" ? "btn-primary" : "btn-ghost"}`} style={{ padding: "6px 14px", fontSize: 12 }} onClick={() => setImgMode("url")}>🔗 Paste URL</button>
            <button type="button" className={`btn ${imgMode === "upload" ? "btn-primary" : "btn-ghost"}`} style={{ padding: "6px 14px", fontSize: 12 }} onClick={() => setImgMode("upload")}>📁 Upload file</button>
            {form.imageUrl && <button type="button" className="btn btn-ghost" style={{ padding: "6px 14px", fontSize: 12, color: C.red }} onClick={() => set("imageUrl", "")}>Xóa ảnh</button>}
          </div>
          {imgMode === "url" ? (
            <input value={form.imageUrl} onChange={e => set("imageUrl", e.target.value)} placeholder="https://... (link ảnh từ Shopee, Google Drive, v.v.)" />
          ) : (
            <input type="file" accept="image/*" onChange={e => handleFile(e.target.files[0])} style={{ padding: 8 }} />
          )}
          {form.imageUrl && (
            <div style={{ marginTop: 10 }}>
              <img src={form.imageUrl} alt="preview" style={{ maxWidth: 180, maxHeight: 180, borderRadius: 8, border: `1px solid ${C.border}` }} />
            </div>
          )}
        </div>

        <div className="form-group"><label>Giá mua *</label>
          <input type="number" step="0.01" min={0} value={form.unitPrice} onChange={e => set("unitPrice", e.target.value)} />
        </div>
        <div className="form-group"><label>Giá vốn</label>
          <input type="number" step="0.01" min={0} value={form.cost} onChange={e => set("cost", e.target.value)} placeholder="Nếu khác giá mua" />
        </div>
        <div className="form-group"><label>Tiền tệ</label>
          <select value={form.currency} onChange={e => set("currency", e.target.value)}>
            {["CNY", "USD", "VND"].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>

        {/* v11: Kích thước + SL/thùng */}
        <div className="form-group" style={{ gridColumn: "1/-1", paddingTop: 10, borderTop: `1px dashed ${C.border}`, marginTop: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green800, marginBottom: 4 }}>📐 KÍCH THƯỚC & ĐÓNG GÓI (dùng tính thể tích lô hàng)</div>
        </div>
        <div className="form-group"><label>Dài (cm)</label>
          <input type="number" step="0.1" min={0} value={form.lengthCm} onChange={e => set("lengthCm", e.target.value)} placeholder="VD: 15" />
        </div>
        <div className="form-group"><label>Rộng (cm)</label>
          <input type="number" step="0.1" min={0} value={form.widthCm} onChange={e => set("widthCm", e.target.value)} placeholder="VD: 10" />
        </div>
        <div className="form-group"><label>Cao (cm)</label>
          <input type="number" step="0.1" min={0} value={form.heightCm} onChange={e => set("heightCm", e.target.value)} placeholder="VD: 5" />
        </div>
        <div className="form-group"><label>SL / thùng carton</label>
          <input type="number" min={0} value={form.qtyPerCarton} onChange={e => set("qtyPerCarton", e.target.value)} placeholder="VD: 50" />
        </div>
        {volCm3 > 0 && (
          <div className="form-group" style={{ gridColumn: "1/-1" }}>
            <div style={{ padding: "8px 12px", background: C.green50, borderRadius: 8, fontSize: 12, color: C.green800 }}>
              📦 <b>Thể tích 1 SP:</b> {volCm3.toLocaleString()} cm³ = <b>{volM3.toFixed(5)} m³</b>
              {form.qtyPerCarton > 0 && <> · <b>Thể tích 1 thùng:</b> {(volM3 * Number(form.qtyPerCarton)).toFixed(4)} m³</>}
            </div>
          </div>
        )}

        {/* v23: Ngưỡng cảnh báo tồn kho theo từng kho */}
        <div className="form-group" style={{ gridColumn: "1/-1" }}>
          <label>🚨 Ngưỡng cảnh báo tồn kho theo từng kho</label>
          <div style={{ padding: 12, background: C.bg, borderRadius: 10, border: `1px solid ${C.borderLight}` }}>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10 }}>
              Khi tồn kho thực tế dưới ngưỡng → cảnh báo trên tab Tồn kho. Để trống hoặc 0 = không cảnh báo. Mỗi kho có ngưỡng riêng.
            </div>
            {markets.length === 0 ? (
              <div style={{ fontSize: 12, color: C.textMuted, fontStyle: "italic" }}>Chưa có thị trường/kho nào — vào tab Thị trường để thêm.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {markets.map(m => {
                  const whs = m.warehouses || [];
                  if (whs.length === 0) return null;
                  return (
                    <div key={m.id}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 4 }}>{getFlag(m.name)} {m.name}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6 }}>
                        {whs.map(w => {
                          const val = form.warehouseThresholds?.[w.id] ?? "";
                          return (
                            <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", background: C.white, borderRadius: 6, border: `1px solid ${C.borderLight}` }}>
                              <span style={{ flex: 1, fontSize: 11, color: C.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={w.name}>
                                {w.isDefault ? "⭐ " : ""}{w.name}
                              </span>
                              <input
                                type="number"
                                min={0}
                                value={val}
                                onChange={e => {
                                  const v = e.target.value;
                                  setForm(p => ({
                                    ...p,
                                    warehouseThresholds: {
                                      ...(p.warehouseThresholds || {}),
                                      [w.id]: v === "" ? "" : Number(v),
                                    },
                                  }));
                                }}
                                placeholder="0"
                                style={{ width: 70, fontSize: 12, padding: "4px 6px" }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* v23b: Section Mapping SKU bên phần mềm bán hàng */}
        <div className="form-group" style={{ gridColumn: "1/-1" }}>
          <label>🔗 SKU bên phần mềm bán hàng</label>
          <div style={{ padding: 12, background: C.bg, borderRadius: 10, border: `1px solid ${C.borderLight}` }}>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10 }}>
              Đối chiếu SKU của SP này bên các phần mềm bán hàng. Để trống nếu SP không có bên đó. Cần thiết khi import tồn kho từ Nhanh.vn / Pancake.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
              {Object.values(POS_SYSTEMS).filter(p => p.id !== "manual").map(p => (
                <div key={p.id} style={{ padding: "8px 10px", background: C.white, borderRadius: 8, border: `1px solid ${C.borderLight}` }}>
                  <div style={{ fontSize: 11, color: p.color, fontWeight: 700, marginBottom: 4 }}>{p.icon} {p.label}</div>
                  <input
                    value={(form.externalSkus || {})[p.id] || ""}
                    onChange={e => setForm(prev => ({
                      ...prev,
                      externalSkus: { ...(prev.externalSkus || {}), [p.id]: e.target.value },
                    }))}
                    placeholder={p.id === "nhanh" ? "VD: S2402" : "VD: GoChek S24-02"}
                    style={{ fontSize: 12 }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Mô tả</label>
          <textarea rows={2} value={form.description} onChange={e => set("description", e.target.value)} />
        </div>
      </div>
      )}

      {/* v38j: Tab cấu hình tồn kho */}
      {activeTab === "stock_config" && (
        <div>
          <div className="alert alert-info" style={{ marginBottom: 16, fontSize: 12 }}>
            <b>📊 Cấu hình tồn kho cho SP này:</b> giúp app tính đề xuất tạo SH + đề xuất đặt PO + cảnh báo trạng thái.
            <div style={{ marginTop: 6 }}>
              💡 Chị tự cài 3 thông số chung + cấu hình theo từng kho. Kho nào "Không theo dõi" → app sẽ bỏ qua trong cảnh báo.
            </div>
          </div>

          {/* 3 thông số chung */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              ⏱️ Thời gian + Dự kiến bán (chung cho SP, áp dụng mọi kho)
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label>Thời gian sản xuất (ngày)</label>
                <NumberInput min={0} value={form.thoiGianSanXuat || 0} onChange={e => set("thoiGianSanXuat", Number(e.target.value || 0))} placeholder="VD: 30" />
                <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>Số ngày NCC sản xuất từ lúc đặt PO đến lúc hàng sẵn sàng ship</div>
              </div>
              <div className="form-group">
                <label>Thời gian vận chuyển (ngày)</label>
                <NumberInput min={0} value={form.thoiGianVanChuyen || 0} onChange={e => set("thoiGianVanChuyen", Number(e.target.value || 0))} placeholder="VD: 15" />
                <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>Số ngày trung bình từ lúc ship khỏi NCC đến khi về kho</div>
              </div>
              <div className="form-group">
                <label>Số ngày dự kiến bán</label>
                <NumberInput min={0} value={form.soNgayDuKienBan || 0} onChange={e => set("soNgayDuKienBan", Number(e.target.value || 0))} placeholder="VD: 60" />
                <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>Số ngày muốn bán hết lô hàng (dùng để đề xuất số PO cần đặt)</div>
              </div>
              <div className="form-group" style={{ display: "flex", alignItems: "flex-end", paddingBottom: 12 }}>
                <div style={{ background: C.bg, padding: "8px 12px", borderRadius: 8, fontSize: 11, color: C.textMuted, width: "100%" }}>
                  ⏱️ Lead time = SX + VC = <b style={{ color: C.text }}>{Number(form.thoiGianSanXuat || 0) + Number(form.thoiGianVanChuyen || 0)} ngày</b>
                </div>
              </div>
            </div>
          </div>

          {/* Bảng kho */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              🏪 Cấu hình theo từng kho
            </div>
            {(() => {
              const allWh = [];
              (markets || []).forEach(m => (m.warehouses || []).forEach(w => allWh.push({ ...w, marketName: m.name })));
              if (allWh.length === 0) return <div className="alert alert-warn">Chưa có kho nào. Vào tab Cấu hình → Thị trường để thêm kho.</div>;
              return (
                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>🌍 Thị trường</th>
                        <th>🏪 Kho</th>
                        <th>Ngưỡng cảnh báo</th>
                        <th>SL bán/ngày</th>
                        <th>Không theo dõi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allWh.map(w => {
                        const t = (form.warehouseTargets || {})[w.id] || {};
                        const setTarget = (key, val) => {
                          setForm(p => ({
                            ...p,
                            warehouseTargets: {
                              ...(p.warehouseTargets || {}),
                              [w.id]: { ...(p.warehouseTargets || {})[w.id], [key]: val },
                            },
                          }));
                        };
                        return (
                          <tr key={w.id}>
                            <td style={{ fontSize: 12, color: C.textMuted }}>🌍 {w.marketName}</td>
                            <td style={{ fontWeight: 600 }}>🏪 {w.name}</td>
                            <td>
                              <NumberInput
                                min={0}
                                value={t.tonAnToan ?? 0}
                                onChange={e => setTarget("tonAnToan", Number(e.target.value || 0))}
                                placeholder="VD: 100"
                                style={{ width: 110 }}
                                disabled={t.khongTheoDoi}
                              />
                            </td>
                            <td>
                              <NumberInput
                                min={0}
                                step="0.1"
                                value={t.slBanNgay ?? 0}
                                onChange={e => setTarget("slBanNgay", Number(e.target.value || 0))}
                                placeholder="VD: 10"
                                style={{ width: 110 }}
                                disabled={t.khongTheoDoi}
                              />
                            </td>
                            <td>
                              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12 }}>
                                <input
                                  type="checkbox"
                                  checked={!!t.khongTheoDoi}
                                  onChange={e => setTarget("khongTheoDoi", e.target.checked)}
                                />
                                <span style={{ color: t.khongTheoDoi ? C.textMuted : C.text }}>
                                  {t.khongTheoDoi ? "⚪ Không theo dõi" : "Theo dõi"}
                                </span>
                              </label>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* v11.2: Popup tạo danh mục mới */}
      {showNewCat && (
        <PromptDialog
          title="Tạo danh mục mới"
          message={newCatError ? `⚠️ ${newCatError}` : "Nhập tên danh mục mới. Sau khi tạo sẽ tự chọn cho SP này."}
          placeholder="VD: Micro, Tai nghe, Loa..."
          confirmLabel="Tạo"
          onConfirm={onCreateCatConfirm}
          onClose={() => { setShowNewCat(false); setNewCatError(null); }}
        />
      )}
      {/* v36: Thay alert() khi upload ảnh quá to */}
      {confirmDlg && <ConfirmDialog {...confirmDlg} onClose={() => setConfirmDlg(null)} />}
    </Modal>
  );
};

// ============================================================
// v35: IMPORT PRODUCTS MODAL — Import sản phẩm hàng loạt từ Excel
// Flow: Step 1 chọn mode → Step 2 upload file → Step 3 preview & confirm
// v36: Thêm mode "upsert" + loading spinner + reset input file + nút tải file lỗi
// ============================================================
const ImportProductsModal = ({ products, factories, settings, onConfirm, onClose }) => {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState("create"); // "create" | "update" | "upsert"
  const [parseResult, setParseResult] = useState(null);
  // { items, errors, validItems, validationErrors, newCategoriesToCreate, fileName, fileSize }
  const [errorMsg, setErrorMsg] = useState("");
  const [importing, setImporting] = useState(false);
  // v36: Loading state cho parse file (file lớn 1k dòng có thể mất 2-5s)
  const [parsing, setParsing] = useState(false);

  // Tải template Excel — 2 sheet: Sản phẩm (header + ví dụ) + Hướng dẫn (NCC, danh mục, currency)
  const downloadTemplate = () => {
    // Sheet 1: Sản phẩm
    const productSheet = XLSX.utils.aoa_to_sheet([
      ["SKU", "Tên SP nội bộ", "Tên khai báo NK", "Mã NCC", "Tên NCC",
        "Giá mua", "Tiền tệ", "Giá vốn", "Đơn vị", "Danh mục", "Mô tả",
        "Dài (cm)", "Rộng (cm)", "Cao (cm)", "SL/thùng", "URL ảnh"],
      // 2 dòng ví dụ
      ["S26-01", "Ultra S26 Wireless Mic", "Wireless Microphone Model S26-01",
        factories[0]?.supplierCode || "NCC-001", "", 75, "CNY", "", "cái", "Micro",
        "Mic không dây thế hệ mới", 16, 11, 5, 40, ""],
      ["G2", "GoChek G2 Earphone", "TWS Earphone G2",
        factories[0]?.supplierCode || "NCC-001", "", 65, "CNY", "", "cái", "Tai nghe",
        "", 8, 6, 3, 80, ""],
    ]);
    // Set column widths cho dễ nhìn
    productSheet["!cols"] = [
      { wch: 12 }, { wch: 28 }, { wch: 32 }, { wch: 10 }, { wch: 24 },
      { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 24 },
      { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 28 },
    ];

    // Sheet 2: Hướng dẫn — danh sách NCC + danh mục + currency hợp lệ
    const factoryRows = factories.length > 0
      ? factories.map(f => [f.supplierCode || "(không có)", f.name || "", f.country || "", f.status === "active" ? "Đang hợp tác" : "Không hợp tác"])
      : [["(Chưa có NCC nào — vào tab Cấu hình → Nhà cung cấp để tạo trước)", "", "", ""]];
    const cats = settings?.productCategories || [];
    const catRows = cats.length > 0 ? cats.map(c => [c]) : [["(Chưa có danh mục — sẽ tự tạo khi import)"]];

    const guideSheet = XLSX.utils.aoa_to_sheet([
      ["📘 HƯỚNG DẪN ĐIỀN FILE IMPORT SẢN PHẨM"],
      [""],
      ["1. Cột BẮT BUỘC khi tạo mới: SKU, Tên SP nội bộ, Mã NCC (hoặc Tên NCC), Giá mua"],
      ["2. Cột tùy chọn: các cột còn lại — để trống nếu không có"],
      ["3. Mode 'Cập nhật': chỉ cần điền cột muốn đổi — cột trống sẽ giữ giá trị cũ"],
      ["4. Mode 'Upsert thông minh': SKU mới → tạo, SKU đã có → cập nhật (file hỗn hợp)"],
      ["5. Tối đa 1.000 dòng/file — vượt thì chia nhỏ"],
      [""],
      ["━━━ DANH SÁCH NHÀ CUNG CẤP HIỆN CÓ ━━━"],
      ["Mã NCC", "Tên NCC", "Quốc gia", "Trạng thái"],
      ...factoryRows,
      [""],
      ["━━━ DANH MỤC SẢN PHẨM HIỆN CÓ ━━━"],
      ["Tên danh mục"],
      ...catRows,
      ["(Danh mục mới trong file sẽ tự động được tạo khi import)"],
      [""],
      ["━━━ TIỀN TỆ HỢP LỆ ━━━"],
      ["CNY (Nhân dân tệ)"],
      ["VND (Việt Nam Đồng)"],
      ["USD (Đô la Mỹ)"],
      ["THB (Bath Thái)"],
      ["MYR (Ringgit Malaysia)"],
      ["PHP (Peso Philippines)"],
    ]);
    guideSheet["!cols"] = [{ wch: 40 }, { wch: 32 }, { wch: 16 }, { wch: 18 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, productSheet, "Sản phẩm");
    XLSX.utils.book_append_sheet(wb, guideSheet, "Hướng dẫn");
    const fname = `Template_SanPham_GoChek_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fname);
  };

  // v36: Tải file lỗi xuống Excel — giúp kế toán fix file gốc rồi import lại
  const downloadErrorFile = () => {
    if (!parseResult || parseResult.validationErrors.length === 0) return;
    const rows = [
      ["Dòng", "SKU", "Tên SP", "Mã NCC", "Tên NCC", "Giá mua", "Tiền tệ", "Lý do lỗi"],
      ...parseResult.validationErrors.map(e => [
        e.rowIdx, e.sku || "", e.name || "", e.factoryCode || "", e.factoryName || "",
        e.unitPrice ?? "", e.currency || "", e.errorReason || "",
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 28 }, { wch: 10 }, { wch: 22 }, { wch: 10 }, { wch: 8 }, { wch: 60 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Lỗi import");
    const baseName = (parseResult.fileName || "import").replace(/\.xlsx$/i, "");
    XLSX.writeFile(wb, `LoiImport_${baseName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleFileUpload = async (file) => {
    setErrorMsg("");
    setParseResult(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setErrorMsg("Chỉ chấp nhận file .xlsx");
      return;
    }
    // v36: Bật loading trước khi parse — file lớn có thể mất vài giây
    setParsing(true);
    try {
      const rows = await readXlsxFile(file);
      const { items, errors: parseErrors } = parseProductRows(rows);
      if (parseErrors.length > 0) {
        // Lỗi cấu trúc file — không thể parse
        setParseResult({
          items: [], parseErrors, validItems: [], validationErrors: [],
          newCategoriesToCreate: [], fileName: file.name, fileSize: file.size,
        });
        setStep(3);
        return;
      }
      const { validItems, invalidItems, newCategoriesToCreate } =
        validateProductImportBatch(items, products, factories, settings, mode);
      setParseResult({
        items, parseErrors: [], validItems, validationErrors: invalidItems,
        newCategoriesToCreate, fileName: file.name, fileSize: file.size,
      });
      setStep(3);
    } catch (err) {
      setErrorMsg(`Lỗi đọc file: ${err.message}`);
    } finally {
      setParsing(false);
    }
  };

  const handleConfirm = async () => {
    if (!parseResult || parseResult.validItems.length === 0) return;
    setImporting(true);
    try {
      await onConfirm({
        mode,
        validItems: parseResult.validItems,
        newCategoriesToCreate: parseResult.newCategoriesToCreate,
        fileName: parseResult.fileName,
      });
      onClose();
    } catch (e) {
      setErrorMsg(`Lỗi khi import: ${e.message}`);
    } finally {
      setImporting(false);
    }
  };

  // v36: Helper hiển thị label mode (3 mode)
  const modeLabel = (m) => {
    if (m === "create") return "🆕 Tạo mới hàng loạt";
    if (m === "update") return "🔄 Cập nhật hàng loạt";
    if (m === "upsert") return "🔀 Upsert thông minh";
    return m;
  };
  const modeColor = (m) => {
    if (m === "create") return C.green500;
    if (m === "update") return C.blue;
    if (m === "upsert") return C.purple;
    return C.green500;
  };
  const modeBg = (m) => {
    if (m === "create") return C.green50;
    if (m === "update") return "#e0f2fe";
    if (m === "upsert") return C.purpleBg;
    return C.green50;
  };

  const renderStep1 = () => (
    <>
      <div style={{ fontSize: 13, color: C.text, marginBottom: 16 }}>
        Chọn chế độ import phù hợp với mục đích của bạn:
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: 14, border: `2px solid ${mode === "create" ? C.green500 : C.border}`, borderRadius: 12, cursor: "pointer", background: mode === "create" ? C.green50 : C.white }}>
          <input type="radio" checked={mode === "create"} onChange={() => setMode("create")} style={{ marginTop: 3 }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.green800 }}>🆕 Tạo mới hàng loạt</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>
              Thêm nhiều SKU mới chưa có trong hệ thống. Nếu SKU trùng → báo lỗi, không ghi đè.
            </div>
          </div>
        </label>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: 14, border: `2px solid ${mode === "update" ? C.blue : C.border}`, borderRadius: 12, cursor: "pointer", background: mode === "update" ? "#e0f2fe" : C.white }}>
          <input type="radio" checked={mode === "update"} onChange={() => setMode("update")} style={{ marginTop: 3 }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.blue }}>🔄 Cập nhật hàng loạt</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>
              Sửa giá / kích thước / NCC cho SKU đã có. Cột trống = giữ giá trị cũ. SKU không tồn tại → báo lỗi.
            </div>
          </div>
        </label>
        {/* v36: Mode mới — Upsert thông minh */}
        <label style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: 14, border: `2px solid ${mode === "upsert" ? C.purple : C.border}`, borderRadius: 12, cursor: "pointer", background: mode === "upsert" ? C.purpleBg : C.white }}>
          <input type="radio" checked={mode === "upsert"} onChange={() => setMode("upsert")} style={{ marginTop: 3 }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.purple }}>🔀 Upsert thông minh</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>
              File hỗn hợp: <b>SKU mới</b> sẽ tự động <b>tạo</b> · <b>SKU đã có</b> sẽ <b>cập nhật</b>. Tiện khi sync danh mục từ nguồn ngoài.
            </div>
            <div style={{ fontSize: 11, color: C.purple, marginTop: 4, fontWeight: 600 }}>
              ⚠️ SKU mới vẫn yêu cầu Giá mua. SKU đã có thì cột trống = giữ cũ.
            </div>
          </div>
        </label>
      </div>
      <div style={{ borderTop: `1px solid ${C.borderLight}`, paddingTop: 14, marginTop: 4 }}>
        <button className="btn btn-ghost" onClick={downloadTemplate} style={{ fontSize: 12 }}>
          📥 Tải template Excel chuẩn
        </button>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>
          Template có sẵn header + 2 dòng ví dụ + sheet "Hướng dẫn" liệt kê NCC, danh mục, tiền tệ hợp lệ.
        </div>
      </div>
    </>
  );

  const renderStep2 = () => (
    <>
      <div style={{ background: modeBg(mode), padding: "8px 12px", borderRadius: 8, marginBottom: 14, fontSize: 12 }}>
        Chế độ: <b>{modeLabel(mode)}</b>
      </div>
      <div style={{ border: `2px dashed ${C.border}`, borderRadius: 12, padding: "30px 20px", textAlign: "center", background: C.bg }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>{parsing ? "⏳" : "📎"}</div>
        <div style={{ fontSize: 13, color: C.text, marginBottom: 14 }}>
          {parsing ? "Đang đọc và phân tích file..." : "Chọn file Excel để import"}
        </div>
        <input
          type="file"
          accept=".xlsx"
          disabled={parsing}
          onChange={(e) => handleFileUpload(e.target.files?.[0])}
          onClick={(e) => { e.target.value = ""; }}
          style={{ marginBottom: 8 }}
        />
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8 }}>
          Chỉ chấp nhận .xlsx · Tối đa 1.000 dòng
        </div>
      </div>
      {errorMsg && <div className="alert alert-danger" style={{ marginTop: 12 }}>{errorMsg}</div>}
      <div style={{ marginTop: 14, padding: "10px 12px", background: C.green50, borderRadius: 8, fontSize: 11, color: C.green800, lineHeight: 1.6 }}>
        <b>📌 Yêu cầu file:</b><br/>
        • Hàng 1: header (tên cột) — khớp với template<br/>
        • Hàng 2 trở đi: dữ liệu, mỗi dòng 1 SP<br/>
        • Cột bắt buộc khi tạo mới: <b>SKU, Tên SP, Mã NCC (hoặc Tên NCC), Giá mua</b><br/>
        • Mode cập nhật / upsert (cho SP có sẵn): chỉ cần điền cột muốn đổi<br/>
        • Tối đa <b>{MAX_PRODUCT_IMPORT_ROWS.toLocaleString()}</b> dòng/file
      </div>
    </>
  );

  const renderStep3 = () => {
    if (!parseResult) return null;
    const { items, parseErrors, validItems, validationErrors, newCategoriesToCreate, fileName } = parseResult;

    if (parseErrors.length > 0) {
      return (
        <>
          <div className="alert alert-danger" style={{ marginBottom: 12 }}>
            ❌ File <b>{fileName}</b> có lỗi cấu trúc, không thể đọc được.
          </div>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {parseErrors.map((e, i) => <li key={i} style={{ color: C.red, fontSize: 12, marginBottom: 4 }}>{e.reason}</li>)}
          </ul>
          <div style={{ marginTop: 14, fontSize: 12, color: C.textMuted }}>
            👉 Vui lòng tải template chuẩn và điền lại theo đúng cấu trúc.
          </div>
        </>
      );
    }

    const totalRows = items.length;
    const validCount = validItems.length;
    const errorCount = validationErrors.length;
    // v36: Đếm số SP sẽ tạo / update (riêng cho mode upsert)
    const willCreateCount = validItems.filter(it => it.status === "create").length;
    const willUpdateCount = validItems.filter(it => it.status === "update").length;

    return (
      <>
        <div style={{ marginBottom: 14, padding: "12px 14px", background: C.bg, borderRadius: 8, fontSize: 12 }}>
          📄 File: <b>{fileName}</b> · Mode: <b>{modeLabel(mode)}</b><br/>
          Đã đọc <b>{totalRows}</b> dòng · ✅ <b style={{ color: C.green600 }}>{validCount}</b> dòng OK
          {errorCount > 0 && <> · ❌ <b style={{ color: C.red }}>{errorCount}</b> dòng có lỗi</>}
          {/* v36: Breakdown create vs update khi mode upsert */}
          {mode === "upsert" && validCount > 0 && (
            <>
              <br/><span style={{ color: C.purple }}>🔀 Trong đó: <b>{willCreateCount}</b> sẽ tạo mới · <b>{willUpdateCount}</b> sẽ cập nhật</span>
            </>
          )}
        </div>

        {newCategoriesToCreate.length > 0 && (
          <div className="alert alert-info" style={{ marginBottom: 12, fontSize: 12 }}>
            🆕 Sẽ tự động tạo <b>{newCategoriesToCreate.length}</b> danh mục mới: {newCategoriesToCreate.join(", ")}
          </div>
        )}

        {/* Bảng các dòng OK */}
        {validCount > 0 && (
          <div style={{ marginBottom: 14, maxHeight: 280, overflowY: "auto", border: `1px solid ${C.borderLight}`, borderRadius: 8 }}>
            <table style={{ fontSize: 11 }}>
              <thead style={{ position: "sticky", top: 0, background: C.green50, zIndex: 1 }}>
                <tr>
                  <th style={{ padding: 6 }}>#</th>
                  <th style={{ padding: 6 }}>SKU</th>
                  <th style={{ padding: 6 }}>Tên</th>
                  <th style={{ padding: 6 }}>NCC</th>
                  <th style={{ padding: 6 }}>Giá</th>
                  <th style={{ padding: 6 }}>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {validItems.slice(0, 100).map((it, i) => {
                  // Trong mode update/upsert-update: existingProductId có sẵn → tìm product cũ để hiển thị tên/NCC nếu user không điền
                  const existingProduct = it.existingProductId ? products.find(p => p.id === it.existingProductId) : null;
                  const factoryName = it.factoryDisplay || (existingProduct ? factories.find(f => f.id === existingProduct.factoryId)?.name : "");
                  // v36: Trạng thái dựa trên it.status (per-item) thay vì mode chung
                  const isCreate = it.status === "create";
                  return (
                    <tr key={i}>
                      <td style={{ padding: 6, color: C.textMuted }}>{it.rowIdx}</td>
                      <td style={{ padding: 6, fontWeight: 600 }}>{it.sku}</td>
                      <td style={{ padding: 6 }}>{it.name || existingProduct?.name || "—"}</td>
                      <td style={{ padding: 6, fontSize: 10 }}>{factoryName || "—"}</td>
                      <td style={{ padding: 6, fontSize: 10 }}>{it.unitPrice !== "" && it.unitPrice != null ? `${Number(it.unitPrice).toLocaleString()} ${it.currency}` : (isCreate ? "—" : "(giữ cũ)")}</td>
                      <td style={{ padding: 6 }}>
                        {isCreate
                          ? <span style={{ color: C.green600 }}>✅ Sẽ tạo mới</span>
                          : <span style={{ color: C.blue }}>🔄 Sẽ cập nhật</span>}
                      </td>
                    </tr>
                  );
                })}
                {validItems.length > 100 && (
                  <tr><td colSpan={6} style={{ padding: 8, textAlign: "center", fontStyle: "italic", color: C.textMuted, fontSize: 10 }}>
                    ... và {validItems.length - 100} dòng OK khác (chỉ hiển thị 100 dòng đầu)
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Bảng các dòng lỗi — v36: giới hạn render 100 dòng + nút tải file lỗi */}
        {errorCount > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.red }}>
                ❌ {errorCount} dòng có lỗi {errorCount > 100 && <span style={{ color: C.textMuted, fontWeight: 400 }}>(hiển thị 100 dòng đầu)</span>}
              </div>
              <button className="btn btn-ghost" onClick={downloadErrorFile} style={{ fontSize: 11, padding: "4px 10px" }}>
                📥 Tải file lỗi (xlsx)
              </button>
            </div>
            <div style={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${C.red}40`, borderRadius: 8, background: C.redBg }}>
              <table style={{ fontSize: 11 }}>
                <thead style={{ position: "sticky", top: 0, background: "#fee2e2", zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: 6 }}>Dòng</th>
                    <th style={{ padding: 6 }}>SKU</th>
                    <th style={{ padding: 6 }}>Lý do lỗi</th>
                  </tr>
                </thead>
                <tbody>
                  {validationErrors.slice(0, 100).map((e, i) => (
                    <tr key={i}>
                      <td style={{ padding: 6, color: C.textMuted }}>{e.rowIdx}</td>
                      <td style={{ padding: 6, fontWeight: 600 }}>{e.sku || "—"}</td>
                      <td style={{ padding: 6, color: C.red }}>{e.errorReason || (Array.isArray(e.reasons) ? e.reasons.join("; ") : "Lỗi không xác định")}</td>
                    </tr>
                  ))}
                  {validationErrors.length > 100 && (
                    <tr><td colSpan={3} style={{ padding: 8, textAlign: "center", fontStyle: "italic", color: C.textMuted, fontSize: 10 }}>
                      ... và {validationErrors.length - 100} dòng lỗi khác — bấm <b>📥 Tải file lỗi</b> ở trên để xem hết
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {errorMsg && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{errorMsg}</div>}

        {validCount === 0 && (
          <div className="alert alert-warn">⚠️ Không có dòng nào hợp lệ để import. Vui lòng sửa lỗi trong file và thử lại.</div>
        )}
      </>
    );
  };

  // Footer buttons theo step
  const footer = (
    <div style={{ display: "flex", gap: 10, justifyContent: "space-between", width: "100%" }}>
      <div>
        {step > 1 && !importing && (
          <button className="btn btn-ghost" onClick={() => { setStep(step - 1); setErrorMsg(""); }}>← Quay lại</button>
        )}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-ghost" onClick={onClose} disabled={importing}>Hủy</button>
        {step === 1 && (
          <button className="btn btn-primary" onClick={() => setStep(2)}>Tiếp →</button>
        )}
        {step === 3 && parseResult && parseResult.validItems.length > 0 && (
          <button className="btn btn-primary" onClick={handleConfirm} disabled={importing}>
            {importing ? "Đang import..." : `✓ Import ${parseResult.validItems.length} dòng OK`}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !importing && onClose()}>
      <div className="modal" style={{ maxWidth: 880 }}>
        <div className="modal-header">
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.green800 }}>📥 Import sản phẩm từ Excel</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
              Bước {step}/3: {step === 1 ? "Chọn chế độ" : step === 2 ? "Upload file" : "Preview & Xác nhận"}
            </div>
          </div>
          <button onClick={onClose} disabled={importing} style={{ background: "transparent", border: "none", fontSize: 22, cursor: "pointer", color: C.textMuted }}>✕</button>
        </div>
        <div className="modal-body">
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
        </div>
        <div className="modal-footer">{footer}</div>
      </div>
    </div>
  );
};

const Products = ({ products, pos, shipments, factories, markets = [], settings, onAdd, onEdit, onDelete, onSaveSettings, onImportProducts, onUpdateProductTargets, user }) => {
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState({ factory: "", category: "", search: "" });
  // v38j: Wizard cấu hình tồn kho hàng loạt
  const [bulkWizard, setBulkWizard] = useState(false);

  const productStats = useMemo(() => products.map(p => {
    let totalOrdered = 0, totalShipped = 0;
    pos.forEach(po => {
      if (po.status === "Hủy") return; // v10: bỏ qua PO đã hủy
      const poItems = getPOItems(po);
      poItems.forEach(it => {
        if (it.productId !== p.id) return;
        totalOrdered += Number(it.quantity || 0);
        totalShipped += po.items ? shippedFromItem(po.id, it.id, shipments) : shippedFromPO(po.id, shipments);
      });
    });
    // v13: Bỏ tracking sản xuất. Chỉ còn: đã đặt, đã giao, còn lại (chưa giao).
    const remaining = Math.max(0, totalOrdered - totalShipped);
    return { ...p, totalOrdered, totalShipped, remaining };
  }), [products, pos, shipments]);

  const filtered = productStats.filter(p =>
    (!filter.factory || p.factoryId === filter.factory) &&
    (!filter.category || (p.category || "") === filter.category) &&
    (!filter.search || p.name.toLowerCase().includes(filter.search.toLowerCase()) || p.sku.toLowerCase().includes(filter.search.toLowerCase()) || (p.nameImport || "").toLowerCase().includes(filter.search.toLowerCase()))
  );

  const canEdit = can(user, "manage_products");
  const canManageSettings = can(user, "manage_settings");
  const categories = settings.productCategories || [];
  // v11.1: State cho popup quản lý danh mục ngay tại tab Sản phẩm
  const [showCatManager, setShowCatManager] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  // v11.2: State cho custom dialog (thay prompt/confirm native)
  const [confirmDlg, setConfirmDlg] = useState(null);
  const [promptDlg, setPromptDlg] = useState(null);

  const addCat = () => {
    const t = newCatName.trim();
    if (!t) return;
    if (categories.some(c => c.toLowerCase() === t.toLowerCase())) {
      setConfirmDlg({ title: "Trùng danh mục", message: `Danh mục "${t}" đã tồn tại.`, confirmLabel: "OK", onConfirm: () => {} });
      return;
    }
    onSaveSettings({ ...settings, productCategories: [...categories, t] });
    setNewCatName("");
  };
  const removeCat = (cat) => {
    setConfirmDlg({
      title: `Xóa danh mục "${cat}"?`,
      message: `Các SP đang gán danh mục này sẽ không còn danh mục.\n\nHành động này KHÔNG THỂ hoàn tác.`,
      danger: true, confirmLabel: "Xóa",
      onConfirm: () => onSaveSettings({ ...settings, productCategories: categories.filter(c => c !== cat) }),
    });
  };
  const renameCat = (oldName) => {
    setPromptDlg({
      title: `Đổi tên danh mục`,
      message: `Tên cũ: "${oldName}"`,
      placeholder: "Nhập tên mới...",
      defaultValue: oldName,
      confirmLabel: "Đổi tên",
      onConfirm: (newName) => {
        if (!newName || newName === oldName) return;
        if (categories.some(c => c.toLowerCase() === newName.toLowerCase() && c !== oldName)) {
          setConfirmDlg({ title: "Trùng danh mục", message: `Danh mục "${newName}" đã tồn tại.`, confirmLabel: "OK", onConfirm: () => {} });
          return;
        }
        onSaveSettings({ ...settings, productCategories: categories.map(c => c === oldName ? newName : c) });
      },
    });
  };

  return (
    <div>
      <SectionHeader title="Sản phẩm" subtitle="Quản lý SKU, tồn kho, đặt hàng, giao hàng"
        action={
          <div style={{ display: "flex", gap: 8 }}>
            {canManageSettings && <button className="btn btn-ghost" onClick={() => setShowCatManager(true)}>🏷️ Quản lý danh mục</button>}
            {canEdit && <button className="btn btn-ghost" onClick={() => setBulkWizard(true)} title="Cấu hình tồn an toàn hàng loạt cho nhiều SP cùng lúc">🪄 Cấu hình tồn kho hàng loạt</button>}
            {canEdit && <button className="btn btn-ghost" onClick={() => setModal({ type: "import" })}>📥 Import Excel</button>}
            {canEdit && <button className="btn btn-primary" onClick={() => setModal({ type: "new" })}>+ Thêm sản phẩm</button>}
          </div>
        }
      />

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input placeholder="🔍 Tìm SKU hoặc tên..." value={filter.search} onChange={e => setFilter(p => ({ ...p, search: e.target.value }))} style={{ width: 280 }} />
        <select style={{ width: 200 }} value={filter.category} onChange={e => setFilter(p => ({ ...p, category: e.target.value }))}>
          <option value="">Tất cả danh mục</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select style={{ width: 220 }} value={filter.factory} onChange={e => setFilter(p => ({ ...p, factory: e.target.value }))}>
          <option value="">Tất cả nhà cung cấp</option>
          {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

      <div className="card" style={{ padding: 0, overflow: "visible" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 64 }}>Ảnh</th>
              <th>SKU</th><th>Sản phẩm</th><th>Danh mục</th><th>NCC</th><th>Giá</th>
              <th>Đã đặt</th><th>Đã giao</th><th>Còn lại</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const f = factories.find(x => x.id === p.factoryId);
              return (
                <tr key={p.id}>
                  <td><ImageHover src={p.imageUrl} /></td>
                  <td style={{ fontWeight: 700, color: C.green600 }}>{p.sku}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: C.textMuted }}>{p.description}</div>
                  </td>
                  <td>{p.category ? <Badge label={p.category} color={C.green800} bg={C.green50} /> : <span style={{ color: C.textLight, fontSize: 11 }}>—</span>}</td>
                  <td style={{ fontSize: 12 }}>{f?.name}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{fmt(p.unitPrice, p.currency)}</div>
                    <div style={{ fontSize: 11, color: C.textMuted }}>≈ {fmt(toVND(p.unitPrice, p.currency, settings), "VND")}</div>
                  </td>
                  <td style={{ fontWeight: 600 }}>{p.totalOrdered.toLocaleString()}</td>
                  <td style={{ color: C.blue, fontWeight: 600 }}>{p.totalShipped.toLocaleString()}</td>
                  <td style={{ color: p.remaining > 0 ? C.orange : C.green600, fontWeight: 600 }}>{p.remaining.toLocaleString()}</td>
                  {canEdit && (
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: p })}>Sửa</button>
                        <button className="btn btn-danger" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => onDelete("products", p.id)}>X</button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal?.type === "new" && <ProductForm factories={factories} markets={markets} settings={settings}
        onCreateCategory={canEdit ? (cat) => onSaveSettings({ ...settings, productCategories: [...(settings.productCategories || []), cat] }) : null}
        onSave={f => { onAdd("products", { id: `p${uid()}`, ...f }); setModal(null); }} onClose={() => setModal(null)} />}
      {modal?.type === "edit" && <ProductForm initial={modal.data} factories={factories} markets={markets} settings={settings}
        onCreateCategory={canEdit ? (cat) => onSaveSettings({ ...settings, productCategories: [...(settings.productCategories || []), cat] }) : null}
        onSave={f => { onEdit("products", modal.data.id, f); setModal(null); }} onClose={() => setModal(null)} />}

      {/* v35: Modal import sản phẩm từ Excel */}
      {modal?.type === "import" && (
        <ImportProductsModal
          products={products}
          factories={factories}
          settings={settings}
          onConfirm={({ mode, validItems, newCategoriesToCreate, fileName }) => {
            // v35: Gọi 1 transaction tổng từ App — chỉ ghi 1 audit log batch.
            // Tự động tạo danh mục mới + tạo/cập nhật toàn bộ SP trong 1 lần save.
            onImportProducts({ mode, validItems, newCategoriesToCreate, fileName });
            setModal(null);
            // v36: Tính số tạo mới / cập nhật từ it.status (per-item, hỗ trợ mode upsert)
            const createdN = validItems.filter(it => it.status === "create").length;
            const updatedN = validItems.filter(it => it.status === "update").length;
            let breakdown;
            if (mode === "create") breakdown = `Đã tạo mới ${validItems.length} sản phẩm`;
            else if (mode === "update") breakdown = `Đã cập nhật ${validItems.length} sản phẩm`;
            else breakdown = `Đã xử lý ${validItems.length} sản phẩm (tạo ${createdN} · cập nhật ${updatedN})`;
            setConfirmDlg({
              title: "✅ Import thành công",
              message: `${breakdown} từ file "${fileName}".${newCategoriesToCreate.length > 0 ? `\n\nĐã tự động tạo ${newCategoriesToCreate.length} danh mục mới: ${newCategoriesToCreate.join(", ")}` : ""}`,
              confirmLabel: "OK",
              onConfirm: () => {},
            });
          }}
          onClose={() => setModal(null)}
        />
      )}

      {/* v11.1: Popup quản lý danh mục ngay tại tab Sản phẩm */}
      {showCatManager && (
        <Modal title="🏷️ Quản lý danh mục sản phẩm" subtitle="Thêm / sửa / xóa danh mục · Thay đổi được lưu ngay"
          onClose={() => setShowCatManager(false)}
          onSave={() => setShowCatManager(false)}
          saveLabel="Đóng" width={560}>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="Tên danh mục mới..."
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCat(); } }} />
            <button className="btn btn-primary" style={{ whiteSpace: "nowrap" }} onClick={addCat}>+ Thêm</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {categories.length === 0 && (
              <div style={{ fontSize: 12, color: C.textLight, fontStyle: "italic", padding: 12, textAlign: "center" }}>Chưa có danh mục nào. Hãy thêm danh mục đầu tiên.</div>
            )}
            {categories.map(cat => {
              const usedCount = products.filter(p => p.category === cat).length;
              return (
                <div key={cat} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: C.green50, border: `1px solid ${C.green200}`, borderRadius: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.green800, flex: 1 }}>{cat}</span>
                  <span style={{ fontSize: 11, color: C.textMuted }}>{usedCount} SP</span>
                  <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => renameCat(cat)}>✎ Đổi tên</button>
                  <button className="btn btn-danger" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => removeCat(cat)}>✕ Xóa</button>
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {/* v11.2: Custom dialogs thay cho prompt/confirm native */}
      {confirmDlg && <ConfirmDialog {...confirmDlg} onClose={() => setConfirmDlg(null)} />}
      {promptDlg && <PromptDialog {...promptDlg} onClose={() => setPromptDlg(null)} />}

      {/* v38j: Wizard cấu hình tồn kho hàng loạt */}
      {bulkWizard && (
        <BulkStockConfigWizard
          products={products}
          markets={markets}
          onApply={(productIds, warehouseId, target) => {
            onUpdateProductTargets?.(productIds, warehouseId, target);
            setBulkWizard(false);
          }}
          onClose={() => setBulkWizard(false)}
        />
      )}
    </div>
  );
};

// ============================================================
// PO — Với expandable detail
// ============================================================
const POForm = ({ initial, prefilled, factories, products, shipments, data, user, onRenameId, onSave, onClose }) => {
  const [form, setForm] = useState(initial ? {
    ...initial,
    items: getPOItems(initial).map(it => ({ ...it })),
  } : (prefilled ? {
    // v38j: Prefill từ tab Tồn kho (đề xuất đặt PO) — vẫn là form NEW
    id: "",
    factoryId: prefilled.factoryId || factories[0]?.id || "",
    currency: prefilled.currency || "CNY",
    orderDate: new Date().toISOString().slice(0, 10),
    expectedDate: "",
    status: "Chờ duyệt",
    approved: false,
    note: prefilled.note || "",
    items: prefilled.items || [],
  } : {
    id: "",
    factoryId: factories[0]?.id || "", currency: "CNY",
    orderDate: new Date().toISOString().slice(0, 10), expectedDate: "", status: "Chờ duyệt", approved: false, note: "",
    items: [],
  }));
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // v38f: Hỗ trợ đổi mã PO — chỉ active khi đang sửa (initial truthy)
  const isEdit = !!initial;
  const renameCheck = isEdit && data ? canRenamePO(initial.id, data) : { allowed: true, reasons: [] };
  const canRename = isEdit && renameCheck.allowed;
  const idChanged = isEdit && form.id !== initial.id;
  const [renameDlg, setRenameDlg] = useState(null);
  const canShowRename = isEdit && user?.role === "admin" && renameCheck.allowed;
  const currentId = isEdit ? initial.id : "";

  const factoryProducts = products.filter(p => p.factoryId === form.factoryId);

  const addItem = () => {
    // v38g: KHÔNG auto-fill SP đầu tiên — user phải tự chọn qua Combobox.
    // Tránh trường hợp user quên đổi SP → lưu nhầm SP đầu list.
    setForm(p => ({
      ...p,
      items: [...p.items, { id: `it${uid()}`, productId: "", quantity: 0, unitPrice: 0 }],
    }));
  };

  const updateItem = (idx, field, val) => {
    setForm(p => ({
      ...p,
      items: p.items.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, [field]: val };
        // Auto-fill price khi đổi sản phẩm
        if (field === "productId") {
          const prod = products.find(pp => pp.id === val);
          if (prod) next.unitPrice = prod.unitPrice;
        }
        return next;
      })
    }));
  };

  const removeItem = (idx) => setForm(p => ({ ...p, items: p.items.filter((_, i) => i !== idx) }));

  const handleFactoryChange = (fid) => {
    setForm(p => ({ ...p, factoryId: fid, items: [] })); // Reset items khi đổi NM
  };

  const totalValue = form.items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0);
  const totalQty = form.items.reduce((s, it) => s + Number(it.quantity || 0), 0);

  const errors = [];
  if (!form.factoryId) errors.push("Chọn nhà máy");
  if (form.items.length === 0) errors.push("Thêm ít nhất 1 sản phẩm");
  form.items.forEach((it, idx) => {
    if (!it.productId) errors.push(`Dòng ${idx + 1}: Chọn sản phẩm`);
    if (!Number(it.quantity) || Number(it.quantity) <= 0) errors.push(`Dòng ${idx + 1}: Số lượng > 0`);
    if (!Number(it.unitPrice) || Number(it.unitPrice) <= 0) errors.push(`Dòng ${idx + 1}: Đơn giá > 0`);
  });
  // Check duplicate products
  const productIds = form.items.map(it => it.productId).filter(Boolean);
  if (new Set(productIds).size !== productIds.length) errors.push("Không được chọn trùng sản phẩm");

  const isValid = errors.length === 0;

  return (
    <Modal title={initial ? "Sửa đơn đặt hàng" : "Tạo đơn đặt hàng mới"}
      subtitle={totalValue > 0 ? `${form.items.length} dòng · SL tổng: ${totalQty.toLocaleString()} · Giá trị: ${fmt(totalValue, form.currency)}` : null}
      onClose={onClose} onSave={() => onSave(form)} saveDisabled={!isValid} width={880}>
      <div className="form-grid">
        <div className="form-group" style={{ gridColumn: "1/-1" }}>
          <label>Mã PO {initial ? "" : "(tùy chọn)"} {canShowRename && <span style={{ fontSize: 10, color: C.textMuted, fontWeight: 400 }}>(admin có thể đổi mã)</span>}</label>
          {/* v38f: Khi sửa + admin → hiển thị input + nút "Đổi mã". Khi sửa + không phải admin → disabled như cũ. */}
          {!!initial && canShowRename ? (
            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
              <input value={currentId} disabled style={{ flex: 1, background: C.bg, fontFamily: "monospace", fontWeight: 600 }} />
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: "0 14px", fontSize: 12, color: C.orange, borderColor: C.orange }}
                onClick={() => {
                  // Mở dialog rename — pass current ID, callback nhận newId
                  setRenameDlg({
                    oldId: currentId,
                  });
                }}
              >🔄 Đổi mã</button>
            </div>
          ) : (
            <input value={form.id} onChange={e => set("id", e.target.value)} disabled={!!initial} placeholder={initial ? "" : "Để trống để tự sinh mã. VD: PO-S24-001"} />
          )}
          {!initial && <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>Nếu không đặt, hệ thống tự tạo mã theo định dạng PO-2026-xxxxx</div>}
          {!!initial && !canShowRename && (
            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>Mã PO không thể sửa (chỉ admin có quyền đổi mã)</div>
          )}
        </div>
        <div className="form-group">
          <label>Nhà máy sản xuất *</label>
          <select value={form.factoryId} onChange={e => handleFactoryChange(e.target.value)}>
            {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Tiền tệ</label>
          <select value={form.currency} onChange={e => set("currency", e.target.value)}>
            {["CNY", "USD", "VND"].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Ngày đặt</label>
          <input type="date" value={form.orderDate} onChange={e => set("orderDate", e.target.value)} />
        </div>
        <div className="form-group"><label>Ngày hoàn thành DK</label>
          <input type="date" value={form.expectedDate} onChange={e => set("expectedDate", e.target.value)} />
        </div>
      </div>

      {/* Items */}
      <div style={{ padding: 16, background: C.green50, borderRadius: 12, border: `1px solid ${C.green200}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.green700 }}>📦 Danh sách sản phẩm</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Chọn nhiều sản phẩm từ nhà máy này ({factoryProducts.length} SP khả dụng)</div>
          </div>
          <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: 12 }} onClick={addItem} disabled={factoryProducts.length === 0 || form.items.length >= factoryProducts.length}>
            + Thêm sản phẩm
          </button>
        </div>

        {form.items.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: C.textMuted, fontSize: 12, background: C.white, borderRadius: 8 }}>
            Chưa có sản phẩm nào. Click "+ Thêm sản phẩm" để bắt đầu.
          </div>
        )}

        {form.items.map((it, idx) => {
          const lineTotal = Number(it.quantity || 0) * Number(it.unitPrice || 0);
          // v38e: Loại trừ SP đã được chọn ở dòng khác (giữ SP đang chọn của dòng này)
          const excludeKeys = form.items
            .filter((other, i) => i !== idx && other.productId)
            .map(other => other.productId);
          return (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 110px 120px 40px", gap: 8, marginBottom: 8, padding: 10, background: C.white, borderRadius: 10, alignItems: "center" }}>
              {/* v38e: Combobox tìm SP theo SKU/tên/tên TQ/danh mục */}
              <Combobox
                items={factoryProducts}
                value={it.productId}
                onChange={(key) => updateItem(idx, "productId", key || "")}
                getKey={p => p.id}
                getLabel={p => `${p.sku} — ${p.name}`}
                getSearchText={p => `${p.sku || ""} ${p.name || ""} ${p.nameImport || ""} ${p.category || ""}`}
                placeholder="🔍 Tìm SP theo SKU / tên / tên TQ / danh mục..."
                excludeKeys={excludeKeys}
                emptyText={form.factoryId ? "NCC này chưa có SP. Vào tab Sản phẩm để tạo." : "Chưa chọn NCC"}
              />
              <NumberInput value={it.quantity} onChange={e => updateItem(idx, "quantity", e.target.value)} placeholder="SL" min={0} />
              <NumberInput step="0.01" min={0} value={it.unitPrice} onChange={e => updateItem(idx, "unitPrice", e.target.value)} placeholder="Đơn giá" />
              <button className="btn btn-danger" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => removeItem(idx)}>✕</button>
              <div style={{ gridColumn: "1/-1", fontSize: 11, color: C.textMuted, display: "flex", justifyContent: "space-between" }}>
                <span>Dòng {idx + 1}</span>
                {lineTotal > 0 && <span style={{ color: C.green600, fontWeight: 600 }}>= {fmt(lineTotal, form.currency)}</span>}
              </div>
            </div>
          );
        })}

        {form.items.length > 0 && (
          <div style={{ marginTop: 12, padding: 12, background: C.white, borderRadius: 10, display: "flex", justifyContent: "flex-end", gap: 24, fontSize: 13 }}>
            <span>Tổng SL: <b>{totalQty.toLocaleString()}</b></span>
            <span>Tổng giá trị: <b style={{ color: C.green600 }}>{fmt(totalValue, form.currency)}</b></span>
          </div>
        )}
      </div>

      <div className="form-group"><label>Ghi chú</label>
        <textarea rows={2} value={form.note} onChange={e => set("note", e.target.value)} />
      </div>

      {errors.length > 0 && <div className="alert alert-danger">{errors.map((e, i) => <div key={i}>• {e}</div>)}</div>}
      {!initial && isValid && <div className="alert alert-info">PO mới sẽ ở trạng thái <b>"Chờ duyệt"</b>. Kế toán hoặc Admin cần duyệt trước khi tạo đơn giao hàng.</div>}
      {factoryProducts.length === 0 && <div className="alert alert-warn">Nhà máy này chưa có sản phẩm nào. Vui lòng thêm sản phẩm trước.</div>}
      {/* v38f: Dialog xác nhận đổi mã PO — chỉ render khi user mở */}
      {renameDlg && (() => {
        // Tạo state cho input newId qua sub-component
        return <PORenamePromptDialog
          oldId={renameDlg.oldId}
          data={data}
          onConfirmRename={(newId) => {
            // Gọi onRenameId trực tiếp — App sẽ update data + audit log
            if (typeof onRenameId === "function") {
              onRenameId("pos", renameDlg.oldId, newId);
            }
            // Update form state để hiện ID mới ngay
            setForm(p => ({ ...p, id: newId }));
            setRenameDlg(null);
          }}
          onClose={() => setRenameDlg(null)}
        />;
      })()}
    </Modal>
  );
};

// v38f: Sub-component để xử lý prompt nhập newId + check ràng buộc
// Tách riêng vì cần state newId riêng để check liên tục khi user gõ
const PORenamePromptDialog = ({ oldId, data, onConfirmRename, onClose }) => {
  const [newId, setNewId] = useState("");
  const trimmedNewId = newId.trim();
  // Check liên tục khi user gõ (live validation)
  const checkResult = useMemo(() => {
    if (!trimmedNewId) return { allowed: false, reasons: [] }; // chưa gõ — chưa check
    return canRenamePO(oldId, data, trimmedNewId);
  }, [oldId, data, trimmedNewId]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 540 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{ background: C.orangeBg, borderBottom: `2px solid ${C.orange}` }}>
          <div>
            <h3 style={{ color: C.orange, margin: 0 }}>🔄 Đổi mã PO</h3>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>Nhập mã PO mới để bắt đầu</div>
          </div>
          <button onClick={onClose} className="btn btn-ghost" style={{ padding: "4px 10px" }}>✕</button>
        </div>
        <div style={{ padding: "20px 24px" }}>
          <div style={{ background: C.bg, padding: "12px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
            <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Mã hiện tại:</div>
            <code style={{ background: C.white, padding: "4px 10px", borderRadius: 4, fontWeight: 700, color: C.text }}>{oldId}</code>
          </div>

          <div className="form-group" style={{ marginBottom: 14 }}>
            <label style={{ fontWeight: 600 }}>Mã PO mới:</label>
            <input
              type="text"
              value={newId}
              onChange={e => setNewId(e.target.value)}
              placeholder="VD: PO-2026-XXXXX"
              autoFocus
              style={{ fontFamily: "monospace", fontWeight: 600 }}
            />
          </div>

          {trimmedNewId && trimmedNewId === oldId && (
            <div className="alert alert-info" style={{ marginBottom: 14 }}>
              💡 Mã mới giống mã cũ — không có gì để thay đổi.
            </div>
          )}

          {trimmedNewId && trimmedNewId !== oldId && !checkResult.allowed && (
            <div className="alert alert-danger" style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>❌ Không thể đổi mã:</div>
              <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
                {checkResult.reasons.map((r, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {trimmedNewId && trimmedNewId !== oldId && checkResult.allowed && (
            <div className="alert alert-warn" style={{ marginBottom: 0 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>⚠️ Sẵn sàng đổi mã:</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <code style={{ background: C.white, padding: "3px 8px", borderRadius: 4, color: C.textMuted }}>{oldId}</code>
                <span>→</span>
                <code style={{ background: C.green50, padding: "3px 8px", borderRadius: 4, fontWeight: 700, color: C.green700 }}>{trimmedNewId}</code>
              </div>
              <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: 12, lineHeight: 1.6 }}>
                <li>Mã sẽ thay đổi vĩnh viễn. Audit log ghi cả mã cũ + mới.</li>
                <li>Báo cáo Excel cũ đã xuất sẽ vẫn ghi mã cũ (<b>{oldId}</b>) — không tự cập nhật.</li>
              </ul>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Đóng</button>
          <button
            className="btn btn-primary"
            disabled={!trimmedNewId || trimmedNewId === oldId || !checkResult.allowed}
            onClick={() => onConfirmRename(trimmedNewId)}
            style={{
              background: C.orange,
              borderColor: C.orange,
              opacity: (!trimmedNewId || trimmedNewId === oldId || !checkResult.allowed) ? 0.5 : 1,
            }}
          >
            🔄 Đổi mã
          </button>
        </div>
      </div>
    </div>
  );
};

// v13: ProducedForm đã bị BỎ — kế toán không cần nhập tiến độ sản xuất nữa.
// Số lượng "đã giao" được tính tự động từ shipments (đã ship + đã về kho).

const POs = ({ pos, factories, products, shipments, markets = [], settings, onAdd, onEdit, onDelete, onHardDelete, onRenameId, data, onConfirm, prefill, onClearPrefill, user }) => {
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState({ factory: "", status: "", search: "" });
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expanded, setExpanded] = useState(null);

  // v38j: Auto-open create modal khi có prefill từ tab Tồn kho
  useEffect(() => {
    if (prefill && prefill.productId) {
      const product = products.find(p => p.id === prefill.productId);
      if (product) {
        // Tạo prefilled object — POForm sẽ dùng làm default cho form NEW
        const prefilledData = {
          factoryId: product.factoryId || prefill.factoryId || factories[0]?.id || "",
          currency: product.currency || "CNY",
          note: `[Đề xuất từ tồn kho] ${product.sku} - ${product.name}`,
          items: [{
            id: `it${uid()}`,
            productId: product.id,
            quantity: Number(prefill.quantity || 0),
            unitPrice: Number(product.unitPrice || 0),
          }],
        };
        setModal({ type: "new", prefilled: prefilledData });
        onClearPrefill?.();
      }
    }
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  const canEdit = can(user, "edit_po");
  const canCreate = can(user, "create_po");
  const canDelete = can(user, "delete_po");
  const canApprove = can(user, "approve_po");
  // v37: Quyền xuất báo cáo PO — dùng quyền export_accounting_report đã có sẵn
  const canExport = can(user, "export_accounting_report");
  // v20: Admin override
  const isAdmin = user?.role === "admin";

  // v11.2: State cho custom dialog
  const [promptDlg, setPromptDlg] = useState(null);
  // v36: ConfirmDialog state để thay alert() native (mã PO trùng)
  const [confirmDlg, setConfirmDlg] = useState(null);
  // v37: State cho modal xuất báo cáo PO
  const [exportModal, setExportModal] = useState(null);
  const [exporting, setExporting] = useState(false);
  // v38d: State cho hard delete dialog
  const [hardDeleteDlg, setHardDeleteDlg] = useState(null);

  // v37: Handler xuất báo cáo PO chi tiết — dùng filter hiện tại của tab.
  // Trả về Promise để có thể await và cập nhật loading state.
  const handleExportPOReport = async ({ dateFrom: f, dateTo: t, factoryFilter, statusFilter }) => {
    setExporting(true);
    try {
      const fname = await exportPOReport({
        pos, factories, products, shipments, markets, settings,
        dateFrom: f, dateTo: t, factoryFilter, statusFilter,
        exportedBy: user?.fullName || user?.username || "-",
      });
      setConfirmDlg({ title: "✓ Xuất file thành công", message: `Đã xuất file: ${fname}`, confirmLabel: "OK", cancelLabel: null, onConfirm: () => {} });
      setExportModal(null);
    } catch (e) {
      console.error("Export PO report error:", e);
      setConfirmDlg({ title: "Lỗi xuất file", message: e.message, danger: true, confirmLabel: "OK", cancelLabel: null, onConfirm: () => {} });
    } finally {
      setExporting(false);
    }
  };

  const handleApprove = (po) => {
    onConfirm({
      title: `Duyệt PO ${po.id}?`,
      message: `Sau khi duyệt, PO sẽ chuyển sang trạng thái "Đã duyệt" và sẵn sàng để tạo đơn giao hàng.\nPO đã duyệt KHÔNG THỂ sửa được nữa.\n\nBạn có chắc chắn muốn duyệt?`,
      confirmLabel: "✓ Duyệt",
      onConfirm: () => {
        onEdit("pos", po.id, {
          approved: true,
          approvedBy: user.fullName,
          approvedAt: new Date().toISOString().slice(0, 10),
          status: "Đã duyệt",
        });
      },
    });
  };

  // v11.2: Hủy PO — yêu cầu lý do (dùng PromptDialog thay prompt native)
  const handleReject = (po) => {
    setPromptDlg({
      title: `Hủy PO ${po.id}?`,
      message: "Nhập lý do hủy (bắt buộc). Sau khi hủy, PO không thể khôi phục.",
      placeholder: "VD: Thị trường không còn nhu cầu, chuyển NCC khác...",
      confirmLabel: "🚫 Xác nhận Hủy",
      required: true,
      multiline: true,
      onConfirm: (reason) => {
        onEdit("pos", po.id, {
          status: "Hủy",
          approved: false,
          cancelledBy: user.fullName,
          cancelledAt: new Date().toISOString().slice(0, 10),
          cancelReason: reason,
        });
      },
    });
  };

  const filtered = useMemo(() => {
    const searchLower = (filter.search || "").toLowerCase().trim();
    const matched = filterByDateRange(pos, "orderDate", dateFrom, dateTo).filter(p => {
      if (filter.factory && p.factoryId !== filter.factory) return false;
      if (filter.status && p.status !== filter.status) return false;
      if (!searchLower) return true;
      // v10: Search theo mã PO, hoặc SKU / Tên sản phẩm trong items
      if (p.id.toLowerCase().includes(searchLower)) return true;
      const items = getPOItems(p);
      return items.some(it => {
        const prod = products.find(x => x.id === it.productId);
        if (!prod) return false;
        return (prod.sku || "").toLowerCase().includes(searchLower) ||
               (prod.name || "").toLowerCase().includes(searchLower) ||
               (prod.nameImport || "").toLowerCase().includes(searchLower);
      });
    });
    // v38b: Sort theo orderDate desc (mới nhất trên đầu, tie-break bằng ID)
    return sortByDateDesc(matched, "orderDate", "id");
  }, [pos, filter, dateFrom, dateTo, products]);

  // v28: Pagination
  const { page, setPage, pageSize, setPageSize, paginatedItems: pagedFiltered } = usePagination(filtered, 50);

  const pendingCount = pos.filter(p => !p.approved && p.status !== "Hủy").length;

  // v27: Tính tổng theo filter — CNY chính (vì đa số PO là CNY), VND phụ
  const summary = useMemo(() => {
    let totalValueCNY = 0;
    let shippedValueCNY = 0;
    filtered.forEach(po => {
      if (po.status === "Hủy") return;
      const items = getPOItems(po);
      items.forEach(it => {
        const qty = Number(it.quantity || 0);
        const price = Number(it.unitPrice || 0);
        // Quy đổi tệ về CNY (nếu PO không phải CNY)
        const factory = factories.find(f => f.id === po.factoryId);
        const poCurrency = factory?.currency || po.currency || "CNY";
        let priceInCNY = price;
        if (poCurrency !== "CNY" && settings) {
          const rateKey = `${poCurrency.toLowerCase()}ToVnd`;
          const fromRate = settings[rateKey] || 1;
          const cnyToVnd = settings.cnyToVnd || 1;
          priceInCNY = (price * fromRate) / cnyToVnd;
        }
        totalValueCNY += qty * priceInCNY;
        // Đã ship: dùng shippedFromPO loại trừ Hủy + Nháp
        const shippedQty = po.items
          ? shipments.filter(isOperationalShipment).flatMap(sh => sh.items || []).filter(i => i.poId === po.id && i.itemId === it.id).reduce((s, i) => s + Number(i.quantity || 0), 0)
          : shipments.filter(isOperationalShipment).flatMap(sh => sh.items || []).filter(i => i.poId === po.id).reduce((s, i) => s + Number(i.quantity || 0), 0);
        shippedValueCNY += shippedQty * priceInCNY;
      });
    });
    const remainingCNY = Math.max(0, totalValueCNY - shippedValueCNY);
    const cnyToVnd = settings?.cnyToVnd || 1;
    return {
      count: filtered.length,
      totalCNY: totalValueCNY,
      totalVND: totalValueCNY * cnyToVnd,
      shippedCNY: shippedValueCNY,
      shippedVND: shippedValueCNY * cnyToVnd,
      remainingCNY,
      remainingVND: remainingCNY * cnyToVnd,
    };
  }, [filtered, shipments, factories, settings]);

  // v27: Hint badge cho summary — giải thích filter đang áp dụng
  const summaryHint = useMemo(() => {
    const parts = [];
    if (dateFrom || dateTo) {
      parts.push(`📅 ${dateFrom ? fmtDate(dateFrom) : "..."} → ${dateTo ? fmtDate(dateTo) : "..."}`);
    }
    if (filter.factory) {
      const f = factories.find(x => x.id === filter.factory);
      if (f) parts.push(`🏭 ${f.name}`);
    }
    if (filter.status) parts.push(`📌 ${filter.status}`);
    if (filter.search) parts.push(`🔍 "${filter.search}"`);
    return parts.length === 0 ? "Tất cả PO" : `Đã lọc: ${parts.join(" · ")}`;
  }, [filter, dateFrom, dateTo, factories]);

  return (
    <div>
      <SectionHeader title="Đơn đặt hàng" subtitle={`Click vào PO để xem chi tiết${pendingCount > 0 ? ` · ${pendingCount} PO chờ duyệt` : ""}`}
        action={
          <div style={{ display: "flex", gap: 8 }}>
            {/* v37: Nút xuất báo cáo PO chi tiết */}
            {canExport && (
              <button className="btn btn-ghost" onClick={() => setExportModal({
                dateFrom, dateTo, factoryFilter: filter.factory, statusFilter: filter.status,
              })}>📥 Xuất báo cáo</button>
            )}
            {canCreate && <button className="btn btn-primary" onClick={() => setModal({ type: "new" })}>+ Tạo PO mới</button>}
          </div>
        }
      />

      {/* v27: Summary bar */}
      <SummaryBar
        hint={summaryHint}
        items={[
          { icon: "📋", label: "Số PO", primary: summary.count.toLocaleString(), color: C.green600 },
          { icon: "💰", label: "Tổng giá trị", primary: `¥${(summary.totalCNY).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, secondary: `≈ ${fmtVND(summary.totalVND)}`, color: C.green700 },
          { icon: "🚚", label: "Đã ship", primary: `¥${(summary.shippedCNY).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, secondary: `≈ ${fmtVND(summary.shippedVND)}`, color: C.blue },
          { icon: "⏳", label: "Còn lại", primary: `¥${(summary.remainingCNY).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, secondary: `≈ ${fmtVND(summary.remainingVND)}`, color: C.orange },
        ]}
      />

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: "14px 18px", marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input placeholder="🔍 Tìm mã PO, SKU, tên SP..." value={filter.search} onChange={e => setFilter(p => ({ ...p, search: e.target.value }))} style={{ width: 260 }} />
        <select style={{ width: 200 }} value={filter.factory} onChange={e => setFilter(p => ({ ...p, factory: e.target.value }))}>
          <option value="">Tất cả nhà máy</option>
          {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select style={{ width: 180 }} value={filter.status} onChange={e => setFilter(p => ({ ...p, status: e.target.value }))}>
          <option value="">Tất cả trạng thái</option>
          {PO_STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
        <div style={{ flex: 1, minWidth: 300 }}>
          <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} onReset={() => { setDateFrom(""); setDateTo(""); }} />
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead><tr><th></th><th>Mã PO</th><th>Nhà máy</th><th>SP</th><th>Tổng SL</th><th>Đã giao</th><th>Còn lại</th><th>Giá trị</th><th>Ngày đặt</th><th>Trạng thái</th><th></th></tr></thead>
          <tbody>
            {pagedFiltered.map(p => {
              const f = factories.find(x => x.id === p.factoryId);
              const items = getPOItems(p);
              const totalQty = poTotalQuantity(p);
              const totalShipped = shippedFromPO(p.id, shipments);
              const totalValue = poTotalValue(p);
              const totalRemain = Math.max(0, totalQty - totalShipped);
              const isExpanded = expanded === p.id;
              const poShipments = shipments.filter(s => (s.items || []).some(i => i.poId === p.id));
              return (
                <Fragment key={p.id}>
                  <tr className={isExpanded ? "expanded" : ""} onClick={() => setExpanded(isExpanded ? null : p.id)} style={{ cursor: "pointer" }}>
                    <td style={{ width: 30 }}>
                      <span style={{ color: C.green500, fontSize: 12, fontWeight: 700 }}>{isExpanded ? "▼" : "▶"}</span>
                    </td>
                    <td style={{ fontWeight: 700, color: C.green600 }}>
                      {p.id}
                      {!p.approved && p.status !== "Hủy" && <div style={{ fontSize: 9, color: C.orange, fontWeight: 700, marginTop: 2 }}>⏳ CHỜ DUYỆT</div>}
                      {p.approved && <div style={{ fontSize: 9, color: C.green500, fontWeight: 600, marginTop: 2 }}>🔒 Đã duyệt</div>}
                      {p.status === "Hủy" && <div style={{ fontSize: 9, color: C.red, fontWeight: 700, marginTop: 2 }}>🚫 ĐÃ HỦY</div>}
                    </td>
                    <td style={{ fontSize: 12 }}>{f?.name}</td>
                    <td>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 8px", background: C.green50, borderRadius: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.green700 }}>{items.length}</span>
                        <span style={{ fontSize: 10, color: C.textMuted }}>SP</span>
                      </div>
                      {items.length > 0 && items[0] && (
                        <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>
                          {items.slice(0, 2).map(it => products.find(x => x.id === it.productId)?.sku).filter(Boolean).join(", ")}
                          {items.length > 2 && ` +${items.length - 2}`}
                        </div>
                      )}
                    </td>
                    <td style={{ fontWeight: 600 }}>{totalQty.toLocaleString()}</td>
                    <td>
                      <div style={{ color: C.blue, fontWeight: 600 }}>{totalShipped.toLocaleString()}</div>
                      <div style={{ width: 50 }}><ProgressBar value={totalShipped} max={totalQty} /></div>
                    </td>
                    <td style={{ color: totalRemain > 0 ? C.orange : C.green600, fontWeight: 600 }}>{totalRemain.toLocaleString()}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{fmt(totalValue, p.currency)}</div>
                      <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(toVND(totalValue, p.currency, settings), "VND")}</div>
                    </td>
                    <td style={{ fontSize: 12 }}>{fmtDate(p.orderDate)}</td>
                    <td><Badge label={p.status} color={poStatusColor(p.status)} /></td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {!p.approved && p.status !== "Hủy" && canApprove && (
                          <button className="btn btn-primary" style={{ padding: "5px 12px", fontSize: 11, background: C.green500 }} onClick={() => handleApprove(p)}>✓ Duyệt</button>
                        )}
                        {/* v20: User thường sửa được khi chưa duyệt + chưa hủy. Admin sửa được mọi trạng thái */}
                        {((!p.approved && p.status !== "Hủy" && canEdit) || isAdmin) && p.status !== "Hủy" && <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: p })}>Sửa</button>}
                        {/* v20: Admin sửa được cả PO đã hủy */}
                        {isAdmin && p.status === "Hủy" && <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: p })}>Sửa</button>}
                        {/* v20: Hủy ở MỌI trạng thái (trừ đã hủy) */}
                        {p.status !== "Hủy" && canDelete && <button className="btn btn-danger" style={{ padding: "5px 12px", fontSize: 11 }} onClick={() => handleReject(p)}>🚫 Hủy</button>}
                        {/* v38d: Xóa cứng PO — chỉ admin, chỉ PO đã Hủy */}
                        {isAdmin && p.status === "Hủy" && (
                          <button
                            className="btn btn-ghost"
                            style={{ padding: "5px 10px", fontSize: 11, color: C.red }}
                            title="Xóa cứng PO này (vĩnh viễn)"
                            onClick={() => {
                              const check = canHardDeletePO(p.id, data);
                              setHardDeleteDlg({
                                id: p.id,
                                title: `Xóa cứng PO: ${p.id}`,
                                subtitle: `NCC: ${f?.name || "—"} · Ngày đặt: ${fmtDate(p.orderDate)}`,
                                objectSummary: `${p.id} · ${getPOItems(p).length} SP · Trạng thái: Hủy`,
                                canDelete: check.allowed,
                                reasons: check.reasons,
                              });
                            }}
                          >🗑️ Xóa cứng</button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={11} style={{ background: C.green50, padding: 24 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 20 }}>
                          <div>
                            <GreenPill>Thông tin PO</GreenPill>
                            <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 8, fontSize: 13 }}>
                              <div style={{ color: C.textMuted }}>Mã PO:</div><div style={{ fontWeight: 600 }}>{p.id}</div>
                              <div style={{ color: C.textMuted }}>Nhà máy:</div><div>{f?.name} ({f?.nameCn})</div>
                              <div style={{ color: C.textMuted }}>Liên hệ:</div><div>{f?.contactPerson || "-"} · {f?.phone || "-"}</div>
                              <div style={{ color: C.textMuted }}>Ngày đặt:</div><div>{fmtDate(p.orderDate)}</div>
                              <div style={{ color: C.textMuted }}>Hạn HT:</div><div>{fmtDate(p.expectedDate)}</div>
                              {p.approved && <>
                                <div style={{ color: C.textMuted }}>Duyệt bởi:</div><div style={{ color: C.green600, fontWeight: 600 }}>{p.approvedBy} · {fmtDate(p.approvedAt)}</div>
                              </>}
                              {p.status === "Hủy" && <>
                                <div style={{ color: C.textMuted }}>Hủy bởi:</div><div style={{ color: C.red, fontWeight: 600 }}>{p.cancelledBy || "-"} · {fmtDate(p.cancelledAt)}</div>
                                <div style={{ color: C.textMuted }}>Lý do:</div><div style={{ color: C.red }}>{p.cancelReason || "-"}</div>
                              </>}
                              <div style={{ color: C.textMuted }}>Ghi chú:</div><div>{p.note || "-"}</div>
                            </div>
                          </div>
                          <div>
                            <GreenPill>Tổng quan</GreenPill>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                              <div style={{ background: C.white, padding: 12, borderRadius: 10, border: `1px solid ${C.border}` }}>
                                <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>Số dòng SP</div>
                                <div style={{ fontWeight: 700, fontSize: 16 }}>{items.length}</div>
                              </div>
                              <div style={{ background: C.white, padding: 12, borderRadius: 10, border: `1px solid ${C.border}` }}>
                                <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>Tổng giá trị</div>
                                <div style={{ fontWeight: 700, color: C.green600, fontSize: 16 }}>{fmt(totalValue, p.currency)}</div>
                                <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(toVND(totalValue, p.currency, settings), "VND")}</div>
                              </div>
                              <div style={{ background: C.white, padding: 12, borderRadius: 10, border: `1px solid ${C.border}` }}>
                                <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>Tiến độ giao</div>
                                <div style={{ fontWeight: 700, color: C.blue }}>{totalShipped.toLocaleString()} / {totalQty.toLocaleString()}</div>
                                <div style={{ width: "100%", marginTop: 4 }}><ProgressBar value={totalShipped} max={totalQty} /></div>
                              </div>
                              <div style={{ background: C.white, padding: 12, borderRadius: 10, border: `1px solid ${C.border}` }}>
                                <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>Còn lại chưa giao</div>
                                <div style={{ fontWeight: 700, color: totalRemain > 0 ? C.orange : C.green600 }}>{totalRemain.toLocaleString()}</div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Per-item detail table */}
                        {/* v38k: Thứ tự mới SKU → SP → SL đặt → Đã giao → Dự kiến xuất → Còn lại → Đơn giá → Giá trị */}
                        <GreenPill>Chi tiết từng sản phẩm ({items.length})</GreenPill>
                        <table>
                          <thead><tr>
                            <th>SKU</th>
                            <th>Sản phẩm</th>
                            <th>SL đặt</th>
                            <th>Đã giao</th>
                            <th title="Phiếu Nháp đang giữ chỗ — chưa phát sinh công nợ. Bấm để xem chi tiết." style={{ cursor: "help" }}>Dự kiến xuất ⓘ</th>
                            <th>Còn lại</th>
                            <th>Đơn giá</th>
                            <th>Giá trị</th>
                          </tr></thead>
                          <tbody>
                            {items.map(it => {
                              const prod = products.find(x => x.id === it.productId);
                              const itemShipped = p.items ? shippedFromItem(p.id, it.id, shipments) : shippedFromPO(p.id, shipments);
                              // v38k: SL giữ chỗ ở phiếu Nháp
                              const itemReserved = p.items ? reservedFromDraftItem(p.id, it.id, shipments) : reservedFromDraftPO(p.id, shipments);
                              // v38k: Còn lại thực = SL đặt - Đã giao - Dự kiến xuất
                              const itemRemain = Math.max(0, Number(it.quantity) - itemShipped - itemReserved);
                              const itemValue = Number(it.quantity) * Number(it.unitPrice);
                              // v38k: List phiếu Nháp giữ chỗ — cho tooltip
                              const draftHolders = p.items ? draftShipmentsHoldingItem(p.id, it.id, shipments) : [];
                              const draftTooltip = draftHolders.length > 0
                                ? draftHolders.map(d => `${d.shipmentId}: ${d.qty}`).join("\n")
                                : "Chưa có phiếu Nháp giữ chỗ";
                              return (
                                <tr key={it.id}>
                                  <td style={{ fontWeight: 700, color: C.green600, fontSize: 12 }}>{prod?.sku || "-"}</td>
                                  <td style={{ fontSize: 12 }}>{prod?.name || "-"}</td>
                                  <td style={{ fontWeight: 600 }}>{Number(it.quantity).toLocaleString()}</td>
                                  <td>
                                    <div style={{ color: C.blue, fontWeight: 600 }}>{itemShipped.toLocaleString()}</div>
                                    <div style={{ width: 50 }}><ProgressBar value={itemShipped} max={it.quantity} /></div>
                                  </td>
                                  <td title={draftTooltip} style={{ cursor: itemReserved > 0 ? "help" : "default" }}>
                                    {itemReserved > 0 ? (
                                      <span style={{ color: C.purple, fontWeight: 700, background: C.purpleBg, padding: "2px 8px", borderRadius: 6, fontSize: 12 }}>
                                        📋 {itemReserved.toLocaleString()}
                                      </span>
                                    ) : <span style={{ color: C.textLight, fontSize: 12 }}>—</span>}
                                  </td>
                                  <td style={{ color: itemRemain > 0 ? C.orange : C.green600, fontWeight: 600 }}>{itemRemain.toLocaleString()}</td>
                                  <td style={{ fontWeight: 600, fontSize: 12 }}>{fmt(it.unitPrice, p.currency)}</td>
                                  <td style={{ fontWeight: 600, color: C.green700 }}>{fmt(itemValue, p.currency)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>

                        {poShipments.length > 0 && (
                          <div style={{ marginTop: 20 }}>
                            <GreenPill>Lịch sử giao hàng ({poShipments.length})</GreenPill>
                            <table>
                              <thead><tr><th>Mã đơn</th><th>Thị trường</th><th>Ngày xuất</th><th>Sản phẩm</th><th>SL</th><th>Trạng thái</th><th>Tracking</th></tr></thead>
                              <tbody>
                                {poShipments.flatMap(s =>
                                  (s.items || []).filter(i => i.poId === p.id).map((sItem, idx) => {
                                    const poItem = items.find(it => it.id === sItem.itemId);
                                    const prod = products.find(x => x.id === poItem?.productId);
                                    return (
                                      <tr key={`${s.id}-${idx}`}>
                                        <td style={{ color: C.green600, fontWeight: 600 }}>{s.id}</td>
                                        <td><Badge label={s.market} color={C.blue} /></td>
                                        <td style={{ fontSize: 12 }}>{fmtDate(s.departDate)}</td>
                                        <td style={{ fontSize: 12 }}>{prod?.sku || "-"}</td>
                                        <td style={{ fontWeight: 600 }}>{Number(sItem.quantity).toLocaleString()}</td>
                                        <td><Badge label={s.status} color={shipmentStatusColor(s.status)} /></td>
                                        <td style={{ fontSize: 11, fontFamily: "monospace" }}>{s.trackingNo || "-"}</td>
                                      </tr>
                                    );
                                  })
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      {modal?.type === "new" && <POForm prefilled={modal.prefilled || null} factories={factories} products={products} shipments={shipments} data={data} user={user} onSave={f => {
        const customId = (f.id || "").trim();
        const autoId = `PO-${new Date().getFullYear()}-${uid()}`;
        const finalId = customId || autoId;
        if (customId && pos.some(p => p.id === customId)) {
          setConfirmDlg({ title: "Trùng mã PO", message: `Mã PO "${customId}" đã tồn tại. Vui lòng đặt mã khác hoặc để trống.`, confirmLabel: "OK", cancelLabel: null, onConfirm: () => {} });
          return;
        }
        const { id: _, ...rest } = f;
        onAdd("pos", { id: finalId, ...rest, approved: false, status: "Chờ duyệt" });
        setModal(null);
      }} onClose={() => setModal(null)} />}
      {modal?.type === "edit" && <POForm
        initial={modal.data}
        factories={factories}
        products={products}
        shipments={shipments}
        data={data}
        user={user}
        onRenameId={onRenameId}
        onSave={f => {
          // v38f: Rename xảy ra TRONG POForm (qua RenameIdDialog) — onSave chỉ nhận
          // các thay đổi non-id. ID thật sự đã được rename trước đó.
          const { id: _, ...rest } = f;
          // Lấy current ID từ initial (nếu rename thì đã update vào data trước, dùng id từ form là id mới)
          onEdit("pos", f.id || modal.data.id, rest);
          setModal(null);
        }}
        onClose={() => setModal(null)}
      />}
      {/* v13: Modal "produce" đã bỏ — không còn cần nhập tiến độ sản xuất */}

      {/* v37: Modal xuất báo cáo PO chi tiết */}
      {exportModal && (
        <Modal
          title="📥 Xuất báo cáo PO chi tiết"
          subtitle="File Excel (.xlsx) — Mỗi SP trong PO = 1 dòng · 1 PO có thể có nhiều dòng"
          onClose={() => !exporting && setExportModal(null)}
          onSave={() => handleExportPOReport(exportModal)}
          saveLabel={exporting ? "⏳ Đang xuất..." : "📥 Tải xuống"}
          saveDisabled={exporting}
          width={620}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="form-group">
              <label>Từ ngày (theo Ngày tạo PO)</label>
              <input type="date" value={exportModal.dateFrom || ""}
                onChange={e => setExportModal(p => ({ ...p, dateFrom: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Đến ngày</label>
              <input type="date" value={exportModal.dateTo || ""}
                onChange={e => setExportModal(p => ({ ...p, dateTo: e.target.value }))} />
            </div>
            <div className="form-group" style={{ gridColumn: "1/-1" }}>
              <label>Lọc theo NCC (để trống = tất cả)</label>
              <select value={exportModal.factoryFilter || ""}
                onChange={e => setExportModal(p => ({ ...p, factoryFilter: e.target.value }))}>
                <option value="">— Tất cả NCC —</option>
                {factories.map(f => <option key={f.id} value={f.id}>{f.supplierCode ? `[${f.supplierCode}] ` : ""}{f.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ gridColumn: "1/-1" }}>
              <label>Lọc theo trạng thái (để trống = tất cả)</label>
              <select value={exportModal.statusFilter || ""}
                onChange={e => setExportModal(p => ({ ...p, statusFilter: e.target.value }))}>
                <option value="">— Tất cả trạng thái —</option>
                {PO_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="alert alert-info" style={{ marginTop: 14 }}>
            💡 <b>File Excel sẽ có 2 sheet:</b><br/>
            <b>1️⃣ Chi tiết PO</b> — 20 cột, mỗi SP trong PO = 1 dòng:
            Mã PO · Ngày tạo · Ngày duyệt · Người duyệt · Trạng thái · Mã/Tên NCC · SKU · Tên SP ·
            SL đặt · Đơn giá · Tiền tệ · Thành tiền · Ngày dự kiến · SL đã giao · SL còn lại ·
            Đã giao về thị trường · Đã giao về kho · Số lô · Trạng thái lô<br/>
            <b>2️⃣ Tổng hợp</b> — mỗi PO 1 dòng, tổng giá trị + tỷ lệ hoàn thành<br/>
            <span style={{ color: C.textMuted }}>SL đã giao đã loại trừ Hủy + Nháp. Để trống ngày để xuất tất cả.</span>
          </div>
        </Modal>
      )}

      {/* v11.2: Prompt dialog cho hủy PO */}
      {promptDlg && <PromptDialog {...promptDlg} onClose={() => setPromptDlg(null)} />}
      {/* v36: Thay alert() cho mã PO trùng */}
      {confirmDlg && <ConfirmDialog {...confirmDlg} onClose={() => setConfirmDlg(null)} />}
      {/* v38d: Hard delete dialog */}
      {hardDeleteDlg && (
        <HardDeleteDialog
          {...hardDeleteDlg}
          onConfirm={() => onHardDelete && onHardDelete("pos", hardDeleteDlg.id)}
          onClose={() => setHardDeleteDlg(null)}
        />
      )}
    </div>
  );
};

// ============================================================
// SHIPMENTS v10 — 7 trạng thái (thêm Hủy), kho 2 cấp, số kiện, về kho workflow
// ============================================================
const ShipmentForm = ({ initial, prefilled, pos, shipments: allShipments, factories, products, markets, carriers, settings, onSave, onCreateWarehouse, onClose, data, feePayments = [], stockMovements = [] }) => {
  const marketNames = getMarketNames(markets);
  const defaultMarket = (initial?.market) || (prefilled?.market) || marketNames[0] || "Vietnam";
  // v12: Init warehouseId — nếu initial.warehouseId không còn thuộc market → dùng kho mặc định
  const _whsOfDefault = getMarketWarehouses(defaultMarket, markets);
  const _initWhValid = initial?.warehouseId && _whsOfDefault.some(w => w.id === initial.warehouseId);
  const defaultWhId = _initWhValid ? initial.warehouseId : (prefilled?.warehouseId || getDefaultWarehouseId(defaultMarket, markets));
  const [form, setForm] = useState(initial ? { ...initial, warehouseId: defaultWhId, documents: initial.documents || [] } : (prefilled ? {
    // v38j: Prefill từ tab Tồn kho — vẫn là form NEW
    id: "",
    market: defaultMarket,
    warehouseId: defaultWhId,
    departDate: new Date().toISOString().slice(0, 10), arriveDate: "",
    carrier: "", carrierId: "", trackingNo: "", checkingCode: "",
    status: "Nháp",
    packages: "",
    note: prefilled.note || "",
    items: prefilled.items || [],
    fees: [],
    documents: [],
  } : {
    id: "",
    market: defaultMarket,
    warehouseId: defaultWhId,
    departDate: new Date().toISOString().slice(0, 10), arriveDate: "",
    carrier: "", carrierId: "", trackingNo: "", checkingCode: "",
    status: "Nháp", // v26: Mặc định Nháp khi tạo mới
    packages: "", // v10: số kiện
    note: "", items: [], fees: [],
    documents: [], // v19: chứng từ — [{ id, type, url, uploadedBy, uploadedAt, note }]
  }));
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // v38f: Hỗ trợ đổi mã Shipment (chỉ khi entity sạch)
  const isEdit = !!initial;
  // Build effective data nếu không pass đầy đủ
  const effectiveData = data || { shipments: allShipments || [], feePayments: feePayments || [], stockMovements: stockMovements || [] };
  const renameCheck = isEdit ? canRenameShipment(initial.id, effectiveData) : { allowed: true, reasons: [] };
  const canRename = isEdit && renameCheck.allowed;
  const idChanged = isEdit && form.id !== initial.id;
  const [renameDlg, setRenameDlg] = useState(null);

  // v12: Auto-set kho MẶC ĐỊNH khi đổi thị trường HOẶC khi markets update (ví dụ sau khi tạo kho nhanh)
  // Không còn setTimeout hack — useEffect tự phản ứng ngay khi markets prop thay đổi
  useEffect(() => {
    if (!form.market) return;
    const whs = getMarketWarehouses(form.market, markets);
    if (whs.length > 0) {
      // Nếu warehouseId hiện tại không thuộc market → chọn kho mặc định
      if (!form.warehouseId || !whs.some(w => w.id === form.warehouseId)) {
        setForm(p => ({ ...p, warehouseId: getDefaultWarehouseId(form.market, markets) }));
      }
    } else {
      if (form.warehouseId) setForm(p => ({ ...p, warehouseId: "" }));
    }
  }, [form.market, markets]); // eslint-disable-line

  const currentWarehouses = getMarketWarehouses(form.market, markets);

  // Build available line items from all approved & non-cancelled POs
  // v13: Available = SL đặt - SL đã ship (KHÔNG còn giới hạn theo SL đã sản xuất).
  //      Nhân viên ship tự do trong giới hạn SL đặt; nếu NCC giao thiếu thực tế,
  //      kế toán xử lý ở bước "Xác nhận về kho" (Hao hụt / Giao sau / Cảnh báo).
  const availableLines = useMemo(() => {
    const result = [];
    pos.forEach(po => {
      if (!po.approved || po.status === "Hủy") return;
      const poItems = getPOItems(po);
      poItems.forEach(it => {
        // v38k: SỬA BUG — Phiếu Nháp PHẢI giữ chỗ hàng để tránh tạo phiếu trùng.
        // V38j cũ: dùng isOperationalShipment loại cả Hủy + Nháp → phiếu Nháp A không giữ chỗ
        //   → tạo phiếu Nháp B vẫn thấy hàng available → có thể giữ chỗ trùng.
        // V38k mới: chỉ loại "Hủy". "Nháp" được tính vào alreadyShipped để giữ chỗ.
        const alreadyShipped = allShipments.filter(s => s.id !== initial?.id && s.status !== "Hủy")
          .flatMap(s => s.items || [])
          .filter(i => i.poId === po.id && (po.items ? i.itemId === it.id : true))
          .reduce((sum, i) => sum + Number(i.quantity || 0), 0);
        const currentItem = (initial?.items || []).find(i => i.poId === po.id && i.itemId === it.id);
        const currentQty = currentItem ? Number(currentItem.quantity) : 0;
        // v13: Đổi từ produced → quantity. Nhân viên ship được tối đa = SL đặt - SL đã ship ở các lô khác.
        const available = Number(it.quantity || 0) - alreadyShipped;
        if (available + currentQty > 0) {
          result.push({
            poId: po.id,
            itemId: it.id,
            productId: it.productId,
            unitPrice: it.unitPrice,
            currency: po.currency,
            factoryId: po.factoryId,
            available: available + currentQty,
            label: `${po.id} — ${products.find(p => p.id === it.productId)?.sku || "?"} (${products.find(p => p.id === it.productId)?.name || ""})`,
          });
        }
      });
    });
    return result;
  }, [pos, allShipments, initial, products]);

  const addItem = () => {
    // v38g: KHÔNG auto-fill dòng PO đầu tiên — user phải tự chọn qua Combobox.
    set("items", [...form.items, { poId: "", itemId: "", quantity: 0 }]);
  };
  const removeItem = (idx) => set("items", form.items.filter((_, i) => i !== idx));
  const updateItem = (idx, field, val) => {
    if (field === "lineKey") {
      const [poId, itemId] = val.split("|");
      set("items", form.items.map((it, i) => i === idx ? { ...it, poId, itemId } : it));
    } else {
      set("items", form.items.map((it, i) => i === idx ? { ...it, [field]: val } : it));
    }
  };
  const addFee = () => set("fees", [...form.fees, { id: `fee${uid()}`, type: FEE_TYPES[0], amount: 0, currency: "VND", payee: "", note: "" }]);
  const removeFee = (idx) => set("fees", form.fees.filter((_, i) => i !== idx));
  const updateFee = (idx, field, val) => set("fees", form.fees.map((f, i) => i === idx ? { ...f, [field]: val } : f));

  const errors = [];
  form.items.forEach((it, idx) => {
    const line = availableLines.find(l => l.poId === it.poId && l.itemId === it.itemId);
    if (!line) { errors.push(`Dòng ${idx + 1}: PO/SP không hợp lệ (chưa duyệt, đã hủy hoặc đã ship hết)`); return; }
    if (Number(it.quantity) <= 0) errors.push(`Dòng ${idx + 1}: Số lượng phải > 0`);
    if (Number(it.quantity) > line.available) errors.push(`Dòng ${idx + 1}: Vượt tồn (${line.available})`);
  });
  if (form.items.length === 0) errors.push("Phải chọn ít nhất 1 dòng sản phẩm");
  // v11: Nếu market không có kho → báo lỗi rõ ràng; nếu có kho mà chưa chọn → báo lỗi
  const whsOfMarket = getMarketWarehouses(form.market, markets);
  if (whsOfMarket.length === 0) {
    errors.push(`Thị trường "${form.market}" chưa có kho. Vào tab Thị trường & Kho để thêm kho.`);
  } else if (!form.warehouseId) {
    errors.push("Phải chọn kho nhận hàng");
  } else if (!whsOfMarket.some(w => w.id === form.warehouseId)) {
    // warehouseId hiện tại không thuộc market → trạng thái trung gian, sẽ được useEffect tự sửa
    // Không thêm lỗi vào để user không bị rối
  }

  // Nếu đang edit và status đã forward qua "Chờ xuất" thì khoá form status (trừ khi Hủy lúc Chờ xuất)
  // v26: Nháp + Chờ xuất đều cho sửa thoải mái
  const statusLocked = initial && initial.status !== "Chờ xuất" && initial.status !== "Nháp";

  // v38f: Wrapper save — nếu sửa và ID đã đổi → mở RenameDialog confirm
  const handleSave = (overrides = {}) => {
    const finalForm = { ...form, ...overrides };
    if (isEdit && idChanged) {
      const newId = String(finalForm.id || "").trim();
      if (!newId) return;
      // Check trùng ID
      const dup = (allShipments || []).some(s => s.id === newId && s.id !== initial.id);
      setRenameDlg({
        oldId: initial.id, newId, duplicateExists: dup, finalForm,
      });
      return;
    }
    onSave(finalForm);
  };

  return (
    <Modal
      title={initial ? "Sửa đơn giao hàng" : "Tạo đơn giao hàng (Nháp)"}
      subtitle={!initial ? "📝 Lô mới sẽ là Nháp — không ảnh hưởng công nợ. Bấm 'Lưu & Đẩy chờ xuất' để chuyển ngay sang chính thức." : null}
      onClose={onClose}
      onSave={() => handleSave()}
      saveDisabled={errors.length > 0}
      saveLabel={form.status === "Nháp" ? "📝 Lưu nháp" : "Lưu"}
      extraButton={form.status === "Nháp" && (
        <button
          className="btn btn-primary"
          disabled={errors.length > 0}
          onClick={() => handleSave({ status: "Chờ xuất" })}
          style={{ background: C.green600, marginRight: 6 }}
          title="Chuyển lô này từ Nháp sang Chờ xuất — sẽ tính vào công nợ"
        >
          ✅ Lưu & Đẩy chờ xuất
        </button>
      )}
      width={900}>
      <div className="form-grid">
        <div className="form-group" style={{ gridColumn: "1/-1" }}>
          <label>Mã đơn giao hàng {initial ? (canRename ? "(có thể đổi — cần xác nhận)" : "🔒") : "(tùy chọn)"}</label>
          {/* v38f: Cho sửa nếu canRename */}
          <input
            value={form.id}
            onChange={e => set("id", e.target.value)}
            disabled={initial && !canRename}
            placeholder={initial ? "" : "Để trống để tự sinh mã GC-yyyymmdd-xxxx"}
            style={initial && idChanged ? { borderColor: C.orange, background: "#FEF7E0" } : {}}
          />
          {!initial && <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>Nếu trống, hệ thống tự tạo mã dạng GC + ngày tháng năm + 4 ký tự ngẫu nhiên</div>}
          {/* v38f: Status messages khi đang sửa */}
          {initial && !canRename && (
            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4, lineHeight: 1.5 }}>
              🔒 Không thể đổi mã đơn này: {renameCheck.reasons.join(" · ")}
            </div>
          )}
          {initial && canRename && !idChanged && (
            <div style={{ fontSize: 10, color: C.green600, marginTop: 4 }}>
              ✓ Đơn giao hàng này có thể đổi mã. Sửa giá trị + bấm Lưu sẽ yêu cầu xác nhận.
            </div>
          )}
          {initial && canRename && idChanged && (
            <div style={{ fontSize: 10, color: C.orange, marginTop: 4, fontWeight: 600 }}>
              ⚠ Mã đã đổi từ "{initial.id}" → "{form.id}". Sẽ yêu cầu gõ mã mới để xác nhận khi Lưu.
            </div>
          )}
        </div>

        <div className="form-group"><label>🌍 Thị trường đích *</label>
          <select value={form.market} onChange={e => set("market", e.target.value)}>
            {marketNames.map(m => <option key={m} value={m}>{getFlag(m)} {m}</option>)}
          </select>
        </div>
        <div className="form-group"><label>🏪 Kho nhận *</label>
          <select value={form.warehouseId} onChange={e => set("warehouseId", e.target.value)} disabled={currentWarehouses.length === 0}>
            {currentWarehouses.length === 0 ? <option value="">— Chưa có kho —</option> : null}
            {currentWarehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          {currentWarehouses.length === 0 && (
            <div style={{ fontSize: 11, color: C.red, marginTop: 6, padding: 8, background: C.redBg, borderRadius: 6 }}>
              ⚠️ Thị trường "<b>{form.market}</b>" chưa có kho nào.
              {onCreateWarehouse && (
                <button type="button" className="btn btn-primary" style={{ marginTop: 6, padding: "4px 12px", fontSize: 11 }}
                  onClick={() => {
                    const whName = `Kho ${form.market}`;
                    // v12: Kho đầu tiên → tự động là default
                    const newWh = { id: `wh_${uid()}`, name: whName, address: "", note: "Tự động tạo từ ShipmentForm", isDefault: true };
                    onCreateWarehouse(form.market, newWh);
                    // v12: KHÔNG còn setTimeout — useEffect phụ thuộc `markets` sẽ tự set warehouseId
                    // khi prop markets được cập nhật từ parent (sau khi save vào storage)
                  }}>
                  ⚡ Tạo ngay kho "Kho {form.market}"
                </button>
              )}
            </div>
          )}
          {currentWarehouses.length > 0 && (
            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>
              {currentWarehouses.length} kho khả dụng · Đã chọn: <b>{currentWarehouses.find(w => w.id === form.warehouseId)?.name || "—"}</b>
              {currentWarehouses.find(w => w.id === form.warehouseId)?.isDefault && <span style={{ marginLeft: 4, color: C.gold }}>⭐ mặc định</span>}
            </div>
          )}
        </div>

        <div className="form-group"><label>Ngày xuất</label>
          <input type="date" value={form.departDate} onChange={e => set("departDate", e.target.value)} />
        </div>
        <div className="form-group"><label>Ngày dự kiến nhận</label>
          <input type="date" value={form.arriveDate} onChange={e => set("arriveDate", e.target.value)} />
        </div>

        <div className="form-group"><label>Đơn vị vận chuyển</label>
          <select value={form.carrierId || ""} onChange={e => {
            const v = e.target.value;
            const c = (carriers || []).find(x => x.id === v);
            setForm(p => ({ ...p, carrierId: v, carrier: c ? c.name : p.carrier }));
          }}>
            <option value="">— Chưa chọn —</option>
            {(carriers || []).filter(c => c.status !== "stopped").map(c => (
              <option key={c.id} value={c.id}>{c.code ? `[${c.code}] ` : ""}{c.name}</option>
            ))}
          </select>
          {(!carriers || carriers.length === 0) && <div style={{ fontSize: 10, color: C.red, marginTop: 3 }}>Chưa có đơn vị VC. Vào tab "Đơn vị VC" để thêm.</div>}
        </div>
        <div className="form-group"><label>Số lượng kiện</label>
          <NumberInput min={0} value={form.packages} onChange={e => set("packages", e.target.value)} placeholder="VD: 50" />
        </div>

        <div className="form-group"><label>Mã tracking</label>
          <input value={form.trackingNo} onChange={e => set("trackingNo", e.target.value)} placeholder="VD: DHL1234567890" />
        </div>
        <div className="form-group"><label>Mã checking (nội bộ)</label>
          <input value={form.checkingCode} onChange={e => set("checkingCode", e.target.value)} placeholder="Mã kiểm tra nội bộ (nếu có)" />
        </div>

        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Trạng thái</label>
          <select value={form.status} onChange={e => set("status", e.target.value)} disabled={statusLocked}>
            {SHIPMENT_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
          {statusLocked && <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>💡 Để đổi trạng thái, dùng dropdown ở danh sách. Không thể quay lui.</div>}
        </div>
      </div>

      {/* PO Items */}
      <div style={{ padding: 16, background: C.green50, borderRadius: 12, border: `1px solid ${C.green200}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.green700 }}>📦 Hàng từ PO (đã duyệt)</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{availableLines.length} dòng SP có hàng sẵn để ship</div>
          </div>
          <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={addItem} disabled={availableLines.length === 0}>+ Thêm dòng</button>
        </div>
        {availableLines.length === 0 && <div className="alert alert-warn">Chưa có PO nào có hàng sẵn (cần duyệt PO + cập nhật SX).</div>}
        {form.items.map((it, idx) => {
          const line = availableLines.find(l => l.poId === it.poId && l.itemId === it.itemId);
          const f = factories.find(x => x.id === line?.factoryId);
          const prod = products.find(x => x.id === line?.productId);
          // v38e: Tạo key duy nhất cho từng dòng PO ("poId|itemId")
          const currentKey = line ? `${it.poId}|${it.itemId}` : "";
          // Loại trừ các dòng đã chọn ở items khác (giữ dòng hiện tại)
          const excludeKeys = form.items
            .filter((other, i) => i !== idx && other.poId && other.itemId)
            .map(other => `${other.poId}|${other.itemId}`);
          // Helper render mỗi item trong dropdown — 2 dòng: PO + SP / tồn + NCC + giá
          const renderLine = (lineItem, isHighlighted, query) => {
            const lProd = products.find(x => x.id === lineItem.productId);
            const lF = factories.find(x => x.id === lineItem.factoryId);
            const sku = lProd?.sku || "?";
            const name = lProd?.name || "";
            const highlightMatch = (text, q) => {
              if (!q) return text;
              const lower = String(text).toLowerCase();
              const ql = q.toLowerCase();
              const i = lower.indexOf(ql);
              if (i < 0) return text;
              return (
                <>
                  {text.slice(0, i)}
                  <b style={{ background: "#FEF08A", color: C.text }}>{text.slice(i, i + q.length)}</b>
                  {text.slice(i + q.length)}
                </>
              );
            };
            return (
              <div style={{
                padding: "10px 12px",
                background: isHighlighted ? C.green50 : "transparent",
                cursor: "pointer", fontSize: 13,
                borderBottom: `1px solid ${C.borderLight}`,
              }}>
                <div style={{ fontWeight: 600 }}>
                  {highlightMatch(lineItem.poId, query)} — {highlightMatch(sku, query)} ({highlightMatch(name, query)})
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>
                  Tồn: <b style={{ color: C.green600 }}>{lineItem.available}</b> · {lF?.name || "—"} · {fmt(lineItem.unitPrice, lineItem.currency)}/cái
                </div>
              </div>
            );
          };
          return (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 120px 40px", gap: 8, marginBottom: 8, padding: 10, background: C.white, borderRadius: 10 }}>
              {/* v38e: Combobox tìm dòng PO theo PO ID + SKU + tên */}
              <Combobox
                items={availableLines}
                value={currentKey}
                onChange={(key) => updateItem(idx, "lineKey", key || "")}
                getKey={l => `${l.poId}|${l.itemId}`}
                getLabel={l => {
                  const lProd = products.find(x => x.id === l.productId);
                  return `${l.poId} — ${lProd?.sku || "?"} (${lProd?.name || ""}) · tồn: ${l.available}`;
                }}
                getSearchText={l => {
                  const lProd = products.find(x => x.id === l.productId);
                  return `${l.poId} ${lProd?.sku || ""} ${lProd?.name || ""} ${lProd?.nameImport || ""}`;
                }}
                renderItem={renderLine}
                placeholder="🔍 Tìm theo Mã PO / SKU / tên SP..."
                excludeKeys={excludeKeys}
                emptyText="Chưa có PO nào có hàng sẵn (cần duyệt PO + cập nhật SX)"
              />
              <NumberInput value={it.quantity} onChange={e => updateItem(idx, "quantity", e.target.value)} placeholder="SL" min={0} max={line?.available || 0} errorIfOver={!!line} showSetMaxButton={!!line} />
              <button className="btn btn-danger" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => removeItem(idx)}>✕</button>
              {line && prod && <div style={{ gridColumn: "1/-1", fontSize: 11, color: C.textMuted }}>
                {f?.name} · {prod.sku} · {fmt(line.unitPrice, line.currency)}/cái → {fmt(Number(it.quantity) * Number(line.unitPrice), line.currency)}
              </div>}
            </div>
          );
        })}
      </div>

      {/* Fees */}
      <div style={{ padding: 16, background: C.orangeBg, borderRadius: 12, border: `1px solid ${C.orange}30` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.orange }}>💵 Thuế phí nhập khẩu</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>KHÔNG tính vào công nợ NCC · Phí vận chuyển nên gán Đơn vị VC để theo dõi công nợ</div>
          </div>
          <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={addFee}>+ Thêm khoản</button>
        </div>
        {form.fees.length === 0 && <div style={{ fontSize: 12, color: C.textMuted, padding: 10, textAlign: "center" }}>Chưa có khoản phí nào</div>}
        {form.fees.map((fee, idx) => (
          <div key={idx} style={{ padding: 10, background: C.white, borderRadius: 10, marginBottom: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "160px 110px 70px 1fr 40px", gap: 6, marginBottom: 6 }}>
              <select value={fee.type} onChange={e => updateFee(idx, "type", e.target.value)}>
                {FEE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
              <NumberInput min={0} value={fee.amount} onChange={e => updateFee(idx, "amount", e.target.value)} placeholder="Số tiền" step="0.01" />
              <select value={fee.currency} onChange={e => updateFee(idx, "currency", e.target.value)}>
                {["VND", "USD", "THB", "MYR", "PHP"].map(c => <option key={c}>{c}</option>)}
              </select>
              <input value={fee.note} onChange={e => updateFee(idx, "note", e.target.value)} placeholder="Ghi chú" />
              <button className="btn btn-danger" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => removeFee(idx)}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <select value={fee.carrierId || ""} onChange={e => {
                const v = e.target.value;
                const c = (carriers || []).find(x => x.id === v);
                // Auto điền payee theo tên carrier nếu payee rỗng
                updateFee(idx, "carrierId", v);
                if (c && !fee.payee) updateFee(idx, "payee", c.name);
              }}>
                <option value="">— Gán đơn vị VC (nếu là phí VC) —</option>
                {(carriers || []).filter(c => c.status !== "stopped").map(c => (
                  <option key={c.id} value={c.id}>🚛 {c.code ? `[${c.code}] ` : ""}{c.name}</option>
                ))}
              </select>
              <input value={fee.payee || ""} onChange={e => updateFee(idx, "payee", e.target.value)} placeholder="Đơn vị thụ hưởng (Hải quan / Carrier...)" />
            </div>
          </div>
        ))}
      </div>

      {errors.length > 0 && <div className="alert alert-danger">{errors.map((e, i) => <div key={i}>• {e}</div>)}</div>}

      {/* v19/v22: Section Chứng từ — hỗ trợ 3 trạng thái: có link / N/A / chưa có */}
      <div style={{ padding: 14, background: C.green50, borderRadius: 12, border: `1px solid ${C.green200}`, marginTop: 12 }}>
        {(() => {
          const docs = form.documents || [];
          const filledCount = DOCUMENT_TYPES.filter(t => docs.find(d => d.type === t && d.url)).length;
          const naCount = DOCUMENT_TYPES.filter(t => docs.find(d => d.type === t && d.notApplicable)).length;
          return (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.green700 }}>📄 Chứng từ — <span style={{ color: C.green600 }}>{filledCount} có link</span> · <span style={{ color: C.red }}>{naCount} không áp dụng</span> · <span style={{ color: C.textMuted }}>{DOCUMENT_TYPES.length - filledCount - naCount} chờ</span></div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                  💡 Có thể cập nhật chứng từ bất cứ lúc nào (kể cả sau khi về kho) bằng nút <b>"📝 Cập nhật chứng từ"</b> trong danh sách hoặc card chi tiết — không cần mở Form Sửa này.
                </div>
              </div>
            </div>
          );
        })()}
        {DOCUMENT_TYPES.map(docType => {
          const existing = (form.documents || []).find(d => d.type === docType);
          const hasLink = !!(existing && existing.url);
          const isNA = !!(existing && existing.notApplicable);
          return (
            <div key={docType} style={{ display: "grid", gridTemplateColumns: "180px 1fr 110px 80px", gap: 8, marginBottom: 6, padding: "8px 10px", background: hasLink ? C.white : isNA ? "#fef2f2" : "transparent", borderRadius: 8, alignItems: "center", border: isNA ? "1px solid #fecaca" : "none" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: hasLink ? C.green700 : isNA ? C.red : C.textMuted }}>
                {hasLink ? "✅" : isNA ? "🚫" : "⏳"} {docType}
              </div>
              <input
                type="url"
                placeholder={isNA ? "Đã đánh dấu không áp dụng" : "https://drive.google.com/..."}
                value={existing?.url || ""}
                disabled={isNA}
                onChange={e => {
                  const url = e.target.value;
                  const docs = form.documents || [];
                  const idx = docs.findIndex(d => d.type === docType);
                  let newDocs;
                  if (idx >= 0) {
                    if (!url) {
                      newDocs = docs.filter(d => d.type !== docType);
                    } else {
                      newDocs = docs.map((d, i) => i === idx ? { ...d, url, uploadedAt: d.uploadedAt || new Date().toISOString(), notApplicable: false } : d);
                    }
                  } else if (url) {
                    newDocs = [...docs, { id: `doc${uid()}`, type: docType, url, uploadedAt: new Date().toISOString() }];
                  } else {
                    newDocs = docs;
                  }
                  set("documents", newDocs);
                }}
                style={{ fontSize: 12, opacity: isNA ? 0.5 : 1 }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer", color: isNA ? C.red : C.textMuted }}>
                <input type="checkbox" checked={isNA} onChange={() => {
                  const docs = form.documents || [];
                  const idx = docs.findIndex(d => d.type === docType);
                  let newDocs;
                  if (isNA) {
                    newDocs = docs.filter(d => d.type !== docType);
                  } else if (idx >= 0) {
                    newDocs = docs.map((d, i) => i === idx ? { type: docType, notApplicable: true, markedAt: new Date().toISOString() } : d);
                  } else {
                    newDocs = [...docs, { id: `doc${uid()}`, type: docType, notApplicable: true, markedAt: new Date().toISOString() }];
                  }
                  set("documents", newDocs);
                }} />
                Không áp dụng
              </label>
              {hasLink ? (
                <a href={existing.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ padding: "5px 8px", fontSize: 11, textDecoration: "none", textAlign: "center" }}>👁 Xem</a>
              ) : isNA ? (
                <span style={{ fontSize: 10, color: C.red, textAlign: "center", fontStyle: "italic" }}>N/A</span>
              ) : (
                <span style={{ fontSize: 10, color: C.textLight, textAlign: "center" }}>Chưa có</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="form-group" style={{ marginTop: 12 }}><label>Ghi chú</label>
        <textarea rows={2} value={form.note} onChange={e => set("note", e.target.value)} />
      </div>
      {/* v38f: Dialog xác nhận đổi mã đơn giao hàng */}
      {/* v38i fix: Pass đúng props canRename + reasons (V38f sai key) */}
      {renameDlg && (
        <RenameIdDialog
          title={`Đổi mã đơn giao hàng: ${renameDlg.oldId}`}
          subtitle="Cần xác nhận để hoàn tất việc đổi mã"
          oldId={renameDlg.oldId}
          newId={renameDlg.newId}
          canRename={!renameDlg.duplicateExists}
          reasons={renameDlg.duplicateExists ? [`Mã "${renameDlg.newId}" đã được dùng cho đơn giao hàng khác — vui lòng chọn mã khác`] : []}
          onConfirm={() => {
            // Lưu với ID mới — App.onEdit nhận biết qua _renamedFrom
            onSave({ ...renameDlg.finalForm, _renamedFrom: renameDlg.oldId });
            setRenameDlg(null);
          }}
          onClose={() => setRenameDlg(null)}
        />
      )}
    </Modal>
  );
};

// ============================================================
// v22: DocumentsEditModal — Modal độc lập để cập nhật chứng từ
// Dùng được ở mọi trạng thái shipment (kể cả "Đã về kho")
// 3 trạng thái mỗi loại: Đã có / Chưa có / Không áp dụng
// ============================================================
const DocumentsEditModal = ({ shipment, onSave, onClose }) => {
  const [docs, setDocs] = useState(() => shipment.documents || []);

  // Helper: tìm doc theo type
  const findDoc = (type) => docs.find(d => d.type === type);
  // Helper: count theo trạng thái
  const filledCount = DOCUMENT_TYPES.filter(t => {
    const d = findDoc(t);
    return d && d.url;
  }).length;
  const notApplicableCount = DOCUMENT_TYPES.filter(t => {
    const d = findDoc(t);
    return d && d.notApplicable;
  }).length;
  const pendingCount = DOCUMENT_TYPES.length - filledCount - notApplicableCount;

  // Update URL cho 1 loại
  const setUrl = (type, url) => {
    const idx = docs.findIndex(d => d.type === type);
    let next;
    if (idx >= 0) {
      const existing = docs[idx];
      if (!url) {
        // Xóa entry nếu trước đó chỉ có URL (không phải N/A) → quay về "chưa có"
        if (existing.notApplicable) {
          // Đang N/A → giữ N/A, chỉ xóa URL nếu có
          next = docs.map((d, i) => i === idx ? { type: d.type, notApplicable: true, markedAt: d.markedAt || new Date().toISOString() } : d);
        } else {
          next = docs.filter(d => d.type !== type);
        }
      } else {
        next = docs.map((d, i) => i === idx ? { type, url, uploadedAt: d.uploadedAt || new Date().toISOString(), notApplicable: false } : d);
      }
    } else if (url) {
      next = [...docs, { id: `doc${uid()}`, type, url, uploadedAt: new Date().toISOString() }];
    } else {
      next = docs;
    }
    setDocs(next);
  };

  // Toggle "Không áp dụng" cho 1 loại
  const toggleNA = (type) => {
    const idx = docs.findIndex(d => d.type === type);
    const existing = idx >= 0 ? docs[idx] : null;
    const isNA = existing?.notApplicable;
    let next;
    if (isNA) {
      // Đang N/A → bỏ N/A, quay về "chưa có" (xóa entry)
      next = docs.filter(d => d.type !== type);
    } else {
      // Đánh dấu N/A — xóa URL nếu có, set notApplicable: true
      if (idx >= 0) {
        next = docs.map((d, i) => i === idx ? { type, notApplicable: true, markedAt: new Date().toISOString() } : d);
      } else {
        next = [...docs, { id: `doc${uid()}`, type, notApplicable: true, markedAt: new Date().toISOString() }];
      }
    }
    setDocs(next);
  };

  return (
    <Modal title={`📄 Cập nhật chứng từ — ${shipment.id}`} onClose={onClose} onSave={() => onSave(docs)} width={820}>
      <div className="alert alert-info" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, marginBottom: 4 }}>
          <b>{filledCount}/{DOCUMENT_TYPES.length}</b> đã có link · <b>{notApplicableCount}</b> không áp dụng · <b>{pendingCount}</b> chờ cập nhật
        </div>
        <div style={{ fontSize: 11, color: C.textMuted }}>
          Dán link Drive/Dropbox/SharePoint cho các loại đã nhận. Đánh dấu "Không áp dụng" cho loại không cần (VD: hàng nội địa không cần C/O). Loại "Không áp dụng" sẽ không tính là thiếu trong cảnh báo.
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {DOCUMENT_TYPES.map(docType => {
          const existing = findDoc(docType);
          const hasLink = !!(existing && existing.url);
          const isNA = !!(existing && existing.notApplicable);
          // Màu nền theo trạng thái
          const bg = hasLink ? C.green50 : isNA ? "#fef2f2" : C.bg;
          const borderColor = hasLink ? C.green200 : isNA ? "#fecaca" : C.borderLight;
          return (
            <div key={docType} style={{ padding: "10px 14px", background: bg, borderRadius: 10, border: `1px solid ${borderColor}` }}>
              <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 110px 90px", gap: 10, alignItems: "center" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: hasLink ? C.green700 : isNA ? C.red : C.textMuted }}>
                  {hasLink ? "✅" : isNA ? "🚫" : "⏳"} {docType}
                </div>
                {/* Input URL — disable khi N/A */}
                <input
                  type="url"
                  placeholder={isNA ? "Đã đánh dấu không áp dụng" : "https://drive.google.com/..."}
                  value={existing?.url || ""}
                  onChange={e => setUrl(docType, e.target.value)}
                  disabled={isNA}
                  style={{ fontSize: 12, opacity: isNA ? 0.5 : 1 }}
                />
                {/* Toggle N/A */}
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer", color: isNA ? C.red : C.textMuted }}>
                  <input type="checkbox" checked={isNA} onChange={() => toggleNA(docType)} />
                  Không áp dụng
                </label>
                {/* Nút Xem */}
                {hasLink ? (
                  <a href={existing.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ padding: "5px 8px", fontSize: 11, textDecoration: "none", textAlign: "center" }}>👁 Xem</a>
                ) : isNA ? (
                  <span style={{ fontSize: 10, color: C.red, textAlign: "center", fontStyle: "italic" }}>N/A</span>
                ) : (
                  <span style={{ fontSize: 10, color: C.textLight, textAlign: "center" }}>Chưa có</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
};

// v10: Popup xác nhận về kho — nhập SL nhận thực tế + xử lý lệch
const ConfirmArriveForm = ({ shipment, pos, products, markets, onSave, onClose }) => {
  const [form, setForm] = useState({
    actualArriveDate: new Date().toISOString().slice(0, 10),
    warehouseId: shipment.warehouseId || getDefaultWarehouseId(shipment.market, markets),
    note: "",
    items: (shipment.items || []).map(it => ({ ...it, receivedQty: it.receivedQty != null ? it.receivedQty : Number(it.quantity || 0), diffHandling: it.diffHandling || "" })),
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const updateItem = (idx, field, val) => set("items", form.items.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  const wh = getMarketWarehouses(shipment.market, markets);

  const errors = [];
  if (!form.warehouseId) errors.push("Chọn kho nhận");
  if (!form.actualArriveDate) errors.push("Nhập ngày nhận thực tế");
  form.items.forEach((it, idx) => {
    if (Number(it.receivedQty) < 0) errors.push(`Dòng ${idx + 1}: SL nhận không được âm`);
    if (Number(it.receivedQty) > Number(it.quantity)) errors.push(`Dòng ${idx + 1}: SL nhận không được vượt SL giao (${it.quantity})`);
    if (Number(it.receivedQty) < Number(it.quantity) && !it.diffHandling) errors.push(`Dòng ${idx + 1}: Chọn xử lý khi SL nhận < SL giao`);
  });

  return (
    <Modal title={`Xác nhận lô về kho — ${shipment.id}`} subtitle={`${shipment.market} · ${(shipment.items || []).length} dòng SP`}
      onClose={onClose} onSave={() => onSave(form)} saveDisabled={errors.length > 0} saveLabel="✓ Xác nhận về kho" width={900}>
      <div className="alert alert-info">
        💡 <b>Hướng dẫn:</b> Điền số lượng nhận <b>thực tế</b> vào kho. Nếu thiếu so với SL giao, chọn cách xử lý.<br/>
        Sau khi xác nhận, trạng thái sẽ chuyển "Đã về kho" và <b>KHÔNG THỂ quay lui</b>.
      </div>
      <div className="form-grid">
        <div className="form-group"><label>🏪 Kho nhận *</label>
          <select value={form.warehouseId} onChange={e => set("warehouseId", e.target.value)}>
            {wh.length === 0 && <option value="">— Chưa có kho —</option>}
            {wh.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Ngày nhận thực tế *</label>
          <input type="date" value={form.actualArriveDate} onChange={e => set("actualArriveDate", e.target.value)} />
        </div>
        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Ghi chú khi nhận</label>
          <input value={form.note} onChange={e => set("note", e.target.value)} placeholder="VD: Kiện số 12 bị ướt, v.v." />
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <GreenPill>Chi tiết nhận hàng</GreenPill>
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead>
              <tr>
                <th>PO</th><th>SKU</th><th>SP</th><th>SL giao</th><th>SL nhận thực tế</th><th>Chênh</th><th>Xử lý lệch</th>
              </tr>
            </thead>
            <tbody>
              {form.items.map((it, idx) => {
                const po = pos.find(p => p.id === it.poId);
                const poItems = getPOItems(po || {});
                const poItem = po?.items ? poItems.find(x => x.id === it.itemId) : poItems[0];
                const prod = products.find(x => x.id === poItem?.productId);
                const diff = Number(it.quantity) - Number(it.receivedQty || 0);
                return (
                  <tr key={idx}>
                    <td style={{ fontSize: 11, color: C.green600, fontWeight: 600 }}>{it.poId}</td>
                    <td style={{ fontSize: 12, fontWeight: 700 }}>{prod?.sku || "-"}</td>
                    <td style={{ fontSize: 12 }}>{prod?.name || "-"}</td>
                    <td style={{ fontWeight: 600 }}>{Number(it.quantity).toLocaleString()}</td>
                    <td>
                      <NumberInput value={it.receivedQty} min={0} max={it.quantity}
                        onChange={e => updateItem(idx, "receivedQty", e.target.value)}
                        style={{ width: 90, padding: "4px 8px" }}
                        errorIfOver showSetMaxButton />
                    </td>
                    <td style={{ fontWeight: 600, color: diff > 0 ? C.red : (diff < 0 ? C.red : C.green600) }}>
                      {diff > 0 ? `-${diff.toLocaleString()}` : (diff < 0 ? `+${Math.abs(diff).toLocaleString()}` : "0")}
                    </td>
                    <td>
                      {diff > 0 ? (
                        <select value={it.diffHandling || ""} onChange={e => updateItem(idx, "diffHandling", e.target.value)} style={{ width: 140, padding: "4px 8px", fontSize: 11 }}>
                          <option value="">— Chọn —</option>
                          {QTY_DIFF_HANDLING.map(h => <option key={h}>{h}</option>)}
                        </select>
                      ) : (
                        <span style={{ color: C.textLight, fontSize: 11 }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {errors.length > 0 && <div className="alert alert-danger" style={{ marginTop: 10 }}>{errors.map((e, i) => <div key={i}>• {e}</div>)}</div>}

      {/* v38i fix: Xóa dead code renameDlg (V38f copy-paste nhầm — ConfirmArriveForm không có rename feature) */}
    </Modal>
  );
};

const Shipments = ({ shipments, pos, factories, products, feePayments, markets, carriers, settings, onAdd, onEdit, onDelete, onHardDelete, onRenameId, data, onCreateWarehouse, prefill, onClearPrefill, user }) => {
  const marketNames = getMarketNames(markets);
  const [modal, setModal] = useState(null);
  const [arriveModal, setArriveModal] = useState(null); // v10: confirm về kho
  const [filter, setFilter] = useState({ market: "", warehouse: "", status: "", search: "" });
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expanded, setExpanded] = useState(null);
  // v11.2: Custom dialog state
  const [confirmDlg, setConfirmDlg] = useState(null);
  // v20: Dialog hủy với lý do
  const [cancelDlg, setCancelDlg] = useState(null);
  // v22: Modal cập nhật chứng từ riêng (không qua Form Shipment)
  const [docsModal, setDocsModal] = useState(null);
  // v26: Sub-tab Nháp / Chính thức
  const [subTab, setSubTab] = useState("official"); // "draft" | "official"
  // v38d: State cho hard delete dialog
  const [hardDeleteDlg, setHardDeleteDlg] = useState(null);

  const canEdit = can(user, "edit_shipment");
  const canCreate = can(user, "create_shipment");
  const canDelete = can(user, "delete_shipment");
  const canChangeStatus = can(user, "change_shipment_status") || can(user, "edit_shipment");
  // v20: Admin override
  const isAdmin = user?.role === "admin";

  // v26: Đếm số lô Nháp / Chính thức để hiển thị badge
  const draftCount = useMemo(() => shipments.filter(s => s.status === "Nháp").length, [shipments]);
  const officialCount = useMemo(() => shipments.filter(s => s.status !== "Nháp").length, [shipments]);

  // v38j: Auto-open create modal khi có prefill từ tab Tồn kho
  useEffect(() => {
    if (prefill && prefill.productId) {
      const product = products.find(p => p.id === prefill.productId);
      if (!product) return;
      // Tìm PO đã duyệt còn hàng để gắn shipment
      const activePOs = (pos || []).filter(po => po.status === "Đã duyệt" && po.factoryId === product.factoryId);
      // Pick PO đầu tiên có item của SP này còn dư
      let pickedPO = null;
      let pickedItem = null;
      for (const po of activePOs) {
        const items = getPOItems(po);
        const hit = items.find(it => it.productId === product.id);
        if (hit) {
          // Check còn hàng
          const shipped = shipments
            .filter(s => s.status !== "Hủy" && s.status !== "Nháp")
            .reduce((sum, s) => sum + (s.items || []).filter(it => it.poId === po.id && (po.items ? it.itemId === hit.id : true)).reduce((ss, it) => ss + Number(it.quantity || 0), 0), 0);
          const remaining = Number(hit.quantity || 0) - shipped;
          if (remaining > 0) {
            pickedPO = po;
            pickedItem = hit;
            break;
          }
        }
      }
      const prefilledData = {
        factoryId: product.factoryId,
        market: prefill.market || marketNames[0] || "Vietnam",
        warehouseId: prefill.warehouseId || "",
        note: `[Đề xuất từ tồn kho] ${product.sku} - ${product.name}`,
        items: pickedPO ? [{
          id: `it${uid()}`,
          poId: pickedPO.id,
          itemId: pickedItem.id,
          productId: product.id,
          quantity: Number(prefill.quantity || 0),
          receivedQty: null,
        }] : [],
        warningMsg: !pickedPO ? `⚠️ Chưa tìm thấy PO đã duyệt còn hàng cho SP ${product.sku}. Vui lòng tạo PO trước.` : null,
      };
      setModal({ type: "new", prefilled: prefilledData });
      onClearPrefill?.();
    }
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  // Warehouses options based on selected market filter
  const availableWhs = useMemo(() => {
    if (filter.market) return getMarketWarehouses(filter.market, markets);
    return getAllWarehouses(markets);
  }, [filter.market, markets]);

  const filtered = useMemo(() => {
    const q = (filter.search || "").trim().toLowerCase();
    const matched = filterByDateRange(shipments, "departDate", dateFrom, dateTo).filter(s => {
      // v26: Filter theo subTab Nháp / Chính thức
      if (subTab === "draft" && s.status !== "Nháp") return false;
      if (subTab === "official" && s.status === "Nháp") return false;
      if (filter.market && s.market !== filter.market) return false;
      if (filter.warehouse && s.warehouseId !== filter.warehouse) return false;
      if (filter.status && s.status !== filter.status) return false;
      if (!q) return true;
      // Search: mã lô, tracking, checking, carrier, SKU, tên SP (items)
      if (s.id.toLowerCase().includes(q)) return true;
      if ((s.trackingNo || "").toLowerCase().includes(q)) return true;
      if ((s.checkingCode || "").toLowerCase().includes(q)) return true;
      if ((s.carrier || "").toLowerCase().includes(q)) return true;
      // Search trong SP của shipment
      return (s.items || []).some(it => {
        const po = pos.find(p => p.id === it.poId);
        if (!po) return false;
        const poItems = getPOItems(po);
        const poItem = po.items ? poItems.find(x => x.id === it.itemId) : poItems[0];
        const prod = products.find(x => x.id === poItem?.productId);
        if (!prod) return false;
        return (prod.sku || "").toLowerCase().includes(q) ||
               (prod.name || "").toLowerCase().includes(q) ||
               (prod.nameImport || "").toLowerCase().includes(q);
      });
    });
    // v38b: Sort theo departDate desc. Lô Nháp chưa có departDate → tự động xuống cuối (null-safe)
    return sortByDateDesc(matched, "departDate", "id");
  }, [shipments, subTab, filter, dateFrom, dateTo, pos, products]);

  // v28: Pagination
  const { page, setPage, pageSize, setPageSize, paginatedItems: pagedFiltered } = usePagination(filtered, 50);

  // v27: Tính tổng theo filter — CNY chính, VND phụ
  // v33 fix: Loại trừ Hủy + Nháp khỏi tổng giá trị + đếm lô đã về kho/đang VC.
  //          Hiển thị thêm cancelledCount để minh bạch nếu trong filter có lô đã hủy.
  const summary = useMemo(() => {
    let totalValueCNY = 0;
    let arrivedCount = 0;
    let inTransitCount = 0;
    let cancelledCount = 0;
    let draftCountInFilter = 0;
    const inTransitStatuses = ["Đang vận chuyển TQ", "Đang vận chuyển", "Đang thông quan", "Kiểm hoá", "Đã thông quan"];
    filtered.forEach(s => {
      // v33: Đếm riêng lô Hủy và lô Nháp để hiển thị note phụ — không cộng giá trị
      if (s.status === "Hủy") { cancelledCount++; return; }
      if (s.status === "Nháp") { draftCountInFilter++; return; }
      if (s.status === "Đã về kho") arrivedCount++;
      if (inTransitStatuses.includes(s.status)) inTransitCount++;
      // Tính giá trị lô: Σ (SL × đơn giá PO tương ứng)
      (s.items || []).forEach(i => {
        const po = pos.find(p => p.id === i.poId);
        if (!po) return;
        const poItems = getPOItems(po);
        const poItem = po.items ? poItems.find(x => x.id === i.itemId) : poItems[0];
        if (!poItem) return;
        const qty = Number(i.quantity || 0);
        const price = Number(poItem.unitPrice || 0);
        const factory = factories.find(f => f.id === po.factoryId);
        const poCurrency = factory?.currency || po.currency || "CNY";
        let priceInCNY = price;
        if (poCurrency !== "CNY" && settings) {
          const rateKey = `${poCurrency.toLowerCase()}ToVnd`;
          const fromRate = settings[rateKey] || 1;
          const cnyToVnd = settings.cnyToVnd || 1;
          priceInCNY = (price * fromRate) / cnyToVnd;
        }
        totalValueCNY += qty * priceInCNY;
      });
    });
    const cnyToVnd = settings?.cnyToVnd || 1;
    return {
      count: filtered.length,
      totalCNY: totalValueCNY,
      totalVND: totalValueCNY * cnyToVnd,
      arrivedCount,
      inTransitCount,
      cancelledCount, // v33
      draftCountInFilter, // v33
    };
  }, [filtered, pos, factories, settings]);

  // v27: Hint badge cho summary
  const summaryHint = useMemo(() => {
    const parts = [];
    parts.push(subTab === "draft" ? "📝 Nháp" : "🚚 Chính thức");
    if (dateFrom || dateTo) {
      parts.push(`📅 ${dateFrom ? fmtDate(dateFrom) : "..."} → ${dateTo ? fmtDate(dateTo) : "..."}`);
    }
    if (filter.market) parts.push(`🌍 ${filter.market}`);
    if (filter.warehouse) {
      const w = getAllWarehouses(markets).find(x => x.id === filter.warehouse);
      if (w) parts.push(`🏪 ${w.name}`);
    }
    if (filter.status) parts.push(`📌 ${filter.status}`);
    if (filter.search) parts.push(`🔍 "${filter.search}"`);
    return parts.join(" · ");
  }, [subTab, filter, dateFrom, dateTo, markets]);

  // v11.2: Handle đổi status — dùng ConfirmDialog thay alert/confirm native
  const handleStatusChange = (s, newStatus) => {
    if (!canMoveShipmentTo(s.status, newStatus)) {
      setConfirmDlg({
        title: "Không thể đổi trạng thái",
        message: `Không thể chuyển từ "${s.status}" sang "${newStatus}".\n\nQuy tắc:\n• Chỉ được chuyển TIẾN tới (không quay ngược)\n• "Hủy" chỉ áp dụng khi đang "Chờ xuất"`,
        confirmLabel: "OK", cancelLabel: "Đóng",
        onConfirm: () => {},
      });
      return;
    }
    if (newStatus === "Đã về kho") {
      setArriveModal(s);
      return;
    }
    if (newStatus === "Hủy") {
      // v20: Hủy với lý do bắt buộc + audit
      setCancelDlg({ shipment: s });
      return;
    }
    onEdit("shipments", s.id, { status: newStatus });
  };

  return (
    <div>
      <SectionHeader title="Đơn giao hàng" subtitle="Quản lý các đơn giao hàng từ nhà máy về kho thị trường · Nháp → Chờ xuất → Đang VC TQ → Thông quan → Kiểm hoá → Đã thông quan → Về kho"
        action={canCreate && <button className="btn btn-primary" onClick={() => setModal({ type: "new" })}>+ Tạo đơn giao hàng</button>}
      />

      {/* v26: Sub-tabs Nháp / Chính thức */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14, borderBottom: `1px solid ${C.borderLight}` }}>
        <button onClick={() => setSubTab("official")} className="btn btn-ghost" style={{
          padding: "10px 16px", fontSize: 13,
          fontWeight: subTab === "official" ? 700 : 500,
          borderBottom: subTab === "official" ? `3px solid ${C.green600}` : "3px solid transparent",
          borderRadius: 0,
          color: subTab === "official" ? C.green700 : C.textMuted,
        }}>
          🚚 Chính thức {officialCount > 0 && <span style={{ fontSize: 10, marginLeft: 4 }}>({officialCount})</span>}
        </button>
        <button onClick={() => setSubTab("draft")} className="btn btn-ghost" style={{
          padding: "10px 16px", fontSize: 13,
          fontWeight: subTab === "draft" ? 700 : 500,
          borderBottom: subTab === "draft" ? `3px solid #94a3b8` : "3px solid transparent",
          borderRadius: 0,
          color: subTab === "draft" ? "#475569" : C.textMuted,
        }}>
          📝 Nháp {draftCount > 0 && <span style={{ fontSize: 10, marginLeft: 4 }}>({draftCount})</span>}
        </button>
      </div>

      {subTab === "draft" && (
        <div className="alert alert-info" style={{ marginBottom: 14, fontSize: 12, background: "#f1f5f9", borderColor: "#cbd5e1" }}>
          📝 <b>Đang xem các lô NHÁP</b> — chưa cam kết với NCC, KHÔNG ảnh hưởng công nợ và tồn kho. Dùng để thử phân bổ hàng. Bấm <b>"Lưu & Đẩy chờ xuất"</b> trong Form sửa hoặc <b>"Duyệt"</b> trên dòng để chuyển sang chính thức.
        </div>
      )}

      {/* v27: Summary bar */}
      <SummaryBar
        hint={summaryHint}
        items={[
          { icon: "🚚", label: "Số lô", primary: summary.count.toLocaleString(), color: C.green600 },
          { icon: "💰", label: "Tổng giá trị", primary: `¥${(summary.totalCNY).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, secondary: `≈ ${fmtVND(summary.totalVND)}`, color: C.green700 },
          { icon: "🏬", label: "Đã về kho", primary: summary.arrivedCount.toLocaleString(), color: C.green500 },
          { icon: "🛫", label: "Đang vận chuyển", primary: summary.inTransitCount.toLocaleString(), color: C.blue },
        ]}
      />
      {/* v33: Hiển thị note phụ nếu trong filter có lô Hủy/Nháp đã bị loại khỏi tổng giá trị */}
      {(summary.cancelledCount > 0 || summary.draftCountInFilter > 0) && (
        <div style={{ marginTop: -8, marginBottom: 12, fontSize: 11, color: C.textMuted, paddingLeft: 4 }}>
          ℹ️ Tổng giá trị KHÔNG bao gồm:
          {summary.cancelledCount > 0 && <span style={{ marginLeft: 8 }}><b style={{ color: C.red }}>{summary.cancelledCount} lô Hủy</b></span>}
          {summary.draftCountInFilter > 0 && <span style={{ marginLeft: 8 }}><b style={{ color: C.textMuted }}>{summary.draftCountInFilter} lô Nháp</b></span>}
        </div>
      )}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: "14px 18px", marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input placeholder="🔍 Tìm mã đơn giao hàng, tracking, SKU, tên SP..." value={filter.search} onChange={e => setFilter(p => ({ ...p, search: e.target.value }))} style={{ width: 280 }} />
        <select style={{ width: 170 }} value={filter.market} onChange={e => setFilter(p => ({ ...p, market: e.target.value, warehouse: "" }))}>
          <option value="">Tất cả thị trường</option>
          {marketNames.map(m => <option key={m} value={m}>{getFlag(m)} {m}</option>)}
        </select>
        <select style={{ width: 190 }} value={filter.warehouse} onChange={e => setFilter(p => ({ ...p, warehouse: e.target.value }))}>
          <option value="">Tất cả kho</option>
          {availableWhs.map(w => <option key={w.id} value={w.id}>{w.name}{w.marketName && !filter.market ? ` (${w.marketName})` : ""}</option>)}
        </select>
        <select style={{ width: 190 }} value={filter.status} onChange={e => setFilter(p => ({ ...p, status: e.target.value }))}>
          <option value="">Tất cả trạng thái</option>
          {SHIPMENT_STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
        <div style={{ flex: 1, minWidth: 300 }}>
          <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} onReset={() => { setDateFrom(""); setDateTo(""); }} />
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead><tr><th></th><th>Mã đơn giao hàng</th><th>Thị trường / Kho</th><th>Trạng thái</th><th>Ngày xuất → nhận</th><th>Carrier</th><th>Tracking</th><th>Kiện</th><th>SL</th><th>📄</th><th></th></tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={11} style={{ textAlign: "center", color: C.textMuted, padding: 40 }}>Không có đơn giao hàng nào</td></tr>
            ) : pagedFiltered.map(s => {
              const isExpanded = expanded === s.id;
              const totalQty = (s.items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0);
              const totalReceived = (s.items || []).reduce((sum, i) => sum + Number(i.receivedQty || 0), 0);
              return (
                <Fragment key={s.id}>
                  <tr className={isExpanded ? "expanded" : ""} onClick={() => setExpanded(isExpanded ? null : s.id)} style={{ cursor: "pointer", opacity: s.status === "Hủy" ? 0.6 : 1 }}>
                    <td style={{ width: 30 }}>
                      <span style={{ color: C.green500, fontSize: 12, fontWeight: 700 }}>{isExpanded ? "▼" : "▶"}</span>
                    </td>
                    <td style={{ fontWeight: 700, color: C.green600 }}>
                      {s.id}
                      {s.status === "Hủy" && <div style={{ fontSize: 9, color: C.red, fontWeight: 700, marginTop: 2 }}>🚫 ĐÃ HỦY</div>}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      <div style={{ fontWeight: 600 }}>{getFlag(s.market)} {s.market}</div>
                      {s.warehouseId && <div style={{ fontSize: 10, color: C.textMuted }}>{(getAllWarehouses(markets).find(w => w.id === s.warehouseId)?.name) || ""}</div>}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      {canChangeStatus && s.status !== "Hủy" ? (
                        <div style={{ position: "relative", display: "inline-block" }}>
                          <select
                            value={s.status}
                            onChange={e => handleStatusChange(s, e.target.value)}
                            style={{
                              width: "auto", padding: "5px 28px 5px 12px", fontSize: 11, fontWeight: 700,
                              background: shipmentStatusColor(s.status) + "20",
                              color: shipmentStatusColor(s.status),
                              border: `1.5px solid ${shipmentStatusColor(s.status)}`,
                              borderRadius: 99, cursor: "pointer", appearance: "none", WebkitAppearance: "none",
                            }}
                          >
                            {SHIPMENT_STATUSES.map(st => {
                              // Hide invalid options (chỉ forward + Hủy khi Chờ xuất)
                              const ok = st === s.status || canMoveShipmentTo(s.status, st);
                              return <option key={st} value={st} disabled={!ok}>{st}{!ok ? " 🔒" : ""}</option>;
                            })}
                          </select>
                          <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", fontSize: 9, color: shipmentStatusColor(s.status), fontWeight: 700 }}>▼</span>
                        </div>
                      ) : (
                        <Badge label={s.status} color={shipmentStatusColor(s.status)} />
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>{fmtDate(s.departDate)} → {fmtDate(s.actualArriveDate || s.arriveDate)}</td>
                    <td style={{ fontSize: 12 }}>{s.carrierId ? (getCarrierName(s.carrierId, carriers) || s.carrier) : (s.carrier || "-")}</td>
                    <td style={{ fontSize: 11, fontFamily: "monospace", color: C.green700 }}>{s.trackingNo || "-"}</td>
                    <td style={{ fontSize: 12, fontWeight: 600 }}>{s.packages || "-"}</td>
                    <td style={{ fontWeight: 600 }}>
                      {s.status === "Đã về kho" ? (
                        <>
                          <div style={{ color: C.green700 }}>{totalReceived.toLocaleString()}</div>
                          <div style={{ fontSize: 10, color: C.textMuted }}>/ {totalQty.toLocaleString()} giao</div>
                        </>
                      ) : totalQty.toLocaleString()}
                    </td>
                    {/* v19/v22: Cột mini Chứng từ — click để mở modal cập nhật */}
                    <td style={{ fontSize: 11 }} onClick={e => e.stopPropagation()}>
                      {(() => {
                        const docs = s.documents || [];
                        const filledCount = DOCUMENT_TYPES.filter(t => docs.find(d => d.type === t && d.url)).length;
                        const naCount = DOCUMENT_TYPES.filter(t => docs.find(d => d.type === t && d.notApplicable)).length;
                        const applicable = DOCUMENT_TYPES.length - naCount;
                        const isComplete = filledCount === applicable; // tất cả loại áp dụng đã có
                        const isArrived = s.status === "Đã về kho";
                        const warning = isArrived && !isComplete;
                        const canUpdateDocs = canEdit && s.status !== "Hủy";
                        return (
                          <button
                            disabled={!canUpdateDocs}
                            onClick={() => setDocsModal(s)}
                            className="btn btn-ghost"
                            style={{
                              padding: "4px 8px",
                              fontSize: 11,
                              fontWeight: 700,
                              color: isComplete ? C.green600 : warning ? C.red : C.textMuted,
                              cursor: canUpdateDocs ? "pointer" : "default",
                              border: `1px dashed ${isComplete ? C.green200 : warning ? "#fecaca" : C.borderLight}`,
                              minWidth: 70,
                            }}
                            title={canUpdateDocs ? "Click để cập nhật chứng từ" : "Không thể cập nhật"}
                          >
                            <div>📄 {filledCount}/{applicable}{naCount > 0 ? <span style={{ color: C.textLight, fontWeight: 400 }}> · {naCount} N/A</span> : ""}</div>
                            {warning && <div style={{ fontSize: 9, color: C.red, fontWeight: 700, marginTop: 1 }}>⚠ Thiếu</div>}
                          </button>
                        );
                      })()}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {/* v26: Nháp — sửa được + nút Duyệt + Xóa hẳn */}
                        {s.status === "Nháp" && canEdit && (
                          <>
                            <button className="btn btn-ghost" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: s })}>Sửa</button>
                            {canChangeStatus && (
                              <button className="btn btn-primary" style={{ padding: "4px 9px", fontSize: 11 }}
                                onClick={() => {
                                  onEdit("shipments", s.id, { status: "Chờ xuất", approvedAt: new Date().toISOString(), approvedBy: user?.fullName || user?.username });
                                }} title="Chuyển từ Nháp sang Chờ xuất — bắt đầu tính công nợ">
                                ✅ Duyệt
                              </button>
                            )}
                            {canDelete && (
                              <button className="btn btn-danger" style={{ padding: "4px 9px", fontSize: 11 }}
                                onClick={() => setConfirmDlg({
                                  title: `Xóa lô nháp ${s.id}?`,
                                  message: "Lô Nháp sẽ bị xóa hẳn — không lưu lại lịch sử (vì chưa cam kết gì). Hành động này KHÔNG thể hoàn tác.",
                                  danger: true, confirmLabel: "Xóa hẳn",
                                  onConfirm: () => onDelete("shipments", s.id),
                                })} title="Xóa hẳn lô nháp (không lưu lịch sử)">
                                🗑 Xóa
                              </button>
                            )}
                          </>
                        )}

                        {/* v20: User thường chỉ sửa được khi "Chờ xuất". Admin sửa được mọi trạng thái */}
                        {s.status !== "Nháp" && canEdit && (s.status === "Chờ xuất" || isAdmin) && s.status !== "Hủy" && <button className="btn btn-ghost" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: s })}>Sửa</button>}
                        {/* v20: Admin có thể sửa cả lô đã hủy */}
                        {isAdmin && s.status === "Hủy" && <button className="btn btn-ghost" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: s })}>Sửa</button>}
                        {/* v38d: Xóa cứng — chỉ admin, chỉ shipment status = Hủy */}
                        {isAdmin && s.status === "Hủy" && (
                          <button
                            className="btn btn-ghost"
                            style={{ padding: "4px 9px", fontSize: 11, color: C.red }}
                            title="Xóa cứng đơn giao hàng (vĩnh viễn)"
                            onClick={() => {
                              const check = canHardDeleteShipment(s.id, data);
                              const totalQty = (s.items || []).reduce((sum, it) => sum + Number(it.quantity || 0), 0);
                              setHardDeleteDlg({
                                id: s.id,
                                title: `Xóa cứng đơn giao hàng: ${s.id}`,
                                subtitle: `Thị trường: ${s.market || "—"} · Ngày xuất: ${fmtDate(s.departDate)}`,
                                objectSummary: `${s.id} · ${(s.items || []).length} mục · Tổng SL: ${totalQty} · Trạng thái: Hủy`,
                                canDelete: check.allowed,
                                reasons: check.reasons,
                              });
                            }}
                          >🗑️ Xóa cứng</button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr>
                      <td colSpan={11} style={{ background: C.green50, padding: 24 }}>
                        <ShipmentDetail shipment={s} pos={pos} factories={factories} products={products} feePayments={feePayments} markets={markets} carriers={carriers} settings={settings}
                          canEditDocs={canEdit && s.status !== "Hủy"}
                          onEditDocuments={() => setDocsModal(s)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      {modal?.type === "new" && <ShipmentForm prefilled={modal.prefilled || null} pos={pos} shipments={shipments} factories={factories} products={products} markets={markets} carriers={carriers} settings={settings} onCreateWarehouse={onCreateWarehouse} onSave={f => {
        const customId = (f.id || "").trim();
        const now = new Date();
        const ymd = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
        const rand4 = Math.floor(1000 + Math.random() * 9000);
        const autoId = `GC-${ymd}-${rand4}`;
        const finalId = customId || autoId;
        if (customId && shipments.some(s => s.id === customId)) {
          setConfirmDlg({ title: "Trùng mã lô", message: `Mã lô "${customId}" đã tồn tại. Vui lòng đặt mã khác hoặc để trống.`, confirmLabel: "OK", cancelLabel: null, onConfirm: () => {} });
          return;
        }
        const { id: _, ...rest } = f;
        onAdd("shipments", { id: finalId, ...rest });
        setModal(null);
      }} onClose={() => setModal(null)} />}
      {modal?.type === "edit" && <ShipmentForm initial={modal.data} pos={pos} shipments={shipments} factories={factories} products={products} markets={markets} carriers={carriers} settings={settings} onCreateWarehouse={onCreateWarehouse} data={data} feePayments={feePayments} stockMovements={data?.stockMovements} onSave={f => {
        // v38f: Phát hiện rename — nếu có _renamedFrom thì gọi onRenameId TRƯỚC, sau đó update các field khác
        const { id: newId, _renamedFrom, ...rest } = f;
        if (_renamedFrom && typeof onRenameId === "function") {
          // Step 1: Rename ID
          onRenameId("shipments", _renamedFrom, newId);
          // Step 2: Update các field khác (sau khi đã rename, dùng newId làm key)
          onEdit("shipments", newId, rest);
        } else {
          onEdit("shipments", modal.data.id, rest);
        }
        setModal(null);
      }} onClose={() => setModal(null)} />}
      {arriveModal && <ConfirmArriveForm shipment={arriveModal} pos={pos} products={products} markets={markets}
        onSave={form => {
          onEdit("shipments", arriveModal.id, {
            status: "Đã về kho",
            warehouseId: form.warehouseId,
            actualArriveDate: form.actualArriveDate,
            arrivalNote: form.note,
            items: form.items,
          });
          setArriveModal(null);
        }} onClose={() => setArriveModal(null)} />}
      {/* v11.2: Confirm dialog */}
      {confirmDlg && <ConfirmDialog {...confirmDlg} onClose={() => setConfirmDlg(null)} />}
      {/* v20: Dialog hủy đơn giao hàng với lý do bắt buộc */}
      {cancelDlg && <PromptDialog title={`Hủy đơn giao hàng ${cancelDlg.shipment.id}?`}
        message={`Đơn đang ở trạng thái "${cancelDlg.shipment.status}". Sau khi hủy sẽ không thể thao tác thêm. Hàng đã hủy không tính vào công nợ thị trường.`}
        placeholder="VD: Sai SP, NCC không giao được, đổi sang lô khác..."
        confirmLabel="🚫 Xác nhận Hủy" required={true}
        onConfirm={(reason) => {
          onEdit("shipments", cancelDlg.shipment.id, {
            status: "Hủy",
            cancelReason: reason,
            cancelledBy: user?.fullName || user?.username,
            cancelledAt: new Date().toISOString(),
          });
          setCancelDlg(null);
        }}
        onClose={() => setCancelDlg(null)} />}
      {/* v22: Modal cập nhật chứng từ */}
      {docsModal && <DocumentsEditModal shipment={docsModal}
        onSave={(newDocs) => {
          onEdit("shipments", docsModal.id, {
            documents: newDocs,
            lastEditedBy: user?.fullName || user?.username,
            lastEditedAt: new Date().toISOString(),
          });
          setDocsModal(null);
        }}
        onClose={() => setDocsModal(null)} />}
      {/* v38d: Hard delete dialog */}
      {hardDeleteDlg && (
        <HardDeleteDialog
          {...hardDeleteDlg}
          onConfirm={() => onHardDelete && onHardDelete("shipments", hardDeleteDlg.id)}
          onClose={() => setHardDeleteDlg(null)}
        />
      )}
    </div>
  );
};

// Shipment Detail expand content (v10: + warehouse, packages, receivedQty)
const ShipmentDetail = ({ shipment: s, pos, factories, products, feePayments, markets, carriers, settings, onEditDocuments, canEditDocs }) => {
  const totalQty = (s.items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0);
  const totalReceived = (s.items || []).reduce((sum, i) => sum + Number(i.receivedQty || 0), 0);
  const totalGoodsVND = (s.items || []).reduce((sum, i) => {
    const po = pos.find(p => p.id === i.poId);
    if (!po) return sum;
    const poItems = getPOItems(po);
    const poItem = po.items ? poItems.find(it => it.id === i.itemId) : poItems[0];
    return sum + toVND(Number(i.quantity || 0) * Number(poItem?.unitPrice || 0), po.currency, settings);
  }, 0);
  const totalFeesVND = (s.fees || []).reduce((sum, f) => sum + toVND(Number(f.amount || 0), f.currency, settings), 0);
  const totalFeePaidVND = (s.fees || []).reduce((sum, f) => {
    const bal = calcFeeBalance(s.id, f.id, feePayments || [], settings);
    return sum + bal.totalPaid;
  }, 0);
  const feeUnpaidVND = totalFeesVND - totalFeePaidVND;

  const whName = s.warehouseId ? getWarehouseName(s.warehouseId, markets) : `${getFlag(s.market)} ${s.market} (chưa chọn kho)`;
  const carrierName = s.carrierId ? getCarrierName(s.carrierId, carriers) : (s.carrier || "");
  // v11: Tính CBM cả lô
  const totalCBM = shipmentTotalCBM(s, pos, products);

  return (
    <div>
      {/* v20: Banner lý do hủy nếu shipment đã hủy */}
      {s.status === "Hủy" && (
        <div className="alert alert-danger" style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>🚫 Đơn giao hàng này đã bị HỦY</div>
          {s.cancelReason && <div style={{ fontSize: 12 }}><b>Lý do:</b> {s.cancelReason}</div>}
          {(s.cancelledBy || s.cancelledAt) && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Hủy bởi: {s.cancelledBy || "—"}{s.cancelledAt && ` · ${new Date(s.cancelledAt).toLocaleString("vi-VN")}`}</div>}
        </div>
      )}
      {/* Info bar: warehouse + packages + carrier + CBM */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 14 }}>
        <div style={{ background: C.white, padding: 12, borderRadius: 10, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Kho nhận</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green700, marginTop: 4 }}>{whName}</div>
        </div>
        <div style={{ background: C.white, padding: 12, borderRadius: 10, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Số kiện</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.green700, marginTop: 4 }}>{s.packages || "—"}</div>
        </div>
        <div style={{ background: C.white, padding: 12, borderRadius: 10, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Thể tích (CBM)</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.green700, marginTop: 4 }}>{totalCBM > 0 ? totalCBM.toFixed(3) : "—"} m³</div>
          {totalCBM === 0 && <div style={{ fontSize: 9, color: C.textLight, marginTop: 2 }}>Thiếu kích thước SP</div>}
        </div>
        <div style={{ background: C.white, padding: 12, borderRadius: 10, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Đơn vị VC</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green700, marginTop: 4 }}>🚛 {carrierName || "—"}</div>
          {s.trackingNo && <div style={{ fontSize: 10, fontFamily: "monospace", color: C.textMuted, marginTop: 2 }}>{s.trackingNo}</div>}
        </div>
        <div style={{ background: C.white, padding: 12, borderRadius: 10, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Ngày xuất / nhận</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.text, marginTop: 4 }}>
            {fmtDate(s.departDate)}<br/>→ {fmtDate(s.actualArriveDate || s.arriveDate)}
          </div>
          {s.actualArriveDate && <div style={{ fontSize: 9, color: C.green600, marginTop: 2 }}>✓ Đã nhận</div>}
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
        <div style={{ background: C.white, padding: 12, borderRadius: 10, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Tổng SL giao</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.green700 }}>{totalQty.toLocaleString()}</div>
          {s.status === "Đã về kho" && totalReceived !== totalQty && (
            <div style={{ fontSize: 11, color: C.red, marginTop: 2 }}>SL nhận thực tế: {totalReceived.toLocaleString()}</div>
          )}
        </div>
        <div style={{ background: C.white, padding: 12, borderRadius: 10, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Giá trị hàng</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.green700 }}>{fmt(totalGoodsVND, "VND")}</div>
        </div>
        <div style={{ background: C.white, padding: 12, borderRadius: 10, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Thuế phí</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.orange }}>{fmt(totalFeesVND, "VND")}</div>
        </div>
        <div style={{ background: feeUnpaidVND > 0 ? C.redBg : C.green50, padding: 12, borderRadius: 10, border: `1px solid ${feeUnpaidVND > 0 ? C.red + "40" : C.green300}` }}>
          <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Phí chưa thanh toán</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: feeUnpaidVND > 0 ? C.red : C.green600 }}>{fmt(feeUnpaidVND, "VND")}</div>
        </div>
      </div>

      {/* Items */}
      <div style={{ marginBottom: 16 }}>
        <GreenPill>Hàng từ PO ({(s.items || []).length} dòng)</GreenPill>
        {/* v38k: Thứ tự mới — PO → SKU → SP → SL giao → SL nhận → Xử lý lệch → Nhà máy → Giá trị */}
        <table>
          <thead><tr><th>PO</th><th>SKU</th><th>Sản phẩm</th><th>SL giao</th>{s.status === "Đã về kho" && <><th>SL nhận</th><th>Xử lý lệch</th></>}<th>Nhà máy</th><th>Giá trị</th></tr></thead>
          <tbody>
            {(s.items || []).map((it, idx) => {
              const po = pos.find(p => p.id === it.poId);
              const f = factories.find(x => x.id === po?.factoryId);
              const poItems = getPOItems(po || {});
              const poItem = po?.items ? poItems.find(x => x.id === it.itemId) : poItems[0];
              const prod = products.find(x => x.id === poItem?.productId);
              const val = Number(it.quantity) * Number(poItem?.unitPrice || 0);
              const diff = Number(it.quantity) - Number(it.receivedQty || 0);
              return (
                <tr key={idx}>
                  <td style={{ color: C.green600, fontWeight: 600 }}>{it.poId}</td>
                  <td style={{ fontSize: 12, fontWeight: 600 }}>{prod?.sku || "-"}</td>
                  <td style={{ fontSize: 12 }}>{prod?.name || "-"}</td>
                  <td style={{ fontWeight: 600 }}>{Number(it.quantity).toLocaleString()}</td>
                  {s.status === "Đã về kho" && (
                    <>
                      <td style={{ fontWeight: 600, color: diff === 0 ? C.green600 : C.red }}>
                        {Number(it.receivedQty || 0).toLocaleString()}
                        {diff > 0 && <div style={{ fontSize: 10, color: C.red }}>thiếu {diff.toLocaleString()}</div>}
                      </td>
                      <td style={{ fontSize: 11 }}>{it.diffHandling ? <Badge label={it.diffHandling} color={C.orange} bg="#fef3c7" /> : "—"}</td>
                    </>
                  )}
                  <td style={{ fontSize: 12 }}>{f?.name}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{fmt(val, po?.currency)}</div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(toVND(val, po?.currency, settings), "VND")}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Fees with payment status */}
      {(s.fees || []).length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <GreenPill>Thuế phí nhập khẩu ({s.fees.length} khoản)</GreenPill>
          <table>
            <thead><tr><th>Loại</th><th>Đơn vị thụ hưởng</th><th>Số tiền</th><th>Đã TT</th><th>Còn nợ</th><th>Ghi chú</th></tr></thead>
            <tbody>
              {s.fees.map((fee, idx) => {
                const feeVND = toVND(Number(fee.amount), fee.currency, settings);
                const bal = calcFeeBalance(s.id, fee.id, feePayments || [], settings);
                const remain = feeVND - bal.totalPaid;
                return (
                  <tr key={idx}>
                    <td style={{ fontSize: 12, fontWeight: 600 }}>{fee.type}</td>
                    <td style={{ fontSize: 12 }}>{fee.payee || "-"}</td>
                    <td>
                      <div style={{ color: C.orange, fontWeight: 600 }}>{fmt(fee.amount, fee.currency)}</div>
                      <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(feeVND, "VND")}</div>
                    </td>
                    <td style={{ color: C.blue, fontWeight: 600 }}>{fmt(bal.totalPaid, "VND")}
                      {bal.count > 0 && <div style={{ fontSize: 10, color: C.textMuted }}>{bal.count} lần</div>}
                    </td>
                    <td>
                      {remain > 0 ? (
                        <span style={{ color: C.red, fontWeight: 700 }}>{fmt(remain, "VND")}</span>
                      ) : (
                        <Badge label="Đã thanh toán" color={C.green500} />
                      )}
                    </td>
                    <td style={{ fontSize: 11, color: C.textMuted }}>{fee.note || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* v22: Hiển thị danh sách chứng từ — 3 trạng thái: ✅ có / 🚫 N/A / ⏳ chưa có */}
      {(() => {
        const docs = s.documents || [];
        const docsByType = new Map(docs.map(d => [d.type, d]));
        const filledCount = DOCUMENT_TYPES.filter(t => docsByType.get(t)?.url).length;
        const naCount = DOCUMENT_TYPES.filter(t => docsByType.get(t)?.notApplicable).length;
        const applicableTotal = DOCUMENT_TYPES.length - naCount;
        const missingApplicable = DOCUMENT_TYPES.filter(t => {
          const d = docsByType.get(t);
          return !d?.notApplicable && !d?.url;
        });

        return (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
              <GreenPill>📄 Chứng từ ({filledCount}/{applicableTotal} áp dụng có link{naCount > 0 ? ` · ${naCount} không áp dụng` : ""})</GreenPill>
              {canEditDocs && (
                <button type="button" className="btn btn-primary" style={{ padding: "5px 12px", fontSize: 11 }} onClick={onEditDocuments}>
                  📝 Cập nhật chứng từ
                </button>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
              {DOCUMENT_TYPES.map(t => {
                const d = docsByType.get(t);
                const hasUrl = !!d?.url;
                const isNA = !!d?.notApplicable;
                const bg = isNA ? "#fef2f2" : hasUrl ? C.green50 : C.bg;
                const border = isNA ? "#fecaca" : hasUrl ? C.green200 : C.borderLight;
                const status = isNA ? "🚫" : hasUrl ? "✅" : "⏳";
                const color = isNA ? C.red : hasUrl ? C.green700 : C.textMuted;
                const label = isNA ? "Không áp dụng" : "Chờ cập nhật";

                return (
                  <div key={t} style={{ padding: "8px 12px", background: bg, borderRadius: 8, border: `1px solid ${border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {status} {t}
                    </div>
                    {hasUrl ? (
                      <a href={d.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ padding: "3px 8px", fontSize: 10, textDecoration: "none" }}>👁 Xem</a>
                    ) : (
                      <span style={{ fontSize: 10, color: C.textLight, fontStyle: "italic" }}>{label}</span>
                    )}
                  </div>
                );
              })}
            </div>
            {s.status === "Đã về kho" && missingApplicable.length > 0 && (
              <div className="alert alert-danger" style={{ marginTop: 10, fontSize: 12 }}>
                ⚠ Đơn đã về kho nhưng còn thiếu <b>{missingApplicable.length} chứng từ áp dụng</b>: {missingApplicable.join(", ")}
                {canEditDocs && <span> — bấm <b>📝 Cập nhật chứng từ</b> ở trên để bổ sung hoặc đánh dấu Không áp dụng.</span>}
              </div>
            )}
          </div>
        );
      })()}

      {s.note && <div style={{ marginTop: 14, padding: 12, background: C.white, borderRadius: 10, fontSize: 12, color: C.textMuted }}><b>Ghi chú:</b> {s.note}</div>}
    </div>
  );
};

// ============================================================
// FEES TAB
// ============================================================
const FeePaymentForm = ({ fee, shipment, existingPayments, settings, onSave, onClose }) => {
  const feeVND = toVND(Number(fee.amount), fee.currency, settings);
  const alreadyPaid = existingPayments.reduce((s, p) => s + toVND(Number(p.amount), p.currency, settings), 0);
  const remainVND = feeVND - alreadyPaid;

  const [form, setForm] = useState({
    amount: remainVND > 0 ? remainVND : "",
    currency: "VND",
    payDate: new Date().toISOString().slice(0, 10),
    payer: "",
    note: "",
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const amountVND = toVND(Number(form.amount || 0), form.currency, settings);
  const newTotal = alreadyPaid + amountVND;
  const willOverpay = newTotal > feeVND;
  const isValid = Number(form.amount) > 0;

  return (
    <Modal title={`Thanh toán phí: ${fee.type}`} subtitle={`${shipment.id} · ${shipment.market} · Đơn vị: ${fee.payee || "-"}`}
      onClose={onClose} onSave={() => onSave({ ...form, shipmentId: shipment.id, feeId: fee.id, amount: Number(form.amount) })} saveDisabled={!isValid}>
      <div style={{ background: C.bg, padding: 14, borderRadius: 10, marginBottom: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Tổng phí</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{fmt(fee.amount, fee.currency)}</div>
            <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(feeVND, "VND")}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Đã thanh toán</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.blue }}>{fmt(alreadyPaid, "VND")}</div>
            <div style={{ fontSize: 10, color: C.textMuted }}>{existingPayments.length} lần</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Còn lại</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: remainVND > 0 ? C.red : C.green600 }}>{fmt(Math.max(0, remainVND), "VND")}</div>
          </div>
        </div>
      </div>

      <div className="form-grid">
        <div className="form-group"><label>Số tiền thanh toán *</label>
          <input type="number" step="0.01" min={0} value={form.amount} onChange={e => set("amount", e.target.value)} />
        </div>
        <div className="form-group"><label>Tiền tệ</label>
          <select value={form.currency} onChange={e => set("currency", e.target.value)}>
            {["VND", "USD", "THB", "MYR", "PHP", "CNY"].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Ngày thanh toán</label>
          <input type="date" value={form.payDate} onChange={e => set("payDate", e.target.value)} />
        </div>
        <div className="form-group"><label>Người/bộ phận TT</label>
          <input value={form.payer} onChange={e => set("payer", e.target.value)} placeholder="VD: Kế toán công ty" />
        </div>
        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Ghi chú</label>
          <textarea rows={2} value={form.note} onChange={e => set("note", e.target.value)} />
        </div>
      </div>

      {willOverpay && <div className="alert alert-warn">⚠ Tổng thanh toán ({fmt(newTotal, "VND")}) sẽ vượt quá số phí ({fmt(feeVND, "VND")})</div>}
    </Modal>
  );
};

const ImportFees = ({ shipments, feePayments, markets, carriers, settings, onAdd, onEdit, onDelete, user }) => {
  const marketNames = getMarketNames(markets);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [subTab, setSubTab] = useState("overview");
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState({ market: "", payee: "", paymentStatus: "" });
  // v20: Dialog hủy
  const [cancelDlg, setCancelDlg] = useState(null);

  const canCreatePay = can(user, "create_fee_payment");
  // v20: canCancel = quyền xóa cũ. canEdit = quyền tạo
  const canCancelPay = can(user, "delete_fee_payment");
  const canEditPay = can(user, "create_fee_payment");
  const isAdmin = user?.role === "admin";

  // v33 fix: Loại trừ shipment Hủy + Nháp khỏi tổng tiền phí.
  // Lý do: Phí nhập khẩu không phát sinh nếu shipment đã hủy hoặc còn ở dạng Nháp.
  const filtered = useMemo(() =>
    filterByDateRange(shipments, "departDate", dateFrom, dateTo).filter(isOperationalShipment),
    [shipments, dateFrom, dateTo]
  );

  // Flatten all fees with shipment context + payment info
  const allFees = useMemo(() => {
    const result = [];
    filtered.forEach(s => {
      (s.fees || []).forEach(f => {
        const feeVND = toVND(Number(f.amount), f.currency, settings);
        const bal = calcFeeBalance(s.id, f.id, feePayments, settings);
        const remain = feeVND - bal.totalPaid;
        result.push({
          ...f,
          shipmentId: s.id,
          market: s.market,
          departDate: s.departDate,
          feeVND,
          paidVND: bal.totalPaid,
          remainVND: remain,
          paidCount: bal.count,
          status: remain <= 0 ? "paid" : bal.totalPaid > 0 ? "partial" : "unpaid",
        });
      });
    });
    return result;
  }, [filtered, feePayments, settings]);

  const filteredFees = useMemo(() => allFees.filter(f =>
    (!filter.market || f.market === filter.market) &&
    (!filter.payee || (f.payee || "").toLowerCase().includes(filter.payee.toLowerCase())) &&
    (!filter.paymentStatus || f.status === filter.paymentStatus)
  ), [allFees, filter]);

  // Group by market
  const feesByMarket = useMemo(() => {
    const result = {};
    marketNames.forEach(m => { result[m] = { total: 0, paid: 0, remain: 0, byType: {}, shipmentCount: 0, shipments: [] }; });
    filtered.forEach(s => {
      if (!result[s.market]) return;
      result[s.market].shipmentCount++;
      result[s.market].shipments.push(s);
      (s.fees || []).forEach(f => {
        const vnd = toVND(Number(f.amount || 0), f.currency, settings);
        const bal = calcFeeBalance(s.id, f.id, feePayments, settings);
        result[s.market].total += vnd;
        result[s.market].paid += bal.totalPaid;
        result[s.market].remain += Math.max(0, vnd - bal.totalPaid);
        result[s.market].byType[f.type] = (result[s.market].byType[f.type] || 0) + vnd;
      });
    });
    return result;
  }, [filtered, feePayments, settings]);

  // Group by payee (đơn vị thụ hưởng)
  const feesByPayee = useMemo(() => {
    const result = {};
    filtered.forEach(s => (s.fees || []).forEach(f => {
      const payee = f.payee || "(Chưa gán)";
      if (!result[payee]) result[payee] = { total: 0, paid: 0, remain: 0, count: 0 };
      const vnd = toVND(Number(f.amount || 0), f.currency, settings);
      const bal = calcFeeBalance(s.id, f.id, feePayments, settings);
      result[payee].total += vnd;
      result[payee].paid += bal.totalPaid;
      result[payee].remain += Math.max(0, vnd - bal.totalPaid);
      result[payee].count++;
    }));
    return Object.entries(result).sort((a, b) => b[1].remain - a[1].remain);
  }, [filtered, feePayments, settings]);

  const totalAll = marketNames.reduce((s, m) => s + feesByMarket[m].total, 0);
  const totalPaidAll = marketNames.reduce((s, m) => s + feesByMarket[m].paid, 0);
  const totalRemainAll = marketNames.reduce((s, m) => s + feesByMarket[m].remain, 0);

  // Handler to open payment modal
  const openPayModal = (fee) => {
    const shipment = shipments.find(s => s.id === fee.shipmentId);
    if (!shipment) return;
    const feeObj = (shipment.fees || []).find(f => f.id === fee.id);
    if (!feeObj) return;
    const existing = feePayments.filter(p => p.shipmentId === fee.shipmentId && p.feeId === fee.id);
    setModal({ type: "pay", fee: feeObj, shipment, existing });
  };

  return (
    <div>
      <SectionHeader title="Thuế phí nhập khẩu" subtitle="Ghi nhận phí khi xuất hàng · Thanh toán riêng với từng đơn vị (hải quan, vận chuyển...)" />

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: "14px 18px", marginBottom: 16 }}>
        <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} onReset={() => { setDateFrom(""); setDateTo(""); }} />
      </div>

      {/* Summary KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
        <div className="card">
          <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Tổng phí ghi nhận</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: C.green700 }}>{fmt(totalAll, "VND")}</div>
          <div style={{ fontSize: 11, color: C.textLight, marginTop: 4 }}>{allFees.length} khoản phí</div>
        </div>
        <div className="card">
          <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Đã thanh toán</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: C.blue }}>{fmt(totalPaidAll, "VND")}</div>
          <div style={{ fontSize: 11, color: C.textLight, marginTop: 4 }}>{feePayments.length} lần thanh toán</div>
        </div>
        <div className="card" style={{ border: totalRemainAll > 0 ? `2px solid ${C.red}40` : undefined }}>
          <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Còn phải thanh toán</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: totalRemainAll > 0 ? C.red : C.green600 }}>{fmt(totalRemainAll, "VND")}</div>
          <div style={{ fontSize: 11, color: C.textLight, marginTop: 4 }}>{allFees.filter(f => f.status !== "paid").length} khoản chưa thanh toán</div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, borderBottom: `2px solid ${C.border}` }}>
        {[
          ["overview", "📊 Tổng quan"],
          ["fees", "📋 Chi tiết phí & TT"],
          ["payees", "👤 Theo đơn vị"],
          ["payments", "💸 Lịch sử TT"],
        ].map(([k, label]) => (
          <button key={k} onClick={() => setSubTab(k)}
            style={{
              padding: "10px 18px", border: "none", background: "transparent",
              borderBottom: subTab === k ? `3px solid ${C.green500}` : "3px solid transparent",
              marginBottom: -2, fontSize: 13, fontWeight: 600, cursor: "pointer",
              color: subTab === k ? C.green700 : C.textMuted,
            }}>{label}</button>
        ))}
      </div>

      {/* OVERVIEW: market KPIs + matrix */}
      {subTab === "overview" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
            {marketNames.map(m => (
              <div key={m} className="card">
                <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>{m}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.green700 }}>{fmt(feesByMarket[m].total, "VND")}</div>
                <div style={{ fontSize: 11, color: C.textLight, marginTop: 4 }}>Đã TT: <b style={{ color: C.blue }}>{fmt(feesByMarket[m].paid, "VND")}</b></div>
                <div style={{ fontSize: 11, color: feesByMarket[m].remain > 0 ? C.red : C.green600, marginTop: 2 }}>Còn nợ: <b>{fmt(feesByMarket[m].remain, "VND")}</b></div>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ textAlign: "center" }}><GreenPill>Ma trận phí theo loại × thị trường (VND)</GreenPill></div>
            <table>
              <thead>
                <tr><th>Loại phí</th>{marketNames.map(m => <th key={m} style={{ textAlign: "right" }}>{m}</th>)}<th style={{ textAlign: "right", background: C.green100 }}>Tổng</th></tr>
              </thead>
              <tbody>
                {(() => {
                  const allTypes = new Set();
                  marketNames.forEach(m => Object.keys(feesByMarket[m].byType).forEach(t => allTypes.add(t)));
                  const matrix = Array.from(allTypes).map(type => {
                    const row = { type };
                    marketNames.forEach(m => { row[m] = feesByMarket[m].byType[type] || 0; });
                    row.total = marketNames.reduce((s, m) => s + (feesByMarket[m].byType[type] || 0), 0);
                    return row;
                  });
                  if (matrix.length === 0) return <tr><td colSpan={marketNames.length + 2} style={{ textAlign: "center", color: C.textMuted, padding: 30 }}>Chưa có dữ liệu phí</td></tr>;
                  return <>
                    {matrix.map(row => (
                      <tr key={row.type}>
                        <td style={{ fontWeight: 600 }}>{row.type}</td>
                        {marketNames.map(m => <td key={m} style={{ textAlign: "right", color: row[m] > 0 ? C.orange : C.textLight, fontWeight: row[m] > 0 ? 600 : 400 }}>{row[m] > 0 ? fmt(row[m], "VND") : "-"}</td>)}
                        <td style={{ textAlign: "right", fontWeight: 700, background: C.green50, color: C.green700 }}>{fmt(row.total, "VND")}</td>
                      </tr>
                    ))}
                    <tr style={{ background: C.green100 }}>
                      <td style={{ fontWeight: 800 }}>TỔNG</td>
                      {marketNames.map(m => <td key={m} style={{ textAlign: "right", fontWeight: 800, color: C.green700 }}>{fmt(feesByMarket[m].total, "VND")}</td>)}
                      <td style={{ textAlign: "right", fontWeight: 800, color: C.green800, background: C.green200 }}>{fmt(totalAll, "VND")}</td>
                    </tr>
                  </>;
                })()}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* FEES DETAIL */}
      {subTab === "fees" && (
        <>
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 16px", marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <select style={{ width: 160 }} value={filter.market} onChange={e => setFilter(p => ({ ...p, market: e.target.value }))}>
              <option value="">Tất cả thị trường</option>
              {marketNames.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select style={{ width: 160 }} value={filter.paymentStatus} onChange={e => setFilter(p => ({ ...p, paymentStatus: e.target.value }))}>
              <option value="">Tất cả trạng thái thanh toán</option>
              <option value="unpaid">Chưa thanh toán</option>
              <option value="partial">Thanh toán một phần</option>
              <option value="paid">Đã thanh toán đủ</option>
            </select>
            <input placeholder="🔍 Tìm theo đơn vị TH..." value={filter.payee} onChange={e => setFilter(p => ({ ...p, payee: e.target.value }))} style={{ width: 200 }} />
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table>
              <thead><tr><th>Lô</th><th>Thị trường</th><th>Loại phí</th><th>Đơn vị thụ hưởng</th><th>Số tiền</th><th>Đã thanh toán</th><th>Còn nợ</th><th>Trạng thái</th>{canCreatePay && <th></th>}</tr></thead>
              <tbody>
                {filteredFees.length === 0 ? (
                  <tr><td colSpan={9} style={{ textAlign: "center", color: C.textMuted, padding: 30 }}>Không có khoản phí nào</td></tr>
                ) : filteredFees.map((f, idx) => (
                  <tr key={idx}>
                    <td style={{ color: C.green600, fontWeight: 600, fontSize: 12 }}>{f.shipmentId}</td>
                    <td><Badge label={f.market} color={C.blue} /></td>
                    <td style={{ fontSize: 12, fontWeight: 600 }}>{f.type}</td>
                    <td style={{ fontSize: 12 }}>{f.payee || <span style={{ color: C.textLight }}>-</span>}</td>
                    <td>
                      <div style={{ color: C.orange, fontWeight: 600 }}>{fmt(f.amount, f.currency)}</div>
                      <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(f.feeVND, "VND")}</div>
                    </td>
                    <td style={{ color: C.blue, fontWeight: 600 }}>
                      {fmt(f.paidVND, "VND")}
                      {f.paidCount > 0 && <div style={{ fontSize: 10, color: C.textMuted }}>{f.paidCount} lần</div>}
                    </td>
                    <td style={{ color: f.remainVND > 0 ? C.red : C.green600, fontWeight: 700 }}>{f.remainVND > 0 ? fmt(f.remainVND, "VND") : "0"}</td>
                    <td>
                      {f.status === "paid" ? <Badge label="✓ Đã thanh toán đủ" color={C.green500} />
                        : f.status === "partial" ? <Badge label="Thanh toán một phần" color={C.orange} />
                        : <Badge label="Chưa thanh toán" color={C.red} />}
                    </td>
                    {canCreatePay && (
                      <td>
                        {f.remainVND > 0 && <button className="btn btn-primary" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => openPayModal(f)}>+ Thanh toán</button>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* PAYEES */}
      {subTab === "payees" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead><tr><th>Đơn vị thụ hưởng</th><th>Số khoản</th><th>Tổng phí</th><th>Đã TT</th><th>Còn nợ</th></tr></thead>
            <tbody>
              {feesByPayee.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: "center", color: C.textMuted, padding: 30 }}>Chưa có dữ liệu</td></tr>
              ) : feesByPayee.map(([payee, data]) => (
                <tr key={payee}>
                  <td style={{ fontWeight: 600 }}>{payee}</td>
                  <td>{data.count}</td>
                  <td style={{ color: C.orange, fontWeight: 600 }}>{fmt(data.total, "VND")}</td>
                  <td style={{ color: C.blue, fontWeight: 600 }}>{fmt(data.paid, "VND")}</td>
                  <td style={{ color: data.remain > 0 ? C.red : C.green600, fontWeight: 700 }}>{fmt(data.remain, "VND")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PAYMENT HISTORY */}
      {subTab === "payments" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead><tr><th>Mã TT</th><th>Ngày</th><th>Lô hàng</th><th>Loại phí</th><th>Đơn vị thụ hưởng</th><th>Số tiền</th><th>Người TT</th><th>Ghi chú</th>{(canEditPay || canCancelPay) && <th></th>}</tr></thead>
            <tbody>
              {feePayments.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: "center", color: C.textMuted, padding: 30 }}>Chưa có thanh toán nào</td></tr>
              ) : sortByDateDesc(feePayments, "payDate", "id").map(p => {
                const sh = shipments.find(s => s.id === p.shipmentId);
                const fee = (sh?.fees || []).find(f => f.id === p.feeId);
                const isCancelled = p.status === "cancelled";
                const rowStyle = isCancelled ? { opacity: 0.55, textDecoration: "line-through" } : {};
                return (
                  <tr key={p.id} style={isCancelled ? { background: C.bg } : {}}>
                    <td style={{ color: C.green600, fontWeight: 600, fontSize: 12, ...rowStyle }}>
                      {p.id}
                      {isCancelled && <div style={{ fontSize: 9, color: C.red, fontWeight: 700, marginTop: 3, textDecoration: "none" }}>🚫 ĐÃ HỦY</div>}
                    </td>
                    <td style={{ fontSize: 12, ...rowStyle }}>{fmtDate(p.payDate)}</td>
                    <td style={{ fontSize: 12, fontWeight: 600, color: C.green600, ...rowStyle }}>{p.shipmentId}</td>
                    <td style={{ fontSize: 12, ...rowStyle }}>{fee?.type || "-"}</td>
                    <td style={{ fontSize: 12, ...rowStyle }}>{fee?.payee || "-"}</td>
                    <td style={{ fontWeight: 700, color: isCancelled ? C.textMuted : C.blue, ...rowStyle }}>{fmt(p.amount, p.currency)}</td>
                    <td style={{ fontSize: 12, ...rowStyle }}>{p.payer || "-"}</td>
                    <td style={{ fontSize: 11, color: C.textMuted, ...rowStyle }}>
                      {p.note || "-"}
                      {isCancelled && p.cancelReason && <div style={{ fontSize: 10, color: C.red, marginTop: 3, fontStyle: "italic", textDecoration: "none" }}>Lý do hủy: {p.cancelReason}</div>}
                    </td>
                    {(canEditPay || canCancelPay) && (
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          {!isCancelled && canEditPay && <button className="btn btn-ghost" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => setModal({ type: "editPay", data: p })}>Sửa</button>}
                          {!isCancelled && canCancelPay && <button className="btn btn-danger" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => setCancelDlg({ payment: p })}>Hủy</button>}
                          {isCancelled && isAdmin && <button className="btn btn-ghost" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => setModal({ type: "editPay", data: p })}>Sửa</button>}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal?.type === "pay" && (
        <FeePaymentForm fee={modal.fee} shipment={modal.shipment} existingPayments={modal.existing} settings={settings}
          onSave={f => { onAdd("feePayments", { id: `FPAY-${uid()}`, status: "active", ...f }); setModal(null); }}
          onClose={() => setModal(null)} />
      )}

      {/* v20: Modal sửa fee payment */}
      {modal?.type === "editPay" && (
        <FeePaymentEditForm initial={modal.data} shipments={shipments} settings={settings} isAdmin={isAdmin}
          onSave={f => { onEdit("feePayments", modal.data.id, { ...f, lastEditedBy: user?.fullName || user?.username, lastEditedAt: new Date().toISOString() }); setModal(null); }}
          onClose={() => setModal(null)} />
      )}

      {/* v20: Dialog hủy fee payment */}
      {cancelDlg && <PromptDialog title={`Hủy thanh toán phí ${cancelDlg.payment.id}?`}
        message="Sau khi hủy, thanh toán sẽ KHÔNG tính vào công nợ phí nhưng vẫn lưu để audit."
        placeholder="VD: Sai số tiền, chứng từ không khớp, trùng giao dịch..."
        confirmLabel="🚫 Xác nhận Hủy" required={true}
        onConfirm={(reason) => {
          onEdit("feePayments", cancelDlg.payment.id, {
            status: "cancelled",
            cancelReason: reason,
            cancelledBy: user?.fullName || user?.username,
            cancelledAt: new Date().toISOString(),
          });
          setCancelDlg(null);
        }}
        onClose={() => setCancelDlg(null)} />}
    </div>
  );
};

// v20: Form sửa thanh toán phí NK
const FeePaymentEditForm = ({ initial, shipments, settings, isAdmin, onSave, onClose }) => {
  const [form, setForm] = useState({ ...initial });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const sh = shipments.find(s => s.id === form.shipmentId);
  const fee = (sh?.fees || []).find(f => f.id === form.feeId);
  const lockHardFields = !isAdmin;

  return (
    <Modal title={`Sửa thanh toán phí ${initial.id}`} onClose={onClose} onSave={() => onSave(form)} width={620}>
      {!isAdmin && (
        <div className="alert alert-info" style={{ marginBottom: 12 }}>
          ℹ️ Bạn có thể sửa: số tiền, ngày, người TT, ghi chú. Để đổi lô hàng / loại phí: hãy <b>Hủy</b> và tạo mới.
        </div>
      )}
      <div className="form-grid">
        <div className="form-group"><label>Mã TT</label>
          <input value={form.id || ""} disabled />
        </div>
        <div className="form-group"><label>Lô hàng {lockHardFields && "🔒"}</label>
          <input value={form.shipmentId} disabled={lockHardFields} onChange={e => set("shipmentId", e.target.value)} />
        </div>
        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Loại phí · Đơn vị thụ hưởng</label>
          <input value={`${fee?.type || "—"} · ${fee?.payee || "—"}`} disabled />
        </div>
        <div className="form-group"><label>Số tiền *</label>
          <input type="number" min={0} value={form.amount || ""} onChange={e => set("amount", Number(e.target.value))} />
        </div>
        <div className="form-group"><label>Tiền tệ</label>
          <select value={form.currency || "VND"} onChange={e => set("currency", e.target.value)}>
            {["VND", "USD", "CNY", "THB", "MYR", "PHP"].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Ngày *</label>
          <input type="date" value={form.payDate || ""} onChange={e => set("payDate", e.target.value)} />
        </div>
        <div className="form-group"><label>Người thanh toán</label>
          <input value={form.payer || ""} onChange={e => set("payer", e.target.value)} />
        </div>
        {isAdmin && (
          <div className="form-group"><label>Trạng thái (admin)</label>
            <select value={form.status || "active"} onChange={e => set("status", e.target.value)}>
              <option value="active">Hoạt động</option>
              <option value="cancelled">Đã hủy</option>
            </select>
          </div>
        )}
        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Ghi chú</label>
          <textarea rows={2} value={form.note || ""} onChange={e => set("note", e.target.value)} />
        </div>
        {form.lastEditedAt && (
          <div className="form-group" style={{ gridColumn: "1/-1", fontSize: 11, color: C.textMuted, fontStyle: "italic" }}>
            Lần sửa cuối: {form.lastEditedBy || "—"} · {new Date(form.lastEditedAt).toLocaleString("vi-VN")}
          </div>
        )}
      </div>
    </Modal>
  );
};

// ============================================================
// WARRANTIES (v18) — Hàng TT gửi NM bảo hành
// ============================================================
const WARRANTY_STATUS_COLORS = {
  "Đang gửi NM": { color: C.orange, bg: C.orangeBg },
  "NM đang sửa": { color: C.purple, bg: C.purpleBg },
  "Đang trả về kho": { color: C.blue, bg: C.blueBg },
  "Đã trả về kho": { color: C.green600, bg: C.green50 },
  "Hủy": { color: C.red, bg: C.redBg },
};

const WarrantyForm = ({ initial, factories, markets, products, settings, onSave, onClose }) => {
  const marketNames = getMarketNames(markets);
  const defaultMarket = (initial?.marketFrom) || marketNames[0] || "Vietnam";
  const _whsOfDefault = getMarketWarehouses(defaultMarket, markets);
  const _initWhValid = initial?.warehouseFromId && _whsOfDefault.some(w => w.id === initial.warehouseFromId);
  const defaultWhId = _initWhValid ? initial.warehouseFromId : getDefaultWarehouseId(defaultMarket, markets);

  const [form, setForm] = useState(initial ? { ...initial, warehouseFromId: defaultWhId } : {
    id: "",
    marketFrom: defaultMarket,
    warehouseFromId: defaultWhId,
    factoryId: factories[0]?.id || "",
    sendDate: new Date().toISOString().slice(0, 10),
    returnDate: "",
    trackingOut: "",
    trackingBack: "",
    status: "Đang gửi NM",
    items: [],
    note: "",
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Auto chọn kho mặc định khi đổi thị trường
  useEffect(() => {
    if (!form.marketFrom) return;
    const whs = getMarketWarehouses(form.marketFrom, markets);
    if (whs.length > 0) {
      if (!form.warehouseFromId || !whs.some(w => w.id === form.warehouseFromId)) {
        setForm(p => ({ ...p, warehouseFromId: getDefaultWarehouseId(form.marketFrom, markets) }));
      }
    } else {
      if (form.warehouseFromId) setForm(p => ({ ...p, warehouseFromId: "" }));
    }
  }, [form.marketFrom, markets]); // eslint-disable-line

  const currentWarehouses = getMarketWarehouses(form.marketFrom, markets);

  const addItem = () => {
    // v38g: KHÔNG auto-fill SP đầu tiên — user phải tự chọn qua Combobox.
    setForm(p => ({ ...p, items: [...p.items, { productId: "", quantity: 1 }] }));
  };
  const updateItem = (idx, field, val) => set("items", form.items.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  const removeItem = (idx) => set("items", form.items.filter((_, i) => i !== idx));

  // Tính tổng giá trị (CNY) để hiển thị
  const totalValueCNY = useMemo(() => {
    return form.items.reduce((sum, it) => {
      const prod = products.find(p => p.id === it.productId);
      if (!prod) return sum;
      const valInProdCurrency = Number(it.quantity || 0) * Number(prod.unitPrice || 0);
      const valVND = toVND(valInProdCurrency, prod.currency || "CNY", settings);
      return sum + valVND / (settings.cnyToVnd || 1);
    }, 0);
  }, [form.items, products, settings]);
  const totalQty = form.items.reduce((s, it) => s + Number(it.quantity || 0), 0);

  // v38g: Tách validation thành errors[] để hiện rõ user
  const errors = [];
  if (!form.marketFrom) errors.push("Chọn thị trường gửi đi");
  if (!form.factoryId) errors.push("Chọn nhà máy nhận");
  if (!form.sendDate) errors.push("Chọn ngày gửi");
  if (form.items.length === 0) errors.push("Thêm ít nhất 1 sản phẩm");
  form.items.forEach((it, idx) => {
    if (!it.productId) errors.push(`Dòng ${idx + 1}: Chưa chọn sản phẩm`);
    if (!Number(it.quantity) || Number(it.quantity) <= 0) errors.push(`Dòng ${idx + 1}: Số lượng phải > 0`);
  });
  const isValid = errors.length === 0;
  const isPending = WARRANTY_PENDING_STATUSES.includes(form.status);

  const handleSave = () => {
    const id = form.id || `WR-${new Date().toISOString().slice(0,10).replace(/-/g, "")}-${uid().slice(-3).toUpperCase()}`;
    onSave({ ...form, id });
  };

  return (
    <Modal title={initial ? `Sửa lô bảo hành — ${form.id}` : "Tạo lô bảo hành mới"} onClose={onClose} onSave={handleSave} saveDisabled={!isValid} width={820}>
      <div className="form-grid">
        <div className="form-group"><label>🌍 Thị trường gửi đi *</label>
          <select value={form.marketFrom} onChange={e => set("marketFrom", e.target.value)}>
            {marketNames.map(m => <option key={m} value={m}>{getFlag(m)} {m}</option>)}
          </select>
        </div>
        <div className="form-group"><label>🏪 Kho gửi đi *</label>
          <select value={form.warehouseFromId} onChange={e => set("warehouseFromId", e.target.value)} disabled={currentWarehouses.length === 0}>
            {currentWarehouses.length === 0 ? <option value="">— Thị trường chưa có kho —</option> : currentWarehouses.map(w => <option key={w.id} value={w.id}>{w.name}{w.isDefault ? " ⭐" : ""}</option>)}
          </select>
        </div>
        <div className="form-group"><label>🏭 NM nhận bảo hành *</label>
          <select value={form.factoryId} onChange={e => set("factoryId", e.target.value)}>
            <option value="">— Chọn NM —</option>
            {factories.filter(f => f.status !== "stopped").map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Trạng thái *</label>
          <select value={form.status} onChange={e => set("status", e.target.value)}>
            {WARRANTY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {isPending && <div style={{ fontSize: 10, color: C.orange, marginTop: 3, fontStyle: "italic" }}>⚠ Trạng thái này sẽ "treo công nợ" thị trường tạm thời</div>}
        </div>
        <div className="form-group"><label>Ngày gửi *</label>
          <input type="date" value={form.sendDate} onChange={e => set("sendDate", e.target.value)} />
        </div>
        <div className="form-group"><label>Ngày trả về (nếu đã có)</label>
          <input type="date" value={form.returnDate} onChange={e => set("returnDate", e.target.value)} />
        </div>
        <div className="form-group"><label>Tracking gửi đi</label>
          <input value={form.trackingOut} onChange={e => set("trackingOut", e.target.value)} placeholder="Mã vận chuyển TT → NM" />
        </div>
        <div className="form-group"><label>Tracking nhận về</label>
          <input value={form.trackingBack} onChange={e => set("trackingBack", e.target.value)} placeholder="Mã vận chuyển NM → TT (nếu có)" />
        </div>
      </div>

      {/* Danh sách SP bảo hành */}
      <div style={{ padding: 14, background: C.green50, borderRadius: 12, border: `1px solid ${C.green200}`, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.green700 }}>📦 Sản phẩm bảo hành ({form.items.length})</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Tổng: {totalQty} SP · ≈ {fmt(totalValueCNY, "CNY")} ({fmt(toVND(totalValueCNY, "CNY", settings), "VND")})</div>
          </div>
          <button type="button" className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={addItem} disabled={form.items.length >= products.length}>+ Thêm SP</button>
        </div>
        {form.items.length === 0 && <div style={{ fontSize: 12, color: C.textMuted, textAlign: "center", padding: 10 }}>Chưa có SP nào. Bấm "+ Thêm SP" để bắt đầu.</div>}
        {form.items.map((it, idx) => {
          const prod = products.find(p => p.id === it.productId);
          const itemValueCNY = prod ? toVND(Number(it.quantity || 0) * Number(prod.unitPrice || 0), prod.currency || "CNY", settings) / (settings.cnyToVnd || 1) : 0;
          // v38e: Loại trừ SP đã chọn ở dòng khác (giữ SP của dòng hiện tại)
          const excludeKeys = form.items
            .filter((other, i) => i !== idx && other.productId)
            .map(other => other.productId);
          return (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "2fr 100px 140px 40px", gap: 8, marginBottom: 8, padding: 10, background: C.white, borderRadius: 10, alignItems: "center" }}>
              {/* v38e: Combobox tìm SP theo SKU/tên/tên TQ/danh mục */}
              <Combobox
                items={products}
                value={it.productId}
                onChange={(key) => updateItem(idx, "productId", key || "")}
                getKey={p => p.id}
                getLabel={p => `${p.sku} — ${p.name}`}
                getSearchText={p => `${p.sku || ""} ${p.name || ""} ${p.nameImport || ""} ${p.category || ""}`}
                placeholder="🔍 Tìm SP theo SKU / tên / tên TQ / danh mục..."
                excludeKeys={excludeKeys}
                emptyText="Chưa có SP nào trong hệ thống"
              />
              <NumberInput min="1" value={it.quantity} onChange={e => updateItem(idx, "quantity", e.target.value)} placeholder="SL" />
              <div style={{ fontSize: 11, color: C.textMuted, textAlign: "right" }}>≈ {fmt(itemValueCNY, "CNY")}</div>
              <button type="button" className="btn btn-danger" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => removeItem(idx)}>✕</button>
            </div>
          );
        })}
      </div>

      <div className="form-group" style={{ marginTop: 10 }}><label>Ghi chú (lý do bảo hành)</label>
        <textarea value={form.note} onChange={e => set("note", e.target.value)} placeholder="VD: Lỗi mic không ăn pin sau 1 tháng..." rows={3} />
      </div>

      {/* v38g: Hiển thị errors rõ ràng */}
      {errors.length > 0 && <div className="alert alert-danger" style={{ marginTop: 10 }}>{errors.map((e, i) => <div key={i}>• {e}</div>)}</div>}
    </Modal>
  );
};

const Warranties = ({ warranties = [], factories, markets, products, settings, onAdd, onEdit, onDelete, user }) => {
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState({ status: "", search: "", dateFrom: "", dateTo: "" });
  // v21: Dialog hủy
  const [cancelDlg, setCancelDlg] = useState(null);
  const canManage = can(user, "manage_shipment");
  const isAdmin = user?.role === "admin";

  const filtered = useMemo(() => {
    const matched = warranties.filter(w => {
      if (filter.status && w.status !== filter.status) return false;
      if (filter.dateFrom && w.sendDate && w.sendDate < filter.dateFrom) return false;
      if (filter.dateTo && w.sendDate && w.sendDate > filter.dateTo) return false;
      if (filter.search) {
        const q = filter.search.toLowerCase();
        const factory = factories.find(f => f.id === w.factoryId);
        if (!w.id.toLowerCase().includes(q) && !w.marketFrom.toLowerCase().includes(q) && !(factory?.name || "").toLowerCase().includes(q) && !(w.trackingOut || "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
    // v38b: Chuẩn hoá sort theo sendDate desc với tie-break ID (thay sort thuần theo sendDate)
    return sortByDateDesc(matched, "sendDate", "id");
  }, [warranties, filter, factories]);

  // v28: Pagination
  const { page, setPage, pageSize, setPageSize, paginatedItems: pagedFiltered } = usePagination(filtered, 50);

  // KPI
  const kpi = useMemo(() => {
    const pending = warranties.filter(w => WARRANTY_PENDING_STATUSES.includes(w.status));
    const totalQty = pending.reduce((s, w) => s + (w.items || []).reduce((ss, it) => ss + Number(it.quantity || 0), 0), 0);
    const totalValueCNY = pending.reduce((s, w) => {
      return s + (w.items || []).reduce((ss, it) => {
        const prod = products.find(p => p.id === it.productId);
        if (!prod) return ss;
        const v = Number(it.quantity || 0) * Number(prod.unitPrice || 0);
        return ss + toVND(v, prod.currency || "CNY", settings) / (settings.cnyToVnd || 1);
      }, 0);
    }, 0);
    const completed = warranties.filter(w => w.status === "Đã trả về kho").length;
    return { totalLots: warranties.length, pendingLots: pending.length, totalQty, totalValueCNY, completed };
  }, [warranties, products, settings]);

  return (
    <div>
      <SectionHeader title="Bảo hành"
        subtitle="Hàng TT gửi NM bảo hành · Khi đang ở 3 trạng thái: Đang gửi NM / NM đang sửa / Đang trả về kho → công nợ TT được treo tạm thời"
        action={canManage && <button className="btn btn-primary" onClick={() => setModal({ type: "new" })}>+ Tạo lô bảo hành</button>}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Tổng lô BH</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.green800 }}>{kpi.totalLots}</div>
          <div style={{ fontSize: 11, color: C.textLight, marginTop: 4 }}>Tất cả thời gian</div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Đang xử lý</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.orange }}>{kpi.pendingLots}</div>
          <div style={{ fontSize: 11, color: C.textLight, marginTop: 4 }}>3 trạng thái đầu</div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>SP đang BH</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.purple }}>{kpi.totalQty}</div>
          <div style={{ fontSize: 11, color: C.textLight, marginTop: 4 }}>Tổng SL chưa về kho</div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Đã hoàn tất</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.green600 }}>{kpi.completed}</div>
          <div style={{ fontSize: 11, color: C.textLight, marginTop: 4 }}>Đã trả về kho</div>
        </div>
      </div>

      {/* Filter */}
      <div className="card" style={{ padding: "12px 16px", marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input value={filter.search} onChange={e => setFilter(p => ({ ...p, search: e.target.value }))} placeholder="🔍 Tìm mã / TT / NM / tracking..." style={{ flex: 1, minWidth: 220 }} />
        <select value={filter.status} onChange={e => setFilter(p => ({ ...p, status: e.target.value }))} style={{ width: 170 }}>
          <option value="">Tất cả trạng thái</option>
          {WARRANTY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="date" value={filter.dateFrom} onChange={e => setFilter(p => ({ ...p, dateFrom: e.target.value }))} style={{ width: 150 }} title="Từ ngày gửi" />
        <input type="date" value={filter.dateTo} onChange={e => setFilter(p => ({ ...p, dateTo: e.target.value }))} style={{ width: 150 }} title="Đến ngày gửi" />
        {(filter.status || filter.search || filter.dateFrom || filter.dateTo) && (
          <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setFilter({ status: "", search: "", dateFrom: "", dateTo: "" })}>✕ Xóa lọc</button>
        )}
      </div>

      {/* Bảng */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead><tr><th>Mã lô BH</th><th>Thị trường + Kho</th><th>NM nhận</th><th>Ngày gửi</th><th>SL / Giá trị</th><th>Trạng thái</th><th>Tracking</th><th></th></tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: "center", color: C.textMuted, padding: 30 }}>Không có lô bảo hành nào</td></tr>
            ) : pagedFiltered.map(w => {
              const factory = factories.find(f => f.id === w.factoryId);
              const whName = w.warehouseFromId ? getWarehouseName(w.warehouseFromId, markets) : "";
              const totalQty = (w.items || []).reduce((s, it) => s + Number(it.quantity || 0), 0);
              const valueCNY = (w.items || []).reduce((s, it) => {
                const prod = products.find(p => p.id === it.productId);
                if (!prod) return s;
                const v = Number(it.quantity || 0) * Number(prod.unitPrice || 0);
                return s + toVND(v, prod.currency || "CNY", settings) / (settings.cnyToVnd || 1);
              }, 0);
              const isPending = WARRANTY_PENDING_STATUSES.includes(w.status);
              const isCancelled = w.status === "Hủy";
              const sc = WARRANTY_STATUS_COLORS[w.status] || { color: C.textMuted, bg: C.bg };
              const rowStyle = isCancelled ? { opacity: 0.55, textDecoration: "line-through" } : {};
              return (
                <tr key={w.id} style={isCancelled ? { background: C.bg } : {}}>
                  <td style={{ fontWeight: 700, color: C.green600, ...rowStyle }}>{w.id}</td>
                  <td style={rowStyle}>
                    <div style={{ fontWeight: 600, fontSize: 12 }}>{getFlag(w.marketFrom)} {w.marketFrom}</div>
                    <div style={{ fontSize: 11, color: C.textMuted }}>{whName || "—"}</div>
                  </td>
                  <td style={{ fontSize: 12, ...rowStyle }}>{factory?.name || "—"}</td>
                  <td style={{ fontSize: 12, ...rowStyle }}>
                    {fmtDate(w.sendDate)}
                    {w.returnDate && <div style={{ fontSize: 10, color: C.green600 }}>↩ {fmtDate(w.returnDate)}</div>}
                  </td>
                  <td style={rowStyle}>
                    <div style={{ fontWeight: 700, fontSize: 12 }}>{totalQty} SP · {(w.items || []).length} loại</div>
                    <div style={{ fontSize: 11, color: C.textMuted }}>≈ {fmt(valueCNY, "CNY")}</div>
                    <div style={{ fontSize: 10, color: C.textLight }}>≈ {fmt(toVND(valueCNY, "CNY", settings), "VND")}</div>
                  </td>
                  <td>
                    <Badge label={w.status} color={sc.color} bg={sc.bg} />
                    {isPending && <div style={{ fontSize: 9, color: C.orange, marginTop: 3, fontWeight: 600 }}>⚠ Treo công nợ TT</div>}
                    {isCancelled && w.cancelReason && <div style={{ fontSize: 9, color: C.red, marginTop: 3, fontStyle: "italic" }}>Lý do: {w.cancelReason}</div>}
                  </td>
                  <td style={{ fontSize: 11, ...rowStyle }}>
                    {w.trackingOut && <div>↗ {w.trackingOut}</div>}
                    {w.trackingBack && <div style={{ color: C.green600 }}>↙ {w.trackingBack}</div>}
                    {!w.trackingOut && !w.trackingBack && <span style={{ color: C.textLight }}>—</span>}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      {/* v21: Sửa với mọi trạng thái nếu admin; user thường chỉ sửa khi chưa kết thúc */}
                      {canManage && w.status !== "Hủy" && <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: w })}>Sửa</button>}
                      {isAdmin && w.status === "Hủy" && <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: w })}>Sửa</button>}
                      {/* v21: Hủy thay Xóa */}
                      {canManage && w.status !== "Hủy" && <button className="btn btn-danger" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setCancelDlg({ warranty: w })}>Hủy</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      {modal?.type === "new" && <WarrantyForm factories={factories} markets={markets} products={products} settings={settings}
        onSave={f => { onAdd("warranties", f); setModal(null); }}
        onClose={() => setModal(null)} />}
      {modal?.type === "edit" && <WarrantyForm initial={modal.data} factories={factories} markets={markets} products={products} settings={settings}
        onSave={f => { onEdit("warranties", modal.data.id, { ...f, lastEditedBy: user?.fullName || user?.username, lastEditedAt: new Date().toISOString() }); setModal(null); }}
        onClose={() => setModal(null)} />}

      {/* v21: Dialog hủy lô bảo hành */}
      {cancelDlg && <PromptDialog title={`Hủy lô bảo hành ${cancelDlg.warranty.id}?`}
        message={`Lô đang ở trạng thái "${cancelDlg.warranty.status}". Sau khi hủy, công nợ thị trường sẽ KHÔNG còn bị treo bởi lô này.`}
        placeholder="VD: NM không nhận, hàng quá hạn BH, sự cố vận chuyển..."
        confirmLabel="🚫 Xác nhận Hủy" required={true}
        onConfirm={(reason) => {
          onEdit("warranties", cancelDlg.warranty.id, {
            status: "Hủy",
            cancelReason: reason,
            cancelledBy: user?.fullName || user?.username,
            cancelledAt: new Date().toISOString(),
          });
          setCancelDlg(null);
        }}
        onClose={() => setCancelDlg(null)} />}
    </div>
  );
};

// ============================================================
// INVENTORY (v23) — Quản lý tồn kho theo SP × Kho
// ============================================================
// ============================================================
// v38j: InventoryAlertView — Bảng cảnh báo & đề xuất vận hành
// ============================================================
// Bảng 12 cột với 5 trạng thái + 2 cột đề xuất tự tính.
// Dùng helpers: calcReceivedQty, calcAtFactoryQty, calcInTransitQty,
//   calcStockOnHandQty, calcThresholds, calcInventoryStatus,
//   calcSuggestShipQty, calcSuggestPOQty.
// Chia 3 mode hiển thị theo bộ lọc:
//   - Toàn cầu: gộp tất cả kho (mức nguy hiểm nhất)
//   - Theo TT: gộp các kho thuộc TT
//   - Theo Kho: trực tiếp 1 kho
const InventoryAlertView = ({
  products, pos, shipments, stockOnHand, markets, settings,
  allWarehouses, filter, setFilter,
  onUpsertStockOnHand, onPrefillCreatePO, onPrefillCreateShipment,
  onUpdateProductTargets, user,
}) => {
  const [statusFilter, setStatusFilter] = useState(""); // "" | status.id | "to_handle"
  const [stockUpdateModal, setStockUpdateModal] = useState(null); // { product, warehouseId, market }

  // Tính 1 row cho 1 SP × 1 phạm vi (kho/TT/toàn cầu) trong 1 mode
  const calcRow = (product, scope) => {
    // scope: { mode: "wh"|"tt"|"global", warehouseId?, market? }
    const filterScope = {};
    if (scope.warehouseId) filterScope.warehouseId = scope.warehouseId;
    else if (scope.market) filterScope.market = scope.market;

    const stockInWarehouse = calcStockOnHandQty(product.id, stockOnHand, filterScope);
    const inTransit = calcInTransitQty(product.id, shipments, pos, filterScope);
    const received = calcReceivedQty(product.id, shipments, pos, filterScope);
    // Tồn ở NCC: gắn theo TT (vì PO không có warehouseId)
    const atFactory = calcAtFactoryQty(product.id, pos, shipments);

    const thresholds = calcThresholds(product, allWarehouses, filterScope);
    const leadTime = Number(product.thoiGianSanXuat || 0) + Number(product.thoiGianVanChuyen || 0);

    const statusInput = {
      stockInWarehouse, inTransit, atFactory,
      tonAnToan: thresholds.tonAnToan,
      slBanNgay: thresholds.slBanNgay,
      leadTimeDays: leadTime,
      khongTheoDoi: thresholds.khongTheoDoi,
    };
    const status = calcInventoryStatus(statusInput);

    const suggestSH = calcSuggestShipQty({
      stockInWarehouse, inTransit, atFactory, tonAnToan: thresholds.tonAnToan,
    });
    const suggestPO = calcSuggestPOQty({
      stockInWarehouse, inTransit, atFactory,
      slBanNgay: thresholds.slBanNgay,
      soNgayDuKienBan: Number(product.soNgayDuKienBan || 0),
      leadTimeDays: leadTime,
    });

    return {
      product, scope, received, atFactory, inTransit, stockInWarehouse,
      tonAnToan: thresholds.tonAnToan,
      slBanNgay: thresholds.slBanNgay,
      khongTheoDoi: thresholds.khongTheoDoi,
      leadTime, status, suggestSH, suggestPO,
    };
  };

  // Build rows theo mode hiện tại
  const rows = useMemo(() => {
    const result = [];
    const mode = filter.warehouseId ? "wh" : (filter.market ? "tt" : "global");

    products.forEach(p => {
      // Filter search
      if (filter.search) {
        const q = filter.search.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return;
      }

      let row;
      if (mode === "wh") {
        row = calcRow(p, { mode, warehouseId: filter.warehouseId });
      } else if (mode === "tt") {
        // Mode TT: tính cho TT (gộp các kho thuộc TT)
        row = calcRow(p, { mode, market: filter.market });
        // Tính trạng thái nguy hiểm nhất trong các kho thuộc TT để override
        const subWh = allWarehouses.filter(w => w.marketName === filter.market);
        let worstStatus = INVENTORY_STATUS.IGNORE;
        const subRows = [];
        subWh.forEach(w => {
          const sub = calcRow(p, { mode: "wh", warehouseId: w.id });
          subRows.push(sub);
          if (sub.status.priority < worstStatus.priority) worstStatus = sub.status;
        });
        row.status = worstStatus;
        row.subRows = subRows.filter(s => !s.khongTheoDoi);
      } else {
        // Mode global: trạng thái nguy hiểm nhất trong tất cả kho theo dõi
        row = calcRow(p, { mode });
        let worstStatus = INVENTORY_STATUS.IGNORE;
        const subRows = [];
        allWarehouses.forEach(w => {
          const sub = calcRow(p, { mode: "wh", warehouseId: w.id });
          subRows.push(sub);
          if (sub.status.priority < worstStatus.priority) worstStatus = sub.status;
        });
        row.status = worstStatus;
        row.subRows = subRows.filter(s => !s.khongTheoDoi);
      }

      // Filter trạng thái
      if (statusFilter === "to_handle") {
        if (row.status.id !== "urgent_po" && row.status.id !== "need_ship") return;
      } else if (statusFilter && row.status.id !== statusFilter) {
        return;
      }

      result.push(row);
    });

    // Sort by status priority
    result.sort((a, b) => {
      if (a.status.priority !== b.status.priority) return a.status.priority - b.status.priority;
      return (a.product.sku || "").localeCompare(b.product.sku || "");
    });

    return result;
  }, [products, pos, shipments, stockOnHand, allWarehouses, filter, statusFilter]);

  // KPI tổng hợp
  const kpi = useMemo(() => {
    const counts = { urgent_po: 0, need_ship: 0, coming: 0, enough: 0, ignore: 0 };
    rows.forEach(r => { counts[r.status.id]++; });
    return counts;
  }, [rows]);

  const mode = filter.warehouseId ? "wh" : (filter.market ? "tt" : "global");
  const modeLabel = mode === "wh" ? "Theo Kho" : mode === "tt" ? "Theo Thị trường" : "Toàn cầu";

  return (
    <div>
      <div className="alert alert-info" style={{ marginBottom: 14, fontSize: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <b>🚨 Bảng cảnh báo & đề xuất vận hành</b> ({modeLabel}) — sử dụng <b>bộ lọc TT/Kho ở trên</b> để chuyển mode hiển thị.
          <div style={{ marginTop: 4, fontSize: 11 }}>
            💡 Trạng thái dựa vào: tồn kho thực + hàng đi đường + tồn ở NCC + ngưỡng cảnh báo + thời gian SX/VC. Bấm vào ô đề xuất để mở form tạo SH/PO với SL prefill.
          </div>
        </div>
        <button
          className="btn btn-ghost"
          style={{ padding: "6px 12px", fontSize: 12, whiteSpace: "nowrap" }}
          onClick={async () => {
            try {
              await exportInventoryAlertReport({
                products, pos, shipments, stockOnHand, markets, settings,
                exportedBy: user?.fullName || user?.username || "",
              });
            } catch (e) {
              console.error("Export error:", e);
            }
          }}
        >📥 Xuất báo cáo Excel</button>
      </div>

      {/* KPI 5 trạng thái */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 14 }}>
        {Object.values(INVENTORY_STATUS).map(s => (
          <div key={s.id} className="card" style={{ padding: 12, cursor: "pointer", border: statusFilter === s.id ? `2px solid ${s.color}` : `1px solid ${C.border}` }}
            onClick={() => setStatusFilter(statusFilter === s.id ? "" : s.id)}>
            <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>{s.icon} {s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, marginTop: 4 }}>{kpi[s.id]}</div>
          </div>
        ))}
      </div>
      {/* Quick filter "Cần xử lý" */}
      <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          className={"btn " + (statusFilter === "to_handle" ? "btn-primary" : "btn-ghost")}
          style={{ fontSize: 12 }}
          onClick={() => setStatusFilter(statusFilter === "to_handle" ? "" : "to_handle")}
        >⚠️ Chỉ hiện "Cần xử lý" ({kpi.urgent_po + kpi.need_ship})</button>
        {statusFilter && (
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => setStatusFilter("")}>✕ Xóa filter trạng thái</button>
        )}
      </div>

      {/* Bảng 12 cột */}
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table style={{ minWidth: 1400 }}>
          <thead>
            <tr>
              <th style={{ width: 90 }}>SKU</th>
              <th style={{ minWidth: 180 }}>Tên SP</th>
              <th style={{ textAlign: "right", width: 90 }}>Hàng đã nhập</th>
              <th style={{ textAlign: "right", width: 100 }}>Tồn ở NCC <span title="Tổng PO duyệt − tổng đã ship. Gắn theo TT (vì PO không có warehouseId)." style={{ cursor: "help", color: C.textMuted, fontWeight: 400 }}>ⓘ</span></th>
              <th style={{ textAlign: "right", width: 90 }}>Hàng đi đường</th>
              <th style={{ textAlign: "right", width: 100 }}>Tồn trong kho <span title="Số lượng thực tế chị nhập tay. App KHÔNG tự cộng từ shipments." style={{ cursor: "help", color: C.textMuted, fontWeight: 400 }}>ⓘ</span></th>
              <th style={{ textAlign: "right", width: 100 }}>Ngưỡng cảnh báo</th>
              <th style={{ textAlign: "right", width: 130 }}>Đề xuất tạo SH <span title="= Ngưỡng − Tồn kho − Đi đường, cắt theo Tồn NCC. Bấm để tạo SH với SL prefill." style={{ cursor: "help", color: C.textMuted, fontWeight: 400 }}>ⓘ</span></th>
              <th style={{ textAlign: "right", width: 130 }}>Đề xuất đặt PO <span title="= SL bán/ngày × Số ngày dự kiến bán − (Tồn kho + Đi đường + NCC). Bấm để tạo PO với SL prefill." style={{ cursor: "help", color: C.textMuted, fontWeight: 400 }}>ⓘ</span></th>
              <th style={{ width: 140 }}>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: "center", color: C.textMuted, padding: 30 }}>
                Không có SP nào khớp bộ lọc. Thử bỏ filter trạng thái hoặc cấu hình tồn an toàn cho SP.
              </td></tr>
            )}
            {rows.map(r => {
              const st = r.status;
              const isUrgent = st.id === "urgent_po";
              const isNeedShip = st.id === "need_ship";
              const showSubrowHint = (mode === "global" || mode === "tt") && r.subRows && r.subRows.length > 1;
              return (
                <tr key={r.product.id} style={{ background: isUrgent ? "#FEF2F2" : isNeedShip ? "#FFFBEB" : "transparent" }}>
                  <td style={{ fontWeight: 700, color: C.green600, fontSize: 12 }}>{r.product.sku}</td>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{r.product.name}</div>
                    {showSubrowHint && (
                      <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>
                        ⚠️ Tổng hợp các kho — bấm trạng thái để xem chi tiết
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 12, color: C.green700, fontWeight: 600 }}>+{r.received.toLocaleString()}</td>
                  <td style={{ textAlign: "right", fontSize: 12, color: C.purple, fontWeight: 600 }}>
                    {r.atFactory.toLocaleString()}
                    {mode === "wh" && <div style={{ fontSize: 9, color: C.textMuted, fontWeight: 400 }}>(chung TT)</div>}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 12, color: C.blue, fontWeight: 600 }}>{r.inTransit.toLocaleString()}</td>
                  <td style={{ textAlign: "right", fontSize: 13, color: C.text, fontWeight: 700 }}>
                    {mode === "wh" ? (
                      <button
                        className="btn btn-ghost"
                        style={{ padding: "4px 10px", fontSize: 12, fontWeight: 700, borderColor: C.border }}
                        onClick={() => setStockUpdateModal({
                          productId: r.product.id,
                          warehouseId: filter.warehouseId,
                          market: filter.market,
                          quantity: r.stockInWarehouse,
                        })}
                        title="Bấm để cập nhật tồn kho thủ công"
                      >{r.stockInWarehouse.toLocaleString()} ✏️</button>
                    ) : (
                      <span>{r.stockInWarehouse.toLocaleString()}</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 12, color: C.textMuted }}>
                    {r.khongTheoDoi ? "—" : r.tonAnToan.toLocaleString()}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 12 }}>
                    {r.suggestSH.qty > 0 ? (
                      <button
                        className="btn"
                        style={{ padding: "4px 10px", fontSize: 12, fontWeight: 700, background: C.orangeBg, color: C.orange, borderColor: C.orange }}
                        title={r.suggestSH.reason || `Bấm để tạo SH với SL = ${r.suggestSH.qty}`}
                        onClick={() => onPrefillCreateShipment?.({
                          productId: r.product.id,
                          factoryId: r.product.factoryId,
                          quantity: r.suggestSH.qty,
                          warehouseId: filter.warehouseId || undefined,
                          market: filter.market || undefined,
                        })}
                      >+{r.suggestSH.qty.toLocaleString()}</button>
                    ) : (
                      <span style={{ color: C.textMuted, fontSize: 11 }}>{r.suggestSH.reason || "—"}</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 12 }}>
                    {r.suggestPO.qty > 0 ? (
                      <div>
                        <button
                          className="btn"
                          style={{ padding: "4px 10px", fontSize: 12, fontWeight: 700, background: C.redBg, color: C.red, borderColor: C.red }}
                          title={r.suggestPO.reason || `Bấm để tạo PO với SL = ${r.suggestPO.qty}`}
                          onClick={() => onPrefillCreatePO?.({
                            productId: r.product.id,
                            factoryId: r.product.factoryId,
                            quantity: r.suggestPO.qty,
                          })}
                        >+{r.suggestPO.qty.toLocaleString()}</button>
                        {r.suggestPO.reason && r.suggestPO.reason.startsWith("⚠️") && (
                          <div style={{ fontSize: 9, color: C.red, marginTop: 3, fontWeight: 600 }}>{r.suggestPO.reason}</div>
                        )}
                      </div>
                    ) : r.suggestPO.qty === -1 ? (
                      <span style={{ color: C.textMuted, fontSize: 10 }} title={r.suggestPO.reason}>⚙️ Cần cấu hình</span>
                    ) : (
                      <span style={{ color: C.textMuted, fontSize: 11 }}>—</span>
                    )}
                  </td>
                  <td>
                    <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, color: st.color, background: `${st.color}15`, border: `1px solid ${st.color}` }}>
                      {st.icon} {st.label}
                    </span>
                    {showSubrowHint && (
                      <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>
                        {r.subRows.filter(s => s.status.priority <= 2).map(s => {
                          const wh = allWarehouses.find(w => w.id === s.scope.warehouseId);
                          return wh ? (
                            <div key={s.scope.warehouseId}>
                              <span style={{ cursor: "pointer", textDecoration: "underline" }}
                                onClick={() => setFilter(prev => ({ ...prev, market: wh.marketName, warehouseId: wh.id }))}
                              >{s.status.icon} {wh.name}</span>
                            </div>
                          ) : null;
                        })}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal cập nhật tồn kho thủ công */}
      {stockUpdateModal && (
        <StockOnHandForm
          initial={(() => {
            // Tìm record StockOnHand hiện có
            const existing = (stockOnHand || []).find(s =>
              s.productId === stockUpdateModal.productId &&
              s.warehouseId === stockUpdateModal.warehouseId
            );
            return existing || stockUpdateModal;
          })()}
          products={products}
          markets={markets}
          onSave={(form) => {
            onUpsertStockOnHand?.(form);
            setStockUpdateModal(null);
          }}
          onClose={() => setStockUpdateModal(null)}
        />
      )}
    </div>
  );
};

const Inventory = ({ products, openingStock = [], stockMovements = [], stockImportBatches = [], stockOnHand = [], pos = [], shipments = [], markets = [], settings, onImportSave, onCancelBatch, onUpsertStockOnHand, onBulkUpdateStockOnHand, onPrefillCreatePO, onPrefillCreateShipment, onUpdateProductTargets, user }) => {
  const [subTab, setSubTab] = useState("overview"); // overview | history
  const [filter, setFilter] = useState({
    market: "",         // "" = tất cả thị trường
    warehouseId: "",    // "" = tất cả kho (theo thị trường đã chọn)
    search: "",         // SKU / tên SP
    status: "",         // "" / "negative" / "low" / "normal"
    dateFrom: "",
    dateTo: "",
  });
  const [detailProduct, setDetailProduct] = useState(null);
  // v23b: Modal import + cancel batch
  const [importModal, setImportModal] = useState(null);
  const [cancelBatchDlg, setCancelBatchDlg] = useState(null);
  // v30: Modal xuất báo cáo Excel
  const [exportModal, setExportModal] = useState(null);
  const [exporting, setExporting] = useState(false);
  // v36: ConfirmDialog state để thay alert() khi xuất file lỗi
  const [confirmDlg, setConfirmDlg] = useState(null);

  const canImport = can(user, "edit_shipment"); // tạm dùng quyền edit_shipment cho import
  const canExport = can(user, "export_accounting_report") || can(user, "view_reports");
  const isAdmin = user?.role === "admin";

  // Tất cả warehouses dạng phẳng — kèm marketName + marketId
  const allWarehouses = useMemo(() => {
    const out = [];
    (markets || []).forEach(m => {
      (m.warehouses || []).forEach(w => {
        out.push({ ...w, marketName: m.name, marketId: m.id });
      });
    });
    return out;
  }, [markets]);

  // Warehouses theo thị trường hiện đang lọc (để dropdown kho lọc theo)
  const visibleWarehouses = useMemo(() => {
    if (!filter.market) return allWarehouses;
    return allWarehouses.filter(w => w.marketName === filter.market);
  }, [allWarehouses, filter.market]);

  // Tính toán dữ liệu hiển thị bảng
  // Logic:
  // - Nếu chọn 1 kho cụ thể: 1 dòng = 1 SP × kho đó
  // - Nếu chọn 1 thị trường (không chọn kho): 1 dòng = 1 SP, gộp tất cả kho thuộc thị trường
  // - Nếu không chọn gì: 1 dòng = 1 SP, gộp tất cả kho
  const rows = useMemo(() => {
    const result = [];
    let targetWhs = allWarehouses;
    if (filter.market) targetWhs = targetWhs.filter(w => w.marketName === filter.market);
    if (filter.warehouseId) targetWhs = targetWhs.filter(w => w.id === filter.warehouseId);

    products.forEach(p => {
      // Search filter
      if (filter.search) {
        const q = filter.search.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return;
      }

      if (filter.warehouseId) {
        // 1 dòng cho 1 SP × 1 kho cụ thể
        const wh = targetWhs[0];
        if (!wh) return;
        const period = calcStockInPeriod(p.id, wh.id, openingStock, stockMovements, filter.dateFrom, filter.dateTo);
        const threshold = getStockThreshold(p, wh.id);
        const status = classifyStockStatus(period.onHand, threshold);
        if (filter.status && status !== filter.status) return;
        result.push({
          product: p, warehouseId: wh.id, warehouseName: wh.name, marketName: wh.marketName,
          ...period, threshold, status, isAggregate: false,
        });
      } else {
        // Gộp các kho thuộc filter — tổng hợp
        let agg = { opening: 0, totalIn: 0, totalOut: 0, onHand: 0 };
        let totalThreshold = 0;
        targetWhs.forEach(wh => {
          const period = calcStockInPeriod(p.id, wh.id, openingStock, stockMovements, filter.dateFrom, filter.dateTo);
          agg.opening += period.opening;
          agg.totalIn += period.totalIn;
          agg.totalOut += period.totalOut;
          agg.onHand += period.onHand;
          totalThreshold += getStockThreshold(p, wh.id);
        });
        // Trạng thái dùng tổng ngưỡng tổng tồn
        const status = classifyStockStatus(agg.onHand, totalThreshold);
        if (filter.status && status !== filter.status) return;
        // Bỏ dòng nếu SP không có activity (đầu kỳ + nhập + xuất + ngưỡng đều = 0)
        if (agg.opening === 0 && agg.totalIn === 0 && agg.totalOut === 0 && totalThreshold === 0) return;
        result.push({
          product: p, warehouseId: null, warehouseName: null, marketName: filter.market || null,
          ...agg, threshold: totalThreshold, status, isAggregate: true,
        });
      }
    });

    // Sắp xếp: âm trước, dưới ngưỡng, bình thường
    const order = { negative: 0, low: 1, normal: 2 };
    result.sort((a, b) => {
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return a.product.sku.localeCompare(b.product.sku);
    });
    return result;
  }, [products, openingStock, stockMovements, allWarehouses, filter]);

  // KPI tổng
  const kpi = useMemo(() => {
    let totalOnHand = 0, negativeCount = 0, lowCount = 0, normalCount = 0;
    rows.forEach(r => {
      totalOnHand += r.onHand;
      if (r.status === "negative") negativeCount++;
      else if (r.status === "low") lowCount++;
      else normalCount++;
    });
    return { totalRows: rows.length, totalOnHand, negativeCount, lowCount, normalCount };
  }, [rows]);

  return (
    <div>
      <SectionHeader title="Tồn kho"
        subtitle="Quản lý tồn kho từng SP × kho · Đầu kỳ + nhập (từ đơn giao hàng) − xuất (gửi BH, bán hàng) = tồn hiện tại · Cảnh báo khi dưới ngưỡng cấu hình ở SP"
        action={(
          <div style={{ display: "flex", gap: 8 }}>
            {canExport && <button className="btn btn-ghost" onClick={() => setExportModal({})}>📥 Xuất báo cáo</button>}
            {canImport && <button className="btn btn-primary" onClick={() => setImportModal({})}>📥 Import tồn kho</button>}
          </div>
        )}
      />

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, borderBottom: `1px solid ${C.borderLight}` }}>
        <button onClick={() => setSubTab("overview")} className="btn btn-ghost" style={{ padding: "8px 14px", fontSize: 13, fontWeight: subTab === "overview" ? 700 : 500, borderBottom: subTab === "overview" ? `2px solid ${C.green600}` : "2px solid transparent", borderRadius: 0, color: subTab === "overview" ? C.green700 : C.textMuted }}>📊 Tổng quan</button>
        <button onClick={() => setSubTab("alert")} className="btn btn-ghost" style={{ padding: "8px 14px", fontSize: 13, fontWeight: subTab === "alert" ? 700 : 500, borderBottom: subTab === "alert" ? `2px solid ${C.green600}` : "2px solid transparent", borderRadius: 0, color: subTab === "alert" ? C.green700 : C.textMuted }}>🚨 Cảnh báo & Đề xuất <span style={{ fontSize: 10, marginLeft: 4, color: C.orange }}>(V38j)</span></button>
        <button onClick={() => setSubTab("history")} className="btn btn-ghost" style={{ padding: "8px 14px", fontSize: 13, fontWeight: subTab === "history" ? 700 : 500, borderBottom: subTab === "history" ? `2px solid ${C.green600}` : "2px solid transparent", borderRadius: 0, color: subTab === "history" ? C.green700 : C.textMuted }}>📜 Lịch sử Import {stockImportBatches.length > 0 && <span style={{ fontSize: 10, marginLeft: 4 }}>({stockImportBatches.length})</span>}</button>
      </div>

      {subTab === "overview" && (
        <div className="alert alert-info" style={{ marginBottom: 14, fontSize: 12 }}>
          💡 <b>Tồn kho tính tự động</b> từ đơn giao hàng "Đã về kho" (+) và bảo hành (−). Để khớp thực tế sau bán hàng → bấm <b>"📥 Import tồn kho"</b> ở góc phải, chọn kho, upload Excel từ Nhanh.vn / Pancake / Template CRM.
        </div>
      )}

      {subTab === "history" && (
        <ImportHistoryPanel
          batches={stockImportBatches}
          stockMovements={stockMovements}
          openingStock={openingStock}
          markets={markets}
          isAdmin={isAdmin}
          onCancelBatch={(b) => setCancelBatchDlg({ batch: b })}
        />
      )}

      {subTab === "overview" && <></>}{/* Placeholder để Fragment scope đúng */}

      {/* Phần Tổng quan — chỉ hiện ở overview tab */}
      {subTab === "overview" && (
        <>
      {/* KPI */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Tổng SP</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.green800 }}>{kpi.totalRows}</div>
          <div style={{ fontSize: 11, color: C.textLight, marginTop: 4 }}>Theo bộ lọc hiện tại</div>
        </div>
        <div className="card" style={{ padding: 14, borderLeft: `4px solid ${C.red}` }}>
          <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>🔴 Tồn âm</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.red }}>{kpi.negativeCount}</div>
          <div style={{ fontSize: 11, color: C.textLight, marginTop: 4 }}>Cần kiểm kê ngay</div>
        </div>
        <div className="card" style={{ padding: 14, borderLeft: `4px solid ${C.orange}` }}>
          <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>⚠ Dưới ngưỡng</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.orange }}>{kpi.lowCount}</div>
          <div style={{ fontSize: 11, color: C.textLight, marginTop: 4 }}>Sắp hết hàng</div>
        </div>
        <div className="card" style={{ padding: 14, borderLeft: `4px solid ${C.green600}` }}>
          <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>✅ Bình thường</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.green600 }}>{kpi.normalCount}</div>
          <div style={{ fontSize: 11, color: C.textLight, marginTop: 4 }}>Tổng tồn: {kpi.totalOnHand.toLocaleString()}</div>
        </div>
      </div>

      {/* Filter */}
      <div className="card" style={{ padding: "12px 16px", marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input value={filter.search} onChange={e => setFilter(p => ({ ...p, search: e.target.value }))} placeholder="🔍 Tìm SKU / Tên SP..." style={{ flex: 1, minWidth: 220 }} />
        <select value={filter.market} onChange={e => setFilter(p => ({ ...p, market: e.target.value, warehouseId: "" }))} style={{ width: 170 }}>
          <option value="">Tất cả thị trường</option>
          {markets.map(m => <option key={m.id} value={m.name}>{getFlag(m.name)} {m.name}</option>)}
        </select>
        <select value={filter.warehouseId} onChange={e => setFilter(p => ({ ...p, warehouseId: e.target.value }))} style={{ width: 200 }} disabled={visibleWarehouses.length === 0}>
          <option value="">Tất cả kho</option>
          {visibleWarehouses.map(w => <option key={w.id} value={w.id}>{w.isDefault ? "⭐ " : ""}{w.name}{!filter.market ? ` (${w.marketName})` : ""}</option>)}
        </select>
        <select value={filter.status} onChange={e => setFilter(p => ({ ...p, status: e.target.value }))} style={{ width: 160 }}>
          <option value="">Tất cả trạng thái</option>
          <option value="negative">🔴 Tồn âm</option>
          <option value="low">⚠ Dưới ngưỡng</option>
          <option value="normal">✅ Bình thường</option>
        </select>
        <DateRangeFilter from={filter.dateFrom} to={filter.dateTo}
          onFromChange={v => setFilter(p => ({ ...p, dateFrom: v }))}
          onToChange={v => setFilter(p => ({ ...p, dateTo: v }))}
          onReset={() => setFilter(p => ({ ...p, dateFrom: "", dateTo: "" }))} />
        {(filter.search || filter.market || filter.warehouseId || filter.status || filter.dateFrom || filter.dateTo) && (
          <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: 12 }}
            onClick={() => setFilter({ market: "", warehouseId: "", search: "", status: "", dateFrom: "", dateTo: "" })}>
            ✕ Xóa lọc
          </button>
        )}
      </div>

      {/* Bảng */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Tên SP</th>
              {filter.warehouseId && <th>Kho</th>}
              <th style={{ textAlign: "right" }}>Đầu kỳ</th>
              <th style={{ textAlign: "right" }}>Nhập kỳ</th>
              <th style={{ textAlign: "right" }}>Xuất kỳ</th>
              <th style={{ textAlign: "right" }}>Tồn hiện tại</th>
              <th style={{ textAlign: "right" }}>Ngưỡng cảnh báo</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={filter.warehouseId ? 9 : 8} style={{ textAlign: "center", color: C.textMuted, padding: 30 }}>
                Không có SP nào khớp bộ lọc, hoặc chưa có biến động tồn kho.
              </td></tr>
            ) : rows.map((r, idx) => {
              const colorByStatus = r.status === "negative" ? C.red : r.status === "low" ? C.orange : C.green600;
              const bgByStatus = r.status === "negative" ? "#fef2f2" : r.status === "low" ? "#fff7ed" : "transparent";
              return (
                <tr key={`${r.product.id}-${r.warehouseId || "all"}-${idx}`} style={{ background: bgByStatus, cursor: "pointer" }}
                  onClick={() => setDetailProduct(r.product)}>
                  <td style={{ fontWeight: 700, color: C.green600 }}>{r.product.sku}</td>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{r.product.name}</div>
                    {r.isAggregate && filter.market && <div style={{ fontSize: 10, color: C.textMuted }}>Gộp {filter.market}</div>}
                    {r.isAggregate && !filter.market && <div style={{ fontSize: 10, color: C.textMuted }}>Gộp tất cả kho</div>}
                  </td>
                  {filter.warehouseId && (
                    <td style={{ fontSize: 12 }}>
                      <div style={{ fontWeight: 600 }}>{r.warehouseName}</div>
                      <div style={{ fontSize: 10, color: C.textMuted }}>{getFlag(r.marketName)} {r.marketName}</div>
                    </td>
                  )}
                  <td style={{ textAlign: "right", fontSize: 12, color: C.textMuted }}>{r.opening.toLocaleString()}</td>
                  <td style={{ textAlign: "right", fontSize: 12, color: C.green700, fontWeight: 600 }}>+{r.totalIn.toLocaleString()}</td>
                  <td style={{ textAlign: "right", fontSize: 12, color: C.red, fontWeight: 600 }}>−{r.totalOut.toLocaleString()}</td>
                  <td style={{ textAlign: "right", fontWeight: 800, fontSize: 15, color: colorByStatus }}>{r.onHand.toLocaleString()}</td>
                  <td style={{ textAlign: "right", fontSize: 12, color: C.textMuted }}>{r.threshold > 0 ? r.threshold.toLocaleString() : "—"}</td>
                  <td>
                    <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, color: colorByStatus, background: bgByStatus, border: `1px solid ${colorByStatus}` }}>
                      {STOCK_STATUS_LABELS[r.status]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Chi tiết SP — modal hiển thị tồn kho theo từng thị trường + kho */}
      {detailProduct && <InventoryDetailModal
        product={detailProduct}
        markets={markets}
        openingStock={openingStock}
        stockMovements={stockMovements}
        dateFrom={filter.dateFrom}
        dateTo={filter.dateTo}
        onClose={() => setDetailProduct(null)} />}
        </>
      )}

      {/* v38j: Sub-tab Cảnh báo & Đề xuất — Bảng vận hành thời điểm */}
      {subTab === "alert" && (
        <InventoryAlertView
          products={products}
          pos={pos}
          shipments={shipments}
          stockOnHand={stockOnHand}
          markets={markets}
          settings={settings}
          allWarehouses={allWarehouses}
          filter={filter}
          setFilter={setFilter}
          onUpsertStockOnHand={onUpsertStockOnHand}
          onBulkUpdateStockOnHand={onBulkUpdateStockOnHand}
          onPrefillCreatePO={onPrefillCreatePO}
          onPrefillCreateShipment={onPrefillCreateShipment}
          onUpdateProductTargets={onUpdateProductTargets}
          user={user}
        />
      )}

      {/* v23b: Import modal */}
      {importModal && (
        <ImportStockModal
          markets={markets}
          products={products}
          openingStock={openingStock}
          stockMovements={stockMovements}
          defaultWarehouseId={filter.warehouseId}
          onSave={(payload) => { onImportSave(payload); setImportModal(null); setSubTab("history"); }}
          onClose={() => setImportModal(null)}
        />
      )}

      {/* v23b: Cancel batch dialog */}
      {cancelBatchDlg && <PromptDialog
        title={`Hủy batch import ${cancelBatchDlg.batch.id}?`}
        message={`Sau khi hủy:\n• Tất cả ${cancelBatchDlg.batch.generatedItems || 0} bút toán thuộc batch này sẽ bị loại trừ khỏi tính toán tồn kho\n• Tồn kho tự động hoàn về trạng thái trước import\n• Có thể audit lại sau\nLý do hủy?`}
        placeholder="VD: Sai file, sai mode, đã import lại..."
        confirmLabel="🚫 Xác nhận Hủy"
        required={true}
        onConfirm={(reason) => { onCancelBatch(cancelBatchDlg.batch.id, reason); setCancelBatchDlg(null); }}
        onClose={() => setCancelBatchDlg(null)}
      />}

      {/* v30: Modal xuất báo cáo Excel tồn kho */}
      {exportModal && <InventoryExportModal
        markets={markets}
        defaultWarehouseId={filter.warehouseId}
        defaultDateFrom={exportModal.dateFrom || ""}
        defaultDateTo={exportModal.dateTo || ""}
        exporting={exporting}
        onExport={async ({ warehouseId, dateFrom, dateTo }) => {
          try {
            setExporting(true);
            await exportInventoryReport({
              products, openingStock, stockMovements, stockImportBatches, markets,
              warehouseFilter: warehouseId,
              dateFrom, dateTo,
              settings,
              exportedBy: user?.fullName || user?.username || "User",
            });
            setExportModal(null);
          } catch (err) {
            setConfirmDlg({ title: "Lỗi xuất báo cáo", message: err.message, danger: true, confirmLabel: "OK", cancelLabel: null, onConfirm: () => {} });
          } finally {
            setExporting(false);
          }
        }}
        onClose={() => setExportModal(null)}
      />}
      {/* v36: Thay alert() khi xuất báo cáo lỗi */}
      {confirmDlg && <ConfirmDialog {...confirmDlg} onClose={() => setConfirmDlg(null)} />}
    </div>
  );
};

// v30: Modal xuất báo cáo tồn kho — chọn kho + kỳ → xuất file Excel 4 sheets
const InventoryExportModal = ({ markets, defaultWarehouseId, defaultDateFrom, defaultDateTo, exporting, onExport, onClose }) => {
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId || "");
  const [dateFrom, setDateFrom] = useState(defaultDateFrom || "");
  const [dateTo, setDateTo] = useState(defaultDateTo || "");

  const allWarehouses = useMemo(() => {
    const out = [];
    (markets || []).forEach(m => {
      (m.warehouses || []).forEach(w => out.push({ ...w, marketName: m.name }));
    });
    return out;
  }, [markets]);

  const handleExport = () => {
    onExport({ warehouseId, dateFrom, dateTo });
  };

  return (
    <Modal title="📥 Xuất báo cáo tồn kho" onClose={exporting ? undefined : onClose}
      onSave={handleExport}
      saveLabel={exporting ? "Đang xuất..." : "📥 Xuất Excel"}
      saveDisabled={exporting}
      width={560}>
      <div style={{ fontSize: 12, color: C.textMuted, background: C.green50, padding: "10px 14px", borderRadius: 8, marginBottom: 14 }}>
        💡 <b>Báo cáo Excel 4 sheets:</b>
        <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
          <li>📊 <b>Tổng hợp</b> — SP × Kho × (Đầu kỳ + Nhập + Xuất + Tồn cuối)</li>
          <li>📋 <b>Chi tiết biến động</b> — danh sách movements trong kỳ với nguồn</li>
          <li>⚠️ <b>Cảnh báo</b> — tồn âm + tồn dưới ngưỡng</li>
          <li>📥 <b>Lịch sử Import</b> — các batch đã import</li>
        </ul>
      </div>

      <div className="form-grid">
        <div className="form-group" style={{ gridColumn: "1/-1" }}>
          <label>🏪 Phạm vi kho</label>
          <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
            <option value="">Tất cả kho ({allWarehouses.length} kho)</option>
            {allWarehouses.map(w => (
              <option key={w.id} value={w.id}>{getFlag(w.marketName)} {w.marketName} → {w.name}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>📅 Từ ngày</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div className="form-group">
          <label>📅 Đến ngày</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>

        <div className="form-group" style={{ gridColumn: "1/-1" }}>
          <div style={{ fontSize: 11, color: C.textMuted, padding: "8px 12px", background: "#f8fafc", borderRadius: 6 }}>
            ℹ️ Để trống ngày → báo cáo toàn bộ thời gian. Khi có ngày từ → đầu kỳ tính tự động (tồn tại thời điểm đó).
          </div>
        </div>
      </div>
    </Modal>
  );
};

// v23b: Component panel hiển thị lịch sử import + hủy batch
const ImportHistoryPanel = ({ batches = [], stockMovements, openingStock, markets, isAdmin, onCancelBatch }) => {
  const findWarehouseName = (whId) => {
    for (const m of markets || []) {
      const w = (m.warehouses || []).find(x => x.id === whId);
      if (w) return `${getFlag(m.name)} ${m.name} → ${w.name}`;
    }
    return whId;
  };

  if (batches.length === 0) {
    return (
      <div className="card" style={{ padding: 30, textAlign: "center", color: C.textMuted }}>
        Chưa có batch import nào. Bấm <b>📥 Import tồn kho</b> ở góc trên để tạo batch mới.
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <table>
        <thead><tr><th>Mã batch</th><th>Ngày</th><th>Kho</th><th>Mode</th><th>Nguồn</th><th>Số bút toán</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>
          {sortByDateDesc(batches, "date", "id").map(b => {
            const isCancelled = b.status === "cancelled";
            const rowStyle = isCancelled ? { opacity: 0.5, textDecoration: "line-through" } : {};
            const posInfo = POS_SYSTEMS[b.posSystem] || POS_SYSTEMS.manual;
            return (
              <tr key={b.id} style={isCancelled ? { background: C.bg } : {}}>
                <td style={{ fontWeight: 700, color: C.green600, ...rowStyle }}>
                  {b.id}
                  {isCancelled && <div style={{ fontSize: 9, color: C.red, fontWeight: 700, marginTop: 3, textDecoration: "none" }}>🚫 ĐÃ HỦY</div>}
                </td>
                <td style={{ fontSize: 12, ...rowStyle }}>{fmtDate(b.importDate)}</td>
                <td style={{ fontSize: 12, ...rowStyle }}>{findWarehouseName(b.warehouseId)}</td>
                <td style={{ fontSize: 12, ...rowStyle }}>{IMPORT_MODES[b.mode]?.label || b.mode}</td>
                <td style={{ fontSize: 12, ...rowStyle }}>{posInfo.icon} {posInfo.label}</td>
                <td style={{ textAlign: "right", fontWeight: 700, ...rowStyle }}>{b.generatedItems || 0}</td>
                <td>
                  <Badge label={isCancelled ? "Đã hủy" : "Đang áp dụng"} color={isCancelled ? C.red : C.green600} />
                  {isCancelled && b.cancelReason && <div style={{ fontSize: 10, color: C.red, marginTop: 3, fontStyle: "italic" }}>Lý do: {b.cancelReason}</div>}
                </td>
                <td>
                  {!isCancelled && isAdmin && <button className="btn btn-danger" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => onCancelBatch(b)}>Hủy batch</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// v23: Modal chi tiết tồn kho 1 SP — hiển thị theo thị trường + kho
const InventoryDetailModal = ({ product, markets, openingStock, stockMovements, dateFrom, dateTo, onClose }) => {
  // Tính tồn kho cho từng kho
  const breakdown = useMemo(() => {
    const result = [];
    (markets || []).forEach(m => {
      const whs = m.warehouses || [];
      const marketRows = [];
      let marketTotal = { opening: 0, totalIn: 0, totalOut: 0, onHand: 0 };
      whs.forEach(w => {
        const period = calcStockInPeriod(product.id, w.id, openingStock, stockMovements, dateFrom, dateTo);
        const threshold = getStockThreshold(product, w.id);
        const status = classifyStockStatus(period.onHand, threshold);
        marketRows.push({ warehouse: w, ...period, threshold, status });
        marketTotal.opening += period.opening;
        marketTotal.totalIn += period.totalIn;
        marketTotal.totalOut += period.totalOut;
        marketTotal.onHand += period.onHand;
      });
      result.push({ market: m, warehouses: marketRows, total: marketTotal });
    });
    return result;
  }, [product, markets, openingStock, stockMovements, dateFrom, dateTo]);

  // Tổng toàn cầu
  const grandTotal = breakdown.reduce((acc, m) => ({
    opening: acc.opening + m.total.opening,
    totalIn: acc.totalIn + m.total.totalIn,
    totalOut: acc.totalOut + m.total.totalOut,
    onHand: acc.onHand + m.total.onHand,
  }), { opening: 0, totalIn: 0, totalOut: 0, onHand: 0 });

  return (
    <Modal title={`📦 Tồn kho — ${product.sku}`} subtitle={product.name} onClose={onClose}
      saveLabel="Đóng" onSave={onClose} width={780}>
      {/* Header tổng */}
      <div style={{ padding: 14, background: C.green50, borderRadius: 12, border: `1px solid ${C.green200}`, marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: C.green800, marginBottom: 6 }}>📊 Tổng toàn hệ thống {(dateFrom || dateTo) && <>(kỳ: {dateFrom || "..."} → {dateTo || "..."})</>}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600 }}>ĐẦU KỲ</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{grandTotal.opening.toLocaleString()}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600 }}>NHẬP KỲ</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.green700 }}>+{grandTotal.totalIn.toLocaleString()}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600 }}>XUẤT KỲ</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.red }}>−{grandTotal.totalOut.toLocaleString()}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600 }}>TỒN HIỆN TẠI</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.green600 }}>{grandTotal.onHand.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Phân tách theo thị trường + kho */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {breakdown.map(({ market, warehouses, total }) => {
          if (warehouses.length === 0) return null;
          return (
            <div key={market.id} style={{ padding: 12, background: C.white, borderRadius: 10, border: `1px solid ${C.borderLight}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{getFlag(market.name)} {market.name}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.green600 }}>Tổng: {total.onHand.toLocaleString()}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {warehouses.map(({ warehouse, opening, totalIn, totalOut, onHand, threshold, status }) => {
                  const colorByStatus = status === "negative" ? C.red : status === "low" ? C.orange : C.green600;
                  const bgByStatus = status === "negative" ? "#fef2f2" : status === "low" ? "#fff7ed" : C.bg;
                  return (
                    <div key={warehouse.id} style={{ display: "grid", gridTemplateColumns: "1.5fr repeat(4, 1fr) auto", gap: 8, padding: "8px 10px", background: bgByStatus, borderRadius: 8, alignItems: "center", fontSize: 12 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{warehouse.isDefault ? "⭐ " : ""}{warehouse.name}</div>
                        {threshold > 0 && <div style={{ fontSize: 10, color: C.textMuted }}>Ngưỡng: {threshold}</div>}
                      </div>
                      <div style={{ textAlign: "right", color: C.textMuted }}>Đầu kỳ: <b style={{ color: C.text }}>{opening.toLocaleString()}</b></div>
                      <div style={{ textAlign: "right", color: C.green700 }}>+{totalIn.toLocaleString()}</div>
                      <div style={{ textAlign: "right", color: C.red }}>−{totalOut.toLocaleString()}</div>
                      <div style={{ textAlign: "right", fontWeight: 800, fontSize: 14, color: colorByStatus }}>{onHand.toLocaleString()}</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: colorByStatus }}>{STOCK_STATUS_LABELS[status]}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
};

// ============================================================
// v23b: IMPORT STOCK MODAL — Import tồn kho từ file Excel hoặc URL
// 4 bước: Chọn kho → Chọn mode → Upload/Sync → Preview & Confirm
// ============================================================
const ImportStockModal = ({ markets, products, openingStock, stockMovements, defaultWarehouseId, onSave, onClose }) => {
  const [step, setStep] = useState(1); // 1=chọn kho, 2=chọn mode+upload, 3=preview
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId || "");
  const [mode, setMode] = useState("adjustment"); // "opening" | "adjustment"
  const [parseResult, setParseResult] = useState(null); // { items, errors, mappedItems, unmappedErrors, posSystem, fileName, fileSize }
  const [importing, setImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Tìm thông tin kho đã chọn
  const selectedWarehouseInfo = useMemo(() => {
    for (const m of markets || []) {
      const w = (m.warehouses || []).find(x => x.id === warehouseId);
      if (w) return { warehouse: w, market: m, posSystem: w.posConnection?.system || "manual" };
    }
    return null;
  }, [warehouseId, markets]);

  const posSystem = selectedWarehouseInfo?.posSystem || "manual";

  // Upload file → parse
  const handleFileUpload = async (file) => {
    setErrorMsg("");
    setParseResult(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setErrorMsg("Chỉ chấp nhận file .xlsx");
      return;
    }
    try {
      const rows = await readXlsxFile(file);
      const { items, errors } = parseStockRows(rows, posSystem);
      const { mappedItems, unmappedErrors } = validateImportBatch(items, products, posSystem);
      setParseResult({
        rows, items, errors, mappedItems, unmappedErrors,
        posSystem, fileName: file.name, fileSize: file.size,
        source: "file",
      });
      setStep(3);
    } catch (err) {
      setErrorMsg(`Lỗi đọc file: ${err.message}`);
    }
  };

  // Sync từ URL
  const handleSyncUrl = async () => {
    setErrorMsg("");
    setParseResult(null);
    const url = selectedWarehouseInfo?.warehouse?.posConnection?.syncUrl;
    if (!url) { setErrorMsg("Kho này chưa cấu hình URL sync. Vào tab Thị trường → sửa kho để cấu hình."); return; }
    try {
      setImporting(true);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const rows = parseCsvText(text);
      const { items, errors } = parseStockRows(rows, posSystem);
      const { mappedItems, unmappedErrors } = validateImportBatch(items, products, posSystem);
      setParseResult({
        rows, items, errors, mappedItems, unmappedErrors,
        posSystem, fileName: url, fileSize: text.length,
        source: "url",
      });
      setStep(3);
    } catch (err) {
      setErrorMsg(`Lỗi sync URL: ${err.message}. Kiểm tra URL có publish public + cho phép CORS không.`);
    } finally {
      setImporting(false);
    }
  };

  // Tải template Excel cho user
  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["SKU", "Tên SP", "Số lượng", "Ghi chú"],
      ["SKU001", "Tên ví dụ 1", 100, ""],
      ["SKU002", "Tên ví dụ 2", 50, "Ghi chú"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "Template_tonkho_GoChek.xlsx");
  };

  // Confirm — sinh batch + movements/openings
  const handleConfirm = () => {
    if (!parseResult || parseResult.unmappedErrors.length > 0 || parseResult.errors.length > 0) {
      setErrorMsg("Còn lỗi chưa xử lý — không thể import.");
      return;
    }
    const batchId = `BATCH-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${uid().slice(-4).toUpperCase()}`;
    const today = new Date().toISOString().slice(0, 10);
    const batch = {
      id: batchId,
      importDate: today,
      mode,
      warehouseId,
      warehouseName: selectedWarehouseInfo?.warehouse?.name,
      marketName: selectedWarehouseInfo?.market?.name,
      posSystem,
      sourceLabel: parseResult.source === "url" ? "Sync từ URL" : "Upload file",
      fileName: parseResult.fileName,
      totalRows: parseResult.items.length,
      validRows: parseResult.mappedItems.length,
      generatedItems: 0, // sẽ tính
      status: "active",
    };

    // Sinh movements/openings
    let newMovements = [];
    let newOpenings = [];

    if (mode === "opening") {
      // Mode đầu kỳ: tạo openingStock mới — ghi đè đầu kỳ cũ cho cặp (productId, warehouseId)
      // Cancel các opening cũ cho cùng cặp
      const cancelledOpeningIds = new Set();
      parseResult.mappedItems.forEach(it => {
        const prevOpenings = (openingStock || []).filter(o =>
          o.productId === it.product.id && o.warehouseId === warehouseId && o.status !== "cancelled"
        );
        prevOpenings.forEach(p => cancelledOpeningIds.add(p.id));
        newOpenings.push({
          id: `OS-${batchId}-${it.product.id}`,
          productId: it.product.id,
          warehouseId,
          quantity: it.quantity,
          date: today,
          note: `Đầu kỳ từ batch ${batchId} (${POS_PARSER_SPECS[posSystem].label})`,
          status: "active",
          batchId,
        });
      });
      batch.generatedItems = newOpenings.length;
      batch.cancelledOpeningIds = Array.from(cancelledOpeningIds);
    } else {
      // Mode điều chỉnh: tính chênh lệch — sinh IN/OUT movement
      parseResult.mappedItems.forEach(it => {
        const current = calcStockOnHand(it.product.id, warehouseId, openingStock, stockMovements);
        const diff = it.quantity - current.onHand;
        if (diff === 0) return; // Khớp — không sinh gì
        newMovements.push({
          id: `SM-${batchId}-${it.product.id}`,
          date: today,
          warehouseId,
          productId: it.product.id,
          type: diff > 0 ? "IN" : "OUT",
          source: "stock_import_batch",
          refType: "stock_import_batch",
          refId: batchId,
          quantity: Math.abs(diff),
          status: "active",
          note: `Điều chỉnh từ batch ${batchId} (${POS_PARSER_SPECS[posSystem].label}): SL thực tế ${it.quantity}, CRM ${current.onHand}, chênh ${diff > 0 ? "+" : ""}${diff}`,
        });
      });
      batch.generatedItems = newMovements.length;
    }

    onSave({ batch, newMovements, newOpenings });
  };

  return (
    <Modal title={`📥 Import tồn kho — Bước ${step}/3`}
      onClose={onClose}
      onSave={step === 3 ? handleConfirm : null}
      saveDisabled={step !== 3 || !parseResult || parseResult.unmappedErrors?.length > 0 || parseResult.errors?.length > 0 || parseResult.mappedItems?.length === 0}
      saveLabel={step === 3 ? "✅ Xác nhận Import" : null}
      width={900}>

      {errorMsg && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{errorMsg}</div>}

      {/* BƯỚC 1 — Chọn kho */}
      {step === 1 && (
        <>
          <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 12 }}>
            Chọn kho cần cập nhật tồn kho. Mỗi lần import áp dụng cho 1 kho duy nhất.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 400, overflowY: "auto" }}>
            {(markets || []).map(m => (
              <div key={m.id}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>{getFlag(m.name)} {m.name}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 16 }}>
                  {(m.warehouses || []).map(w => {
                    const ps = w.posConnection?.system || "manual";
                    const psInfo = POS_SYSTEMS[ps];
                    const selected = warehouseId === w.id;
                    return (
                      <button key={w.id} type="button" onClick={() => setWarehouseId(w.id)}
                        style={{
                          padding: "10px 14px", textAlign: "left", borderRadius: 10,
                          background: selected ? C.green50 : C.white,
                          border: selected ? `2px solid ${C.green500}` : `1px solid ${C.borderLight}`,
                          cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                        }}>
                        <div style={{ fontSize: 14, color: selected ? C.green600 : C.textLight }}>
                          {selected ? "🟢" : "⚪"}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{w.isDefault ? "⭐ " : ""}{w.name}</div>
                          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                            Kết nối: <b style={{ color: psInfo.color }}>{psInfo.icon} {psInfo.label}</b>
                            {w.posConnection?.syncUrl && <span style={{ marginLeft: 6 }}>· 🔗 Có URL sync</span>}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" disabled={!warehouseId} onClick={() => setStep(2)}>Tiếp tục →</button>
          </div>
        </>
      )}

      {/* BƯỚC 2 — Chọn mode + upload/sync */}
      {step === 2 && selectedWarehouseInfo && (
        <>
          <div style={{ padding: 12, background: C.green50, borderRadius: 10, marginBottom: 14, fontSize: 13 }}>
            <div><b>Kho đã chọn:</b> {getFlag(selectedWarehouseInfo.market.name)} {selectedWarehouseInfo.market.name} → {selectedWarehouseInfo.warehouse.name}</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
              Phần mềm nguồn: <b style={{ color: POS_SYSTEMS[posSystem].color }}>{POS_SYSTEMS[posSystem].icon} {POS_SYSTEMS[posSystem].label}</b>
              {posSystem !== "manual" && <span style={{ marginLeft: 8 }}>→ CRM tự dùng parser của {POS_SYSTEMS[posSystem].label}</span>}
            </div>
          </div>

          {/* Chọn mode */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Chế độ import:</div>
            {Object.values(IMPORT_MODES).map(m => (
              <label key={m.id} style={{ display: "block", padding: 10, marginBottom: 6, borderRadius: 8, border: `1px solid ${mode === m.id ? C.green500 : C.borderLight}`, background: mode === m.id ? C.green50 : C.white, cursor: "pointer" }}>
                <input type="radio" name="mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} style={{ marginRight: 8 }} />
                <b>{m.label}</b>
                <div style={{ fontSize: 11, color: C.textMuted, marginLeft: 22, marginTop: 2 }}>{m.description}</div>
              </label>
            ))}
          </div>

          {/* Tải template chỉ cho manual */}
          {posSystem === "manual" && (
            <div style={{ padding: 10, background: C.bg, borderRadius: 8, marginBottom: 14, fontSize: 12 }}>
              📥 Chưa có file? <button type="button" className="btn btn-ghost" onClick={downloadTemplate} style={{ padding: "3px 10px", fontSize: 11 }}>Tải template chuẩn</button>
            </div>
          )}

          {/* Upload file */}
          <div style={{ padding: 14, background: C.white, borderRadius: 10, border: `2px dashed ${C.green300}`, textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>📁 Upload file Excel (.xlsx)</div>
            <input type="file" accept=".xlsx"
              onChange={e => handleFileUpload(e.target.files[0])}
              style={{ marginTop: 6 }} />
          </div>

          {/* Sync URL nếu có */}
          {posSystem !== "manual" && selectedWarehouseInfo.warehouse.posConnection?.syncUrl && (
            <div style={{ marginTop: 12, padding: 14, background: C.white, borderRadius: 10, border: `2px dashed ${C.blue}`, textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>🔗 Hoặc sync từ URL đã cấu hình</div>
              <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 10, wordBreak: "break-all" }}>
                {selectedWarehouseInfo.warehouse.posConnection.syncUrl.slice(0, 80)}...
              </div>
              <button className="btn btn-primary" disabled={importing} onClick={handleSyncUrl}>
                {importing ? "⏳ Đang sync..." : "🔄 Sync ngay"}
              </button>
            </div>
          )}

          <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between" }}>
            <button className="btn btn-ghost" onClick={() => setStep(1)}>← Quay lại</button>
          </div>
        </>
      )}

      {/* BƯỚC 3 — Preview */}
      {step === 3 && parseResult && (
        <>
          <div style={{ padding: 10, background: C.green50, borderRadius: 10, marginBottom: 12, fontSize: 12 }}>
            <div><b>Kho:</b> {selectedWarehouseInfo?.market?.name} → {selectedWarehouseInfo?.warehouse?.name} · <b>Mode:</b> {IMPORT_MODES[mode].label}</div>
            <div style={{ fontSize: 11, color: C.textMuted }}>Nguồn: {POS_SYSTEMS[posSystem].label} · {parseResult.source === "url" ? "🔗 Sync URL" : "📁 File"}</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 12 }}>
            <div className="card" style={{ padding: 10 }}>
              <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600 }}>Tổng dòng</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{parseResult.items.length + parseResult.errors.length}</div>
            </div>
            <div className="card" style={{ padding: 10, borderLeft: `4px solid ${C.green600}` }}>
              <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600 }}>✅ Hợp lệ</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.green600 }}>{parseResult.mappedItems.length}</div>
            </div>
            <div className="card" style={{ padding: 10, borderLeft: `4px solid ${C.orange}` }}>
              <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600 }}>⚠ Chưa map SKU</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.orange }}>{parseResult.unmappedErrors.length}</div>
            </div>
            <div className="card" style={{ padding: 10, borderLeft: `4px solid ${C.red}` }}>
              <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600 }}>❌ Lỗi parse</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.red }}>{parseResult.errors.length}</div>
            </div>
          </div>

          {(parseResult.errors.length > 0 || parseResult.unmappedErrors.length > 0) && (
            <div className="alert alert-danger" style={{ marginBottom: 12 }}>
              <b>⛔ KHÔNG THỂ IMPORT —</b> File có lỗi. Theo cấu hình "Reject toàn bộ nếu có lỗi", chị phải:
              <ul style={{ margin: "6px 0 0 16px", fontSize: 12 }}>
                {parseResult.errors.length > 0 && <li>Sửa các lỗi parse trong file</li>}
                {parseResult.unmappedErrors.length > 0 && <li>Vào tab Sản phẩm → Sửa SP → bổ sung SKU bên {POS_SYSTEMS[posSystem].label} cho các SP còn thiếu</li>}
              </ul>
            </div>
          )}

          {/* v23b: Cảnh báo nhẹ khi mode adjustment + tất cả dòng khớp = sẽ tạo batch trống */}
          {parseResult.errors.length === 0 && parseResult.unmappedErrors.length === 0 && parseResult.mappedItems.length > 0 && mode === "adjustment" && (() => {
            const totalDiff = parseResult.mappedItems.reduce((acc, it) => {
              const c = calcStockOnHand(it.product.id, warehouseId, openingStock, stockMovements);
              return acc + Math.abs(it.quantity - c.onHand);
            }, 0);
            if (totalDiff === 0) {
              return (
                <div className="alert alert-info" style={{ marginBottom: 12, fontSize: 12 }}>
                  ℹ️ <b>Tất cả {parseResult.mappedItems.length} dòng đều khớp với CRM</b> — không có chênh lệch nào cần điều chỉnh. Bấm Xác nhận sẽ tạo batch nhưng không sinh bút toán mới (vẫn ghi vào lịch sử để audit).
                </div>
              );
            }
            return null;
          })()}

          <div style={{ maxHeight: 400, overflowY: "auto", border: `1px solid ${C.borderLight}`, borderRadius: 8 }}>
            <table style={{ fontSize: 11 }}>
              <thead>
                <tr>
                  <th>Dòng</th>
                  <th>SKU file</th>
                  <th>Map → SP CRM</th>
                  <th style={{ textAlign: "right" }}>SL thực tế</th>
                  {mode === "adjustment" && <th style={{ textAlign: "right" }}>Tồn CRM</th>}
                  {mode === "adjustment" && <th style={{ textAlign: "right" }}>Chênh</th>}
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {/* Lỗi parse */}
                {parseResult.errors.map((e, i) => (
                  <tr key={`err-${i}`} style={{ background: "#fef2f2" }}>
                    <td>{e.rowIdx}</td>
                    <td colSpan={mode === "adjustment" ? 5 : 3} style={{ color: C.red, fontStyle: "italic" }}>❌ {e.reason}</td>
                    <td><Badge label="Lỗi" color={C.red} /></td>
                  </tr>
                ))}
                {/* Lỗi map */}
                {parseResult.unmappedErrors.map((e, i) => (
                  <tr key={`um-${i}`} style={{ background: "#fff7ed" }}>
                    <td>{e.rowIdx}</td>
                    <td>{e.sku}</td>
                    <td colSpan={mode === "adjustment" ? 3 : 1} style={{ color: C.orange, fontStyle: "italic" }}>⚠ {e.reason}</td>
                    {mode === "adjustment" && <td>—</td>}
                    <td><Badge label="Chưa map" color={C.orange} /></td>
                  </tr>
                ))}
                {/* Mapped items */}
                {parseResult.mappedItems.map((it, i) => {
                  let currentOnHand = 0, diff = 0;
                  if (mode === "adjustment") {
                    const c = calcStockOnHand(it.product.id, warehouseId, openingStock, stockMovements);
                    currentOnHand = c.onHand;
                    diff = it.quantity - currentOnHand;
                  }
                  return (
                    <tr key={`ok-${i}`}>
                      <td>{it.rowIdx}</td>
                      <td>{it.sku}</td>
                      <td><b style={{ color: C.green700 }}>{it.product.sku}</b> — {it.product.name}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{it.quantity.toLocaleString()}</td>
                      {mode === "adjustment" && <td style={{ textAlign: "right", color: C.textMuted }}>{currentOnHand.toLocaleString()}</td>}
                      {mode === "adjustment" && (
                        <td style={{ textAlign: "right", fontWeight: 700, color: diff > 0 ? C.green700 : diff < 0 ? C.red : C.textMuted }}>
                          {diff > 0 ? "+" : ""}{diff.toLocaleString()}
                        </td>
                      )}
                      <td><Badge label={mode === "adjustment" && diff === 0 ? "Khớp" : "✅ OK"} color={mode === "adjustment" && diff === 0 ? C.textMuted : C.green600} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between" }}>
            <button className="btn btn-ghost" onClick={() => { setStep(2); setParseResult(null); }}>← Upload lại</button>
          </div>
        </>
      )}
    </Modal>
  );
};

// ============================================================
// v25: CONFIGURATION HUB — Tab Cấu hình với 5 sub-tabs
// Gộp: Cài đặt chung / NCC / Carrier / Thị trường & Kho / Tài khoản
// ============================================================
const Configuration = ({ data, user, onAdd, onEdit, onDelete, onHardDelete, onSaveSettings, onCreateWarehouse }) => {
  // Lọc sub-tabs theo quyền user
  const visibleSubtabs = useMemo(() => {
    return CONFIG_SUBTABS.filter(st => !st.perm || can(user, st.perm));
  }, [user]);

  const [activeSubtab, setActiveSubtab] = useState(() => visibleSubtabs[0]?.id || "general");

  // Nếu user mất quyền → reset về sub-tab đầu tiên còn quyền
  useEffect(() => {
    if (!visibleSubtabs.find(st => st.id === activeSubtab)) {
      setActiveSubtab(visibleSubtabs[0]?.id || "general");
    }
  }, [visibleSubtabs, activeSubtab]);

  if (visibleSubtabs.length === 0) {
    return (
      <div>
        <SectionHeader title="⚙️ Cấu hình" subtitle="Bạn không có quyền xem mục cấu hình nào" />
        <div className="card" style={{ padding: 30, textAlign: "center", color: C.textMuted }}>
          Liên hệ admin để được cấp quyền.
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title="⚙️ Cấu hình hệ thống"
        subtitle="Tập trung quản lý NCC · Carrier · Thị trường & Kho · Tài khoản · Cài đặt chung"
      />

      {/* Sub-tabs navigation */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.borderLight}`, flexWrap: "wrap" }}>
        {visibleSubtabs.map(st => (
          <button key={st.id} onClick={() => setActiveSubtab(st.id)} className="btn btn-ghost"
            style={{
              padding: "10px 16px", fontSize: 13,
              fontWeight: activeSubtab === st.id ? 700 : 500,
              borderBottom: activeSubtab === st.id ? `3px solid ${C.green600}` : "3px solid transparent",
              borderRadius: 0,
              color: activeSubtab === st.id ? C.green700 : C.textMuted,
            }}>
            {st.icon} {st.label}
          </button>
        ))}
      </div>

      {/* Render sub-tab content */}
      {activeSubtab === "general" && <Settings settings={data.settings} onSave={onSaveSettings} user={user} />}
      {activeSubtab === "factories" && <Factories factories={data.factories} pos={data.pos} shipments={data.shipments} settings={data.settings} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} onHardDelete={onHardDelete} data={data} user={user} />}
      {activeSubtab === "carriers" && <Carriers carriers={data.carriers} shipments={data.shipments} feePayments={data.feePayments} settings={data.settings} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} onHardDelete={onHardDelete} data={data} user={user} />}
      {activeSubtab === "markets" && <Markets markets={data.markets} shipments={data.shipments} payments={data.payments} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} user={user} />}
      {activeSubtab === "users" && <Users users={data.users} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} user={user} />}
    </div>
  );
};

// ============================================================
// v24: HELP — Tab Hướng dẫn sử dụng
// ============================================================
const Help = ({ user }) => {
  const [activeItem, setActiveItem] = useState("intro"); // ID của item đang xem
  const [search, setSearch] = useState("");

  // Flatten tất cả items để search
  const allItems = useMemo(() => {
    const flat = [];
    Object.entries(HELP_CONTENT).forEach(([sectionId, section]) => {
      section.items.forEach(item => {
        flat.push({ ...item, sectionId, sectionLabel: section.label });
      });
    });
    return flat;
  }, []);

  // Filter theo search
  const filteredSections = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase().trim();
    const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const qNorm = norm(q);

    const matched = allItems.filter(item => {
      // Match title, keywords, content text
      if (norm(item.title).includes(qNorm)) return true;
      if ((item.keywords || []).some(k => norm(k).includes(qNorm))) return true;
      // Search trong content text
      const allText = (item.content || []).map(b => {
        if (b.type === "p" || b.type === "h" || b.type === "tip" || b.type === "warn" || b.type === "code") return b.text || "";
        if (b.type === "list" || b.type === "steps") return (b.items || []).join(" ");
        if (b.type === "table") return [(b.headers || []).join(" "), ...(b.rows || []).map(r => r.join(" "))].join(" ");
        return "";
      }).join(" ");
      return norm(allText).includes(qNorm);
    });
    return matched;
  }, [search, allItems]);

  // Lấy item đang xem
  const currentItem = useMemo(() => {
    return allItems.find(it => it.id === activeItem) || allItems[0];
  }, [activeItem, allItems]);

  return (
    <div>
      <SectionHeader title="📚 Hướng dẫn sử dụng"
        subtitle={`Tài liệu hướng dẫn GoChek CRM · ${allItems.length} mục · Click vào sidebar bên trái để xem`}
      />

      {/* Search bar */}
      <div className="card" style={{ padding: 12, marginBottom: 16 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Tìm trong hướng dẫn... (vd: 'huy lo', 'ton kho', 'phan quyen')"
          style={{ width: "100%", fontSize: 13, padding: 10 }}
        />
        {search && filteredSections && (
          <div style={{ marginTop: 8, fontSize: 11, color: C.textMuted }}>
            Tìm thấy <b>{filteredSections.length}</b> kết quả khớp với "{search}"
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, alignItems: "flex-start" }}>
        {/* Sidebar bên trái */}
        <div className="card" style={{ padding: 0, position: "sticky", top: 12, maxHeight: "calc(100vh - 100px)", overflowY: "auto" }}>
          {search && filteredSections ? (
            // Mode search — hiển thị danh sách phẳng
            <div style={{ padding: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, padding: "4px 8px", marginBottom: 4, textTransform: "uppercase" }}>Kết quả</div>
              {filteredSections.length === 0 ? (
                <div style={{ padding: 14, fontSize: 12, color: C.textMuted, fontStyle: "italic" }}>Không tìm thấy</div>
              ) : (
                filteredSections.map(item => (
                  <button key={item.id} onClick={() => { setActiveItem(item.id); setSearch(""); }}
                    style={{
                      display: "block", width: "100%", textAlign: "left", padding: "8px 10px",
                      borderRadius: 6, fontSize: 12, marginBottom: 2, cursor: "pointer",
                      background: activeItem === item.id ? C.green50 : "transparent",
                      color: activeItem === item.id ? C.green700 : C.text,
                      fontWeight: activeItem === item.id ? 700 : 500,
                      border: "none",
                    }}>
                    <div>{item.icon} {item.title}</div>
                    <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{item.sectionLabel}</div>
                  </button>
                ))
              )}
            </div>
          ) : (
            // Mode bình thường — hiển thị theo section
            Object.entries(HELP_CONTENT).map(([sectionId, section]) => (
              <div key={sectionId} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                <div style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700, color: C.green800, background: C.green50, textTransform: "uppercase" }}>
                  {section.label}
                </div>
                <div style={{ padding: "6px 8px" }}>
                  {section.items.map(item => (
                    <button key={item.id} onClick={() => setActiveItem(item.id)}
                      style={{
                        display: "block", width: "100%", textAlign: "left", padding: "7px 10px",
                        borderRadius: 6, fontSize: 12, marginBottom: 1, cursor: "pointer",
                        background: activeItem === item.id ? C.green50 : "transparent",
                        color: activeItem === item.id ? C.green700 : C.text,
                        fontWeight: activeItem === item.id ? 700 : 500,
                        border: "none",
                        borderLeft: activeItem === item.id ? `3px solid ${C.green600}` : "3px solid transparent",
                      }}>
                      {item.icon} {item.title}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Nội dung bên phải */}
        <div className="card" style={{ padding: 24, minHeight: 400 }}>
          {currentItem ? (
            <>
              {/* Breadcrumb + title */}
              <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>
                📚 Hướng dẫn / {HELP_CONTENT[currentItem.sectionId || (allItems.find(i => i.id === currentItem.id) || {}).sectionId]?.label || ""}
              </div>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: "0 0 16px 0" }}>
                {currentItem.icon} {currentItem.title}
              </h2>

              {/* Render content blocks */}
              <div style={{ fontSize: 13, lineHeight: 1.7, color: C.text }}>
                {(currentItem.content || []).map((block, i) => <HelpBlock key={i} block={block} />)}
              </div>

              {/* Footer — navigation prev/next */}
              <div style={{ marginTop: 32, paddingTop: 16, borderTop: `1px solid ${C.borderLight}`, display: "flex", justifyContent: "space-between", gap: 12 }}>
                {(() => {
                  const idx = allItems.findIndex(i => i.id === currentItem.id);
                  const prev = idx > 0 ? allItems[idx - 1] : null;
                  const next = idx < allItems.length - 1 ? allItems[idx + 1] : null;
                  return (
                    <>
                      {prev ? (
                        <button onClick={() => setActiveItem(prev.id)} className="btn btn-ghost" style={{ fontSize: 12 }}>
                          ← {prev.icon} {prev.title}
                        </button>
                      ) : <div />}
                      {next ? (
                        <button onClick={() => setActiveItem(next.id)} className="btn btn-ghost" style={{ fontSize: 12 }}>
                          {next.icon} {next.title} →
                        </button>
                      ) : <div />}
                    </>
                  );
                })()}
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", color: C.textMuted, padding: 40 }}>
              Chọn 1 mục từ sidebar bên trái để xem hướng dẫn
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// v24: Component render 1 block trong help
const HelpBlock = ({ block }) => {
  if (block.type === "p") {
    return <p style={{ margin: "0 0 12px 0" }}>{block.text}</p>;
  }
  if (block.type === "h") {
    return <h3 style={{ fontSize: 15, fontWeight: 700, color: C.green800, margin: "20px 0 10px 0" }}>{block.text}</h3>;
  }
  if (block.type === "list") {
    return (
      <ul style={{ margin: "0 0 14px 0", paddingLeft: 20 }}>
        {(block.items || []).map((it, i) => <li key={i} style={{ marginBottom: 4 }}>{it}</li>)}
      </ul>
    );
  }
  if (block.type === "steps") {
    return (
      <ol style={{ margin: "0 0 14px 0", paddingLeft: 24 }}>
        {(block.items || []).map((it, i) => <li key={i} style={{ marginBottom: 6 }}>{it}</li>)}
      </ol>
    );
  }
  if (block.type === "tip") {
    return (
      <div style={{ padding: "10px 14px", background: "#eff6ff", borderLeft: `4px solid ${C.blue}`, borderRadius: 6, margin: "12px 0", fontSize: 12, color: "#1e3a8a" }}>
        💡 <b>Mẹo:</b> {block.text}
      </div>
    );
  }
  if (block.type === "warn") {
    return (
      <div style={{ padding: "10px 14px", background: "#fff7ed", borderLeft: `4px solid ${C.orange}`, borderRadius: 6, margin: "12px 0", fontSize: 12, color: "#7c2d12" }}>
        ⚠️ <b>Lưu ý:</b> {block.text}
      </div>
    );
  }
  if (block.type === "code") {
    return (
      <div style={{ padding: "10px 14px", background: "#1e293b", borderRadius: 6, margin: "12px 0", fontSize: 12, color: "#e2e8f0", fontFamily: "monospace", overflowX: "auto" }}>
        {block.text}
      </div>
    );
  }
  if (block.type === "table") {
    return (
      <div style={{ overflowX: "auto", margin: "12px 0" }}>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {(block.headers || []).map((h, i) => (
                <th key={i} style={{ padding: "8px 10px", background: C.green50, borderBottom: `2px solid ${C.green200}`, textAlign: "left", fontWeight: 700, color: C.green800 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(block.rows || []).map((row, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                {row.map((cell, j) => (
                  <td key={j} style={{ padding: "8px 10px", verticalAlign: "top" }}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return null;
};

// ============================================================
// DEBTS
// ============================================================
const Debts = ({ pos, shipments, payments, factories, openingBalances, settings, feePayments, products, carriers, markets, user }) => {
  // v16: Bộ lọc khoảng thời gian
  const [filter, setFilter] = useState({ dateFrom: "", dateTo: "" });
  const hasFilter = !!(filter.dateFrom || filter.dateTo);

  const rows = useMemo(() => factories.map(f => ({
    factory: f, ...calcFactoryBalance(f.id, pos, shipments, payments, openingBalances, factories, settings, filter.dateFrom, filter.dateTo)
  })), [pos, shipments, payments, factories, openingBalances, settings, filter.dateFrom, filter.dateTo]);

  const summary = useMemo(() => ({
    totalExpected: rows.reduce((s, r) => s + r.expectedDebt, 0),
    totalShipped: rows.reduce((s, r) => s + r.inKyShipped, 0), // v16: chỉ trong kỳ
    totalShippedCumulative: rows.reduce((s, r) => s + r.actualDebt, 0), // toàn bộ
    // v17: Đã thanh toán (ròng) — chỉ trong kỳ nếu có filter, lũy kế nếu không
    totalPaid: rows.reduce((s, r) => s + r.inKyNetPaid, 0),
    totalPaidCumulative: rows.reduce((s, r) => s + r.netPaid, 0),
    totalOwed: rows.reduce((s, r) => s + r.stillOwed, 0),
    totalCredit: rows.reduce((s, r) => s + r.creditFund, 0),
    totalPrevDebt: rows.reduce((s, r) => s + r.prevDebt, 0),
    totalPrevCredit: rows.reduce((s, r) => s + r.prevCredit, 0),
    // v17: Phục vụ "Cách tính" toggle
    totalInbound: rows.reduce((s, r) => s + r.inKyInbound, 0),
    totalOutbound: rows.reduce((s, r) => s + r.inKyOutbound, 0),
    totalInboundCumulative: rows.reduce((s, r) => s + r.inbound, 0),
    totalOutboundCumulative: rows.reduce((s, r) => s + r.outbound, 0),
    // v38: Tổng "Đang TT" (stage 1+2)
    totalPendingPaid: rows.reduce((s, r) => s + (r.pendingPaidCNY || 0), 0),
    totalPendingPaidVND: rows.reduce((s, r) => s + (r.pendingPaidVND || 0), 0),
  }), [rows]);

  // v17: Toggle hiện cách tính "Còn phải trả" trên KPI tổng
  const [showCalcKPI, setShowCalcKPI] = useState(false);

  // v29: Tính các lô đến hạn thanh toán
  const duePayments = useMemo(() =>
    calcDuePayments(shipments, pos, factories, payments, products, settings, 14),
  [shipments, pos, factories, payments, products, settings]);

  const [showDueDetail, setShowDueDetail] = useState(false);

  // v12: Export Excel (.xls SpreadsheetML)
  const [exportModal, setExportModal] = useState(null);
  const [exporting, setExporting] = useState(false);
  // v36: Thay alert() bằng ConfirmDialog
  const [confirmDlg, setConfirmDlg] = useState(null);
  const canExport = can(user, "export_accounting_report");

  const handleExport = async ({ factoryId, dateFrom, dateTo }) => {
    const factory = factories.find(f => f.id === factoryId);
    if (!factory) { setConfirmDlg({ title: "Thiếu thông tin", message: "Vui lòng chọn NCC.", confirmLabel: "OK", cancelLabel: null, onConfirm: () => {} }); return; }
    setExporting(true);
    try {
      const fname = await exportAccountingReport({
        factory, pos, shipments, payments, feePayments, openingBalances, products,
        carriers, markets, dateFrom, dateTo, settings,
        exportedBy: user?.fullName || user?.username || "-",
      });
      setConfirmDlg({ title: "✓ Xuất file thành công", message: `Đã xuất file: ${fname}`, confirmLabel: "OK", cancelLabel: null, onConfirm: () => {} });
      setExportModal(null);
    } catch (e) {
      console.error("Export error:", e);
      setConfirmDlg({ title: "Lỗi xuất file", message: e.message, danger: true, confirmLabel: "OK", cancelLabel: null, onConfirm: () => {} });
    } finally {
      setExporting(false);
    }
  };

  // v16: Format ngày Việt
  const fmtKy = (d) => {
    if (!d) return "";
    const [y, m, day] = d.split("-");
    return `${day}/${m}/${y}`;
  };

  return (
    <div>
      <SectionHeader title="Công nợ nhà cung cấp" subtitle="Hàng đã ship → phát sinh công nợ. Trừ tiếp các khoản đã thanh toán → ra số còn phải trả."
        action={canExport && <button className="btn btn-primary" onClick={() => setExportModal({ dateFrom: filter.dateFrom, dateTo: filter.dateTo })}>📥 Xuất báo cáo đối soát</button>}
      />

      {/* v29: Cảnh báo thanh toán đến hạn */}
      {duePayments.length > 0 && (() => {
        const overdueList = duePayments.filter(d => d.urgency === "overdue");
        const urgentList = duePayments.filter(d => d.urgency === "urgent");
        const warningList = duePayments.filter(d => d.urgency === "warning");
        const totalOverdueCNY = overdueList.reduce((s, d) => s + d.valueRemainCNY, 0);
        const totalUrgentCNY = urgentList.reduce((s, d) => s + d.valueRemainCNY, 0);
        const totalWarningCNY = warningList.reduce((s, d) => s + d.valueRemainCNY, 0);
        const cnyToVnd = settings?.cnyToVnd || 1;

        return (
          <div className="card" style={{ padding: 0, marginBottom: 16, overflow: "hidden", border: `2px solid ${overdueList.length > 0 ? C.red : (urgentList.length > 0 ? C.orange : C.blue)}` }}>
            <div style={{
              padding: "12px 16px",
              background: overdueList.length > 0 ? C.redBg : (urgentList.length > 0 ? "#fff7ed" : "#e0f2fe"),
              borderBottom: `1px solid ${C.borderLight}`,
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap",
            }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: overdueList.length > 0 ? C.red : (urgentList.length > 0 ? C.orange : C.blue) }}>
                {overdueList.length > 0 ? "🔴 CẢNH BÁO THANH TOÁN" : urgentList.length > 0 ? "⏰ Sắp đến hạn thanh toán" : "📅 Theo dõi thanh toán"}
              </div>
              <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setShowDueDetail(!showDueDetail)}>
                {showDueDetail ? "Ẩn chi tiết ▲" : "Xem chi tiết ▼"}
              </button>
            </div>
            <div style={{ padding: "12px 16px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              <div style={{ padding: 10, background: C.redBg, borderRadius: 8, borderLeft: `3px solid ${C.red}` }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.textMuted }}>🔴 Đã quá hạn</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: C.red, marginTop: 2 }}>{overdueList.length} lô</div>
                <div style={{ fontSize: 11, color: C.text, marginTop: 1 }}>¥{totalOverdueCNY.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmtVND(totalOverdueCNY * cnyToVnd)}</div>
              </div>
              <div style={{ padding: 10, background: "#fff7ed", borderRadius: 8, borderLeft: `3px solid ${C.orange}` }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.textMuted }}>⏰ Trong 7 ngày</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: C.orange, marginTop: 2 }}>{urgentList.length} lô</div>
                <div style={{ fontSize: 11, color: C.text, marginTop: 1 }}>¥{totalUrgentCNY.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmtVND(totalUrgentCNY * cnyToVnd)}</div>
              </div>
              <div style={{ padding: 10, background: "#e0f2fe", borderRadius: 8, borderLeft: `3px solid ${C.blue}` }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.textMuted }}>📅 Trong 14 ngày</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: C.blue, marginTop: 2 }}>{warningList.length} lô</div>
                <div style={{ fontSize: 11, color: C.text, marginTop: 1 }}>¥{totalWarningCNY.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmtVND(totalWarningCNY * cnyToVnd)}</div>
              </div>
            </div>
            {showDueDetail && (
              <div style={{ borderTop: `1px solid ${C.borderLight}`, padding: 0, maxHeight: 350, overflowY: "auto" }}>
                <table style={{ fontSize: 12 }}>
                  <thead style={{ position: "sticky", top: 0, background: C.green50, zIndex: 1 }}>
                    <tr>
                      <th>Mức độ</th>
                      <th>Lô</th>
                      <th>NCC</th>
                      <th>Ngày về kho</th>
                      <th>Hạn TT</th>
                      <th style={{ textAlign: "right" }}>Còn nợ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {duePayments.map((d, i) => {
                      const urgencyInfo = {
                        overdue: { label: `🔴 Quá ${Math.abs(d.daysUntilDue)} ngày`, color: C.red },
                        urgent: { label: `⏰ Còn ${d.daysUntilDue} ngày`, color: C.orange },
                        warning: { label: `📅 Còn ${d.daysUntilDue} ngày`, color: C.blue },
                      };
                      const u = urgencyInfo[d.urgency];
                      return (
                        <tr key={i}>
                          <td><span style={{ padding: "2px 8px", background: u.color + "20", color: u.color, borderRadius: 99, fontSize: 11, fontWeight: 700 }}>{u.label}</span></td>
                          <td style={{ fontWeight: 700, color: C.green700 }}>{d.shipment.id}</td>
                          <td>{d.factory.name}</td>
                          <td>{fmtDate(d.arriveDate)}</td>
                          <td style={{ fontWeight: 600 }}>{fmtDate(d.dueDate)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>
                            <div>¥{d.valueRemainCNY.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                            <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmtVND(d.valueRemainCNY * cnyToVnd)}</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {/* v16: Bộ lọc thời gian */}
      <div className="card" style={{ padding: "12px 16px", marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.green700 }}>🔍 Lọc theo thời gian:</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: 12, color: C.textMuted }}>Từ ngày</label>
          <input type="date" value={filter.dateFrom} onChange={e => setFilter(p => ({ ...p, dateFrom: e.target.value }))} style={{ width: 150 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: 12, color: C.textMuted }}>Đến ngày</label>
          <input type="date" value={filter.dateTo} onChange={e => setFilter(p => ({ ...p, dateTo: e.target.value }))} style={{ width: 150 }} />
        </div>
        {hasFilter && (
          <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setFilter({ dateFrom: "", dateTo: "" })}>✕ Xóa bộ lọc</button>
        )}
        {!hasFilter && (
          <span style={{ fontSize: 11, color: C.textLight, marginLeft: "auto" }}>Mặc định: hiển thị toàn bộ lịch sử</span>
        )}
      </div>

      {/* v16: Box ghi chú giải thích cách tính khi có filter */}
      {hasFilter && (
        <div style={{ background: C.green50, border: `1px solid ${C.green200}`, borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green700, marginBottom: 6 }}>
            💡 Đang xem báo cáo công nợ kỳ {filter.dateFrom ? `từ ${fmtKy(filter.dateFrom)}` : "(không giới hạn đầu)"} {filter.dateTo ? `đến ${fmtKy(filter.dateTo)}` : "(đến hôm nay)"}
          </div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 11, color: C.text, lineHeight: 1.7 }}>
            <li><b>Số dư đầu kỳ (nợ/quỹ TD)</b> = Nợ đầu kỳ gốc + Hàng đã ship + Thanh toán ròng tích lũy đến trước <b>{filter.dateFrom ? fmtKy(filter.dateFrom) : "(đầu)"}</b></li>
            <li><b>Hàng đã ship · Đã nhận TT · Đã trả hộ NM khác</b> = chỉ giao dịch trong khoảng lọc</li>
            <li><b>Còn phải trả</b> = Nợ đầu kỳ + Hàng đã ship − (Đã nhận TT − Đã trả hộ) → số nợ thực tế đến cuối kỳ</li>
            <li><b>Hàng chờ ship</b> = KHÔNG lọc theo thời gian — luôn là tổng PO đã duyệt còn lại chưa ship hiện tại</li>
          </ul>
        </div>
      )}

      {/* v17: KPI 5 thẻ — thêm "Đã thanh toán" + toggle cách tính cho "Còn phải trả" */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 12 }}>
        {[
          { label: "Hàng chờ ship", val: summary.totalExpected, sub: "Tổng PO đã duyệt còn chưa ship", tip: "Cam kết tài chính tương lai · KHÔNG lọc thời gian", color: C.green800 },
          { label: "Hàng đã ship", val: hasFilter ? summary.totalShipped : summary.totalShippedCumulative, sub: hasFilter ? "Trong kỳ lọc" : "Lũy kế đến hiện tại", tip: "Tổng giá trị NCC đã giao đi (đang VC + đã về kho)", color: C.green800 },
          { label: "Đã thanh toán", val: hasFilter ? summary.totalPaid : summary.totalPaidCumulative, sub: "Tất cả NCC", tip: "Đã thanh toán ròng = Tiền nhận − Tiền trả hộ NM khác", color: C.blue, isPaid: true },
          { label: "Còn phải trả", val: summary.totalOwed, sub: hasFilter ? `Đến cuối kỳ ${filter.dateTo ? fmtKy(filter.dateTo) : "lọc"}` : "Số nợ hiện tại", tip: "Số tiền thực tế còn nợ NCC sau khi trừ thanh toán", color: C.red, isOwed: true },
          { label: "Quỹ tín dụng", val: summary.totalCredit, sub: "Số đã trả dư", tip: "Sẽ bù trừ vào công nợ phát sinh sau", color: C.green600 },
        ].map((k, i) => (
          <div key={i} className="card" title={k.tip} style={{ padding: 14 }}>
            <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: k.color }}>{fmt(k.val, "CNY")}</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>≈ {fmt(toVND(k.val, "CNY", settings), "VND")}</div>
            <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>{k.sub}</div>
            {/* v17: Toggle Cách tính cho thẻ Còn phải trả */}
            {k.isOwed && (
              <button onClick={() => setShowCalcKPI(p => !p)}
                style={{ marginTop: 8, padding: "3px 10px", fontSize: 10, background: C.green50, border: `1px solid ${C.green300}`, borderRadius: 6, color: C.green700, cursor: "pointer", fontWeight: 600 }}>
                {showCalcKPI ? "▲ Ẩn cách tính" : "▼ Hiện cách tính"}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* v17: Box "Cách tính Còn phải trả" — toggle ra/vào */}
      {showCalcKPI && (
        <div style={{ background: C.green50, border: `1px solid ${C.green300}`, borderRadius: 10, padding: "14px 18px", marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green800, marginBottom: 10 }}>
            📐 Cách tính "Còn phải trả" {hasFilter ? "(trong kỳ lọc)" : "(toàn bộ lịch sử)"} — tổng tất cả NCC
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "4px 14px", fontSize: 12, alignItems: "center", maxWidth: 500 }}>
            <span style={{ color: C.green700, fontWeight: 700 }}>+</span>
            <span>Nợ đầu kỳ</span>
            <span style={{ fontWeight: 600, textAlign: "right" }}>{fmt(summary.totalPrevDebt, "CNY")}</span>

            <span style={{ color: C.green700, fontWeight: 700 }}>+</span>
            <span>Hàng đã ship {hasFilter ? "(trong kỳ)" : "(toàn bộ)"}</span>
            <span style={{ fontWeight: 600, textAlign: "right" }}>{fmt(hasFilter ? summary.totalShipped : summary.totalShippedCumulative, "CNY")}</span>

            <span style={{ color: C.green700, fontWeight: 700 }}>+</span>
            <span>Đã trả hộ NM khác</span>
            <span style={{ fontWeight: 600, textAlign: "right" }}>{fmt(hasFilter ? summary.totalOutbound : summary.totalOutboundCumulative, "CNY")}</span>

            <span style={{ gridColumn: "1/-1", borderTop: `1px solid ${C.green300}`, marginTop: 4, marginBottom: 4 }}></span>

            <span style={{ color: C.red, fontWeight: 700 }}>−</span>
            <span>Quỹ TD đầu kỳ</span>
            <span style={{ fontWeight: 600, textAlign: "right" }}>{fmt(summary.totalPrevCredit, "CNY")}</span>

            <span style={{ color: C.red, fontWeight: 700 }}>−</span>
            <span>Đã nhận thanh toán</span>
            <span style={{ fontWeight: 600, textAlign: "right" }}>{fmt(hasFilter ? summary.totalInbound : summary.totalInboundCumulative, "CNY")}</span>

            <span style={{ gridColumn: "1/-1", borderTop: `2px solid ${C.green700}`, marginTop: 4, marginBottom: 4 }}></span>

            <span style={{ color: C.green800, fontWeight: 700 }}>=</span>
            <span style={{ fontWeight: 700, color: C.green800 }}>Còn phải trả</span>
            <span style={{ fontWeight: 800, color: C.red, textAlign: "right" }}>{fmt(summary.totalOwed, "CNY")}</span>
          </div>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 10, fontStyle: "italic" }}>
            Lưu ý: Nếu kết quả &lt; 0 → chuyển sang "Quỹ tín dụng". Mỗi NCC tính riêng (không bù chéo giữa các NCC).
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {rows.map(r => {
          const { factory: f } = r;
          const paymentsOfFactoryAll = payments.filter(p => p.toFactoryId === f.id || p.fromFactoryId === f.id);
          // v16: Lọc theo kỳ nếu có filter (lịch sử giao dịch đồng bộ với chỉ số trên)
          const paymentsOfFactory = hasFilter
            ? paymentsOfFactoryAll.filter(p => {
                if (!p.payDate) return false;
                if (filter.dateFrom && p.payDate < filter.dateFrom) return false;
                if (filter.dateTo && p.payDate > filter.dateTo) return false;
                return true;
              })
            : paymentsOfFactoryAll;
          const factoryOpenings = openingBalances.filter(o => o.factoryId === f.id);
          return (
            <div key={f.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{f.name}</div>
                  <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>{f.nameCn} · {f.contactPerson || f.contact || "-"} · {f.email}</div>
                </div>
                {r.creditFund > 0 && (
                  <div style={{ background: C.green50, border: `1px solid ${C.green300}`, borderRadius: 12, padding: "10px 16px" }}>
                    <div style={{ fontSize: 10, color: C.green600, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>💰 Quỹ tín dụng</div>
                    <div style={{ color: C.green700, fontWeight: 700, fontSize: 16 }}>{fmt(r.creditFund, "CNY")}</div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(toVND(r.creditFund, "CNY", settings), "VND")}</div>
                  </div>
                )}
              </div>

              {/* v16: Hàng chờ ship — dòng riêng phía trên 6 ô */}
              <div style={{ background: C.bg, border: `1px dashed ${C.border}`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>🔮 HÀNG CHỜ SHIP</div>
                  <div style={{ fontSize: 11, color: C.textLight, marginTop: 3 }}>Tổng PO đã duyệt còn lại chưa ship · Cam kết tài chính tương lai · KHÔNG lọc theo thời gian</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: C.textMuted, fontWeight: 700, fontSize: 16 }}>{fmt(r.expectedDebt, "CNY")}</div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>≈ {fmt(toVND(r.expectedDebt, "CNY", settings), "VND")}</div>
                </div>
              </div>

              {/* v16: 6 ô bố cục cũ — đổi tên + thêm ghi chú */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 14 }}>
                {[
                  {
                    label: "Nợ đầu kỳ", val: r.prevDebt, color: C.textMuted, bg: C.bg, show: r.prevDebt > 0,
                    note: hasFilter ? `Đến hết ${fmtKy(filter.dateFrom) || "(đầu)"}` : "Số dư từ kỳ trước"
                  },
                  {
                    label: "Quỹ tín dụng đầu kỳ", val: r.prevCredit, color: C.green600, bg: C.green50, show: r.prevCredit > 0,
                    note: hasFilter ? `Đến hết ${fmtKy(filter.dateFrom) || "(đầu)"}` : "Đã trả dư từ kỳ trước"
                  },
                  {
                    label: "Hàng đã ship", val: r.inKyShipped, color: C.orange, bg: C.orangeBg, show: true,
                    note: hasFilter ? "Trong kỳ lọc" : "Lũy kế đến hiện tại"
                  },
                  {
                    label: "Đã nhận thanh toán", val: r.inKyInbound, color: C.blue, bg: C.blueBg, show: true,
                    note: hasFilter ? "Trong kỳ lọc" : "Lũy kế đến hiện tại"
                  },
                  {
                    label: "Đã trả hộ NM khác", val: r.inKyOutbound, color: C.purple, bg: C.purpleBg, show: true,
                    note: "NCC này trả hộ NCC khác"
                  },
                  {
                    // v38: Cột mới — Đang TT (stage 1+2)
                    label: "🟡 Đang TT", val: r.pendingPaidCNY || 0, color: C.orange, bg: C.orangeBg, show: (r.pendingPaidCNY || 0) > 0,
                    note: "Tiền GoChek đã chuyển nhưng NCC chưa nhận (stage 1+2)"
                  },
                  {
                    label: "Còn phải trả", val: r.stillOwed, color: r.stillOwed > 0 ? C.red : C.green600, bg: r.stillOwed > 0 ? C.redBg : C.green50, show: true,
                    note: hasFilter ? `Đến cuối ${fmtKy(filter.dateTo) || "kỳ"}` : "Hiện tại"
                  },
                ].filter(b => b.show).map((b, i) => (
                  <div key={i} style={{ background: b.bg, padding: 10, borderRadius: 10 }}>
                    <div style={{ fontSize: 9, color: b.color, fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>{b.label}</div>
                    <div style={{ color: b.color, fontWeight: 700, fontSize: 13 }}>{fmt(b.val, "CNY")}</div>
                    <div style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>≈ {fmt(toVND(b.val, "CNY", settings), "VND")}</div>
                    <div style={{ fontSize: 9, color: C.textLight, marginTop: 4, fontStyle: "italic" }}>{b.note}</div>
                  </div>
                ))}
              </div>

              {/* v17: Cách tính inline cho từng NCC */}
              <div style={{ background: C.bg, border: `1px dashed ${C.green300}`, borderRadius: 8, padding: "8px 12px", marginBottom: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 11, color: C.text }}>
                <span style={{ fontWeight: 700, color: C.green700, marginRight: 4 }}>📐 Cách tính Còn phải trả:</span>
                {r.prevDebt > 0 && (
                  <>
                    <span style={{ color: C.textMuted }}>{fmt(r.prevDebt, "CNY")}</span>
                    <span style={{ fontSize: 10, color: C.textLight }}>(Nợ đầu kỳ)</span>
                  </>
                )}
                {(r.prevDebt > 0 || r.inKyShipped > 0) && r.inKyShipped > 0 && <span style={{ color: C.green700, fontWeight: 700 }}>+</span>}
                {r.inKyShipped > 0 && (
                  <>
                    <span style={{ color: C.orange }}>{fmt(r.inKyShipped, "CNY")}</span>
                    <span style={{ fontSize: 10, color: C.textLight }}>(Hàng đã ship)</span>
                  </>
                )}
                {r.inKyOutbound > 0 && (
                  <>
                    <span style={{ color: C.green700, fontWeight: 700 }}>+</span>
                    <span style={{ color: C.purple }}>{fmt(r.inKyOutbound, "CNY")}</span>
                    <span style={{ fontSize: 10, color: C.textLight }}>(Đã trả hộ)</span>
                  </>
                )}
                {r.prevCredit > 0 && (
                  <>
                    <span style={{ color: C.red, fontWeight: 700 }}>−</span>
                    <span style={{ color: C.green600 }}>{fmt(r.prevCredit, "CNY")}</span>
                    <span style={{ fontSize: 10, color: C.textLight }}>(Quỹ TD đầu kỳ)</span>
                  </>
                )}
                {r.inKyInbound > 0 && (
                  <>
                    <span style={{ color: C.red, fontWeight: 700 }}>−</span>
                    <span style={{ color: C.blue }}>{fmt(r.inKyInbound, "CNY")}</span>
                    <span style={{ fontSize: 10, color: C.textLight }}>(Đã nhận TT)</span>
                  </>
                )}
                <span style={{ color: C.green800, fontWeight: 800, marginLeft: 4 }}>=</span>
                <span style={{ fontWeight: 800, color: r.stillOwed > 0 ? C.red : C.green600 }}>{fmt(r.stillOwed, "CNY")}</span>
                {r.creditFund > 0 && (
                  <span style={{ fontSize: 10, color: C.textMuted, marginLeft: 6 }}>
                    (đã trả dư · còn quỹ TD <b style={{ color: C.green600 }}>{fmt(r.creditFund, "CNY")}</b>)
                  </span>
                )}
              </div>

              {factoryOpenings.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontWeight: 700 }}>
                    📋 Công nợ đầu kỳ ({factoryOpenings.length}) — TT đang nợ NCC này
                  </div>
                  <table>
                    <thead><tr><th>🌍 TT đang nợ</th><th>Loại</th><th>Ngày</th><th>Số tiền</th><th>Ghi chú</th></tr></thead>
                    <tbody>
                      {factoryOpenings.map(o => (
                        <tr key={o.id}>
                          <td style={{ fontWeight: 600 }}>🌍 {o.market || "(Chưa chọn)"}</td>
                          <td><Badge label={o.type === "debt" ? "Nợ gốc" : "Quỹ tín dụng"} color={o.type === "debt" ? C.red : C.green600} /></td>
                          <td style={{ fontSize: 12 }}>{fmtDate(o.date)}</td>
                          <td style={{ fontWeight: 700, color: o.type === "debt" ? C.red : C.green600 }}>{fmt(o.amount, o.currency)}</td>
                          <td style={{ fontSize: 11, color: C.textMuted }}>{o.note || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {paymentsOfFactory.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, fontWeight: 700 }}>
                    Lịch sử giao dịch ({paymentsOfFactory.length}{hasFilter ? ` trong kỳ / ${paymentsOfFactoryAll.length} tổng` : ""})
                  </div>
                  <div style={{ maxHeight: 200, overflowY: "auto" }}>
                    <table>
                      <thead><tr><th>Ngày</th><th>Loại</th><th>Nguồn/Đích</th><th>Số tiền</th><th>Ghi chú</th></tr></thead>
                      <tbody>
                        {sortByDateDesc(paymentsOfFactory, "payDate", "id").map(p => {
                          const isOutbound = p.fromFactoryId === f.id;
                          const sign = isOutbound ? "-" : "+";
                          const color = isOutbound ? C.purple : C.green600;
                          let source;
                          if (p.type === "MARKET_TO_FACTORY") source = `Từ ${p.fromMarket}`;
                          else if (isOutbound) source = `Trả hộ ${factories.find(x => x.id === p.toFactoryId)?.name}`;
                          else source = `Nhận từ ${factories.find(x => x.id === p.fromFactoryId)?.name}`;
                          return (
                            <tr key={p.id}>
                              <td style={{ fontSize: 12 }}>{fmtDate(p.payDate)}</td>
                              <td><Badge label={PAYMENT_TYPES[p.type]} color={p.type === "MARKET_TO_FACTORY" ? C.blue : C.purple} /></td>
                              <td style={{ fontSize: 12 }}>{source}</td>
                              <td style={{ color, fontWeight: 700 }}>{sign}{fmt(p.amount, p.currency)}</td>
                              <td style={{ fontSize: 11, color: C.textMuted }}>{p.note || "-"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* v11: Popup xuất báo cáo */}
      {exportModal && (
        <Modal title="📥 Xuất báo cáo đối soát" subtitle="Chọn NCC và khoảng thời gian để xuất file Excel"
          onClose={() => setExportModal(null)}
          onSave={() => handleExport(exportModal)}
          saveLabel={exporting ? "Đang xuất..." : "📥 Xuất file Excel"}
          saveDisabled={!exportModal.factoryId || exporting}
          width={560}>
          <div className="form-grid">
            <div className="form-group" style={{ gridColumn: "1/-1" }}>
              <label>Nhà cung cấp *</label>
              <select value={exportModal.factoryId || ""} onChange={e => setExportModal(p => ({ ...p, factoryId: e.target.value }))}>
                <option value="">— Chọn NCC —</option>
                {factories.map(f => <option key={f.id} value={f.id}>{f.supplierCode ? `[${f.supplierCode}] ` : ""}{f.name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Từ ngày</label>
              <input type="date" value={exportModal.dateFrom || ""} onChange={e => setExportModal(p => ({ ...p, dateFrom: e.target.value }))} />
            </div>
            <div className="form-group"><label>Đến ngày</label>
              <input type="date" value={exportModal.dateTo || ""} onChange={e => setExportModal(p => ({ ...p, dateTo: e.target.value }))} />
            </div>
          </div>
          <div className="alert alert-info">
            💡 File Excel (<code>.xls</code>) sẽ gồm <b>5 sheet</b>:<br/>
            1️⃣ Tổng hợp đối soát · 2️⃣ Chi tiết PO · 3️⃣ Chi tiết đơn giao hàng · 4️⃣ Lịch sử thanh toán · 5️⃣ Phí nhập khẩu liên quan.<br/>
            Để trống ngày để xuất tất cả dữ liệu. Mở bằng Excel hoặc Google Sheets.
          </div>
        </Modal>
      )}
      {/* v36: Thay alert() khi xuất file báo cáo Debts */}
      {confirmDlg && <ConfirmDialog {...confirmDlg} onClose={() => setConfirmDlg(null)} />}
    </div>
  );
};

// ============================================================
// MARKET DEBTS — Công nợ theo thị trường
// ============================================================
const MarketDebts = ({ pos, shipments, payments, factories, markets, settings, products, warranties = [], openingBalances = [], user }) => {
  const marketNames = getMarketNames(markets);
  const [expanded, setExpanded] = useState(null);

  // v14: Export Excel báo cáo công nợ thị trường
  const [exportModal, setExportModal] = useState(null);
  const [exporting, setExporting] = useState(false);
  // v36: Thay alert() bằng ConfirmDialog
  const [confirmDlg, setConfirmDlg] = useState(null);
  const canExport = can(user, "export_accounting_report");

  const handleExport = async ({ marketName, isAllMarkets, dateFrom, dateTo }) => {
    if (!isAllMarkets && !marketName) { setConfirmDlg({ title: "Thiếu thông tin", message: "Vui lòng chọn thị trường.", confirmLabel: "OK", cancelLabel: null, onConfirm: () => {} }); return; }
    setExporting(true);
    try {
      const fname = await exportMarketReport({
        marketName, isAllMarkets, pos, shipments, payments, factories, products, markets, warranties,
        openingBalances,
        dateFrom, dateTo, settings,
        exportedBy: user?.fullName || user?.username || "-",
      });
      setConfirmDlg({ title: "✓ Xuất file thành công", message: `Đã xuất file: ${fname}`, confirmLabel: "OK", cancelLabel: null, onConfirm: () => {} });
      setExportModal(null);
    } catch (e) {
      console.error("Export market report error:", e);
      setConfirmDlg({ title: "Lỗi xuất file", message: e.message, danger: true, confirmLabel: "OK", cancelLabel: null, onConfirm: () => {} });
    } finally {
      setExporting(false);
    }
  };

  const balances = useMemo(() => {
    const res = {};
    marketNames.forEach(m => { res[m] = calcMarketBalance(m, pos, shipments, payments, settings, warranties, products, openingBalances); });
    return res;
  }, [pos, shipments, payments, settings, warranties, products, openingBalances]);

  const summary = useMemo(() => {
    let totalReceived = 0, totalPaid = 0, totalPending = 0, totalOwed = 0, totalCredit = 0, totalWarrantyPending = 0;
    marketNames.forEach(m => {
      totalReceived += balances[m].totalReceived;
      totalPaid += balances[m].totalPaid;
      // v38: Đang TT (stage 1+2) — chỉ MARKET_TO_FACTORY
      totalPending += balances[m].pendingPaid || 0;
      totalOwed += balances[m].stillOwed;
      totalCredit += balances[m].creditFund;
      totalWarrantyPending += balances[m].warrantyPending || 0;
    });
    return { totalReceived, totalPaid, totalPending, totalOwed, totalCredit, totalWarrantyPending };
  }, [balances]);

  return (
    <div>
      <SectionHeader title="Công nợ thị trường"
        subtitle="Thị trường nhận hàng → cần thanh toán cho nhà máy · Tự động trừ theo Thanh toán Thị trường → Nhà máy · Hàng đang bảo hành ở NM được treo công nợ tạm thời"
        action={canExport && <button className="btn btn-primary" onClick={() => setExportModal({ isAllMarkets: true })}>📥 Xuất báo cáo công nợ</button>}
      />

      <div className="alert alert-info" style={{ marginBottom: 16 }}>
        <b>Cách tính Còn phải trả (v38):</b> Hàng đã ship − Đã thanh toán (chỉ stage <b>Hoàn tất</b> ✅) − <b>Đang TT</b> (stage 🏦 + 🌐, tiền GoChek đã chuyển nhưng NCC chưa nhận) − Hàng đang BH (treo). Tiền ở stage "Đã chuyển uỷ thác" hoặc "Đang chuyển QT" được tách riêng vào cột "🟡 Đang TT" — chưa giảm "Còn phải trả" của TT cho đến khi NCC xác nhận nhận tiền.
      </div>

      {/* v38: KPI 6 thẻ — thêm "🟡 Đang TT" giữa "Đã thanh toán" và "Hàng đang BH" */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 20 }}>
        {[
          { label: "Hàng đã ship", val: summary.totalReceived, color: C.green700, sub: "Lũy kế đến hiện tại" },
          { label: "✅ Đã thanh toán", val: summary.totalPaid, color: C.blue, sub: "Stage Hoàn tất" },
          { label: "🟡 Đang TT", val: summary.totalPending, color: C.orange, sub: "Stage 🏦 + 🌐 (treo)" },
          { label: "Hàng đang BH", val: summary.totalWarrantyPending, color: C.purple, sub: "Đang treo công nợ" },
          { label: "🟥 Còn phải trả", val: summary.totalOwed, color: C.red, sub: "Số nợ hiện tại" },
          { label: "🟩 Quỹ tín dụng", val: summary.totalCredit, color: C.green600, sub: "TT đã trả dư" },
        ].map((k, i) => (
          <div key={i} className="card" style={{ padding: 12 }}>
            <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: k.color }}>{fmt(k.val, "CNY")}</div>
            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>≈ {fmt(toVND(k.val, "CNY", settings), "VND")}</div>
            <div style={{ fontSize: 10, color: C.textLight, marginTop: 2 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {marketNames.map(m => {
          const b = balances[m];
          const isExpanded = expanded === m;
          const marketPays = payments.filter(p => p.type === "MARKET_TO_FACTORY" && p.fromMarket === m);
          const marketShips = shipments.filter(s => s.market === m);
          const marketWarrantiesPending = warranties.filter(w => w.marketFrom === m && WARRANTY_PENDING_STATUSES.includes(w.status));
          return (
            <div key={m} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", flexWrap: "wrap", gap: 12 }} onClick={() => setExpanded(isExpanded ? null : m)}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ color: C.green500, fontSize: 14, fontWeight: 700 }}>{isExpanded ? "▼" : "▶"}</span>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{m}</div>
                    <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
                      {marketShips.length} lô hàng · {marketPays.length} lần thanh toán
                      {marketWarrantiesPending.length > 0 && <span style={{ color: C.orange, fontWeight: 600 }}> · 🔧 {marketWarrantiesPending.length} lô đang BH</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", fontWeight: 600 }}>Hàng đã ship</div>
                    <div style={{ fontWeight: 700, color: C.green700 }}>{fmt(b.totalReceived, "CNY")}</div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(toVND(b.totalReceived, "CNY", settings), "VND")}</div>
                  </div>
                  {/* v38i: Hiện OB ngay header để user thấy ngay khi chưa expand */}
                  {(b.openingDebtCNY || 0) > 0 && (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", fontWeight: 600 }}>📋 OB nợ gốc</div>
                      <div style={{ fontWeight: 700, color: C.red }}>{fmt(b.openingDebtCNY, "CNY")}</div>
                      <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(toVND(b.openingDebtCNY, "CNY", settings), "VND")}</div>
                    </div>
                  )}
                  {(b.openingCreditCNY || 0) > 0 && (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", fontWeight: 600 }}>📋 OB quỹ TD</div>
                      <div style={{ fontWeight: 700, color: C.green600 }}>{fmt(b.openingCreditCNY, "CNY")}</div>
                      <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(toVND(b.openingCreditCNY, "CNY", settings), "VND")}</div>
                    </div>
                  )}
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", fontWeight: 600 }}>✅ Đã thanh toán</div>
                    <div style={{ fontWeight: 700, color: C.blue }}>{fmt(b.totalPaid, "CNY")}</div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(toVND(b.totalPaid, "CNY", settings), "VND")}</div>
                  </div>
                  {/* v38: Đang TT (stage 1+2) — chỉ hiển thị nếu có */}
                  {(b.pendingPaid || 0) > 0 && (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10, color: C.orange, textTransform: "uppercase", fontWeight: 600 }}>🟡 Đang TT</div>
                      <div style={{ fontWeight: 700, color: C.orange }}>{fmt(b.pendingPaid, "CNY")}</div>
                      <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(toVND(b.pendingPaid, "CNY", settings), "VND")}</div>
                    </div>
                  )}
                  {b.warrantyPending > 0 && (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", fontWeight: 600 }}>🔧 Đang BH (treo)</div>
                      <div style={{ fontWeight: 700, color: C.purple }}>{fmt(b.warrantyPending, "CNY")}</div>
                      <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(toVND(b.warrantyPending, "CNY", settings), "VND")}</div>
                    </div>
                  )}
                  <div style={{ textAlign: "right", padding: "8px 14px", background: b.stillOwed > 0 ? C.redBg : C.green50, borderRadius: 10, minWidth: 160 }}>
                    <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", fontWeight: 600 }}>{b.stillOwed > 0 ? "Còn phải trả" : "Quỹ tín dụng"}</div>
                    <div style={{ fontWeight: 700, color: b.stillOwed > 0 ? C.red : C.green600 }}>{fmt(b.stillOwed > 0 ? b.stillOwed : b.creditFund, "CNY")}</div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(toVND(b.stillOwed > 0 ? b.stillOwed : b.creditFund, "CNY", settings), "VND")}</div>
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div style={{ marginTop: 18, paddingTop: 18, borderTop: `1px solid ${C.borderLight}` }}>
                  {/* v38h: Khung 1 — Tổng hợp công thức tính (có OB) */}
                  <div style={{ background: C.bg, padding: 14, borderRadius: 10, marginBottom: 14, fontSize: 13 }}>
                    <div style={{ fontWeight: 700, color: C.text, marginBottom: 10, fontSize: 13 }}>📐 Công thức tính "Còn phải trả"</div>
                    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "6px 14px", alignItems: "center" }}>
                      <span style={{ color: C.textMuted }}>Hàng đã ship</span>
                      <span></span>
                      <span style={{ fontWeight: 700, color: C.green700, textAlign: "right" }}>+ {fmt(b.totalReceived, "CNY")}</span>

                      {(b.openingDebtCNY || 0) > 0 && <>
                        <span style={{ color: C.textMuted }}>+ OB nợ gốc đầu kỳ</span>
                        <span></span>
                        <span style={{ fontWeight: 700, color: C.red, textAlign: "right" }}>+ {fmt(b.openingDebtCNY, "CNY")}</span>
                      </>}

                      {(b.openingCreditCNY || 0) > 0 && <>
                        <span style={{ color: C.textMuted }}>− OB quỹ tín dụng đầu kỳ</span>
                        <span></span>
                        <span style={{ fontWeight: 700, color: C.green600, textAlign: "right" }}>− {fmt(b.openingCreditCNY, "CNY")}</span>
                      </>}

                      <span style={{ color: C.textMuted }}>− Đã thanh toán (stage Hoàn tất)</span>
                      <span></span>
                      <span style={{ fontWeight: 700, color: C.blue, textAlign: "right" }}>− {fmt(b.totalPaid, "CNY")}</span>

                      {(b.pendingPaid || 0) > 0 && <>
                        <span style={{ color: C.textMuted }}>− Đang TT (stage 1+2)</span>
                        <span></span>
                        <span style={{ fontWeight: 700, color: C.orange, textAlign: "right" }}>− {fmt(b.pendingPaid, "CNY")}</span>
                      </>}

                      {b.warrantyPending > 0 && <>
                        <span style={{ color: C.textMuted }}>− Hàng đang BH (treo)</span>
                        <span></span>
                        <span style={{ fontWeight: 700, color: C.purple, textAlign: "right" }}>− {fmt(b.warrantyPending, "CNY")}</span>
                      </>}

                      <div style={{ gridColumn: "1/-1", borderTop: `1px solid ${C.border}`, marginTop: 4 }}></div>
                      <span style={{ fontWeight: 700, color: C.text }}>= {b.stillOwed > 0 ? "Còn phải trả" : "Quỹ tín dụng"}</span>
                      <span></span>
                      <span style={{ fontWeight: 800, fontSize: 15, color: b.stillOwed > 0 ? C.red : C.green600, textAlign: "right" }}>
                        {fmt(b.stillOwed > 0 ? b.stillOwed : b.creditFund, "CNY")}
                      </span>
                    </div>
                  </div>

                  {/* v38i: Khung 2 — OB breakdown theo NCC (thay cho khung kho V38h) */}
                  {(() => {
                    // Lấy tất cả OB của TT này (đã filter cancelled)
                    const obOfMarket = (openingBalances || []).filter(o =>
                      o.market === m && o.status !== "cancelled"
                    );
                    if (obOfMarket.length === 0) return null;
                    // Group theo factoryId
                    const byFactory = {};
                    obOfMarket.forEach(o => {
                      const fid = o.factoryId;
                      if (!byFactory[fid]) byFactory[fid] = { debt: 0, credit: 0 };
                      const cny = toVND(Number(o.amount || 0), o.currency || "CNY", settings) / settings.cnyToVnd;
                      if (o.type === "debt") byFactory[fid].debt += cny;
                      else byFactory[fid].credit += cny;
                    });
                    return (
                      <div style={{ background: C.white, border: `1px solid ${C.border}`, padding: 14, borderRadius: 10, marginBottom: 14, fontSize: 12 }}>
                        <div style={{ fontWeight: 700, color: C.text, marginBottom: 10, fontSize: 13 }}>📋 OB đầu kỳ — TT này nợ những NCC nào</div>
                        <table style={{ width: "100%", fontSize: 12 }}>
                          <thead>
                            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                              <th style={{ textAlign: "left", padding: "4px 8px" }}>🏭 Nhà cung cấp</th>
                              <th style={{ textAlign: "right", padding: "4px 8px" }}>OB nợ gốc (CNY)</th>
                              <th style={{ textAlign: "right", padding: "4px 8px" }}>OB quỹ TD (CNY)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(byFactory).map(([fid, vals]) => {
                              const f = factories.find(x => x.id === fid);
                              return (
                                <tr key={fid} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>🏭 {f?.name || "(NCC không tồn tại)"}</td>
                                  <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: vals.debt > 0 ? C.red : C.textLight }}>{vals.debt > 0 ? fmt(vals.debt, "CNY") : "—"}</td>
                                  <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: vals.credit > 0 ? C.green600 : C.textLight }}>{vals.credit > 0 ? fmt(vals.credit, "CNY") : "—"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, fontStyle: "italic" }}>
                          💡 Số liệu trên cộng dồn vào "+ OB nợ gốc" / "− OB quỹ tín dụng" trong khung công thức bên trên.
                        </div>
                      </div>
                    );
                  })()}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                    <div>
                      <GreenPill>Lô hàng đã nhận</GreenPill>
                      <div style={{ maxHeight: 280, overflowY: "auto" }}>
                        <table>
                          <thead><tr><th>Mã đơn</th><th>Ngày</th><th>Số lượng</th><th style={{ textAlign: "right" }}>Giá trị</th></tr></thead>
                          <tbody>
                            {marketShips.length === 0 ? (
                              <tr><td colSpan={4} style={{ textAlign: "center", color: C.textMuted, padding: 20 }}>Chưa có lô nào</td></tr>
                            ) : marketShips.map(s => {
                              const qty = (s.items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0);
                              // CNY value
                              const valCNY = (s.items || []).reduce((sum, i) => {
                                const po = pos.find(p => p.id === i.poId);
                                if (!po) return sum;
                                const poItems = getPOItems(po);
                                const poItem = po.items ? poItems.find(it => it.id === i.itemId) : poItems[0];
                                const vnd = toVND(Number(i.quantity) * Number(poItem?.unitPrice || 0), po.currency, settings);
                                return sum + vnd / settings.cnyToVnd;
                              }, 0);
                              return (
                                <tr key={s.id}>
                                  <td style={{ color: C.green600, fontWeight: 600, fontSize: 12 }}>{s.id}</td>
                                  <td style={{ fontSize: 12 }}>{fmtDate(s.departDate)}</td>
                                  <td style={{ fontWeight: 600 }}>{qty.toLocaleString()}</td>
                                  <td style={{ textAlign: "right" }}>
                                    <div style={{ fontWeight: 600, color: C.green700 }}>{fmt(valCNY, "CNY")}</div>
                                    <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(toVND(valCNY, "CNY", settings), "VND")}</div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div>
                      <GreenPill>Lịch sử thanh toán (Thị trường → Nhà máy)</GreenPill>
                      <div style={{ maxHeight: 280, overflowY: "auto" }}>
                        <table>
                          <thead><tr><th>Ngày</th><th>Nhà máy nhận</th><th style={{ textAlign: "right" }}>Số tiền</th><th>Ghi chú</th></tr></thead>
                          <tbody>
                            {marketPays.length === 0 ? (
                              <tr><td colSpan={4} style={{ textAlign: "center", color: C.textMuted, padding: 20 }}>Chưa có thanh toán nào. Vào tab "Thanh toán Nhà máy" để tạo.</td></tr>
                            ) : sortByDateDesc(marketPays, "payDate", "id").map(p => {
                              const toF = factories.find(f => f.id === p.toFactoryId);
                              return (
                                <tr key={p.id}>
                                  <td style={{ fontSize: 12 }}>{fmtDate(p.payDate)}</td>
                                  <td style={{ fontSize: 12 }}>{toF?.name || "-"}</td>
                                  <td style={{ textAlign: "right" }}>
                                    <div style={{ fontWeight: 700, color: C.blue }}>{fmt(p.amount, p.currency)}</div>
                                    <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(toVND(p.amount, p.currency, settings), "VND")}</div>
                                  </td>
                                  <td style={{ fontSize: 11, color: C.textMuted }}>{p.note || "-"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* v14: Modal Export báo cáo công nợ thị trường */}
      {exportModal && (
        <Modal title="Xuất báo cáo công nợ thị trường" onClose={() => !exporting && setExportModal(null)}
          onSave={() => handleExport(exportModal)}
          saveLabel={exporting ? "⏳ Đang xuất..." : "📥 Xuất file"}
          saveDisabled={exporting || (!exportModal.isAllMarkets && !exportModal.marketName)} width={620}>
          <div className="form-grid">
            <div className="form-group" style={{ gridColumn: "1/-1" }}>
              <label>Phạm vi báo cáo *</label>
              <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                <label style={{ flex: 1, padding: 12, border: `1.5px solid ${exportModal.isAllMarkets ? C.green500 : C.border}`, borderRadius: 10, background: exportModal.isAllMarkets ? C.green50 : C.white, cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="radio" checked={!!exportModal.isAllMarkets} onChange={() => setExportModal(p => ({ ...p, isAllMarkets: true, marketName: "" }))} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>🌐 Tất cả thị trường</div>
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Báo cáo tổng hợp, mỗi sheet có cột "Thị trường"</div>
                  </div>
                </label>
                <label style={{ flex: 1, padding: 12, border: `1.5px solid ${!exportModal.isAllMarkets ? C.green500 : C.border}`, borderRadius: 10, background: !exportModal.isAllMarkets ? C.green50 : C.white, cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="radio" checked={!exportModal.isAllMarkets} onChange={() => setExportModal(p => ({ ...p, isAllMarkets: false }))} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>🎯 Một thị trường</div>
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Chọn thị trường cụ thể bên dưới</div>
                  </div>
                </label>
              </div>
            </div>
            {!exportModal.isAllMarkets && (
              <div className="form-group" style={{ gridColumn: "1/-1" }}>
                <label>Thị trường *</label>
                <select value={exportModal.marketName || ""} onChange={e => setExportModal(p => ({ ...p, marketName: e.target.value }))}>
                  <option value="">— Chọn thị trường —</option>
                  {marketNames.map(m => <option key={m} value={m}>{getFlag(m)} {m}</option>)}
                </select>
              </div>
            )}
            <div className="form-group"><label>Từ ngày</label>
              <input type="date" value={exportModal.dateFrom || ""} onChange={e => setExportModal(p => ({ ...p, dateFrom: e.target.value }))} />
            </div>
            <div className="form-group"><label>Đến ngày</label>
              <input type="date" value={exportModal.dateTo || ""} onChange={e => setExportModal(p => ({ ...p, dateTo: e.target.value }))} />
            </div>
          </div>
          <div className="alert alert-info">
            💡 File Excel (<code>.xls</code>) sẽ gồm <b>5 sheet</b>:<br/>
            1️⃣ Tổng hợp · 2️⃣ Chi tiết lô hàng · 3️⃣ Lịch sử thanh toán · 4️⃣ Công nợ theo NCC · 5️⃣ Tồn kho theo SKU.<br/>
            Để trống ngày để xuất tất cả dữ liệu. Tỷ giá CNY → VND áp dụng theo cấu hình hiện tại.
          </div>
        </Modal>
      )}
      {/* v36: Thay alert() khi xuất file báo cáo */}
      {confirmDlg && <ConfirmDialog {...confirmDlg} onClose={() => setConfirmDlg(null)} />}
    </div>
  );
};

// ============================================================
// PAYMENTS
// ============================================================
const PaymentMarketToFactoryForm = ({ factories, pos, shipments, payments, openingBalances, markets, settings, onSave, onClose }) => {
  const marketNames = getMarketNames(markets);
  const [form, setForm] = useState({
    fromMarket: marketNames[0] || "Vietnam", toFactoryId: factories[0]?.id || "",
    amount: "", currency: "CNY", payDate: new Date().toISOString().slice(0, 10), note: "",
    // v34: Mặc định tỷ giá CNY hệ thống. User có thể sửa thành tỷ giá thực tế NH áp dụng.
    exchangeRate: settings?.cnyToVnd || 1,
    amountInVND: 0,
    // v38: Mặc định stage = "completed" để giữ behavior cũ (user không quan tâm 3 stage thì tạo xong là hoàn tất).
    // User có thể đổi nếu muốn tracking dòng tiền chi tiết.
    paymentStage: "completed",
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const balance = useMemo(() => form.toFactoryId ? calcFactoryBalance(form.toFactoryId, pos, shipments, payments, openingBalances, factories, settings) : null, [form.toFactoryId, pos, shipments, payments, openingBalances, factories, settings]);
  const amountNum = Number(form.amount || 0);
  const willExceed = balance && amountNum > balance.stillOwed;
  const excess = willExceed ? amountNum - balance.stillOwed : 0;

  // v34: Tỷ giá hệ thống cho currency hiện tại
  const systemRate = form.currency === "VND" ? 1
    : (settings?.[`${form.currency.toLowerCase()}ToVnd`] || 1);

  // v34: Khi đổi currency → reset tỷ giá về hệ thống mới
  const handleCurrencyChange = (c) => {
    const newRate = c === "VND" ? 1 : (settings?.[`${c.toLowerCase()}ToVnd`] || 1);
    setForm(p => ({ ...p, currency: c, exchangeRate: newRate }));
  };

  // v34: amountInVND luôn được tính từ amount × exchangeRate (không lưu trong state, tính khi save)
  const computedAmountInVND = amountNum * Number(form.exchangeRate || 0);

  // v38: Build stageHistory entry khi save
  const buildStageHistory = (stage) => [{ stage, at: form.payDate, by: "(form create)" }];

  return (
    <Modal title="Thanh toán: Thị trường → Nhà máy" onClose={onClose}
      onSave={() => onSave({
        type: "MARKET_TO_FACTORY", ...form,
        amount: amountNum, exchangeRate: Number(form.exchangeRate || 1), amountInVND: computedAmountInVND,
        // v38: Lưu stage hiện tại + stageHistory với entry đầu tiên
        paymentStage: form.paymentStage,
        stageHistory: buildStageHistory(form.paymentStage),
      })}
      saveDisabled={!amountNum || (form.currency !== "VND" && !Number(form.exchangeRate))}>
      <div className="form-grid">
        <div className="form-group"><label>Nguồn tiền</label>
          <select value={form.fromMarket} onChange={e => set("fromMarket", e.target.value)}>
            {marketNames.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Nhà máy nhận</label>
          <select value={form.toFactoryId} onChange={e => set("toFactoryId", e.target.value)}>
            {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Số tiền</label>
          <input type="number" step="0.01" min={0} value={form.amount} onChange={e => set("amount", e.target.value)} />
        </div>
        <div className="form-group"><label>Tiền tệ</label>
          <select value={form.currency} onChange={e => handleCurrencyChange(e.target.value)}>
            {["CNY", "USD", "VND"].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Ngày thanh toán</label>
          <input type="date" value={form.payDate} onChange={e => set("payDate", e.target.value)} />
        </div>
        {form.currency !== "VND" && (
          <>
            <div className="form-group">
              <label>Tỷ giá tại ngày trả * <span style={{ fontSize: 10, color: C.textMuted, fontWeight: 400 }}>(1 {form.currency} = ? VND)</span></label>
              <input type="number" min={0} step="0.01" value={form.exchangeRate} onChange={e => set("exchangeRate", e.target.value)} />
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>
                ℹ️ Tỷ giá hệ thống: <b>{systemRate.toLocaleString("vi-VN")}</b>
                {Number(form.exchangeRate) !== systemRate && Number(form.exchangeRate) > 0 && (
                  <span style={{ color: C.orange, marginLeft: 6 }}>(đã sửa)</span>
                )}
              </div>
            </div>
            <div className="form-group">
              <label>Quy đổi VND</label>
              <input type="text" value={computedAmountInVND.toLocaleString("vi-VN") + " VND"} disabled style={{ background: C.green50, fontWeight: 700, color: C.green800 }} />
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>
                = {amountNum.toLocaleString("vi-VN")} {form.currency} × {Number(form.exchangeRate || 0).toLocaleString("vi-VN")}
              </div>
            </div>
          </>
        )}
        <div className="form-group" style={{ gridColumn: "1/-1" }}>
          <label>Trạng thái thanh toán <span style={{ color: C.textMuted, fontSize: 10, fontWeight: 400 }}>(v38)</span></label>
          <select value={form.paymentStage} onChange={e => set("paymentStage", e.target.value)}
            style={{ borderColor: PAYMENT_STAGES[form.paymentStage]?.color }}>
            {Object.values(PAYMENT_STAGES).map(s => (
              <option key={s.id} value={s.id}>{s.icon} {s.label}</option>
            ))}
          </select>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4, lineHeight: 1.5 }}>
            {PAYMENT_STAGES[form.paymentStage]?.description}
          </div>
          {form.paymentStage !== "completed" && (
            <div style={{ fontSize: 10, color: C.orange, marginTop: 4, fontWeight: 600 }}>
              ⚠ Tiền sẽ được tính vào "Đang TT" (chưa giảm Còn phải trả của NCC). Khi NCC xác nhận nhận được → vào tab Thanh toán bấm chuyển sang "Hoàn tất".
            </div>
          )}
        </div>
        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Ghi chú</label>
          <textarea rows={2} value={form.note} onChange={e => set("note", e.target.value)} />
        </div>
      </div>
      {balance && (
        <div className="alert alert-info">
          <div><b>{factories.find(f => f.id === form.toFactoryId)?.name}</b></div>
          <div>Còn nợ: <b>{fmt(balance.stillOwed, "CNY")}</b> (≈ {fmt(toVND(balance.stillOwed, "CNY", settings), "VND")})</div>
          <div>Quỹ tín dụng: <b>{fmt(balance.creditFund, "CNY")}</b></div>
          {willExceed && (
            <div style={{ marginTop: 6, color: form.fromMarket === "Thailand" ? C.green600 : C.orange, fontWeight: 600 }}>
              {form.fromMarket === "Thailand" ? "✓" : "⚠"} Vượt công nợ {fmt(excess, form.currency)} → vào Quỹ tín dụng
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

const PaymentInterFactoryForm = ({ factories, pos, shipments, payments, openingBalances, settings, onSave, onClose }) => {
  const [form, setForm] = useState({
    fromFactoryId: factories[0]?.id || "", toFactoryId: factories[1]?.id || "",
    amount: "", currency: "CNY", payDate: new Date().toISOString().slice(0, 10), note: "",
    // v34: Mặc định tỷ giá CNY hệ thống
    exchangeRate: settings?.cnyToVnd || 1,
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const amountNum = Number(form.amount || 0);
  const fromBalance = form.fromFactoryId ? calcFactoryBalance(form.fromFactoryId, pos, shipments, payments, openingBalances, factories, settings) : null;
  const toBalance = form.toFactoryId ? calcFactoryBalance(form.toFactoryId, pos, shipments, payments, openingBalances, factories, settings) : null;

  // v34: Tỷ giá hệ thống cho currency hiện tại
  const systemRate = form.currency === "VND" ? 1
    : (settings?.[`${form.currency.toLowerCase()}ToVnd`] || 1);

  const handleCurrencyChange = (c) => {
    const newRate = c === "VND" ? 1 : (settings?.[`${c.toLowerCase()}ToVnd`] || 1);
    setForm(p => ({ ...p, currency: c, exchangeRate: newRate }));
  };

  const computedAmountInVND = amountNum * Number(form.exchangeRate || 0);

  return (
    <Modal title="Chuyển nợ liên nhà máy" onClose={onClose}
      onSave={() => onSave({
        type: "INTER_FACTORY", ...form,
        amount: amountNum, exchangeRate: Number(form.exchangeRate || 1), amountInVND: computedAmountInVND,
        // v38: INTER_FACTORY luôn là completed (không có UI stage). Vẫn lưu stageHistory để nhất quán.
        paymentStage: "completed",
        stageHistory: [{ stage: "completed", at: form.payDate, by: "(form inter-factory)" }],
      })}
      saveDisabled={!amountNum || form.fromFactoryId === form.toFactoryId || (form.currency !== "VND" && !Number(form.exchangeRate))}>
      <div className="form-grid">
        <div className="form-group"><label>Nhà máy trả hộ (A)</label>
          <select value={form.fromFactoryId} onChange={e => set("fromFactoryId", e.target.value)}>
            {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Nhà máy được trả (B)</label>
          <select value={form.toFactoryId} onChange={e => set("toFactoryId", e.target.value)}>
            {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Số tiền</label>
          <input type="number" step="0.01" min={0} value={form.amount} onChange={e => set("amount", e.target.value)} />
        </div>
        <div className="form-group"><label>Tiền tệ</label>
          <select value={form.currency} onChange={e => handleCurrencyChange(e.target.value)}>
            {["CNY", "USD", "VND"].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Ngày</label>
          <input type="date" value={form.payDate} onChange={e => set("payDate", e.target.value)} />
        </div>
        {form.currency !== "VND" && (
          <>
            <div className="form-group">
              <label>Tỷ giá tại ngày trả * <span style={{ fontSize: 10, color: C.textMuted, fontWeight: 400 }}>(1 {form.currency} = ? VND)</span></label>
              <input type="number" min={0} step="0.01" value={form.exchangeRate} onChange={e => set("exchangeRate", e.target.value)} />
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>
                ℹ️ Tỷ giá hệ thống: <b>{systemRate.toLocaleString("vi-VN")}</b>
                {Number(form.exchangeRate) !== systemRate && Number(form.exchangeRate) > 0 && (
                  <span style={{ color: C.orange, marginLeft: 6 }}>(đã sửa)</span>
                )}
              </div>
            </div>
            <div className="form-group">
              <label>Quy đổi VND</label>
              <input type="text" value={computedAmountInVND.toLocaleString("vi-VN") + " VND"} disabled style={{ background: C.green50, fontWeight: 700, color: C.green800 }} />
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>
                = {amountNum.toLocaleString("vi-VN")} {form.currency} × {Number(form.exchangeRate || 0).toLocaleString("vi-VN")}
              </div>
            </div>
          </>
        )}
        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Ghi chú</label>
          <textarea rows={2} value={form.note} onChange={e => set("note", e.target.value)} />
        </div>
      </div>
      {form.fromFactoryId === form.toFactoryId && <div className="alert alert-danger">Nhà máy A và B phải khác nhau</div>}
      {amountNum > 0 && fromBalance && toBalance && form.fromFactoryId !== form.toFactoryId && (
        <div className="alert alert-warn">
          <div><b>{factories.find(f => f.id === form.fromFactoryId)?.name}</b>: nợ {fmt(fromBalance.stillOwed, "CNY")} → {fmt(fromBalance.stillOwed + amountNum, "CNY")}</div>
          <div><b>{factories.find(f => f.id === form.toFactoryId)?.name}</b>: nợ {fmt(toBalance.stillOwed, "CNY")} → {fmt(Math.max(0, toBalance.stillOwed - amountNum), "CNY")}</div>
        </div>
      )}
    </Modal>
  );
};

const Payments = ({ pos, shipments, payments, factories, openingBalances, markets, settings, onAdd, onEdit, onDelete, user }) => {
  const marketNames = getMarketNames(markets);
  const [modal, setModal] = useState(null);
  // v38: Thêm filter stage
  const [filter, setFilter] = useState({ type: "", factory: "", stage: "", showCancelled: true });
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // v20: Dialog hủy + xác nhận
  const [cancelDlg, setCancelDlg] = useState(null);
  // v38: Dialog xác nhận chuyển stage
  const [stageDlg, setStageDlg] = useState(null);

  const canCreate = can(user, "create_payment");
  // v20: Quyền hủy = quyền xóa cũ (Hủy thay vì Xóa)
  const canCancel = can(user, "delete_payment");
  const canEdit = can(user, "create_payment"); // ai tạo được thì sửa được
  const isAdmin = user?.role === "admin";

  const filtered = useMemo(() => {
    const matched = filterByDateRange(payments, "payDate", dateFrom, dateTo).filter(p =>
      (!filter.type || p.type === filter.type) &&
      (!filter.factory || p.toFactoryId === filter.factory || p.fromFactoryId === filter.factory) &&
      // v38: Filter theo stage (chỉ áp dụng cho MARKET_TO_FACTORY vì INTER luôn completed)
      (!filter.stage || getPaymentStage(p) === filter.stage) &&
      (filter.showCancelled || p.status !== "cancelled")
    );
    // v38b: Sort theo payDate desc với tie-break ID (thay .slice().reverse())
    return sortByDateDesc(matched, "payDate", "id");
  }, [payments, filter, dateFrom, dateTo]);

  // v38b: filtered đã sort, không cần reverse riêng nữa
  const { page, setPage, pageSize, setPageSize, paginatedItems: pagedFiltered } = usePagination(filtered, 50);

  const handleCancel = (p) => {
    setCancelDlg({
      title: `Hủy thanh toán ${p.id}?`,
      payment: p,
    });
  };

  // v38: Chuyển stage payment — chỉ áp dụng cho MARKET_TO_FACTORY.
  // Validate: không cho lùi từ "completed" về stage khác.
  const handleStageChange = (p, newStage) => {
    const oldStage = getPaymentStage(p);
    if (oldStage === newStage) return;
    if (oldStage === "completed" && newStage !== "completed") {
      setStageDlg({
        title: "Không thể quay lùi từ 'Hoàn tất'",
        message: "Payment đã ở trạng thái 'Hoàn tất thanh toán' — KHÔNG thể quay về stage trước. Nếu cần sửa, hãy hủy payment này và tạo lại.",
        danger: true, cancelLabel: null, confirmLabel: "Đã hiểu",
        onConfirm: () => {},
      });
      return;
    }
    const stageLabel = PAYMENT_STAGES[newStage]?.label;
    setStageDlg({
      title: `Chuyển sang "${stageLabel}"?`,
      message: `Payment ${p.id} sẽ chuyển từ "${PAYMENT_STAGES[oldStage]?.label}" → "${stageLabel}".\n\n${
        newStage === "completed"
          ? "⚠ Sau khi hoàn tất, KHÔNG thể quay lùi nữa."
          : "Có thể quay lại stage trước nếu cần (trừ khi đã Hoàn tất)."
      }`,
      confirmLabel: "Xác nhận chuyển",
      onConfirm: () => {
        const newEntry = makeStageHistoryEntry(newStage, user?.fullName || user?.username || "(unknown)");
        onEdit("payments", p.id, {
          paymentStage: newStage,
          stageHistory: [...(Array.isArray(p.stageHistory) ? p.stageHistory : []), newEntry],
        });
      },
    });
  };

  return (
    <div>
      <SectionHeader title="Thanh toán công nợ" subtitle="Quản lý giao dịch thanh toán với nhà máy · Hủy thay vì Xóa để giữ dấu vết audit"
        action={canCreate && (
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-primary" onClick={() => setModal({ type: "MARKET_TO_FACTORY" })}>+ Thanh toán Thị trường → Nhà máy</button>
            <button className="btn btn-purple" onClick={() => setModal({ type: "INTER_FACTORY" })}>+ Chuyển nợ liên nhà máy</button>
          </div>
        )}
      />
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: "14px 18px", marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <select style={{ width: 220 }} value={filter.type} onChange={e => setFilter(p => ({ ...p, type: e.target.value }))}>
          <option value="">Tất cả loại</option>
          <option value="MARKET_TO_FACTORY">Thị trường → Nhà máy</option>
          <option value="INTER_FACTORY">Liên nhà máy</option>
        </select>
        <select style={{ width: 220 }} value={filter.factory} onChange={e => setFilter(p => ({ ...p, factory: e.target.value }))}>
          <option value="">Tất cả nhà máy</option>
          {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        {/* v38: Filter theo stage thanh toán */}
        <select style={{ width: 200 }} value={filter.stage} onChange={e => setFilter(p => ({ ...p, stage: e.target.value }))}>
          <option value="">Tất cả trạng thái</option>
          {Object.values(PAYMENT_STAGES).map(s => (
            <option key={s.id} value={s.id}>{s.icon} {s.label}</option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textMuted, cursor: "pointer" }}>
          <input type="checkbox" checked={filter.showCancelled} onChange={e => setFilter(p => ({ ...p, showCancelled: e.target.checked }))} /> Hiện cả đã hủy
        </label>
        <div style={{ flex: 1, minWidth: 300 }}>
          <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} onReset={() => { setDateFrom(""); setDateTo(""); }} />
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead><tr><th>Mã</th><th>Loại</th><th>Nguồn</th><th>Đích</th><th>Số tiền</th><th>Ngày</th><th>Trạng thái</th><th>Ghi chú</th>{(canEdit || canCancel) && <th></th>}</tr></thead>
          <tbody>
            {pagedFiltered.map(p => {
              const fromF = p.fromFactoryId ? factories.find(f => f.id === p.fromFactoryId) : null;
              const toF = p.toFactoryId ? factories.find(f => f.id === p.toFactoryId) : null;
              const isCancelled = p.status === "cancelled";
              const rowStyle = isCancelled ? { opacity: 0.55, textDecoration: "line-through" } : {};
              // v38: Stage info
              const stage = getPaymentStage(p);
              const stageInfo = PAYMENT_STAGES[stage];
              const overdue = p.type === "MARKET_TO_FACTORY" ? checkPaymentStageOverdue(p, settings) : { exceeded: false, days: 0, threshold: 0 };
              const showStageColumn = p.type === "MARKET_TO_FACTORY"; // Inter-factory: chỉ hiển thị "Hoàn tất" tĩnh
              return (
                <tr key={p.id} style={isCancelled ? { background: C.bg } : (overdue.exceeded ? { background: "#FFF7ED" } : {})}>
                  <td style={{ color: C.green600, fontWeight: 600, ...rowStyle }}>
                    {p.id}
                    {isCancelled && <div style={{ fontSize: 9, color: C.red, fontWeight: 700, marginTop: 3, textDecoration: "none" }}>🚫 ĐÃ HỦY</div>}
                  </td>
                  <td style={rowStyle}><Badge label={PAYMENT_TYPES[p.type]} color={p.type === "MARKET_TO_FACTORY" ? C.blue : C.purple} /></td>
                  <td style={{ fontSize: 12, ...rowStyle }}>{p.type === "MARKET_TO_FACTORY" ? <Badge label={p.fromMarket} color={C.green500} /> : fromF?.name}</td>
                  <td style={{ fontSize: 12, ...rowStyle }}>{toF?.name}</td>
                  <td style={rowStyle}>
                    <div style={{ color: isCancelled ? C.textMuted : C.green600, fontWeight: 700 }}>{fmt(p.amount, p.currency)}</div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>
                      ≈ {fmt(p.amountInVND ?? toVND(p.amount, p.currency, settings), "VND")}
                      {p.exchangeRate && p.currency !== "VND" && (
                        <span style={{ marginLeft: 4 }}>(TG: {Number(p.exchangeRate).toLocaleString("vi-VN")})</span>
                      )}
                    </div>
                  </td>
                  <td style={{ fontSize: 12, ...rowStyle }}>{fmtDate(p.payDate)}</td>
                  {/* v38: Cột trạng thái stage */}
                  <td style={rowStyle}>
                    {showStageColumn ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <Badge label={`${stageInfo.icon} ${stageInfo.short}`} color={stageInfo.color} bg={stageInfo.bg} />
                        {overdue.exceeded && !isCancelled && (
                          <div style={{ fontSize: 9, color: C.orange, fontWeight: 700 }}>
                            ⚠ Treo {overdue.days} ngày (&gt;{overdue.threshold})
                          </div>
                        )}
                        {!isCancelled && stage !== "completed" && canEdit && (
                          <div style={{ display: "flex", gap: 3, marginTop: 2 }}>
                            {stage === "carrier" && (
                              <button className="btn btn-ghost" style={{ padding: "2px 6px", fontSize: 9, color: PAYMENT_STAGES.transferring.color }}
                                onClick={() => handleStageChange(p, "transferring")}>→ Đang chuyển QT</button>
                            )}
                            {stage === "transferring" && (
                              <button className="btn btn-ghost" style={{ padding: "2px 6px", fontSize: 9, color: PAYMENT_STAGES.completed.color }}
                                onClick={() => handleStageChange(p, "completed")}>→ Hoàn tất</button>
                            )}
                            {stage === "transferring" && (
                              <button className="btn btn-ghost" style={{ padding: "2px 6px", fontSize: 9, color: C.textMuted }}
                                onClick={() => handleStageChange(p, "carrier")}>← Quay UT</button>
                            )}
                            {stage === "carrier" && (
                              <button className="btn btn-ghost" style={{ padding: "2px 6px", fontSize: 9, color: PAYMENT_STAGES.completed.color }}
                                onClick={() => handleStageChange(p, "completed")}>→ Hoàn tất</button>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: C.textLight }}>—</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: C.textMuted, ...rowStyle }}>
                    {p.note || "-"}
                    {isCancelled && p.cancelReason && <div style={{ fontSize: 10, color: C.red, marginTop: 3, fontStyle: "italic", textDecoration: "none" }}>Lý do hủy: {p.cancelReason}</div>}
                  </td>
                  {(canEdit || canCancel) && (
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        {!isCancelled && canEdit && <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: p })}>Sửa</button>}
                        {!isCancelled && canCancel && <button className="btn btn-danger" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => handleCancel(p)}>Hủy</button>}
                        {isCancelled && isAdmin && <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: p })}>Sửa</button>}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>
      {modal?.type === "MARKET_TO_FACTORY" && <PaymentMarketToFactoryForm factories={factories} pos={pos} shipments={shipments} payments={payments} openingBalances={openingBalances} markets={markets} settings={settings}
        onSave={f => { onAdd("payments", { id: `PAY-${uid()}`, status: "active", ...f }); setModal(null); }} onClose={() => setModal(null)} />}
      {modal?.type === "INTER_FACTORY" && <PaymentInterFactoryForm factories={factories} pos={pos} shipments={shipments} payments={payments} openingBalances={openingBalances} settings={settings}
        onSave={f => { onAdd("payments", { id: `PAY-${uid()}`, status: "active", ...f }); setModal(null); }} onClose={() => setModal(null)} />}
      {/* v20: Modal sửa thanh toán */}
      {modal?.type === "edit" && <PaymentEditForm initial={modal.data} factories={factories} markets={markets} settings={settings} isAdmin={isAdmin}
        onSave={f => { onEdit("payments", modal.data.id, { ...f, lastEditedBy: user?.fullName || user?.username, lastEditedAt: new Date().toISOString() }); setModal(null); }}
        onClose={() => setModal(null)} />}
      {/* v20: Dialog hủy thanh toán */}
      {cancelDlg && <PromptDialog title={cancelDlg.title} message={`Sau khi hủy, thanh toán sẽ KHÔNG tính vào công nợ nhưng vẫn lưu trong lịch sử để audit. Bạn có chắc?`}
        placeholder="VD: Ghi nhầm số tiền, sai NCC nhận, trùng giao dịch..."
        confirmLabel="🚫 Xác nhận Hủy" required={true} multiline={false}
        onConfirm={(reason) => {
          onEdit("payments", cancelDlg.payment.id, {
            status: "cancelled",
            cancelReason: reason,
            cancelledBy: user?.fullName || user?.username,
            cancelledAt: new Date().toISOString(),
          });
          setCancelDlg(null);
        }}
        onClose={() => setCancelDlg(null)} />}
      {/* v38: Dialog xác nhận chuyển stage */}
      {stageDlg && <ConfirmDialog {...stageDlg} onClose={() => setStageDlg(null)} />}
    </div>
  );
};

// v20: Form sửa thanh toán — phân quyền theo nhóm trường
// v34: Bổ sung ô "Tỷ giá tại ngày trả" — prefill từ settings, user có thể sửa
const PaymentEditForm = ({ initial, factories, markets, settings, isAdmin, onSave, onClose }) => {
  const [form, setForm] = useState({ ...initial });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const marketNames = getMarketNames(markets);

  // Phân nhóm trường:
  // - Sửa tự do (mọi user): note, payer
  // - Sửa giới hạn (mọi user): amount, payDate, currency, exchangeRate
  // - Khóa cứng (chỉ admin): id, type, fromMarket, fromFactoryId, toFactoryId
  const lockHardFields = !isAdmin;

  // v34: Tỷ giá hệ thống hiện tại của currency đang chọn (để hiển thị tham chiếu)
  const currentCurrency = form.currency || "CNY";
  const systemRate = currentCurrency === "VND" ? 1
    : (settings?.[`${currentCurrency.toLowerCase()}ToVnd`] || 1);

  // v34: Khi đổi currency → reset exchangeRate về tỷ giá hệ thống mới
  const handleCurrencyChange = (newCurrency) => {
    const newRate = newCurrency === "VND" ? 1 : (settings?.[`${newCurrency.toLowerCase()}ToVnd`] || 1);
    setForm(p => ({
      ...p,
      currency: newCurrency,
      exchangeRate: newRate,
      amountInVND: Number(p.amount || 0) * newRate,
    }));
  };

  // v34: Khi đổi amount hoặc exchangeRate → tự tính lại amountInVND
  const handleAmountChange = (newAmount) => {
    const amt = Number(newAmount || 0);
    setForm(p => ({ ...p, amount: amt, amountInVND: amt * Number(p.exchangeRate || 1) }));
  };
  const handleRateChange = (newRate) => {
    const rate = Number(newRate || 0);
    setForm(p => ({ ...p, exchangeRate: rate, amountInVND: Number(p.amount || 0) * rate }));
  };

  return (
    <Modal title={`Sửa thanh toán ${initial.id}`} onClose={onClose} onSave={() => onSave(form)} width={680}>
      {!isAdmin && (
        <div className="alert alert-info" style={{ marginBottom: 12 }}>
          ℹ️ Bạn có thể sửa: số tiền, ngày, tiền tệ, người TT, ghi chú. Nếu cần đổi NCC/TT/loại GD → vui lòng <b>Hủy</b> giao dịch và tạo mới, hoặc nhờ admin sửa.
        </div>
      )}
      {isAdmin && initial.status === "cancelled" && (
        <div className="alert alert-danger" style={{ marginBottom: 12 }}>
          ⚠️ Bạn đang sửa giao dịch <b>đã hủy</b>. Nếu muốn kích hoạt lại, hãy đổi trạng thái sang <b>Hoạt động</b> ở dưới.
        </div>
      )}
      <div className="form-grid">
        <div className="form-group"><label>Mã giao dịch</label>
          <input value={form.id || ""} disabled />
        </div>
        <div className="form-group"><label>Loại {lockHardFields && "🔒"}</label>
          <input value={PAYMENT_TYPES[form.type] || form.type} disabled={lockHardFields} />
        </div>
        {form.type === "MARKET_TO_FACTORY" ? (
          <>
            <div className="form-group"><label>Thị trường nguồn {lockHardFields && "🔒"}</label>
              <select value={form.fromMarket || ""} onChange={e => set("fromMarket", e.target.value)} disabled={lockHardFields}>
                {marketNames.map(m => <option key={m} value={m}>{getFlag(m)} {m}</option>)}
              </select>
            </div>
            <div className="form-group"><label>NCC nhận {lockHardFields && "🔒"}</label>
              <select value={form.toFactoryId || ""} onChange={e => set("toFactoryId", e.target.value)} disabled={lockHardFields}>
                {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          </>
        ) : (
          <>
            <div className="form-group"><label>NCC nguồn {lockHardFields && "🔒"}</label>
              <select value={form.fromFactoryId || ""} onChange={e => set("fromFactoryId", e.target.value)} disabled={lockHardFields}>
                {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>NCC nhận {lockHardFields && "🔒"}</label>
              <select value={form.toFactoryId || ""} onChange={e => set("toFactoryId", e.target.value)} disabled={lockHardFields}>
                {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          </>
        )}
        <div className="form-group"><label>Số tiền *</label>
          <input type="number" min={0} value={form.amount || ""} onChange={e => handleAmountChange(e.target.value)} />
        </div>
        <div className="form-group"><label>Tiền tệ</label>
          <select value={form.currency || "CNY"} onChange={e => handleCurrencyChange(e.target.value)}>
            {["CNY", "VND", "USD", "THB", "MYR", "PHP"].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {currentCurrency !== "VND" && (
          <>
            <div className="form-group">
              <label>Tỷ giá tại ngày trả * <span style={{ fontSize: 10, color: C.textMuted, fontWeight: 400 }}>(1 {currentCurrency} = ? VND)</span></label>
              <input type="number" min={0} step="0.01" value={form.exchangeRate || ""} onChange={e => handleRateChange(e.target.value)} placeholder={`VD: ${systemRate}`} />
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>
                ℹ️ Tỷ giá tham chiếu hệ thống: <b>{systemRate.toLocaleString("vi-VN")}</b>
                {Number(form.exchangeRate || 0) !== systemRate && Number(form.exchangeRate || 0) > 0 && (
                  <span style={{ color: C.orange, marginLeft: 6 }}>(đã sửa khác hệ thống)</span>
                )}
              </div>
            </div>
            <div className="form-group">
              <label>Quy đổi VND</label>
              <input type="text" value={Number(form.amountInVND || 0).toLocaleString("vi-VN") + " VND"} disabled style={{ background: C.green50, fontWeight: 700, color: C.green800 }} />
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>
                = {Number(form.amount || 0).toLocaleString("vi-VN")} {currentCurrency} × {Number(form.exchangeRate || 0).toLocaleString("vi-VN")}
              </div>
            </div>
          </>
        )}
        <div className="form-group"><label>Ngày *</label>
          <input type="date" value={form.payDate || ""} onChange={e => set("payDate", e.target.value)} />
        </div>
        <div className="form-group"><label>Người thanh toán</label>
          <input value={form.payer || ""} onChange={e => set("payer", e.target.value)} placeholder="Ai thực hiện" />
        </div>
        {isAdmin && (
          <div className="form-group"><label>Trạng thái (admin)</label>
            <select value={form.status || "active"} onChange={e => set("status", e.target.value)}>
              <option value="active">Hoạt động</option>
              <option value="cancelled">Đã hủy</option>
            </select>
          </div>
        )}
        {/* v38: Dropdown chuyển stage (chỉ MARKET_TO_FACTORY). Chặn lùi từ "completed". */}
        {form.type === "MARKET_TO_FACTORY" && (() => {
          const currentStage = form.paymentStage || initial.paymentStage || "completed";
          const initialStage = initial.paymentStage || "completed";
          const lockedToCompleted = initialStage === "completed";
          return (
            <div className="form-group" style={{ gridColumn: "1/-1" }}>
              <label>Trạng thái thanh toán {lockedToCompleted && "🔒"}</label>
              <select
                value={currentStage}
                disabled={lockedToCompleted}
                onChange={e => {
                  const newStage = e.target.value;
                  const newEntry = makeStageHistoryEntry(newStage, "(form edit)");
                  setForm(p => ({
                    ...p,
                    paymentStage: newStage,
                    stageHistory: [...(Array.isArray(p.stageHistory) ? p.stageHistory : []), newEntry],
                  }));
                }}
                style={{ borderColor: PAYMENT_STAGES[currentStage]?.color }}>
                {Object.values(PAYMENT_STAGES).map(s => (
                  <option key={s.id} value={s.id}>{s.icon} {s.label}</option>
                ))}
              </select>
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4, lineHeight: 1.5 }}>
                {PAYMENT_STAGES[currentStage]?.description}
              </div>
              {lockedToCompleted && (
                <div style={{ fontSize: 10, color: C.red, marginTop: 4, fontWeight: 600 }}>
                  🔒 Đã ở "Hoàn tất" — không thể quay lui. Nếu cần đảo ngược, hủy payment này và tạo mới.
                </div>
              )}
              {!lockedToCompleted && currentStage === "completed" && initialStage !== "completed" && (
                <div style={{ fontSize: 10, color: C.orange, marginTop: 4, fontWeight: 600 }}>
                  ⚠ Sau khi lưu, stage "Hoàn tất" sẽ bị KHÓA — không thể quay lui.
                </div>
              )}
              {Array.isArray(form.stageHistory) && form.stageHistory.length > 0 && (
                <div style={{ marginTop: 8, padding: 8, background: C.bg, borderRadius: 6, fontSize: 10 }}>
                  <div style={{ fontWeight: 600, color: C.textMuted, marginBottom: 4 }}>Lịch sử stage:</div>
                  {form.stageHistory.map((h, i) => (
                    <div key={i} style={{ color: C.text, marginBottom: 2 }}>
                      {PAYMENT_STAGES[h.stage]?.icon} {PAYMENT_STAGES[h.stage]?.short} · {fmtDate(h.at)} · <i>{h.by}</i>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Ghi chú</label>
          <textarea rows={2} value={form.note || ""} onChange={e => set("note", e.target.value)} />
        </div>
        {form.lastEditedAt && (
          <div className="form-group" style={{ gridColumn: "1/-1", fontSize: 11, color: C.textMuted, fontStyle: "italic" }}>
            Lần sửa cuối: {form.lastEditedBy || "—"} · {new Date(form.lastEditedAt).toLocaleString("vi-VN")}
          </div>
        )}
      </div>
    </Modal>
  );
};

// ============================================================
// FACTORIES / NHÀ CUNG CẤP v10 — 12 fields đầy đủ
// ============================================================
const FactoryForm = ({ initial, factories, settings, onSave, onClose }) => {
  const [form, setForm] = useState(initial || {
    supplierCode: nextSupplierCode(factories),
    name: "", nameCn: "", country: "Trung Quốc",
    contactPerson: "", phone: "", email: "", address: "",
    paymentDays: 30, productionDays: 15,
    bankInfo: "", status: "active", currency: "CNY", note: ""
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const isValid = form.name && form.supplierCode;
  const statuses = settings.supplierStatuses || [
    { value: "active", label: "Đang hợp tác" },
    { value: "paused", label: "Tạm ngừng" },
    { value: "stopped", label: "Đã ngừng" },
  ];

  return (
    <Modal title={initial ? "Sửa nhà cung cấp" : "Thêm nhà cung cấp mới"} onClose={onClose} onSave={() => onSave(form)} saveDisabled={!isValid} width={900}>
      <div style={{ fontSize: 12, color: C.textMuted, background: C.green50, padding: "10px 14px", borderRadius: 8, marginBottom: 14 }}>
        💡 <b>Hướng dẫn:</b> Thông tin nhà cung cấp được dùng xuyên suốt (PO, Giao hàng, Công nợ). Mã NCC tự sinh nhưng có thể sửa tay.
      </div>
      <div className="form-grid">
        <div className="form-group"><label>Mã NCC *</label><input value={form.supplierCode} onChange={e => set("supplierCode", e.target.value)} placeholder="VD: NCC-001" /></div>
        <div className="form-group"><label>Trạng thái</label>
          <select value={form.status} onChange={e => set("status", e.target.value)}>
            {statuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Tên nhà cung cấp *</label>
          <input value={form.name} onChange={e => set("name", e.target.value)} placeholder="VD: Shenzhen Audio Co." />
        </div>
        <div className="form-group"><label>Tên phụ (Trung/VN/...)</label>
          <input value={form.nameCn} onChange={e => set("nameCn", e.target.value)} placeholder="深圳声学 / Công ty ABC" />
        </div>
        <div className="form-group"><label>Quốc gia</label><input value={form.country} onChange={e => set("country", e.target.value)} /></div>

        <div className="form-group" style={{ gridColumn: "1/-1", paddingTop: 10, borderTop: `1px dashed ${C.border}`, marginTop: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green800, marginBottom: 4 }}>👤 THÔNG TIN LIÊN HỆ</div>
        </div>
        <div className="form-group"><label>Tên người liên hệ</label><input value={form.contactPerson} onChange={e => set("contactPerson", e.target.value)} /></div>
        <div className="form-group"><label>Số điện thoại</label><input value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="+86 ..." /></div>
        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Email</label><input type="email" value={form.email} onChange={e => set("email", e.target.value)} /></div>
        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Địa chỉ</label><input value={form.address} onChange={e => set("address", e.target.value)} /></div>

        <div className="form-group" style={{ gridColumn: "1/-1", paddingTop: 10, borderTop: `1px dashed ${C.border}`, marginTop: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green800, marginBottom: 4 }}>📅 ĐIỀU KHOẢN</div>
        </div>
        <div className="form-group"><label>Thời gian công nợ (ngày)</label>
          <input type="number" min={0} value={form.paymentDays} onChange={e => set("paymentDays", e.target.value)} placeholder="VD: 30" />
        </div>
        <div className="form-group"><label>Thời gian dự kiến SX (ngày)</label>
          <input type="number" min={0} value={form.productionDays} onChange={e => set("productionDays", e.target.value)} placeholder="VD: 15" />
        </div>
        <div className="form-group"><label>Tiền tệ thanh toán</label>
          <select value={form.currency} onChange={e => set("currency", e.target.value)}>
            {["CNY", "USD", "VND"].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>

        <div className="form-group" style={{ gridColumn: "1/-1", paddingTop: 10, borderTop: `1px dashed ${C.border}`, marginTop: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green800, marginBottom: 4 }}>🏦 THÔNG TIN NGÂN HÀNG</div>
        </div>
        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Tài khoản ngân hàng</label>
          <textarea rows={2} value={form.bankInfo} onChange={e => set("bankInfo", e.target.value)} placeholder="VD: Bank of China - 6228...1234 - Chen Wei - SZ Branch" />
        </div>

        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Ghi chú</label>
          <textarea rows={2} value={form.note} onChange={e => set("note", e.target.value)} />
        </div>
      </div>
    </Modal>
  );
};

const Factories = ({ factories, settings, pos, shipments, onAdd, onEdit, onDelete, onHardDelete, data, user }) => {
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const canEdit = can(user, "manage_factories");
  // v38d: Hard delete chỉ cho admin
  const isAdmin = user?.role === "admin";
  const [hardDeleteDlg, setHardDeleteDlg] = useState(null);
  const statuses = settings.supplierStatuses || [];
  const getStatusInfo = (s) => statuses.find(x => x.value === s) || { label: s, color: C.textMuted };

  const filtered = factories.filter(f =>
    (!search || f.name.toLowerCase().includes(search.toLowerCase()) || (f.supplierCode || "").toLowerCase().includes(search.toLowerCase())) &&
    (!statusFilter || f.status === statusFilter)
  );

  return (
    <div>
      <SectionHeader title="Nhà cung cấp" subtitle={`${factories.length} nhà cung cấp`}
        action={canEdit && <button className="btn btn-primary" onClick={() => setModal({ type: "new" })}>+ Thêm nhà cung cấp</button>}
      />
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input placeholder="🔍 Tìm mã hoặc tên NCC..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 320 }} />
        <select style={{ width: 200 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">Tất cả trạng thái</option>
          {statuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 16 }}>
        {filtered.map(f => {
          const statusInfo = getStatusInfo(f.status);
          const activePOs = pos.filter(p => p.factoryId === f.id && p.status !== "Hủy").length;
          return (
            <div key={f.id} className="card">
              <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: `linear-gradient(135deg, ${C.green400} 0%, ${C.green600} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 22, flexShrink: 0 }}>🏭</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: C.green600, fontWeight: 700, letterSpacing: "0.05em" }}>{f.supplierCode || "—"}</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{f.name}</div>
                  <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{f.nameCn || ""}</div>
                </div>
                {(canEdit || isAdmin) && (
                  <div style={{ display: "flex", gap: 4 }}>
                    {canEdit && <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: f })}>Sửa</button>}
                    {/* v38d: Nút xóa cứng — chỉ admin, chỉ NCC ở trạng thái stopped/cancelled */}
                    {isAdmin && (f.status === "stopped" || f.status === "cancelled") && (
                      <button
                        className="btn btn-ghost"
                        style={{ padding: "5px 10px", fontSize: 11, color: C.red }}
                        title="Xóa cứng (vĩnh viễn)"
                        onClick={() => {
                          const check = canHardDeleteFactory(f.id, data);
                          setHardDeleteDlg({
                            id: f.id,
                            title: `Xóa cứng NCC: ${f.name}`,
                            subtitle: `Mã: ${f.supplierCode || "—"} · Trạng thái: ${statusInfo.label}`,
                            objectSummary: `${f.name}${f.nameCn ? ` (${f.nameCn})` : ""} · ${f.country || ""}`,
                            canDelete: check.allowed,
                            reasons: check.reasons,
                          });
                        }}
                      >🗑️ Xóa cứng</button>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                <Badge label={statusInfo.label} color="white" bg={statusInfo.color} />
                <Badge label={getFlag(f.country) + " " + (f.country || "")} color={C.text} bg={C.green50} />
                {f.paymentDays != null && <Badge label={`Công nợ ${f.paymentDays}d`} color={C.blue} bg="#e0f2fe" />}
                {f.productionDays != null && <Badge label={`SX ${f.productionDays}d`} color={C.orange} bg="#fef3c7" />}
              </div>
              <div style={{ fontSize: 12, color: C.textMuted, display: "flex", flexDirection: "column", gap: 6, paddingTop: 12, borderTop: `1px solid ${C.borderLight}` }}>
                {f.contactPerson && <div>👤 {f.contactPerson}</div>}
                {f.phone && <div>📞 {f.phone}</div>}
                {f.email && <div>✉️ {f.email}</div>}
                {f.address && <div style={{ fontSize: 11 }}>📍 {f.address}</div>}
                {f.bankInfo && <div style={{ fontSize: 11, paddingTop: 6, borderTop: `1px dashed ${C.borderLight}` }}>🏦 {f.bankInfo}</div>}
                <div style={{ paddingTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>📋 {activePOs} PO đang hoạt động</span>
                  <span style={{ color: C.textLight, fontSize: 11 }}>{f.currency}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {modal?.type === "new" && <FactoryForm factories={factories} settings={settings} onSave={f => { onAdd("factories", { id: `f${uid()}`, ...f }); setModal(null); }} onClose={() => setModal(null)} />}
      {modal?.type === "edit" && <FactoryForm initial={modal.data} factories={factories} settings={settings} onSave={f => { onEdit("factories", modal.data.id, f); setModal(null); }} onClose={() => setModal(null)} />}
      {/* v38d: Hard delete dialog */}
      {hardDeleteDlg && (
        <HardDeleteDialog
          {...hardDeleteDlg}
          onConfirm={() => onHardDelete && onHardDelete("factories", hardDeleteDlg.id)}
          onClose={() => setHardDeleteDlg(null)}
        />
      )}
    </div>
  );
};

// ============================================================
// CARRIERS v11 — Đơn vị vận chuyển
// ============================================================
const CarrierForm = ({ initial, carriers, onSave, onClose }) => {
  const nextCarrierCode = () => {
    const nums = (carriers || []).map(c => {
      const m = String(c.code || "").match(/^VC-(\d+)$/);
      return m ? parseInt(m[1], 10) : 0;
    });
    const max = nums.length ? Math.max(...nums) : 0;
    return `VC-${String(max + 1).padStart(3, "0")}`;
  };
  const [form, setForm] = useState(initial || {
    code: nextCarrierCode(),
    name: "", type: CARRIER_TYPES[0],
    contactPerson: "", phone: "", email: "", address: "",
    paymentDays: 30, bankInfo: "", status: "active", note: "",
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const isValid = form.name && form.code;

  return (
    <Modal title={initial ? "Sửa đơn vị vận chuyển" : "Thêm đơn vị vận chuyển"} onClose={onClose} onSave={() => onSave(form)} saveDisabled={!isValid} width={820}>
      <div className="form-grid">
        <div className="form-group"><label>Mã *</label><input value={form.code} onChange={e => set("code", e.target.value)} placeholder="VD: VC-001, DHL" /></div>
        <div className="form-group"><label>Loại hình</label>
          <select value={form.type} onChange={e => set("type", e.target.value)}>
            {CARRIER_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Tên đơn vị *</label>
          <input value={form.name} onChange={e => set("name", e.target.value)} placeholder="VD: DHL Express, FedEx Vietnam" />
        </div>

        <div className="form-group"><label>Trạng thái</label>
          <select value={form.status} onChange={e => set("status", e.target.value)}>
            <option value="active">Đang hợp tác</option>
            <option value="paused">Tạm ngừng</option>
            <option value="stopped">Đã ngừng</option>
          </select>
        </div>
        <div className="form-group"><label>Thời gian công nợ (ngày)</label>
          <input type="number" min={0} value={form.paymentDays} onChange={e => set("paymentDays", e.target.value)} placeholder="VD: 30" />
        </div>

        <div className="form-group" style={{ gridColumn: "1/-1", paddingTop: 10, borderTop: `1px dashed ${C.border}`, marginTop: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green800, marginBottom: 4 }}>👤 THÔNG TIN LIÊN HỆ</div>
        </div>
        <div className="form-group"><label>Tên người liên hệ</label><input value={form.contactPerson} onChange={e => set("contactPerson", e.target.value)} /></div>
        <div className="form-group"><label>Số điện thoại</label><input value={form.phone} onChange={e => set("phone", e.target.value)} /></div>
        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Email</label><input type="email" value={form.email} onChange={e => set("email", e.target.value)} /></div>
        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Địa chỉ</label><input value={form.address} onChange={e => set("address", e.target.value)} /></div>

        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Tài khoản ngân hàng</label>
          <textarea rows={2} value={form.bankInfo} onChange={e => set("bankInfo", e.target.value)} placeholder="VD: Vietcombank - 0071001234567 - DHL Express Vietnam" />
        </div>
        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Ghi chú</label>
          <textarea rows={2} value={form.note} onChange={e => set("note", e.target.value)} />
        </div>
      </div>
    </Modal>
  );
};

const Carriers = ({ carriers, shipments, feePayments, settings, onAdd, onEdit, onDelete, onHardDelete, data, user }) => {
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const canEdit = can(user, "manage_carriers");
  // v38d: Hard delete chỉ cho admin
  const isAdmin = user?.role === "admin";
  const [hardDeleteDlg, setHardDeleteDlg] = useState(null);

  const filtered = carriers.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.code || "").toLowerCase().includes(search.toLowerCase())
  );

  // Thống kê mỗi carrier: số lô, tổng phí phát sinh (VND), đã TT, còn nợ
  const stats = useMemo(() => {
    const map = {};
    carriers.forEach(c => { map[c.id] = { shipments: 0, totalFeeVND: 0, paidVND: 0 }; });
    shipments.forEach(s => {
      if (s.carrierId && map[s.carrierId]) map[s.carrierId].shipments += 1;
      (s.fees || []).forEach(f => {
        if (f.carrierId && map[f.carrierId]) {
          const vnd = toVND(Number(f.amount || 0), f.currency, settings);
          map[f.carrierId].totalFeeVND += vnd;
          const bal = calcFeeBalance(s.id, f.id, feePayments || [], settings);
          map[f.carrierId].paidVND += bal.totalPaid;
        }
      });
    });
    return map;
  }, [carriers, shipments, feePayments, settings]);

  const typeColor = { "Đường biển": C.blue, "Hàng không": C.purple, "Đường bộ": C.orange, "Chuyển phát nhanh": C.green600, "Khác": C.textMuted };

  return (
    <div>
      <SectionHeader title="Đơn vị vận chuyển" subtitle={`${carriers.length} đơn vị · Dùng trong đơn giao hàng và thanh toán thuế phí`}
        action={canEdit && <button className="btn btn-primary" onClick={() => setModal({ type: "new" })}>+ Thêm đơn vị VC</button>}
      />
      <div style={{ marginBottom: 16 }}>
        <input placeholder="🔍 Tìm mã hoặc tên đơn vị..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 320 }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 16 }}>
        {filtered.map(c => {
          const st = stats[c.id] || { shipments: 0, totalFeeVND: 0, paidVND: 0 };
          const unpaid = st.totalFeeVND - st.paidVND;
          return (
            <div key={c.id} className="card">
              <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: `linear-gradient(135deg, ${C.blue} 0%, ${C.green500} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 22 }}>🚛</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: C.green600, fontWeight: 700 }}>{c.code || "—"}</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{c.name}</div>
                </div>
                {(canEdit || isAdmin) && (
                  <div style={{ display: "flex", gap: 4 }}>
                    {canEdit && <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: c })}>Sửa</button>}
                    {/* v38d: Nút xóa cứng — chỉ admin, chỉ Carrier ở status stopped */}
                    {isAdmin && c.status === "stopped" && (
                      <button
                        className="btn btn-ghost"
                        style={{ padding: "5px 10px", fontSize: 11, color: C.red }}
                        title="Xóa cứng (vĩnh viễn)"
                        onClick={() => {
                          const check = canHardDeleteCarrier(c.id, data);
                          setHardDeleteDlg({
                            id: c.id,
                            title: `Xóa cứng đơn vị VC: ${c.name}`,
                            subtitle: `Mã: ${c.code || "—"} · Loại: ${c.type || "—"}`,
                            objectSummary: `${c.name} · ${c.country || ""}`,
                            canDelete: check.allowed,
                            reasons: check.reasons,
                          });
                        }}
                      >🗑️ Xóa cứng</button>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                <Badge label={c.type || "—"} color="white" bg={typeColor[c.type] || C.textMuted} />
                <Badge label={c.status === "active" ? "Đang hợp tác" : c.status === "paused" ? "Tạm ngừng" : "Đã ngừng"} color="white" bg={c.status === "active" ? "#10b981" : c.status === "paused" ? "#f59e0b" : "#6b7280"} />
                {c.paymentDays != null && <Badge label={`Công nợ ${c.paymentDays}d`} color={C.blue} bg="#e0f2fe" />}
              </div>
              <div style={{ fontSize: 12, color: C.textMuted, display: "flex", flexDirection: "column", gap: 4, paddingTop: 10, borderTop: `1px solid ${C.borderLight}` }}>
                {c.contactPerson && <div>👤 {c.contactPerson}</div>}
                {c.phone && <div>📞 {c.phone}</div>}
                {c.email && <div>✉️ {c.email}</div>}
                {c.address && <div style={{ fontSize: 11 }}>📍 {c.address}</div>}
                {c.bankInfo && <div style={{ fontSize: 11, paddingTop: 6, borderTop: `1px dashed ${C.borderLight}` }}>🏦 {c.bankInfo}</div>}
              </div>
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.borderLight}`, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600 }}>LÔ HÀNG</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.green700 }}>{st.shipments}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600 }}>TỔNG PHÍ</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.orange }}>{fmtShort(st.totalFeeVND)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600 }}>CÒN NỢ</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: unpaid > 0 ? C.red : C.green600 }}>{fmtShort(unpaid)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {modal?.type === "new" && <CarrierForm carriers={carriers} onSave={f => { onAdd("carriers", { id: `car_${uid()}`, ...f }); setModal(null); }} onClose={() => setModal(null)} />}
      {modal?.type === "edit" && <CarrierForm initial={modal.data} carriers={carriers} onSave={f => { onEdit("carriers", modal.data.id, f); setModal(null); }} onClose={() => setModal(null)} />}
      {/* v38d: Hard delete dialog */}
      {hardDeleteDlg && (
        <HardDeleteDialog
          {...hardDeleteDlg}
          onConfirm={() => onHardDelete && onHardDelete("carriers", hardDeleteDlg.id)}
          onClose={() => setHardDeleteDlg(null)}
        />
      )}
    </div>
  );
};

// ============================================================
// USERS — Với phân quyền
// ============================================================
const UserForm = ({ initial, onSave, onClose }) => {
  const [form, setForm] = useState(initial || {
    username: "", password: "", fullName: "", email: "", role: "staff", status: "active", permissions: null,
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const [useCustom, setUseCustom] = useState(!!initial?.permissions);
  const currentPerms = form.permissions || DEFAULT_ROLE_PERMS[form.role] || [];

  const togglePerm = (key) => {
    const newPerms = currentPerms.includes(key) ? currentPerms.filter(p => p !== key) : [...currentPerms, key];
    setForm(p => ({ ...p, permissions: newPerms }));
    setUseCustom(true);
  };

  const resetPerms = () => { setForm(p => ({ ...p, permissions: null })); setUseCustom(false); };

  const groupedPerms = useMemo(() => {
    const groups = {};
    Object.entries(PERMISSIONS).forEach(([key, info]) => {
      if (!groups[info.group]) groups[info.group] = [];
      groups[info.group].push({ key, ...info });
    });
    return groups;
  }, []);

  const isValid = form.username && form.fullName && (initial || form.password);

  return (
    <Modal title={initial ? "Sửa tài khoản" : "Thêm tài khoản mới"} onClose={onClose} onSave={() => onSave(form)} saveDisabled={!isValid} width={860}>
      <div className="form-grid">
        <div className="form-group"><label>Tên đăng nhập *</label><input value={form.username} onChange={e => set("username", e.target.value)} disabled={!!initial} /></div>
        <div className="form-group"><label>Mật khẩu {!initial && "*"}</label><input type="password" value={form.password} onChange={e => set("password", e.target.value)} placeholder={initial ? "Để trống nếu không đổi" : ""} /></div>
        <div className="form-group"><label>Họ tên *</label><input value={form.fullName} onChange={e => set("fullName", e.target.value)} /></div>
        <div className="form-group"><label>Email</label><input type="email" value={form.email} onChange={e => set("email", e.target.value)} /></div>
        <div className="form-group"><label>Vai trò</label>
          <select value={form.role} onChange={e => { set("role", e.target.value); setForm(p => ({ ...p, permissions: null })); setUseCustom(false); }}>
            {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Trạng thái</label>
          <select value={form.status} onChange={e => set("status", e.target.value)}>
            <option value="active">Hoạt động</option>
            <option value="locked">Khóa</option>
          </select>
        </div>
      </div>

      {form.role !== "admin" && (
        <div style={{ padding: 16, background: C.bg, borderRadius: 12, border: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.green700 }}>🔒 Phân quyền chi tiết</div>
            {useCustom && <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 11 }} onClick={resetPerms}>Dùng mặc định theo vai trò</button>}
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10 }}>
            {useCustom ? "Đang dùng quyền tùy chỉnh" : `Đang dùng quyền mặc định của vai trò "${ROLE_LABELS[form.role]}"`}
          </div>
          {Object.entries(groupedPerms).map(([group, perms]) => (
            <div key={group} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: C.green700, fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>{group}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {perms.map(p => (
                  <label key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: C.white, borderRadius: 6, cursor: "pointer", border: `1px solid ${currentPerms.includes(p.key) ? C.green300 : C.borderLight}` }}>
                    <input type="checkbox" checked={currentPerms.includes(p.key)} onChange={() => togglePerm(p.key)} style={{ width: "auto" }} />
                    <span style={{ fontSize: 12 }}>{p.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
};

const Users = ({ users, onAdd, onEdit, onDelete, user }) => {
  const [modal, setModal] = useState(null);
  const canManage = can(user, "manage_users");

  return (
    <div>
      <SectionHeader title="Quản lý tài khoản" subtitle={`${users.length} tài khoản — phân quyền chi tiết cho từng người dùng`}
        action={canManage && <button className="btn btn-primary" onClick={() => setModal({ type: "new" })}>+ Thêm tài khoản</button>}
      />
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead><tr><th>Tên đăng nhập</th><th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Trạng thái</th><th>Ngày tạo</th>{canManage && <th></th>}</tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td style={{ fontWeight: 700, color: C.green600 }}>{u.username}</td>
                <td>{u.fullName}</td>
                <td style={{ fontSize: 12, color: C.textMuted }}>{u.email}</td>
                <td>
                  <Badge label={ROLE_LABELS[u.role]} color={u.role === "admin" ? C.red : u.role === "manager" ? C.purple : u.role === "accountant" ? C.blue : C.green600} />
                  {u.permissions && <div style={{ fontSize: 10, color: C.orange, marginTop: 4 }}>🔧 Quyền tùy chỉnh</div>}
                </td>
                <td><Badge label={u.status === "active" ? "Hoạt động" : "Khóa"} color={u.status === "active" ? C.green500 : C.red} /></td>
                <td style={{ fontSize: 12 }}>{fmtDate(u.createdAt)}</td>
                {canManage && (
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: u })}>Sửa</button>
                      {u.id !== user.id && <button className="btn btn-danger" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => onDelete("users", u.id)}>Xóa</button>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal?.type === "new" && <UserForm onSave={f => { onAdd("users", { id: `u${uid()}`, ...f, createdAt: new Date().toISOString().slice(0, 10) }); setModal(null); }} onClose={() => setModal(null)} />}
      {modal?.type === "edit" && <UserForm initial={modal.data} onSave={f => { onEdit("users", modal.data.id, f); setModal(null); }} onClose={() => setModal(null)} />}
    </div>
  );
};

// ============================================================
// AUDIT LOG
// ============================================================
const AuditLog = ({ auditLog }) => {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const filtered = useMemo(() => {
    // v38b: Sort theo timestamp desc với tie-break ID (thay .slice().reverse())
    let items = sortByDateDesc(auditLog, "timestamp", "id");
    if (dateFrom) items = items.filter(x => x.timestamp.slice(0, 10) >= dateFrom);
    if (dateTo) items = items.filter(x => x.timestamp.slice(0, 10) <= dateTo);
    if (actionFilter) {
      if (actionFilter === "create") items = items.filter(x => x.action.startsWith("create"));
      else if (actionFilter === "update") items = items.filter(x => x.action.startsWith("update") || x.action.startsWith("edit"));
      else if (actionFilter === "approve") items = items.filter(x => x.action.startsWith("approve"));
      else if (actionFilter === "cancel") items = items.filter(x => x.action.startsWith("cancel"));
      else if (actionFilter === "delete") items = items.filter(x => x.action.startsWith("delete") && !x.action.startsWith("hard_delete"));
      else if (actionFilter === "auth") items = items.filter(x => x.action.startsWith("login") || x.action.startsWith("logout"));
      // v38g: Filter mới cho V38d/e/f/g
      else if (actionFilter === "hard_delete") items = items.filter(x => x.action.startsWith("hard_delete"));
      else if (actionFilter === "rename") items = items.filter(x => x.action.startsWith("rename"));
      else if (actionFilter === "password") items = items.filter(x => x.action === "change_own_password");
      else if (actionFilter === "stage") items = items.filter(x => x.action === "update_payment_stage");
    }
    if (search) items = items.filter(x =>
      (x.userName || "").toLowerCase().includes(search.toLowerCase()) ||
      (x.action || "").toLowerCase().includes(search.toLowerCase()) ||
      (x.target || "").toLowerCase().includes(search.toLowerCase()) ||
      (x.detail || "").toLowerCase().includes(search.toLowerCase())
    );
    return items;
  }, [auditLog, dateFrom, dateTo, search, actionFilter]);

  // v28: Pagination — audit log dùng page size lớn hơn (100) vì rows ngắn
  const { page, setPage, pageSize, setPageSize, paginatedItems: pagedFiltered } = usePagination(filtered, 100);

  const actionColor = (action) => {
    if (action.startsWith("create")) return C.green500;
    if (action.startsWith("approve")) return C.green600; // v26: duyệt = xanh đậm
    if (action.startsWith("cancel")) return C.orange;
    if (action.startsWith("update") || action.startsWith("edit")) return C.blue;
    if (action.startsWith("hard_delete")) return C.red; // v38g: xóa cứng = đỏ đậm
    if (action.startsWith("delete")) return C.red;
    if (action.startsWith("rename")) return C.orange; // v38g: đổi mã = cam
    if (action === "change_own_password") return C.purple; // v38g
    if (action === "update_payment_stage") return C.gold; // v38g: stage = vàng kim
    if (action.startsWith("login") || action.startsWith("logout")) return C.purple;
    return C.textMuted;
  };

  // v21: Mapping action → label tiếng Việt
  // v38g: Bổ sung label cho action V38d/e/f/g (hard_delete, rename, change_own_password, update_payment_stage)
  const actionLabelVi = (action) => {
    const ENTITY_VI = {
      product: "Sản phẩm", po: "PO", shipment: "Đơn giao hàng", payment: "Thanh toán",
      factory: "NCC", market: "Thị trường", carrier: "Đơn vị VC", user: "Tài khoản",
      opening_balance: "Công nợ đầu kỳ", fee_payment: "Thanh toán phí",
      warranty: "Lô bảo hành", warehouse: "Kho",
    };
    if (action === "login") return "🔓 Đăng nhập";
    if (action === "logout") return "🔒 Đăng xuất";
    if (action === "update_settings") return "⚙️ Cập nhật cấu hình";
    if (action === "approve_draft_shipment") return "✅ Duyệt nháp giao hàng";
    if (action === "import_stock_opening") return "📥 Import đầu kỳ tồn kho";
    if (action === "import_stock_adjustment") return "📥 Import điều chỉnh tồn kho";
    if (action === "cancel_import_batch") return "🚫 Hủy batch import tồn kho";
    // v38g: Action mới
    if (action === "change_own_password") return "🔑 Đổi mật khẩu cá nhân";
    if (action === "update_payment_stage") return "🟡 Cập nhật stage thanh toán";
    // v38d: Hard delete
    const hardDelete = action.match(/^hard_delete_(factory|carrier|po|shipment)$/);
    if (hardDelete) {
      const entityMap = { factory: "NCC", carrier: "Đơn vị VC", po: "PO", shipment: "Đơn giao hàng" };
      return `🗑️ Xóa cứng ${entityMap[hardDelete[1]] || hardDelete[1]}`;
    }
    // v38f: Rename
    const rename = action.match(/^rename_(po|shipment)$/);
    if (rename) {
      const entityMap = { po: "PO", shipment: "Đơn giao hàng" };
      return `🔄 Đổi mã ${entityMap[rename[1]] || rename[1]}`;
    }
    const m = action.match(/^(create|update|edit|cancel|delete)_(.+)$/);
    if (!m) return action;
    const verb = { create: "➕ Tạo", update: "✏️ Sửa", edit: "✏️ Sửa", cancel: "🚫 Hủy", delete: "🗑 Xóa" }[m[1]] || m[1];
    return `${verb} ${ENTITY_VI[m[2]] || m[2]}`;
  };

  // v21: Trích xuất các thông tin quan trọng từ detail JSON
  const extractKeyDetail = (log) => {
    if (!log.detail) return null;
    try {
      const obj = typeof log.detail === "string" ? JSON.parse(log.detail) : log.detail;
      if (typeof obj !== "object" || !obj) return null;
      const items = [];
      if (obj.cancelReason) items.push({ label: "Lý do hủy", value: obj.cancelReason, color: C.red });
      if (obj.amount !== undefined && obj.currency) items.push({ label: "Số tiền", value: `${Number(obj.amount).toLocaleString("vi-VN")} ${obj.currency}`, color: C.green700 });
      if (obj.status && !obj.cancelReason) items.push({ label: "Trạng thái mới", value: obj.status, color: C.blue });
      if (obj.payDate) items.push({ label: "Ngày", value: obj.payDate, color: C.textMuted });
      if (obj.fromMarket) items.push({ label: "Từ thị trường", value: obj.fromMarket, color: C.textMuted });
      if (obj.lastEditedBy) items.push({ label: "Người sửa", value: obj.lastEditedBy, color: C.purple });
      return items.length > 0 ? items : null;
    } catch {
      return null;
    }
  };

  return (
    <div>
      <SectionHeader title="Nhật ký hoạt động" subtitle={`${auditLog.length} lượt hoạt động được ghi nhận · Hệ thống tự động lưu mọi thay đổi để truy vết khi cần`} />
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: "14px 18px", marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input placeholder="🔍 Tìm user, hành động, mã đối tượng, lý do..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 280 }} />
        <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} style={{ width: 200 }}>
          <option value="">Tất cả hành động</option>
          <option value="create">➕ Tạo mới</option>
          <option value="update">✏️ Sửa</option>
          <option value="approve">✅ Duyệt</option>
          <option value="cancel">🚫 Hủy</option>
          <option value="delete">🗑 Xóa (mềm)</option>
          <option value="auth">🔐 Đăng nhập/xuất</option>
          {/* v38g: Filter mới cho V38d/e/f/g */}
          <option value="hard_delete">🗑️ Xóa cứng (admin)</option>
          <option value="rename">🔄 Đổi mã (admin)</option>
          <option value="password">🔑 Đổi mật khẩu</option>
          <option value="stage">🟡 Stage thanh toán</option>
        </select>
        <div style={{ flex: 1, minWidth: 300 }}>
          <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} onReset={() => { setDateFrom(""); setDateTo(""); }} />
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead><tr><th>Thời gian</th><th>Người dùng</th><th>Hành động</th><th>Đối tượng</th><th>Chi tiết</th></tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: "center", color: C.textMuted, padding: 40 }}>Chưa có hoạt động nào</td></tr>
            ) : pagedFiltered.map(log => {
              const keyDetails = extractKeyDetail(log);
              return (
                <tr key={log.id}>
                  <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{fmtDateTime(log.timestamp)}</td>
                  <td style={{ fontWeight: 600 }}>{log.userName}</td>
                  <td><Badge label={actionLabelVi(log.action)} color={actionColor(log.action)} /></td>
                  <td style={{ fontSize: 12, fontFamily: "monospace", color: C.green700 }}>{log.target}</td>
                  <td style={{ fontSize: 11, color: C.textMuted, maxWidth: 400 }}>
                    {keyDetails ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {keyDetails.map((d, i) => (
                          <div key={i}><span style={{ color: C.textLight }}>{d.label}:</span> <span style={{ color: d.color, fontWeight: 600 }}>{d.value}</span></div>
                        ))}
                      </div>
                    ) : (
                      <span style={{ wordBreak: "break-all" }}>{log.detail}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} pageSizeOptions={[50, 100, 200, 500]} />
      </div>
    </div>
  );
};

// ============================================================
// OPENING BALANCES — Công nợ đầu kỳ
// ============================================================
// v38h: OpeningBalanceForm — 2 mode: NCC vs Thị trường
// v38i: OpeningBalanceForm — 1 mode duy nhất: TT × NCC.
// V38h có 2 mode (NCC vs TT) → V38h-bug: TT nợ không ai. V38i sửa hoàn toàn.
const OpeningBalanceForm = ({ initial, factories, markets = [], onSave, onClose }) => {
  const [form, setForm] = useState(initial || {
    market: "",
    factoryId: "",
    type: "debt", amount: "", currency: "CNY",
    date: new Date().toISOString().slice(0, 10), note: "",
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Validation V38i: BẮT BUỘC cả market + factoryId
  const errors = [];
  if (!form.market) errors.push("Chọn thị trường đang nợ");
  if (!form.factoryId) errors.push("Chọn nhà cung cấp");
  if (!form.amount || Number(form.amount) <= 0) errors.push("Số tiền phải > 0");
  const isValid = errors.length === 0;

  // Tìm tên TT + NCC để hiển thị preview
  const factoryName = factories.find(f => f.id === form.factoryId)?.name || "";

  return (
    <Modal title={initial ? "Sửa công nợ đầu kỳ" : "Thêm công nợ đầu kỳ"} onClose={onClose} onSave={() => onSave(form)} saveDisabled={!isValid} width={620}>
      <div className="form-grid">
        {/* Mỗi OB là 1 GIAO DỊCH giữa TT × NCC */}
        <div className="form-group"><label>🌍 Thị trường đang nợ *</label>
          <select value={form.market} onChange={e => set("market", e.target.value)}>
            <option value="">-- Chọn thị trường --</option>
            {markets.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>🏭 Nhà cung cấp *</label>
          <select value={form.factoryId} onChange={e => set("factoryId", e.target.value)}>
            <option value="">-- Chọn NCC --</option>
            {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>

        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Loại *</label>
          <select value={form.type} onChange={e => set("type", e.target.value)}>
            <option value="debt">Nợ gốc — TT đang nợ NCC</option>
            <option value="credit">Quỹ tín dụng — TT đã trả thừa cho NCC</option>
          </select>
        </div>

        <div className="form-group"><label>Số tiền *</label>
          <NumberInput step="0.01" min={0} value={form.amount} onChange={e => set("amount", e.target.value)} />
        </div>
        <div className="form-group"><label>Tiền tệ</label>
          <select value={form.currency} onChange={e => set("currency", e.target.value)}>
            {["CNY", "USD", "VND"].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Ngày ghi nhận</label>
          <input type="date" value={form.date} onChange={e => set("date", e.target.value)} />
        </div>
        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Ghi chú</label>
          <textarea rows={2} value={form.note} onChange={e => set("note", e.target.value)} placeholder="VD: Công nợ chuyển từ Q4/2025, đã đối chiếu..." />
        </div>
      </div>

      {/* Preview giao dịch */}
      {form.market && form.factoryId && Number(form.amount) > 0 && (
        <div className="alert alert-success" style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 13 }}>
            <b>📋 Xác nhận giao dịch:</b>
            <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700 }}>
              {form.type === "debt"
                ? <>🌍 <span style={{ color: C.red }}>{form.market}</span> đang nợ 🏭 <span style={{ color: C.red }}>{factoryName}</span> số tiền <span style={{ color: C.red }}>{fmt(form.amount, form.currency)}</span></>
                : <>🌍 <span style={{ color: C.green600 }}>{form.market}</span> đã trả thừa 🏭 <span style={{ color: C.green600 }}>{factoryName}</span> số tiền <span style={{ color: C.green600 }}>{fmt(form.amount, form.currency)}</span></>
              }
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: C.textMuted }}>
              💡 OB này sẽ tự động xuất hiện ở:
              <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
                <li>Tab Công nợ NCC ({factoryName}) — cộng vào nợ gốc</li>
                <li>Tab Công nợ TT ({form.market}) — cộng vào còn phải trả</li>
                <li>Dashboard + Báo cáo Excel — đồng bộ tự động</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {errors.length > 0 && (form.market || form.factoryId || form.amount) && (
        <div className="alert alert-danger" style={{ fontSize: 12 }}>
          {errors.map((e, i) => <div key={i}>• {e}</div>)}
        </div>
      )}

      <div className="alert alert-info">
        <div><b>💡 Lưu ý:</b> Mỗi OB là 1 GIAO DỊCH giữa TT × NCC.</div>
        <div style={{ fontSize: 12, marginTop: 4 }}>
          Ví dụ: Vietnam đang nợ Shenzhen Audio 50K CNY → Tạo 1 OB. Vietnam đang nợ thêm Guangzhou Mic 20K CNY → Tạo OB thứ 2.
        </div>
      </div>
    </Modal>
  );
};


// v38i: OpeningBalances list — model TT × NCC.
// Mỗi row hiển thị TT đang nợ NCC nào.
// Filter 2 chiều: TT + NCC độc lập.
// (Banner migration đã được xóa theo yêu cầu — props onMigrationDismiss/migrationFlag/oldOBCount giữ lại để App truyền không lỗi nhưng không dùng nữa)
const OpeningBalances = ({ openingBalances, factories, markets = [], settings, onAdd, onEdit, onDelete, user }) => {
  const [modal, setModal] = useState(null);
  const [filterMarket, setFilterMarket] = useState("");
  const [filterFactory, setFilterFactory] = useState("");
  const [showCancelled, setShowCancelled] = useState(true);
  const [cancelDlg, setCancelDlg] = useState(null);

  const canManage = can(user, "manage_opening_balance");
  const isAdmin = user?.role === "admin";

  // v38b: Sort theo date desc + tie-break ID
  // v38i: Filter mới — theo cả market lẫn factoryId
  const filtered = sortByDateDesc(
    openingBalances.filter(o => {
      if (filterMarket && o.market !== filterMarket) return false;
      if (filterFactory && o.factoryId !== filterFactory) return false;
      if (!showCancelled && o.status === "cancelled") return false;
      return true;
    }),
    "date", "id"
  );

  // v38i: 4 KPI mới — Tổng nợ gốc / Quỹ TD / Số TT / Số NCC
  const summary = useMemo(() => {
    let totalDebtCNY = 0, totalCreditCNY = 0;
    const marketSet = new Set();
    const factorySet = new Set();
    openingBalances.forEach(o => {
      if (o.status === "cancelled") return;
      const cny = toVND(Number(o.amount || 0), o.currency || "CNY", settings) / settings.cnyToVnd;
      if (o.type === "debt") totalDebtCNY += cny;
      else totalCreditCNY += cny;
      if (o.market) marketSet.add(o.market);
      if (o.factoryId) factorySet.add(o.factoryId);
    });
    return {
      totalDebtCNY, totalCreditCNY,
      marketCount: marketSet.size,
      factoryCount: factorySet.size,
      pairCount: openingBalances.filter(o => o.status !== "cancelled").length,
    };
  }, [openingBalances, settings]);

  // Helper: lấy tên TT + NCC để hiển thị
  const getMarketLabel = (m) => m || "(Chưa chọn TT)";
  const getFactoryLabel = (fid) => factories.find(f => f.id === fid)?.name || "(NCC không tồn tại)";

  return (
    <div>
      <SectionHeader title="Công nợ đầu kỳ" subtitle="Mỗi OB = giao dịch TT × NCC. Setup khi triển khai app hoặc sang kỳ kế toán mới."
        action={canManage && <button className="btn btn-primary" onClick={() => setModal({ type: "new" })}>+ Thêm công nợ đầu kỳ</button>}
      />

      {/* v38i (đã xóa banner migration theo yêu cầu) */}

      {!canManage && <div className="alert alert-warn" style={{ marginBottom: 16 }}>Chỉ Admin/Kế toán được quản lý công nợ đầu kỳ</div>}

      {/* v38i: 4 KPI mới */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        <div className="card">
          <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Tổng nợ gốc</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.red }}>{fmt(summary.totalDebtCNY, "CNY")}</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>≈ {fmt(toVND(summary.totalDebtCNY, "CNY", settings), "VND")}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Tổng quỹ TD</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.green600 }}>{fmt(summary.totalCreditCNY, "CNY")}</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>≈ {fmt(toVND(summary.totalCreditCNY, "CNY", settings), "VND")}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>🌍 Số TT có OB</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.blue }}>{summary.marketCount}</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>{summary.pairCount} cặp TT × NCC</div>
        </div>
        <div className="card">
          <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>🏭 Số NCC có OB</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.purple }}>{summary.factoryCount}</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>{summary.pairCount} cặp TT × NCC</div>
        </div>
      </div>

      {/* v38i: Filter row — 2 dropdown TT + NCC độc lập */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: "14px 18px", marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <select style={{ width: 220 }} value={filterMarket} onChange={e => setFilterMarket(e.target.value)}>
          <option value="">🌍 Tất cả thị trường</option>
          {markets.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
        </select>
        <select style={{ width: 240 }} value={filterFactory} onChange={e => setFilterFactory(e.target.value)}>
          <option value="">🏭 Tất cả NCC</option>
          {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textMuted, cursor: "pointer" }}>
          <input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} /> Hiện cả đã hủy
        </label>
        <div style={{ marginLeft: "auto", fontSize: 12, color: C.textMuted }}>
          {filtered.length} bản ghi
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead>
            <tr>
              <th>Mã</th>
              <th>🌍 Thị trường nợ</th>
              <th>🏭 Nhà cung cấp</th>
              <th>Loại</th>
              <th>Ngày</th>
              <th>Số tiền</th>
              <th>Ghi chú</th>
              {canManage && <th></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={canManage ? 8 : 7} style={{ textAlign: "center", color: C.textMuted, padding: 40 }}>
                {openingBalances.length === 0 ? "Chưa có công nợ đầu kỳ nào — bấm '+ Thêm' để nhập" : "Không tìm thấy bản ghi với filter hiện tại"}
              </td></tr>
            ) : filtered.map(o => {
              const isCancelled = o.status === "cancelled";
              const rowStyle = isCancelled ? { opacity: 0.55, textDecoration: "line-through" } : {};
              return (
                <tr key={o.id} style={isCancelled ? { background: C.bg } : {}}>
                  <td style={{ color: C.green600, fontWeight: 600, ...rowStyle }}>
                    {o.id}
                    {isCancelled && <div style={{ fontSize: 9, color: C.red, fontWeight: 700, marginTop: 3, textDecoration: "none" }}>🚫 ĐÃ HỦY</div>}
                  </td>
                  <td style={{ fontWeight: 600, ...rowStyle }}>🌍 {getMarketLabel(o.market)}</td>
                  <td style={{ fontWeight: 600, ...rowStyle }}>🏭 {getFactoryLabel(o.factoryId)}</td>
                  <td style={rowStyle}><Badge label={o.type === "debt" ? "Nợ gốc" : "Quỹ tín dụng"} color={o.type === "debt" ? C.red : C.green600} /></td>
                  <td style={{ fontSize: 12, ...rowStyle }}>{fmtDate(o.date)}</td>
                  <td style={rowStyle}>
                    <div style={{ fontWeight: 700, color: isCancelled ? C.textMuted : (o.type === "debt" ? C.red : C.green600) }}>{fmt(o.amount, o.currency)}</div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(toVND(o.amount, o.currency, settings), "VND")}</div>
                  </td>
                  <td style={{ fontSize: 12, color: C.textMuted, ...rowStyle }}>
                    {o.note || "-"}
                    {isCancelled && o.cancelReason && <div style={{ fontSize: 10, color: C.red, marginTop: 3, fontStyle: "italic", textDecoration: "none" }}>Lý do hủy: {o.cancelReason}</div>}
                  </td>
                  {canManage && (
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        {!isCancelled && <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: o })}>Sửa</button>}
                        {!isCancelled && <button className="btn btn-danger" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setCancelDlg({ ob: o })}>Hủy</button>}
                        {isCancelled && isAdmin && <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: o })}>Sửa</button>}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal?.type === "new" && <OpeningBalanceForm factories={factories} markets={markets} onSave={f => { onAdd("openingBalances", { id: `OB-${uid()}`, status: "active", ...f }); setModal(null); }} onClose={() => setModal(null)} />}
      {modal?.type === "edit" && <OpeningBalanceForm initial={modal.data} factories={factories} markets={markets} onSave={f => { onEdit("openingBalances", modal.data.id, { ...f, lastEditedBy: user?.fullName || user?.username, lastEditedAt: new Date().toISOString() }); setModal(null); }} onClose={() => setModal(null)} />}

      {cancelDlg && <PromptDialog title={`Hủy công nợ đầu kỳ ${cancelDlg.ob.id}?`}
        message="Sau khi hủy, công nợ đầu kỳ này sẽ KHÔNG tính vào số dư đầu kỳ nhưng vẫn lưu để audit."
        placeholder="VD: Sai số tiền, không đúng đối tượng, đã đối soát lại..."
        confirmLabel="🚫 Xác nhận Hủy" required={true}
        onConfirm={(reason) => {
          onEdit("openingBalances", cancelDlg.ob.id, {
            status: "cancelled",
            cancelReason: reason,
            cancelledBy: user?.fullName || user?.username,
            cancelledAt: new Date().toISOString(),
          });
          setCancelDlg(null);
        }}
        onClose={() => setCancelDlg(null)} />}
    </div>
  );
};


// ============================================================
// MARKETS — Quản lý thị trường
// ============================================================
// ============================================================
// MARKETS v10 — Thị trường + quản lý kho nested (2 tầng: Country → Warehouse)
// ============================================================
const MarketForm = ({ initial, shipments, onSave, onClose }) => {
  const [form, setForm] = useState(initial ? {
    ...initial,
    warehouses: (initial.warehouses || []).map(w => ({ ...w, isDefault: !!w.isDefault })),
  } : {
    name: "", code: "", currency: "VND", note: "", warehouses: [],
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const isValid = form.name.trim().length > 0;
  // v11.2: Confirm dialog
  const [confirmDlg, setConfirmDlg] = useState(null);

  // v12: Đảm bảo luôn có đúng 1 kho default (nếu có >= 1 kho)
  const normalizeDefault = (list) => {
    if (!list || list.length === 0) return list;
    const hasDefault = list.some(w => w.isDefault);
    if (!hasDefault) {
      // Không có kho nào là default → gán kho đầu tiên
      return list.map((w, i) => ({ ...w, isDefault: i === 0 }));
    }
    // Nhiều kho cùng isDefault → chỉ giữ cái đầu tiên
    let firstFound = false;
    return list.map(w => {
      if (w.isDefault && !firstFound) { firstFound = true; return w; }
      if (w.isDefault) return { ...w, isDefault: false };
      return w;
    });
  };

  const addWarehouse = () => {
    const newWh = { id: `wh_${uid()}`, name: "", address: "", note: "", isDefault: form.warehouses.length === 0 };
    set("warehouses", [...form.warehouses, newWh]);
  };

  const removeWarehouse = (idx) => {
    const wh = form.warehouses[idx];
    const usedCount = countShipmentsUsingWarehouse(wh.id, shipments);
    if (usedCount > 0) {
      setConfirmDlg({
        title: "Không thể xóa kho",
        message: `Kho "${wh.name || "(chưa đặt tên)"}" đang được gắn với ${usedCount} đơn giao hàng.\n\nĐể xóa, trước tiên hãy đổi kho hoặc hủy các đơn giao hàng liên quan.`,
        confirmLabel: "Đã hiểu", cancelLabel: null,
        onConfirm: () => {},
      });
      return;
    }
    setConfirmDlg({
      title: "Xóa kho này?",
      message: `Xóa kho "${wh.name || "(chưa đặt tên)"}"?\nHành động này không thể hoàn tác.`,
      danger: true, confirmLabel: "Xóa",
      onConfirm: () => {
        const remaining = form.warehouses.filter((_, i) => i !== idx);
        set("warehouses", normalizeDefault(remaining));
      },
    });
  };

  const updateWarehouse = (idx, field, val) => set("warehouses", form.warehouses.map((w, i) => i === idx ? { ...w, [field]: val } : w));

  // v12: Set kho làm mặc định (radio) — các kho khác tự động thành false
  const setDefaultWarehouse = (idx) => {
    set("warehouses", form.warehouses.map((w, i) => ({ ...w, isDefault: i === idx })));
  };

  // v12: Trước khi save, normalize default
  const handleSave = () => {
    const normalized = { ...form, warehouses: normalizeDefault(form.warehouses) };
    onSave(normalized);
  };

  return (
    <Modal title={initial ? "Sửa thị trường" : "Thêm thị trường mới"} onClose={onClose} onSave={handleSave} saveDisabled={!isValid} width={820}>
      <div className="form-grid">
        <div className="form-group"><label>Tên thị trường *</label>
          <input value={form.name} onChange={e => set("name", e.target.value)} placeholder="VD: Indonesia, Singapore..." />
        </div>
        <div className="form-group"><label>Mã viết tắt</label>
          <input value={form.code} onChange={e => set("code", e.target.value)} placeholder="VD: ID, SG..." />
        </div>
        <div className="form-group"><label>Tiền tệ chính</label>
          <select value={form.currency} onChange={e => set("currency", e.target.value)}>
            {["VND", "USD", "CNY", "THB", "MYR", "PHP", "IDR", "SGD", "EUR", "JPY", "KRW"].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Ghi chú</label>
          <input value={form.note} onChange={e => set("note", e.target.value)} placeholder="VD: Thị trường mới mở 2026..." />
        </div>
      </div>

      {/* Warehouse management */}
      <div style={{ padding: 16, background: C.green50, borderRadius: 12, border: `1px solid ${C.green200}`, marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.green700 }}>🏪 Kho hàng thuộc thị trường này</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
              {form.warehouses.length} kho · Dùng khi tạo đơn giao hàng
              {form.warehouses.length > 1 && <span style={{ marginLeft: 6 }}> · ⭐ = kho mặc định (tự chọn khi tạo đơn giao hàng)</span>}
            </div>
          </div>
          <button type="button" className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={addWarehouse}>+ Thêm kho</button>
        </div>
        {form.warehouses.length === 0 && <div style={{ fontSize: 12, color: C.textMuted, padding: 10, textAlign: "center" }}>Chưa có kho nào. Mỗi thị trường nên có ít nhất 1 kho.</div>}
        {form.warehouses.map((w, idx) => {
          const usedCount = countShipmentsUsingWarehouse(w.id, shipments);
          const isOnlyOne = form.warehouses.length === 1;
          const posSystem = (w.posConnection?.system) || "manual";
          return (
            <div key={idx} style={{ marginBottom: 10, padding: 10, background: C.white, borderRadius: 10, border: w.isDefault ? `1.5px solid ${C.green400}` : `1px solid ${C.borderLight}` }}>
              <div style={{ display: "grid", gridTemplateColumns: "32px 1fr 1fr 1fr 40px", gap: 8, alignItems: "center" }}>
                {/* Radio chọn mặc định */}
                <button type="button"
                  onClick={() => !isOnlyOne && setDefaultWarehouse(idx)}
                  disabled={isOnlyOne}
                  title={isOnlyOne ? "Kho duy nhất — luôn là kho mặc định" : (w.isDefault ? "Đang là kho mặc định" : "Đặt làm kho mặc định")}
                  style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: (w.isDefault || isOnlyOne) ? C.green500 : C.white,
                    border: (w.isDefault || isOnlyOne) ? `2px solid ${C.green600}` : `1.5px solid ${C.border}`,
                    cursor: isOnlyOne ? "default" : "pointer",
                    color: (w.isDefault || isOnlyOne) ? "white" : C.textLight,
                    fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center",
                    padding: 0,
                  }}>
                  {(w.isDefault || isOnlyOne) ? "⭐" : ""}
                </button>
                <div>
                  <input value={w.name} onChange={e => updateWarehouse(idx, "name", e.target.value)} placeholder="Tên kho (VD: Kho Vũ Huy)" />
                  {usedCount > 0 && (
                    <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>
                      📦 {usedCount} đơn giao hàng đang dùng kho này
                    </div>
                  )}
                </div>
                <input value={w.address} onChange={e => updateWarehouse(idx, "address", e.target.value)} placeholder="Địa chỉ" />
                <input value={w.note} onChange={e => updateWarehouse(idx, "note", e.target.value)} placeholder="Ghi chú" />
                <button type="button" className="btn btn-danger" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => removeWarehouse(idx)} title={usedCount > 0 ? `Không thể xóa — ${usedCount} lô đang dùng` : "Xóa kho"}>✕</button>
              </div>

              {/* v23b: Cấu hình kết nối phần mềm bán hàng */}
              <div style={{ marginTop: 8, padding: 10, background: C.bg, borderRadius: 8, border: `1px dashed ${C.borderLight}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: C.textMuted, marginBottom: 6 }}>
                  🔌 <b>Kết nối phần mềm bán hàng</b>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 1fr", gap: 8, alignItems: "center" }}>
                  <select value={posSystem}
                    onChange={e => updateWarehouse(idx, "posConnection", { ...(w.posConnection || {}), system: e.target.value })}
                    style={{ fontSize: 12 }}>
                    {Object.values(POS_SYSTEMS).map(p => <option key={p.id} value={p.id}>{p.icon} {p.label}</option>)}
                  </select>
                  <input
                    value={w.posConnection?.accountLabel || ""}
                    onChange={e => updateWarehouse(idx, "posConnection", { ...(w.posConnection || {}), accountLabel: e.target.value })}
                    placeholder="Tên gọi tài khoản (VD: Nhanh.vn - Bình Dương)"
                    style={{ fontSize: 12 }}
                    disabled={posSystem === "manual"}
                  />
                  <input
                    value={w.posConnection?.syncUrl || ""}
                    onChange={e => updateWarehouse(idx, "posConnection", { ...(w.posConnection || {}), syncUrl: e.target.value })}
                    placeholder={posSystem === "manual" ? "Không cần URL" : "URL Google Sheet (CSV) để sync tự động"}
                    style={{ fontSize: 12 }}
                    disabled={posSystem === "manual"}
                  />
                </div>
                {posSystem !== "manual" && !w.posConnection?.syncUrl && (
                  <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4, fontStyle: "italic" }}>
                    💡 Để trống URL nếu chỉ dùng import file thủ công. Để sync tự động, paste link Google Sheet (publish to web → CSV).
                  </div>
                )}
                {w.posConnection?.lastSyncAt && (
                  <div style={{ fontSize: 10, color: C.textLight, marginTop: 4 }}>
                    🕐 Sync gần nhất: {new Date(w.posConnection.lastSyncAt).toLocaleString("vi-VN")}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="alert alert-info" style={{ marginTop: 10 }}>
        <b>Lưu ý:</b> Tên thị trường được dùng trong các đơn giao hàng và công nợ. Nếu sửa tên, các dữ liệu cũ liên kết với tên cũ sẽ không tự động cập nhật.
      </div>
      {/* v11.2: Confirm dialog xóa kho */}
      {confirmDlg && <ConfirmDialog {...confirmDlg} onClose={() => setConfirmDlg(null)} />}
    </Modal>
  );
};

// ============================================================
// v38j: StockOnHandForm — Cập nhật tồn kho thực tế cho 1 SP × Kho
// ============================================================
// Đây là form CHỊ NHẬP TAY số lượng tồn thực tế sau khi kiểm đếm.
// Không tự động cộng từ shipments — chị có toàn quyền điều chỉnh.
const StockOnHandForm = ({ initial, products, markets = [], onSave, onClose }) => {
  const [form, setForm] = useState(initial || {
    productId: "",
    market: "",
    warehouseId: "",
    quantity: 0,
    note: "",
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Lấy danh sách kho theo TT
  const allWh = useMemo(() => {
    const out = [];
    (markets || []).forEach(m => (m.warehouses || []).forEach(w => out.push({ ...w, marketName: m.name })));
    return out;
  }, [markets]);
  const filteredWh = form.market ? allWh.filter(w => w.marketName === form.market) : allWh;

  const errors = [];
  if (!form.productId) errors.push("Chọn sản phẩm");
  if (!form.market) errors.push("Chọn thị trường");
  if (!form.warehouseId) errors.push("Chọn kho");
  if (form.quantity === "" || form.quantity === null || isNaN(Number(form.quantity))) errors.push("Số lượng không hợp lệ");
  const isValid = errors.length === 0;

  const productOptions = useMemo(() => {
    return (products || []).map(p => ({
      ...p,
      _searchText: `${p.sku || ""} ${p.name || ""} ${p.nameImport || ""}`,
    }));
  }, [products]);

  return (
    <Modal title={initial ? "Sửa tồn kho" : "Cập nhật tồn kho"} onClose={onClose} onSave={() => onSave(form)} saveDisabled={!isValid} width={620}>
      <div className="alert alert-info" style={{ marginBottom: 14, fontSize: 12 }}>
        💡 <b>Tồn trong kho</b> là số lượng thực tế chị kiểm đếm. App KHÔNG tự cộng từ shipments — chị toàn quyền điều chỉnh.
      </div>
      <div className="form-grid">
        <div className="form-group" style={{ gridColumn: "1/-1" }}>
          <label>Sản phẩm *</label>
          <Combobox
            items={productOptions}
            value={form.productId}
            onChange={(key) => set("productId", key || "")}
            getKey={p => p.id}
            getLabel={p => `${p.sku} — ${p.name}`}
            getSearchText={p => p._searchText}
            placeholder="🔍 Tìm SP theo SKU / tên..."
            disabled={!!initial}
          />
        </div>
        <div className="form-group">
          <label>Thị trường *</label>
          <select value={form.market} onChange={e => { set("market", e.target.value); set("warehouseId", ""); }} disabled={!!initial}>
            <option value="">-- Chọn TT --</option>
            {markets.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Kho *</label>
          <select value={form.warehouseId} onChange={e => set("warehouseId", e.target.value)} disabled={!form.market || !!initial}>
            <option value="">-- Chọn kho --</option>
            {filteredWh.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ gridColumn: "1/-1" }}>
          <label>Số lượng tồn kho *</label>
          <NumberInput min={0} value={form.quantity} onChange={e => set("quantity", e.target.value)} placeholder="VD: 250" />
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>Số lượng thực tế kiểm đếm tại thời điểm này.</div>
        </div>
        <div className="form-group" style={{ gridColumn: "1/-1" }}>
          <label>Ghi chú</label>
          <textarea rows={2} value={form.note} onChange={e => set("note", e.target.value)} placeholder="VD: Kiểm kê cuối tháng 5/2026..." />
        </div>
      </div>
      {errors.length > 0 && (form.productId || form.market) && (
        <div className="alert alert-danger" style={{ fontSize: 12 }}>
          {errors.map((e, i) => <div key={i}>• {e}</div>)}
        </div>
      )}
    </Modal>
  );
};

// ============================================================
// v38j: StockOnHandImportModal — Import Excel cập nhật tồn kho hàng loạt
// ============================================================
// Format Excel: SKU | Mã kho (warehouseId) | Số lượng | (Ghi chú tùy chọn)
const StockOnHandImportModal = ({ products, markets = [], onConfirm, onClose }) => {
  const [step, setStep] = useState(1); // 1: upload | 2: preview | 3: result
  const [parseResult, setParseResult] = useState(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const allWh = useMemo(() => {
    const out = [];
    (markets || []).forEach(m => (m.warehouses || []).forEach(w => out.push({ ...w, marketName: m.name })));
    return out;
  }, [markets]);

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = new Uint8Array(ev.target.result);
          const workbook = XLSX.read(data, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
          if (rows.length === 0) {
            setError("File trống");
            return;
          }
          // Parse từng row
          const parsed = [];
          const errors = [];
          rows.forEach((r, idx) => {
            const sku = String(r.SKU || r.Sku || r.sku || "").trim();
            const whId = String(r["Mã kho"] || r["Ma kho"] || r.warehouseId || r.WarehouseId || "").trim();
            const qty = Number(r["Số lượng"] || r["So luong"] || r.Quantity || r.quantity || 0);
            const note = String(r["Ghi chú"] || r.note || "").trim();
            if (!sku && !whId && !qty) return; // bỏ qua dòng trống
            const product = products.find(p => p.sku === sku);
            const wh = allWh.find(w => w.id === whId);
            const rowErrors = [];
            if (!product) rowErrors.push(`SKU "${sku}" không tồn tại`);
            if (!wh) rowErrors.push(`Mã kho "${whId}" không tồn tại`);
            if (isNaN(qty) || qty < 0) rowErrors.push(`SL không hợp lệ`);
            parsed.push({
              line: idx + 2, // +1 header, +1 0-indexed
              sku, whId, qty, note,
              product, wh,
              errors: rowErrors,
              ok: rowErrors.length === 0,
            });
            if (rowErrors.length > 0) errors.push({ line: idx + 2, sku, errors: rowErrors });
          });
          setParseResult({ rows: parsed, errors, totalRows: parsed.length, okRows: parsed.filter(r => r.ok).length });
          setStep(2);
        } catch (err) {
          setError("Lỗi đọc file: " + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (err) {
      setError("Lỗi: " + err.message);
    }
  };

  const handleConfirm = () => {
    if (!parseResult) return;
    const validRows = parseResult.rows.filter(r => r.ok);
    onConfirm(validRows.map(r => ({
      productId: r.product.id,
      warehouseId: r.wh.id,
      market: r.wh.marketName,
      quantity: r.qty,
      note: r.note || `Import Excel ${new Date().toISOString().slice(0, 10)}`,
    })));
  };

  const downloadTemplate = () => {
    const sampleRows = (products || []).slice(0, 3).map(p => {
      const firstWh = allWh[0];
      return {
        SKU: p.sku,
        "Mã kho": firstWh?.id || "",
        "Số lượng": 0,
        "Ghi chú": "",
      };
    });
    if (sampleRows.length === 0) {
      sampleRows.push({ SKU: "S24-01", "Mã kho": "wh_hcm", "Số lượng": 100, "Ghi chú": "" });
    }
    const ws = XLSX.utils.json_to_sheet(sampleRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tồn kho");
    XLSX.writeFile(wb, "Template_TonKho.xlsx");
  };

  return (
    <Modal title="📥 Import tồn kho từ Excel" onClose={onClose} width={780} hideFooter>
      {step === 1 && (
        <div>
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            <b>Cấu trúc file Excel:</b> 4 cột — <b>SKU</b> | <b>Mã kho</b> | <b>Số lượng</b> | Ghi chú (tùy chọn).
            <br />Dòng đầu = header. Mỗi dòng = 1 SP × 1 kho.
            <br /><button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 11, marginTop: 8 }} onClick={downloadTemplate}>📄 Tải template mẫu</button>
          </div>
          <div className="form-group">
            <label>Chọn file Excel (.xlsx, .xls)</label>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileUpload} />
          </div>
          {error && <div className="alert alert-danger">{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={onClose}>Đóng</button>
          </div>
        </div>
      )}
      {step === 2 && parseResult && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div className="card"><div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>Tổng dòng</div><div style={{ fontSize: 20, fontWeight: 700 }}>{parseResult.totalRows}</div></div>
            <div className="card"><div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>Hợp lệ</div><div style={{ fontSize: 20, fontWeight: 700, color: C.green600 }}>{parseResult.okRows}</div></div>
            <div className="card"><div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>Lỗi</div><div style={{ fontSize: 20, fontWeight: 700, color: C.red }}>{parseResult.errors.length}</div></div>
          </div>
          <div className="card" style={{ padding: 0, maxHeight: 400, overflow: "auto" }}>
            <table>
              <thead><tr><th>Dòng</th><th>SKU</th><th>Kho</th><th>SL</th><th>Trạng thái</th></tr></thead>
              <tbody>
                {parseResult.rows.map((r, i) => (
                  <tr key={i} style={{ background: r.ok ? "transparent" : C.redBg }}>
                    <td style={{ fontSize: 11 }}>{r.line}</td>
                    <td>{r.sku}</td>
                    <td style={{ fontSize: 12 }}>{r.wh ? `🏪 ${r.wh.name}` : <span style={{ color: C.red }}>⚠️ {r.whId}</span>}</td>
                    <td>{r.qty}</td>
                    <td>{r.ok ? <Badge label="✅ OK" color={C.green600} /> : <span style={{ fontSize: 11, color: C.red }}>{r.errors.join("; ")}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => setStep(1)}>← Quay lại</button>
            <button
              className="btn btn-primary"
              disabled={parseResult.okRows === 0}
              onClick={handleConfirm}
            >📥 Cập nhật {parseResult.okRows} dòng hợp lệ</button>
          </div>
        </div>
      )}
    </Modal>
  );
};

// ============================================================
// v38j: BulkStockConfigWizard — Cấu hình tồn an toàn hàng loạt
// ============================================================
// Wizard 3 bước: chọn nhiều SP → chọn kho → nhập tồn an toàn + slBanNgay → áp cho tất cả.
const BulkStockConfigWizard = ({ products, markets = [], onApply, onClose }) => {
  const [step, setStep] = useState(1); // 1: chọn SP | 2: chọn kho + giá trị
  const [selectedSPs, setSelectedSPs] = useState(new Set());
  const [search, setSearch] = useState("");
  const [whId, setWhId] = useState("");
  const [tonAnToan, setTonAnToan] = useState(0);
  const [slBanNgay, setSlBanNgay] = useState(0);
  const [khongTheoDoi, setKhongTheoDoi] = useState(false);

  const allWh = useMemo(() => {
    const out = [];
    (markets || []).forEach(m => (m.warehouses || []).forEach(w => out.push({ ...w, marketName: m.name })));
    return out;
  }, [markets]);

  const filteredProducts = useMemo(() => {
    if (!search) return products;
    const q = search.toLowerCase();
    return products.filter(p =>
      (p.sku || "").toLowerCase().includes(q) ||
      (p.name || "").toLowerCase().includes(q)
    );
  }, [products, search]);

  const toggleSP = (id) => {
    setSelectedSPs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedSPs(prev => {
      const next = new Set(prev);
      const allSelected = filteredProducts.every(p => next.has(p.id));
      if (allSelected) {
        filteredProducts.forEach(p => next.delete(p.id));
      } else {
        filteredProducts.forEach(p => next.add(p.id));
      }
      return next;
    });
  };

  const handleApply = () => {
    if (!whId || selectedSPs.size === 0) return;
    onApply(Array.from(selectedSPs), whId, {
      tonAnToan: Number(tonAnToan || 0),
      slBanNgay: Number(slBanNgay || 0),
      khongTheoDoi,
    });
  };

  return (
    <Modal title="🪄 Wizard cấu hình tồn kho hàng loạt" onClose={onClose} width={780} hideFooter>
      {/* Step indicator */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
        <div style={{ flex: 1, padding: "8px 12px", borderRadius: 8, background: step >= 1 ? C.green50 : C.bg, border: `1px solid ${step >= 1 ? C.green600 : C.border}`, fontSize: 12 }}>
          <b>Bước 1:</b> Chọn SP ({selectedSPs.size} đã chọn)
        </div>
        <div style={{ color: C.textMuted }}>→</div>
        <div style={{ flex: 1, padding: "8px 12px", borderRadius: 8, background: step >= 2 ? C.green50 : C.bg, border: `1px solid ${step >= 2 ? C.green600 : C.border}`, fontSize: 12 }}>
          <b>Bước 2:</b> Chọn kho + nhập giá trị
        </div>
      </div>

      {step === 1 && (
        <div>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <input
              placeholder="🔍 Tìm SP theo SKU / tên..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 11 }} onClick={toggleAllVisible}>
              {filteredProducts.every(p => selectedSPs.has(p.id)) && filteredProducts.length > 0 ? "Bỏ chọn tất cả" : "Chọn tất cả"}
            </button>
            <span style={{ fontSize: 12, color: C.textMuted }}>{selectedSPs.size} SP đã chọn / {filteredProducts.length} hiển thị</span>
          </div>
          <div className="card" style={{ padding: 0, maxHeight: 400, overflow: "auto" }}>
            <table>
              <thead><tr><th style={{ width: 40 }}></th><th>SKU</th><th>Tên SP</th><th>Danh mục</th></tr></thead>
              <tbody>
                {filteredProducts.map(p => (
                  <tr key={p.id} style={{ background: selectedSPs.has(p.id) ? C.green50 : "transparent", cursor: "pointer" }} onClick={() => toggleSP(p.id)}>
                    <td><input type="checkbox" checked={selectedSPs.has(p.id)} onChange={() => toggleSP(p.id)} /></td>
                    <td style={{ fontWeight: 600, fontSize: 12 }}>{p.sku}</td>
                    <td style={{ fontSize: 12 }}>{p.name}</td>
                    <td style={{ fontSize: 11, color: C.textMuted }}>{p.category || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
            <button className="btn btn-ghost" onClick={onClose}>Hủy</button>
            <button className="btn btn-primary" disabled={selectedSPs.size === 0} onClick={() => setStep(2)}>
              Tiếp tục → ({selectedSPs.size} SP)
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <div className="alert alert-info" style={{ marginBottom: 14, fontSize: 12 }}>
            Áp dụng cấu hình bên dưới cho <b>{selectedSPs.size} SP</b> × <b>1 kho</b> đã chọn.
          </div>
          <div className="form-grid">
            <div className="form-group" style={{ gridColumn: "1/-1" }}>
              <label>Kho áp dụng *</label>
              <select value={whId} onChange={e => setWhId(e.target.value)}>
                <option value="">-- Chọn kho --</option>
                {allWh.map(w => <option key={w.id} value={w.id}>🌍 {w.marketName} → 🏪 {w.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Ngưỡng cảnh báo</label>
              <NumberInput min={0} value={tonAnToan} onChange={e => setTonAnToan(e.target.value)} disabled={khongTheoDoi} />
            </div>
            <div className="form-group">
              <label>SL bán/ngày</label>
              <NumberInput min={0} step="0.1" value={slBanNgay} onChange={e => setSlBanNgay(e.target.value)} disabled={khongTheoDoi} />
            </div>
            <div className="form-group" style={{ gridColumn: "1/-1" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={khongTheoDoi} onChange={e => setKhongTheoDoi(e.target.checked)} />
                <span>⚪ Không theo dõi (kho này không bán SP đã chọn)</span>
              </label>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => setStep(1)}>← Quay lại</button>
            <button className="btn btn-primary" disabled={!whId} onClick={handleApply}>
              ✅ Áp dụng cho {selectedSPs.size} SP
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};

const Markets = ({ markets, shipments, payments, onAdd, onEdit, onDelete, user }) => {
  const [modal, setModal] = useState(null);
  // v36: Thay alert() trùng tên thị trường bằng ConfirmDialog
  const [confirmDlg, setConfirmDlg] = useState(null);
  const canManage = can(user, "manage_markets");

  const marketStats = useMemo(() => markets.map(m => {
    // v26: Loại trừ cả Hủy + Nháp khỏi đếm shipment
    const ships = shipments.filter(s => s.market === m.name && isOperationalShipment(s)).length;
    const pays = payments.filter(p => p.type === "MARKET_TO_FACTORY" && p.fromMarket === m.name).length;
    const whCount = (m.warehouses || []).length;
    return { ...m, shipmentCount: ships, paymentCount: pays, whCount };
  }), [markets, shipments, payments]);

  return (
    <div>
      <SectionHeader title="Thị trường & Kho" subtitle={`${markets.length} thị trường · ${markets.reduce((s, m) => s + (m.warehouses || []).length, 0)} kho hàng`}
        action={canManage && <button className="btn btn-primary" onClick={() => setModal({ type: "new" })}>+ Thêm thị trường</button>}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 16 }}>
        {marketStats.map(m => (
          <div key={m.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: `linear-gradient(135deg, ${C.blue} 0%, ${C.green500} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 22 }}>{getFlag(m.name)}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{m.name}</div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                    <span style={{ fontFamily: "monospace", background: C.bg, padding: "1px 6px", borderRadius: 4, marginRight: 6 }}>{m.code || "-"}</span>
                    Tiền tệ: <b>{m.currency}</b>
                  </div>
                </div>
              </div>
              {canManage && (
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: m })}>Sửa</button>
                  <button className="btn btn-danger" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => onDelete("markets", m.id)}>X</button>
                </div>
              )}
            </div>

            {m.note && <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12, fontStyle: "italic" }}>{m.note}</div>}

            {/* Warehouses list */}
            <div style={{ padding: 10, background: C.bg, borderRadius: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: C.green700, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>🏪 Kho ({m.whCount})</div>
              {m.whCount === 0 ? (
                <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Chưa có kho — bấm Sửa để thêm</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {(m.warehouses || []).map(w => {
                    const isDefault = w.isDefault || (m.warehouses.length === 1);
                    return (
                      <div key={w.id} style={{ fontSize: 11, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 600, color: C.text, display: "flex", alignItems: "center", gap: 6 }}>
                          {isDefault && <span title="Kho mặc định" style={{ color: C.gold, fontSize: 12 }}>⭐</span>}
                          📦 {w.name || "(chưa đặt tên)"}
                        </span>
                        {w.address && <span style={{ color: C.textMuted, fontSize: 10 }}>{w.address}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, paddingTop: 12, borderTop: `1px solid ${C.borderLight}` }}>
              <div>
                <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>Lô hàng</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.green600 }}>{m.shipmentCount}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>Thanh toán</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.blue }}>{m.paymentCount}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {modal?.type === "new" && <MarketForm shipments={shipments} onSave={f => {
        const trimmed = { ...f, name: f.name.trim(), code: (f.code || "").trim() };
        if (markets.some(m => m.name.toLowerCase() === trimmed.name.toLowerCase())) {
          setConfirmDlg({ title: "Trùng tên thị trường", message: `Thị trường "${trimmed.name}" đã tồn tại.`, confirmLabel: "OK", cancelLabel: null, onConfirm: () => {} });
          return;
        }
        onAdd("markets", { id: `m_${uid()}`, ...trimmed });
        setModal(null);
      }} onClose={() => setModal(null)} />}
      {modal?.type === "edit" && <MarketForm initial={modal.data} shipments={shipments} onSave={f => {
        const trimmed = { ...f, name: f.name.trim(), code: (f.code || "").trim() };
        if (markets.some(m => m.id !== modal.data.id && m.name.toLowerCase() === trimmed.name.toLowerCase())) {
          setConfirmDlg({ title: "Trùng tên thị trường", message: `Thị trường "${trimmed.name}" đã tồn tại.`, confirmLabel: "OK", cancelLabel: null, onConfirm: () => {} });
          return;
        }
        onEdit("markets", modal.data.id, trimmed);
        setModal(null);
      }} onClose={() => setModal(null)} />}
      {/* v36: ConfirmDialog cho trùng tên thị trường */}
      {confirmDlg && <ConfirmDialog {...confirmDlg} onClose={() => setConfirmDlg(null)} />}
    </div>
  );
};

// ============================================================
// SETTINGS v10 — Tỷ giá + Danh mục sản phẩm
// ============================================================
const Settings = ({ settings, onSave, user }) => {
  const [form, setForm] = useState({
    ...settings,
    productCategories: settings.productCategories || ["Micro", "Tai nghe", "Phụ kiện"],
  });
  const setNum = (k, v) => setForm(p => ({ ...p, [k]: Number(v) || 0 }));
  const canEdit = can(user, "manage_settings");

  // v11.1: Sync state với settings từ ngoài (trường hợp category được thêm từ Products)
  useEffect(() => {
    setForm({ ...settings, productCategories: settings.productCategories || [] });
  }, [settings]);

  // Category management — TỰ SAVE NGAY khi thao tác
  const [newCat, setNewCat] = useState("");
  // v11.2: Custom dialog states
  const [confirmDlg, setConfirmDlg] = useState(null);
  const [promptDlg, setPromptDlg] = useState(null);

  const addCategory = () => {
    const t = newCat.trim();
    if (!t) return;
    const cats = form.productCategories || [];
    if (cats.some(c => c.toLowerCase() === t.toLowerCase())) {
      setConfirmDlg({ title: "Trùng danh mục", message: `Danh mục "${t}" đã tồn tại.`, confirmLabel: "OK", onConfirm: () => {} });
      return;
    }
    const next = { ...form, productCategories: [...cats, t] };
    setForm(next);
    onSave(next);
    setNewCat("");
  };
  const removeCategory = (cat) => {
    setConfirmDlg({
      title: `Xóa danh mục "${cat}"?`,
      message: "Các SP đang gán danh mục này sẽ không còn danh mục.\n\nHành động này KHÔNG THỂ hoàn tác.",
      danger: true, confirmLabel: "Xóa",
      onConfirm: () => {
        const next = { ...form, productCategories: (form.productCategories || []).filter(c => c !== cat) };
        setForm(next);
        onSave(next);
      },
    });
  };
  const renameCategory = (oldName) => {
    setPromptDlg({
      title: "Đổi tên danh mục",
      message: `Tên cũ: "${oldName}"`,
      placeholder: "Nhập tên mới...",
      defaultValue: oldName,
      confirmLabel: "Đổi tên",
      onConfirm: (newName) => {
        if (!newName || newName === oldName) return;
        if ((form.productCategories || []).some(c => c.toLowerCase() === newName.toLowerCase() && c !== oldName)) {
          setConfirmDlg({ title: "Trùng danh mục", message: `Danh mục "${newName}" đã tồn tại.`, confirmLabel: "OK", onConfirm: () => {} });
          return;
        }
        const next = { ...form, productCategories: (form.productCategories || []).map(c => c === oldName ? newName : c) };
        setForm(next);
        onSave(next);
      },
    });
  };

  return (
    <div>
      <SectionHeader title="Cấu hình hệ thống" subtitle="Tỷ giá · Danh mục sản phẩm · Các cài đặt chung" />

      {/* Tỷ giá */}
      <div className="card" style={{ maxWidth: 720, marginBottom: 20 }}>
        <div className="card-green-header">💱 Tỷ giá quy đổi về VND</div>
        <div style={{ background: C.green50, border: `1px solid ${C.borderLight}`, borderRadius: 8, padding: "10px 12px", marginBottom: 14, fontSize: 11, color: C.green800, lineHeight: 1.6 }}>
          <b>📌 Cách dùng tỷ giá trong hệ thống (V34+):</b><br/>
          • <b>Tỷ giá hệ thống dưới đây</b>: dùng cho hiển thị quy đổi <i>tham chiếu</i> ở PO, Đơn giao hàng, Công nợ NCC, các KPI Dashboard (Hàng chờ ship / Đang VC / Đã về kho / Còn phải trả / Quỹ tín dụng).<br/>
          • <b>Khi thanh toán NCC</b>: hệ thống yêu cầu nhập <i>tỷ giá riêng tại ngày trả</i> (prefill từ tỷ giá dưới đây, có thể sửa). Số VND thực tế đã chuyển sẽ được lưu cứng theo tỷ giá đó → khớp sao kê NH.<br/>
          • <b>KPI "Đã thanh toán" trên Dashboard</b>: hiển thị VND thực tế (cộng từng payment), khác với Hàng đã ship (theo tỷ giá hệ thống) — đây là đặc tính của hệ thống đa tiền tệ.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[
            { key: "cnyToVnd", label: "1 CNY = ? VND", flag: "🇨🇳" },
            { key: "thbToVnd", label: "1 THB = ? VND", flag: "🇹🇭" },
            { key: "myrToVnd", label: "1 MYR = ? VND", flag: "🇲🇾" },
            { key: "phpToVnd", label: "1 PHP = ? VND", flag: "🇵🇭" },
            { key: "usdToVnd", label: "1 USD = ? VND", flag: "🇺🇸" },
          ].map(({ key, label, flag }) => (
            <div key={key} style={{ display: "grid", gridTemplateColumns: "60px 1fr 200px", gap: 12, alignItems: "center" }}>
              <div style={{ fontSize: 28 }}>{flag}</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{label}</div>
              <input type="number" min={0} value={form[key]} onChange={e => setNum(key, e.target.value)} disabled={!canEdit} />
            </div>
          ))}
        </div>
      </div>

      {/* Product Categories */}
      <div className="card" style={{ maxWidth: 720, marginBottom: 20 }}>
        <div className="card-green-header">📦 Danh mục sản phẩm</div>
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12 }}>
          Danh mục dùng khi tạo/sửa sản phẩm. Xóa danh mục không xóa SP, chỉ bỏ gán. <b>Thay đổi được lưu ngay lập tức.</b>
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="Tên danh mục mới..." onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCategory(); } }} />
            <button className="btn btn-primary" style={{ whiteSpace: "nowrap" }} onClick={addCategory}>+ Thêm</button>
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {(form.productCategories || []).length === 0 && (
            <div style={{ fontSize: 12, color: C.textLight, fontStyle: "italic", padding: 8 }}>Chưa có danh mục nào</div>
          )}
          {(form.productCategories || []).map(cat => (
            <div key={cat} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: C.green50, border: `1px solid ${C.green200}`, borderRadius: 20 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.green800 }}>{cat}</span>
              {canEdit && (
                <>
                  <button onClick={() => renameCategory(cat)} title="Đổi tên" style={{ background: "transparent", border: "none", cursor: "pointer", color: C.blue, fontSize: 11, padding: 0 }}>✎</button>
                  <button onClick={() => removeCategory(cat)} title="Xóa" style={{ background: "transparent", border: "none", cursor: "pointer", color: C.red, fontSize: 12, padding: 0, fontWeight: 700 }}>✕</button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {canEdit ? (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, maxWidth: 720 }}>
          <button className="btn btn-ghost" onClick={() => setForm({ ...settings, productCategories: settings.productCategories || [] })}>Hủy (chỉ tỷ giá)</button>
          <button className="btn btn-primary" onClick={() => onSave(form)}>💾 Lưu tỷ giá</button>
        </div>
      ) : (
        <div className="alert alert-info" style={{ maxWidth: 720 }}>Chỉ Quản trị viên mới được sửa cấu hình</div>
      )}
      {/* v11.2: Custom dialogs */}
      {confirmDlg && <ConfirmDialog {...confirmDlg} onClose={() => setConfirmDlg(null)} />}
      {promptDlg && <PromptDialog {...promptDlg} onClose={() => setPromptDlg(null)} />}
    </div>
  );
};

// ============================================================
// MAIN APP
// ============================================================
// v25: Tái cấu trúc sidebar — gọn lại 14 tab, 4 mục cấu hình gộp vào tab "Cấu hình" với sub-tabs
const TABS = [
  // 🔵 Tổng quan
  { id: "dashboard", label: "Dashboard", icon: "📊", perm: "view_dashboard" },

  // 🟠 Vận hành (nhập hàng + kho)
  { id: "pos", label: "Đơn đặt hàng", icon: "📋", perm: null },
  { id: "shipments", label: "Giao hàng", icon: "🚚", perm: null },
  { id: "warranties", label: "Bảo hành", icon: "🔧", perm: null },
  { id: "inventory", label: "Tồn kho", icon: "🏬", perm: null },

  // 🟡 Tài chính
  { id: "payments", label: "Thanh toán", icon: "💸", perm: null },
  { id: "debts", label: "Công nợ NCC", icon: "💰", perm: null },
  { id: "market_debts", label: "Công nợ thị trường", icon: "🌐", perm: "view_market_debt" },
  { id: "fees", label: "Thuế phí nhập khẩu", icon: "💵", perm: null },
  { id: "opening_balance", label: "Công nợ đầu kỳ", icon: "📋", perm: "manage_opening_balance" },

  // 🟢 Catalog
  { id: "products", label: "Sản phẩm", icon: "📦", perm: null },

  // ⚙️ Hệ thống
  { id: "audit", label: "Nhật ký", icon: "📜", perm: "view_audit_log" },
  { id: "configuration", label: "Cấu hình", icon: "⚙️", perm: null }, // hub có sub-tabs
  { id: "help", label: "Hướng dẫn", icon: "📚", perm: null },
];

// v25: Sub-tabs trong tab Cấu hình — mỗi sub-tab có quyền riêng
const CONFIG_SUBTABS = [
  { id: "general",   label: "Chung",            icon: "⚙️",  perm: "manage_settings" },
  { id: "factories", label: "Nhà cung cấp",    icon: "🏭",  perm: null },
  { id: "carriers",  label: "Đơn vị vận chuyển", icon: "🚛",  perm: null },
  { id: "markets",   label: "Thị trường & Kho", icon: "🌍",  perm: null },
  { id: "users",     label: "Tài khoản",        icon: "👥",  perm: "manage_users" },
];

export default function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [data, setData] = useState({
    factories: [], products: [], pos: [], shipments: [], payments: [], users: SEED_USERS, auditLog: [],
    openingBalances: [], feePayments: [], markets: [], carriers: [], stockOnHand: [], settings: DEFAULT_SETTINGS,
  });
  const [loaded, setLoaded] = useState(false);
  // v38g: State cho modal đổi mật khẩu cá nhân
  const [showChangePass, setShowChangePass] = useState(false);
  // v38i: State + handler banner migration đã được xóa theo yêu cầu (không cần thiết nữa)

  useEffect(() => {
    (async () => {
      // v23: Ưu tiên load v31, nếu chưa có thì migrate từ v23/v22/.../v9
      // v31 refactor: Thay 14 cấp if-else lồng nhau bằng loop. Logic giống hệt — ưu tiên v cao trước.
      // v32: Bump key v23 → v31 để khi user dùng V32 lần đầu sẽ KHÔNG load data test cũ trong storage.
      //      Thay vào đó: thử migrate từ v23 (nếu user đã dùng app trước & có data thật), không có thì init từ SEED.
      // v34: Bump key v31 → v34 để force chạy migration backfill exchangeRate cho payment cũ
      // v38: Bump key v34 → v38 để force chạy migration backfill paymentStage + stageHistory cho payment cũ
      // v43: Chuyển sang s3Storage.js — loadAll() tự GET từ S3 → fallback localStorage → memory
      let saved = await loadAll();
      let migratedFrom = ""; // ghi nhận đã migrate từ phiên bản nào (debug/audit)
      if (!saved) {
        // Fallback: thử đọc từ localStorage key cũ (migration từ phiên bản trước khi có S3)
        const LEGACY_VERSIONS = ["v38i", "v38", "v34", "v31", "v23", "v22", "v21", "v20", "v19", "v18", "v17", "v16", "v15", "v14", "v13", "v12", "v11", "v10", "v9"];
        for (const v of LEGACY_VERSIONS) {
          try {
            const raw = localStorage.getItem(`crm_data_${v}`);
            if (raw) { saved = JSON.parse(raw); migratedFrom = v; break; }
          } catch {}
        }
        if (migratedFrom) console.info(`[GoChek CRM] Migrating data from ${migratedFrom} → v43 (S3)`);
      }

      if (saved) {
        // v13: Migration PO status — map các status cũ sang 3 status mới (Chờ duyệt / Đã duyệt / Hủy).
        // KHÔNG xóa field `produced` khỏi item — chỉ không dùng nữa, để rollback an toàn.
        const PO_STATUS_MIGRATION = {
          "Chờ xác nhận": "Chờ duyệt",
          "Đang sản xuất": "Đã duyệt",
          "SX một phần": "Đã duyệt",
          "Hoàn thành SX": "Đã duyệt",
        };
        if (Array.isArray(saved.pos)) {
          saved.pos = saved.pos.map(p => {
            if (PO_STATUS_MIGRATION[p.status]) {
              return { ...p, status: PO_STATUS_MIGRATION[p.status] };
            }
            return p;
          });
        }

        // v11.1: LUÔN rerun migration markets để đảm bảo mọi market đều có warehouses
        // Fix bug: market bị mất warehouses do thao tác cũ hoặc migration chưa đủ
        if (!saved.markets || saved.markets.length === 0) saved.markets = SEED_MARKETS;
        saved.markets = saved.markets.map(m => {
          let warehouses;
          if (Array.isArray(m.warehouses) && m.warehouses.length > 0) {
            warehouses = m.warehouses;
          } else {
            const seedM = SEED_MARKETS.find(x => x.name === m.name);
            warehouses = seedM?.warehouses || [{ id: `wh_${m.id || uid()}_main`, name: `Kho ${m.name}`, address: "", note: "" }];
          }
          // v12: Đảm bảo mỗi warehouse có field isDefault; đảm bảo có đúng 1 kho default
          warehouses = warehouses.map(w => ({ ...w, isDefault: !!w.isDefault }));
          const hasDefault = warehouses.some(w => w.isDefault);
          if (!hasDefault && warehouses.length > 0) {
            warehouses = warehouses.map((w, i) => ({ ...w, isDefault: i === 0 }));
          } else {
            // Nhiều kho cùng isDefault → chỉ giữ cái đầu tiên
            let firstFound = false;
            warehouses = warehouses.map(w => {
              if (w.isDefault && !firstFound) { firstFound = true; return w; }
              if (w.isDefault) return { ...w, isDefault: false };
              return w;
            });
          }
          return { ...m, warehouses };
        });
        // Migrate factories: contact → contactPerson
        saved.factories = (saved.factories || []).map((f, i) => ({
          supplierCode: f.supplierCode || `NCC-${String(i + 1).padStart(3, "0")}`,
          address: f.address || "",
          paymentDays: f.paymentDays ?? 30,
          productionDays: f.productionDays ?? 15,
          bankInfo: f.bankInfo || "",
          status: f.status || "active",
          note: f.note || "",
          ...f,
          contactPerson: f.contactPerson || f.contact || "",
        }));
        // Migrate products: thêm kích thước + SL/thùng
        saved.products = (saved.products || []).map(p => ({
          nameImport: p.nameImport || p.name || "",
          category: p.category || "",
          imageUrl: p.imageUrl || "",
          lengthCm: p.lengthCm ?? "",
          widthCm: p.widthCm ?? "",
          heightCm: p.heightCm ?? "",
          qtyPerCarton: p.qtyPerCarton ?? "",
          ...p,
        }));

        // v11: Auto-migrate carriers — tạo carrier từ text carrier trong shipments cũ
        if (!saved.carriers || saved.carriers.length === 0) {
          const carrierMap = new Map(); // name → {id, ...}
          (saved.shipments || []).forEach(s => {
            const name = (s.carrier || "").trim();
            if (!name || carrierMap.has(name.toLowerCase())) return;
            const nextNum = carrierMap.size + 1;
            carrierMap.set(name.toLowerCase(), {
              id: `car_${uid().toLowerCase()}`,
              code: `VC-${String(nextNum).padStart(3, "0")}`,
              name,
              type: "Khác",
              contactPerson: "", phone: "", email: "", address: "",
              paymentDays: 30, bankInfo: "", status: "active",
              note: "Tự động tạo từ lịch sử giao hàng",
            });
          });
          saved.carriers = Array.from(carrierMap.values());
          // Cũng hỗ trợ seed cơ bản nếu không có shipment
          if (saved.carriers.length === 0) saved.carriers = SEED_CARRIERS;
        }

        // Migrate shipments: carrier text → carrierId, thêm packages/warehouseId
        // v19: bổ sung documents: [] cho data cũ
        saved.shipments = (saved.shipments || []).map(s => {
          let carrierId = s.carrierId || "";
          if (!carrierId && s.carrier) {
            const c = (saved.carriers || []).find(x => x.name.toLowerCase() === String(s.carrier).toLowerCase());
            if (c) carrierId = c.id;
          }
          return {
            packages: s.packages || "",
            warehouseId: s.warehouseId || "",
            ...s,
            carrierId,
            status: s.status === "Đang vận chuyển" ? "Đang vận chuyển TQ" : s.status,
            // Đảm bảo fees có carrierId (mặc định rỗng)
            fees: (s.fees || []).map(f => ({ carrierId: f.carrierId || "", ...f })),
            // v19: Đảm bảo documents là mảng (kể cả khi spread đè)
            // v25b: Migration đổi "Chứng từ kiểm dịch" → "Hợp đồng" cho data cũ
            documents: (Array.isArray(s.documents) ? s.documents : []).map(d =>
              d.type === "Chứng từ kiểm dịch" ? { ...d, type: "Hợp đồng" } : d
            ),
          };
        });

        // Migrate settings
        saved.settings = {
          ...DEFAULT_SETTINGS,
          ...saved.settings,
          productCategories: saved.settings?.productCategories || DEFAULT_SETTINGS.productCategories,
          supplierStatuses: saved.settings?.supplierStatuses || DEFAULT_SETTINGS.supplierStatuses,
        };

        // v18: Bổ sung warranties (entity mới) — data cũ chưa có thì gán mảng rỗng
        if (!Array.isArray(saved.warranties)) saved.warranties = [];

        // v20: Bổ sung field status="active" cho data cũ — payments / openingBalances / feePayments
        // Bản ghi cũ chưa có trường status → mặc định là active để không phá tính toán
        saved.payments = (saved.payments || []).map(p => ({ status: "active", ...p }));
        saved.openingBalances = (saved.openingBalances || []).map(o => ({ status: "active", ...o }));
        saved.feePayments = (saved.feePayments || []).map(p => ({ status: "active", ...p }));

        // v23: Bổ sung openingStock + stockMovements
        // Nếu data cũ chưa có → khởi tạo mảng rỗng
        if (!Array.isArray(saved.openingStock)) saved.openingStock = [];
        if (!Array.isArray(saved.stockMovements)) saved.stockMovements = [];
        // v23b: bổ sung stockImportBatches
        if (!Array.isArray(saved.stockImportBatches)) saved.stockImportBatches = [];
        // Bổ sung warehouseThresholds + externalSkus vào products
        saved.products = (saved.products || []).map(p => ({
          warehouseThresholds: {},
          externalSkus: {}, // v23b
          ...p,
        }));
        // v23b: Bổ sung posConnection cho mỗi warehouse (mặc định manual)
        saved.markets = (saved.markets || []).map(m => ({
          ...m,
          warehouses: (m.warehouses || []).map(w => ({
            posConnection: w.posConnection || { system: "manual" },
            ...w,
          })),
        }));

        // v31 fix: Dọn opening stock + stock movements có warehouseId không tồn tại
        // Tránh tình trạng tồn kho "ma" không hiển thị trong Inventory (vd: wh_vn_bd cũ).
        // Đánh dấu status="cancelled" thay vì xóa cứng → audit-trail an toàn, có thể rollback.
        const validWhIds = new Set();
        (saved.markets || []).forEach(m => (m.warehouses || []).forEach(w => validWhIds.add(w.id)));
        let orphanOpeningCount = 0;
        let orphanMovementCount = 0;
        saved.openingStock = (saved.openingStock || []).map(o => {
          if (o.status === "cancelled") return o;
          if (!validWhIds.has(o.warehouseId)) {
            orphanOpeningCount++;
            return { ...o, status: "cancelled", cancelReason: `[v31 auto-clean] Kho '${o.warehouseId}' không tồn tại`, cancelledAt: new Date().toISOString() };
          }
          return o;
        });
        // Manual movements (không phải AUTO-* sinh từ shipment/warranty) cũng cần dọn
        saved.stockMovements = (saved.stockMovements || []).map(mv => {
          if (mv.status === "cancelled") return mv;
          if (mv.refType === "shipment_arrive" || mv.refType === "warranty_send" || mv.refType === "warranty_return") return mv; // sẽ rebuild
          if (!validWhIds.has(mv.warehouseId)) {
            orphanMovementCount++;
            return { ...mv, status: "cancelled", cancelReason: `[v31 auto-clean] Kho '${mv.warehouseId}' không tồn tại` };
          }
          return mv;
        });
        if (orphanOpeningCount > 0 || orphanMovementCount > 0) {
          // Cảnh báo nhẹ trong console (không alert vì migration chạy 1 lần, không nên làm phiền user)
          console.warn(`[GoChek CRM v31] Đã tự động dọn dẹp: ${orphanOpeningCount} bản ghi đầu kỳ + ${orphanMovementCount} biến động kho có warehouseId không tồn tại.`);
        }

        // Auto rebuild AUTO movements từ shipments + warranties
        saved.stockMovements = rebuildAutoMovements(saved.shipments || [], saved.warranties || [], saved.stockMovements || []);

        // v34: Backfill exchangeRate + amountInVND cho payment cũ.
        // Logic: nếu payment chưa có exchangeRate (data từ V33 trở về trước), dùng tỷ giá hệ thống
        // hiện tại làm tỷ giá lưu cứng. Đảm bảo behavior cũ không thay đổi sau migration.
        // Chỉ backfill cho Payment NCC (MARKET_TO_FACTORY + INTER_FACTORY). Fee Payment giữ nguyên.
        let backfilledPayments = 0;
        saved.payments = (saved.payments || []).map(p => {
          if (p.exchangeRate !== undefined && p.exchangeRate !== null) return p; // đã có
          if (p.currency === "VND" || !p.currency) {
            // Payment VND không cần tỷ giá → đặt = 1 cho nhất quán
            return { ...p, exchangeRate: 1, amountInVND: Number(p.amount || 0) };
          }
          const rateKey = `${p.currency.toLowerCase()}ToVnd`;
          const rate = saved.settings?.[rateKey] || 1;
          backfilledPayments++;
          return {
            ...p,
            exchangeRate: rate,
            amountInVND: Number(p.amount || 0) * rate,
          };
        });
        if (backfilledPayments > 0) {
          console.info(`[GoChek CRM v34] Đã backfill tỷ giá cho ${backfilledPayments} payment cũ (dùng tỷ giá hệ thống hiện tại).`);
        }

        // v38: Backfill paymentStage + stageHistory cho payment cũ.
        // Mọi payment cũ → set paymentStage="completed" + stageHistory=[1 entry].
        // Lý do: payment cũ đã được nhập vào hệ thống = giả định đã hoàn tất giao dịch.
        // Đảm bảo behavior cũ KHÔNG đổi (Đã trả/Còn phải trả của Debts + MarketDebts giữ nguyên).
        let backfilledStages = 0;
        saved.payments = (saved.payments || []).map(p => {
          if (p.paymentStage && Array.isArray(p.stageHistory)) return p; // đã có
          backfilledStages++;
          return {
            ...p,
            paymentStage: p.paymentStage || "completed",
            stageHistory: Array.isArray(p.stageHistory) ? p.stageHistory : [
              { stage: "completed", at: p.payDate || new Date().toISOString().slice(0, 10), by: "(migration v38)" },
            ],
          };
        });
        if (backfilledStages > 0) {
          console.info(`[GoChek CRM v38] Đã backfill paymentStage="completed" cho ${backfilledStages} payment cũ.`);
        }

        // v38: Backfill paymentStageThresholds trong settings nếu chưa có
        if (!saved.settings.paymentStageThresholds) {
          saved.settings = { ...saved.settings, paymentStageThresholds: { ...DEFAULT_PAYMENT_STAGE_THRESHOLDS } };
        }

        // v38i: HARD MIGRATION OB — XÓA SẠCH OB cũ (schema cũ không có market+factoryId bắt buộc).
        // v43 FIX: Chỉ xóa OB schema CŨ (thiếu market HOẶC thiếu factoryId).
        // OB mới (có cả market + factoryId) được giữ nguyên — tránh bug xóa nhầm data production.
        if (!saved._v38i_migrated) {
          const oldSchemaOBs = (saved.openingBalances || []).filter(o => !o.market || !o.factoryId);
          if (oldSchemaOBs.length > 0) {
            // Chỉ xóa OB schema cũ, giữ lại OB schema mới
            saved.openingBalances = (saved.openingBalances || []).filter(o => o.market && o.factoryId);
            saved._v38i_oldOBCount = oldSchemaOBs.length;
            console.warn(`[GoChek CRM v38i] MIGRATION: Đã xóa ${oldSchemaOBs.length} OB schema cũ (thiếu market/factoryId). Giữ lại ${saved.openingBalances.length} OB schema mới.`);
          }
          saved._v38i_migrated = true;
        }

        // v38j: Migration nhẹ Product — thêm warehouseTargets + 3 thời gian.
        // SP cũ tự gán defaults → mặc định ⚪ Không theo dõi cho mọi kho.
        let v38jProductMigrated = 0;
        saved.products = (saved.products || []).map(p => {
          const needsUpdate = !p.warehouseTargets || p.thoiGianSanXuat === undefined ||
                              p.thoiGianVanChuyen === undefined || p.soNgayDuKienBan === undefined;
          if (!needsUpdate) return p;
          v38jProductMigrated++;
          return {
            ...p,
            warehouseTargets: p.warehouseTargets || {},
            thoiGianSanXuat: p.thoiGianSanXuat ?? 0,
            thoiGianVanChuyen: p.thoiGianVanChuyen ?? 0,
            soNgayDuKienBan: p.soNgayDuKienBan ?? 0,
          };
        });
        if (v38jProductMigrated > 0) {
          console.info(`[GoChek CRM v38j] Đã migrate ${v38jProductMigrated} sản phẩm với schema mới.`);
        }

        // v38j: Khởi tạo stockOnHand mảng rỗng nếu chưa có
        if (!Array.isArray(saved.stockOnHand)) {
          saved.stockOnHand = [];
        }

        setData(d => ({ ...d, ...saved }));
        // v43: Save to S3 + localStorage via s3Storage
        await saveAll(saved);
      } else {
        // v32: Khởi tạo lần đầu — chỉ có 1 admin + 4 thị trường + 6 kho + settings.
        // Mọi mảng dữ liệu test khác (factories/products/carriers/pos/shipments/...) đều rỗng.
        const init = {
          factories: SEED_FACTORIES,
          products: SEED_PRODUCTS.map(p => ({ warehouseThresholds: {}, externalSkus: {}, ...p })),
          pos: SEED_POS,
          shipments: SEED_SHIPMENTS,
          payments: SEED_PAYMENTS.map(p => ({ status: "active", ...p })),
          users: SEED_USERS,
          auditLog: SEED_AUDIT_LOG,
          openingBalances: SEED_OPENING_BALANCES.map(o => ({ status: "active", ...o })),
          feePayments: SEED_FEE_PAYMENTS.map(p => ({ status: "active", ...p })),
          markets: SEED_MARKETS.map(m => ({
            ...m,
            warehouses: (m.warehouses || []).map(w => ({ posConnection: { system: "manual" }, ...w })),
          })),
          carriers: SEED_CARRIERS,
          warranties: SEED_WARRANTIES,
          settings: DEFAULT_SETTINGS,
          openingStock: SEED_OPENING_STOCK,
          stockMovements: rebuildAutoMovements(SEED_SHIPMENTS, SEED_WARRANTIES, SEED_STOCK_MOVEMENTS),
          stockImportBatches: [], // v23b
          stockOnHand: [], // v38j: Tồn trong kho — chị nhập tay/import
        };
        setData(init);
        await saveAll(init);
      }

      // v38g: Restore session từ localStorage (F5 không bị logout)
      try {
        const sessionStr = localStorage.getItem("crm_session_v38g");
        if (sessionStr) {
          const session = JSON.parse(sessionStr);
          const now = Date.now();
          // Validate session
          if (!session.userId || !session.expiresAt) {
            // Session cũ không hợp lệ → xóa
            localStorage.removeItem("crm_session_v38g");
          } else if (now > session.expiresAt) {
            // Session đã hết hạn 24h
            localStorage.removeItem("crm_session_v38g");
            console.log("[v38g] Session expired — please login again");
          } else {
            // Tìm user trong data
            const dataToCheck = saved || (await loadAll());
            const users = dataToCheck?.users || SEED_USERS;
            const sessionUser = users.find(u => u.id === session.userId);
            if (!sessionUser) {
              // User không còn tồn tại (admin đã hard delete)
              localStorage.removeItem("crm_session_v38g");
              console.log("[v38g] Session user not found — invalidated");
            } else if (sessionUser.status && sessionUser.status !== "active") {
              // User đã bị stopped/disabled
              localStorage.removeItem("crm_session_v38g");
              console.log("[v38g] Session user inactive — invalidated");
            } else {
              // Session OK → restore
              setUser(sessionUser);
              console.log("[v38g] Session restored for user:", sessionUser.username);
            }
          }
        }
      } catch (e) {
        console.warn("[v38g] Session restore failed", e);
      }

      setLoaded(true);
    })();
  }, []);

  // v43: Auto sync S3 — Push/Pull mỗi 2 phút + flush khi đóng tab
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

  // v23: save tự động rebuild AUTO movements khi data shipments/warranties thay đổi
  const save = useCallback(async (next) => {
    const synced = {
      ...next,
      stockMovements: rebuildAutoMovements(next.shipments || [], next.warranties || [], next.stockMovements || []),
    };
    setData(synced);
    await saveAll(synced);
    // v38g: Rolling session — gia hạn 24h từ now mỗi khi user có action
    try {
      const sessionStr = localStorage.getItem("crm_session_v38g");
      if (sessionStr) {
        const session = JSON.parse(sessionStr);
        session.expiresAt = Date.now() + 24 * 60 * 60 * 1000;
        localStorage.setItem("crm_session_v38g", JSON.stringify(session));
      }
    } catch (e) { /* silent */ }
  }, []);

  const addAuditLog = (action, target, detail = {}) => {
    const log = logAudit(action, target, user, detail);
    return [...data.auditLog, log];
  };

  const actionLabel = (key) => {
    if (key === "openingBalances") return "opening_balance";
    if (key === "feePayments") return "fee_payment";
    if (key === "warranties") return "warranty";
    return key.slice(0, -1);
  };

  const entityLabels = {
    products: "sản phẩm",
    pos: "đơn đặt hàng",
    shipments: "đơn giao hàng",
    payments: "giao dịch thanh toán",
    factories: "nhà cung cấp",
    markets: "thị trường",
    carriers: "đơn vị vận chuyển",
    users: "tài khoản",
    openingBalances: "công nợ đầu kỳ",
    feePayments: "thanh toán phí",
    warranties: "lô bảo hành",
  };

  const onAdd = (key, item) => {
    const newLog = addAuditLog(`create_${actionLabel(key)}`, item.id || item.username, item);
    save({ ...data, [key]: [...data[key], item], auditLog: newLog });
  };
  const onEdit = (key, id, updates) => {
    // v21: Phát hiện hành động hủy → ghi log với action "cancel_xxx" thay vì "update_xxx"
    // Để dễ tra cứu nhật ký + chú thích lý do hủy hiển thị rõ
    const isCancellingV20 = updates.status === "cancelled" && updates.cancelReason;
    const isCancellingShipment = key === "shipments" && updates.status === "Hủy" && updates.cancelReason;
    const isCancelling = isCancellingV20 || isCancellingShipment;

    // v26: Phát hiện duyệt Nháp → "Chờ xuất" — log với action riêng
    const oldEntity = data[key]?.find(x => x.id === id);
    const isApprovingDraft = key === "shipments" && oldEntity?.status === "Nháp" && updates.status === "Chờ xuất";

    // v38f: Phát hiện rename ID — flag _renamedFrom đặt từ POForm/ShipmentForm
    // updates.id là ID mới, id (param) là ID cũ
    const isRenaming = !!updates._renamedFrom && updates.id && updates.id !== id;
    if (isRenaming) {
      const oldId = updates._renamedFrom;
      const newId = updates.id;
      // Log riêng action rename với detail rõ ràng
      const renameAction = key === "pos" ? "rename_po" : key === "shipments" ? "rename_shipment" : `rename_${actionLabel(key)}`;
      const cleanUpdates = { ...updates };
      delete cleanUpdates._renamedFrom; // Bỏ flag tạm khỏi snapshot
      const newLog = addAuditLog(renameAction, oldId, { oldId, newId, ...cleanUpdates });
      // Save: thay record cũ bằng record mới với ID mới
      save({
        ...data,
        [key]: data[key].map(x => x.id === oldId ? { ...x, ...cleanUpdates, id: newId } : x),
        auditLog: newLog,
      });
      return;
    }

    const action = isCancelling ? `cancel_${actionLabel(key)}`
                  : isApprovingDraft ? `approve_draft_shipment`
                  : `update_${actionLabel(key)}`;
    const newLog = addAuditLog(action, id, updates);
    save({ ...data, [key]: data[key].map(x => x.id === id ? { ...x, ...updates } : x), auditLog: newLog });
  };
  const onDelete = (key, id) => {
    const entity = data[key].find(x => x.id === id);
    const label = entityLabels[key] || "mục này";
    const name = entity?.name || entity?.sku || entity?.username || entity?.id || id;
    setConfirmDialog({
      title: `Xóa ${label}?`,
      message: `Bạn có chắc chắn muốn xóa ${label} "${name}"?\n\nHành động này KHÔNG THỂ hoàn tác.`,
      confirmLabel: "Xóa",
      danger: true,
      onConfirm: () => {
        const newLog = addAuditLog(`delete_${actionLabel(key)}`, id);
        save({ ...data, [key]: data[key].filter(x => x.id !== id), auditLog: newLog });
      },
    });
  };

  // v38d: Hard delete handler — chỉ admin gọi được, đã pass canHardDelete* check
  // Ghi audit log với SNAPSHOT toàn bộ object trước khi xóa.
  // key: "factories" | "carriers" | "pos" | "shipments"
  const onHardDelete = (key, id) => {
    if (user?.role !== "admin") {
      console.warn("[v38d] Hard delete attempted by non-admin");
      return;
    }
    const entity = (data[key] || []).find(x => x.id === id);
    if (!entity) return;
    // Ghi audit log với snapshot — admin truy cứu được khi cần
    const actionMap = {
      factories: "hard_delete_factory",
      carriers: "hard_delete_carrier",
      pos: "hard_delete_po",
      shipments: "hard_delete_shipment",
    };
    const action = actionMap[key] || `hard_delete_${key}`;
    const newLog = addAuditLog(action, id, { snapshot: entity });
    save({
      ...data,
      [key]: (data[key] || []).filter(x => x.id !== id),
      auditLog: newLog,
    });
  };

  // v38f: Rename ID handler — chỉ admin gọi được, đã pass canRename* check
  // Vì điều kiện rename là entity "sạch" (không có references), KHÔNG cần cascade.
  // Ghi audit log với cả oldId + newId + snapshot để truy cứu.
  // key: "pos" | "shipments"
  const onRenameId = (key, oldId, newId) => {
    if (user?.role !== "admin") {
      console.warn("[v38f] Rename ID attempted by non-admin");
      return;
    }
    const entity = (data[key] || []).find(x => x.id === oldId);
    if (!entity) return;
    if (!newId || newId === oldId) return;
    // Double-check trùng (defensive — tránh race condition)
    if ((data[key] || []).some(x => x.id === newId)) {
      console.error("[v38f] Rename failed: newId already exists", newId);
      return;
    }
    const actionMap = {
      pos: "rename_po",
      shipments: "rename_shipment",
    };
    const action = actionMap[key] || `rename_${key}`;
    const newLog = addAuditLog(action, oldId, { oldId, newId, snapshot: entity });
    save({
      ...data,
      [key]: (data[key] || []).map(x => x.id === oldId ? { ...x, id: newId } : x),
      auditLog: newLog,
    });
  };

  const onSaveSettings = (newSettings) => {
    const newLog = addAuditLog("update_settings", "settings", newSettings);
    save({ ...data, settings: newSettings, auditLog: newLog });
  };

  // v23b: Lưu batch import + sinh movements/openings
  const onImportSave = ({ batch, newMovements, newOpenings }) => {
    const newBatches = [...(data.stockImportBatches || []), batch];
    let newOpeningStock = data.openingStock || [];
    let newStockMovements = data.stockMovements || [];

    if (batch.mode === "opening") {
      // Cancel các opening cũ trùng cặp (productId, warehouseId)
      const cancelIds = new Set(batch.cancelledOpeningIds || []);
      newOpeningStock = newOpeningStock.map(o => cancelIds.has(o.id) ? { ...o, status: "cancelled", cancelReason: `Override bởi batch ${batch.id}`, cancelledAt: new Date().toISOString() } : o);
      newOpeningStock = [...newOpeningStock, ...(newOpenings || [])];
    } else {
      // Mode adjustment: thêm movements
      newStockMovements = [...newStockMovements, ...(newMovements || [])];
    }

    const newLog = addAuditLog(`import_stock_${batch.mode}`, batch.id, {
      warehouseId: batch.warehouseId,
      posSystem: batch.posSystem,
      generatedItems: batch.generatedItems,
      mode: batch.mode,
    });

    save({
      ...data,
      stockImportBatches: newBatches,
      openingStock: newOpeningStock,
      stockMovements: newStockMovements,
      auditLog: newLog,
    });
  };

  // v35: Lưu batch import sản phẩm (tạo mới HOẶC cập nhật) trong 1 transaction.
  // Khác onAdd/onEdit thông thường: chỉ ghi 1 audit log tổng cho cả batch (không log từng SP).
  // Lý do: import 100 SP mà ghi 100 audit log riêng sẽ làm bẩn nhật ký.
  // v36: Thêm mode "upsert" — route từng item theo it.status (do validate đã set "create"/"update" cho từng SP).
  const onImportProducts = ({ mode, validItems, newCategoriesToCreate, fileName }) => {
    let newProducts = [...(data.products || [])];
    let newSettings = data.settings;

    // 1. Auto-create danh mục mới (nếu có)
    if (newCategoriesToCreate.length > 0) {
      const existingCats = newSettings.productCategories || [];
      newSettings = { ...newSettings, productCategories: [...existingCats, ...newCategoriesToCreate] };
    }

    // 2. Tạo mới hoặc cập nhật từng SP
    // v36: Dùng it.status (do validateProductImportBatch trả về) thay vì biến `mode` chung.
    // Mode "upsert" → mỗi item có status riêng "create" hoặc "update".
    let createdCount = 0, updatedCount = 0;
    validItems.forEach(it => {
      const itemMode = it.status || mode; // fallback về mode chung nếu thiếu

      if (itemMode === "create") {
        const newProduct = {
          id: `p${uid()}`,
          sku: it.sku,
          name: it.name,
          nameImport: it.nameImport || "",
          factoryId: it.factoryId || "",
          unitPrice: it.unitPrice !== "" ? Number(it.unitPrice) : 0,
          currency: it.currency || "CNY",
          cost: it.cost !== "" ? Number(it.cost) : (it.unitPrice !== "" ? Number(it.unitPrice) : 0),
          unit: it.unit || "cái",
          category: it.category || "",
          description: it.description || "",
          imageUrl: it.imageUrl || "",
          lengthCm: it.lengthCm !== "" ? Number(it.lengthCm) : "",
          widthCm: it.widthCm !== "" ? Number(it.widthCm) : "",
          heightCm: it.heightCm !== "" ? Number(it.heightCm) : "",
          qtyPerCarton: it.qtyPerCarton !== "" ? Number(it.qtyPerCarton) : "",
          warehouseThresholds: {},
          externalSkus: {},
        };
        newProducts.push(newProduct);
        createdCount++;
      } else if (itemMode === "update" && it.existingProductId) {
        // Update: chỉ ghi đè field user điền. Field rỗng = giữ giá trị cũ.
        const updates = {};
        if (it.name) updates.name = it.name;
        if (it.nameImport) updates.nameImport = it.nameImport;
        if (it.factoryId) updates.factoryId = it.factoryId;
        if (it.unitPrice !== "" && it.unitPrice !== null && it.unitPrice !== undefined) updates.unitPrice = Number(it.unitPrice);
        if (it.currency) updates.currency = it.currency;
        if (it.cost !== "" && it.cost !== null && it.cost !== undefined) updates.cost = Number(it.cost);
        if (it.unit) updates.unit = it.unit;
        if (it.category) updates.category = it.category;
        if (it.description) updates.description = it.description;
        if (it.imageUrl) updates.imageUrl = it.imageUrl;
        if (it.lengthCm !== "" && it.lengthCm !== null && it.lengthCm !== undefined) updates.lengthCm = Number(it.lengthCm);
        if (it.widthCm !== "" && it.widthCm !== null && it.widthCm !== undefined) updates.widthCm = Number(it.widthCm);
        if (it.heightCm !== "" && it.heightCm !== null && it.heightCm !== undefined) updates.heightCm = Number(it.heightCm);
        if (it.qtyPerCarton !== "" && it.qtyPerCarton !== null && it.qtyPerCarton !== undefined) updates.qtyPerCarton = Number(it.qtyPerCarton);
        if (Object.keys(updates).length > 0) {
          newProducts = newProducts.map(p => p.id === it.existingProductId ? { ...p, ...updates } : p);
          updatedCount++;
        }
      }
    });

    // 3. Ghi 1 audit log tổng kết
    const newLog = addAuditLog(`import_products_${mode}`, fileName, {
      mode,
      fileName,
      created: createdCount,
      updated: updatedCount,
      newCategories: newCategoriesToCreate,
    });

    save({
      ...data,
      products: newProducts,
      settings: newSettings,
      auditLog: newLog,
    });
  };


  // v23b: Hủy 1 batch import — đánh dấu batch + tất cả movements/openings thuộc batch là cancelled
  const onCancelImportBatch = (batchId, reason) => {
    const batch = (data.stockImportBatches || []).find(b => b.id === batchId);
    if (!batch) return;
    const newBatches = (data.stockImportBatches || []).map(b => b.id === batchId ? {
      ...b, status: "cancelled", cancelReason: reason,
      cancelledBy: user?.fullName || user?.username,
      cancelledAt: new Date().toISOString(),
    } : b);
    // Cancel openings thuộc batch
    const newOpeningStock = (data.openingStock || []).map(o => o.batchId === batchId ? { ...o, status: "cancelled", cancelReason: `Hủy batch ${batchId}: ${reason}` } : o);
    // Restore opening cũ đã bị override (nếu có)
    const restoredOpeningStock = newOpeningStock.map(o => {
      if ((batch.cancelledOpeningIds || []).includes(o.id)) {
        // Khôi phục opening cũ (gỡ status cancelled)
        const { cancelReason, cancelledAt, ...rest } = o;
        return { ...rest, status: "active" };
      }
      return o;
    });
    // Cancel movements thuộc batch
    const newStockMovements = (data.stockMovements || []).map(m => m.refType === "stock_import_batch" && m.refId === batchId ? { ...m, status: "cancelled", cancelReason: `Hủy batch ${batchId}: ${reason}` } : m);

    const newLog = addAuditLog("cancel_import_batch", batchId, { cancelReason: reason });
    save({
      ...data,
      stockImportBatches: newBatches,
      openingStock: restoredOpeningStock,
      stockMovements: newStockMovements,
      auditLog: newLog,
    });
  };

  // v38j: Upsert StockOnHand record (tồn kho thủ công)
  // Tìm theo (productId, warehouseId) — nếu có → update, không có → insert
  const onUpsertStockOnHand = (form) => {
    const list = data.stockOnHand || [];
    const existing = list.find(s => s.productId === form.productId && s.warehouseId === form.warehouseId);
    let newList;
    let action;
    const payload = {
      ...form,
      quantity: Number(form.quantity || 0),
      updatedAt: new Date().toISOString(),
      updatedBy: user?.fullName || user?.username || "unknown",
    };
    if (existing) {
      newList = list.map(s => s.id === existing.id ? { ...s, ...payload } : s);
      action = "update_stock_on_hand";
    } else {
      newList = [...list, { id: `SOH-${uid()}`, ...payload }];
      action = "create_stock_on_hand";
    }
    const newLog = addAuditLog(action, payload.productId, {
      productId: payload.productId, warehouseId: payload.warehouseId,
      market: payload.market, quantity: payload.quantity, note: payload.note,
    });
    save({ ...data, stockOnHand: newList, auditLog: newLog });
  };

  // v38j: Bulk update StockOnHand (từ import Excel)
  const onBulkUpdateStockOnHand = (records) => {
    const list = data.stockOnHand || [];
    let newList = [...list];
    records.forEach(r => {
      const existing = newList.find(s => s.productId === r.productId && s.warehouseId === r.warehouseId);
      const payload = {
        ...r,
        quantity: Number(r.quantity || 0),
        updatedAt: new Date().toISOString(),
        updatedBy: user?.fullName || user?.username || "unknown",
        source: "import_excel",
      };
      if (existing) {
        newList = newList.map(s => s.id === existing.id ? { ...s, ...payload } : s);
      } else {
        newList.push({ id: `SOH-${uid()}`, ...payload });
      }
    });
    const newLog = addAuditLog("bulk_import_stock_on_hand", "stock_on_hand", { count: records.length });
    save({ ...data, stockOnHand: newList, auditLog: newLog });
  };

  // v38j: Prefill state cho form tạo PO/Shipment khi user bấm ô đề xuất
  const [poPrefill, setPoPrefill] = useState(null);
  const [shipmentPrefill, setShipmentPrefill] = useState(null);
  const onPrefillCreatePO = (prefill) => {
    setPoPrefill(prefill);
    setTab("pos");
  };
  const onPrefillCreateShipment = (prefill) => {
    setShipmentPrefill(prefill);
    setTab("shipments");
  };

  // v38j: Cập nhật warehouseTargets cho 1 SP (dùng cho wizard hàng loạt)
  const onUpdateProductTargets = (productIds, warehouseId, target) => {
    const newProducts = (data.products || []).map(p => {
      if (!productIds.includes(p.id)) return p;
      return {
        ...p,
        warehouseTargets: {
          ...(p.warehouseTargets || {}),
          [warehouseId]: { ...((p.warehouseTargets || {})[warehouseId] || {}), ...target },
        },
      };
    });
    const newLog = addAuditLog("bulk_update_product_targets", "products", { productIds, warehouseId, target });
    save({ ...data, products: newProducts, auditLog: newLog });
  };

  // v11.2: Tạo kho mới trực tiếp cho 1 market (dùng khi user bấm "Tạo ngay kho" trong ShipmentForm)
  // v12: Nếu market chưa có kho nào → kho mới tự động là default
  const onCreateWarehouse = (marketName, newWh) => {
    const updatedMarkets = data.markets.map(m => {
      if (m.name !== marketName) return m;
      const existingWhs = m.warehouses || [];
      const shouldBeDefault = existingWhs.length === 0 || !existingWhs.some(w => w.isDefault);
      const whToAdd = { ...newWh, isDefault: newWh.isDefault ?? shouldBeDefault };
      return { ...m, warehouses: [...existingWhs, whToAdd] };
    });
    const newLog = addAuditLog("create_warehouse", `${marketName}:${newWh.name}`, newWh);
    save({ ...data, markets: updatedMarkets, auditLog: newLog });
  };

  const handleLogin = (loggedUser) => {
    const log = logAudit("login", loggedUser.username, user || loggedUser);
    save({ ...data, auditLog: [...data.auditLog, log] });
    // v38g: Lưu session 24h vào localStorage để F5 không bị logout
    const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 giờ
    const now = Date.now();
    try {
      localStorage.setItem("crm_session_v38g", JSON.stringify({
        userId: loggedUser.id,
        loggedAt: now,
        expiresAt: now + SESSION_DURATION_MS,
      }));
    } catch (e) {
      console.warn("[v38g] Cannot save session", e);
    }
    setUser(loggedUser);
  };

  const handleLogout = () => {
    if (user) {
      const log = logAudit("logout", user.username, user);
      const logoutData = { ...data, auditLog: [...data.auditLog, log] };
      // v43: Flush ngay lập tức lên S3 (không debounce) để tránh mất data khi login lại
      setData(logoutData);
      s3Flush(logoutData);
    }
    // v38g: Xóa session khỏi localStorage
    try {
      localStorage.removeItem("crm_session_v38g");
    } catch (e) {
      console.warn("[v38g] Cannot remove session", e);
    }
    setUser(null);
  };

  // v38g: Helper rolling session — gọi mỗi khi user có action.
  // Mỗi lần gọi, gia hạn session 24h từ thời điểm hiện tại.
  // Nếu user dùng app liên tục → không bao giờ bị timeout.
  const renewSession = useCallback(() => {
    if (!user) return;
    const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    try {
      const sessionStr = localStorage.getItem("crm_session_v38g");
      if (!sessionStr) return;
      const session = JSON.parse(sessionStr);
      // Cập nhật expiresAt
      session.expiresAt = now + SESSION_DURATION_MS;
      localStorage.setItem("crm_session_v38g", JSON.stringify(session));
    } catch (e) {
      // Silent fail
    }
  }, [user]);

  // v38g: Đổi mật khẩu cá nhân
  // Update password trong data.users + audit log (KHÔNG ghi password) + auto-logout
  const onChangeOwnPassword = (newPassword) => {
    if (!user) return;
    // Ghi audit log — ý quan trọng: KHÔNG ghi password vào detail (bảo mật)
    const log = logAudit("change_own_password", user.username, user, {
      changedBy: user.username,
      // Cố ý KHÔNG ghi password mới hoặc cũ
    });
    const updatedUsers = data.users.map(u =>
      u.id === user.id ? { ...u, password: newPassword } : u
    );
    save({ ...data, users: updatedUsers, auditLog: [...data.auditLog, log] });
    setShowChangePass(false);
    // Auto-logout sau 2 giây để user login lại với mật khẩu mới
    setTimeout(() => {
      handleLogout();
    }, 2000);
    // Hiển thị thông báo (dùng confirmDialog as info)
    setConfirmDialog({
      title: "✅ Đã đổi mật khẩu",
      message: "Mật khẩu của bạn đã được cập nhật. Hệ thống sẽ tự đăng xuất sau 2 giây để bạn đăng nhập lại bằng mật khẩu mới.",
      confirmLabel: "OK",
      cancelLabel: null,
      onConfirm: () => {},
    });
  };

  if (!loaded) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, color: C.textMuted }}>Đang tải...</div>;
  if (!user) return <><style>{css}</style><LoginScreen onLogin={handleLogin} users={data.users} /></>;

  const currentTab = TABS.find(t => t.id === tab);
  const availableTabs = TABS.filter(t => !t.perm || can(user, t.perm));

  return (
    <>
      <style>{css}</style>
      <div style={{ display: "flex", minHeight: "100vh", background: C.bg }}>
        {/* Sidebar */}
        <div style={{ width: 240, background: C.sidebar, display: "flex", flexDirection: "column", flexShrink: 0, position: "sticky", top: 0, height: "100vh" }}>
          <div style={{ padding: "24px 22px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: `linear-gradient(135deg, ${C.green400} 0%, ${C.green600} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 22, fontWeight: 800 }}>G</div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: "white" }}>GoChek</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", letterSpacing: "0.1em", marginTop: 2 }}>FACTORY CRM</div>
              </div>
            </div>
          </div>
          <nav style={{ flex: 1, padding: "16px 12px", overflowY: "auto" }}>
            {availableTabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
                padding: "11px 14px", marginBottom: 4,
                background: tab === t.id ? C.green500 : "transparent",
                border: "none", borderRadius: 10,
                color: tab === t.id ? "white" : "rgba(255,255,255,0.7)",
                cursor: "pointer", fontSize: 13, fontWeight: tab === t.id ? 700 : 500,
                transition: "all 0.15s",
              }} onMouseEnter={e => { if (tab !== t.id) e.currentTarget.style.background = C.sidebarHover; }}
                onMouseLeave={e => { if (tab !== t.id) e.currentTarget.style.background = "transparent"; }}>
                <span style={{ fontSize: 16 }}>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
          <div style={{ padding: "16px 22px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: `linear-gradient(135deg, ${C.green400} 0%, ${C.green600} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 700 }}>
                {(user.fullName || user.username || "U").charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "white", fontWeight: 600 }}>{user.fullName}</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>{ROLE_LABELS[user.role]}</div>
              </div>
            </div>
            {/* v38g: Nút đổi mật khẩu cá nhân */}
            <button
              className="btn"
              style={{ width: "100%", justifyContent: "center", fontSize: 12, background: "transparent", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)", marginBottom: 8 }}
              onClick={() => setShowChangePass(true)}
            >🔑 Đổi mật khẩu</button>
            <button className="btn" style={{ width: "100%", justifyContent: "center", fontSize: 12, background: "transparent", color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.15)" }} onClick={handleLogout}>Đăng xuất</button>
          </div>
        </div>

        {/* Main */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "16px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 10 }}>
            <div style={{ fontSize: 13, color: C.textMuted }}>
              <span>🏠</span>
              <span style={{ margin: "0 8px", color: C.textLight }}>/</span>
              <span style={{ color: C.green800, fontWeight: 700 }}>{currentTab?.label}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ fontSize: 12, color: C.textMuted }}>
                💱 1 CNY = <b>{data.settings.cnyToVnd.toLocaleString("vi-VN")}</b> VND
              </div>
              <div style={{ fontSize: 12, color: C.textMuted }}>
                {new Date().toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              </div>
            </div>
          </div>

          <div style={{ padding: 28, flex: 1 }}>
            {tab === "dashboard" && <Dashboard pos={data.pos} shipments={data.shipments} payments={data.payments} factories={data.factories} products={data.products} openingBalances={data.openingBalances} markets={data.markets} carriers={data.carriers} feePayments={data.feePayments} stockOnHand={data.stockOnHand} settings={data.settings} onNavigate={setTab} />}
            {tab === "products" && <Products products={data.products} pos={data.pos} shipments={data.shipments} factories={data.factories} markets={data.markets} settings={data.settings} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} onSaveSettings={onSaveSettings} onImportProducts={onImportProducts} onUpdateProductTargets={onUpdateProductTargets} user={user} />}
            {tab === "pos" && <POs pos={data.pos} factories={data.factories} products={data.products} shipments={data.shipments} markets={data.markets} settings={data.settings} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} onHardDelete={onHardDelete} onRenameId={onRenameId} data={data} onConfirm={setConfirmDialog} prefill={poPrefill} onClearPrefill={() => setPoPrefill(null)} user={user} />}
            {tab === "shipments" && <Shipments shipments={data.shipments} pos={data.pos} factories={data.factories} products={data.products} feePayments={data.feePayments} markets={data.markets} carriers={data.carriers} settings={data.settings} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} onHardDelete={onHardDelete} onRenameId={onRenameId} data={data} onCreateWarehouse={onCreateWarehouse} prefill={shipmentPrefill} onClearPrefill={() => setShipmentPrefill(null)} user={user} />}
            {tab === "warranties" && <Warranties warranties={data.warranties || []} factories={data.factories} markets={data.markets} products={data.products} settings={data.settings} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} user={user} />}
            {tab === "inventory" && <Inventory
              products={data.products}
              openingStock={data.openingStock || []}
              stockMovements={data.stockMovements || []}
              stockImportBatches={data.stockImportBatches || []}
              stockOnHand={data.stockOnHand || []}
              pos={data.pos || []}
              shipments={data.shipments || []}
              markets={data.markets}
              settings={data.settings}
              onImportSave={onImportSave}
              onCancelBatch={onCancelImportBatch}
              onUpsertStockOnHand={onUpsertStockOnHand}
              onBulkUpdateStockOnHand={onBulkUpdateStockOnHand}
              onPrefillCreatePO={onPrefillCreatePO}
              onPrefillCreateShipment={onPrefillCreateShipment}
              onUpdateProductTargets={onUpdateProductTargets}
              user={user}
            />}
            {tab === "fees" && <ImportFees shipments={data.shipments} feePayments={data.feePayments} markets={data.markets} carriers={data.carriers} settings={data.settings} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} user={user} />}
            {tab === "debts" && <Debts pos={data.pos} shipments={data.shipments} payments={data.payments} factories={data.factories} openingBalances={data.openingBalances} settings={data.settings} feePayments={data.feePayments} products={data.products} carriers={data.carriers} markets={data.markets} user={user} />}
            {tab === "market_debts" && <MarketDebts pos={data.pos} shipments={data.shipments} payments={data.payments} factories={data.factories} markets={data.markets} settings={data.settings} products={data.products} warranties={data.warranties} openingBalances={data.openingBalances} user={user} />}
            {tab === "opening_balance" && <OpeningBalances openingBalances={data.openingBalances} factories={data.factories} markets={data.markets} settings={data.settings} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} user={user} />}
            {tab === "payments" && <Payments pos={data.pos} shipments={data.shipments} payments={data.payments} factories={data.factories} openingBalances={data.openingBalances} markets={data.markets} settings={data.settings} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} user={user} />}
            {tab === "audit" && <AuditLog auditLog={data.auditLog} />}
            {tab === "configuration" && <Configuration data={data} user={user} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} onHardDelete={onHardDelete} onSaveSettings={onSaveSettings} onCreateWarehouse={onCreateWarehouse} />}
            {tab === "help" && <Help user={user} />}
          </div>
        </div>
      </div>
      {confirmDialog && <ConfirmDialog {...confirmDialog} onClose={() => setConfirmDialog(null)} />}
      {/* v38g: Modal đổi mật khẩu cá nhân */}
      {showChangePass && (
        <ChangeOwnPasswordModal
          user={user}
          onConfirm={onChangeOwnPassword}
          onClose={() => setShowChangePass(false)}
        />
      )}
    </>
  );
}
