import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, RadialBarChart, RadialBar } from "recharts";
import { loadAll, saveAll, addItem, editItem, softDeleteItem, saveSettings, saveMarkets, alive, s3Flush } from "./s3Storage.js";

// ============================================================
// CONSTANTS
// ============================================================
const MARKETS_DEFAULT = ["Vietnam", "Thailand", "Malaysia", "Philippines"];
const getMarketNames = (markets) => (markets && markets.length > 0) ? markets.map(m => m.name) : MARKETS_DEFAULT;
const PO_STATUSES = ["Chờ xác nhận", "Đang sản xuất", "SX một phần", "Hoàn thành SX", "Hủy"];
const SHIPMENT_STATUSES = ["Chờ xuất", "Đang vận chuyển TQ", "Đang thông quan", "Kiểm hoá", "Đã thông quan", "Đã về kho", "Hủy"];
// Forward-only order (không cho quay ngược, trừ Hủy ở "Chờ xuất")
const SHIPMENT_STATUS_ORDER = ["Chờ xuất", "Đang vận chuyển TQ", "Đang thông quan", "Kiểm hoá", "Đã thông quan", "Đã về kho"];
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

const FEE_TYPES = ["Thuế nhập khẩu", "VAT nhập khẩu", "Phí hải quan", "Phí vận chuyển quốc tế", "Phí kho bãi", "Phí khác"];

// Permissions system
const PERMISSIONS = {
  view_dashboard: { label: "Xem Dashboard", group: "Xem" },
  view_reports: { label: "Xem báo cáo", group: "Xem" },
  view_sensitive: { label: "Xem giá vốn / CNY", group: "Xem" },
  create_po: { label: "Tạo đơn đặt hàng", group: "PO" },
  edit_po: { label: "Sửa PO", group: "PO" },
  delete_po: { label: "Xóa PO", group: "PO" },
  create_shipment: { label: "Tạo lô giao hàng", group: "Giao hàng" },
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
const SEED_USERS = [
  { id: "u1", username: "admin", password: "gochek2026", fullName: "Vũ Văn Huy", email: "huy@gochek.vn", role: "admin", status: "active", createdAt: "2026-01-01" },
  { id: "u2", username: "ketoan", password: "ketoan2026", fullName: "Nguyễn Thị Kế Toán", email: "ketoan@gochek.vn", role: "accountant", status: "active", createdAt: "2026-01-15" },
];

const SEED_FACTORIES = [
  { id: "f1", supplierCode: "NCC-001", name: "Shenzhen Audio Co.", nameCn: "深圳声学", country: "Trung Quốc", contactPerson: "Mr. Chen", phone: "+86 135 0000 0001", email: "chen@szaudio.com", address: "Bao'an District, Shenzhen, Guangdong, China", paymentDays: 30, productionDays: 20, bankInfo: "Bank of China - 6228********1234 - Chen Wei - SZ Branch", status: "active", currency: "CNY", note: "NM chính line S24" },
  { id: "f2", supplierCode: "NCC-002", name: "Guangzhou MicTech Ltd.", nameCn: "广州麦克风科技", country: "Trung Quốc", contactPerson: "Ms. Li", phone: "+86 139 0000 0002", email: "li@gzmictech.com", address: "Tianhe District, Guangzhou, Guangdong, China", paymentDays: 45, productionDays: 25, bankInfo: "ICBC - 6222********5678 - Li Mei - GZ Branch", status: "active", currency: "CNY", note: "" },
  { id: "f3", supplierCode: "NCC-003", name: "Dongguan Sound Factory", nameCn: "东莞声音工厂", country: "Trung Quốc", contactPerson: "Mr. Wang", phone: "+86 137 0000 0003", email: "wang@dgsound.com", address: "Houjie Town, Dongguan, Guangdong, China", paymentDays: 30, productionDays: 18, bankInfo: "CCB - 6217********9012 - Wang Lei - DG Branch", status: "active", currency: "CNY", note: "" },
  { id: "f4", supplierCode: "NCC-004", name: "Foshan Electronics Co.", nameCn: "佛山电子", country: "Trung Quốc", contactPerson: "Ms. Zhang", phone: "+86 136 0000 0004", email: "zhang@fselectronics.com", address: "Nanhai District, Foshan, Guangdong, China", paymentDays: 30, productionDays: 15, bankInfo: "ABC - 6228********3456 - Zhang Hui - FS Branch", status: "active", currency: "CNY", note: "Phụ kiện" },
  { id: "f5", supplierCode: "NCC-005", name: "Zhuhai WireTech", nameCn: "珠海线技", country: "Trung Quốc", contactPerson: "Mr. Liu", phone: "+86 138 0000 0005", email: "liu@zhwiretech.com", address: "Xiangzhou District, Zhuhai, Guangdong, China", paymentDays: 60, productionDays: 30, bankInfo: "Bank of China - 6228********7890 - Liu Yang - ZH Branch", status: "paused", currency: "CNY", note: "Tạm ngừng" },
  { id: "f6", supplierCode: "NCC-006", name: "Shenzhen ProAudio", nameCn: "深圳专业音频", country: "Trung Quốc", contactPerson: "Ms. Wu", phone: "+86 135 0000 0006", email: "wu@szproaudio.com", address: "Longgang District, Shenzhen, Guangdong, China", paymentDays: 30, productionDays: 22, bankInfo: "ICBC - 6222********2345 - Wu Fang - SZ Branch", status: "active", currency: "CNY", note: "" },
];

// Products (SKU) - v10: + imageUrl, nameImport, category. v11: + kích thước (dài/rộng/cao cm) + SL/thùng
const SEED_PRODUCTS = [
  { id: "p1", sku: "S24-01", name: "Ultra S24 Wireless Mic (Pro)", nameImport: "Wireless Microphone Pro Model S24-01", category: "Micro", imageUrl: "", factoryId: "f1", unitPrice: 62, currency: "CNY", cost: 62, unit: "cái", description: "Mic không dây 2.4GHz chống ồn 90%", lengthCm: 15, widthCm: 10, heightCm: 5, qtyPerCarton: 50 },
  { id: "p2", sku: "S24-02", name: "Ultra S24 Wireless Mic (Lite)", nameImport: "Wireless Microphone Lite Model S24-02", category: "Micro", imageUrl: "", factoryId: "f1", unitPrice: 48, currency: "CNY", cost: 48, unit: "cái", description: "Mic không dây bản tiêu chuẩn", lengthCm: 14, widthCm: 9, heightCm: 5, qtyPerCarton: 60 },
  { id: "p3", sku: "SS100", name: "SS100 Microphone Stand", nameImport: "Aluminium Microphone Stand SS100", category: "Phụ kiện", imageUrl: "", factoryId: "f2", unitPrice: 22, currency: "CNY", cost: 22, unit: "cái", description: "Chân đế mic nhôm", lengthCm: 40, widthCm: 8, heightCm: 8, qtyPerCarton: 20 },
  { id: "p4", sku: "G1", name: "GoChek G1 Earphone", nameImport: "TWS Earphone G1 Bluetooth 5.2", category: "Tai nghe", imageUrl: "", factoryId: "f3", unitPrice: 58, currency: "CNY", cost: 58, unit: "cái", description: "Tai nghe TWS", lengthCm: 8, widthCm: 6, heightCm: 3, qtyPerCarton: 80 },
  { id: "p5", sku: "LKS2403", name: "Accessory Pack 2403", nameImport: "Cable & Adapter Accessory Pack 2403", category: "Phụ kiện", imageUrl: "", factoryId: "f4", unitPrice: 12, currency: "CNY", cost: 12, unit: "bộ", description: "Phụ kiện đi kèm", lengthCm: 20, widthCm: 15, heightCm: 4, qtyPerCarton: 100 },
  { id: "p6", sku: "S25-01", name: "Ultra S25 Wireless Mic", nameImport: "Wireless Microphone New Model S25-01", category: "Micro", imageUrl: "", factoryId: "f1", unitPrice: 85, currency: "CNY", cost: 85, unit: "cái", description: "Model mới 2025", lengthCm: 16, widthCm: 11, heightCm: 5, qtyPerCarton: 40 },
];

// v11: Đơn vị vận chuyển (Carrier)
const SEED_CARRIERS = [
  { id: "car_dhl", code: "DHL", name: "DHL Express", type: "Chuyển phát nhanh", contactPerson: "Mr. Nguyễn", phone: "+84 28 3888 0202", email: "sales@dhl.vn", address: "Tầng 6, Saigon Centre, Q.1, TP.HCM", paymentDays: 15, bankInfo: "Vietcombank - 0071001234567 - DHL Express Vietnam", status: "active", note: "Hãng chuyển phát nhanh quốc tế" },
  { id: "car_fedex", code: "FEDEX", name: "FedEx Vietnam", type: "Chuyển phát nhanh", contactPerson: "Ms. Trần", phone: "+84 24 3933 8222", email: "hanoi@fedex.com", address: "Tầng 4, Pacific Place, Hà Nội", paymentDays: 30, bankInfo: "HSBC - 001234567890 - FedEx Vietnam", status: "active", note: "" },
  { id: "car_seafr", code: "SEA-FR", name: "Sea Freight Co.", type: "Đường biển", contactPerson: "Mr. Lee", phone: "+86 755 2288 7777", email: "info@seafreight.cn", address: "Shenzhen, China", paymentDays: 45, bankInfo: "Bank of China - 623000012345 - Sea Freight", status: "active", note: "Vận chuyển container đường biển" },
];

const SEED_POS = [
  { id: "PO-2026-001", factoryId: "f1", currency: "CNY", orderDate: "2026-01-10", expectedDate: "2026-02-28", status: "Hoàn thành SX", approved: true, approvedBy: "Vũ Văn Huy", approvedAt: "2026-01-11", note: "Lô Tết",
    items: [
      { id: "it1", productId: "p1", quantity: 2000, unitPrice: 62, produced: 2000 },
    ] },
  { id: "PO-2026-002", factoryId: "f1", currency: "CNY", orderDate: "2026-01-15", expectedDate: "2026-03-10", status: "SX một phần", approved: true, approvedBy: "Vũ Văn Huy", approvedAt: "2026-01-16", note: "Combo đa SP",
    items: [
      { id: "it2", productId: "p1", quantity: 1500, unitPrice: 62, produced: 800 },
      { id: "it3", productId: "p2", quantity: 500, unitPrice: 48, produced: 300 },
    ] },
  { id: "PO-2026-003", factoryId: "f2", currency: "CNY", orderDate: "2026-02-01", expectedDate: "2026-03-20", status: "Đang sản xuất", approved: true, approvedBy: "Vũ Văn Huy", approvedAt: "2026-02-02", note: "",
    items: [
      { id: "it4", productId: "p3", quantity: 3000, unitPrice: 22, produced: 0 },
    ] },
  { id: "PO-2026-004", factoryId: "f3", currency: "CNY", orderDate: "2026-02-10", expectedDate: "2026-04-01", status: "Hoàn thành SX", approved: true, approvedBy: "Vũ Văn Huy", approvedAt: "2026-02-11", note: "",
    items: [
      { id: "it5", productId: "p4", quantity: 1200, unitPrice: 58, produced: 1200 },
    ] },
  { id: "PO-2026-005", factoryId: "f4", currency: "CNY", orderDate: "2026-03-01", expectedDate: "2026-04-15", status: "Chờ xác nhận", approved: false, note: "Chờ duyệt",
    items: [
      { id: "it6", productId: "p5", quantity: 5000, unitPrice: 12, produced: 0 },
    ] },
];

const SEED_SHIPMENTS = [
  { id: "SH-2026-001", market: "Vietnam", warehouseId: "wh_vn_vh", departDate: "2026-02-20", arriveDate: "2026-02-26", actualArriveDate: "2026-02-26", carrier: "DHL Express", carrierId: "car_dhl", trackingNo: "DHL1234567890", status: "Đã về kho", packages: 50, note: "",
    items: [{ poId: "PO-2026-001", itemId: "it1", quantity: 1500, receivedQty: 1500, diffHandling: "" }],
    fees: [
      { id: "fee001", type: "Thuế nhập khẩu", amount: 30000000, currency: "VND", payee: "Hải quan VN", carrierId: "", note: "10% giá trị" },
      { id: "fee002", type: "VAT nhập khẩu", amount: 33000000, currency: "VND", payee: "Hải quan VN", carrierId: "", note: "" },
      { id: "fee003", type: "Phí vận chuyển quốc tế", amount: 20000000, currency: "VND", payee: "DHL Express", carrierId: "car_dhl", note: "DHL" },
    ]
  },
  { id: "SH-2026-002", market: "Thailand", warehouseId: "wh_th_redbox", departDate: "2026-03-01", arriveDate: "2026-03-08", carrier: "FedEx", carrierId: "car_fedex", trackingNo: "FEX0987654321", status: "Đang vận chuyển TQ", packages: 30, note: "",
    items: [{ poId: "PO-2026-001", itemId: "it1", quantity: 500 }, { poId: "PO-2026-002", itemId: "it2", quantity: 500 }, { poId: "PO-2026-002", itemId: "it3", quantity: 200 }],
    fees: [
      { id: "fee004", type: "Thuế nhập khẩu", amount: 21000, currency: "THB", payee: "Thai Customs", carrierId: "", note: "" },
      { id: "fee005", type: "Phí hải quan", amount: 5000, currency: "THB", payee: "Thai Customs", carrierId: "", note: "" },
    ]
  },
  { id: "SH-2026-003", market: "Malaysia", warehouseId: "wh_my_main", departDate: "2026-04-02", arriveDate: "2026-04-10", carrier: "Sea Freight", carrierId: "car_seafr", trackingNo: "SF1122334455", status: "Đang thông quan", packages: 40, note: "",
    items: [{ poId: "PO-2026-004", itemId: "it5", quantity: 1200 }],
    fees: [
      { id: "fee006", type: "Phí hải quan", amount: 600, currency: "MYR", payee: "MY Customs", carrierId: "", note: "" },
    ]
  },
];

const SEED_PAYMENTS = [
  { id: "PAY-001", type: "MARKET_TO_FACTORY", fromMarket: "Vietnam", toFactoryId: "f1", amount: 124000, currency: "CNY", payDate: "2026-03-05", note: "Trả công nợ PO-001" },
  { id: "PAY-002", type: "MARKET_TO_FACTORY", fromMarket: "Thailand", toFactoryId: "f1", amount: 110000, currency: "CNY", payDate: "2026-03-10", note: "Thái chuyển dư về F1" },
  { id: "PAY-003", type: "INTER_FACTORY", fromFactoryId: "f1", toFactoryId: "f3", amount: 36000, currency: "CNY", payDate: "2026-03-20", note: "Nhờ F1 trả hộ F3" },
];

const SEED_FEE_PAYMENTS = [
  { id: "FPAY-001", shipmentId: "SH-2026-001", feeId: "fee001", amount: 30000000, currency: "VND", payDate: "2026-02-25", payer: "Kế toán công ty", note: "Thanh toán thuế nhập khẩu đợt 1" },
  { id: "FPAY-002", shipmentId: "SH-2026-001", feeId: "fee003", amount: 20000000, currency: "VND", payDate: "2026-02-26", payer: "Kế toán công ty", note: "Thanh toán phí DHL" },
];

const SEED_AUDIT_LOG = [];

const SEED_OPENING_BALANCES = [
  { id: "OB-001", factoryId: "f1", type: "debt", amount: 45000, currency: "CNY", date: "2025-12-31", note: "Nợ chuyển từ Q4/2025" },
  { id: "OB-002", factoryId: "f2", type: "credit", amount: 8000, currency: "CNY", date: "2025-12-31", note: "Quỹ TD còn lại năm 2025" },
];

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
};

