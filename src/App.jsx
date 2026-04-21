import React, { useState, useMemo } from "react";
import {
  Package, ShoppingCart, Truck, Warehouse, Coins, BarChart3,
  Plus, ChevronRight, AlertTriangle, CheckCircle2, Clock,
  Search, Filter, TrendingUp, X, Download,
  FileText, Activity, Plane, Edit2, Ban, Menu, PanelLeftClose, PanelLeftOpen
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";

// ====== SEED DATA ======
const SEED_SUPPLIERS = [
  { id: "S001", name: "Shenzhen Acme Electronics", name_cn: "深圳顶峰电子有限公司", country: "CN", currency: "CNY", terms: 30,
    contact_name: "Mr. Wang Wei", email: "wangwei@sz-acme.com", wechat: "wangwei88", phone: "+86 755 1234 5678",
    factory_address: "No. 123, Baoan Industrial Park, Shenzhen, Guangdong, China",
    status: "active" },
  { id: "S002", name: "Guangzhou Textile Co.", name_cn: "广州纺织有限公司", country: "CN", currency: "CNY", terms: 45,
    contact_name: "Ms. Li Xiaoling", email: "lixl@gz-textile.cn", wechat: "lixiaoling2020", phone: "+86 20 8765 4321",
    factory_address: "Building A, Panyu District, Guangzhou, Guangdong, China",
    status: "active" },
  { id: "S003", name: "Dongguan Precision Ltd.", name_cn: "东莞精密制造有限公司", country: "CN", currency: "CNY", terms: 30,
    contact_name: "Mr. Chen Jian", email: "chenjian@dg-precision.com", wechat: "chenjian_dg", phone: "+86 769 2233 4455",
    factory_address: "Block 5, Changan Industrial Zone, Dongguan, Guangdong, China",
    status: "active" },
];

const SEED_SKUS = [
  { id: "SKU-001", name: "Tai nghe Bluetooth X1", name_en: "Bluetooth Headphones X1", name_cn: "蓝牙耳机 X1", unit: "cái", price_cny: 85, status: "active", image_url: "", weight_g: 250 },
  { id: "SKU-002", name: "Sạc dự phòng 20000mAh", name_en: "Power Bank 20000mAh", name_cn: "移动电源 20000mAh", unit: "cái", price_cny: 120, status: "active", image_url: "", weight_g: 450 },
  { id: "SKU-003", name: "Cáp USB-C 2m", name_en: "USB-C Cable 2m", name_cn: "USB-C 数据线 2米", unit: "cái", price_cny: 15, status: "active", image_url: "", weight_g: 60 },
  { id: "SKU-004", name: "Ốp lưng silicone iPhone 15", name_en: "iPhone 15 Silicone Case", name_cn: "iPhone 15 硅胶手机壳", unit: "cái", price_cny: 25, status: "active", image_url: "", weight_g: 40 },
  { id: "SKU-005", name: "Giá đỡ điện thoại", name_en: "Phone Stand", name_cn: "手机支架", unit: "cái", price_cny: 45, status: "active", image_url: "", weight_g: 180 },
];

const SEED_WAREHOUSES = [
  { id: "W-CN", code: "CN-HUB", country: "Trung Quốc", flag: "🇨🇳", type: "transit", currency: "CNY" },
  { id: "W-VN", code: "VN-HCM", country: "Việt Nam", flag: "🇻🇳", type: "destination", currency: "VND", vat: 0.08, freightRate: 2.5 },
  { id: "W-TH", code: "TH-BKK", country: "Thái Lan", flag: "🇹🇭", type: "destination", currency: "THB", vat: 0.07, freightRate: 3.0 },
  { id: "W-MY", code: "MY-KUL", country: "Malaysia", flag: "🇲🇾", type: "destination", currency: "MYR", vat: 0.06, freightRate: 3.5 },
  { id: "W-PH", code: "PH-MNL", country: "Philippines", flag: "🇵🇭", type: "destination", currency: "PHP", vat: 0.12, freightRate: 4.0 },
];

const SEED_POS = [
  { id: "PO-2026-001", supplier_id: "S001", po_date: "2026-02-15", status: "received", currency: "CNY",
    lines: [
      { id: "POL-001-1", sku_id: "SKU-001", qty: 1000, price: 85, delivered: 1000 },
      { id: "POL-001-2", sku_id: "SKU-003", qty: 2000, price: 15, delivered: 2000 },
    ] },
  { id: "PO-2026-002", supplier_id: "S001", po_date: "2026-03-10", status: "partial_delivered", currency: "CNY",
    lines: [
      { id: "POL-002-1", sku_id: "SKU-002", qty: 500, price: 120, delivered: 300 },
    ] },
  { id: "PO-2026-003", supplier_id: "S002", po_date: "2026-03-20", status: "shipping", currency: "CNY",
    lines: [
      { id: "POL-003-1", sku_id: "SKU-004", qty: 3000, price: 25, delivered: 500 },
      { id: "POL-003-2", sku_id: "SKU-005", qty: 800, price: 45, delivered: 0 },
    ] },
  { id: "PO-2026-004", supplier_id: "S003", po_date: "2026-04-05", status: "confirmed", currency: "CNY",
    lines: [
      { id: "POL-004-1", sku_id: "SKU-001", qty: 500, price: 85, delivered: 0 },
    ] },
];

const SEED_DELIVERIES = [
  { id: "DEL-001", destination_id: "W-VN", shipped_date: "2026-02-25", arrived_date: "2026-03-10",
    tracking: "SFC-VN-20260225", status: "arrived",
    lines: [
      { po_line_id: "POL-001-1", sku_id: "SKU-001", qty: 400, unit_price: 85 },
      { po_line_id: "POL-001-2", sku_id: "SKU-003", qty: 800, unit_price: 15 },
    ] },
  { id: "DEL-002", destination_id: "W-TH", shipped_date: "2026-02-28", arrived_date: "2026-03-18",
    tracking: "SFC-TH-20260228", status: "arrived",
    lines: [
      { po_line_id: "POL-001-1", sku_id: "SKU-001", qty: 250, unit_price: 85 },
      { po_line_id: "POL-001-2", sku_id: "SKU-003", qty: 500, unit_price: 15 },
    ] },
  { id: "DEL-003", destination_id: "W-MY", shipped_date: "2026-03-02", arrived_date: "2026-03-22",
    tracking: "SFC-MY-20260302", status: "arrived",
    lines: [
      { po_line_id: "POL-001-1", sku_id: "SKU-001", qty: 200, unit_price: 85 },
      { po_line_id: "POL-001-2", sku_id: "SKU-003", qty: 400, unit_price: 15 },
    ] },
  { id: "DEL-004", destination_id: "W-PH", shipped_date: "2026-03-05", arrived_date: "2026-03-28",
    tracking: "SFC-PH-20260305", status: "arrived",
    lines: [
      { po_line_id: "POL-001-1", sku_id: "SKU-001", qty: 150, unit_price: 85 },
      { po_line_id: "POL-001-2", sku_id: "SKU-003", qty: 300, unit_price: 15 },
    ] },
  { id: "DEL-005", destination_id: "W-VN", shipped_date: "2026-03-18", arrived_date: "2026-04-02",
    tracking: "SFC-VN-20260318", status: "arrived",
    lines: [
      { po_line_id: "POL-002-1", sku_id: "SKU-002", qty: 300, unit_price: 120 },
    ] },
  { id: "DEL-006", destination_id: "W-TH", shipped_date: "2026-04-10", arrived_date: null,
    tracking: "SFC-TH-20260410", status: "in_transit",
    lines: [
      { po_line_id: "POL-003-1", sku_id: "SKU-004", qty: 500, unit_price: 25 },
    ] },
];

function buildLots(deliveries) {
  const lots = [];
  deliveries.filter(d => d.status === "arrived").forEach(del => {
    del.lines.forEach((line, idx) => {
      lots.push({
        id: `LOT-${del.id.replace("DEL-", "")}-${idx+1}`,
        delivery_id: del.id,
        warehouse_id: del.destination_id,
        sku_id: line.sku_id,
        po_line_id: line.po_line_id,
        qty: line.qty,
        base_cost_cny: line.unit_price,
        shipped_date: del.shipped_date,
        arrived_date: del.arrived_date,
        freight_cny: Math.round(line.qty * line.unit_price * 0.05),
      });
    });
  });
  return lots;
}

function buildInventory(lots) {
  const committedMap = {
    "LOT-001-1": 120, "LOT-001-2": 250,
    "LOT-002-1": 80, "LOT-002-2": 150,
    "LOT-003-1": 60, "LOT-003-2": 100,
    "LOT-004-1": 40, "LOT-004-2": 80,
    "LOT-005-1": 0,
  };
  return lots.map(l => ({
    warehouse_id: l.warehouse_id,
    sku_id: l.sku_id,
    lot_id: l.id,
    qty: l.qty,
    committed: committedMap[l.id] || 0,
  }));
}

const SEED_PAYMENTS = [
  { id: "PAY-001", supplier_id: "S001", date: "2026-03-20", amount_cny: 85000, rate: 3520, applied_po: ["PO-2026-001"] },
  { id: "PAY-002", supplier_id: "S001", date: "2026-04-05", amount_cny: 30000, rate: 3540, applied_po: ["PO-2026-001"] },
  { id: "PAY-003", supplier_id: "S001", date: "2026-04-18", amount_cny: 20000, rate: 3550, applied_po: ["PO-2026-002"] },
];

const CNY_VND_RATE = 3550;

const formatCNY = (n) => `¥${Math.round(n).toLocaleString()}`;
const formatVND = (n) => `₫${Math.round(n).toLocaleString()}`;
// SKUs có thể được cập nhật runtime. Helper đọc từ mảng gốc nên mọi sửa đổi phản ánh ngay.
const getSKU = (id) => SEED_SKUS.find(s => s.id === id);
const getSupplier = (id) => SEED_SUPPLIERS.find(s => s.id === id);
const getWarehouse = (id) => SEED_WAREHOUSES.find(w => w.id === id);
const getLot = (id, lots) => lots.find(l => l.id === id);
const getPOByLineId = (polId, pos) => pos.find(po => po.lines.some(l => l.id === polId));

export default function App() {
  const [activeView, setActiveView] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pos, setPos] = useState(SEED_POS);
  const [deliveries, setDeliveries] = useState(SEED_DELIVERIES);
  const [payments, setPayments] = useState(SEED_PAYMENTS);
  const [skus, setSkus] = useState(SEED_SKUS);
  const [suppliers, setSuppliers] = useState(SEED_SUPPLIERS);
  const [modal, setModal] = useState(null);

  const lots = useMemo(() => buildLots(deliveries), [deliveries]);
  const inventory = useMemo(() => buildInventory(lots), [lots]);

  const supplierDebts = useMemo(() => {
    const debts = {};
    suppliers.forEach(s => {
      debts[s.id] = { committed: 0, shipped: 0, paid: 0 };
    });
    // Tổng giá trị PO (cam kết ban đầu) và đã ship (thực tế)
    pos.forEach(po => {
      po.lines.forEach(line => {
        const totalLine = line.qty * line.price;
        const shippedLine = line.delivered * line.price;
        if (!debts[po.supplier_id]) return; // phòng PO trỏ tới NCC đã bị xóa
        // Cam kết = phần CHƯA ship của PO (cam kết còn lại)
        debts[po.supplier_id].committed += (totalLine - shippedLine);
        // Thực tế = phần đã ship (đã phát sinh nghĩa vụ trả)
        debts[po.supplier_id].shipped += shippedLine;
      });
    });
    payments.forEach(p => {
      if (!debts[p.supplier_id]) return;
      debts[p.supplier_id].paid += p.amount_cny;
    });
    return debts;
  }, [pos, payments, suppliers]);

  // Tổng hợp 2 loại công nợ
  const totalCommitted = Object.values(supplierDebts).reduce((s, d) => s + d.committed, 0);
  const totalActual = Object.values(supplierDebts).reduce((s, d) => s + (d.shipped - d.paid), 0);
  const inTransitCount = deliveries.filter(d => d.status === "in_transit").length;

  const handleCreateDelivery = (newDelivery) => {
    // Cập nhật po.lines[].delivered
    const updatedPos = pos.map(po => ({
      ...po,
      lines: po.lines.map(line => {
        const added = newDelivery.lines
          .filter(dl => dl.po_line_id === line.id)
          .reduce((s, dl) => s + dl.qty, 0);
        return added > 0 ? { ...line, delivered: line.delivered + added } : line;
      }),
    }));
    // Tự động cập nhật trạng thái PO
    const finalPos = updatedPos.map(po => {
      const totalQty = po.lines.reduce((s, l) => s + l.qty, 0);
      const delQty = po.lines.reduce((s, l) => s + l.delivered, 0);
      let newStatus = po.status;
      if (delQty === 0) newStatus = po.status === "draft" ? "draft" : "confirmed";
      else if (delQty < totalQty) newStatus = "partial_delivered";
      else if (delQty === totalQty) newStatus = "received";
      return { ...po, status: newStatus };
    });
    setPos(finalPos);
    setDeliveries([...deliveries, newDelivery]);
    setModal(null);
  };

  const handleMarkArrived = (deliveryId) => {
    const today = "2026-04-20"; // ngày hiện tại của app
    setDeliveries(prev => prev.map(d =>
      d.id === deliveryId
        ? { ...d, status: "arrived", arrived_date: today }
        : d
    ));
  };

  const handleUpdateTracking = (deliveryId, newTracking) => {
    setDeliveries(prev => prev.map(d =>
      d.id === deliveryId
        ? { ...d, tracking: newTracking }
        : d
    ));
  };

  const handleCreatePayment = (newPayment) => {
    setPayments(prev => [...prev, newPayment]);
    setModal(null);
  };

  const handleCreatePO = (newPO) => {
    setPos(prev => [...prev, newPO]);
    setModal(null);
  };

  // SKU CRUD - đồng bộ cả state (trigger rerender) và SEED_SKUS (để helper global đọc)
  const handleCreateSKU = (newSKU) => {
    SEED_SKUS.push(newSKU);
    setSkus([...SEED_SKUS]);
    setModal(null);
  };

  const handleUpdateSKU = (updated) => {
    const { oldId, ...skuPayload } = updated;
    // Nếu đổi mã SKU → cascade update tất cả tham chiếu
    if (oldId && oldId !== skuPayload.id) {
      // Update SEED_SKUS
      const idx = SEED_SKUS.findIndex(s => s.id === oldId);
      if (idx !== -1) SEED_SKUS[idx] = skuPayload;
      setSkus([...SEED_SKUS]);

      // Update tất cả po.lines
      setPos(prev => prev.map(po => ({
        ...po,
        lines: po.lines.map(line => line.sku_id === oldId ? { ...line, sku_id: skuPayload.id } : line),
      })));

      // Update tất cả deliveries.lines
      setDeliveries(prev => prev.map(d => ({
        ...d,
        lines: d.lines.map(line => line.sku_id === oldId ? { ...line, sku_id: skuPayload.id } : line),
      })));
    } else {
      // Không đổi mã, chỉ update info
      const idx = SEED_SKUS.findIndex(s => s.id === skuPayload.id);
      if (idx !== -1) SEED_SKUS[idx] = skuPayload;
      setSkus([...SEED_SKUS]);
    }
    setModal(null);
  };

  const handleToggleSKUStatus = (id) => {
    const idx = SEED_SKUS.findIndex(s => s.id === id);
    if (idx !== -1) {
      SEED_SKUS[idx] = { ...SEED_SKUS[idx], status: SEED_SKUS[idx].status === "active" ? "discontinued" : "active" };
      setSkus([...SEED_SKUS]);
    }
  };

  // Supplier CRUD
  const handleCreateSupplier = (newSupplier) => {
    SEED_SUPPLIERS.push(newSupplier);
    setSuppliers([...SEED_SUPPLIERS]);
    setModal(null);
  };

  const handleUpdateSupplier = (updated) => {
    const idx = SEED_SUPPLIERS.findIndex(s => s.id === updated.id);
    if (idx !== -1) SEED_SUPPLIERS[idx] = updated;
    setSuppliers([...SEED_SUPPLIERS]);
    setModal(null);
  };

  const handleToggleSupplierStatus = (id) => {
    const idx = SEED_SUPPLIERS.findIndex(s => s.id === id);
    if (idx !== -1) {
      SEED_SUPPLIERS[idx] = { ...SEED_SUPPLIERS[idx], status: SEED_SUPPLIERS[idx].status === "active" ? "inactive" : "active" };
      setSuppliers([...SEED_SUPPLIERS]);
    }
  };

  const views = {
    dashboard: <Dashboard pos={pos} deliveries={deliveries} lots={lots} inventory={inventory} supplierDebts={supplierDebts} totalCommitted={totalCommitted} totalActual={totalActual} setModal={setModal} setActiveView={setActiveView} />,
    suppliers: <SuppliersView pos={pos} deliveries={deliveries} supplierDebts={supplierDebts} suppliers={suppliers} setModal={setModal} />,
    deliveries: <DeliveriesView pos={pos} deliveries={deliveries} lots={lots} setModal={setModal} onMarkArrived={handleMarkArrived} onUpdateTracking={handleUpdateTracking} />,
    inventory: <InventoryView inventory={inventory} lots={lots} pos={pos} />,
    products: <ProductsView skus={skus} pos={pos} inventory={inventory} setModal={setModal} onToggleStatus={handleToggleSKUStatus} />,
    suppliers_mgmt: <SuppliersManagementView suppliers={suppliers} pos={pos} supplierDebts={supplierDebts} setModal={setModal} onToggleStatus={handleToggleSupplierStatus} />,
    payments: <PaymentsView payments={payments} supplierDebts={supplierDebts} suppliers={suppliers} totalCommitted={totalCommitted} totalActual={totalActual} setModal={setModal} />,
  };

  return (
    <div style={{ fontFamily: "'Fraunces', Georgia, serif" }} className="min-h-screen bg-[#f5f2eb] text-[#1a2332]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600;9..144,700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        * { font-feature-settings: "ss01", "ss02"; }
        .mono { font-family: 'JetBrains Mono', monospace; font-feature-settings: normal; }
        .glow-hover { transition: all 0.2s ease; }
        .glow-hover:hover { box-shadow: 0 4px 20px rgba(26, 35, 50, 0.08); }
        @keyframes slideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .animate-in { animation: slideIn 0.3s ease-out; }
      `}</style>

      <div className="flex min-h-screen">
        <aside className={`${sidebarCollapsed ? "w-16" : "w-64"} bg-[#1a2332] text-[#f5f2eb] flex flex-col transition-all duration-200`}>
          <div className={`${sidebarCollapsed ? "px-3 py-4" : "px-6 py-8"} border-b border-[#2a3547] flex items-center justify-between`}>
            {!sidebarCollapsed && (
              <div className="flex-1 min-w-0">
                <div className="text-xs uppercase tracking-[0.2em] text-[#c4a962] mono truncate">Supply Chain</div>
                <div className="text-2xl mt-1 font-medium">Meridian</div>
                <div className="text-xs text-[#8a96a8] mt-1">Prototype v0.2</div>
              </div>
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className={`${sidebarCollapsed ? "mx-auto" : "ml-2"} p-2 text-[#8a96a8] hover:text-[#c4a962] hover:bg-[#2a3547] transition-colors`}
              title={sidebarCollapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
          </div>

          <nav className="flex-1 py-6">
            <NavItem icon={BarChart3} label="Tổng quan" badge={null} active={activeView === "dashboard"} collapsed={sidebarCollapsed} onClick={() => setActiveView("dashboard")} />
            <NavItem icon={ShoppingCart} label="Đơn đặt hàng" badge={pos.filter(p => p.status !== "received" && p.status !== "closed").length} active={activeView === "suppliers"} collapsed={sidebarCollapsed} onClick={() => setActiveView("suppliers")} />
            <NavItem icon={Truck} label="Giao hàng" badge={inTransitCount || null} active={activeView === "deliveries"} collapsed={sidebarCollapsed} onClick={() => setActiveView("deliveries")} />
            <NavItem icon={Warehouse} label="Tồn kho" badge={null} active={activeView === "inventory"} collapsed={sidebarCollapsed} onClick={() => setActiveView("inventory")} />
            <NavItem icon={Package} label="Sản phẩm" badge={null} active={activeView === "products"} collapsed={sidebarCollapsed} onClick={() => setActiveView("products")} />
            <NavItem icon={FileText} label="Nhà cung cấp" badge={null} active={activeView === "suppliers_mgmt"} collapsed={sidebarCollapsed} onClick={() => setActiveView("suppliers_mgmt")} />
            <NavItem icon={Coins} label="Công nợ" badge={null} active={activeView === "payments"} collapsed={sidebarCollapsed} onClick={() => setActiveView("payments")} />
          </nav>

          {!sidebarCollapsed && (
            <div className="px-6 py-4 border-t border-[#2a3547] text-xs text-[#8a96a8]">
              <div className="mono">Tỷ giá: 1 CNY = {CNY_VND_RATE} VND</div>
              <div className="mt-1">Cập nhật: hôm nay</div>
            </div>
          )}
        </aside>

        <main className="flex-1 overflow-y-auto">
          {views[activeView]}
        </main>
      </div>

      {modal && <Modal {...modal} pos={pos} deliveries={deliveries} payments={payments} supplierDebts={supplierDebts} skus={skus} suppliers={suppliers} onClose={() => setModal(null)} onCreateDelivery={handleCreateDelivery} onCreatePayment={handleCreatePayment} onCreatePO={handleCreatePO} onCreateSKU={handleCreateSKU} onUpdateSKU={handleUpdateSKU} onCreateSupplier={handleCreateSupplier} onUpdateSupplier={handleUpdateSupplier} />}
    </div>
  );
}

function NavItem({ icon: Icon, label, badge, active, collapsed, onClick }) {
  if (collapsed) {
    return (
      <button
        onClick={onClick}
        title={label}
        className={`w-full flex items-center justify-center py-3 transition-colors relative ${active ? 'bg-[#c4a962] text-[#1a2332]' : 'text-[#c4cbd8] hover:bg-[#2a3547]'}`}
      >
        <Icon size={18} strokeWidth={1.5} />
        {badge !== null && badge > 0 && (
          <span className={`absolute top-1 right-2 text-[9px] px-1.5 py-0.5 rounded-full mono ${active ? 'bg-[#1a2332] text-[#c4a962]' : 'bg-[#c4a962] text-[#1a2332]'}`}>
            {badge}
          </span>
        )}
      </button>
    );
  }

  return (
    <button onClick={onClick} className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors ${active ? 'bg-[#c4a962] text-[#1a2332]' : 'text-[#c4cbd8] hover:bg-[#2a3547]'}`}>
      <Icon size={16} strokeWidth={1.5} />
      <span className="flex-1 text-sm">{label}</span>
      {badge !== null && badge > 0 && (
        <span className={`text-xs px-2 py-0.5 rounded-full mono ${active ? 'bg-[#1a2332] text-[#c4a962]' : 'bg-[#c4a962] text-[#1a2332]'}`}>{badge}</span>
      )}
    </button>
  );
}

function Dashboard({ pos, deliveries, lots, inventory, supplierDebts, totalCommitted, totalActual, setModal, setActiveView }) {
  const totalInventoryValue = inventory.reduce((s, i) => {
    const lot = lots.find(l => l.id === i.lot_id);
    return s + (lot ? lot.base_cost_cny * i.qty : 0);
  }, 0);

  const inTransitDeliveries = deliveries.filter(d => d.status === "in_transit");
  const inTransitValue = inTransitDeliveries.reduce((s, d) =>
    s + d.lines.reduce((ss, l) => ss + l.qty * l.unit_price, 0), 0);

  const byCountry = SEED_WAREHOUSES.filter(w => w.type === "destination").map(w => {
    const items = inventory.filter(i => i.warehouse_id === w.id);
    const value = items.reduce((s, i) => {
      const lot = lots.find(l => l.id === i.lot_id);
      return s + (lot ? lot.base_cost_cny * i.qty : 0);
    }, 0);
    const qty = items.reduce((s, i) => s + i.qty, 0);
    return { name: w.country, value: Math.round(value), qty, flag: w.flag };
  });

  const debtTrend = [
    { month: "T10", debt: 45000 }, { month: "T11", debt: 68000 }, { month: "T12", debt: 92000 },
    { month: "T1", debt: 125000 }, { month: "T2", debt: 140000 }, { month: "T3", debt: Math.round(totalActual) },
  ];

  return (
    <div className="p-10 animate-in">
      <div className="flex items-baseline justify-between mb-10">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-[#8a7c4f]">Dashboard</div>
          <h1 className="text-4xl font-light mt-2">Tổng quan điều hành</h1>
          <p className="text-sm text-[#5a6578] mt-2">Thứ Hai, 20 tháng 4, 2026 · Drop-ship từ NCC về 4 nước ASEAN</p>
        </div>
        <button onClick={() => setModal({ type: "new_po" })} className="flex items-center gap-2 bg-[#1a2332] text-[#f5f2eb] px-5 py-3 text-sm hover:bg-[#2a3547]">
          <Plus size={14} /> Tạo PO mới
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <DualDebtKPI committed={totalCommitted} actual={totalActual} />
        <KPICard label="Giá trị tồn kho" value={formatCNY(totalInventoryValue)} sub={`${inventory.length} lot · 4 nước`} trend="+5%" />
        <KPICard label="Hàng đang trung chuyển" value={formatCNY(inTransitValue)} sub={`${inTransitDeliveries.length} delivery`} trend="" accent="#d97757" />
        <KPICard label="PO đang mở" value={pos.filter(p => p.status !== "received" && p.status !== "closed").length} sub={`${pos.length} tổng`} trend="" />
      </div>

      <div className="grid grid-cols-3 gap-6 mb-8">
        <div className="col-span-2 bg-white border border-[#e5dfd1] p-6">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">Diễn biến công nợ</div>
              <div className="text-lg mt-1">6 tháng gần nhất</div>
            </div>
            <div className="text-xs text-[#5a6578] mono">CNY</div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={debtTrend}>
              <CartesianGrid stroke="#e5dfd1" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="month" stroke="#8a7c4f" fontSize={11} />
              <YAxis stroke="#8a7c4f" fontSize={11} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ backgroundColor: "#1a2332", border: "none", color: "#f5f2eb", fontSize: 12 }} formatter={v => formatCNY(v)} />
              <Line type="monotone" dataKey="debt" stroke="#c4a962" strokeWidth={2} dot={{ fill: "#c4a962", r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white border border-[#e5dfd1] p-6">
          <div className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-1">Tồn kho theo quốc gia</div>
          <div className="text-lg mb-4">Giá trị (CNY)</div>
          <div className="space-y-3">
            {byCountry.map(w => {
              const max = Math.max(...byCountry.map(x => x.value), 1);
              return (
                <div key={w.name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span>{w.flag} {w.name}</span>
                    <span className="mono">{(w.value/1000).toFixed(1)}k · {w.qty}</span>
                  </div>
                  <div className="h-2 bg-[#f5f2eb]">
                    <div className="h-full bg-[#1a2332]" style={{ width: `${(w.value/max)*100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white border border-[#e5dfd1]">
          <div className="px-6 py-4 border-b border-[#e5dfd1] flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">Đang trung chuyển</div>
              <div className="text-lg mt-1">In-transit</div>
            </div>
            <button onClick={() => setActiveView("deliveries")} className="text-xs text-[#8a7c4f] hover:text-[#1a2332]">Xem tất cả →</button>
          </div>
          <div className="divide-y divide-[#e5dfd1]">
            {inTransitDeliveries.length === 0 ? (
              <div className="px-6 py-10 text-center text-xs text-[#5a6578]">Không có hàng đang trung chuyển</div>
            ) : inTransitDeliveries.map(d => {
              const wh = getWarehouse(d.destination_id);
              const totalQty = d.lines.reduce((s, l) => s + l.qty, 0);
              const totalValue = d.lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
              const daysElapsed = Math.floor((new Date("2026-04-20") - new Date(d.shipped_date)) / (1000 * 60 * 60 * 24));
              return (
                <div key={d.id} className="px-6 py-4 flex items-center gap-4">
                  <div className="w-10 h-10 flex items-center justify-center bg-[#fae5dd]">
                    <Plane size={16} className="text-[#d97757]" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{wh.flag}</span>
                      <span className="text-sm font-medium">{wh.country}</span>
                      <span className="text-xs mono text-[#5a6578]">{d.id}</span>
                    </div>
                    <div className="text-xs text-[#5a6578] mt-0.5">{totalQty} cái · {formatCNY(totalValue)} · đi {daysElapsed} ngày</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white border border-[#e5dfd1]">
          <div className="px-6 py-4 border-b border-[#e5dfd1]">
            <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">Cảnh báo</div>
            <div className="text-lg mt-1">Cần xử lý</div>
          </div>
          <div className="divide-y divide-[#e5dfd1]">
            <AlertRow icon={TrendingUp} color="#1a2332" title="SKU-004 sắp hết tại VN" desc="Không còn tồn, velocity 45/ngày" action="Đặt gấp" />
            <AlertRow icon={Clock} color="#c4a962" title="PO-2026-002 chưa hoàn tất" desc="Còn 200 cái chưa giao" action="Xem" />
            <AlertRow icon={AlertTriangle} color="#d97757" title="DEL-006 trễ lịch" desc="Dự kiến về TL 28/4, đã 10 ngày trên đường" action="Kiểm tra" />
          </div>
        </div>
      </div>
    </div>
  );
}

function KPICard({ label, value, sub, trend, accent }) {
  return (
    <div className="bg-white border border-[#e5dfd1] p-5 glow-hover">
      <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">{label}</div>
      <div className="text-2xl mt-2 font-medium mono" style={{ color: accent || "#1a2332" }}>{value}</div>
      <div className="flex justify-between items-end mt-2">
        <div className="text-xs text-[#5a6578]">{sub}</div>
        {trend && <div className="text-xs mono text-[#5a6578]">{trend}</div>}
      </div>
    </div>
  );
}

function DualDebtKPI({ committed, actual }) {
  return (
    <div className="bg-white border border-[#e5dfd1] p-5 glow-hover">
      <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">Công nợ nhà cung cấp</div>
      <div className="mt-3 space-y-3">
        <div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 bg-[#8a96a8]"></div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a7c4f]">Cam kết</div>
            </div>
            <div className="text-[10px] text-[#8a96a8]">chưa ship</div>
          </div>
          <div className="text-base mt-1 font-medium mono text-[#5a6578]">{formatCNY(committed)}</div>
        </div>
        <div className="pt-3 border-t border-[#e5dfd1]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 bg-[#c4a962]"></div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a7c4f]">Thực tế</div>
            </div>
            <div className="text-[10px] text-[#8a96a8]">đã ship, chưa trả</div>
          </div>
          <div className="text-base mt-1 font-medium mono text-[#c4a962]">{formatCNY(actual)}</div>
        </div>
      </div>
      <div className="mt-3 pt-2 border-t border-[#e5dfd1] text-[10px] text-[#5a6578] mono">
        ≈ {formatVND(actual * CNY_VND_RATE)} cần thanh toán
      </div>
    </div>
  );
}

function AlertRow({ icon: Icon, color, title, desc, action }) {
  return (
    <div className="px-6 py-4 flex items-center gap-4 hover:bg-[#faf8f2] transition-colors">
      <div className="w-8 h-8 flex items-center justify-center" style={{ backgroundColor: `${color}15` }}>
        <Icon size={16} style={{ color }} strokeWidth={2} />
      </div>
      <div className="flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-[#5a6578] mt-0.5">{desc}</div>
      </div>
      <button className="text-xs uppercase tracking-wider text-[#1a2332] border-b border-[#c4a962] pb-0.5 hover:border-[#1a2332]">{action}</button>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    draft: { label: "Nháp", color: "#8a96a8", bg: "#e5e8ec" },
    confirmed: { label: "Đã xác nhận", color: "#1a2332", bg: "#e5dfd1" },
    shipping: { label: "Đang ship", color: "#d97757", bg: "#fae5dd" },
    partial_delivered: { label: "Giao 1 phần", color: "#c4a962", bg: "#f5ead0" },
    received: { label: "Đã nhận", color: "#4a7c59", bg: "#e0ede4" },
    arrived: { label: "Đã về", color: "#4a7c59", bg: "#e0ede4" },
    in_transit: { label: "Đang trung chuyển", color: "#d97757", bg: "#fae5dd" },
    closed: { label: "Đã đóng", color: "#5a6578", bg: "#eaecef" },
  };
  const s = map[status] || map.draft;
  return <span className="text-xs px-2 py-1" style={{ color: s.color, backgroundColor: s.bg }}>{s.label}</span>;
}

function SuppliersView({ pos, deliveries, supplierDebts, suppliers, setModal }) {
  const [selected, setSelected] = useState(null);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 5;

  // Sắp xếp: PO chưa hoàn thành lên trên (chờ lâu nhất trước), đã hoàn thành xuống dưới (mới nhất trước)
  const sortedPOs = useMemo(() => {
    return [...pos].sort((a, b) => {
      const aOrdered = a.lines.reduce((s, l) => s + l.qty, 0);
      const aDelivered = a.lines.reduce((s, l) => s + l.delivered, 0);
      const aPending = aOrdered - aDelivered;

      const bOrdered = b.lines.reduce((s, l) => s + l.qty, 0);
      const bDelivered = b.lines.reduce((s, l) => s + l.delivered, 0);
      const bPending = bOrdered - bDelivered;

      // Chưa hoàn thành lên trên
      if (aPending > 0 && bPending === 0) return -1;
      if (aPending === 0 && bPending > 0) return 1;

      // Trong nhóm chưa hoàn thành: đặt lâu hơn (ngày cũ hơn) lên đầu
      if (aPending > 0 && bPending > 0) {
        return new Date(a.po_date) - new Date(b.po_date);
      }

      // Nhóm đã hoàn thành: mới nhất trước
      return new Date(b.po_date) - new Date(a.po_date);
    });
  }, [pos]);

  const totalPages = Math.max(1, Math.ceil(sortedPOs.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedPOs = sortedPOs.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="p-10 animate-in">
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-[#8a7c4f]">Purchasing</div>
          <h1 className="text-4xl font-light mt-2">Đơn đặt hàng</h1>
          <p className="text-sm text-[#5a6578] mt-2">PO là đơn chung với NCC · Việc phân nước diễn ra khi tạo delivery</p>
        </div>
        <button onClick={() => setModal({ type: "new_po" })} className="flex items-center gap-2 bg-[#1a2332] text-[#f5f2eb] px-5 py-3 text-sm hover:bg-[#2a3547]">
          <Plus size={14} /> Tạo PO mới
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {suppliers.filter(s => s.status !== "inactive").map(s => {
          const debt = supplierDebts[s.id] || { committed: 0, shipped: 0, paid: 0 };
          const actual = debt.shipped - debt.paid;
          return (
            <div key={s.id} onClick={() => setSelectedSupplier(s)} className="bg-white border border-[#e5dfd1] p-5 cursor-pointer glow-hover hover:border-[#c4a962] transition-all group">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="text-xs uppercase tracking-wider text-[#8a7c4f] mono">{s.id}</div>
                  <div className="text-base mt-1 font-medium">{s.name}</div>
                  <div className="text-xs text-[#5a6578] mt-1">Điều khoản: {s.terms} ngày · {s.currency}</div>
                </div>
                <ChevronRight size={16} className="text-[#8a96a8] group-hover:text-[#c4a962] transition-colors mt-1" />
              </div>
              <div className="mt-4 pt-4 border-t border-[#e5dfd1] grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#8a7c4f]">Cam kết</div>
                  <div className="mono mt-1 text-[#5a6578]">{formatCNY(debt.committed)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#8a7c4f]">Thực tế</div>
                  <div className="mono mt-1" style={{ color: actual > 0 ? "#d97757" : "#1a2332" }}>{formatCNY(actual)}</div>
                </div>
              </div>
              <div className="mt-3 text-[10px] text-[#8a96a8] group-hover:text-[#c4a962] transition-colors">
                Click để xem chi tiết →
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white border border-[#e5dfd1]">
        <div className="px-6 py-4 border-b border-[#e5dfd1] flex items-center justify-between">
          <div>
            <div className="text-sm uppercase tracking-wider text-[#8a7c4f]">Danh sách PO</div>
            <div className="text-xs text-[#5a6578] mt-1 italic">Sắp xếp: PO chưa hoàn thành (đặt lâu nhất trước) · Đã giao đủ xuống cuối</div>
          </div>
          <div className="flex gap-2">
            <button className="text-xs flex items-center gap-1 text-[#5a6578] hover:text-[#1a2332]"><Filter size={12} /> Lọc</button>
            <button className="text-xs flex items-center gap-1 text-[#5a6578] hover:text-[#1a2332]"><Download size={12} /> Xuất</button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#faf8f2] text-xs uppercase tracking-wider text-[#8a7c4f]">
              <th className="text-left px-6 py-3">PO Number</th>
              <th className="text-left px-6 py-3">Nhà cung cấp</th>
              <th className="text-left px-6 py-3">Ngày đặt</th>
              <th className="text-left px-6 py-3">SKU</th>
              <th className="text-right px-6 py-3">Tổng tiền</th>
              <th className="text-right px-6 py-3">Đã giao</th>
              <th className="text-left px-6 py-3">Trạng thái</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pagedPOs.map(po => {
              const supplier = getSupplier(po.supplier_id);
              const total = po.lines.reduce((s, l) => s + l.qty * l.price, 0);
              const deliveredQty = po.lines.reduce((s, l) => s + l.delivered, 0);
              const totalQty = po.lines.reduce((s, l) => s + l.qty, 0);
              const pending = totalQty - deliveredQty;
              const isComplete = pending === 0;
              return (
                <tr key={po.id}
                  className={`border-t border-[#e5dfd1] hover:bg-[#faf8f2] cursor-pointer ${isComplete ? "opacity-60" : ""}`}
                  style={{ borderLeft: pending > 0 ? "3px solid #d97757" : "3px solid #4a7c59" }}
                  onClick={() => setSelected(po)}>
                  <td className="px-6 py-4 mono text-xs">{po.id}</td>
                  <td className="px-6 py-4">{supplier.name}</td>
                  <td className="px-6 py-4 text-[#5a6578]">{po.po_date}</td>
                  <td className="px-6 py-4 text-xs">{po.lines.length} items</td>
                  <td className="px-6 py-4 text-right mono">{formatCNY(total)}</td>
                  <td className="px-6 py-4 text-right mono text-xs">
                    <div>{deliveredQty}/{totalQty}</div>
                    {pending > 0 && <div className="text-[10px] text-[#d97757] mono mt-0.5">còn {pending.toLocaleString()}</div>}
                  </td>
                  <td className="px-6 py-4"><StatusBadge status={po.status} /></td>
                  <td className="px-6 py-4"><ChevronRight size={14} className="text-[#8a96a8]" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pagination currentPage={currentPage} totalPages={totalPages} totalItems={sortedPOs.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </div>

      {selected && <PODetailPanel po={selected} deliveries={deliveries} onClose={() => setSelected(null)} />}
      {selectedSupplier && <SupplierDetailPanel supplier={selectedSupplier} pos={pos} deliveries={deliveries} supplierDebts={supplierDebts} onClose={() => setSelectedSupplier(null)} onOpenPO={(po) => { setSelectedSupplier(null); setSelected(po); }} />}
    </div>
  );
}

function PODetailPanel({ po, deliveries, onClose }) {
  const supplier = getSupplier(po.supplier_id);
  const relatedDeliveries = deliveries.filter(d =>
    d.lines.some(l => po.lines.some(pl => pl.id === l.po_line_id))
  );

  // Tính toán tổng quan
  const totalValue = po.lines.reduce((s, l) => s + l.qty * l.price, 0);
  const totalOrdered = po.lines.reduce((s, l) => s + l.qty, 0);
  const totalDelivered = po.lines.reduce((s, l) => s + l.delivered, 0);
  const totalPending = totalOrdered - totalDelivered;
  const progress = totalOrdered ? (totalDelivered / totalOrdered) * 100 : 0;
  const TODAY = new Date("2026-04-20");
  const daysWaiting = Math.floor((TODAY - new Date(po.po_date)) / (1000 * 60 * 60 * 24));

  const handleDownloadExcel = () => downloadPOExcel(po, supplier);

  return (
    <div className="fixed inset-0 bg-[#1e4d7b]/98 backdrop-blur-md flex justify-end z-50" onClick={onClose}>
      <div className="w-[640px] bg-[#7fa8d1] h-full overflow-y-auto animate-in" onClick={e => e.stopPropagation()}>
        {/* Header đậm */}
        <div className="p-6 border-b border-[#e5dfd1] bg-[#1a2332] text-[#f5f2eb]">
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-[#c4a962] mono">{po.id}</div>
              <div className="text-2xl font-medium mt-1">Chi tiết đơn hàng</div>
              <div className="text-xs text-[#c4cbd8] mt-1">{supplier.name}</div>
            </div>
            <button onClick={onClose} className="text-[#c4cbd8] hover:text-[#f5f2eb]"><X size={20} /></button>
          </div>

          {/* Tổng giá trị + Trạng thái */}
          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-[#2a3547]">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a96a8]">Tổng giá trị</div>
              <div className="text-2xl mono font-medium text-[#c4a962] mt-1">{formatCNY(totalValue)}</div>
              <div className="text-[10px] text-[#8a96a8] mono">≈ {formatVND(totalValue * CNY_VND_RATE)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a96a8]">Ngày đặt</div>
              <div className="text-sm mono mt-1">{po.po_date}</div>
              <div className="text-[10px] text-[#8a96a8] mt-0.5">
                {daysWaiting} ngày trước
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8a96a8]">Trạng thái</div>
              <div className="mt-1"><StatusBadge status={po.status} /></div>
              <div className="text-[10px] text-[#8a96a8] mono mt-1">{totalDelivered}/{totalOrdered} cái</div>
            </div>
          </div>
        </div>

        {/* Download Excel button */}
        <div className="px-6 py-4 bg-[#f5ead0] border-b border-[#c4a962]">
          <button onClick={handleDownloadExcel}
            className="w-full py-3 bg-[#1a2332] text-[#f5f2eb] hover:bg-[#2a3547] text-sm font-medium flex items-center justify-center gap-2">
            <Download size={16} />
            Tải Excel gửi NCC · Purchase Order (EN + 中文)
          </button>
          <div className="text-[10px] text-[#8a7c4f] mt-2 text-center italic">
            File Excel song ngữ Anh + Trung, sẵn sàng gửi email cho nhà máy Trung Quốc
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Progress tổng thể */}
          <div className="bg-white border border-[#e5dfd1] p-5">
            <div className="flex justify-between items-baseline mb-3">
              <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">Tiến độ giao hàng</div>
              <div className="text-xs mono">{progress.toFixed(0)}%</div>
            </div>
            <div className="h-2 bg-[#f5f2eb]">
              <div className="h-full bg-[#4a7c59]" style={{ width: `${progress}%` }} />
            </div>
            <div className="grid grid-cols-3 gap-3 mt-4 text-xs">
              <div className="p-2 bg-[#faf8f2]">
                <div className="text-[10px] uppercase tracking-wider text-[#8a7c4f]">Đã đặt</div>
                <div className="mono mt-0.5">{totalOrdered.toLocaleString()}</div>
              </div>
              <div className="p-2 bg-[#e0ede4]">
                <div className="text-[10px] uppercase tracking-wider text-[#4a7c59]">Đã giao</div>
                <div className="mono mt-0.5 text-[#4a7c59]">{totalDelivered.toLocaleString()}</div>
              </div>
              <div className={`p-2 ${totalPending > 0 ? "bg-[#fae5dd]" : "bg-[#f5f2eb]"}`}>
                <div className={`text-[10px] uppercase tracking-wider ${totalPending > 0 ? "text-[#d97757]" : "text-[#8a7c4f]"}`}>Chưa giao</div>
                <div className={`mono mt-0.5 ${totalPending > 0 ? "text-[#d97757]" : "text-[#8a96a8]"}`}>{totalPending.toLocaleString()}</div>
              </div>
            </div>
          </div>

          {/* Thông tin NCC */}
          <div>
            <div className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2">Nhà cung cấp</div>
            <div className="bg-white border border-[#e5dfd1] p-4">
              <div className="font-medium">{supplier.name}</div>
              <div className="text-xs text-[#5a6578] mt-1 mono">{supplier.id}</div>
              <div className="text-xs text-[#5a6578] mt-2">
                {supplier.country} · Điều khoản: {supplier.terms} ngày · {supplier.currency}
              </div>
            </div>
          </div>

          {/* Ghi chú PO nếu có */}
          {po.notes && (
            <div>
              <div className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2">Ghi chú</div>
              <div className="bg-white border border-[#e5dfd1] p-4 text-sm text-[#5a6578] italic">
                {po.notes}
              </div>
            </div>
          )}

          {/* Chi tiết từng dòng SKU */}
          <div>
            <div className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-3">Chi tiết PO Line ({po.lines.length})</div>
            <div className="bg-white border border-[#e5dfd1]">
              {po.lines.map((line) => {
                const sku = getSKU(line.sku_id);
                const lineTotal = line.qty * line.price;
                const linePending = line.qty - line.delivered;
                const linePct = line.qty ? (line.delivered / line.qty) * 100 : 0;
                const byCountry = {};
                relatedDeliveries.forEach(d => {
                  d.lines.filter(dl => dl.po_line_id === line.id).forEach(dl => {
                    byCountry[d.destination_id] = (byCountry[d.destination_id] || 0) + dl.qty;
                  });
                });
                return (
                  <div key={line.id} className="p-4 border-b border-[#e5dfd1] last:border-0"
                    style={{ borderLeft: linePending > 0 ? "3px solid #d97757" : "3px solid #4a7c59" }}>
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1">
                        <div className="text-xs mono text-[#8a7c4f]">{line.sku_id}</div>
                        <div className="text-sm mt-0.5 font-medium">{sku?.name}</div>
                      </div>
                      <div className="text-right">
                        <div className="mono text-sm font-medium">{formatCNY(lineTotal)}</div>
                        <div className="text-xs text-[#5a6578]">{line.qty.toLocaleString()} × {formatCNY(line.price)}</div>
                      </div>
                    </div>

                    {/* Progress line */}
                    <div className="h-1 bg-[#f5f2eb] mb-2">
                      <div className="h-full bg-[#4a7c59]" style={{ width: `${linePct}%` }} />
                    </div>
                    <div className="flex justify-between text-xs mb-3">
                      <span className="text-[#5a6578]">Đã giao: <span className="mono">{line.delivered}/{line.qty}</span></span>
                      {linePending > 0 && <span className="text-[#d97757] mono">Còn {linePending}</span>}
                    </div>

                    {/* Phân bổ theo nước */}
                    {Object.keys(byCountry).length > 0 && (
                      <div className="pt-2 border-t border-[#e5dfd1]">
                        <div className="text-[10px] uppercase tracking-wider text-[#8a7c4f] mb-2">Đã giao đến:</div>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(byCountry).map(([whId, qty]) => {
                            const wh = getWarehouse(whId);
                            return (
                              <div key={whId} className="text-xs px-2 py-1 bg-[#faf8f2] border border-[#e5dfd1]">
                                <span>{wh.flag} {wh.country}</span>
                                <span className="mono ml-2 text-[#8a7c4f]">{qty}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Deliveries liên quan */}
          <div>
            <div className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-3">Deliveries ({relatedDeliveries.length})</div>
            {relatedDeliveries.length === 0 ? (
              <div className="text-xs text-[#8a96a8] italic bg-white border border-[#e5dfd1] p-4 text-center">
                Chưa có delivery nào được tạo cho PO này
              </div>
            ) : (
              <div className="bg-white border border-[#e5dfd1] divide-y divide-[#e5dfd1]">
                {relatedDeliveries.map(d => {
                  const wh = getWarehouse(d.destination_id);
                  const linesFromPO = d.lines.filter(l => po.lines.some(pl => pl.id === l.po_line_id));
                  const qty = linesFromPO.reduce((s, l) => s + l.qty, 0);
                  return (
                    <div key={d.id} className="p-3 flex items-center gap-3">
                      <span className="text-xl">{wh.flag}</span>
                      <div className="flex-1">
                        <div className="text-xs mono text-[#8a7c4f]">{d.id}</div>
                        <div className="text-sm">{wh.country} · ship {d.shipped_date}</div>
                        <div className="text-[10px] text-[#5a6578] mt-0.5">
                          <span className="mono">{qty}</span> cái từ PO này
                        </div>
                      </div>
                      <StatusBadge status={d.status} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper: xuất Excel PO song ngữ EN+中文 dùng SheetJS
function downloadPOExcel(po, supplier) {
  // Import động để không block bundle
  import("xlsx").then(XLSX => {
    const rows = [];

    // Header PO info (bilingual)
    rows.push(["Purchase Order / 采购订单"]);
    rows.push([]);
    rows.push(["PO Number / 订单号:", po.id]);
    rows.push(["Date / 日期:", po.po_date]);
    rows.push(["Supplier / 供应商:", supplier.name_cn ? `${supplier.name} / ${supplier.name_cn}` : supplier.name]);
    rows.push(["Currency / 货币:", po.currency || "CNY"]);
    if (po.notes) rows.push(["Notes / 备注:", po.notes]);
    rows.push([]);

    // Bảng chi tiết
    rows.push([
      "No. / 序号",
      "SKU Code / 产品编号",
      "Product Name / 产品名称",
      "Quantity / 数量",
      "Unit Price (CNY) / 单价",
      "Amount (CNY) / 金额"
    ]);

    let grandTotal = 0;
    po.lines.forEach((line, idx) => {
      const sku = getSKU(line.sku_id);
      const amount = line.qty * line.price;
      grandTotal += amount;
      // Ưu tiên tên TQ khi có, fallback EN, cuối cùng VI
      const productName = sku?.name_cn
        ? `${sku.name_en || sku.name} / ${sku.name_cn}`
        : (sku?.name_en || sku?.name || "");
      rows.push([
        idx + 1,
        line.sku_id,
        productName,
        line.qty,
        line.price,
        amount,
      ]);
    });

    rows.push([]);
    rows.push(["", "", "", "", "Total / 总计:", grandTotal]);

    // Build workbook
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Set column widths
    ws["!cols"] = [
      { wch: 10 }, { wch: 16 }, { wch: 32 }, { wch: 12 }, { wch: 16 }, { wch: 16 }
    ];

    // Merge tiêu đề đầu tiên
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Purchase Order");

    XLSX.writeFile(wb, `${po.id}_${supplier.name.replace(/\s+/g, "_")}.xlsx`);
  }).catch(err => {
    console.error("Không tải được xlsx library:", err);
    alert("Không thể xuất file Excel. Vui lòng thử lại.");
  });
}

function SupplierDetailPanel({ supplier, pos, deliveries, supplierDebts, onClose, onOpenPO }) {
  const [tab, setTab] = useState("overview");
  const debt = supplierDebts[supplier.id];
  const actual = debt.shipped - debt.paid;

  // Lấy tất cả PO của NCC này
  const supplierPOs = pos.filter(p => p.supplier_id === supplier.id);
  const supplierPOIds = new Set(supplierPOs.map(p => p.id));

  // Lấy tất cả delivery liên quan đến PO của NCC này
  const relatedDeliveries = deliveries.filter(d =>
    d.lines.some(l => {
      const po = getPOByLineId(l.po_line_id, pos);
      return po && supplierPOIds.has(po.id);
    })
  );

  // Tổng hợp theo SKU: đã đặt / đã giao / còn lại + phân bổ theo nước
  const skuSummary = {};
  supplierPOs.forEach(po => {
    po.lines.forEach(line => {
      if (!skuSummary[line.sku_id]) {
        skuSummary[line.sku_id] = {
          sku_id: line.sku_id,
          ordered: 0, delivered: 0, value_ordered: 0, value_delivered: 0,
          byCountry: {}, byPO: []
        };
      }
      const s = skuSummary[line.sku_id];
      s.ordered += line.qty;
      s.delivered += line.delivered;
      s.value_ordered += line.qty * line.price;
      s.value_delivered += line.delivered * line.price;
      s.byPO.push({
        po_id: po.id, po_line_id: line.id, po_date: po.po_date,
        qty: line.qty, delivered: line.delivered, price: line.price
      });
    });
  });

  // Đếm số lượng đã giao theo nước cho mỗi SKU
  relatedDeliveries.forEach(d => {
    d.lines.forEach(l => {
      if (skuSummary[l.sku_id]) {
        skuSummary[l.sku_id].byCountry[d.destination_id] =
          (skuSummary[l.sku_id].byCountry[d.destination_id] || 0) + l.qty;
      }
    });
  });

  // Tính ngày PO cần quan tâm và số ngày chờ
  const TODAY = new Date("2026-04-20");
  Object.values(skuSummary).forEach(s => {
    const pendingPOs = s.byPO.filter(p => p.delivered < p.qty);
    // Nếu còn PO chưa giao đủ → lấy ngày cũ nhất (chờ lâu nhất)
    // Nếu tất cả đã giao đủ → lấy ngày mới nhất
    const target = pendingPOs.length > 0
      ? pendingPOs.reduce((oldest, p) => new Date(p.po_date) < new Date(oldest.po_date) ? p : oldest)
      : s.byPO.reduce((newest, p) => new Date(p.po_date) > new Date(newest.po_date) ? p : newest);
    s.reference_date = target.po_date;
    s.days_waiting = Math.floor((TODAY - new Date(target.po_date)) / (1000 * 60 * 60 * 24));
    s.has_pending = pendingPOs.length > 0;
    s.total_pos = s.byPO.length;
  });

  const skuList = Object.values(skuSummary).sort((a, b) => {
    const aPending = a.ordered - a.delivered;
    const bPending = b.ordered - b.delivered;
    // Chưa giao hết lên trên
    if (aPending > 0 && bPending === 0) return -1;
    if (aPending === 0 && bPending > 0) return 1;
    // Trong nhóm chưa giao: chờ lâu hơn lên trước
    if (aPending > 0 && bPending > 0) {
      if (a.days_waiting !== b.days_waiting) return b.days_waiting - a.days_waiting;
      return bPending - aPending;
    }
    // Còn lại sắp theo mã SKU
    return a.sku_id.localeCompare(b.sku_id);
  });

  // Tổng hợp số
  const totalOrdered = skuList.reduce((s, k) => s + k.ordered, 0);
  const totalDelivered = skuList.reduce((s, k) => s + k.delivered, 0);
  const totalPending = totalOrdered - totalDelivered;

  return (
    <div className="fixed inset-0 bg-[#1e4d7b]/98 backdrop-blur-md flex justify-end z-50" onClick={onClose}>
      <div className="w-[780px] bg-[#7fa8d1] h-full overflow-y-auto animate-in" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-6 border-b border-[#e5dfd1] flex justify-between items-start bg-[#1a2332] text-[#f5f2eb]">
          <div>
            <div className="text-xs uppercase tracking-wider text-[#c4a962] mono">{supplier.id}</div>
            <div className="text-2xl font-medium mt-1">{supplier.name}</div>
            <div className="text-xs text-[#c4cbd8] mt-1">{supplier.country} · {supplier.currency} · {supplier.terms} ngày</div>
          </div>
          <button onClick={onClose} className="text-[#c4cbd8] hover:text-[#f5f2eb]"><X size={20} /></button>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-4 gap-0 bg-white border-b border-[#e5dfd1]">
          <div className="p-4 border-r border-[#e5dfd1]">
            <div className="text-[10px] uppercase tracking-wider text-[#8a7c4f]">Số PO</div>
            <div className="mono text-xl mt-1">{supplierPOs.length}</div>
          </div>
          <div className="p-4 border-r border-[#e5dfd1]">
            <div className="text-[10px] uppercase tracking-wider text-[#8a7c4f]">Tổng đã đặt</div>
            <div className="mono text-xl mt-1">{totalOrdered.toLocaleString()}</div>
            <div className="text-[10px] text-[#5a6578] mt-0.5">cái</div>
          </div>
          <div className="p-4 border-r border-[#e5dfd1]">
            <div className="text-[10px] uppercase tracking-wider text-[#8a7c4f]">Đã giao</div>
            <div className="mono text-xl mt-1 text-[#4a7c59]">{totalDelivered.toLocaleString()}</div>
            <div className="text-[10px] text-[#5a6578] mt-0.5">{totalOrdered ? ((totalDelivered/totalOrdered)*100).toFixed(0) : 0}%</div>
          </div>
          <div className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-[#8a7c4f]">Chưa giao</div>
            <div className="mono text-xl mt-1" style={{ color: totalPending > 0 ? "#d97757" : "#8a96a8" }}>{totalPending.toLocaleString()}</div>
            <div className="text-[10px] text-[#5a6578] mt-0.5">cái</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#e5dfd1] bg-white">
          {[
            { id: "overview", label: "Tổng quan" },
            { id: "skus", label: `Báo cáo SKU (${skuList.length})` },
            { id: "pos", label: `Đơn hàng (${supplierPOs.length})` },
            { id: "deliveries", label: `Delivery (${relatedDeliveries.length})` },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-5 py-3 text-sm border-b-2 transition-colors ${tab === t.id ? "border-[#c4a962] text-[#1a2332]" : "border-transparent text-[#5a6578] hover:text-[#1a2332]"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6">
          {tab === "overview" && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white border border-[#e5dfd1] border-l-4 border-l-[#8a96a8] p-5">
                  <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">Công nợ cam kết</div>
                  <div className="text-2xl mono mt-2 text-[#5a6578]">{formatCNY(debt.committed)}</div>
                  <div className="text-xs text-[#8a96a8] mt-1">Phần PO chưa ship</div>
                </div>
                <div className="bg-white border border-[#e5dfd1] border-l-4 border-l-[#c4a962] p-5">
                  <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">Công nợ thực tế</div>
                  <div className="text-2xl mono mt-2 text-[#c4a962]">{formatCNY(actual)}</div>
                  <div className="text-xs text-[#8a96a8] mt-1">Đã ship chưa trả</div>
                </div>
              </div>

              <div className="bg-white border border-[#e5dfd1] p-5">
                <div className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-3">Tiến độ giao hàng tổng thể</div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-[#5a6578]">Đã giao</span>
                    <span className="mono">{totalDelivered.toLocaleString()} / {totalOrdered.toLocaleString()}</span>
                  </div>
                  <div className="h-3 bg-[#f5f2eb]">
                    <div className="h-full bg-[#4a7c59]" style={{ width: `${totalOrdered ? (totalDelivered/totalOrdered)*100 : 0}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-[#5a6578]">
                    <span>{totalOrdered ? ((totalDelivered/totalOrdered)*100).toFixed(1) : 0}% hoàn thành</span>
                    <span>Còn {totalPending.toLocaleString()} cái</span>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-[#e5dfd1] p-5">
                <div className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-3">Thống kê theo trạng thái PO</div>
                <div className="grid grid-cols-4 gap-3">
                  {["confirmed", "shipping", "partial_delivered", "received"].map(st => {
                    const count = supplierPOs.filter(p => p.status === st).length;
                    return (
                      <div key={st} className="text-center p-3 bg-[#faf8f2]">
                        <div className="text-xl mono font-medium">{count}</div>
                        <div className="text-[10px] mt-1"><StatusBadge status={st} /></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {tab === "skus" && (
            <div>
              <div className="text-xs text-[#5a6578] mb-3 italic">Sắp xếp: SKU chưa giao đủ (chờ lâu nhất trên cùng) · Đã giao đủ xuống cuối · ⚠️ đánh dấu khi chờ &gt; 30 ngày</div>
              <div className="bg-white border border-[#e5dfd1]">
                {skuList.map((s, i) => {
                  const sku = getSKU(s.sku_id);
                  const pending = s.ordered - s.delivered;
                  const pct = s.ordered ? (s.delivered / s.ordered) * 100 : 0;
                  const isComplete = pending === 0;
                  return (
                    <div
                      key={s.sku_id}
                      className={`p-4 ${i < skuList.length - 1 ? "border-b border-[#e5dfd1]" : ""} ${isComplete ? "opacity-60" : ""}`}
                      style={{ borderLeft: pending > 0 ? "3px solid #d97757" : "3px solid #4a7c59" }}
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="text-xs mono text-[#8a7c4f]">{s.sku_id}</div>
                            {isComplete ? (
                              <span className="text-[10px] px-2 py-0.5 bg-[#e0ede4] text-[#4a7c59] uppercase tracking-wider">Đã giao đủ</span>
                            ) : (
                              <span className="text-[10px] px-2 py-0.5 bg-[#fae5dd] text-[#d97757] uppercase tracking-wider mono">Còn {pending.toLocaleString()}</span>
                            )}
                          </div>
                          <div className="text-sm font-medium mt-0.5">{sku?.name}</div>
                        </div>
                        <div className="text-right text-xs">
                          <div className="mono text-sm">{s.delivered.toLocaleString()} / {s.ordered.toLocaleString()}</div>
                          <div className="text-[#5a6578] mt-0.5">{pct.toFixed(0)}% hoàn thành</div>
                        </div>
                      </div>

                      {/* Ngày đặt & số ngày chờ */}
                      <div className="flex items-center gap-4 mb-3 text-xs">
                        <div className="flex items-center gap-1.5">
                          <Clock size={11} className="text-[#8a7c4f]" />
                          <span className="text-[#8a7c4f]">
                            {s.has_pending ? "Đặt (cũ nhất còn chờ):" : "Đặt lần cuối:"}
                          </span>
                          <span className="mono text-[#1a2332]">{s.reference_date}</span>
                        </div>
                        <div className="text-[#8a96a8]">·</div>
                        <div className={`flex items-center gap-1.5 ${s.has_pending && s.days_waiting > 30 ? "text-[#d97757] font-medium" : "text-[#5a6578]"}`}>
                          <span>
                            {s.has_pending ? "Đã chờ:" : "Cách đây:"}
                          </span>
                          <span className="mono">{s.days_waiting} ngày</span>
                          {s.has_pending && s.days_waiting > 30 && (
                            <AlertTriangle size={11} className="text-[#d97757]" />
                          )}
                        </div>
                        {s.total_pos > 1 && (
                          <>
                            <div className="text-[#8a96a8]">·</div>
                            <div className="text-[#5a6578]">
                              <span className="mono">{s.total_pos}</span> PO khác nhau
                            </div>
                          </>
                        )}
                      </div>

                      {/* Progress bar */}
                      <div className="h-2 bg-[#f5f2eb] mb-3">
                        <div className="h-full bg-[#4a7c59]" style={{ width: `${pct}%` }} />
                      </div>

                      {/* 3 cột thông tin */}
                      <div className="grid grid-cols-3 gap-3 text-xs mb-3">
                        <div className="bg-[#faf8f2] p-2">
                          <div className="text-[10px] uppercase tracking-wider text-[#8a7c4f]">Đã đặt</div>
                          <div className="mono mt-0.5">{s.ordered.toLocaleString()}</div>
                          <div className="text-[10px] text-[#5a6578]">{formatCNY(s.value_ordered)}</div>
                        </div>
                        <div className="bg-[#e0ede4] p-2">
                          <div className="text-[10px] uppercase tracking-wider text-[#4a7c59]">Đã giao</div>
                          <div className="mono mt-0.5 text-[#4a7c59]">{s.delivered.toLocaleString()}</div>
                          <div className="text-[10px] text-[#5a6578]">{formatCNY(s.value_delivered)}</div>
                        </div>
                        <div className={`p-2 ${pending > 0 ? "bg-[#fae5dd]" : "bg-[#f5f2eb]"}`}>
                          <div className={`text-[10px] uppercase tracking-wider ${pending > 0 ? "text-[#d97757]" : "text-[#8a7c4f]"}`}>Chưa giao</div>
                          <div className={`mono mt-0.5 ${pending > 0 ? "text-[#d97757]" : "text-[#8a96a8]"}`}>{pending.toLocaleString()}</div>
                          <div className="text-[10px] text-[#5a6578]">{formatCNY(s.value_ordered - s.value_delivered)}</div>
                        </div>
                      </div>

                      {/* Phân bổ theo nước */}
                      {Object.keys(s.byCountry).length > 0 && (
                        <div className="pt-3 border-t border-[#e5dfd1]">
                          <div className="text-[10px] uppercase tracking-wider text-[#8a7c4f] mb-2">Đã giao đến:</div>
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(s.byCountry).map(([whId, qty]) => {
                              const wh = getWarehouse(whId);
                              return (
                                <div key={whId} className="text-xs px-2 py-1 bg-white border border-[#e5dfd1]">
                                  <span>{wh.flag} {wh.country}</span>
                                  <span className="mono ml-2 text-[#8a7c4f]">{qty.toLocaleString()}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "pos" && (
            <div>
              <div className="text-xs text-[#5a6578] mb-3 italic">Sắp xếp: PO chưa giao đủ (chờ lâu nhất trên cùng) · Đã hoàn tất xuống cuối</div>
              <div className="bg-white border border-[#e5dfd1]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#faf8f2] text-[10px] uppercase tracking-wider text-[#8a7c4f]">
                      <th className="text-left px-4 py-3">PO Number</th>
                      <th className="text-left px-4 py-3">Ngày đặt</th>
                      <th className="text-left px-4 py-3">Đã chờ</th>
                      <th className="text-right px-4 py-3">Đã giao</th>
                      <th className="text-right px-4 py-3">Giá trị</th>
                      <th className="text-left px-4 py-3">Trạng thái</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {supplierPOs
                      .map(po => {
                        const ordered = po.lines.reduce((s, l) => s + l.qty, 0);
                        const delivered = po.lines.reduce((s, l) => s + l.delivered, 0);
                        const total = po.lines.reduce((s, l) => s + l.qty * l.price, 0);
                        const pending = ordered - delivered;
                        const days = Math.floor((new Date("2026-04-20") - new Date(po.po_date)) / (1000 * 60 * 60 * 24));
                        return { po, ordered, delivered, total, pending, days };
                      })
                      .sort((a, b) => {
                        // Chưa giao đủ lên trên
                        if (a.pending > 0 && b.pending === 0) return -1;
                        if (a.pending === 0 && b.pending > 0) return 1;
                        // Trong nhóm chưa giao: chờ lâu hơn lên đầu
                        if (a.pending > 0 && b.pending > 0) return b.days - a.days;
                        // Đã xong: mới nhất trước
                        return b.days - a.days ? a.days - b.days : 0;
                      })
                      .map(({ po, ordered, delivered, total, pending, days }) => {
                        const isComplete = pending === 0;
                        const isSlow = pending > 0 && days > 30;
                        return (
                          <tr
                            key={po.id}
                            className={`border-t border-[#e5dfd1] hover:bg-[#faf8f2] cursor-pointer ${isComplete ? "opacity-60" : ""}`}
                            style={{ borderLeft: pending > 0 ? "3px solid #d97757" : "3px solid #4a7c59" }}
                            onClick={() => onOpenPO(po)}
                          >
                            <td className="px-4 py-3 mono text-xs font-medium">{po.id}</td>
                            <td className="px-4 py-3 text-[#5a6578] text-xs mono">{po.po_date}</td>
                            <td className="px-4 py-3 text-xs">
                              <div className={`flex items-center gap-1 ${isSlow ? "text-[#d97757] font-medium" : "text-[#5a6578]"}`}>
                                <span className="mono">{days} ngày</span>
                                {isSlow && <AlertTriangle size={10} />}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right text-xs">
                              <div className="mono">{delivered.toLocaleString()}/{ordered.toLocaleString()}</div>
                              {pending > 0 && (
                                <div className="text-[10px] text-[#d97757] mono mt-0.5">còn {pending.toLocaleString()}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right mono text-xs">{formatCNY(total)}</td>
                            <td className="px-4 py-3"><StatusBadge status={po.status} /></td>
                            <td className="px-4 py-3"><ChevronRight size={12} className="text-[#8a96a8]" /></td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "deliveries" && (
            <div className="relative">
              {/* Timeline */}
              <div className="absolute left-[22px] top-2 bottom-2 w-0.5 bg-[#e5dfd1]"></div>
              <div className="space-y-4">
                {relatedDeliveries.length === 0 ? (
                  <div className="text-center py-10 text-sm text-[#5a6578]">Chưa có delivery nào</div>
                ) : relatedDeliveries
                  .slice()
                  .sort((a, b) => new Date(b.shipped_date) - new Date(a.shipped_date))
                  .map(d => {
                    const wh = getWarehouse(d.destination_id);
                    const totalQty = d.lines.reduce((s, l) => s + l.qty, 0);
                    const totalValue = d.lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
                    return (
                      <div key={d.id} className="flex gap-4 relative">
                        <div className={`w-11 h-11 flex items-center justify-center text-lg z-10 ${d.status === "arrived" ? "bg-[#e0ede4]" : "bg-[#fae5dd]"}`}>
                          {wh.flag}
                        </div>
                        <div className="flex-1 bg-white border border-[#e5dfd1] p-4">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <div className="text-xs mono text-[#8a7c4f]">{d.id}</div>
                              <div className="text-sm font-medium mt-0.5">{wh.country}</div>
                            </div>
                            <StatusBadge status={d.status} />
                          </div>
                          <div className="text-xs text-[#5a6578] mb-2">
                            Ship: <span className="mono">{d.shipped_date}</span>
                            {d.arrived_date && <> · Về: <span className="mono">{d.arrived_date}</span></>}
                          </div>
                          <div className="flex justify-between text-xs pt-2 border-t border-[#e5dfd1]">
                            <span className="text-[#5a6578]">{d.lines.length} SKU · {totalQty} cái</span>
                            <span className="mono font-medium">{formatCNY(totalValue)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DeliveriesView({ pos, deliveries, lots, setModal, onMarkArrived, onUpdateTracking }) {
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [confirmArrive, setConfirmArrive] = useState(null);
  const [page, setPage] = useState(1);
  const [editingTracking, setEditingTracking] = useState(null); // delivery_id đang edit
  const [trackingDraft, setTrackingDraft] = useState("");
  const PAGE_SIZE = 10;

  const filtered = (filter === "all" ? deliveries : deliveries.filter(d => d.destination_id === filter))
    .slice()
    .sort((a, b) => {
      // Đang trung chuyển lên trên
      if (a.status === "in_transit" && b.status !== "in_transit") return -1;
      if (a.status !== "in_transit" && b.status === "in_transit") return 1;
      // Trong nhóm in_transit: ship sớm hơn (đi lâu hơn) lên đầu
      if (a.status === "in_transit" && b.status === "in_transit") {
        return new Date(a.shipped_date) - new Date(b.shipped_date);
      }
      // Nhóm arrived: về gần đây nhất lên trên
      return new Date(b.arrived_date || b.shipped_date) - new Date(a.arrived_date || a.shipped_date);
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedDeliveries = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="p-10 animate-in">
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-[#8a7c4f]">Logistics</div>
          <h1 className="text-4xl font-light mt-2">Giao hàng theo quốc gia</h1>
          <p className="text-sm text-[#5a6578] mt-2">Mỗi delivery ship thẳng từ NCC về 1 nước · Hàng chưa về luôn hiển thị ở đầu danh sách</p>
        </div>
        <button onClick={() => setModal({ type: "new_delivery" })} className="flex items-center gap-2 bg-[#1a2332] text-[#f5f2eb] px-5 py-3 text-sm hover:bg-[#2a3547]">
          <Plus size={14} /> Tạo delivery mới
        </button>
      </div>

      <div className="flex items-center gap-2 mb-6">
        <span className="text-xs uppercase tracking-wider text-[#8a7c4f]">Lọc theo nước:</span>
        <div className="flex gap-1 bg-white border border-[#e5dfd1]">
          <button onClick={() => { setFilter("all"); setPage(1); }} className={`px-4 py-2 text-xs uppercase tracking-wider ${filter === "all" ? "bg-[#1a2332] text-[#f5f2eb]" : "text-[#5a6578] hover:bg-[#faf8f2]"}`}>Tất cả</button>
          {SEED_WAREHOUSES.filter(w => w.type === "destination").map(w => (
            <button key={w.id} onClick={() => { setFilter(w.id); setPage(1); }} className={`px-4 py-2 text-xs ${filter === w.id ? "bg-[#1a2332] text-[#f5f2eb]" : "text-[#5a6578] hover:bg-[#faf8f2]"}`}>
              {w.flag} {w.code}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-8">
        {SEED_WAREHOUSES.filter(w => w.type === "destination").map(w => {
          const dels = deliveries.filter(d => d.destination_id === w.id);
          const inTransit = dels.filter(d => d.status === "in_transit").length;
          const arrived = dels.filter(d => d.status === "arrived").length;
          const totalQty = dels.reduce((s, d) => s + d.lines.reduce((ss, l) => ss + l.qty, 0), 0);
          return (
            <div key={w.id} className="bg-white border border-[#e5dfd1] p-4">
              <div className="flex items-center gap-2">
                <span className="text-xl">{w.flag}</span>
                <div>
                  <div className="text-sm font-medium">{w.country}</div>
                  <div className="text-xs mono text-[#5a6578]">{w.code}</div>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-[#e5dfd1] grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-xs text-[#8a7c4f]">Đang về</div>
                  <div className="text-sm mono mt-0.5" style={{ color: inTransit > 0 ? "#d97757" : "#8a96a8" }}>{inTransit}</div>
                </div>
                <div>
                  <div className="text-xs text-[#8a7c4f]">Đã về</div>
                  <div className="text-sm mono mt-0.5 text-[#4a7c59]">{arrived}</div>
                </div>
                <div>
                  <div className="text-xs text-[#8a7c4f]">Tổng cái</div>
                  <div className="text-sm mono mt-0.5">{totalQty}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white border border-[#e5dfd1]">
        <div className="px-6 py-4 border-b border-[#e5dfd1]">
          <div className="text-sm uppercase tracking-wider text-[#8a7c4f]">Danh sách delivery</div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#faf8f2] text-xs uppercase tracking-wider text-[#8a7c4f]">
              <th className="text-left px-4 py-2.5">Delivery ID</th>
              <th className="text-left px-4 py-2.5">Đến</th>
              <th className="text-left px-4 py-2.5">Tracking</th>
              <th className="text-right px-4 py-2.5">SKU × PO</th>
              <th className="text-right px-4 py-2.5">Tổng SL</th>
              <th className="text-right px-4 py-2.5">Giá trị</th>
              <th className="text-left px-4 py-2.5">Ngày ship</th>
              <th className="text-left px-4 py-2.5">Trạng thái</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {pagedDeliveries.map(d => {
              const wh = getWarehouse(d.destination_id);
              const totalQty = d.lines.reduce((s, l) => s + l.qty, 0);
              const totalValue = d.lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
              const uniquePOs = new Set(d.lines.map(l => getPOByLineId(l.po_line_id, pos)?.id).filter(Boolean));
              const isInTransit = d.status === "in_transit";
              return (
                <tr
                  key={d.id}
                  className="border-t border-[#e5dfd1] hover:bg-[#faf8f2]"
                  style={{ borderLeft: isInTransit ? "3px solid #d97757" : "3px solid transparent" }}
                >
                  <td className="px-4 py-2.5 mono text-xs cursor-pointer" onClick={() => setSelected(d)}>{d.id}</td>
                  <td className="px-4 py-2.5 cursor-pointer" onClick={() => setSelected(d)}>
                    <div className="flex items-center gap-2">
                      <span className="text-base">{wh.flag}</span>
                      <span className="text-sm">{wh.country}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 mono text-xs text-[#5a6578]">
                    {editingTracking === d.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={trackingDraft}
                          onChange={(e) => setTrackingDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              onUpdateTracking(d.id, trackingDraft.trim());
                              setEditingTracking(null);
                            } else if (e.key === "Escape") {
                              setEditingTracking(null);
                            }
                          }}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                          className="w-28 px-2 py-1 mono text-xs border border-[#c4a962] bg-white outline-none text-[#1a2332]"
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateTracking(d.id, trackingDraft.trim());
                            setEditingTracking(null);
                          }}
                          className="p-1 text-[#4a7c59] hover:bg-[#e0ede4]"
                          title="Lưu"
                        >
                          <CheckCircle2 size={12} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingTracking(null);
                          }}
                          className="p-1 text-[#8a96a8] hover:bg-[#f5f2eb]"
                          title="Hủy"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 group">
                        <span className="cursor-pointer" onClick={() => setSelected(d)}>{d.tracking}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingTracking(d.id);
                            setTrackingDraft(d.tracking || "");
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-[#8a96a8] hover:text-[#c4a962] transition-opacity"
                          title="Sửa mã tracking"
                        >
                          <Edit2 size={11} />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs cursor-pointer" onClick={() => setSelected(d)}>{d.lines.length} SKU · {uniquePOs.size} PO</td>
                  <td className="px-4 py-2.5 text-right mono text-sm cursor-pointer" onClick={() => setSelected(d)}>{totalQty.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right mono text-sm cursor-pointer" onClick={() => setSelected(d)}>{formatCNY(totalValue)}</td>
                  <td className="px-4 py-2.5 text-[#5a6578] text-xs mono cursor-pointer" onClick={() => setSelected(d)}>{d.shipped_date}</td>
                  <td className="px-4 py-2.5 cursor-pointer" onClick={() => setSelected(d)}><StatusBadge status={d.status} /></td>
                  <td className="px-4 py-2.5">
                    {d.status === "in_transit" ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmArrive(d);
                        }}
                        className="text-xs px-3 py-1 bg-[#c4a962] text-[#1a2332] hover:bg-[#b8a056] whitespace-nowrap font-medium"
                      >
                        Xác nhận đã về
                      </button>
                    ) : d.arrived_date ? (
                      <div className="text-xs">
                        <div className="text-[10px] uppercase tracking-wider text-[#8a7c4f]">Đã về</div>
                        <div className="mono text-[#4a7c59]">{d.arrived_date}</div>
                      </div>
                    ) : (
                      <ChevronRight size={14} className="text-[#8a96a8]" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pagination currentPage={currentPage} totalPages={totalPages} totalItems={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </div>

      {selected && <DeliveryDetail delivery={selected} pos={pos} lots={lots} onRequestArrival={() => { setConfirmArrive(selected); setSelected(null); }} onClose={() => setSelected(null)} />}

      {confirmArrive && (
        <ConfirmArrivalModal
          delivery={confirmArrive}
          onConfirm={() => {
            onMarkArrived(confirmArrive.id);
            setConfirmArrive(null);
          }}
          onCancel={() => setConfirmArrive(null)}
        />
      )}
    </div>
  );
}

function DeliveryDetail({ delivery, pos, lots, onRequestArrival, onClose }) {
  const wh = getWarehouse(delivery.destination_id);
  const totalValue = delivery.lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const freightRate = wh.freightRate || 2.5;
  const freightTotal = delivery.lines.reduce((s, l) => s + l.qty * freightRate, 0);
  const vatTotal = totalValue * wh.vat;

  return (
    <div className="fixed inset-0 bg-[#1e4d7b]/98 backdrop-blur-md flex justify-end z-50" onClick={onClose}>
      <div className="w-[600px] bg-[#7fa8d1] h-full overflow-y-auto animate-in" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-[#e5dfd1] flex justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-[#8a7c4f] mono">{delivery.id}</div>
            <div className="text-2xl font-medium mt-1">Chi tiết delivery</div>
          </div>
          <button onClick={onClose}><X size={20} /></button>
        </div>

        <div className="p-6 space-y-6">
          <div className="bg-white border border-[#e5dfd1] p-5">
            <div className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-3">Lộ trình</div>
            <div className="flex items-center gap-3">
              <div className="text-3xl">🇨🇳</div>
              <div className="flex-1 h-0.5 border-t-2 border-dashed border-[#c4a962] relative">
                <Plane size={16} className="absolute -top-2 left-1/2 -translate-x-1/2 text-[#c4a962] bg-white px-1 box-content" />
              </div>
              <div className="text-3xl">{wh.flag}</div>
            </div>
            <div className="flex justify-between mt-2">
              <div className="text-xs">
                <div className="font-medium">NCC TQ</div>
                <div className="text-[#5a6578] mono">{delivery.shipped_date}</div>
              </div>
              <div className="text-xs text-right">
                <div className="font-medium">{wh.country}</div>
                <div className="text-[#5a6578] mono">{delivery.arrived_date || "chưa về"}</div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-[#e5dfd1] flex justify-between items-center">
              <div className="text-xs text-[#5a6578]">Tracking: <span className="mono">{delivery.tracking}</span></div>
              <StatusBadge status={delivery.status} />
            </div>
            {delivery.status === "in_transit" && onRequestArrival && (
              <button
                onClick={onRequestArrival}
                className="mt-4 w-full py-3 bg-[#c4a962] text-[#1a2332] hover:bg-[#b8a056] text-sm font-medium flex items-center justify-center gap-2"
              >
                <CheckCircle2 size={16} /> Xác nhận hàng đã về kho {wh.country}
              </button>
            )}
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-3">Chi tiết hàng hoá</div>
            <div className="bg-white border border-[#e5dfd1]">
              {delivery.lines.map((line, i) => {
                const sku = getSKU(line.sku_id);
                const po = getPOByLineId(line.po_line_id, pos);
                const value = line.qty * line.unit_price;
                const lot = lots.find(l => l.delivery_id === delivery.id && l.sku_id === line.sku_id);
                return (
                  <div key={i} className="p-4 border-b border-[#e5dfd1] last:border-0">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="text-xs mono text-[#8a7c4f]">từ {po?.id || line.po_line_id}</div>
                        <div className="text-sm font-medium mt-0.5">{sku?.name}</div>
                        <div className="text-xs text-[#5a6578] mono mt-0.5">{line.sku_id}</div>
                        {lot && (
                          <div className="mt-2 inline-flex items-center gap-1 text-xs bg-[#e0ede4] text-[#4a7c59] px-2 py-0.5">
                            <Package size={10} /> {lot.id}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="mono text-sm">{formatCNY(value)}</div>
                        <div className="text-xs text-[#5a6578]">{line.qty} × {formatCNY(line.unit_price)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-[#1a2332] text-[#f5f2eb] p-5">
            <div className="text-xs uppercase tracking-wider text-[#c4a962] mb-3">Landed cost dự kiến</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[#c4cbd8]">Giá FOB (NCC)</span>
                <span className="mono">{formatCNY(totalValue)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#c4cbd8]">Freight TQ → {wh.country}</span>
                <span className="mono">{formatCNY(freightTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#c4cbd8]">VAT nhập khẩu ({(wh.vat * 100).toFixed(0)}%)</span>
                <span className="mono">{formatCNY(vatTotal)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-[#2a3547]">
                <span>Tổng landed cost</span>
                <span className="mono font-medium text-[#c4a962]">{formatCNY(totalValue + freightTotal + vatTotal)}</span>
              </div>
            </div>
            <div className="mt-3 text-xs text-[#8a96a8] italic">
              * Dự kiến. Sẽ reconcile khi hoá đơn freight/hải quan về.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmArrivalModal({ delivery, onConfirm, onCancel }) {
  const wh = getWarehouse(delivery.destination_id);
  const totalQty = delivery.lines.reduce((s, l) => s + l.qty, 0);
  const today = "2026-04-20";

  return (
    <div className="fixed inset-0 bg-[#1e4d7b]/98 backdrop-blur-md flex items-center justify-center z-[60] p-6" onClick={onCancel}>
      <div className="bg-[#7fa8d1] w-[520px] max-w-full animate-in" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-[#e5dfd1] bg-[#1a2332] text-[#f5f2eb] flex justify-between items-start">
          <div>
            <div className="text-xs uppercase tracking-wider text-[#c4a962]">Xác nhận nhận hàng</div>
            <div className="text-xl font-medium mt-1">Đánh dấu đã về kho</div>
          </div>
          <button onClick={onCancel} className="text-[#c4cbd8] hover:text-[#f5f2eb]"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-white border border-[#e5dfd1] p-4">
            <div className="flex items-center gap-3">
              <div className="text-3xl">{wh.flag}</div>
              <div className="flex-1">
                <div className="text-xs mono text-[#8a7c4f]">{delivery.id}</div>
                <div className="text-sm font-medium mt-0.5">{wh.country}</div>
                <div className="text-xs text-[#5a6578] mt-0.5 mono">{delivery.tracking}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-[#8a7c4f]">Số lượng</div>
                <div className="mono text-lg">{totalQty.toLocaleString()}</div>
              </div>
            </div>
          </div>

          <div className="bg-[#f5ead0] border border-[#c4a962] p-4 text-xs">
            <div className="font-medium text-[#1a2332] mb-2">Khi xác nhận, hệ thống sẽ:</div>
            <ul className="space-y-1 text-[#5a6578]">
              <li>• Đổi trạng thái sang <span className="font-medium text-[#4a7c59]">Đã về</span></li>
              <li>• Ghi nhận ngày về = <span className="mono font-medium">{today}</span> (hôm nay)</li>
              <li>• Tự động tạo {delivery.lines.length} lot mới</li>
              <li>• Cộng vào tồn kho <span className="font-medium">{wh.country}</span></li>
            </ul>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[#e5dfd1] bg-white flex justify-end gap-3">
          <button onClick={onCancel} className="px-5 py-2 text-sm text-[#5a6578] hover:text-[#1a2332]">Hủy</button>
          <button onClick={onConfirm} className="px-6 py-2 text-sm bg-[#c4a962] text-[#1a2332] hover:bg-[#b8a056] font-medium flex items-center gap-2">
            <CheckCircle2 size={14} /> Xác nhận đã về
          </button>
        </div>
      </div>
    </div>
  );
}

function InventoryView({ inventory, lots, pos }) {
  const [filterWarehouse, setFilterWarehouse] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 5;

  const filtered = inventory.filter(i => {
    if (filterWarehouse !== "all" && i.warehouse_id !== filterWarehouse) return false;
    if (search) {
      const sku = getSKU(i.sku_id);
      const q = search.toLowerCase();
      return sku?.name.toLowerCase().includes(q) || i.sku_id.toLowerCase().includes(q) || i.lot_id.toLowerCase().includes(q);
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedInventory = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="p-10 animate-in">
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-[#8a7c4f]">Inventory</div>
          <h1 className="text-4xl font-light mt-2">Tồn kho đa quốc gia</h1>
          <p className="text-sm text-[#5a6578] mt-2">Lot được tạo tại nước đích · Giá vốn đã bao gồm landed cost</p>
        </div>
      </div>

      <div className="flex gap-4 mb-6">
        <div className="flex-1 bg-white border border-[#e5dfd1] flex items-center gap-2 px-4">
          <Search size={14} className="text-[#8a96a8]" />
          <input type="text" placeholder="Tìm SKU, Lot code..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="flex-1 py-3 bg-transparent outline-none text-sm" />
        </div>
        <div className="flex bg-white border border-[#e5dfd1]">
          <button onClick={() => { setFilterWarehouse("all"); setPage(1); }} className={`px-4 py-3 text-xs uppercase tracking-wider ${filterWarehouse === "all" ? "bg-[#1a2332] text-[#f5f2eb]" : "text-[#5a6578]"}`}>Tất cả</button>
          {SEED_WAREHOUSES.filter(w => w.type === "destination").map(w => (
            <button key={w.id} onClick={() => { setFilterWarehouse(w.id); setPage(1); }} className={`px-4 py-3 text-xs ${filterWarehouse === w.id ? "bg-[#1a2332] text-[#f5f2eb]" : "text-[#5a6578]"}`}>
              {w.flag} {w.code}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-[#e5dfd1]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#faf8f2] text-xs uppercase tracking-wider text-[#8a7c4f]">
              <th className="text-left px-6 py-3">Kho</th>
              <th className="text-left px-6 py-3">SKU</th>
              <th className="text-left px-6 py-3">Lot · PO gốc</th>
              <th className="text-right px-6 py-3">On Hand</th>
              <th className="text-right px-6 py-3">Committed</th>
              <th className="text-right px-6 py-3">Available</th>
              <th className="text-right px-6 py-3">Giá vốn landed</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan="7" className="px-6 py-10 text-center text-[#5a6578]">Không có dữ liệu phù hợp</td></tr>
            ) : pagedInventory.map((i, idx) => {
              const sku = getSKU(i.sku_id);
              const lot = getLot(i.lot_id, lots);
              const wh = getWarehouse(i.warehouse_id);
              const po = lot ? getPOByLineId(lot.po_line_id, pos) : null;
              const available = i.qty - i.committed;
              const vatRate = wh.vat || 0;
              const freightPerUnit = lot ? lot.freight_cny / lot.qty : 0;
              const landedPerUnit = lot ? (lot.base_cost_cny + freightPerUnit) * (1 + vatRate) : 0;
              return (
                <tr key={idx} className="border-t border-[#e5dfd1] hover:bg-[#faf8f2]">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{wh.flag}</span>
                      <div>
                        <div className="text-sm">{wh.country}</div>
                        <div className="text-xs mono text-[#5a6578]">{wh.code}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm">{sku?.name}</div>
                    <div className="text-xs mono text-[#5a6578]">{i.sku_id}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="mono text-xs font-medium">{i.lot_id}</div>
                    <div className="text-xs text-[#5a6578] mt-0.5">{po?.id || "—"}</div>
                  </td>
                  <td className="px-6 py-4 text-right mono">{i.qty.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right mono text-[#d97757]">{i.committed.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right mono font-medium">{available.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right mono text-xs">
                    <div>{formatCNY(landedPerUnit)}</div>
                    <div className="text-[#8a96a8]">(FOB+ship+VAT)</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pagination currentPage={currentPage} totalPages={totalPages} totalItems={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </div>

      <div className="mt-4 text-xs text-[#5a6578]">
        <span className="inline-block w-2 h-2 bg-[#d97757] mr-2"></span>Committed = đã đặt bán chưa xuất
        <span className="inline-block w-2 h-2 bg-[#1a2332] ml-6 mr-2"></span>Available = on hand − committed
        <span className="ml-6 italic">Landed cost = giá FOB + freight + VAT nhập khẩu của nước đó</span>
      </div>
    </div>
  );
}

function Pagination({ currentPage, totalPages, totalItems, pageSize, onChange }) {
  if (totalPages <= 1) return null;
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="px-6 py-4 border-t border-[#e5dfd1] bg-[#faf8f2] flex items-center justify-between">
      <div className="text-xs text-[#5a6578]">
        Hiển thị <span className="mono">{start}-{end}</span>
        {" / "}
        <span className="mono">{totalItems}</span> mục
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="w-8 h-8 flex items-center justify-center text-xs border border-[#e5dfd1] bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:border-[#c4a962]"
        >
          ‹
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={`w-8 h-8 flex items-center justify-center text-xs mono border transition-colors ${
              currentPage === n
                ? "bg-[#1a2332] text-[#f5f2eb] border-[#1a2332]"
                : "bg-white border-[#e5dfd1] text-[#5a6578] hover:border-[#c4a962]"
            }`}
          >
            {n}
          </button>
        ))}
        <button
          onClick={() => onChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="w-8 h-8 flex items-center justify-center text-xs border border-[#e5dfd1] bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:border-[#c4a962]"
        >
          ›
        </button>
      </div>
    </div>
  );
}

function PaymentsView({ payments, supplierDebts, suppliers, totalCommitted, totalActual, setModal }) {
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 5;

  const sortedPayments = useMemo(() =>
    payments.slice().sort((a, b) => new Date(b.date) - new Date(a.date))
  , [payments]);

  const totalPages = Math.max(1, Math.ceil(sortedPayments.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages); // safety nếu dữ liệu thay đổi
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagePayments = sortedPayments.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div className="p-10 animate-in">
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-[#8a7c4f]">Accounts Payable</div>
          <h1 className="text-4xl font-light mt-2">Công nợ &amp; Thanh toán</h1>
          <p className="text-sm text-[#5a6578] mt-2">Theo dõi 2 loại: <span className="text-[#5a6578] font-medium">cam kết</span> (đơn đặt) · <span className="text-[#c4a962] font-medium">thực tế</span> (đã giao) · CNY</p>
        </div>
        <button onClick={() => setModal({ type: "new_payment" })} className="flex items-center gap-2 bg-[#1a2332] text-[#f5f2eb] px-5 py-3 text-sm hover:bg-[#2a3547]">
          <Plus size={14} /> Ghi nhận thanh toán
        </button>
      </div>

      {/* Tổng quan 2 loại công nợ */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-[#e5dfd1] p-6 border-l-4 border-l-[#8a96a8]">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">Công nợ cam kết</div>
              <div className="text-xs text-[#5a6578] mt-1">Hàng đã đặt nhưng NCC chưa ship</div>
            </div>
            <FileText size={16} className="text-[#8a96a8]" />
          </div>
          <div className="mt-4 text-3xl mono font-medium text-[#5a6578]">{formatCNY(totalCommitted)}</div>
          <div className="text-xs text-[#8a96a8] mono mt-1">≈ {formatVND(totalCommitted * CNY_VND_RATE)}</div>
          <div className="mt-3 text-xs text-[#5a6578] italic">
            Chưa phát sinh nghĩa vụ trả · Theo dõi để lên kế hoạch dòng tiền
          </div>
        </div>

        <div className="bg-white border border-[#e5dfd1] p-6 border-l-4 border-l-[#c4a962]">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">Công nợ thực tế</div>
              <div className="text-xs text-[#5a6578] mt-1">NCC đã ship, chưa thanh toán</div>
            </div>
            <Coins size={16} className="text-[#c4a962]" />
          </div>
          <div className="mt-4 text-3xl mono font-medium text-[#c4a962]">{formatCNY(totalActual)}</div>
          <div className="text-xs text-[#8a96a8] mono mt-1">≈ {formatVND(totalActual * CNY_VND_RATE)}</div>
          <div className="mt-3 text-xs text-[#5a6578] italic">
            Đã phát sinh nghĩa vụ trả · Ghi sổ kế toán (TK 331)
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {suppliers.filter(s => s.status !== "inactive").map(s => {
          const debt = supplierDebts[s.id] || { committed: 0, shipped: 0, paid: 0 };
          const actual = debt.shipped - debt.paid;
          const paidRatio = debt.shipped > 0 ? (debt.paid / debt.shipped) * 100 : 0;
          return (
            <div key={s.id} className="bg-white border border-[#e5dfd1] p-5">
              <div className="text-xs mono text-[#8a7c4f]">{s.id}</div>
              <div className="font-medium mt-1">{s.name}</div>

              {/* Dual debt breakdown */}
              <div className="mt-4 pt-4 border-t border-[#e5dfd1] space-y-3">
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 bg-[#8a96a8]"></div>
                      <span className="uppercase tracking-wider text-[#8a7c4f]">Cam kết</span>
                    </div>
                    <span className="mono text-[#5a6578]">{formatCNY(debt.committed)}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 bg-[#c4a962]"></div>
                      <span className="uppercase tracking-wider text-[#8a7c4f]">Thực tế</span>
                    </div>
                  </div>
                  <div className="pl-3 space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-[#5a6578]">Đã ship</span>
                      <span className="mono">{formatCNY(debt.shipped)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-[#5a6578]">Đã trả</span>
                      <span className="mono text-[#4a7c59]">−{formatCNY(debt.paid)}</span>
                    </div>
                    <div className="h-1 bg-[#f5f2eb]">
                      <div className="h-full bg-[#c4a962]" style={{ width: `${paidRatio}%` }} />
                    </div>
                    <div className="flex justify-between items-baseline pt-1">
                      <span className="text-[10px] uppercase tracking-wider text-[#8a7c4f]">Còn nợ</span>
                      <span className="text-base mono" style={{ color: actual > 0 ? "#d97757" : "#4a7c59" }}>{formatCNY(actual)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white border border-[#e5dfd1]">
        <div className="px-6 py-4 border-b border-[#e5dfd1]">
          <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">Lịch sử thanh toán</div>
          <div className="text-lg mt-1">Payment History</div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#faf8f2] text-xs uppercase tracking-wider text-[#8a7c4f]">
              <th className="text-left px-6 py-3">Payment ID</th>
              <th className="text-left px-6 py-3">Ngày</th>
              <th className="text-left px-6 py-3">NCC</th>
              <th className="text-left px-6 py-3">Nguồn tiền</th>
              <th className="text-right px-6 py-3">Số tiền CNY</th>
              <th className="text-right px-6 py-3">Tỷ giá</th>
              <th className="text-right px-6 py-3">Quy đổi VND</th>
              <th className="text-left px-6 py-3">Áp cho PO</th>
            </tr>
          </thead>
          <tbody>
            {pagePayments.map(p => {
              const supplier = getSupplier(p.supplier_id);
              const fundMap = {
                pingpong: { label: "Pingpong", icon: "💳", color: "#185fa5" },
                tien_nhap_khau: { label: "Tiền nhập khẩu", icon: "🏦", color: "#4a7c59" },
                khac: { label: "Khác", icon: "💼", color: "#8a7c4f" },
              };
              const fund = p.fund_source ? fundMap[p.fund_source] : null;
              return (
                <tr key={p.id} className="border-t border-[#e5dfd1] hover:bg-[#faf8f2]">
                  <td className="px-6 py-4 mono text-xs">{p.id}</td>
                  <td className="px-6 py-4 text-[#5a6578]">{p.date}</td>
                  <td className="px-6 py-4">{supplier.name}</td>
                  <td className="px-6 py-4">
                    {fund ? (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span>{fund.icon}</span>
                        <span style={{ color: fund.color }}>{fund.label}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-[#8a96a8] italic">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right mono">{formatCNY(p.amount_cny)}</td>
                  <td className="px-6 py-4 text-right mono text-xs text-[#5a6578]">{p.rate.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right mono text-xs">{formatVND(p.amount_cny * p.rate)}</td>
                  <td className="px-6 py-4"><span className="text-xs mono text-[#5a6578]">{p.applied_po.join(", ")}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Pagination */}
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={sortedPayments.length}
          pageSize={PAGE_SIZE}
          onChange={setPage}
        />
      </div>

      <div className="mt-6 bg-[#1a2332] text-[#f5f2eb] p-5 flex items-start gap-4">
        <Activity size={18} className="text-[#c4a962] mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-medium">Ghi chú kế toán: chênh lệch tỷ giá</div>
          <div className="text-xs text-[#c4cbd8] mt-1 leading-relaxed">
            Công nợ được ghi nhận theo CNY tại ngày ship. Khi thanh toán tại ngày khác, tỷ giá có thể chênh.
            Phần chênh lệch được hạch toán vào tài khoản 635 (chi phí tài chính) hoặc 515 (doanh thu tài chính).
          </div>
        </div>
      </div>
    </div>
  );
}

function Modal({ type, pos, deliveries, payments, supplierDebts, skus, suppliers, editingSKU, editingSupplier, onClose, onCreateDelivery, onCreatePayment, onCreatePO, onCreateSKU, onUpdateSKU, onCreateSupplier, onUpdateSupplier }) {
  if (type === "new_delivery") {
    return <NewDeliveryModal pos={pos} deliveries={deliveries} onClose={onClose} onCreate={onCreateDelivery} />;
  }
  if (type === "new_payment") {
    return <NewPaymentModal pos={pos} payments={payments} supplierDebts={supplierDebts} suppliers={suppliers} onClose={onClose} onCreate={onCreatePayment} />;
  }
  if (type === "new_po") {
    return <NewPOModal pos={pos} suppliers={suppliers} onClose={onClose} onCreate={onCreatePO} />;
  }
  if (type === "new_sku" || type === "edit_sku") {
    return <SKUFormModal skus={skus} editing={editingSKU} onClose={onClose} onCreate={onCreateSKU} onUpdate={onUpdateSKU} />;
  }
  if (type === "new_supplier" || type === "edit_supplier") {
    return <SupplierFormModal suppliers={suppliers} editing={editingSupplier} onClose={onClose} onCreate={onCreateSupplier} onUpdate={onUpdateSupplier} />;
  }
  return (
    <div className="fixed inset-0 bg-[#1e4d7b]/98 backdrop-blur-md flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div className="bg-[#7fa8d1] w-[600px] max-w-full animate-in" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-[#e5dfd1] flex justify-between items-center">
          <div>
            <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">Thao tác</div>
            <div className="text-xl font-medium mt-1">Form chưa phát triển</div>
          </div>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <div className="p-6">
          <button onClick={onClose} className="mt-6 w-full py-3 bg-[#1a2332] text-[#f5f2eb] text-sm">Đóng</button>
        </div>
      </div>
    </div>
  );
}

function NewDeliveryModal({ pos, deliveries, onClose, onCreate }) {
  const [step, setStep] = useState(1);
  const [destinationId, setDestinationId] = useState(null);
  const [shippedDate, setShippedDate] = useState("2026-04-20");
  const [tracking, setTracking] = useState("");
  // selectedLines: { [po_line_id]: qty }
  const [selectedLines, setSelectedLines] = useState({});

  // Step 1: chọn nước đích
  const destinations = SEED_WAREHOUSES.filter(w => w.type === "destination");
  const destination = destinations.find(d => d.id === destinationId);

  // Tính số còn lại cho mỗi PO line
  const availableLines = useMemo(() => {
    const result = [];
    pos.forEach(po => {
      if (po.status === "closed") return;
      po.lines.forEach(line => {
        const remaining = line.qty - line.delivered;
        if (remaining > 0) {
          result.push({
            po_id: po.id,
            supplier_id: po.supplier_id,
            supplier_name: getSupplier(po.supplier_id)?.name,
            line_id: line.id,
            sku_id: line.sku_id,
            sku_name: getSKU(line.sku_id)?.name,
            ordered: line.qty,
            delivered: line.delivered,
            remaining,
            price: line.price,
          });
        }
      });
    });
    return result;
  }, [pos]);

  // Group by supplier để hiển thị dễ hơn
  const linesBySupplier = useMemo(() => {
    const g = {};
    availableLines.forEach(l => {
      if (!g[l.supplier_id]) g[l.supplier_id] = { supplier_name: l.supplier_name, lines: [] };
      g[l.supplier_id].lines.push(l);
    });
    return g;
  }, [availableLines]);

  // Preview landed cost
  const selectedLineObjects = availableLines.filter(l => selectedLines[l.line_id] > 0);
  const totalQty = selectedLineObjects.reduce((s, l) => s + (selectedLines[l.line_id] || 0), 0);
  const totalFOB = selectedLineObjects.reduce((s, l) => s + (selectedLines[l.line_id] || 0) * l.price, 0);
  const freightRate = destination?.freightRate || 0;
  const vatRate = destination?.vat || 0;
  const freightTotal = totalQty * freightRate;
  const vatTotal = totalFOB * vatRate;
  const landedTotal = totalFOB + freightTotal + vatTotal;

  const toggleLine = (lineId) => {
    setSelectedLines(prev => {
      const next = { ...prev };
      if (next[lineId]) delete next[lineId];
      else {
        const line = availableLines.find(l => l.line_id === lineId);
        next[lineId] = line.remaining;
      }
      return next;
    });
  };

  const updateQty = (lineId, qty) => {
    const line = availableLines.find(l => l.line_id === lineId);
    const clean = Math.max(0, Math.min(line.remaining, parseInt(qty) || 0));
    setSelectedLines(prev => ({ ...prev, [lineId]: clean }));
  };

  const canProceedStep1 = destinationId && shippedDate;
  const canProceedStep2 = totalQty > 0;

  const handleSubmit = () => {
    const newId = `DEL-${String(deliveries.length + 1).padStart(3, '0')}`;
    const newTracking = tracking || `SFC-${destination.code.split("-")[0]}-${shippedDate.replace(/-/g, "")}`;
    const newDelivery = {
      id: newId,
      destination_id: destinationId,
      shipped_date: shippedDate,
      arrived_date: null,
      tracking: newTracking,
      status: "in_transit",
      lines: selectedLineObjects.map(l => ({
        po_line_id: l.line_id,
        sku_id: l.sku_id,
        qty: selectedLines[l.line_id],
        unit_price: l.price,
      })),
    };
    onCreate(newDelivery);
  };

  return (
    <div className="fixed inset-0 bg-[#1e4d7b]/98 backdrop-blur-md flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div
        className="bg-[#7fa8d1] animate-in"
        style={{ width: "880px", maxWidth: "100%", height: "92vh", display: "flex", flexDirection: "column" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-[#e5dfd1] flex justify-between items-start bg-[#1a2332] text-[#f5f2eb]" style={{ flexShrink: 0 }}>
          <div>
            <div className="text-xs uppercase tracking-wider text-[#c4a962]">Logistics</div>
            <div className="text-2xl font-medium mt-1">Tạo delivery mới</div>
            <div className="text-xs text-[#c4cbd8] mt-1">Drop-ship từ NCC về 1 nước · Có thể gộp hàng từ nhiều PO</div>
          </div>
          <button onClick={onClose} className="text-[#c4cbd8] hover:text-[#f5f2eb]"><X size={20} /></button>
        </div>

        {/* Stepper */}
        <div className="flex border-b border-[#e5dfd1] bg-white" style={{ flexShrink: 0 }}>
          {[
            { num: 1, label: "Điểm đến & thời gian" },
            { num: 2, label: "Chọn hàng & số lượng" },
            { num: 3, label: "Xác nhận" },
          ].map(s => (
            <div key={s.num} className="flex-1 px-5 py-4 flex items-center gap-3 border-r border-[#e5dfd1] last:border-r-0"
              style={step === s.num ? { backgroundColor: "#dbe8f5" } : {}}>
              <div className="w-7 h-7 flex items-center justify-center text-xs mono"
                style={
                  step > s.num ? { backgroundColor: "#4a7c59", color: "#ffffff" } :
                  step === s.num ? { backgroundColor: "#4a7bb8", color: "#ffffff" } :
                  { backgroundColor: "#e5dfd1", color: "#8a7c4f" }
                }>
                {step > s.num ? "✓" : s.num}
              </div>
              <div>
                <div className={`text-xs uppercase tracking-wider ${step === s.num ? "text-[#1a2332]" : "text-[#8a7c4f]"}`}>Bước {s.num}</div>
                <div className={`text-sm ${step === s.num ? "font-medium" : "text-[#5a6578]"}`}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Content - scrollable */}
        <div className="p-6" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-3 block">Nước đích</label>
                <div className="grid grid-cols-4 gap-3">
                  {destinations.map(d => {
                    const isActive = destinationId === d.id;
                    return (
                      <button key={d.id} onClick={() => setDestinationId(d.id)}
                        className="p-5 border text-left transition-all"
                        style={isActive
                          ? { borderColor: "#4a7bb8", backgroundColor: "#dbe8f5", borderWidth: "2px" }
                          : { borderColor: "#e5dfd1", backgroundColor: "#ffffff" }
                        }>
                        <div className="text-3xl mb-2">{d.flag}</div>
                        <div className="text-sm font-medium">{d.country}</div>
                        <div className="text-xs mono text-[#5a6578] mt-0.5">{d.code}</div>
                        <div className="text-[10px] text-[#8a7c4f] mt-2">
                          Freight ¥{d.freightRate}/cái · VAT {(d.vat*100).toFixed(0)}%
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Ngày NCC ship</label>
                  <input type="date" value={shippedDate} onChange={e => setShippedDate(e.target.value)}
                    className="w-full px-4 py-3 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm mono" />
                  <div className="text-[10px] text-[#8a7c4f] mt-1 italic">Công nợ thực tế sẽ được ghi nhận theo ngày này</div>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Tracking number (tùy chọn)</label>
                  <input type="text" value={tracking} onChange={e => setTracking(e.target.value)} placeholder="Tự động sinh nếu để trống"
                    className="w-full px-4 py-3 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm mono" />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-3">
                Hàng còn chưa giao <span className="mono text-[#5a6578] normal-case tracking-normal">({availableLines.length} dòng)</span>
              </div>
              {availableLines.length === 0 ? (
                <div className="bg-white border border-[#e5dfd1] p-10 text-center text-sm text-[#5a6578]">
                  Không có PO nào còn hàng chưa giao
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(linesBySupplier).map(([sid, group]) => (
                    <div key={sid} className="bg-white border border-[#e5dfd1]">
                      <div className="px-4 py-2 bg-[#faf8f2] border-b border-[#e5dfd1] flex justify-between items-center">
                        <div className="text-xs">
                          <span className="uppercase tracking-wider text-[#8a7c4f]">NCC:</span>{" "}
                          <span className="font-medium">{group.supplier_name}</span>{" "}
                          <span className="mono text-[#5a6578]">({sid})</span>
                        </div>
                        <div className="text-[10px] text-[#8a7c4f]">{group.lines.length} dòng</div>
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wider text-[#8a7c4f]">
                            <th className="text-left px-4 py-2 w-10"></th>
                            <th className="text-left px-4 py-2">PO / SKU</th>
                            <th className="text-right px-4 py-2">Đặt</th>
                            <th className="text-right px-4 py-2">Đã giao</th>
                            <th className="text-right px-4 py-2">Còn lại</th>
                            <th className="text-right px-4 py-2 w-32">Giao lần này</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.lines.map(l => {
                            const selected = selectedLines[l.line_id] || 0;
                            const isSelected = selected > 0;
                            return (
                              <tr key={l.line_id} className={`border-t border-[#e5dfd1] ${isSelected ? "bg-[#dbe8f5]" : ""}`}>
                                <td className="px-4 py-3">
                                  <input type="checkbox" checked={isSelected} onChange={() => toggleLine(l.line_id)}
                                    className="w-4 h-4 accent-[#c4a962]" />
                                </td>
                                <td className="px-4 py-3">
                                  <div className="text-xs mono text-[#5a6578]">{l.po_id}</div>
                                  <div className="text-sm mt-0.5">{l.sku_name}</div>
                                  <div className="text-[10px] mono text-[#8a7c4f]">{l.sku_id} · ¥{l.price}/cái</div>
                                </td>
                                <td className="px-4 py-3 text-right mono text-xs">{l.ordered.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right mono text-xs text-[#4a7c59]">{l.delivered.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right mono text-xs font-medium text-[#d97757]">{l.remaining.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right">
                                  <input type="number" min="0" max={l.remaining} value={selected || ""}
                                    onChange={e => updateQty(l.line_id, e.target.value)}
                                    onClick={(e) => e.target.select()}
                                    placeholder="0"
                                    className={`w-24 px-2 py-1 mono text-sm text-right border ${isSelected ? "border-[#c4a962] bg-white" : "border-[#e5dfd1] bg-[#faf8f2]"} outline-none focus:border-[#c4a962]`} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}

              {/* Summary */}
              {totalQty > 0 && (
                <div className="mt-4 bg-[#1a2332] text-[#f5f2eb] p-4 flex items-center justify-between">
                  <div className="text-sm">
                    <span className="text-[#c4a962]">{selectedLineObjects.length}</span> SKU ·{" "}
                    <span className="text-[#c4a962] mono">{totalQty.toLocaleString()}</span> cái
                  </div>
                  <div className="mono text-lg">{formatCNY(totalFOB)}</div>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              {/* Summary card */}
              <div className="bg-white border border-[#e5dfd1]">
                <div className="p-5 border-b border-[#e5dfd1] bg-[#faf8f2]">
                  <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">Tóm tắt delivery</div>
                  <div className="flex items-center gap-4 mt-3">
                    <div className="text-4xl">{destination?.flag}</div>
                    <div className="flex-1">
                      <div className="text-lg font-medium">{destination?.country}</div>
                      <div className="text-xs text-[#5a6578] mono">{destination?.code} · ship {shippedDate}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-[#8a7c4f]">Tổng số lượng</div>
                      <div className="text-2xl mono font-medium">{totalQty.toLocaleString()}</div>
                    </div>
                  </div>
                </div>

                {/* Lines */}
                <div className="divide-y divide-[#e5dfd1]">
                  {selectedLineObjects.map(l => (
                    <div key={l.line_id} className="p-4 flex justify-between items-center">
                      <div className="flex-1">
                        <div className="text-xs mono text-[#5a6578]">{l.po_id}</div>
                        <div className="text-sm font-medium mt-0.5">{l.sku_name}</div>
                        <div className="text-[10px] mono text-[#8a7c4f]">{l.sku_id}</div>
                      </div>
                      <div className="text-right">
                        <div className="mono text-sm">{selectedLines[l.line_id]} × ¥{l.price}</div>
                        <div className="mono text-xs text-[#c4a962] mt-0.5">{formatCNY(selectedLines[l.line_id] * l.price)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Landed cost breakdown */}
              <div className="bg-[#1a2332] text-[#f5f2eb] p-5">
                <div className="text-xs uppercase tracking-wider text-[#c4a962] mb-3">Landed cost dự kiến tại {destination?.country}</div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[#c4cbd8]">Giá FOB (NCC)</span>
                    <span className="mono">{formatCNY(totalFOB)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#c4cbd8]">Freight: {totalQty} cái × ¥{freightRate}</span>
                    <span className="mono">{formatCNY(freightTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#c4cbd8]">VAT {(vatRate*100).toFixed(0)}% tại {destination?.country}</span>
                    <span className="mono">{formatCNY(vatTotal)}</span>
                  </div>
                  <div className="flex justify-between pt-3 border-t border-[#2a3547]">
                    <span>Tổng landed cost</span>
                    <span className="mono font-medium text-[#c4a962] text-lg">{formatCNY(landedTotal)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-[#8a96a8]">
                    <span>Giá vốn trung bình</span>
                    <span className="mono">{formatCNY(landedTotal / totalQty)} / cái</span>
                  </div>
                </div>
              </div>

              {/* Impact */}
              <div className="bg-[#f5ead0] border border-[#c4a962] p-4 text-xs">
                <div className="font-medium text-[#1a2332] mb-2">Khi xác nhận, hệ thống sẽ:</div>
                <ul className="space-y-1 text-[#5a6578]">
                  <li>• Tạo delivery mới với trạng thái <span className="font-medium">Đang trung chuyển</span></li>
                  <li>• Cập nhật số đã giao trên {selectedLineObjects.length} PO line</li>
                  <li>• Ghi nhận công nợ thực tế +{formatCNY(totalFOB)} cho NCC (theo ngày ship)</li>
                  <li>• Giảm công nợ cam kết tương ứng</li>
                  <li>• Khi hàng về, sẽ tự động tạo lot và cộng vào tồn kho {destination?.country}</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer navigation - always visible */}
        <div
          className="px-6 py-4 border-t border-[#e5dfd1] bg-white flex justify-between items-center"
          style={{ flexShrink: 0, boxShadow: "0 -2px 8px rgba(0,0,0,0.04)" }}
        >
          <div className="text-xs text-[#5a6578]">
            {step === 1 && "Bước 1/3: Chọn nước đích"}
            {step === 2 && `Bước 2/3: ${totalQty > 0 ? `Đã chọn ${totalQty} cái` : "Chọn hàng cần giao"}`}
            {step === 3 && "Bước 3/3: Xác nhận và tạo"}
          </div>
          <div className="flex gap-3">
            {step > 1 && (
              <button onClick={() => setStep(step - 1)} className="px-5 py-2 text-sm border border-[#5a6578] text-[#5a6578] hover:bg-[#faf8f2]">
                ← Quay lại
              </button>
            )}
            <button onClick={onClose} className="px-5 py-2 text-sm text-[#5a6578] hover:text-[#1a2332]">
              Hủy
            </button>
            {step < 3 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={step === 1 ? !canProceedStep1 : !canProceedStep2}
                className="px-6 py-2 text-sm bg-[#1a2332] text-[#f5f2eb] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#2a3547]">
                Tiếp tục →
              </button>
            ) : (
              <button onClick={handleSubmit}
                className="px-6 py-2 text-sm bg-[#c4a962] text-[#1a2332] hover:bg-[#b8a056] font-medium">
                Tạo delivery
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NewPaymentModal({ pos, payments, supplierDebts, suppliers, onClose, onCreate }) {
  const TODAY = "2026-04-20";
  const [supplierId, setSupplierId] = useState(null);
  const [paymentDate, setPaymentDate] = useState(TODAY);
  const [amountCNY, setAmountCNY] = useState("");
  const [fundSource, setFundSource] = useState("");
  const [applyMode, setApplyMode] = useState("auto"); // auto | single | multi
  const [selectedPOs, setSelectedPOs] = useState([]); // [{po_id, applied_amount}]
  const [note, setNote] = useState("");

  const supplier = supplierId ? getSupplier(supplierId) : null;
  const debt = supplierId ? supplierDebts[supplierId] : null;
  const actual = debt ? debt.shipped - debt.paid : 0;

  // Tính số còn nợ từng PO của NCC
  const supplierPOsWithDebt = useMemo(() => {
    if (!supplierId) return [];
    const poList = pos.filter(p => p.supplier_id === supplierId);
    // Đã trả tính lũy tiến từ PO cũ nhất (FIFO)
    const sorted = [...poList].sort((a, b) => new Date(a.po_date) - new Date(b.po_date));
    let remainingPaid = debt ? debt.paid : 0;
    return sorted.map(po => {
      const shipped = po.lines.reduce((s, l) => s + l.delivered * l.price, 0);
      const appliedFromPaid = Math.min(shipped, remainingPaid);
      remainingPaid -= appliedFromPaid;
      const owed = shipped - appliedFromPaid;
      return { po, shipped, paid_applied: appliedFromPaid, owed };
    }).filter(x => x.owed > 0);
  }, [supplierId, pos, debt]);

  const amount = parseFloat(amountCNY) || 0;

  // Auto mode: tự phân bổ từ PO cũ nhất
  const autoAllocation = useMemo(() => {
    if (applyMode !== "auto" || !amount) return [];
    let remaining = amount;
    const result = [];
    supplierPOsWithDebt.forEach(x => {
      if (remaining <= 0) return;
      const applied = Math.min(remaining, x.owed);
      result.push({ po_id: x.po.id, po_date: x.po.po_date, owed: x.owed, applied });
      remaining -= applied;
    });
    return result;
  }, [applyMode, amount, supplierPOsWithDebt]);

  const totalApplied = applyMode === "auto"
    ? autoAllocation.reduce((s, x) => s + x.applied, 0)
    : applyMode === "single"
      ? (selectedPOs[0]?.applied_amount || 0)
      : selectedPOs.reduce((s, p) => s + (p.applied_amount || 0), 0);

  const remainingAmount = amount - totalApplied;

  const togglePO = (po_id) => {
    if (applyMode === "single") {
      const x = supplierPOsWithDebt.find(p => p.po.id === po_id);
      setSelectedPOs([{ po_id, applied_amount: Math.min(amount || x.owed, x.owed) }]);
    } else {
      setSelectedPOs(prev => {
        const exists = prev.find(p => p.po_id === po_id);
        if (exists) return prev.filter(p => p.po_id !== po_id);
        const x = supplierPOsWithDebt.find(p => p.po.id === po_id);
        const stillAvailable = amount - prev.reduce((s, p) => s + p.applied_amount, 0);
        return [...prev, { po_id, applied_amount: Math.min(x.owed, stillAvailable) }];
      });
    }
  };

  const updateAppliedAmount = (po_id, val) => {
    const x = supplierPOsWithDebt.find(p => p.po.id === po_id);
    const clean = Math.max(0, Math.min(x.owed, parseFloat(val) || 0));
    setSelectedPOs(prev => prev.map(p => p.po_id === po_id ? { ...p, applied_amount: clean } : p));
  };

  const canSubmit = supplierId && amount > 0 && fundSource && paymentDate && (
    applyMode === "auto"
      ? autoAllocation.length > 0
      : selectedPOs.length > 0 && Math.abs(remainingAmount) < 0.01
  );

  const handleSubmit = () => {
    const appliedPOs = applyMode === "auto"
      ? autoAllocation.map(x => x.po_id)
      : selectedPOs.map(p => p.po_id);
    const newPayment = {
      id: `PAY-${String(payments.length + 1).padStart(3, '0')}`,
      supplier_id: supplierId,
      date: paymentDate,
      amount_cny: amount,
      rate: CNY_VND_RATE,
      fund_source: fundSource,
      applied_po: appliedPOs,
      apply_mode: applyMode,
      note,
    };
    onCreate(newPayment);
  };

  const fundSources = [
    { id: "pingpong", label: "Pingpong", desc: "Cổng thanh toán xuyên biên giới", icon: "💳" },
    { id: "tien_nhap_khau", label: "Tiền nhập khẩu", desc: "Tài khoản nhập khẩu ngân hàng", icon: "🏦" },
    { id: "khac", label: "Khác", desc: "Nguồn khác (tiền mặt, wechat, chuyển khoản nội bộ...)", icon: "💼" },
  ];

  return (
    <div className="fixed inset-0 bg-[#1e4d7b]/98 backdrop-blur-md flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div
        className="bg-[#7fa8d1] animate-in"
        style={{ width: "820px", maxWidth: "100%", height: "92vh", display: "flex", flexDirection: "column" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-[#e5dfd1] flex justify-between items-start bg-[#1a2332] text-[#f5f2eb]" style={{ flexShrink: 0 }}>
          <div>
            <div className="text-xs uppercase tracking-wider text-[#c4a962]">Accounts Payable</div>
            <div className="text-2xl font-medium mt-1">Ghi nhận thanh toán</div>
            <div className="text-xs text-[#c4cbd8] mt-1">Thanh toán CNY cho NCC · Tỷ giá hôm nay: 1 CNY = {CNY_VND_RATE} VND</div>
          </div>
          <button onClick={onClose} className="text-[#c4cbd8] hover:text-[#f5f2eb]"><X size={20} /></button>
        </div>

        {/* Body - scrollable */}
        <div className="p-6 space-y-6" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
          {/* Supplier selection */}
          <div>
            <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Nhà cung cấp *</label>
            <div className="grid grid-cols-3 gap-3">
              {suppliers.filter(s => s.status !== "inactive").map(s => {
                const d = supplierDebts[s.id] || { committed: 0, shipped: 0, paid: 0 };
                const owed = d.shipped - d.paid;
                const active = supplierId === s.id;
                return (
                  <button key={s.id} onClick={() => { setSupplierId(s.id); setSelectedPOs([]); }}
                    className="p-4 border text-left transition-all"
                    style={active ? { borderColor: "#4a7bb8", backgroundColor: "#dbe8f5", borderWidth: "2px" } : { borderColor: "#e5dfd1", backgroundColor: "#ffffff" }}>
                    <div className="text-xs mono text-[#8a7c4f]">{s.id}</div>
                    <div className="text-sm font-medium mt-1">{s.name}</div>
                    <div className="mt-2 pt-2 border-t border-[#e5dfd1] text-xs">
                      <span className="text-[#5a6578]">Đang nợ: </span>
                      <span className="mono" style={{ color: owed > 0 ? "#d97757" : "#4a7c59" }}>{formatCNY(owed)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {supplierId && (
            <>
              {/* Date + Amount + Fund source */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Ngày thanh toán *</label>
                  <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)}
                    className="w-full px-4 py-3 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm mono" />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Số tiền CNY *</label>
                  <input type="number" value={amountCNY} onChange={e => setAmountCNY(e.target.value)}
                    placeholder="0" min="0"
                    className="w-full px-4 py-3 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm mono" />
                  {amount > 0 && (
                    <div className="text-[10px] text-[#5a6578] mt-1 mono">≈ {formatVND(amount * CNY_VND_RATE)}</div>
                  )}
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Tỷ giá áp dụng</label>
                  <div className="px-4 py-3 bg-[#f5f2eb] border border-[#e5dfd1] text-sm mono text-[#5a6578]">
                    {CNY_VND_RATE} VND/CNY
                  </div>
                  <div className="text-[10px] text-[#8a7c4f] mt-1 italic">Tỷ giá hôm nay, tự động</div>
                </div>
              </div>

              {/* Fund source */}
              <div>
                <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Nguồn tiền thanh toán *</label>
                <div className="grid grid-cols-3 gap-3">
                  {fundSources.map(src => {
                    const active = fundSource === src.id;
                    return (
                      <button key={src.id} onClick={() => setFundSource(src.id)}
                        className="p-4 border text-left transition-all"
                    style={active ? { borderColor: "#4a7bb8", backgroundColor: "#dbe8f5", borderWidth: "2px" } : { borderColor: "#e5dfd1", backgroundColor: "#ffffff" }}>
                        <div className="text-2xl mb-2">{src.icon}</div>
                        <div className="text-sm font-medium">{src.label}</div>
                        <div className="text-[10px] text-[#5a6578] mt-1 leading-snug">{src.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Apply mode */}
              <div>
                <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Cách áp thanh toán vào PO *</label>
                <div className="flex gap-2 bg-white border border-[#e5dfd1]">
                  {[
                    { id: "auto", label: "Tự động (FIFO)", desc: "Áp từ PO cũ nhất" },
                    { id: "single", label: "Chọn 1 PO", desc: "Chỉ áp cho 1 PO" },
                    { id: "multi", label: "Chia nhiều PO", desc: "Tự chia số tiền" },
                  ].map(m => {
                    const active = applyMode === m.id;
                    return (
                      <button key={m.id} onClick={() => { setApplyMode(m.id); setSelectedPOs([]); }}
                        className={`flex-1 px-4 py-3 text-left transition-colors ${active ? "bg-[#1a2332] text-[#f5f2eb]" : "text-[#5a6578] hover:bg-[#faf8f2]"}`}>
                        <div className="text-sm font-medium">{m.label}</div>
                        <div className={`text-[10px] mt-0.5 ${active ? "text-[#c4cbd8]" : "text-[#8a7c4f]"}`}>{m.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* PO selection / auto display */}
              {supplierPOsWithDebt.length === 0 ? (
                <div className="bg-[#e0ede4] border border-[#4a7c59] p-4 text-sm text-[#4a7c59] flex items-center gap-3">
                  <CheckCircle2 size={16} />
                  <span>NCC này hiện không còn công nợ thực tế nào cần thanh toán</span>
                </div>
              ) : applyMode === "auto" ? (
                <div>
                  <div className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2">Phân bổ tự động</div>
                  {!amount ? (
                    <div className="bg-white border border-[#e5dfd1] p-4 text-xs text-[#8a96a8] italic text-center">
                      Nhập số tiền để xem phân bổ tự động
                    </div>
                  ) : (
                    <div className="bg-white border border-[#e5dfd1]">
                      {autoAllocation.map((x, i) => {
                        const full = x.applied >= x.owed;
                        return (
                          <div key={x.po_id} className={`p-3 flex items-center justify-between ${i < autoAllocation.length - 1 ? "border-b border-[#e5dfd1]" : ""}`}>
                            <div className="flex items-center gap-3">
                              <div className="text-xs mono">{x.po_id}</div>
                              <div className="text-[10px] text-[#5a6578]">đặt {x.po_date}</div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-xs text-[#5a6578]">Còn nợ: <span className="mono">{formatCNY(x.owed)}</span></div>
                              <div className="text-sm mono font-medium text-[#c4a962]">{formatCNY(x.applied)}</div>
                              {full && <span className="text-[10px] px-2 py-0.5 bg-[#e0ede4] text-[#4a7c59] uppercase">Hết nợ</span>}
                            </div>
                          </div>
                        );
                      })}
                      {remainingAmount > 0.01 && (
                        <div className="p-3 bg-[#fae5dd] text-xs text-[#d97757] flex items-center gap-2 border-t border-[#e5dfd1]">
                          <AlertTriangle size={12} />
                          <span>Còn <span className="mono">{formatCNY(remainingAmount)}</span> dư chưa áp được (vượt công nợ thực tế của NCC)</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">
                      Chọn PO {applyMode === "single" ? "(chỉ 1)" : "(có thể chọn nhiều)"}
                    </div>
                    {applyMode === "multi" && amount > 0 && (
                      <div className="text-xs">
                        Đã áp: <span className="mono font-medium">{formatCNY(totalApplied)}</span>
                        <span className="text-[#5a6578]"> / {formatCNY(amount)}</span>
                        {Math.abs(remainingAmount) > 0.01 && (
                          <span className="ml-2 mono" style={{ color: remainingAmount > 0 ? "#d97757" : "#d97757" }}>
                            ({remainingAmount > 0 ? "còn dư" : "vượt"} {formatCNY(Math.abs(remainingAmount))})
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="bg-white border border-[#e5dfd1]">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-[#faf8f2] text-[10px] uppercase tracking-wider text-[#8a7c4f]">
                          <th className="text-left px-3 py-2 w-10"></th>
                          <th className="text-left px-3 py-2">PO</th>
                          <th className="text-left px-3 py-2">Ngày đặt</th>
                          <th className="text-right px-3 py-2">Còn nợ</th>
                          <th className="text-right px-3 py-2 w-36">Số tiền áp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supplierPOsWithDebt.map(x => {
                          const selected = selectedPOs.find(p => p.po_id === x.po.id);
                          const isSelected = !!selected;
                          return (
                            <tr key={x.po.id} className={`border-t border-[#e5dfd1] ${isSelected ? "bg-[#dbe8f5]" : ""}`}>
                              <td className="px-3 py-2">
                                <input
                                  type={applyMode === "single" ? "radio" : "checkbox"}
                                  name="po-select"
                                  checked={isSelected}
                                  onChange={() => togglePO(x.po.id)}
                                  className="w-4 h-4 accent-[#c4a962]"
                                />
                              </td>
                              <td className="px-3 py-2 mono text-xs">{x.po.id}</td>
                              <td className="px-3 py-2 text-xs text-[#5a6578] mono">{x.po.po_date}</td>
                              <td className="px-3 py-2 text-right mono text-xs">{formatCNY(x.owed)}</td>
                              <td className="px-3 py-2 text-right">
                                {isSelected ? (
                                  <input type="number" min="0" max={x.owed}
                                    value={selected.applied_amount}
                                    onChange={e => updateAppliedAmount(x.po.id, e.target.value)}
                                    onClick={e => e.target.select()}
                                    className="w-28 px-2 py-1 mono text-sm text-right border border-[#c4a962] bg-white outline-none" />
                                ) : (
                                  <span className="text-[10px] text-[#8a96a8]">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Note */}
              <div>
                <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Ghi chú (tùy chọn)</label>
                <input type="text" value={note} onChange={e => setNote(e.target.value)}
                  placeholder="VD: Thanh toán đợt cuối PO-2026-001"
                  className="w-full px-4 py-3 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm" />
              </div>

              {/* Summary */}
              {canSubmit && (
                <div className="bg-[#1a2332] text-[#f5f2eb] p-5">
                  <div className="text-xs uppercase tracking-wider text-[#c4a962] mb-3">Tóm tắt giao dịch</div>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between"><span className="text-[#c4cbd8]">NCC</span><span>{supplier.name}</span></div>
                    <div className="flex justify-between"><span className="text-[#c4cbd8]">Ngày</span><span className="mono">{paymentDate}</span></div>
                    <div className="flex justify-between"><span className="text-[#c4cbd8]">Nguồn tiền</span><span>{fundSources.find(f => f.id === fundSource)?.label}</span></div>
                    <div className="flex justify-between"><span className="text-[#c4cbd8]">Số tiền</span><span className="mono">{formatCNY(amount)}</span></div>
                    <div className="flex justify-between"><span className="text-[#c4cbd8]">Quy đổi VND</span><span className="mono text-[#c4a962]">{formatVND(amount * CNY_VND_RATE)}</span></div>
                    <div className="flex justify-between pt-2 border-t border-[#2a3547]">
                      <span className="text-[#c4cbd8]">Áp cho</span>
                      <span className="mono">
                        {applyMode === "auto" ? autoAllocation.length : selectedPOs.length} PO
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 border-t border-[#e5dfd1] bg-white flex justify-between items-center"
          style={{ flexShrink: 0, boxShadow: "0 -2px 8px rgba(0,0,0,0.04)" }}
        >
          <div className="text-xs text-[#5a6578]">
            {!supplierId && "Chọn nhà cung cấp để bắt đầu"}
            {supplierId && !amount && "Nhập số tiền thanh toán"}
            {supplierId && amount > 0 && !fundSource && "Chọn nguồn tiền"}
            {canSubmit && "Sẵn sàng ghi nhận"}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-5 py-2 text-sm text-[#5a6578] hover:text-[#1a2332]">Hủy</button>
            <button onClick={handleSubmit} disabled={!canSubmit}
              className="px-6 py-2 text-sm bg-[#c4a962] text-[#1a2332] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#b8a056] font-medium">
              Ghi nhận thanh toán
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


function NewPOModal({ pos, suppliers, onClose, onCreate }) {
  const TODAY = "2026-04-20";
  const [step, setStep] = useState(1);
  const [supplierId, setSupplierId] = useState(null);
  const [poDate, setPoDate] = useState(TODAY);
  const [notes, setNotes] = useState("");
  // selectedLines: { [sku_id]: { qty, price } }
  const [selectedLines, setSelectedLines] = useState({});
  const [skuSearch, setSkuSearch] = useState("");

  const supplier = supplierId ? getSupplier(supplierId) : null;

  const toggleSKU = (skuId) => {
    setSelectedLines(prev => {
      const next = { ...prev };
      if (next[skuId]) delete next[skuId];
      else {
        const sku = getSKU(skuId);
        next[skuId] = { qty: "", price: sku.price_cny };
      }
      return next;
    });
  };

  const updateLine = (skuId, field, value) => {
    setSelectedLines(prev => ({
      ...prev,
      [skuId]: { ...prev[skuId], [field]: field === "qty" ? parseInt(value) || 0 : parseFloat(value) || 0 }
    }));
  };

  const selectedSKUList = Object.entries(selectedLines).map(([sku_id, data]) => ({
    sku_id, ...data, sku: getSKU(sku_id)
  }));
  const totalValue = selectedSKUList.reduce((s, l) => s + (l.qty || 0) * (l.price || 0), 0);
  const totalQty = selectedSKUList.reduce((s, l) => s + (l.qty || 0), 0);

  const canProceedStep1 = supplierId && poDate;
  const canProceedStep2 = selectedSKUList.length > 0 && selectedSKUList.every(l => l.qty > 0 && l.price > 0);

  // Preview mã PO sẽ được sinh (để hiển thị ở bước xác nhận)
  const previewPOId = useMemo(() => {
    if (!poDate) return "";
    const d = new Date(poDate);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const datePrefix = `PO-${year}-${month}-${day}-`;
    const existingToday = pos.filter(p => p.id.startsWith(datePrefix)).length;
    return `${datePrefix}${String(existingToday + 1).padStart(3, "0")}`;
  }, [poDate, pos]);

  const handleSubmit = () => {
    const newId = previewPOId;

    const newPO = {
      id: newId,
      supplier_id: supplierId,
      po_date: poDate,
      status: "confirmed",
      currency: "CNY",
      notes: notes || undefined,
      lines: selectedSKUList.map((l, idx) => ({
        id: `${newId.replace("PO-", "POL-")}-${idx + 1}`,
        sku_id: l.sku_id,
        qty: l.qty,
        price: l.price,
        delivered: 0,
      })),
    };
    onCreate(newPO);
  };

  return (
    <div className="fixed inset-0 bg-[#1e4d7b]/98 backdrop-blur-md flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div
        className="bg-[#7fa8d1] animate-in"
        style={{ width: "880px", maxWidth: "100%", height: "92vh", display: "flex", flexDirection: "column" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-[#e5dfd1] flex justify-between items-start bg-[#1a2332] text-[#f5f2eb]" style={{ flexShrink: 0 }}>
          <div>
            <div className="text-xs uppercase tracking-wider text-[#c4a962]">Purchasing</div>
            <div className="text-2xl font-medium mt-1">Tạo PO mới</div>
            <div className="text-xs text-[#c4cbd8] mt-1">Đơn đặt hàng với nhà cung cấp Trung Quốc · Bằng CNY</div>
          </div>
          <button onClick={onClose} className="text-[#c4cbd8] hover:text-[#f5f2eb]"><X size={20} /></button>
        </div>

        {/* Stepper */}
        <div className="flex border-b border-[#e5dfd1] bg-white" style={{ flexShrink: 0 }}>
          {[
            { num: 1, label: "Nhà cung cấp" },
            { num: 2, label: "Chọn SKU & số lượng" },
            { num: 3, label: "Xác nhận" },
          ].map(s => (
            <div key={s.num} className="flex-1 px-5 py-4 flex items-center gap-3 border-r border-[#e5dfd1] last:border-r-0"
              style={step === s.num ? { backgroundColor: "#dbe8f5" } : {}}>
              <div className="w-7 h-7 flex items-center justify-center text-xs mono"
                style={
                  step > s.num ? { backgroundColor: "#4a7c59", color: "#ffffff" } :
                  step === s.num ? { backgroundColor: "#4a7bb8", color: "#ffffff" } :
                  { backgroundColor: "#e5dfd1", color: "#8a7c4f" }
                }>
                {step > s.num ? "✓" : s.num}
              </div>
              <div>
                <div className={`text-xs uppercase tracking-wider ${step === s.num ? "text-[#1a2332]" : "text-[#8a7c4f]"}`}>Bước {s.num}</div>
                <div className={`text-sm ${step === s.num ? "font-medium" : "text-[#5a6578]"}`}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="p-6" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-3 block">Nhà cung cấp *</label>
                <div className="grid grid-cols-3 gap-3">
                  {suppliers.filter(s => s.status !== "inactive").map(s => {
                    const active = supplierId === s.id;
                    const openPOs = pos.filter(p => p.supplier_id === s.id && p.status !== "received" && p.status !== "closed").length;
                    return (
                      <button key={s.id} onClick={() => setSupplierId(s.id)}
                        className="p-4 border text-left transition-all"
                    style={active ? { borderColor: "#4a7bb8", backgroundColor: "#dbe8f5", borderWidth: "2px" } : { borderColor: "#e5dfd1", backgroundColor: "#ffffff" }}>
                        <div className="text-xs mono text-[#8a7c4f]">{s.id}</div>
                        <div className="text-sm font-medium mt-1">{s.name}</div>
                        <div className="text-xs text-[#5a6578] mt-1">{s.country} · {s.currency}</div>
                        <div className="mt-2 pt-2 border-t border-[#e5dfd1] text-xs">
                          <span className="text-[#5a6578]">PO đang mở: </span>
                          <span className="mono">{openPOs}</span>
                        </div>
                        <div className="text-[10px] text-[#5a6578] mt-1">Điều khoản: {s.terms} ngày</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Ngày PO *</label>
                  <input type="date" value={poDate} onChange={e => setPoDate(e.target.value)}
                    className="w-full px-4 py-3 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm mono" />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Đơn vị tiền</label>
                  <div className="px-4 py-3 bg-[#f5f2eb] border border-[#e5dfd1] text-sm mono text-[#5a6578]">CNY</div>
                </div>
              </div>

              <div>
                <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Ghi chú (tùy chọn)</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="VD: Giao trước Tết Âm · Đóng thùng riêng theo SKU"
                  rows={3}
                  className="w-full px-4 py-3 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm resize-none" />
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">
                  Danh sách SKU · Chọn và nhập số lượng + giá
                </div>
                {Object.keys(selectedLines).length > 0 && (
                  <div className="text-xs text-[#5a6578]">
                    Đã chọn: <span className="font-medium text-[#c4a962] mono">{Object.keys(selectedLines).length}</span>
                  </div>
                )}
              </div>

              {/* Search bar */}
              <div className="bg-white border border-[#e5dfd1] flex items-center gap-2 px-4 mb-3">
                <Search size={14} className="text-[#8a96a8]" />
                <input type="text" placeholder="Tìm theo mã SKU hoặc tên (VI/EN/CN)..."
                  value={skuSearch}
                  onChange={e => setSkuSearch(e.target.value)}
                  className="flex-1 py-2.5 bg-transparent outline-none text-sm" />
                {skuSearch && (
                  <button onClick={() => setSkuSearch("")} className="text-[#8a96a8] hover:text-[#1a2332]">
                    <X size={14} />
                  </button>
                )}
              </div>

              {(() => {
                const activeSKUs = SEED_SKUS.filter(s => s.status !== "discontinued");
                const q = skuSearch.trim().toLowerCase();
                const filtered = q
                  ? activeSKUs.filter(s =>
                      s.id.toLowerCase().includes(q) ||
                      s.name.toLowerCase().includes(q) ||
                      (s.name_en || "").toLowerCase().includes(q) ||
                      (s.name_cn || "").toLowerCase().includes(q)
                    )
                  : activeSKUs;

                // Đưa các SKU đã chọn lên đầu để dễ thấy khi search
                const sorted = [...filtered].sort((a, b) => {
                  const aSel = !!selectedLines[a.id];
                  const bSel = !!selectedLines[b.id];
                  if (aSel && !bSel) return -1;
                  if (!aSel && bSel) return 1;
                  return 0;
                });

                return (
                  <div className="bg-white border border-[#e5dfd1]">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-[#faf8f2] text-[10px] uppercase tracking-wider text-[#8a7c4f]">
                          <th className="text-left px-4 py-3 w-10"></th>
                          <th className="text-left px-4 py-3">SKU</th>
                          <th className="text-right px-4 py-3 w-28">Số lượng</th>
                          <th className="text-right px-4 py-3 w-28">Đơn giá CNY</th>
                          <th className="text-right px-4 py-3 w-32">Thành tiền</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.length === 0 ? (
                          <tr>
                            <td colSpan="5" className="px-4 py-8 text-center text-xs text-[#5a6578]">
                              Không tìm thấy SKU nào khớp "<span className="mono">{skuSearch}</span>"
                            </td>
                          </tr>
                        ) : sorted.map(sku => {
                          const line = selectedLines[sku.id];
                          const isSelected = !!line;
                          const lineTotal = isSelected ? (line.qty || 0) * (line.price || 0) : 0;
                          return (
                            <tr key={sku.id} className={`border-t border-[#e5dfd1] ${isSelected ? "bg-[#dbe8f5]" : ""}`}>
                              <td className="px-4 py-3">
                                <input type="checkbox" checked={isSelected} onChange={() => toggleSKU(sku.id)}
                                  className="w-4 h-4 accent-[#c4a962]" />
                              </td>
                              <td className="px-4 py-3">
                                <div className="text-xs mono text-[#8a7c4f]">{sku.id}</div>
                                <div className="text-sm mt-0.5 font-medium">{sku.name}</div>
                                {(sku.name_en || sku.name_cn) && (
                                  <div className="text-[10px] text-[#5a6578] mt-0.5">
                                    {sku.name_en && <span>🇬🇧 {sku.name_en}</span>}
                                    {sku.name_en && sku.name_cn && <span className="mx-1">·</span>}
                                    {sku.name_cn && <span>🇨🇳 {sku.name_cn}</span>}
                                  </div>
                                )}
                                <div className="text-[10px] text-[#5a6578] mt-0.5">Giá gợi ý: ¥{sku.price_cny}/{sku.unit}</div>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <input type="number" min="0" value={line?.qty || ""}
                                  disabled={!isSelected}
                                  onChange={e => updateLine(sku.id, "qty", e.target.value)}
                                  onClick={e => e.target.select()}
                                  placeholder="0"
                                  className={`w-24 px-2 py-1 mono text-sm text-right border outline-none ${isSelected ? "border-[#c4a962] bg-white focus:border-[#c4a962]" : "border-[#e5dfd1] bg-[#f5f2eb] text-[#8a96a8]"}`} />
                              </td>
                              <td className="px-4 py-3 text-right">
                                <input type="number" min="0" step="0.01" value={line?.price || ""}
                                  disabled={!isSelected}
                                  onChange={e => updateLine(sku.id, "price", e.target.value)}
                                  onClick={e => e.target.select()}
                                  className={`w-24 px-2 py-1 mono text-sm text-right border outline-none ${isSelected ? "border-[#c4a962] bg-white focus:border-[#c4a962]" : "border-[#e5dfd1] bg-[#f5f2eb] text-[#8a96a8]"}`} />
                              </td>
                              <td className="px-4 py-3 text-right mono text-sm">
                                {lineTotal > 0 ? formatCNY(lineTotal) : <span className="text-[#8a96a8]">—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}

              {selectedSKUList.length > 0 && (
                <div className="mt-4 bg-[#1a2332] text-[#f5f2eb] p-4 flex items-center justify-between">
                  <div className="text-sm">
                    <span className="text-[#c4a962]">{selectedSKUList.length}</span> SKU ·{" "}
                    <span className="text-[#c4a962] mono">{totalQty.toLocaleString()}</span> cái
                  </div>
                  <div className="mono text-lg">{formatCNY(totalValue)}</div>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="bg-white border border-[#e5dfd1]">
                <div className="p-5 border-b border-[#e5dfd1] bg-[#faf8f2]">
                  <div className="flex items-center justify-between">
                    <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">Tóm tắt PO</div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-[#8a7c4f]">Mã PO:</span>
                      <span className="text-sm mono font-medium text-[#1a2332] bg-[#f5ead0] px-3 py-1 border border-[#c4a962]">
                        {previewPOId}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mt-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#8a7c4f]">NCC</div>
                      <div className="text-sm font-medium mt-1">{supplier?.name}</div>
                      <div className="text-[10px] text-[#5a6578] mono mt-0.5">{supplier?.id}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#8a7c4f]">Ngày PO</div>
                      <div className="text-sm mono mt-1">{poDate}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-[#8a7c4f]">Tổng giá trị</div>
                      <div className="text-2xl mono font-medium text-[#c4a962] mt-1">{formatCNY(totalValue)}</div>
                      <div className="text-[10px] text-[#5a6578] mono">≈ {formatVND(totalValue * CNY_VND_RATE)}</div>
                    </div>
                  </div>
                  {notes && (
                    <div className="mt-4 pt-3 border-t border-[#e5dfd1] text-xs">
                      <span className="text-[#8a7c4f] uppercase tracking-wider">Ghi chú: </span>
                      <span className="text-[#5a6578] italic">{notes}</span>
                    </div>
                  )}
                </div>

                <div className="divide-y divide-[#e5dfd1]">
                  {selectedSKUList.map(l => (
                    <div key={l.sku_id} className="p-4 flex justify-between items-center">
                      <div className="flex-1">
                        <div className="text-xs mono text-[#8a7c4f]">{l.sku_id}</div>
                        <div className="text-sm font-medium mt-0.5">{l.sku?.name}</div>
                      </div>
                      <div className="text-right">
                        <div className="mono text-sm">{l.qty} × ¥{l.price}</div>
                        <div className="mono text-xs text-[#c4a962] mt-0.5">{formatCNY(l.qty * l.price)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[#f5ead0] border border-[#c4a962] p-4 text-xs">
                <div className="font-medium text-[#1a2332] mb-2">Khi xác nhận, hệ thống sẽ:</div>
                <ul className="space-y-1 text-[#5a6578]">
                  <li>• Tạo PO mới với trạng thái <span className="font-medium">Đã xác nhận</span></li>
                  <li>• Tăng công nợ cam kết +{formatCNY(totalValue)} cho NCC</li>
                  <li>• PO sẽ xuất hiện trong danh sách đặt hàng, sẵn sàng để tạo delivery sau</li>
                  <li>• Chưa phát sinh công nợ thực tế (chỉ khi NCC ship hàng)</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 border-t border-[#e5dfd1] bg-white flex justify-between items-center"
          style={{ flexShrink: 0, boxShadow: "0 -2px 8px rgba(0,0,0,0.04)" }}
        >
          <div className="text-xs text-[#5a6578]">
            {step === 1 && "Bước 1/3: Chọn NCC và ngày PO"}
            {step === 2 && `Bước 2/3: ${selectedSKUList.length > 0 ? `Đã chọn ${selectedSKUList.length} SKU · ${formatCNY(totalValue)}` : "Chọn SKU và nhập số lượng"}`}
            {step === 3 && "Bước 3/3: Xác nhận và tạo"}
          </div>
          <div className="flex gap-3">
            {step > 1 && (
              <button onClick={() => setStep(step - 1)} className="px-5 py-2 text-sm border border-[#5a6578] text-[#5a6578] hover:bg-[#faf8f2]">
                ← Quay lại
              </button>
            )}
            <button onClick={onClose} className="px-5 py-2 text-sm text-[#5a6578] hover:text-[#1a2332]">
              Hủy
            </button>
            {step < 3 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={step === 1 ? !canProceedStep1 : !canProceedStep2}
                className="px-6 py-2 text-sm bg-[#1a2332] text-[#f5f2eb] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#2a3547]">
                Tiếp tục →
              </button>
            ) : (
              <button onClick={handleSubmit}
                className="px-6 py-2 text-sm bg-[#c4a962] text-[#1a2332] hover:bg-[#b8a056] font-medium">
                Tạo PO
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductsView({ skus, pos, inventory, setModal, onToggleStatus }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 5;

  // Tính usage metrics cho mỗi SKU
  const skuMetrics = useMemo(() => {
    const m = {};
    skus.forEach(s => { m[s.id] = { po_count: 0, total_ordered: 0, in_stock: 0 }; });
    pos.forEach(po => {
      po.lines.forEach(line => {
        if (!m[line.sku_id]) return;
        m[line.sku_id].po_count += 1;
        m[line.sku_id].total_ordered += line.qty;
      });
    });
    inventory.forEach(i => {
      if (!m[i.sku_id]) return;
      m[i.sku_id].in_stock += (i.qty - i.committed);
    });
    return m;
  }, [skus, pos, inventory]);

  // Filter + search
  const filtered = skus.filter(s => {
    if (statusFilter !== "all" && s.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.id.toLowerCase().includes(q) ||
             s.name.toLowerCase().includes(q) ||
             (s.name_en || "").toLowerCase().includes(q) ||
             (s.name_cn || "").toLowerCase().includes(q);
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const activeCount = skus.filter(s => s.status === "active").length;
  const discontinuedCount = skus.filter(s => s.status === "discontinued").length;

  return (
    <div className="p-10 animate-in">
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-[#8a7c4f]">Products</div>
          <h1 className="text-4xl font-light mt-2">Danh mục sản phẩm</h1>
          <p className="text-sm text-[#5a6578] mt-2">Quản lý SKU · Tên đa ngôn ngữ · Giá gợi ý mua từ NCC</p>
        </div>
        <button onClick={() => setModal({ type: "new_sku" })} className="flex items-center gap-2 bg-[#1a2332] text-[#f5f2eb] px-5 py-3 text-sm hover:bg-[#2a3547]">
          <Plus size={14} /> Thêm SKU mới
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-[#e5dfd1] p-5">
          <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">Tổng SKU</div>
          <div className="text-2xl mono mt-2 font-medium">{skus.length}</div>
          <div className="text-xs text-[#5a6578] mt-1">{activeCount} đang kinh doanh · {discontinuedCount} ngừng</div>
        </div>
        <div className="bg-white border border-[#e5dfd1] p-5">
          <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">Active</div>
          <div className="text-2xl mono mt-2 font-medium text-[#4a7c59]">{activeCount}</div>
          <div className="text-xs text-[#5a6578] mt-1">Có thể đặt mua từ NCC</div>
        </div>
        <div className="bg-white border border-[#e5dfd1] p-5">
          <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">Discontinued</div>
          <div className="text-2xl mono mt-2 font-medium text-[#8a96a8]">{discontinuedCount}</div>
          <div className="text-xs text-[#5a6578] mt-1">Không đặt mới · Vẫn bán tồn còn</div>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-4 mb-6">
        <div className="flex-1 bg-white border border-[#e5dfd1] flex items-center gap-2 px-4">
          <Search size={14} className="text-[#8a96a8]" />
          <input type="text" placeholder="Tìm theo mã, tên VI/EN/CN..." value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="flex-1 py-3 bg-transparent outline-none text-sm" />
        </div>
        <div className="flex bg-white border border-[#e5dfd1]">
          {[
            { id: "all", label: "Tất cả" },
            { id: "active", label: "Đang kinh doanh" },
            { id: "discontinued", label: "Đã ngừng" },
          ].map(f => (
            <button key={f.id} onClick={() => { setStatusFilter(f.id); setPage(1); }}
              className={`px-4 py-3 text-xs ${statusFilter === f.id ? "bg-[#1a2332] text-[#f5f2eb]" : "text-[#5a6578] hover:bg-[#faf8f2]"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-[#e5dfd1]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#faf8f2] text-xs uppercase tracking-wider text-[#8a7c4f]">
              <th className="text-left px-4 py-3 w-16">Ảnh</th>
              <th className="text-left px-4 py-3">SKU</th>
              <th className="text-left px-4 py-3">Tên sản phẩm</th>
              <th className="text-right px-4 py-3">Giá CNY</th>
              <th className="text-right px-4 py-3">Trọng lượng</th>
              <th className="text-left px-4 py-3">Đơn vị</th>
              <th className="text-right px-4 py-3">PO đã dùng</th>
              <th className="text-right px-4 py-3">Tồn khả dụng</th>
              <th className="text-left px-4 py-3">Trạng thái</th>
              <th className="text-right px-4 py-3 w-28">Hành động</th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr><td colSpan="10" className="px-6 py-10 text-center text-[#5a6578]">Không có SKU phù hợp</td></tr>
            ) : paged.map(sku => {
              const metrics = skuMetrics[sku.id];
              const isDiscontinued = sku.status === "discontinued";
              return (
                <tr key={sku.id} className={`border-t border-[#e5dfd1] hover:bg-[#faf8f2] ${isDiscontinued ? "opacity-60" : ""}`}
                  style={{ borderLeft: isDiscontinued ? "3px solid #8a96a8" : "3px solid #4a7c59" }}>
                  <td className="px-4 py-3">
                    <div className="w-12 h-12 bg-[#faf8f2] border border-[#e5dfd1] flex items-center justify-center overflow-hidden">
                      {sku.image_url ? (
                        <img src={sku.image_url} alt={sku.id}
                          className="w-full h-full object-cover"
                          onError={(e) => { e.target.style.display = 'none'; }} />
                      ) : (
                        <Package size={16} className="text-[#c4cbd8]" />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 mono text-xs font-medium">{sku.id}</td>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium">{sku.name}</div>
                    {sku.name_en && <div className="text-xs text-[#5a6578] mt-0.5">EN: {sku.name_en}</div>}
                    {sku.name_cn && <div className="text-xs text-[#5a6578]">CN: {sku.name_cn}</div>}
                  </td>
                  <td className="px-4 py-3 text-right mono">{formatCNY(sku.price_cny)}</td>
                  <td className="px-4 py-3 text-right mono text-xs">
                    {sku.weight_g ? (
                      sku.weight_g >= 1000
                        ? <span>{(sku.weight_g/1000).toFixed(2)} <span className="text-[#8a96a8]">kg</span></span>
                        : <span>{sku.weight_g} <span className="text-[#8a96a8]">g</span></span>
                    ) : <span className="text-[#8a96a8]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-[#5a6578]">{sku.unit}</td>
                  <td className="px-4 py-3 text-right mono text-xs">
                    <div>{metrics.po_count} PO</div>
                    <div className="text-[10px] text-[#8a96a8]">{metrics.total_ordered.toLocaleString()} cái</div>
                  </td>
                  <td className="px-4 py-3 text-right mono">{metrics.in_stock.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    {isDiscontinued ? (
                      <span className="text-xs px-2 py-1 bg-[#eaecef] text-[#5a6578]">Đã ngừng</span>
                    ) : (
                      <span className="text-xs px-2 py-1 bg-[#e0ede4] text-[#4a7c59]">Đang KD</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => setModal({ type: "edit_sku", editingSKU: sku })}
                        className="p-2 text-[#5a6578] hover:text-[#1a2332] hover:bg-[#f5f2eb]" title="Sửa">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => onToggleStatus(sku.id)}
                        className={`p-2 hover:bg-[#f5f2eb] ${isDiscontinued ? "text-[#4a7c59]" : "text-[#d97757]"}`}
                        title={isDiscontinued ? "Kích hoạt lại" : "Ngừng kinh doanh"}>
                        {isDiscontinued ? <CheckCircle2 size={14} /> : <Ban size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pagination currentPage={currentPage} totalPages={totalPages} totalItems={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </div>

      <div className="mt-4 text-xs text-[#5a6578]">
        <span className="inline-block w-2 h-2 bg-[#4a7c59] mr-2"></span>Đang kinh doanh — có thể tạo PO mới
        <span className="inline-block w-2 h-2 bg-[#8a96a8] ml-6 mr-2"></span>Đã ngừng — không đặt mới, vẫn bán tồn còn
      </div>
    </div>
  );
}

function SKUFormModal({ skus, editing, onClose, onCreate, onUpdate }) {
  const isEdit = !!editing;
  const [form, setForm] = useState(editing || {
    id: "",
    name: "",
    name_en: "",
    name_cn: "",
    unit: "cái",
    price_cny: "",
    weight_g: "",
    image_url: "",
    status: "active",
  });
  const [error, setError] = useState("");
  const fileInputRef = React.useRef(null);

  const setField = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setError("");
  };

  const handleSubmit = () => {
    // Validate
    if (!form.id.trim()) return setError("Mã SKU không được trống");
    if (!form.name.trim()) return setError("Tên tiếng Việt không được trống");
    if (!form.price_cny || form.price_cny <= 0) return setError("Giá phải lớn hơn 0");

    const newId = form.id.trim();
    // Check duplicate ID: khi tạo mới hoặc khi đổi sang mã đã tồn tại (ngoài chính mình)
    if (!isEdit && skus.some(s => s.id === newId)) {
      return setError(`Mã SKU "${newId}" đã tồn tại`);
    }
    if (isEdit && newId !== editing.id && skus.some(s => s.id === newId)) {
      return setError(`Mã SKU "${newId}" đã tồn tại, không thể dùng`);
    }

    const payload = {
      ...form,
      id: newId,
      oldId: isEdit ? editing.id : undefined, // để App biết đây là rename
      name: form.name.trim(),
      name_en: form.name_en.trim(),
      name_cn: form.name_cn.trim(),
      unit: form.unit.trim() || "cái",
      price_cny: parseFloat(form.price_cny),
      weight_g: form.weight_g ? parseFloat(form.weight_g) : 0,
      image_url: (form.image_url || "").trim(),
    };

    if (isEdit) onUpdate(payload);
    else onCreate(payload);
  };

  return (
    <div className="fixed inset-0 bg-[#1e4d7b]/98 backdrop-blur-md flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div className="bg-[#7fa8d1] w-[640px] max-w-full animate-in" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-6 border-b border-[#e5dfd1] bg-[#1a2332] text-[#f5f2eb] flex justify-between items-start">
          <div>
            <div className="text-xs uppercase tracking-wider text-[#c4a962]">Products</div>
            <div className="text-2xl font-medium mt-1">{isEdit ? "Sửa SKU" : "Thêm SKU mới"}</div>
            {isEdit && <div className="text-xs text-[#c4cbd8] mt-1 mono">{editing.id}</div>}
          </div>
          <button onClick={onClose} className="text-[#c4cbd8] hover:text-[#f5f2eb]"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* SKU Code */}
          <div>
            <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">
              Mã SKU *
              {isEdit && <span className="normal-case text-[10px] text-[#d97757] ml-2">(cẩn thận: đổi mã sẽ cập nhật toàn bộ PO, delivery, tồn kho liên quan)</span>}
            </label>
            <input type="text" value={form.id} onChange={e => setField("id", e.target.value)}
              placeholder="VD: SKU-006"
              className="w-full px-4 py-3 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm mono" />
          </div>

          {/* Tên đa ngôn ngữ */}
          <div className="space-y-3">
            <label className="text-xs uppercase tracking-wider text-[#8a7c4f] block">Tên sản phẩm</label>
            <div>
              <div className="text-[10px] text-[#8a7c4f] mb-1">🇻🇳 Tiếng Việt *</div>
              <input type="text" value={form.name} onChange={e => setField("name", e.target.value)}
                placeholder="VD: Tai nghe Bluetooth X2"
                className="w-full px-4 py-2.5 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm" />
            </div>
            <div>
              <div className="text-[10px] text-[#8a7c4f] mb-1">🇬🇧 English (dùng khi gửi NCC / xuất báo cáo)</div>
              <input type="text" value={form.name_en} onChange={e => setField("name_en", e.target.value)}
                placeholder="VD: Bluetooth Headphones X2"
                className="w-full px-4 py-2.5 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm" />
            </div>
            <div>
              <div className="text-[10px] text-[#8a7c4f] mb-1">🇨🇳 中文 / Tiếng Trung (hiển thị trong Excel PO gửi NCC)</div>
              <input type="text" value={form.name_cn} onChange={e => setField("name_cn", e.target.value)}
                placeholder="VD: 蓝牙耳机 X2"
                className="w-full px-4 py-2.5 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm" />
            </div>
          </div>

          {/* Ảnh sản phẩm */}
          <div>
            <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Ảnh sản phẩm</label>
            <div className="flex gap-3 items-start">
              {/* Preview */}
              <div className="w-24 h-24 border border-[#e5dfd1] bg-white flex items-center justify-center overflow-hidden flex-shrink-0">
                {form.image_url ? (
                  <img src={form.image_url} alt="preview"
                    className="w-full h-full object-cover"
                    onError={(e) => { e.target.style.display = 'none'; }} />
                ) : (
                  <Package size={28} className="text-[#c4cbd8]" />
                )}
              </div>

              {/* Input options */}
              <div className="flex-1 space-y-2">
                <div>
                  <div className="text-[10px] text-[#8a7c4f] mb-1">Dán URL ảnh (từ Shopee, Google Drive, Imgur...)</div>
                  <input type="text" value={form.image_url || ""}
                    onChange={e => setField("image_url", e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-xs mono" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-[#e5dfd1]"></div>
                  <span className="text-[10px] text-[#8a96a8]">hoặc</span>
                  <div className="flex-1 h-px bg-[#e5dfd1]"></div>
                </div>
                <button type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full px-3 py-2 bg-[#faf8f2] border border-[#e5dfd1] hover:border-[#c4a962] text-xs text-[#5a6578] flex items-center justify-center gap-2">
                  <Download size={12} style={{ transform: "rotate(180deg)" }} />
                  Upload ảnh từ máy
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 500 * 1024) {
                      setError("Ảnh quá lớn (> 500KB). Hãy dùng ảnh nhỏ hơn hoặc dán URL.");
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = (ev) => setField("image_url", ev.target.result);
                    reader.readAsDataURL(file);
                  }}
                />
                {form.image_url && (
                  <button type="button" onClick={() => setField("image_url", "")}
                    className="text-[10px] text-[#d97757] hover:underline">
                    Xóa ảnh
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Giá + Trọng lượng + Đơn vị */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Giá gợi ý CNY *</label>
              <input type="number" min="0" step="0.01" value={form.price_cny}
                onChange={e => setField("price_cny", e.target.value)}
                onClick={e => e.target.select()}
                placeholder="0"
                className="w-full px-4 py-3 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm mono" />
              {form.price_cny > 0 && (
                <div className="text-[10px] text-[#5a6578] mt-1 mono">≈ {formatVND(form.price_cny * CNY_VND_RATE)}</div>
              )}
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Trọng lượng (g)</label>
              <input type="number" min="0" step="1" value={form.weight_g || ""}
                onChange={e => setField("weight_g", e.target.value)}
                onClick={e => e.target.select()}
                placeholder="0"
                className="w-full px-4 py-3 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm mono" />
              {form.weight_g > 0 && (
                <div className="text-[10px] text-[#5a6578] mt-1 mono">
                  {form.weight_g >= 1000 ? `${(form.weight_g/1000).toFixed(2)} kg` : `${form.weight_g} g`}
                </div>
              )}
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Đơn vị tính</label>
              <input type="text" value={form.unit} onChange={e => setField("unit", e.target.value)}
                placeholder="cái, bộ, thùng..."
                className="w-full px-4 py-3 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm" />
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Trạng thái</label>
            <div className="flex gap-2">
              {[
                { id: "active", label: "Đang kinh doanh", desc: "Có thể tạo PO mới", color: "#4a7c59" },
                { id: "discontinued", label: "Đã ngừng", desc: "Không đặt mới, vẫn bán tồn", color: "#8a96a8" },
              ].map(s => {
                const active = form.status === s.id;
                return (
                  <button key={s.id} onClick={() => setField("status", s.id)}
                    className="flex-1 p-3 border text-left transition-all"
                    style={active ? { borderColor: "#4a7bb8", backgroundColor: "#dbe8f5", borderWidth: "2px" } : { borderColor: "#e5dfd1", backgroundColor: "#ffffff" }}>
                    <div className="text-sm font-medium" style={{ color: s.color }}>{s.label}</div>
                    <div className="text-[10px] text-[#5a6578] mt-0.5">{s.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-[#fae5dd] border border-[#d97757] p-3 text-xs text-[#d97757] flex items-center gap-2">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#e5dfd1] bg-white flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2 text-sm text-[#5a6578] hover:text-[#1a2332]">Hủy</button>
          <button onClick={handleSubmit}
            className="px-6 py-2 text-sm bg-[#c4a962] text-[#1a2332] hover:bg-[#b8a056] font-medium">
            {isEdit ? "Cập nhật" : "Tạo SKU"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SuppliersManagementView({ suppliers, pos, supplierDebts, setModal, onToggleStatus }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 5;

  const filtered = suppliers.filter(s => {
    if (statusFilter !== "all" && s.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.id.toLowerCase().includes(q) ||
             s.name.toLowerCase().includes(q) ||
             (s.name_cn || "").toLowerCase().includes(q) ||
             (s.contact_name || "").toLowerCase().includes(q) ||
             (s.email || "").toLowerCase().includes(q);
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const activeCount = suppliers.filter(s => s.status === "active").length;
  const inactiveCount = suppliers.filter(s => s.status === "inactive").length;

  return (
    <div className="p-10 animate-in">
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-[#8a7c4f]">Suppliers</div>
          <h1 className="text-4xl font-light mt-2">Nhà cung cấp</h1>
          <p className="text-sm text-[#5a6578] mt-2">Quản lý thông tin NCC Trung Quốc · Liên hệ · Địa chỉ nhà máy</p>
        </div>
        <button onClick={() => setModal({ type: "new_supplier" })} className="flex items-center gap-2 bg-[#1a2332] text-[#f5f2eb] px-5 py-3 text-sm hover:bg-[#2a3547]">
          <Plus size={14} /> Thêm NCC mới
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-[#e5dfd1] p-5">
          <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">Tổng NCC</div>
          <div className="text-2xl mono mt-2 font-medium">{suppliers.length}</div>
          <div className="text-xs text-[#5a6578] mt-1">{activeCount} đang hoạt động · {inactiveCount} ngừng</div>
        </div>
        <div className="bg-white border border-[#e5dfd1] p-5">
          <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">Active</div>
          <div className="text-2xl mono mt-2 font-medium text-[#4a7c59]">{activeCount}</div>
          <div className="text-xs text-[#5a6578] mt-1">Đang giao dịch</div>
        </div>
        <div className="bg-white border border-[#e5dfd1] p-5">
          <div className="text-xs uppercase tracking-wider text-[#8a7c4f]">Inactive</div>
          <div className="text-2xl mono mt-2 font-medium text-[#8a96a8]">{inactiveCount}</div>
          <div className="text-xs text-[#5a6578] mt-1">Ngừng giao dịch · Vẫn thấy trong lịch sử</div>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-4 mb-6">
        <div className="flex-1 bg-white border border-[#e5dfd1] flex items-center gap-2 px-4">
          <Search size={14} className="text-[#8a96a8]" />
          <input type="text" placeholder="Tìm theo tên, tên TQ, liên hệ, email..." value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="flex-1 py-3 bg-transparent outline-none text-sm" />
        </div>
        <div className="flex bg-white border border-[#e5dfd1]">
          {[
            { id: "all", label: "Tất cả" },
            { id: "active", label: "Đang giao dịch" },
            { id: "inactive", label: "Đã ngừng" },
          ].map(f => (
            <button key={f.id} onClick={() => { setStatusFilter(f.id); setPage(1); }}
              className={`px-4 py-3 text-xs ${statusFilter === f.id ? "bg-[#1a2332] text-[#f5f2eb]" : "text-[#5a6578] hover:bg-[#faf8f2]"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Cards layout (vì data phức tạp, card tốt hơn bảng) */}
      <div className="space-y-3">
        {paged.length === 0 ? (
          <div className="bg-white border border-[#e5dfd1] p-10 text-center text-sm text-[#5a6578]">
            Không có NCC phù hợp
          </div>
        ) : paged.map(s => {
          const isInactive = s.status === "inactive";
          const debt = supplierDebts[s.id];
          const activeOwed = debt ? debt.shipped - debt.paid : 0;
          const poCount = pos.filter(p => p.supplier_id === s.id).length;

          return (
            <div key={s.id}
              className={`bg-white border border-[#e5dfd1] ${isInactive ? "opacity-60" : ""}`}
              style={{ borderLeft: isInactive ? "3px solid #8a96a8" : "3px solid #4a7c59" }}>
              <div className="p-5 flex justify-between items-start">
                <div className="flex-1">
                  {/* Tên + status */}
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs mono text-[#8a7c4f]">{s.id}</span>
                    {isInactive ? (
                      <span className="text-[10px] px-2 py-0.5 bg-[#eaecef] text-[#5a6578] uppercase tracking-wider">Đã ngừng</span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 bg-[#e0ede4] text-[#4a7c59] uppercase tracking-wider">Đang giao dịch</span>
                    )}
                    <span className="text-[10px] text-[#5a6578]">Điều khoản {s.terms} ngày · {s.currency}</span>
                  </div>
                  <div className="text-lg font-medium">{s.name}</div>
                  {s.name_cn && <div className="text-sm text-[#5a6578] mt-0.5">🇨🇳 {s.name_cn}</div>}
                </div>

                {/* Action buttons */}
                <div className="flex gap-1">
                  <button onClick={() => setModal({ type: "edit_supplier", editingSupplier: s })}
                    className="p-2 text-[#5a6578] hover:text-[#1a2332] hover:bg-[#f5f2eb]" title="Sửa">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => onToggleStatus(s.id)}
                    className={`p-2 hover:bg-[#f5f2eb] ${isInactive ? "text-[#4a7c59]" : "text-[#d97757]"}`}
                    title={isInactive ? "Kích hoạt lại" : "Ngừng giao dịch"}>
                    {isInactive ? <CheckCircle2 size={14} /> : <Ban size={14} />}
                  </button>
                </div>
              </div>

              {/* Chi tiết liên hệ */}
              <div className="px-5 pb-4 border-t border-[#e5dfd1] pt-4 grid grid-cols-2 gap-4 text-xs">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#8a7c4f] mb-2">Liên hệ</div>
                  {s.contact_name && <div className="mb-1">👤 {s.contact_name}</div>}
                  {s.email && <div className="mb-1 text-[#5a6578]">📧 <span className="mono">{s.email}</span></div>}
                  {s.phone && <div className="mb-1 text-[#5a6578]">📞 <span className="mono">{s.phone}</span></div>}
                  {s.wechat && <div className="text-[#5a6578]">💬 WeChat: <span className="mono">{s.wechat}</span></div>}
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#8a7c4f] mb-2">Nhà máy</div>
                  {s.factory_address ? (
                    <div className="text-[#5a6578] leading-relaxed">📍 {s.factory_address}</div>
                  ) : (
                    <div className="text-[#8a96a8] italic">Chưa có địa chỉ</div>
                  )}
                </div>
              </div>

              {/* Stats footer */}
              <div className="px-5 py-3 bg-[#faf8f2] border-t border-[#e5dfd1] flex items-center gap-6 text-xs">
                <div>
                  <span className="text-[#5a6578]">PO tổng: </span>
                  <span className="mono font-medium">{poCount}</span>
                </div>
                <div>
                  <span className="text-[#5a6578]">Đang nợ: </span>
                  <span className="mono font-medium" style={{ color: activeOwed > 0 ? "#d97757" : "#4a7c59" }}>
                    {formatCNY(activeOwed)}
                  </span>
                </div>
                <div>
                  <span className="text-[#5a6578]">Tổng giá trị đã đặt: </span>
                  <span className="mono font-medium">{formatCNY(debt?.committed || 0)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Pagination currentPage={currentPage} totalPages={totalPages} totalItems={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />

      <div className="mt-4 text-xs text-[#5a6578]">
        <span className="inline-block w-2 h-2 bg-[#4a7c59] mr-2"></span>Đang giao dịch — có thể tạo PO mới
        <span className="inline-block w-2 h-2 bg-[#8a96a8] ml-6 mr-2"></span>Đã ngừng — không đặt mới, vẫn xem được lịch sử
      </div>
    </div>
  );
}

function SupplierFormModal({ suppliers, editing, onClose, onCreate, onUpdate }) {
  const isEdit = !!editing;
  const [form, setForm] = useState(editing || {
    id: "",
    name: "",
    name_cn: "",
    country: "CN",
    currency: "CNY",
    terms: 30,
    contact_name: "",
    email: "",
    wechat: "",
    phone: "",
    factory_address: "",
    status: "active",
  });
  const [error, setError] = useState("");

  const setField = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setError("");
  };

  const handleSubmit = () => {
    // Validate
    if (!form.id.trim()) return setError("Mã NCC không được trống");
    if (!form.name.trim()) return setError("Tên NCC không được trống");
    if (!form.terms || form.terms < 0) return setError("Điều khoản thanh toán phải >= 0");

    if (!isEdit) {
      if (suppliers.some(s => s.id === form.id.trim())) {
        return setError(`Mã NCC "${form.id}" đã tồn tại`);
      }
    }

    const payload = {
      ...form,
      id: form.id.trim(),
      name: form.name.trim(),
      name_cn: form.name_cn.trim(),
      contact_name: form.contact_name.trim(),
      email: form.email.trim(),
      wechat: form.wechat.trim(),
      phone: form.phone.trim(),
      factory_address: form.factory_address.trim(),
      terms: parseInt(form.terms),
    };

    if (isEdit) onUpdate(payload);
    else onCreate(payload);
  };

  return (
    <div className="fixed inset-0 bg-[#1e4d7b]/98 backdrop-blur-md flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div className="bg-[#7fa8d1] animate-in"
        style={{ width: "720px", maxWidth: "100%", maxHeight: "92vh", display: "flex", flexDirection: "column" }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-6 border-b border-[#e5dfd1] bg-[#1a2332] text-[#f5f2eb] flex justify-between items-start" style={{ flexShrink: 0 }}>
          <div>
            <div className="text-xs uppercase tracking-wider text-[#c4a962]">Suppliers</div>
            <div className="text-2xl font-medium mt-1">{isEdit ? "Sửa nhà cung cấp" : "Thêm NCC mới"}</div>
            {isEdit && <div className="text-xs text-[#c4cbd8] mt-1 mono">{editing.id}</div>}
          </div>
          <button onClick={onClose} className="text-[#c4cbd8] hover:text-[#f5f2eb]"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-5" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
          {/* Mã + Điều khoản */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">
                Mã NCC * {isEdit && <span className="normal-case text-[10px] text-[#8a96a8]">(không thể sửa)</span>}
              </label>
              <input type="text" value={form.id} onChange={e => setField("id", e.target.value)}
                disabled={isEdit}
                placeholder="VD: S004"
                className="w-full px-4 py-3 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm mono disabled:bg-[#f5f2eb] disabled:text-[#8a96a8]" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Điều khoản (ngày) *</label>
              <input type="number" min="0" value={form.terms}
                onChange={e => setField("terms", e.target.value)}
                onClick={e => e.target.select()}
                className="w-full px-4 py-3 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm mono" />
            </div>
          </div>

          {/* Tên */}
          <div className="space-y-3">
            <div>
              <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Tên NCC (tiếng Anh/quốc tế) *</label>
              <input type="text" value={form.name} onChange={e => setField("name", e.target.value)}
                placeholder="VD: Shenzhen XYZ Technology Co., Ltd."
                className="w-full px-4 py-3 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm" />
            </div>
            <div>
              <div className="text-[10px] text-[#8a7c4f] mb-1">🇨🇳 Tên tiếng Trung (sẽ in trên Excel PO gửi NCC)</div>
              <input type="text" value={form.name_cn} onChange={e => setField("name_cn", e.target.value)}
                placeholder="VD: 深圳XYZ科技有限公司"
                className="w-full px-4 py-3 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm" />
            </div>
          </div>

          {/* Contact info */}
          <div>
            <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Thông tin liên hệ</label>
            <div className="space-y-3">
              <input type="text" value={form.contact_name} onChange={e => setField("contact_name", e.target.value)}
                placeholder="👤 Tên người liên hệ (VD: Mr. Zhang Wei)"
                className="w-full px-4 py-2.5 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <input type="email" value={form.email} onChange={e => setField("email", e.target.value)}
                  placeholder="📧 Email"
                  className="w-full px-4 py-2.5 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm" />
                <input type="text" value={form.phone} onChange={e => setField("phone", e.target.value)}
                  placeholder="📞 Điện thoại"
                  className="w-full px-4 py-2.5 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm mono" />
              </div>
              <input type="text" value={form.wechat} onChange={e => setField("wechat", e.target.value)}
                placeholder="💬 WeChat ID"
                className="w-full px-4 py-2.5 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm mono" />
            </div>
          </div>

          {/* Địa chỉ */}
          <div>
            <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Địa chỉ nhà máy</label>
            <textarea value={form.factory_address} onChange={e => setField("factory_address", e.target.value)}
              placeholder="📍 Địa chỉ chi tiết nhà máy ở Trung Quốc"
              rows={2}
              className="w-full px-4 py-3 bg-white border border-[#e5dfd1] focus:border-[#c4a962] outline-none text-sm resize-none" />
          </div>

          {/* Status */}
          <div>
            <label className="text-xs uppercase tracking-wider text-[#8a7c4f] mb-2 block">Trạng thái</label>
            <div className="flex gap-2">
              {[
                { id: "active", label: "Đang giao dịch", desc: "Có thể tạo PO mới", color: "#4a7c59" },
                { id: "inactive", label: "Đã ngừng", desc: "Không đặt mới, vẫn thấy lịch sử", color: "#8a96a8" },
              ].map(s => {
                const active = form.status === s.id;
                return (
                  <button key={s.id} onClick={() => setField("status", s.id)}
                    className="flex-1 p-3 border text-left transition-all"
                    style={active ? { borderColor: "#4a7bb8", backgroundColor: "#dbe8f5", borderWidth: "2px" } : { borderColor: "#e5dfd1", backgroundColor: "#ffffff" }}>
                    <div className="text-sm font-medium" style={{ color: s.color }}>{s.label}</div>
                    <div className="text-[10px] text-[#5a6578] mt-0.5">{s.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-[#fae5dd] border border-[#d97757] p-3 text-xs text-[#d97757] flex items-center gap-2">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#e5dfd1] bg-white flex justify-end gap-3" style={{ flexShrink: 0 }}>
          <button onClick={onClose} className="px-5 py-2 text-sm text-[#5a6578] hover:text-[#1a2332]">Hủy</button>
          <button onClick={handleSubmit}
            className="px-6 py-2 text-sm bg-[#c4a962] text-[#1a2332] hover:bg-[#b8a056] font-medium">
            {isEdit ? "Cập nhật" : "Thêm NCC"}
          </button>
        </div>
      </div>
    </div>
  );
}
