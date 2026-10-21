// ============================================================
// S3 Data Layer — GoChek CRM v12
// Bucket: debt-order-management | Region: ap-southeast-1
// Toàn bộ CRM data = 1 JSON file trên S3
// UI chỉ gọi các method ở đây, không tự xử lý data persistence
// ============================================================

const S3_BUCKET = "debt-order-management-prod";
const S3_REGION = "ap-southeast-1";
const S3_KEY = "crm_data.json";
const S3_URL = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${S3_KEY}`;

let _saveTimer = null;
const DEBOUNCE_MS = 1500;

// ============================================================
// LOW-LEVEL: S3 GET / PUT
// ============================================================

// v53: Đọc NGHIÊM NGẶT — phân biệt "lỗi đọc" (ok:false) với "chưa có dữ liệu" (ok:true, value:null).
// s3Get() trả null cho cả 2 trường hợp → nếu dùng để quyết định ghi thì có thể ghi đè xoá sạch kho.
export async function s3GetStrict() {
  try {
    const res = await fetch(S3_URL, { method: "GET", cache: "no-store" });
    if (res.status === 404 || res.status === 403) return { ok: true, value: null };
    if (!res.ok) return { ok: false, error: new Error(`S3 GET failed: ${res.status}`) };
    return { ok: true, value: await res.json() };
  } catch (err) {
    return { ok: false, error: err };
  }
}

export async function s3Get() {
  const res = await s3GetStrict();
  if (!res.ok) {
    console.warn("[S3] GET error:", res.error?.message || res.error);
    return null;
  }
  return res.value;
}

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
  "debtAdjustments",
  "marketDebtTransfers",
  // V41-7: tài khoản ngân hàng công ty + phiếu hoàn tiền ĐVVC — số liệu tiền, không được mất bản ghi
  "bankAccounts",
  "carrierRefunds",
  // V41-8: phiếu kiểm tra chất lượng (QC) theo đơn giao hàng — bằng chứng nghiệm thu, phải giữ nguyên
  "qcReports",
  // v53: Nhật ký là bằng chứng truy vết — không được ghi bản cũ làm mất bớt dòng log
  "auditLog",
];

function itemIdentity(item) {
  return item?.id || item?.username || item?.sku || null;
}

function validateShapeBeforeSave(data) {
  if (!data || typeof data !== "object") return { ok: false, reason: "Data is null or not an object" };
  for (const key of REQUIRED_KEYS) {
    if (!(key in data)) return { ok: false, reason: `Missing required key: ${key}` };
  }

  const collections = ["factories", "products", "pos", "shipments", "payments", "users"];
  for (const key of collections) {
    if (!Array.isArray(data[key])) return { ok: false, reason: `${key} must be an array` };
  }

  const totalItems = collections.reduce((s, k) => s + data[k].length, 0);
  if (totalItems === 0) return { ok: false, reason: "All collections are empty - refusing to overwrite" };
  return { ok: true };
}

function validateAgainstPreviousSave(nextData, previousData) {
  if (!previousData || typeof previousData !== "object") return { ok: true };

  for (const key of PROTECTED_COLLECTION_KEYS) {
    const previousItems = previousData[key];
    if (!Array.isArray(previousItems) || previousItems.length === 0) continue;

    const nextItems = nextData[key];
    if (!Array.isArray(nextItems)) {
      return { ok: false, reason: `${key} disappeared or is no longer an array` };
    }
    if (nextItems.length < previousItems.length) {
      return {
        ok: false,
        reason: `${key} shrank from ${previousItems.length} to ${nextItems.length}. Use deleted:true marker instead of removing records.`,
      };
    }

    const nextIds = new Set(nextItems.map(itemIdentity).filter(Boolean));
    for (const item of previousItems) {
      const id = itemIdentity(item);
      if (id && !nextIds.has(id)) {
        return {
          ok: false,
          reason: `${key} record '${id}' was removed. Use deleted:true/deletedAt/deletedBy marker instead.`,
        };
      }
    }
  }

  return { ok: true };
}

async function validateBeforeSave(data) {
  const shapeCheck = validateShapeBeforeSave(data);
  if (!shapeCheck.ok) return shapeCheck;

  const remoteData = await s3Get();
  if (!remoteData) return { ok: true };

  return validateAgainstPreviousSave(data, remoteData);
}

// v53: Ghi NGHIÊM NGẶT — lỗi/bị chặn thì NÉM LỖI kèm lý do để lớp trên báo "chưa lưu" + thử lại.
// Mọi đường ghi S3 (kể cả s3Put/s3Flush) đều đi qua đây → không có đường nào bỏ qua validation.
export async function s3PutStrict(data) {
  const check = await validateBeforeSave(data);
  if (!check.ok) {
    const err = new Error(`Kho từ chối ghi: ${check.reason}`);
    err.blocked = true;
    throw err;
  }
  const res = await fetch(S3_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`S3 PUT failed: ${res.status} ${res.statusText}`);
  return true;
}

export async function s3Put(data) {
  try {
    await s3PutStrict(data);
    console.log("[S3] Saved successfully");
    return true;
  } catch (err) {
    if (err.blocked) console.error("[S3] BLOCKED save:", err.message);
    else console.error("[S3] PUT error:", err.message);
    return false;
  }
}

export function s3PutDebounced(data) {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { s3Put(data); }, DEBOUNCE_MS);
}

export function s3Flush(data) {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  s3Put(data);
}

// ============================================================
// STORAGE LAYER — S3 + localStorage cache + fallback
// ============================================================

const _memStore = {};
const hasClaudeStorage = typeof window !== "undefined" && window.storage && typeof window.storage.get === "function";

async function storageGet(key) {
  try {
    const s3Data = await s3Get();
    if (s3Data) {
      try { if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(s3Data)); } catch {}
      return s3Data;
    }
  } catch (err) {
    console.warn("[Storage] S3 GET failed, falling back:", err.message);
  }
  try {
    if (typeof localStorage !== "undefined") {
      const v = localStorage.getItem(key);
      if (v) return JSON.parse(v);
    }
  } catch {}
  if (hasClaudeStorage) {
    try { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : null; } catch { return null; }
  }
  return _memStore[key] ? JSON.parse(_memStore[key]) : null;
}

async function storageSet(key, value) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(value)); } catch {}
  s3PutDebounced(value);
  if (hasClaudeStorage) { try { await window.storage.set(key, JSON.stringify(value)); } catch {} }
  _memStore[key] = JSON.stringify(value);
}

// ============================================================
// HIGH-LEVEL CRUD — UI gọi trực tiếp các method này
// ============================================================

const STORAGE_KEY = "crm_data_v12";

/**
 * Load toàn bộ data từ storage (S3 → localStorage → memory)
 * @returns {Object|null}
 */
export async function loadAll() {
  return storageGet(STORAGE_KEY);
}

/**
 * Save toàn bộ data object (dùng cho setState + persist)
 * @param {Object} data - full CRM state
 */
export async function saveAll(data) {
  await storageSet(STORAGE_KEY, data);
}

/**
 * Thêm 1 item vào collection
 * @param {Object} data - current full state
 * @param {string} key - collection name (e.g. "products", "pos")
 * @param {Object} item - item mới
 * @param {Object} auditLog - mảng audit log mới (đã append entry)
 * @returns {Object} new full state (đã save)
 */
export async function addItem(data, key, item, auditLog) {
  const next = {
    ...data,
    [key]: [...data[key], item],
    auditLog: auditLog || data.auditLog,
  };
  await saveAll(next);
  return next;
}

/**
 * Sửa 1 item trong collection (merge updates)
 * @param {Object} data - current full state
 * @param {string} key - collection name
 * @param {string} id - item id
 * @param {Object} updates - fields to merge
 * @param {Object} auditLog - mảng audit log mới
 * @returns {Object} new full state (đã save)
 */
export async function editItem(data, key, id, updates, auditLog) {
  const next = {
    ...data,
    [key]: data[key].map(x => x.id === id ? { ...x, ...updates } : x),
    auditLog: auditLog || data.auditLog,
  };
  await saveAll(next);
  return next;
}

/**
 * Soft delete — đánh dấu deleted: true, không xóa khỏi array
 * @param {Object} data - current full state
 * @param {string} key - collection name
 * @param {string} id - item id
 * @param {string} deletedBy - user id hoặc username
 * @param {Object} auditLog - mảng audit log mới
 * @returns {Object} new full state (đã save)
 */
export async function softDeleteItem(data, key, id, deletedBy, auditLog) {
  const now = new Date().toISOString();
  const next = {
    ...data,
    [key]: data[key].map(x => x.id === id
      ? { ...x, deleted: true, deletedAt: now, deletedBy: deletedBy || "unknown" }
      : x
    ),
    auditLog: auditLog || data.auditLog,
  };
  await saveAll(next);
  return next;
}

/**
 * Save settings
 * @param {Object} data - current full state
 * @param {Object} newSettings - settings object mới
 * @param {Object} auditLog - mảng audit log mới
 * @returns {Object} new full state (đã save)
 */
export async function saveSettings(data, newSettings, auditLog) {
  const next = {
    ...data,
    settings: newSettings,
    auditLog: auditLog || data.auditLog,
  };
  await saveAll(next);
  return next;
}

/**
 * Update markets (dùng khi tạo warehouse mới)
 * @param {Object} data - current full state
 * @param {Array} updatedMarkets - mảng markets đã update
 * @param {Object} auditLog - mảng audit log mới
 * @returns {Object} new full state (đã save)
 */
export async function saveMarkets(data, updatedMarkets, auditLog) {
  const next = {
    ...data,
    markets: updatedMarkets,
    auditLog: auditLog || data.auditLog,
  };
  await saveAll(next);
  return next;
}

/**
 * Filter helper — loại bỏ soft-deleted items
 * @param {Array} arr
 * @returns {Array} items chưa bị xóa
 */
export function alive(arr) {
  return (arr || []).filter(x => !x.deleted);
}

// ============================================================
// AUTO SYNC — Push + Pull mỗi 2 phút
// Pull: GET từ S3, nếu data mới hơn → cập nhật UI
// Push: Nếu local có thay đổi chưa sync → PUT lên S3
// ============================================================

const AUTO_SYNC_INTERVAL = 2 * 60 * 1000; // 2 phút
let _syncTimer = null;
let _lastSyncedJSON = null; // JSON string của lần sync gần nhất, dùng để detect thay đổi

/**
 * Bắt đầu auto sync
 * @param {Function} getDataFn - () => data hiện tại
 * @param {Function} setDataFn - (newData) => cập nhật state UI
 */
export function startAutoSync(getDataFn, setDataFn) {
  stopAutoSync();
  _syncTimer = setInterval(async () => {
    try {
      const localData = getDataFn();
      if (!localData) return;

      // 1. Pull: GET từ S3
      const remoteData = await s3Get();

      if (remoteData) {
        const localJSON = JSON.stringify(localData);
        const remoteJSON = JSON.stringify(remoteData);

        // Nếu remote khác local → ai mới hơn?
        if (localJSON !== remoteJSON) {
          // So sánh bằng auditLog length — nhiều hơn = mới hơn
          const localLogLen = (localData.auditLog || []).length;
          const remoteLogLen = (remoteData.auditLog || []).length;

          if (remoteLogLen > localLogLen) {
            // Remote mới hơn → pull về UI
            console.log(`[AutoSync] Pull — remote has ${remoteLogLen} logs vs local ${localLogLen}`);
            setDataFn(remoteData);
            _lastSyncedJSON = remoteJSON;
            // Cache vào localStorage
            try { if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, remoteJSON); } catch {}
            return;
          }
        }
      }

      // 2. Push: Nếu local thay đổi so với lần sync trước → đẩy lên S3
      const currentJSON = JSON.stringify(localData);
      if (_lastSyncedJSON !== currentJSON) {
        console.log("[AutoSync] Push — local data changed, syncing to S3...");
        const ok = await s3Put(localData);
        if (ok) _lastSyncedJSON = currentJSON;
      } else {
        console.log("[AutoSync] No changes detected, skipping");
      }
    } catch (err) {
      console.warn("[AutoSync] Error:", err.message);
    }
  }, AUTO_SYNC_INTERVAL);
  console.log(`[AutoSync] Started Push+Pull — every ${AUTO_SYNC_INTERVAL / 1000}s`);
}

/**
 * Dừng auto sync
 */
export function stopAutoSync() {
  if (_syncTimer) {
    clearInterval(_syncTimer);
    _syncTimer = null;
    console.log("[AutoSync] Stopped");
  }
}