// ============================================================
// STORAGE & UTILS
// ============================================================
// v12-s3: Storage layer đã chuyển sang s3Storage.js
// File này chỉ giữ UI + business logic

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
const uid = () => Math.random().toString(36).slice(2, 9).toUpperCase();

// Convert any currency to VND using settings
const toVND = (amount, currency, settings) => {
  if (!amount) return 0;
  const rates = { VND: 1, CNY: settings.cnyToVnd, THB: settings.thbToVnd, MYR: settings.myrToVnd, PHP: settings.phpToVnd, USD: settings.usdToVnd };
  return amount * (rates[currency] || 1);
};

// Get total shipped qty for a specific item in a PO
const shippedFromItem = (poId, itemId, shipments) =>
  shipments.flatMap(s => s.items || []).filter(i => i.poId === poId && i.itemId === itemId).reduce((sum, i) => sum + Number(i.quantity || 0), 0);

// Total qty shipped from entire PO (all items)
const shippedFromPO = (poId, shipments) =>
  shipments.flatMap(s => s.items || []).filter(i => i.poId === poId).reduce((sum, i) => sum + Number(i.quantity || 0), 0);

// Helper: get PO line items (handles both new and legacy structure)
const getPOItems = (po) => {
  if (po.items && Array.isArray(po.items)) return po.items;
  // Legacy single-item PO
  if (po.productId) return [{ id: "legacy", productId: po.productId, quantity: po.quantity, unitPrice: po.unitPrice, produced: po.produced || 0 }];
  return [];
};

// Total PO value (all items sum)
const poTotalValue = (po) => getPOItems(po).reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0);
const poTotalQuantity = (po) => getPOItems(po).reduce((s, it) => s + Number(it.quantity || 0), 0);
const poTotalProduced = (po) => getPOItems(po).reduce((s, it) => s + Number(it.produced || 0), 0);

const calcFactoryBalance = (factoryId, pos, shipments, payments, openingBalances = []) => {
  const factoryPOs = pos.filter(p => p.factoryId === factoryId);
  const actualDebt = factoryPOs.reduce((sum, po) => {
    const items = getPOItems(po);
    return sum + items.reduce((s, it) => {
      const shipped = po.items ? shippedFromItem(po.id, it.id, shipments) : shippedFromPO(po.id, shipments);
      return s + shipped * Number(it.unitPrice || 0);
    }, 0);
  }, 0);
  const inbound = payments.filter(p =>
    (p.type === "MARKET_TO_FACTORY" && p.toFactoryId === factoryId) ||
    (p.type === "INTER_FACTORY" && p.toFactoryId === factoryId)
  ).reduce((s, p) => s + Number(p.amount), 0);
  const outbound = payments.filter(p =>
    p.type === "INTER_FACTORY" && p.fromFactoryId === factoryId
  ).reduce((s, p) => s + Number(p.amount), 0);
  const netPaid = inbound - outbound;

  const openingDebt = openingBalances.filter(o => o.factoryId === factoryId && o.type === "debt").reduce((s, o) => s + Number(o.amount), 0);
  const openingCredit = openingBalances.filter(o => o.factoryId === factoryId && o.type === "credit").reduce((s, o) => s + Number(o.amount), 0);

  const totalDebt = openingDebt + actualDebt;
  const totalAvailable = openingCredit + netPaid;
  const remain = totalDebt - totalAvailable;
  const creditFund = remain < 0 ? -remain : 0;
  const stillOwed = remain > 0 ? remain : 0;
  const expectedDebt = factoryPOs.reduce((sum, po) => {
    const items = getPOItems(po);
    return sum + items.reduce((s, it) => {
      const shipped = po.items ? shippedFromItem(po.id, it.id, shipments) : shippedFromPO(po.id, shipments);
      return s + (Number(it.quantity) - shipped) * Number(it.unitPrice || 0);
    }, 0);
  }, 0);
  return { actualDebt, inbound, outbound, netPaid, stillOwed, creditFund, expectedDebt, openingDebt, openingCredit };
};

