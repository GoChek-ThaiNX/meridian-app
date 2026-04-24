// ============================================================
// S3 Data Layer — GoChek CRM v12
// Bucket: debt-order-management | Region: ap-southeast-1
// Toàn bộ CRM data = 1 JSON file trên S3
// UI chỉ gọi các method ở đây, không tự xử lý data persistence
// ============================================================

const S3_BUCKET = "debt-order-management";
const S3_REGION = "ap-southeast-1";
const S3_KEY = "crm_data_v12.json";
const S3_URL = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${S3_KEY}`;

let _saveTimer = null;
const DEBOUNCE_MS = 1500;

// ============================================================
// LOW-LEVEL: S3 GET / PUT
// ============================================================

export async function s3Get() {
  try {
    const res = await fetch(S3_URL, { method: "GET", cache: "no-store" });
    if (!res.ok) {
      if (res.status === 404 || res.status === 403) return null;
      throw new Error(`S3 GET failed: ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.warn("[S3] GET error:", err.message);
    return null;
  }
}

function validateBeforeSave(data) {
  if (!data || typeof data !== "object") return { ok: false, reason: "Data is null or not an object" };
  const requiredKeys = ["factories", "products", "pos", "shipments", "payments", "users", "settings"];
  for (const key of requiredKeys) {
    if (!(key in data)) return { ok: false, reason: `Missing required key: ${key}` };
  }
  const collections = ["factories", "products", "pos", "shipments", "payments", "users"];
  const totalItems = collections.reduce((s, k) => s + (Array.isArray(data[k]) ? data[k].length : 0), 0);
  if (totalItems === 0) return { ok: false, reason: "All collections are empty — refusing to overwrite" };
  return { ok: true };
}

export async function s3Put(data) {
  const check = validateBeforeSave(data);
  if (!check.ok) {
    console.error("[S3] BLOCKED save:", check.reason);
    return false;
  }
  try {
    const res = await fetch(S3_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`S3 PUT failed: ${res.status} ${res.statusText}`);
    console.log("[S3] Saved successfully");
    return true;
  } catch (err) {
    console.error("[S3] PUT error:", err.message);
    return false;
  }
}

export function s3PutDebounced(data) {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { s3Put(data); }, DEBOUNCE_MS);
}

export function s3Flush(data) {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  if (navigator.sendBeacon) {
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    navigator.sendBeacon(S3_URL, blob);
  } else {
    s3Put(data);
  }
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