// Market debt: Market nhận hàng → nợ giá trị hàng (CNY). Trừ các khoản market đã thanh toán cho NM qua Thanh toán NM (MARKET_TO_FACTORY).
const calcMarketBalance = (market, pos, shipments, payments, settings) => {
  // Total received in CNY (goods value)
  let totalReceivedCNY = 0;
  shipments.filter(s => s.market === market).forEach(s => {
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
  const totalPaidCNY = payments.filter(p => p.type === "MARKET_TO_FACTORY" && p.fromMarket === market)
    .reduce((s, p) => {
      const vnd = toVND(Number(p.amount), p.currency, settings);
      return s + vnd / settings.cnyToVnd;
    }, 0);

  const remain = totalReceivedCNY - totalPaidCNY;
  const stillOwed = remain > 0 ? remain : 0;
  const creditFund = remain < 0 ? -remain : 0;
  return { totalReceived: totalReceivedCNY, totalPaid: totalPaidCNY, stillOwed, creditFund };
};

// Fee balance: A fee can be paid in multiple installments
const calcFeeBalance = (shipmentId, feeId, feePayments, settings) => {
  const pays = feePayments.filter(p => p.shipmentId === shipmentId && p.feeId === feeId);
  const totalPaid = pays.reduce((s, p) => s + toVND(Number(p.amount), p.currency, settings), 0);
  return { totalPaid, count: pays.length };
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
  if (newStatus === "Hủy") return currentStatus === "Chờ xuất";
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
    if (s.status === "Hủy") return false;
    return (s.items || []).some(it => factoryPOs.some(p => p.id === it.poId)) && inRange(s.departDate);
  });
  const factoryPayments = payments.filter(p => {
    if (p.toFactoryId !== factory.id && p.fromFactoryId !== factory.id) return false;
    return inRange(p.payDate);
  });
  const factoryOpenings = openingBalances.filter(o => o.factoryId === factory.id);

  // === Tính số tổng hợp ===
  const openingDebt = factoryOpenings.filter(o => o.type === "debt").reduce((s, o) => s + Number(o.amount || 0), 0);
  const openingCredit = factoryOpenings.filter(o => o.type === "credit").reduce((s, o) => s + Number(o.amount || 0), 0);

  // Hàng đã NHẬN (về kho) trong kỳ — dùng receivedQty nếu có, else quantity khi status = Đã về kho
  let periodReceivedValue = 0;
  let periodShippedNotReceivedValue = 0; // Hàng đã giao nhưng chưa về kho
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
      periodReceivedValue += receivedQty * unitPrice;
      periodShippedNotReceivedValue += (shippedQty - receivedQty) * unitPrice;
    });
  });

  // Thanh toán trong kỳ — chia nhỏ theo loại
  const marketToFactoryIn = factoryPayments
    .filter(p => p.type === "MARKET_TO_FACTORY" && p.toFactoryId === factory.id)
    .reduce((s, p) => s + Number(p.amount || 0), 0);
  const interFactoryIn = factoryPayments
    .filter(p => p.type === "INTER_FACTORY" && p.toFactoryId === factory.id)
    .reduce((s, p) => s + Number(p.amount || 0), 0);
  const interFactoryOut = factoryPayments
    .filter(p => p.type === "INTER_FACTORY" && p.fromFactoryId === factory.id)
    .reduce((s, p) => s + Number(p.amount || 0), 0);
  const netPaid = marketToFactoryIn + interFactoryIn - interFactoryOut;

  const closingOwed = Math.max(0, openingDebt + periodReceivedValue - openingCredit - netPaid);
  const closingCredit = Math.max(0, openingCredit + netPaid - openingDebt - periodReceivedValue);

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
  pushMoneyRow("(3) Phát sinh trong kỳ — Hàng đã NHẬN về kho", periodReceivedValue, "Chỉ tính hàng đã về kho");
  pushMoneyRow("(4) Tham chiếu — Hàng đã giao, chưa về kho", periodShippedNotReceivedValue, "Chưa tính vào công nợ, chỉ tham chiếu");
  pushMoneyRow("(5) Thanh toán: Thị trường → NCC (vào)", marketToFactoryIn, "Tiền công ty/thị trường đã trả");
  pushMoneyRow("(6) Thanh toán: Liên NM — vào (NCC khác trả hộ)", interFactoryIn, "Chuyển nợ từ NCC khác sang");
  pushMoneyRow("(7) Thanh toán: Liên NM — ra (NCC này trả hộ)", interFactoryOut, "NCC này trả hộ NCC khác");
  pushMoneyRow("(8) Thanh toán ròng = (5)+(6)−(7)", netPaid, "");
  s1Rows.push([]);
  pushMoneyRow("NỢ CUỐI KỲ", closingOwed, "(1) + (3) − (2) − (8), tối thiểu 0", true);
  pushMoneyRow("QUỸ TÍN DỤNG CUỐI KỲ", closingCredit, "Nếu đã trả dư", true);

  const sheet1 = xmlWorksheet("Tổng hợp đối soát", s1Rows, [220, 140, 140, 260]);

  // === SHEET 2: CHI TIẾT PO ===
  const s2Rows = [];
  s2Rows.push([{ value: `CHI TIẾT ĐƠN ĐẶT HÀNG — ${factory.name}`, style: "sTitle", mergeAcross: 15 }]);
  s2Rows.push([]);
  const s2Headers = ["Mã PO", "Ngày đặt", "Hạn HT", "Trạng thái", "Duyệt", "SKU", "Tên sản phẩm", "ĐVT", "SL đặt", "Đã SX", "Đã ship", "Đã về kho", "Đơn giá", "Thành tiền", "Tiền tệ", "Ghi chú"];
  s2Rows.push(s2Headers.map(h => ({ value: h, style: "sHeader" })));

  let s2TotalValue = 0;
  factoryPOs.forEach(p => {
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
        { value: Number(it.produced || 0), style: "sCellNum" },
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
    s2Rows.push([{ value: "(Không có PO nào trong kỳ)", style: "sSubtitle", mergeAcross: 15 }]);
  } else {
    s2Rows.push([
      { value: "TỔNG CỘNG", style: "sTotalLabel", mergeAcross: 12 },
      { value: "", style: "sTotal" },
      { value: Math.round(s2TotalValue), style: "sTotal" },
      { value: currency, style: "sTotalLabel" },
      { value: "", style: "sTotalLabel" },
    ]);
  }
  const sheet2 = xmlWorksheet("Chi tiết PO", s2Rows, [110, 75, 75, 95, 65, 80, 180, 55, 60, 60, 60, 70, 70, 90, 55, 140]);

  // === SHEET 3: CHI TIẾT LÔ GIAO HÀNG ===
  const s3Rows = [];
  s3Rows.push([{ value: `CHI TIẾT LÔ GIAO HÀNG — ${factory.name}`, style: "sTitle", mergeAcross: 17 }]);
  s3Rows.push([]);
  const s3Headers = ["Mã lô", "Thị trường", "Kho nhận", "Đơn vị VC", "Tracking", "Ngày xuất", "Ngày nhận TT", "Trạng thái", "Số kiện", "Mã PO", "SKU", "SL giao", "SL nhận", "Chênh", "Xử lý chênh", "Đơn giá", "Thành tiền", "Tiền tệ"];
  s3Rows.push(s3Headers.map(h => ({ value: h, style: "sHeader" })));

  let s3TotalValue = 0;
  factoryShipments.forEach(s => {
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
    s3Rows.push([{ value: "(Không có lô giao hàng nào trong kỳ)", style: "sSubtitle", mergeAcross: 17 }]);
  } else {
    s3Rows.push([
      { value: "TỔNG CỘNG", style: "sTotalLabel", mergeAcross: 15 },
      { value: "", style: "sTotal" },
      { value: Math.round(s3TotalValue), style: "sTotal" },
      { value: currency, style: "sTotalLabel" },
    ]);
  }
  const sheet3 = xmlWorksheet("Chi tiết lô giao hàng", s3Rows, [110, 85, 140, 110, 110, 75, 75, 100, 60, 110, 80, 60, 60, 55, 95, 70, 90, 55]);

  // === SHEET 4: LỊCH SỬ THANH TOÁN ===
  const s4Rows = [];
  s4Rows.push([{ value: `LỊCH SỬ THANH TOÁN — ${factory.name}`, style: "sTitle", mergeAcross: 10 }]);
  s4Rows.push([]);
  const s4Headers = ["Mã TT", "Ngày", "Loại giao dịch", "Đối tác", "Số tiền", "Tiền tệ", "Tỷ giá", "Tương đương CNY", "Tương đương VND", "Ghi chú"];
  s4Rows.push(s4Headers.map(h => ({ value: h, style: "sHeader" })));

  let s4TotalIn = 0, s4TotalOut = 0;
  factoryPayments.forEach(p => {
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
    s4Rows.push([
      { value: p.id, style: "sCell" },
      { value: p.payDate || "", style: "sCell" },
      { value: loaiGd, style: "sCell" },
      { value: partner, style: "sCell" },
      { value: Number(p.amount || 0), style: "sCellNum" },
      { value: p.currency, style: "sCell" },
      { value: payRate, style: "sCellNum" },
      { value: Math.round(cny), style: "sCellNum" },
      { value: Math.round(vnd), style: "sCellNum" },
      { value: p.note || "", style: "sCell" },
    ]);
  });
  if (factoryPayments.length === 0) {
    s4Rows.push([{ value: "(Không có thanh toán nào trong kỳ)", style: "sSubtitle", mergeAcross: 10 }]);
  } else {
    s4Rows.push([]);
    s4Rows.push([
      { value: "Tổng tiền vào (CNY)", style: "sTotalLabel", mergeAcross: 6 },
      { value: Math.round(s4TotalIn), style: "sTotal" },
      { value: Math.round(s4TotalIn * (settings.cnyToVnd || 1)), style: "sTotal" },
      { value: "", style: "sTotalLabel" },
    ]);
    s4Rows.push([
      { value: "Tổng tiền ra (CNY)", style: "sTotalLabel", mergeAcross: 6 },
      { value: Math.round(s4TotalOut), style: "sTotal" },
      { value: Math.round(s4TotalOut * (settings.cnyToVnd || 1)), style: "sTotal" },
      { value: "", style: "sTotalLabel" },
    ]);
    s4Rows.push([
      { value: "THANH TOÁN RÒNG", style: "sTotalLabel", mergeAcross: 6 },
      { value: Math.round(s4TotalIn - s4TotalOut), style: "sTotal" },
      { value: Math.round((s4TotalIn - s4TotalOut) * (settings.cnyToVnd || 1)), style: "sTotal" },
      { value: "", style: "sTotalLabel" },
    ]);
  }
  const sheet4 = xmlWorksheet("Lịch sử thanh toán", s4Rows, [110, 80, 190, 220, 100, 60, 70, 110, 130, 220]);

  // === SHEET 5: PHÍ NHẬP KHẨU LIÊN QUAN ===
  const s5Rows = [];
  s5Rows.push([{ value: `PHÍ NHẬP KHẨU LIÊN QUAN — ${factory.name}`, style: "sTitle", mergeAcross: 11 }]);
  s5Rows.push([]);
  const s5Headers = ["Mã lô", "Ngày xuất", "Thị trường", "Loại phí", "Đơn vị VC", "Người thụ hưởng", "Số tiền", "Tiền tệ", "Quy đổi VND", "Đã TT (VND)", "Còn phải trả (VND)", "Ghi chú"];
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

  // === Build file ===
  const allSheets = [sheet1, sheet2, sheet3, sheet4, sheet5].join("\n");
  const safeFactoryCode = (factory.supplierCode || factory.id || "NCC").replace(/[^A-Za-z0-9_-]/g, "_");
  const today = new Date().toISOString().slice(0, 10);
  const filename = `BaoCao_DoiSoat_${safeFactoryCode}_${today}.xls`;
  downloadXlsFile(allSheets, filename);
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

const ProgressBar = ({ value, max, color = C.green500 }) => {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%`, background: color }} /></div>;
};

const Modal = ({ title, subtitle, onClose, onSave, saveLabel = "Lưu", saveDisabled, children, width = 760 }) => (
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
      {onSave && (
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary" disabled={saveDisabled} onClick={onSave}>{saveLabel}</button>
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

const shipmentStatusColor = (s) => {
  const map = {
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
  const map = { "Chờ xác nhận": C.orange, "Đang sản xuất": C.purple, "SX một phần": C.blue, "Hoàn thành SX": C.green500, "Hủy": C.red };
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
const Dashboard = ({ pos, shipments, payments, factories, products, openingBalances, markets, carriers, feePayments, settings, onNavigate }) => {
  const marketNames = getMarketNames(markets);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filteredPOs = useMemo(() => filterByDateRange(pos, "orderDate", dateFrom, dateTo), [pos, dateFrom, dateTo]);
  const filteredShipments = useMemo(() => filterByDateRange(shipments, "departDate", dateFrom, dateTo), [shipments, dateFrom, dateTo]);
  const filteredPayments = useMemo(() => filterByDateRange(payments, "payDate", dateFrom, dateTo), [payments, dateFrom, dateTo]);

  const stats = useMemo(() => {
    let expectedCNY = 0, actualRemainCNY = 0, totalCreditCNY = 0;
    // v11: Tiền dự kiến phải trả NCC — giá trị PO đã duyệt × đơn giá (trừ PO đã hủy và đã thanh toán)
    let expectedToPayCNY = 0;
    factories.forEach(f => {
      const b = calcFactoryBalance(f.id, filteredPOs, filteredShipments, filteredPayments, openingBalances);
      expectedCNY += b.expectedDebt;
      actualRemainCNY += b.stillOwed;
      totalCreditCNY += b.creditFund;
      // expectedDebt = phần hàng còn chưa ship nhưng PO đã duyệt (tính ở giá CNY từ calcFactoryBalance)
    });
    // v11: Tổng tiền PO đã duyệt và chưa hủy (giá trị dự kiến phải trả) theo CNY
    filteredPOs.forEach(p => {
      if (p.status === "Hủy") return;
      if (!p.approved) return;
      const totalVal = poTotalValue(p); // in PO currency
      const valCNY = toVND(totalVal, p.currency, settings) / settings.cnyToVnd;
      expectedToPayCNY += valCNY;
    });
    // Trừ đã thanh toán cho NCC
    const totalPaidCNY = filteredPayments.filter(x => x.type === "MARKET_TO_FACTORY" || x.type === "INTER_FACTORY").reduce((sum, p) => {
      const vnd = toVND(Number(p.amount || 0), p.currency, settings);
      return sum + vnd / settings.cnyToVnd;
    }, 0);
    expectedToPayCNY = Math.max(0, expectedToPayCNY - totalPaidCNY);

    const inProduction = filteredPOs.filter(p => ["Đang sản xuất", "SX một phần", "Chờ xác nhận"].includes(p.status)).length;
    const inTransit = filteredShipments.filter(s => ["Đang vận chuyển TQ", "Đang vận chuyển", "Đang thông quan", "Kiểm hoá", "Đã thông quan"].includes(s.status)).length;
    const delivered = filteredShipments.filter(s => s.status === "Đã về kho").length;
    return { expectedCNY, actualRemainCNY, totalCreditCNY, expectedToPayCNY, inProduction, inTransit, delivered };
  }, [filteredPOs, filteredShipments, filteredPayments, factories, openingBalances, settings]);

  // v11: Cảnh báo quan trọng (tính trên dữ liệu đầy đủ — không lọc theo thời gian vì cảnh báo cần real-time)
  const alerts = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const out = [];

    // 1. PO quá hạn SX (expectedDate < hôm nay nhưng status !== Hoàn thành SX + !== Hủy)
    const overduePOs = pos.filter(p => {
      if (p.status === "Hủy" || p.status === "Hoàn thành SX") return false;
      if (!p.expectedDate) return false;
      return p.expectedDate < today;
    });
    if (overduePOs.length > 0) {
      out.push({
        type: "po_overdue", severity: "red",
        title: `${overduePOs.length} PO quá hạn sản xuất`,
        detail: overduePOs.slice(0, 3).map(p => `${p.id} (hẹn ${fmtDate(p.expectedDate)})`).join(", ") + (overduePOs.length > 3 ? `, +${overduePOs.length - 3} nữa` : ""),
        action: "pos",
      });
    }

    // 2. NCC quá hạn công nợ (có công nợ + PO cũ hơn paymentDays)
    const ncOverdue = [];
    factories.forEach(f => {
      if (!f.paymentDays || f.status === "stopped") return;
      const b = calcFactoryBalance(f.id, pos, shipments, payments, openingBalances);
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

    return out;
  }, [pos, shipments, payments, factories, openingBalances, feePayments, settings]);

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
      const b = calcFactoryBalance(f.id, filteredPOs, filteredShipments, filteredPayments, openingBalances);
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

      {/* KPI Cards row 1 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard icon="📋" label="PO Đang SX" value={stats.inProduction} sub={`/ ${filteredPOs.length} tổng PO`} />
        <KpiCard icon="🚚" label="Đang vận chuyển" value={stats.inTransit} sub={`${stats.delivered} lô đã về kho`} />
        <KpiCard icon="💰" label="Còn phải trả (thực tế)" valueCNY={stats.actualRemainCNY} valueVND={toVND(stats.actualRemainCNY, "CNY", settings)} settings={settings} />
        <KpiCard icon="📅" label="Dự kiến phải trả NCC" valueCNY={stats.expectedToPayCNY} valueVND={toVND(stats.expectedToPayCNY, "CNY", settings)} settings={settings} />
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
              const b = calcFactoryBalance(f.id, filteredPOs, filteredShipments, filteredPayments, openingBalances);
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

const ProductForm = ({ initial, factories, settings, onSave, onCreateCategory, onClose }) => {
  const [form, setForm] = useState(initial || {
    sku: "", name: "", nameImport: "", category: (settings.productCategories?.[0] || ""),
    imageUrl: "", factoryId: factories[0]?.id || "", unitPrice: "", currency: "CNY", unit: "cái", description: "", cost: "",
    lengthCm: "", widthCm: "", heightCm: "", qtyPerCarton: "",
  });
  const [imgMode, setImgMode] = useState("url"); // url | upload
  const [showNewCat, setShowNewCat] = useState(false); // v11.2: popup tạo category
  const [newCatError, setNewCatError] = useState(null);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const isValid = form.sku && form.name && form.factoryId && form.unitPrice;

  const handleFile = (file) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert("Ảnh lớn hơn 2MB sẽ làm chậm hệ thống. Vui lòng chọn ảnh nhỏ hơn."); return; }
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
    <Modal title={initial ? "Sửa sản phẩm" : "Thêm sản phẩm mới"} onClose={onClose} onSave={() => onSave(form)} saveDisabled={!isValid} width={880}>
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
          <input type="number" step="0.01" value={form.unitPrice} onChange={e => set("unitPrice", e.target.value)} />
        </div>
        <div className="form-group"><label>Giá vốn</label>
          <input type="number" step="0.01" value={form.cost} onChange={e => set("cost", e.target.value)} placeholder="Nếu khác giá mua" />
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

        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Mô tả</label>
          <textarea rows={2} value={form.description} onChange={e => set("description", e.target.value)} />
        </div>
      </div>

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
    </Modal>
  );
};

const Products = ({ products, pos, shipments, factories, settings, onAdd, onEdit, onDelete, onSaveSettings, user }) => {
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState({ factory: "", category: "", search: "" });

  const productStats = useMemo(() => products.map(p => {
    let totalOrdered = 0, totalProduced = 0, totalShipped = 0;
    pos.forEach(po => {
      if (po.status === "Hủy") return; // v10: bỏ qua PO đã hủy
      const poItems = getPOItems(po);
      poItems.forEach(it => {
        if (it.productId !== p.id) return;
        totalOrdered += Number(it.quantity || 0);
        totalProduced += Number(it.produced || 0);
        totalShipped += po.items ? shippedFromItem(po.id, it.id, shipments) : shippedFromPO(po.id, shipments);
      });
    });
    const inStock = totalProduced - totalShipped;
    const pendingProduction = totalOrdered - totalProduced;
    return { ...p, totalOrdered, totalProduced, totalShipped, inStock, pendingProduction };
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
              <th>Đã đặt</th><th>Đã SX</th><th>Đã ship</th><th>Tồn kho NM</th><th>Chờ SX</th>
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
                  <td style={{ color: C.green600, fontWeight: 600 }}>{p.totalProduced.toLocaleString()}</td>
                  <td style={{ color: C.blue, fontWeight: 600 }}>{p.totalShipped.toLocaleString()}</td>
                  <td style={{ color: C.orange, fontWeight: 600 }}>{p.inStock.toLocaleString()}</td>
                  <td style={{ color: p.pendingProduction > 0 ? C.red : C.textMuted, fontWeight: 600 }}>{p.pendingProduction.toLocaleString()}</td>
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

      {modal?.type === "new" && <ProductForm factories={factories} settings={settings}
        onCreateCategory={canEdit ? (cat) => onSaveSettings({ ...settings, productCategories: [...(settings.productCategories || []), cat] }) : null}
        onSave={f => { onAdd("products", { id: `p${uid()}`, ...f }); setModal(null); }} onClose={() => setModal(null)} />}
      {modal?.type === "edit" && <ProductForm initial={modal.data} factories={factories} settings={settings}
        onCreateCategory={canEdit ? (cat) => onSaveSettings({ ...settings, productCategories: [...(settings.productCategories || []), cat] }) : null}
        onSave={f => { onEdit("products", modal.data.id, f); setModal(null); }} onClose={() => setModal(null)} />}

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
    </div>
  );
};

// ============================================================
// PO — Với expandable detail
// ============================================================
const POForm = ({ initial, factories, products, onSave, onClose }) => {
  const [form, setForm] = useState(initial ? {
    ...initial,
    items: getPOItems(initial).map(it => ({ ...it })),
  } : {
    id: "",
    factoryId: factories[0]?.id || "", currency: "CNY",
    orderDate: new Date().toISOString().slice(0, 10), expectedDate: "", status: "Chờ xác nhận", approved: false, note: "",
    items: [],
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const factoryProducts = products.filter(p => p.factoryId === form.factoryId);

  const addItem = () => {
    const available = factoryProducts.filter(fp => !form.items.some(it => it.productId === fp.id));
    if (available.length === 0) return;
    const prod = available[0];
    setForm(p => ({ ...p, items: [...p.items, { id: `it${uid()}`, productId: prod.id, quantity: 0, unitPrice: prod.unitPrice, produced: 0 }] }));
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
          <label>Mã PO {initial ? "" : "(tùy chọn)"}</label>
          <input value={form.id} onChange={e => set("id", e.target.value)} disabled={!!initial} placeholder={initial ? "" : "Để trống để tự sinh mã. VD: PO-S24-001"} />
          {!initial && <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>Nếu không đặt, hệ thống tự tạo mã theo định dạng PO-2026-xxxxx</div>}
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
          const available = factoryProducts.filter(fp => fp.id === it.productId || !form.items.some(other => other.productId === fp.id));
          const lineTotal = Number(it.quantity || 0) * Number(it.unitPrice || 0);
          return (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 110px 120px 40px", gap: 8, marginBottom: 8, padding: 10, background: C.white, borderRadius: 10, alignItems: "center" }}>
              <select value={it.productId} onChange={e => updateItem(idx, "productId", e.target.value)}>
                <option value="">-- Chọn sản phẩm --</option>
                {available.map(p => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
              </select>
              <input type="number" value={it.quantity} onChange={e => updateItem(idx, "quantity", e.target.value)} placeholder="SL" min={0} />
              <input type="number" step="0.01" value={it.unitPrice} onChange={e => updateItem(idx, "unitPrice", e.target.value)} placeholder="Đơn giá" />
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
      {!initial && isValid && <div className="alert alert-info">PO mới sẽ ở trạng thái <b>"Chờ xác nhận"</b>. Kế toán hoặc Admin cần duyệt trước khi nhà máy bắt đầu sản xuất.</div>}
      {factoryProducts.length === 0 && <div className="alert alert-warn">Nhà máy này chưa có sản phẩm nào. Vui lòng thêm sản phẩm trước.</div>}
    </Modal>
  );
};

const ProducedForm = ({ po, products, onSave, onClose }) => {
  const initialItems = getPOItems(po);
  const [items, setItems] = useState(initialItems.map(it => ({ ...it, producedNew: it.produced || 0 })));

  const updateProduced = (idx, val) => {
    const v = Math.max(0, Math.min(Number(val || 0), items[idx].quantity));
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, producedNew: v } : it));
  };

  const hasInvalid = items.some(it => it.producedNew < 0 || it.producedNew > it.quantity);
  const allDone = items.every(it => it.producedNew >= it.quantity);
  const someDone = items.some(it => it.producedNew > 0);
  const newStatus = allDone ? "Hoàn thành SX" : someDone ? "SX một phần" : po.status;

  const handleSave = () => {
    const newItems = items.map(({ producedNew, ...rest }) => ({ ...rest, produced: producedNew }));
    onSave({ items: newItems, status: newStatus });
  };

  return (
    <Modal title={`Cập nhật tiến độ SX — ${po.id}`} subtitle={`${items.length} sản phẩm · Nhập số lượng đã SX xong (cộng dồn)`}
      onClose={onClose} onSave={handleSave} saveDisabled={hasInvalid} width={760}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((it, idx) => {
          const prod = products.find(p => p.id === it.productId);
          const remain = Number(it.quantity) - Number(it.producedNew);
          const pct = it.quantity > 0 ? (it.producedNew / it.quantity) * 100 : 0;
          return (
            <div key={it.id} style={{ padding: 14, background: C.green50, borderRadius: 10, border: `1px solid ${C.green200}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.green800 }}>{prod?.sku} — {prod?.name}</div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Đơn giá: {fmt(it.unitPrice, po.currency)}</div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: pct >= 100 ? C.green600 : pct > 0 ? C.blue : C.textMuted }}>
                  {pct.toFixed(0)}%
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 100px 100px", gap: 10, alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: C.textMuted }}>Đã SX:</div>
                <input type="number" value={it.producedNew} onChange={e => updateProduced(idx, e.target.value)} min={0} max={it.quantity} />
                <div style={{ fontSize: 11, color: C.textMuted, textAlign: "right" }}>/ {Number(it.quantity).toLocaleString()}</div>
                <div style={{ fontSize: 12, color: C.orange, fontWeight: 600, textAlign: "right" }}>Còn: {remain.toLocaleString()}</div>
              </div>
              <ProgressBar value={it.producedNew} max={it.quantity} />
            </div>
          );
        })}
      </div>
      <div className="alert alert-info">Trạng thái mới: <b>{newStatus}</b></div>
    </Modal>
  );
};

const POs = ({ pos, factories, products, shipments, settings, onAdd, onEdit, onDelete, onConfirm, user }) => {
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState({ factory: "", status: "", search: "" });
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expanded, setExpanded] = useState(null);

  const canEdit = can(user, "edit_po");
  const canCreate = can(user, "create_po");
  const canDelete = can(user, "delete_po");
  const canApprove = can(user, "approve_po");

  // v11.2: State cho custom dialog
  const [promptDlg, setPromptDlg] = useState(null);

  const handleApprove = (po) => {
    onConfirm({
      title: `Duyệt PO ${po.id}?`,
      message: `Sau khi duyệt, PO sẽ chuyển sang trạng thái "Đang sản xuất" và KHÔNG THỂ sửa được nữa.\n\nBạn có chắc chắn muốn duyệt?`,
      confirmLabel: "✓ Duyệt",
      onConfirm: () => {
        onEdit("pos", po.id, {
          approved: true,
          approvedBy: user.fullName,
          approvedAt: new Date().toISOString().slice(0, 10),
          status: "Đang sản xuất",
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
    return filterByDateRange(pos, "orderDate", dateFrom, dateTo).filter(p => {
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
  }, [pos, filter, dateFrom, dateTo, products]);

  const pendingCount = pos.filter(p => !p.approved && p.status !== "Hủy").length;

  return (
    <div>
      <SectionHeader title="Đơn đặt hàng" subtitle={`Click vào PO để xem chi tiết${pendingCount > 0 ? ` · ${pendingCount} PO chờ duyệt` : ""}`}
        action={canCreate && <button className="btn btn-primary" onClick={() => setModal({ type: "new" })}>+ Tạo PO mới</button>}
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
          <thead><tr><th></th><th>Mã PO</th><th>Nhà máy</th><th>SP</th><th>Tổng SL</th><th>Đã SX</th><th>Đã ship</th><th>Giá trị</th><th>Ngày đặt</th><th>Trạng thái</th><th></th></tr></thead>
          <tbody>
            {filtered.map(p => {
              const f = factories.find(x => x.id === p.factoryId);
              const items = getPOItems(p);
              const totalQty = poTotalQuantity(p);
              const totalProduced = poTotalProduced(p);
              const totalShipped = shippedFromPO(p.id, shipments);
              const totalValue = poTotalValue(p);
              const totalStock = totalProduced - totalShipped;
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
                      <div style={{ color: C.green600, fontWeight: 600 }}>{totalProduced.toLocaleString()}</div>
                      <div style={{ width: 50 }}><ProgressBar value={totalProduced} max={totalQty} /></div>
                    </td>
                    <td style={{ color: C.blue, fontWeight: 600 }}>{totalShipped.toLocaleString()}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{fmt(totalValue, p.currency)}</div>
                      <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(toVND(totalValue, p.currency, settings), "VND")}</div>
                    </td>
                    <td style={{ fontSize: 12 }}>{fmtDate(p.orderDate)}</td>
                    <td><Badge label={p.status} color={poStatusColor(p.status)} /></td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {!p.approved && p.status !== "Hủy" && canApprove && (
                          <>
                            <button className="btn btn-primary" style={{ padding: "5px 12px", fontSize: 11, background: C.green500 }} onClick={() => handleApprove(p)}>✓ Duyệt</button>
                            <button className="btn btn-danger" style={{ padding: "5px 12px", fontSize: 11 }} onClick={() => handleReject(p)}>🚫 Hủy</button>
                          </>
                        )}
                        {p.approved && p.status !== "Hủy" && <button className="btn btn-primary" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setModal({ type: "produce", data: p })}>+ SX</button>}
                        {!p.approved && p.status !== "Hủy" && canEdit && <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: p })}>Sửa</button>}
                        {canDelete && <button className="btn btn-danger" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => onDelete("pos", p.id)}>X</button>}
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
                                <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>Tiến độ SX</div>
                                <div style={{ fontWeight: 700 }}>{totalProduced.toLocaleString()} / {totalQty.toLocaleString()}</div>
                              </div>
                              <div style={{ background: C.white, padding: 12, borderRadius: 10, border: `1px solid ${C.border}` }}>
                                <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>Tồn kho nhà máy</div>
                                <div style={{ fontWeight: 700, color: C.orange }}>{totalStock.toLocaleString()}</div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Per-item detail table */}
                        <GreenPill>Chi tiết từng sản phẩm ({items.length})</GreenPill>
                        <table>
                          <thead><tr><th>SKU</th><th>Sản phẩm</th><th>Đơn giá</th><th>SL đặt</th><th>Đã SX</th><th>Đã ship</th><th>Tồn kho</th><th>Giá trị</th></tr></thead>
                          <tbody>
                            {items.map(it => {
                              const prod = products.find(x => x.id === it.productId);
                              const itemShipped = p.items ? shippedFromItem(p.id, it.id, shipments) : shippedFromPO(p.id, shipments);
                              const itemStock = Number(it.produced || 0) - itemShipped;
                              const itemValue = Number(it.quantity) * Number(it.unitPrice);
                              return (
                                <tr key={it.id}>
                                  <td style={{ fontWeight: 700, color: C.green600, fontSize: 12 }}>{prod?.sku || "-"}</td>
                                  <td style={{ fontSize: 12 }}>{prod?.name || "-"}</td>
                                  <td style={{ fontWeight: 600, fontSize: 12 }}>{fmt(it.unitPrice, p.currency)}</td>
                                  <td style={{ fontWeight: 600 }}>{Number(it.quantity).toLocaleString()}</td>
                                  <td>
                                    <div style={{ color: C.green600, fontWeight: 600 }}>{Number(it.produced || 0).toLocaleString()}</div>
                                    <div style={{ width: 50 }}><ProgressBar value={it.produced || 0} max={it.quantity} /></div>
                                  </td>
                                  <td style={{ color: C.blue, fontWeight: 600 }}>{itemShipped.toLocaleString()}</td>
                                  <td style={{ color: itemStock > 0 ? C.orange : C.textMuted, fontWeight: 600 }}>{itemStock.toLocaleString()}</td>
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
                              <thead><tr><th>Mã lô</th><th>Thị trường</th><th>Ngày xuất</th><th>Sản phẩm</th><th>SL</th><th>Trạng thái</th><th>Tracking</th></tr></thead>
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
      </div>

      {modal?.type === "new" && <POForm factories={factories} products={products} onSave={f => {
        const customId = (f.id || "").trim();
        const autoId = `PO-${new Date().getFullYear()}-${uid()}`;
        const finalId = customId || autoId;
        if (customId && pos.some(p => p.id === customId)) {
          alert(`Mã PO "${customId}" đã tồn tại. Vui lòng đặt mã khác hoặc để trống.`);
          return;
        }
        const { id: _, ...rest } = f;
        onAdd("pos", { id: finalId, ...rest, approved: false, status: "Chờ xác nhận" });
        setModal(null);
      }} onClose={() => setModal(null)} />}
      {modal?.type === "edit" && <POForm initial={modal.data} factories={factories} products={products} onSave={f => {
        const { id: _, ...rest } = f;
        onEdit("pos", modal.data.id, rest);
        setModal(null);
      }} onClose={() => setModal(null)} />}
      {modal?.type === "produce" && <ProducedForm po={modal.data} products={products} onSave={f => { onEdit("pos", modal.data.id, f); setModal(null); }} onClose={() => setModal(null)} />}
      {/* v11.2: Prompt dialog cho hủy PO */}
      {promptDlg && <PromptDialog {...promptDlg} onClose={() => setPromptDlg(null)} />}
    </div>
  );
};

// ============================================================
// SHIPMENTS v10 — 7 trạng thái (thêm Hủy), kho 2 cấp, số kiện, về kho workflow
// ============================================================
const ShipmentForm = ({ initial, pos, shipments: allShipments, factories, products, markets, carriers, settings, onSave, onCreateWarehouse, onClose }) => {
  const marketNames = getMarketNames(markets);
  const defaultMarket = (initial?.market) || marketNames[0] || "Vietnam";
  // v12: Init warehouseId — nếu initial.warehouseId không còn thuộc market → dùng kho mặc định
  const _whsOfDefault = getMarketWarehouses(defaultMarket, markets);
  const _initWhValid = initial?.warehouseId && _whsOfDefault.some(w => w.id === initial.warehouseId);
  const defaultWhId = _initWhValid ? initial.warehouseId : getDefaultWarehouseId(defaultMarket, markets);
  const [form, setForm] = useState(initial ? { ...initial, warehouseId: defaultWhId } : {
    id: "",
    market: defaultMarket,
    warehouseId: defaultWhId,
    departDate: new Date().toISOString().slice(0, 10), arriveDate: "",
    carrier: "", carrierId: "", trackingNo: "", checkingCode: "",
    status: "Chờ xuất",
    packages: "", // v10: số kiện
    note: "", items: [], fees: [],
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

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
  const availableLines = useMemo(() => {
    const result = [];
    pos.forEach(po => {
      if (!po.approved || po.status === "Hủy") return; // v10: skip PO hủy
      const poItems = getPOItems(po);
      poItems.forEach(it => {
        const alreadyShipped = allShipments.filter(s => s.id !== initial?.id && s.status !== "Hủy")
          .flatMap(s => s.items || [])
          .filter(i => i.poId === po.id && (po.items ? i.itemId === it.id : true))
          .reduce((sum, i) => sum + Number(i.quantity || 0), 0);
        const currentItem = (initial?.items || []).find(i => i.poId === po.id && i.itemId === it.id);
        const currentQty = currentItem ? Number(currentItem.quantity) : 0;
        const available = Number(it.produced || 0) - alreadyShipped;
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
    if (availableLines.length === 0) return;
    const unused = availableLines.find(line => !form.items.some(it => it.poId === line.poId && it.itemId === line.itemId));
    if (unused) set("items", [...form.items, { poId: unused.poId, itemId: unused.itemId, quantity: 0 }]);
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
    if (!line) { errors.push(`Dòng ${idx + 1}: PO/SP không hợp lệ (chưa duyệt, đã hủy hoặc chưa SX)`); return; }
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
  const statusLocked = initial && initial.status !== "Chờ xuất";

  return (
    <Modal title={initial ? "Sửa lô giao hàng" : "Tạo lô giao hàng"} onClose={onClose} onSave={() => onSave(form)} saveDisabled={errors.length > 0} width={900}>
      <div className="form-grid">
        <div className="form-group" style={{ gridColumn: "1/-1" }}><label>Mã lô giao hàng {initial ? "" : "(tùy chọn)"}</label>
          <input value={form.id} onChange={e => set("id", e.target.value)} disabled={!!initial} placeholder={initial ? "" : "Để trống để tự sinh mã GC-yyyymmdd-xxxx"} />
          {!initial && <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>Nếu trống, hệ thống tự tạo mã dạng GC + ngày tháng năm + 4 ký tự ngẫu nhiên</div>}
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
          <input type="number" min={0} value={form.packages} onChange={e => set("packages", e.target.value)} placeholder="VD: 50" />
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
            <div style={{ fontSize: 13, fontWeight: 700, color: C.green700 }}>📦 Hàng từ PO (chỉ hàng đã SX & đã duyệt)</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{availableLines.length} dòng SP có hàng sẵn để ship</div>
          </div>
          <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={addItem} disabled={availableLines.length === 0}>+ Thêm dòng</button>
        </div>
        {availableLines.length === 0 && <div className="alert alert-warn">Chưa có PO nào có hàng sẵn (cần duyệt PO + cập nhật SX).</div>}
        {form.items.map((it, idx) => {
          const line = availableLines.find(l => l.poId === it.poId && l.itemId === it.itemId);
          const f = factories.find(x => x.id === line?.factoryId);
          const prod = products.find(x => x.id === line?.productId);
          return (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 120px 40px", gap: 8, marginBottom: 8, padding: 10, background: C.white, borderRadius: 10 }}>
              <select value={line ? `${it.poId}|${it.itemId}` : ""} onChange={e => updateItem(idx, "lineKey", e.target.value)}>
                {!line && <option value="">-- Chọn dòng --</option>}
                {availableLines.filter(l => (l.poId === it.poId && l.itemId === it.itemId) || !form.items.some(other => other.poId === l.poId && other.itemId === l.itemId)).map(l => (
                  <option key={`${l.poId}|${l.itemId}`} value={`${l.poId}|${l.itemId}`}>{l.label} (tồn: {l.available})</option>
                ))}
              </select>
              <input type="number" value={it.quantity} onChange={e => updateItem(idx, "quantity", e.target.value)} placeholder="SL" min={0} max={line?.available || 0} />
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
              <input type="number" value={fee.amount} onChange={e => updateFee(idx, "amount", e.target.value)} placeholder="Số tiền" step="0.01" />
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

      <div className="form-group"><label>Ghi chú</label>
        <textarea rows={2} value={form.note} onChange={e => set("note", e.target.value)} />
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
                      <input type="number" value={it.receivedQty} min={0} max={it.quantity}
                        onChange={e => updateItem(idx, "receivedQty", e.target.value)}
                        style={{ width: 90, padding: "4px 8px" }} />
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
    </Modal>
  );
};

const Shipments = ({ shipments, pos, factories, products, feePayments, markets, carriers, settings, onAdd, onEdit, onDelete, onCreateWarehouse, user }) => {
  const marketNames = getMarketNames(markets);
  const [modal, setModal] = useState(null);
  const [arriveModal, setArriveModal] = useState(null); // v10: confirm về kho
  const [filter, setFilter] = useState({ market: "", warehouse: "", status: "", search: "" });
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expanded, setExpanded] = useState(null);
  // v11.2: Custom dialog state
  const [confirmDlg, setConfirmDlg] = useState(null);

  const canEdit = can(user, "edit_shipment");
  const canCreate = can(user, "create_shipment");
  const canDelete = can(user, "delete_shipment");
  const canChangeStatus = can(user, "change_shipment_status") || can(user, "edit_shipment");

  // Warehouses options based on selected market filter
  const availableWhs = useMemo(() => {
    if (filter.market) return getMarketWarehouses(filter.market, markets);
    return getAllWarehouses(markets);
  }, [filter.market, markets]);

  const filtered = useMemo(() => {
    const q = (filter.search || "").trim().toLowerCase();
    return filterByDateRange(shipments, "departDate", dateFrom, dateTo).filter(s => {
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
  }, [shipments, filter, dateFrom, dateTo, pos, products]);

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
      setConfirmDlg({
        title: `Hủy lô ${s.id}?`,
        message: "Sau khi hủy sẽ không thể thao tác thêm. Bạn có chắc chắn?",
        danger: true, confirmLabel: "🚫 Xác nhận Hủy",
        onConfirm: () => onEdit("shipments", s.id, { status: "Hủy" }),
      });
      return;
    }
    onEdit("shipments", s.id, { status: newStatus });
  };

  return (
    <div>
      <SectionHeader title="Giao hàng" subtitle="Chờ xuất → Đang VC TQ → Thông quan → Kiểm hoá → Đã thông quan → Về kho"
        action={canCreate && <button className="btn btn-primary" onClick={() => setModal({ type: "new" })}>+ Tạo lô giao hàng</button>}
      />

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: "14px 18px", marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input placeholder="🔍 Tìm mã lô, tracking, SKU, tên SP..." value={filter.search} onChange={e => setFilter(p => ({ ...p, search: e.target.value }))} style={{ width: 280 }} />
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
          <thead><tr><th></th><th>Mã lô</th><th>Thị trường / Kho</th><th>Trạng thái</th><th>Ngày xuất → nhận</th><th>Carrier</th><th>Tracking</th><th>Kiện</th><th>SL</th><th></th></tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={10} style={{ textAlign: "center", color: C.textMuted, padding: 40 }}>Không có lô giao hàng nào</td></tr>
            ) : filtered.map(s => {
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
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 4 }}>
                        {canEdit && s.status === "Chờ xuất" && <button className="btn btn-ghost" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: s })}>Sửa</button>}
                        {canDelete && <button className="btn btn-danger" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => onDelete("shipments", s.id)}>X</button>}
                      </div>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr>
                      <td colSpan={10} style={{ background: C.green50, padding: 24 }}>
                        <ShipmentDetail shipment={s} pos={pos} factories={factories} products={products} feePayments={feePayments} markets={markets} carriers={carriers} settings={settings} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal?.type === "new" && <ShipmentForm pos={pos} shipments={shipments} factories={factories} products={products} markets={markets} carriers={carriers} settings={settings} onCreateWarehouse={onCreateWarehouse} onSave={f => {
        const customId = (f.id || "").trim();
        const now = new Date();
        const ymd = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
        const rand4 = Math.floor(1000 + Math.random() * 9000);
        const autoId = `GC-${ymd}-${rand4}`;
        const finalId = customId || autoId;
        if (customId && shipments.some(s => s.id === customId)) {
          alert(`Mã lô "${customId}" đã tồn tại. Vui lòng đặt mã khác hoặc để trống.`);
          return;
        }
        const { id: _, ...rest } = f;
        onAdd("shipments", { id: finalId, ...rest });
        setModal(null);
      }} onClose={() => setModal(null)} />}
      {modal?.type === "edit" && <ShipmentForm initial={modal.data} pos={pos} shipments={shipments} factories={factories} products={products} markets={markets} carriers={carriers} settings={settings} onCreateWarehouse={onCreateWarehouse} onSave={f => {
        const { id: _, ...rest } = f;
        onEdit("shipments", modal.data.id, rest);
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
    </div>
  );
};

// Shipment Detail expand content (v10: + warehouse, packages, receivedQty)
const ShipmentDetail = ({ shipment: s, pos, factories, products, feePayments, markets, carriers, settings }) => {
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
        <table>
          <thead><tr><th>PO</th><th>SKU</th><th>Sản phẩm</th><th>Nhà máy</th><th>SL giao</th>{s.status === "Đã về kho" && <><th>SL nhận</th><th>Xử lý lệch</th></>}<th>Giá trị</th></tr></thead>
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
                  <td style={{ fontSize: 12 }}>{f?.name}</td>
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
          <input type="number" step="0.01" value={form.amount} onChange={e => set("amount", e.target.value)} />
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

const ImportFees = ({ shipments, feePayments, markets, carriers, settings, onAdd, onDelete, user }) => {
  const marketNames = getMarketNames(markets);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [subTab, setSubTab] = useState("overview");
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState({ market: "", payee: "", paymentStatus: "" });

  const canCreatePay = can(user, "create_fee_payment");
  const canDeletePay = can(user, "delete_fee_payment");

  const filtered = useMemo(() => filterByDateRange(shipments, "departDate", dateFrom, dateTo), [shipments, dateFrom, dateTo]);

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
            <thead><tr><th>Mã TT</th><th>Ngày</th><th>Lô hàng</th><th>Loại phí</th><th>Đơn vị thụ hưởng</th><th>Số tiền</th><th>Người TT</th><th>Ghi chú</th>{canDeletePay && <th></th>}</tr></thead>
            <tbody>
              {feePayments.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: "center", color: C.textMuted, padding: 30 }}>Chưa có thanh toán nào</td></tr>
              ) : feePayments.slice().reverse().map(p => {
                const sh = shipments.find(s => s.id === p.shipmentId);
                const fee = (sh?.fees || []).find(f => f.id === p.feeId);
                return (
                  <tr key={p.id}>
                    <td style={{ color: C.green600, fontWeight: 600, fontSize: 12 }}>{p.id}</td>
                    <td style={{ fontSize: 12 }}>{fmtDate(p.payDate)}</td>
                    <td style={{ fontSize: 12, fontWeight: 600, color: C.green600 }}>{p.shipmentId}</td>
                    <td style={{ fontSize: 12 }}>{fee?.type || "-"}</td>
                    <td style={{ fontSize: 12 }}>{fee?.payee || "-"}</td>
                    <td style={{ fontWeight: 700, color: C.blue }}>{fmt(p.amount, p.currency)}</td>
                    <td style={{ fontSize: 12 }}>{p.payer || "-"}</td>
                    <td style={{ fontSize: 11, color: C.textMuted }}>{p.note || "-"}</td>
                    {canDeletePay && <td><button className="btn btn-danger" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => onDelete("feePayments", p.id)}>X</button></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal?.type === "pay" && (
        <FeePaymentForm fee={modal.fee} shipment={modal.shipment} existingPayments={modal.existing} settings={settings}
          onSave={f => { onAdd("feePayments", { id: `FPAY-${uid()}`, ...f }); setModal(null); }}
          onClose={() => setModal(null)} />
      )}
    </div>
  );
};

// ============================================================
// DEBTS
// ============================================================
const Debts = ({ pos, shipments, payments, factories, openingBalances, settings, feePayments, products, carriers, markets, user }) => {
  const rows = useMemo(() => factories.map(f => ({
    factory: f, ...calcFactoryBalance(f.id, pos, shipments, payments, openingBalances)
  })), [pos, shipments, payments, factories, openingBalances]);

  const summary = useMemo(() => ({
    totalExpected: rows.reduce((s, r) => s + r.expectedDebt, 0),
    totalActual: rows.reduce((s, r) => s + r.actualDebt, 0),
    totalOwed: rows.reduce((s, r) => s + r.stillOwed, 0),
    totalCredit: rows.reduce((s, r) => s + r.creditFund, 0),
    totalOpeningDebt: rows.reduce((s, r) => s + r.openingDebt, 0),
    totalOpeningCredit: rows.reduce((s, r) => s + r.openingCredit, 0),
  }), [rows]);

  // v12: Export Excel (.xls SpreadsheetML)
  const [exportModal, setExportModal] = useState(null);
  const [exporting, setExporting] = useState(false);
  const canExport = can(user, "export_accounting_report");

  const handleExport = async ({ factoryId, dateFrom, dateTo }) => {
    const factory = factories.find(f => f.id === factoryId);
    if (!factory) { alert("Vui lòng chọn NCC"); return; }
    setExporting(true);
    try {
      const fname = await exportAccountingReport({
        factory, pos, shipments, payments, feePayments, openingBalances, products,
        carriers, markets, dateFrom, dateTo, settings,
        exportedBy: user?.fullName || user?.username || "-",
      });
      alert(`✓ Đã xuất file: ${fname}`);
      setExportModal(null);
    } catch (e) {
      console.error("Export error:", e);
      alert(`Lỗi xuất file: ${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <SectionHeader title="Công nợ nhà cung cấp" subtitle="Bao gồm công nợ đầu kỳ + phát sinh mới"
        action={canExport && <button className="btn btn-primary" onClick={() => setExportModal({})}>📥 Xuất báo cáo đối soát</button>}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
        {[
          { label: "Công nợ dự kiến", val: summary.totalExpected, sub: "Chưa ship" },
          { label: "Công nợ thực tế", val: summary.totalActual + summary.totalOpeningDebt, sub: `Gồm ${fmt(summary.totalOpeningDebt, "CNY")} đầu kỳ` },
          { label: "Còn phải trả", val: summary.totalOwed, sub: "Cần thanh toán" },
          { label: "Quỹ tín dụng", val: summary.totalCredit, sub: `Gồm ${fmt(summary.totalOpeningCredit, "CNY")} đầu kỳ` },
        ].map((k, i) => (
          <div key={i} className="card">
            <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: i === 2 ? C.red : i === 3 ? C.green600 : C.green800 }}>{fmt(k.val, "CNY")}</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>≈ {fmt(toVND(k.val, "CNY", settings), "VND")}</div>
            <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {rows.map(r => {
          const { factory: f } = r;
          const paymentsOfFactory = payments.filter(p => p.toFactoryId === f.id || p.fromFactoryId === f.id);
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

              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, marginBottom: 14 }}>
                {[
                  { label: "Nợ đầu kỳ", val: r.openingDebt, color: C.textMuted, bg: C.bg, show: r.openingDebt > 0 },
                  { label: "Quỹ tín dụng đầu kỳ", val: r.openingCredit, color: C.green600, bg: C.green50, show: r.openingCredit > 0 },
                  { label: "Công nợ dự kiến", val: r.expectedDebt, color: C.textMuted, bg: C.bg, show: true },
                  { label: "Phát sinh mới", val: r.actualDebt, color: C.orange, bg: C.orangeBg, show: true },
                  { label: "Đã nhận thanh toán", val: r.inbound, color: C.blue, bg: C.blueBg, show: true },
                  { label: "Đã trả hộ nhà máy khác", val: r.outbound, color: C.purple, bg: C.purpleBg, show: true },
                  { label: "Còn nợ", val: r.stillOwed, color: r.stillOwed > 0 ? C.red : C.green600, bg: r.stillOwed > 0 ? C.redBg : C.green50, show: true },
                ].filter(b => b.show).map((b, i) => (
                  <div key={i} style={{ background: b.bg, padding: 10, borderRadius: 10 }}>
                    <div style={{ fontSize: 9, color: b.color, fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>{b.label}</div>
                    <div style={{ color: b.color, fontWeight: 700, fontSize: 13 }}>{fmt(b.val, "CNY")}</div>
                    <div style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>≈ {fmt(toVND(b.val, "CNY", settings), "VND")}</div>
                  </div>
                ))}
              </div>

              {factoryOpenings.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontWeight: 700 }}>
                    📋 Công nợ đầu kỳ ({factoryOpenings.length})
                  </div>
                  <table>
                    <thead><tr><th>Loại</th><th>Ngày</th><th>Số tiền</th><th>Ghi chú</th></tr></thead>
                    <tbody>
                      {factoryOpenings.map(o => (
                        <tr key={o.id}>
                          <td><Badge label={o.type === "debt" ? "Nợ gốc" : "Quỹ tín dụng đầu kỳ"} color={o.type === "debt" ? C.red : C.green600} /></td>
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
                    Lịch sử giao dịch ({paymentsOfFactory.length})
                  </div>
                  <div style={{ maxHeight: 200, overflowY: "auto" }}>
                    <table>
                      <thead><tr><th>Ngày</th><th>Loại</th><th>Nguồn/Đích</th><th>Số tiền</th><th>Ghi chú</th></tr></thead>
                      <tbody>
                        {paymentsOfFactory.slice().reverse().map(p => {
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
            1️⃣ Tổng hợp đối soát · 2️⃣ Chi tiết PO · 3️⃣ Chi tiết lô giao hàng · 4️⃣ Lịch sử thanh toán · 5️⃣ Phí nhập khẩu liên quan.<br/>
            Để trống ngày để xuất tất cả dữ liệu. Mở bằng Excel hoặc Google Sheets.
          </div>
        </Modal>
      )}
    </div>
  );
};

// ============================================================
// MARKET DEBTS — Công nợ theo thị trường
// ============================================================
const MarketDebts = ({ pos, shipments, payments, factories, markets, settings }) => {
  const marketNames = getMarketNames(markets);
  const [expanded, setExpanded] = useState(null);

  const balances = useMemo(() => {
    const res = {};
    marketNames.forEach(m => { res[m] = calcMarketBalance(m, pos, shipments, payments, settings); });
    return res;
  }, [pos, shipments, payments, settings]);

  const summary = useMemo(() => {
    let totalReceived = 0, totalPaid = 0, totalOwed = 0, totalCredit = 0;
    marketNames.forEach(m => {
      totalReceived += balances[m].totalReceived;
      totalPaid += balances[m].totalPaid;
      totalOwed += balances[m].stillOwed;
      totalCredit += balances[m].creditFund;
    });
    return { totalReceived, totalPaid, totalOwed, totalCredit };
  }, [balances]);

  return (
    <div>
      <SectionHeader title="Công nợ thị trường"
        subtitle="Thị trường nhận hàng → cần thanh toán cho nhà máy · Tự động trừ theo Thanh toán Thị trường → Nhà máy" />

      <div className="alert alert-info" style={{ marginBottom: 16 }}>
        <b>Cách tính:</b> Giá trị hàng đã giao về thị trường − Các giao dịch "Thanh toán Thị trường → Nhà máy" có thị trường đó đóng vai trò nguồn tiền. Nếu thị trường thanh toán vượt giá trị hàng → phần dư ghi nhận vào Quỹ tín dụng thị trường.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
        {[
          { label: "Tổng giá trị đã giao", val: summary.totalReceived, color: C.green700, sub: "Giá trị hàng ship về các thị trường" },
          { label: "Đã thanh toán", val: summary.totalPaid, color: C.blue, sub: "Qua Thanh toán Thị trường → Nhà máy" },
          { label: "Còn phải thanh toán", val: summary.totalOwed, color: C.red, sub: "Thị trường đang nợ nhà máy" },
          { label: "Quỹ tín dụng thị trường", val: summary.totalCredit, color: C.green600, sub: "Thị trường đã thanh toán dư" },
        ].map((k, i) => (
          <div key={i} className="card">
            <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.color }}>{fmt(k.val, "CNY")}</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>≈ {fmt(toVND(k.val, "CNY", settings), "VND")}</div>
            <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {marketNames.map(m => {
          const b = balances[m];
          const isExpanded = expanded === m;
          const marketPays = payments.filter(p => p.type === "MARKET_TO_FACTORY" && p.fromMarket === m);
          const marketShips = shipments.filter(s => s.market === m);
          return (
            <div key={m} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", flexWrap: "wrap", gap: 12 }} onClick={() => setExpanded(isExpanded ? null : m)}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ color: C.green500, fontSize: 14, fontWeight: 700 }}>{isExpanded ? "▼" : "▶"}</span>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{m}</div>
                    <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{marketShips.length} lô hàng · {marketPays.length} lần thanh toán</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", fontWeight: 600 }}>Nhận hàng</div>
                    <div style={{ fontWeight: 700, color: C.green700 }}>{fmt(b.totalReceived, "CNY")}</div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(toVND(b.totalReceived, "CNY", settings), "VND")}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", fontWeight: 600 }}>Đã thanh toán</div>
                    <div style={{ fontWeight: 700, color: C.blue }}>{fmt(b.totalPaid, "CNY")}</div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(toVND(b.totalPaid, "CNY", settings), "VND")}</div>
                  </div>
                  <div style={{ textAlign: "right", padding: "8px 14px", background: b.stillOwed > 0 ? C.redBg : C.green50, borderRadius: 10, minWidth: 160 }}>
                    <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", fontWeight: 600 }}>{b.stillOwed > 0 ? "Còn nợ" : "Quỹ tín dụng"}</div>
                    <div style={{ fontWeight: 700, color: b.stillOwed > 0 ? C.red : C.green600 }}>{fmt(b.stillOwed > 0 ? b.stillOwed : b.creditFund, "CNY")}</div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(toVND(b.stillOwed > 0 ? b.stillOwed : b.creditFund, "CNY", settings), "VND")}</div>
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div style={{ marginTop: 18, paddingTop: 18, borderTop: `1px solid ${C.borderLight}` }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                    <div>
                      <GreenPill>Lô hàng đã nhận</GreenPill>
                      <div style={{ maxHeight: 280, overflowY: "auto" }}>
                        <table>
                          <thead><tr><th>Mã lô</th><th>Ngày</th><th>Số lượng</th><th style={{ textAlign: "right" }}>Giá trị</th></tr></thead>
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
                            ) : marketPays.slice().reverse().map(p => {
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
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const balance = useMemo(() => form.toFactoryId ? calcFactoryBalance(form.toFactoryId, pos, shipments, payments, openingBalances) : null, [form.toFactoryId, pos, shipments, payments, openingBalances]);
  const amountNum = Number(form.amount || 0);
  const willExceed = balance && amountNum > balance.stillOwed;
  const excess = willExceed ? amountNum - balance.stillOwed : 0;

  return (
    <Modal title="Thanh toán: Thị trường → Nhà máy" onClose={onClose} onSave={() => onSave({ type: "MARKET_TO_FACTORY", ...form, amount: amountNum })} saveDisabled={!amountNum}>
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
          <input type="number" step="0.01" value={form.amount} onChange={e => set("amount", e.target.value)} />
        </div>
        <div className="form-group"><label>Tiền tệ</label>
          <select value={form.currency} onChange={e => set("currency", e.target.value)}>
            {["CNY", "USD", "VND"].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Ngày thanh toán</label>
          <input type="date" value={form.payDate} onChange={e => set("payDate", e.target.value)} />
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

const PaymentInterFactoryForm = ({ factories, pos, shipments, payments, openingBalances, onSave, onClose }) => {
  const [form, setForm] = useState({
    fromFactoryId: factories[0]?.id || "", toFactoryId: factories[1]?.id || "",
    amount: "", currency: "CNY", payDate: new Date().toISOString().slice(0, 10), note: "",
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const amountNum = Number(form.amount || 0);
  const fromBalance = form.fromFactoryId ? calcFactoryBalance(form.fromFactoryId, pos, shipments, payments, openingBalances) : null;
  const toBalance = form.toFactoryId ? calcFactoryBalance(form.toFactoryId, pos, shipments, payments, openingBalances) : null;

  return (
    <Modal title="Chuyển nợ liên nhà máy" onClose={onClose} onSave={() => onSave({ type: "INTER_FACTORY", ...form, amount: amountNum })}
      saveDisabled={!amountNum || form.fromFactoryId === form.toFactoryId}>
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
          <input type="number" step="0.01" value={form.amount} onChange={e => set("amount", e.target.value)} />
        </div>
        <div className="form-group"><label>Tiền tệ</label>
          <select value={form.currency} onChange={e => set("currency", e.target.value)}>
            {["CNY", "USD", "VND"].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Ngày</label>
          <input type="date" value={form.payDate} onChange={e => set("payDate", e.target.value)} />
        </div>
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

const Payments = ({ pos, shipments, payments, factories, openingBalances, markets, settings, onAdd, onDelete, user }) => {
  const marketNames = getMarketNames(markets);
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState({ type: "", factory: "" });
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const canCreate = can(user, "create_payment");
  const canDelete = can(user, "delete_payment");

  const filtered = useMemo(() => {
    return filterByDateRange(payments, "payDate", dateFrom, dateTo).filter(p =>
      (!filter.type || p.type === filter.type) &&
      (!filter.factory || p.toFactoryId === filter.factory || p.fromFactoryId === filter.factory)
    );
  }, [payments, filter, dateFrom, dateTo]);

  return (
    <div>
      <SectionHeader title="Thanh toán công nợ" subtitle="Quản lý giao dịch thanh toán với nhà máy"
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
        <div style={{ flex: 1, minWidth: 300 }}>
          <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} onReset={() => { setDateFrom(""); setDateTo(""); }} />
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead><tr><th>Mã</th><th>Loại</th><th>Nguồn</th><th>Đích</th><th>Số tiền</th><th>Ngày</th><th>Ghi chú</th>{canDelete && <th></th>}</tr></thead>
          <tbody>
            {filtered.slice().reverse().map(p => {
              const fromF = p.fromFactoryId ? factories.find(f => f.id === p.fromFactoryId) : null;
              const toF = p.toFactoryId ? factories.find(f => f.id === p.toFactoryId) : null;
              return (
                <tr key={p.id}>
                  <td style={{ color: C.green600, fontWeight: 600 }}>{p.id}</td>
                  <td><Badge label={PAYMENT_TYPES[p.type]} color={p.type === "MARKET_TO_FACTORY" ? C.blue : C.purple} /></td>
                  <td style={{ fontSize: 12 }}>{p.type === "MARKET_TO_FACTORY" ? <Badge label={p.fromMarket} color={C.green500} /> : fromF?.name}</td>
                  <td style={{ fontSize: 12 }}>{toF?.name}</td>
                  <td>
                    <div style={{ color: C.green600, fontWeight: 700 }}>{fmt(p.amount, p.currency)}</div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(toVND(p.amount, p.currency, settings), "VND")}</div>
                  </td>
                  <td style={{ fontSize: 12 }}>{fmtDate(p.payDate)}</td>
                  <td style={{ fontSize: 12, color: C.textMuted }}>{p.note || "-"}</td>
                  {canDelete && <td><button className="btn btn-danger" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => onDelete("payments", p.id)}>Xóa</button></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {modal?.type === "MARKET_TO_FACTORY" && <PaymentMarketToFactoryForm factories={factories} pos={pos} shipments={shipments} payments={payments} openingBalances={openingBalances} markets={markets} settings={settings}
        onSave={f => { onAdd("payments", { id: `PAY-${uid()}`, ...f }); setModal(null); }} onClose={() => setModal(null)} />}
      {modal?.type === "INTER_FACTORY" && <PaymentInterFactoryForm factories={factories} pos={pos} shipments={shipments} payments={payments} openingBalances={openingBalances}
        onSave={f => { onAdd("payments", { id: `PAY-${uid()}`, ...f }); setModal(null); }} onClose={() => setModal(null)} />}
    </div>
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
          <input type="number" value={form.paymentDays} onChange={e => set("paymentDays", e.target.value)} placeholder="VD: 30" />
        </div>
        <div className="form-group"><label>Thời gian dự kiến SX (ngày)</label>
          <input type="number" value={form.productionDays} onChange={e => set("productionDays", e.target.value)} placeholder="VD: 15" />
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

const Factories = ({ factories, settings, pos, shipments, onAdd, onEdit, onDelete, user }) => {
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const canEdit = can(user, "manage_factories");
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
                {canEdit && (
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: f })}>Sửa</button>
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
          <input type="number" value={form.paymentDays} onChange={e => set("paymentDays", e.target.value)} placeholder="VD: 30" />
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

const Carriers = ({ carriers, shipments, feePayments, settings, onAdd, onEdit, onDelete, user }) => {
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const canEdit = can(user, "manage_carriers");

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
      <SectionHeader title="Đơn vị vận chuyển" subtitle={`${carriers.length} đơn vị · Dùng trong lô giao hàng và thanh toán thuế phí`}
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
                {canEdit && (
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: c })}>Sửa</button>
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

  const filtered = useMemo(() => {
    let items = auditLog.slice().reverse();
    if (dateFrom) items = items.filter(x => x.timestamp.slice(0, 10) >= dateFrom);
    if (dateTo) items = items.filter(x => x.timestamp.slice(0, 10) <= dateTo);
    if (search) items = items.filter(x =>
      (x.userName || "").toLowerCase().includes(search.toLowerCase()) ||
      (x.action || "").toLowerCase().includes(search.toLowerCase()) ||
      (x.target || "").toLowerCase().includes(search.toLowerCase())
    );
    return items;
  }, [auditLog, dateFrom, dateTo, search]);

  const actionColor = (action) => {
    if (action.startsWith("create")) return C.green500;
    if (action.startsWith("update") || action.startsWith("edit")) return C.blue;
    if (action.startsWith("delete")) return C.red;
    if (action.startsWith("login")) return C.purple;
    return C.textMuted;
  };

  return (
    <div>
      <SectionHeader title="Nhật ký hoạt động" subtitle={`${auditLog.length} lượt hoạt động được ghi nhận`} />
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: "14px 18px", marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input placeholder="🔍 Tìm user, hành động, đối tượng..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 280 }} />
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
            ) : filtered.map(log => (
              <tr key={log.id}>
                <td style={{ fontSize: 12 }}>{fmtDateTime(log.timestamp)}</td>
                <td style={{ fontWeight: 600 }}>{log.userName}</td>
                <td><Badge label={log.action} color={actionColor(log.action)} /></td>
                <td style={{ fontSize: 12, fontFamily: "monospace", color: C.green700 }}>{log.target}</td>
                <td style={{ fontSize: 11, color: C.textMuted, maxWidth: 400, wordBreak: "break-all" }}>{log.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ============================================================
// OPENING BALANCES — Công nợ đầu kỳ
// ============================================================
const OpeningBalanceForm = ({ initial, factories, onSave, onClose }) => {
  const [form, setForm] = useState(initial || {
    factoryId: factories[0]?.id || "", type: "debt", amount: "", currency: "CNY",
    date: new Date().toISOString().slice(0, 10), note: "",
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const isValid = form.factoryId && form.amount && Number(form.amount) > 0;

  return (
    <Modal title={initial ? "Sửa công nợ đầu kỳ" : "Thêm công nợ đầu kỳ"} onClose={onClose} onSave={() => onSave(form)} saveDisabled={!isValid}>
      <div className="form-grid">
        <div className="form-group"><label>Nhà máy *</label>
          <select value={form.factoryId} onChange={e => set("factoryId", e.target.value)}>
            {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Loại *</label>
          <select value={form.type} onChange={e => set("type", e.target.value)}>
            <option value="debt">Nợ gốc (NM đang nợ GoChek / GoChek đang nợ NM)</option>
            <option value="credit">Quỹ tín dụng đầu kỳ (đã ứng trước cho NM)</option>
          </select>
        </div>
        <div className="form-group"><label>Số tiền *</label>
          <input type="number" step="0.01" value={form.amount} onChange={e => set("amount", e.target.value)} />
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
      <div className="alert alert-info">
        <div><b>Nợ gốc:</b> Số công nợ mang sang từ kỳ trước (sẽ cộng vào công nợ phải trả)</div>
        <div><b>Quỹ tín dụng:</b> Số tiền GoChek đã ứng trước hoặc nhà máy còn thiếu (sẽ cộng vào quỹ tín dụng)</div>
      </div>
    </Modal>
  );
};

const OpeningBalances = ({ openingBalances, factories, settings, onAdd, onEdit, onDelete, user }) => {
  const [modal, setModal] = useState(null);
  const [filterFactory, setFilterFactory] = useState("");

  const canManage = can(user, "manage_opening_balance");

  const filtered = filterFactory ? openingBalances.filter(o => o.factoryId === filterFactory) : openingBalances;

  const summary = useMemo(() => {
    const byFactory = {};
    factories.forEach(f => { byFactory[f.id] = { debt: 0, credit: 0, count: 0 }; });
    openingBalances.forEach(o => {
      if (!byFactory[o.factoryId]) return;
      byFactory[o.factoryId].count++;
      if (o.type === "debt") byFactory[o.factoryId].debt += toVND(Number(o.amount), o.currency, settings) / settings.cnyToVnd;
      else byFactory[o.factoryId].credit += toVND(Number(o.amount), o.currency, settings) / settings.cnyToVnd;
    });
    const totalDebt = Object.values(byFactory).reduce((s, b) => s + b.debt, 0);
    const totalCredit = Object.values(byFactory).reduce((s, b) => s + b.credit, 0);
    return { byFactory, totalDebt, totalCredit };
  }, [openingBalances, factories, settings]);

  return (
    <div>
      <SectionHeader title="Công nợ đầu kỳ" subtitle="Setup công nợ & quỹ tín dụng mang sang từ kỳ trước"
        action={canManage && <button className="btn btn-primary" onClick={() => setModal({ type: "new" })}>+ Thêm công nợ đầu kỳ</button>}
      />

      {!canManage && <div className="alert alert-warn" style={{ marginBottom: 16 }}>Chỉ Admin/Kế toán được quản lý công nợ đầu kỳ</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
        <div className="card">
          <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Tổng nợ gốc đầu kỳ</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.red }}>{fmt(summary.totalDebt, "CNY")}</div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>≈ {fmt(toVND(summary.totalDebt, "CNY", settings), "VND")}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Tổng quỹ tín dụng đầu kỳ</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.green600 }}>{fmt(summary.totalCredit, "CNY")}</div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>≈ {fmt(toVND(summary.totalCredit, "CNY", settings), "VND")}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Chênh lệch ròng</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: summary.totalDebt - summary.totalCredit > 0 ? C.red : C.green600 }}>
            {fmt(summary.totalDebt - summary.totalCredit, "CNY")}
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{summary.totalDebt > summary.totalCredit ? "Phải trả nhà máy" : "Nhà máy đang giữ của ta"}</div>
        </div>
      </div>

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: "14px 18px", marginBottom: 16 }}>
        <select style={{ width: 260 }} value={filterFactory} onChange={e => setFilterFactory(e.target.value)}>
          <option value="">Tất cả nhà máy</option>
          {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead><tr><th>Mã</th><th>Nhà máy</th><th>Loại</th><th>Ngày</th><th>Số tiền</th><th>Ghi chú</th>{canManage && <th></th>}</tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={canManage ? 7 : 6} style={{ textAlign: "center", color: C.textMuted, padding: 40 }}>Chưa có công nợ đầu kỳ nào</td></tr>
            ) : filtered.map(o => {
              const f = factories.find(x => x.id === o.factoryId);
              return (
                <tr key={o.id}>
                  <td style={{ color: C.green600, fontWeight: 600 }}>{o.id}</td>
                  <td>{f?.name || "-"}</td>
                  <td><Badge label={o.type === "debt" ? "Nợ gốc" : "Quỹ tín dụng đầu kỳ"} color={o.type === "debt" ? C.red : C.green600} /></td>
                  <td style={{ fontSize: 12 }}>{fmtDate(o.date)}</td>
                  <td>
                    <div style={{ fontWeight: 700, color: o.type === "debt" ? C.red : C.green600 }}>{fmt(o.amount, o.currency)}</div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>≈ {fmt(toVND(o.amount, o.currency, settings), "VND")}</div>
                  </td>
                  <td style={{ fontSize: 12, color: C.textMuted }}>{o.note || "-"}</td>
                  {canManage && (
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setModal({ type: "edit", data: o })}>Sửa</button>
                        <button className="btn btn-danger" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => onDelete("openingBalances", o.id)}>X</button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal?.type === "new" && <OpeningBalanceForm factories={factories} onSave={f => { onAdd("openingBalances", { id: `OB-${uid()}`, ...f }); setModal(null); }} onClose={() => setModal(null)} />}
      {modal?.type === "edit" && <OpeningBalanceForm initial={modal.data} factories={factories} onSave={f => { onEdit("openingBalances", modal.data.id, f); setModal(null); }} onClose={() => setModal(null)} />}
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
        message: `Kho "${wh.name || "(chưa đặt tên)"}" đang được gắn với ${usedCount} lô giao hàng.\n\nĐể xóa, trước tiên hãy đổi kho hoặc xóa các lô giao hàng liên quan.`,
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
              {form.warehouses.length} kho · Dùng khi tạo lô giao hàng
              {form.warehouses.length > 1 && <span style={{ marginLeft: 6 }}> · ⭐ = kho mặc định (tự chọn khi tạo lô giao hàng)</span>}
            </div>
          </div>
          <button type="button" className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={addWarehouse}>+ Thêm kho</button>
        </div>
        {form.warehouses.length === 0 && <div style={{ fontSize: 12, color: C.textMuted, padding: 10, textAlign: "center" }}>Chưa có kho nào. Mỗi thị trường nên có ít nhất 1 kho.</div>}
        {form.warehouses.map((w, idx) => {
          const usedCount = countShipmentsUsingWarehouse(w.id, shipments);
          const isOnlyOne = form.warehouses.length === 1;
          return (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "32px 1fr 1fr 1fr 40px", gap: 8, marginBottom: 8, padding: 10, background: C.white, borderRadius: 10, alignItems: "center", border: w.isDefault ? `1.5px solid ${C.green400}` : `1px solid ${C.borderLight}` }}>
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
                    📦 {usedCount} lô giao hàng đang dùng kho này
                  </div>
                )}
              </div>
              <input value={w.address} onChange={e => updateWarehouse(idx, "address", e.target.value)} placeholder="Địa chỉ" />
              <input value={w.note} onChange={e => updateWarehouse(idx, "note", e.target.value)} placeholder="Ghi chú" />
              <button type="button" className="btn btn-danger" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => removeWarehouse(idx)} title={usedCount > 0 ? `Không thể xóa — ${usedCount} lô đang dùng` : "Xóa kho"}>✕</button>
            </div>
          );
        })}
      </div>

      <div className="alert alert-info" style={{ marginTop: 10 }}>
        <b>Lưu ý:</b> Tên thị trường được dùng trong các lô giao hàng và công nợ. Nếu sửa tên, các dữ liệu cũ liên kết với tên cũ sẽ không tự động cập nhật.
      </div>
      {/* v11.2: Confirm dialog xóa kho */}
      {confirmDlg && <ConfirmDialog {...confirmDlg} onClose={() => setConfirmDlg(null)} />}
    </Modal>
  );
};

const Markets = ({ markets, shipments, payments, onAdd, onEdit, onDelete, user }) => {
  const [modal, setModal] = useState(null);
  const canManage = can(user, "manage_markets");

  const marketStats = useMemo(() => markets.map(m => {
    const ships = shipments.filter(s => s.market === m.name && s.status !== "Hủy").length;
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
          alert(`Thị trường "${trimmed.name}" đã tồn tại.`);
          return;
        }
        onAdd("markets", { id: `m_${uid()}`, ...trimmed });
        setModal(null);
      }} onClose={() => setModal(null)} />}
      {modal?.type === "edit" && <MarketForm initial={modal.data} shipments={shipments} onSave={f => {
        const trimmed = { ...f, name: f.name.trim(), code: (f.code || "").trim() };
        if (markets.some(m => m.id !== modal.data.id && m.name.toLowerCase() === trimmed.name.toLowerCase())) {
          alert(`Thị trường "${trimmed.name}" đã tồn tại.`);
          return;
        }
        onEdit("markets", modal.data.id, trimmed);
        setModal(null);
      }} onClose={() => setModal(null)} />}
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
              <input type="number" value={form[key]} onChange={e => setNum(key, e.target.value)} disabled={!canEdit} />
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
const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "📊", perm: "view_dashboard" },
  { id: "products", label: "Sản phẩm", icon: "📦", perm: null },
  { id: "pos", label: "Đơn đặt hàng", icon: "📋", perm: null },
  { id: "shipments", label: "Giao hàng", icon: "🚚", perm: null },
  { id: "fees", label: "Thuế phí nhập khẩu", icon: "💵", perm: null },
  { id: "debts", label: "Công nợ NCC", icon: "💰", perm: null },
  { id: "market_debts", label: "Công nợ thị trường", icon: "🌐", perm: "view_market_debt" },
  { id: "opening_balance", label: "Công nợ đầu kỳ", icon: "📋", perm: "manage_opening_balance" },
  { id: "payments", label: "Thanh toán NCC", icon: "💸", perm: null },
  { id: "factories", label: "Nhà cung cấp", icon: "🏭", perm: null },
  { id: "carriers", label: "Đơn vị VC", icon: "🚛", perm: null },
  { id: "markets", label: "Thị trường & Kho", icon: "🌍", perm: null },
  { id: "users", label: "Tài khoản", icon: "👥", perm: "manage_users" },
  { id: "audit", label: "Nhật ký", icon: "📜", perm: "view_audit_log" },
  { id: "settings", label: "Cấu hình", icon: "⚙️", perm: "manage_settings" },
];

export default function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [data, setData] = useState({
    factories: [], products: [], pos: [], shipments: [], payments: [], users: SEED_USERS, auditLog: [],
    openingBalances: [], feePayments: [], markets: [], carriers: [], settings: DEFAULT_SETTINGS,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      // v12: Load từ S3 (qua s3Storage.js)
      let saved = await loadAll();

      if (saved) {
        // Migration: markets warehouses
        if (!saved.markets || saved.markets.length === 0) saved.markets = SEED_MARKETS;
        saved.markets = saved.markets.map(m => {
          let warehouses;
          if (Array.isArray(m.warehouses) && m.warehouses.length > 0) {
            warehouses = m.warehouses;
          } else {
            const seedM = SEED_MARKETS.find(x => x.name === m.name);
            warehouses = seedM?.warehouses || [{ id: `wh_${m.id || uid()}_main`, name: `Kho ${m.name}`, address: "", note: "" }];
          }
          warehouses = warehouses.map(w => ({ ...w, isDefault: !!w.isDefault }));
          const hasDefault = warehouses.some(w => w.isDefault);
          if (!hasDefault && warehouses.length > 0) {
            warehouses = warehouses.map((w, i) => ({ ...w, isDefault: i === 0 }));
          } else {
            let firstFound = false;
            warehouses = warehouses.map(w => {
              if (w.isDefault && !firstFound) { firstFound = true; return w; }
              if (w.isDefault) return { ...w, isDefault: false };
              return w;
            });
          }
          return { ...m, warehouses };
        });
        // Migrate factories
        saved.factories = (saved.factories || []).map((f, i) => ({
          supplierCode: f.supplierCode || `NCC-${String(i + 1).padStart(3, "0")}`,
          address: f.address || "", paymentDays: f.paymentDays ?? 30, productionDays: f.productionDays ?? 15,
          bankInfo: f.bankInfo || "", status: f.status || "active", note: f.note || "",
          ...f, contactPerson: f.contactPerson || f.contact || "",
        }));
        // Migrate products
        saved.products = (saved.products || []).map(p => ({
          nameImport: p.nameImport || p.name || "", category: p.category || "", imageUrl: p.imageUrl || "",
          lengthCm: p.lengthCm ?? "", widthCm: p.widthCm ?? "", heightCm: p.heightCm ?? "", qtyPerCarton: p.qtyPerCarton ?? "",
          ...p,
        }));
        // Migrate carriers
        if (!saved.carriers || saved.carriers.length === 0) {
          const carrierMap = new Map();
          (saved.shipments || []).forEach(s => {
            const name = (s.carrier || "").trim();
            if (!name || carrierMap.has(name.toLowerCase())) return;
            const nextNum = carrierMap.size + 1;
            carrierMap.set(name.toLowerCase(), {
              id: `car_${uid().toLowerCase()}`, code: `VC-${String(nextNum).padStart(3, "0")}`, name, type: "Khác",
              contactPerson: "", phone: "", email: "", address: "", paymentDays: 30, bankInfo: "", status: "active",
              note: "Tự động tạo từ lịch sử giao hàng",
            });
          });
          saved.carriers = Array.from(carrierMap.values());
          if (saved.carriers.length === 0) saved.carriers = SEED_CARRIERS;
        }
        // Migrate shipments
        saved.shipments = (saved.shipments || []).map(s => {
          let carrierId = s.carrierId || "";
          if (!carrierId && s.carrier) {
            const c = (saved.carriers || []).find(x => x.name.toLowerCase() === String(s.carrier).toLowerCase());
            if (c) carrierId = c.id;
          }
          return {
            packages: s.packages || "", warehouseId: s.warehouseId || "", ...s, carrierId,
            status: s.status === "Đang vận chuyển" ? "Đang vận chuyển TQ" : s.status,
            fees: (s.fees || []).map(f => ({ carrierId: f.carrierId || "", ...f })),
          };
        });
        // Migrate settings
        saved.settings = {
          ...DEFAULT_SETTINGS, ...saved.settings,
          productCategories: saved.settings?.productCategories || DEFAULT_SETTINGS.productCategories,
          supplierStatuses: saved.settings?.supplierStatuses || DEFAULT_SETTINGS.supplierStatuses,
        };

        setData(d => ({ ...d, ...saved }));
        await saveAll(saved);
      } else {
        const init = {
          factories: SEED_FACTORIES, products: SEED_PRODUCTS, pos: SEED_POS,
          shipments: SEED_SHIPMENTS, payments: SEED_PAYMENTS, users: SEED_USERS,
          auditLog: SEED_AUDIT_LOG, openingBalances: SEED_OPENING_BALANCES,
          feePayments: SEED_FEE_PAYMENTS, markets: SEED_MARKETS,
          carriers: SEED_CARRIERS, settings: DEFAULT_SETTINGS,
        };
        setData(init);
        await saveAll(init);
      }
      setLoaded(true);
    })();
  }, []);

  // save helper — gọi s3Storage.saveAll
  const save = useCallback(async (next) => { setData(next); await saveAll(next); }, []);

  // Flush data lên S3 khi đóng tab / refresh
  useEffect(() => {
    const handleBeforeUnload = () => { s3Flush(data); };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [data]);

  const addAuditLog = (action, target, detail = {}) => {
    const log = logAudit(action, target, user, detail);
    return [...data.auditLog, log];
  };

  const actionLabel = (key) => {
    if (key === "openingBalances") return "opening_balance";
    if (key === "feePayments") return "fee_payment";
    return key.slice(0, -1);
  };

  const entityLabels = {
    products: "sản phẩm",
    pos: "đơn đặt hàng",
    shipments: "lô giao hàng",
    payments: "giao dịch thanh toán",
    factories: "nhà cung cấp",
    markets: "thị trường",
    carriers: "đơn vị vận chuyển",
    users: "tài khoản",
    openingBalances: "công nợ đầu kỳ",
    feePayments: "thanh toán phí",
  };

  const onAdd = async (key, item) => {
    const newLog = addAuditLog(`create_${actionLabel(key)}`, item.id || item.username, item);
    const next = await addItem(data, key, item, newLog);
    setData(next);
  };
  const onEdit = async (key, id, updates) => {
    const newLog = addAuditLog(`update_${actionLabel(key)}`, id, updates);
    const next = await editItem(data, key, id, updates, newLog);
    setData(next);
  };
  const onDelete = (key, id) => {
    const entity = data[key].find(x => x.id === id);
    const label = entityLabels[key] || "mục này";
    const name = entity?.name || entity?.sku || entity?.username || entity?.id || id;
    setConfirmDialog({
      title: `Xóa ${label}?`,
      message: `Bạn có chắc chắn muốn xóa ${label} "${name}"?\n\nDữ liệu sẽ được ẩn khỏi giao diện nhưng vẫn lưu trên hệ thống.`,
      confirmLabel: "Xóa",
      danger: true,
      onConfirm: async () => {
        const newLog = addAuditLog(`delete_${actionLabel(key)}`, id);
        const deletedBy = user?.id || user?.username || "unknown";
        const next = await softDeleteItem(data, key, id, deletedBy, newLog);
        setData(next);
      },
    });
  };
  const onSaveSettings = async (newSettings) => {
    const newLog = addAuditLog("update_settings", "settings", newSettings);
    const next = await saveSettings(data, newSettings, newLog);
    setData(next);
  };

  const onCreateWarehouse = async (marketName, newWh) => {
    const updatedMarkets = data.markets.map(m => {
      if (m.name !== marketName) return m;
      const existingWhs = m.warehouses || [];
      const shouldBeDefault = existingWhs.length === 0 || !existingWhs.some(w => w.isDefault);
      const whToAdd = { ...newWh, isDefault: newWh.isDefault ?? shouldBeDefault };
      return { ...m, warehouses: [...existingWhs, whToAdd] };
    });
    const newLog = addAuditLog("create_warehouse", `${marketName}:${newWh.name}`, newWh);
    const next = await saveMarkets(data, updatedMarkets, newLog);
    setData(next);
  };

  const handleLogin = async (loggedUser) => {
    const log = logAudit("login", loggedUser.username, user || loggedUser);
    const next = { ...data, auditLog: [...data.auditLog, log] };
    setData(next);
    await saveAll(next);
    setUser(loggedUser);
  };

  const handleLogout = async () => {
    if (user) {
      const log = logAudit("logout", user.username, user);
      const next = { ...data, auditLog: [...data.auditLog, log] };
      setData(next);
      await saveAll(next);
    }
    setUser(null);
  };

  if (!loaded) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, color: C.textMuted }}>Đang tải...</div>;
  if (!user) return <><style>{css}</style><LoginScreen onLogin={handleLogin} users={data.users} /></>;

  // Filter soft-deleted items cho tất cả views (alive() từ s3Storage.js)
  const view = useMemo(() => ({
    factories: alive(data.factories),
    products: alive(data.products),
    pos: alive(data.pos),
    shipments: alive(data.shipments),
    payments: alive(data.payments),
    users: alive(data.users),
    openingBalances: alive(data.openingBalances),
    feePayments: alive(data.feePayments),
    markets: alive(data.markets),
    carriers: alive(data.carriers),
    auditLog: data.auditLog || [],
    settings: data.settings,
  }), [data]);

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
                {user.fullName.charAt(0)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "white", fontWeight: 600 }}>{user.fullName}</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>{ROLE_LABELS[user.role]}</div>
              </div>
            </div>
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
                💱 1 CNY = <b>{view.settings.cnyToVnd.toLocaleString("vi-VN")}</b> VND
              </div>
              <div style={{ fontSize: 12, color: C.textMuted }}>
                {new Date().toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              </div>
            </div>
          </div>

          <div style={{ padding: 28, flex: 1 }}>
            {tab === "dashboard" && <Dashboard pos={view.pos} shipments={view.shipments} payments={view.payments} factories={view.factories} products={view.products} openingBalances={view.openingBalances} markets={view.markets} carriers={view.carriers} feePayments={view.feePayments} settings={view.settings} onNavigate={setTab} />}
            {tab === "products" && <Products products={view.products} pos={view.pos} shipments={view.shipments} factories={view.factories} settings={view.settings} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} onSaveSettings={onSaveSettings} user={user} />}
            {tab === "pos" && <POs pos={view.pos} factories={view.factories} products={view.products} shipments={view.shipments} settings={view.settings} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} onConfirm={setConfirmDialog} user={user} />}
            {tab === "shipments" && <Shipments shipments={view.shipments} pos={view.pos} factories={view.factories} products={view.products} feePayments={view.feePayments} markets={view.markets} carriers={view.carriers} settings={view.settings} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} onCreateWarehouse={onCreateWarehouse} user={user} />}
            {tab === "fees" && <ImportFees shipments={view.shipments} feePayments={view.feePayments} markets={view.markets} carriers={view.carriers} settings={view.settings} onAdd={onAdd} onDelete={onDelete} user={user} />}
            {tab === "debts" && <Debts pos={view.pos} shipments={view.shipments} payments={view.payments} factories={view.factories} openingBalances={view.openingBalances} settings={view.settings} feePayments={view.feePayments} products={view.products} carriers={view.carriers} markets={view.markets} user={user} />}
            {tab === "market_debts" && <MarketDebts pos={view.pos} shipments={view.shipments} payments={view.payments} factories={view.factories} markets={view.markets} settings={view.settings} />}
            {tab === "opening_balance" && <OpeningBalances openingBalances={view.openingBalances} factories={view.factories} settings={view.settings} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} user={user} />}
            {tab === "payments" && <Payments pos={view.pos} shipments={view.shipments} payments={view.payments} factories={view.factories} openingBalances={view.openingBalances} markets={view.markets} settings={view.settings} onAdd={onAdd} onDelete={onDelete} user={user} />}
            {tab === "factories" && <Factories factories={view.factories} settings={view.settings} pos={view.pos} shipments={view.shipments} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} user={user} />}
            {tab === "carriers" && <Carriers carriers={view.carriers} shipments={view.shipments} feePayments={view.feePayments} settings={view.settings} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} user={user} />}
            {tab === "markets" && <Markets markets={view.markets} shipments={view.shipments} payments={view.payments} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} user={user} />}
            {tab === "users" && <Users users={view.users} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} user={user} />}
            {tab === "audit" && <AuditLog auditLog={view.auditLog} />}
            {tab === "settings" && <Settings settings={view.settings} onSave={onSaveSettings} user={user} />}
          </div>
        </div>
      </div>
      {confirmDialog && <ConfirmDialog {...confirmDialog} onClose={() => setConfirmDialog(null)} />}
    </>
  );
}
