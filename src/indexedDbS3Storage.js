import {
  s3Get,
  s3GetStrict,
  s3Put,
  s3PutStrict,
  s3PutDebounced,
  s3Flush as flushS3,
} from "./s3Storage.js";

const DB_NAME = "gochek_crm";
const DB_VERSION = 1;
const STORE_NAME = "cache";
const STORAGE_KEY = "crm_data_v12";
const AUTO_SYNC_INTERVAL = 2 * 60 * 1000;

const REQUIRED_KEYS = ["factories", "products", "pos", "shipments", "payments", "users", "settings"];
const REQUIRED_ARRAY_KEYS = ["factories", "products", "pos", "shipments", "payments", "users"];
const LEGACY_STORAGE_KEYS = [
  STORAGE_KEY,
  "crm_data_v38i",
  "crm_data_v38",
  "crm_data_v34",
  "crm_data_v31",
  "crm_data_v23",
  "crm_data_v22",
  "crm_data_v21",
  "crm_data_v20",
  "crm_data_v19",
  "crm_data_v18",
  "crm_data_v17",
  "crm_data_v16",
  "crm_data_v15",
  "crm_data_v14",
  "crm_data_v13",
  "crm_data_v11",
  "crm_data_v10",
  "crm_data_v9",
];

let _dbPromise = null;
let _initialLoadPromise = null;
let _syncTimer = null;
let _lastSyncedJSON = null;
const _memStore = new Map();

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function assertValidData(data, source) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`[${source}] CRM data must be an object`);
  }

  for (const key of REQUIRED_KEYS) {
    if (!(key in data)) throw new Error(`[${source}] Missing required key: ${key}`);
  }

  for (const key of REQUIRED_ARRAY_KEYS) {
    if (!Array.isArray(data[key])) throw new Error(`[${source}] ${key} must be an array`);
  }
}

function openDatabase() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available in this browser"));
  }

  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        _dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => reject(request.error || new Error("Unable to open IndexedDB"));
    request.onblocked = () => console.warn("[IndexedDB] Database upgrade is blocked by another tab");
  }).catch(error => {
    _dbPromise = null;
    throw error;
  });

  return _dbPromise;
}

export async function indexedDbGet(key = STORAGE_KEY) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key);
    let value = null;

    request.onsuccess = () => {
      value = request.result?.value ?? null;
    };
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () => reject(transaction.error || request.error || new Error("IndexedDB read failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB read was aborted"));
  });
}

export async function indexedDbSet(key = STORAGE_KEY, value) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({
      key,
      value,
      cachedAt: new Date().toISOString(),
    });
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB write failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB write was aborted"));
  });
}

export async function indexedDbDelete(key = STORAGE_KEY) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(key);
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB delete failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB delete was aborted"));
  });
}

function removeLegacyStorageKey(key) {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  } catch (error) {
    console.warn(`[IndexedDB] Unable to remove legacy key '${key}':`, formatError(error));
  }
}

async function persistAndReadBack(data, source) {
  assertValidData(data, source);
  await indexedDbSet(STORAGE_KEY, data);

  const persistedData = await indexedDbGet(STORAGE_KEY);
  if (!persistedData) throw new Error(`[${source}] IndexedDB read-back returned no data`);
  assertValidData(persistedData, "IndexedDB read-back");

  _memStore.set(STORAGE_KEY, persistedData);
  removeLegacyStorageKey(STORAGE_KEY);
  return persistedData;
}

async function migrateLegacyLocalStorage() {
  if (typeof localStorage === "undefined") return null;

  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      const data = JSON.parse(raw);
      const persistedData = await persistAndReadBack(data, `Legacy migration ${key}`);
      removeLegacyStorageKey(key);
      console.info(`[IndexedDB] Migrated legacy CRM cache from '${key}'`);
      return persistedData;
    } catch (error) {
      console.warn(`[IndexedDB] Legacy migration failed for '${key}':`, formatError(error));
    }
  }

  return null;
}

async function readIndexedDbFallback() {
  try {
    const cachedData = await indexedDbGet(STORAGE_KEY);
    if (!cachedData) return null;
    assertValidData(cachedData, "IndexedDB fallback");
    _memStore.set(STORAGE_KEY, cachedData);
    console.warn("[Storage] S3 is unavailable; loaded CRM data from IndexedDB");
    return cachedData;
  } catch (error) {
    console.error("[IndexedDB] Fallback read failed:", formatError(error));
    return null;
  }
}

async function loadAllFromSources() {
  const remoteData = await s3Get();

  if (remoteData) {
    const persistedData = await persistAndReadBack(remoteData, "S3 load");
    _lastSyncedJSON = JSON.stringify(persistedData);
    console.info("[Storage] S3 data persisted to IndexedDB and loaded into the app");
    return persistedData;
  }

  const cachedData = await readIndexedDbFallback();
  if (cachedData) return cachedData;

  const migratedData = await migrateLegacyLocalStorage();
  if (migratedData) return migratedData;

  const memoryData = _memStore.get(STORAGE_KEY);
  if (memoryData) return memoryData;

  throw new Error("Unable to load CRM data from S3 and no IndexedDB cache is available");
}

export function loadAll() {
  if (!_initialLoadPromise) {
    _initialLoadPromise = loadAllFromSources().catch(error => {
      _initialLoadPromise = null;
      throw error;
    });
  }
  return _initialLoadPromise;
}

export async function saveAll(data) {
  assertValidData(data, "Save");

  _memStore.set(STORAGE_KEY, data);
  s3PutDebounced(data);

  try {
    await indexedDbSet(STORAGE_KEY, data);
  } catch (error) {
    console.error("[IndexedDB] Save failed; S3 save remains scheduled:", formatError(error));
  }
}

// ============================================================
// v53: ĐỌC / GHI NGHIÊM NGẶT — dùng cho lớp đồng bộ nhiều máy (outbox + gộp thay đổi)
// ============================================================
// Khác loadAll()/saveAll():
//   - loadAllStrict() phân biệt "lỗi đọc kho" với "kho chưa có dữ liệu" → lớp trên KHÔNG tự khởi tạo
//     dữ liệu mới khi chỉ là mất mạng (V40 từng ghi đè xoá sạch dữ liệu chung vì lỗi này).
//   - saveAllStrict() NÉM LỖI khi kho từ chối/ghi lỗi → thay đổi được giữ trong hộp chờ để gửi lại,
//     không âm thầm chỉ lưu trên máy.
// Cả hai vẫn đi qua s3GetStrict/s3PutStrict → giữ nguyên toàn bộ validation chống mất dữ liệu.

/**
 * @param {{ allowCache?: boolean }} options allowCache=true: cho phép lấy cache IndexedDB / localStorage cũ
 *   khi S3 không đọc được hoặc chưa có file (chỉ dùng lúc mở app, KHÔNG dùng cho đường ghi).
 * @returns {Promise<{ ok: boolean, value?: Object|null, fromCache?: boolean, error?: Error }>}
 */
export async function loadAllStrict({ allowCache = false } = {}) {
  const result = await s3GetStrict();

  if (result.ok && result.value) {
    try {
      const persistedData = await persistAndReadBack(result.value, "S3 load");
      _lastSyncedJSON = JSON.stringify(persistedData);
      return { ok: true, value: persistedData };
    } catch (error) {
      // Cache lỗi (hoặc dữ liệu kho chưa đủ schema) → vẫn dùng bản vừa đọc từ kho
      console.warn("[Storage] IndexedDB cache commit skipped:", formatError(error));
      return { ok: true, value: result.value };
    }
  }

  if (allowCache) {
    const cachedData = await readIndexedDbFallback();
    if (cachedData) return { ok: true, value: cachedData, fromCache: true };

    const migratedData = await migrateLegacyLocalStorage();
    if (migratedData) return { ok: true, value: migratedData, fromCache: true };

    const memoryData = _memStore.get(STORAGE_KEY);
    if (memoryData) return { ok: true, value: memoryData, fromCache: true };
  }

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, value: null };
}

/**
 * Ghi cả khối lên S3 rồi mới cập nhật cache. Ném lỗi nếu kho từ chối hoặc ghi lỗi.
 */
export async function saveAllStrict(data) {
  assertValidData(data, "Save");
  await s3PutStrict(data);

  _memStore.set(STORAGE_KEY, data);
  _lastSyncedJSON = JSON.stringify(data);

  try {
    await indexedDbSet(STORAGE_KEY, data);
  } catch (error) {
    console.error("[IndexedDB] Cache write failed after a successful S3 save:", formatError(error));
  }
  return true;
}

export async function addItem(data, key, item, auditLog) {
  const next = {
    ...data,
    [key]: [...data[key], item],
    auditLog: auditLog || data.auditLog,
  };
  await saveAll(next);
  return next;
}

export async function editItem(data, key, id, updates, auditLog) {
  const next = {
    ...data,
    [key]: data[key].map(item => item.id === id ? { ...item, ...updates } : item),
    auditLog: auditLog || data.auditLog,
  };
  await saveAll(next);
  return next;
}

export async function softDeleteItem(data, key, id, deletedBy, auditLog) {
  const now = new Date().toISOString();
  const next = {
    ...data,
    [key]: data[key].map(item => item.id === id
      ? { ...item, deleted: true, deletedAt: now, deletedBy: deletedBy || "unknown" }
      : item),
    auditLog: auditLog || data.auditLog,
  };
  await saveAll(next);
  return next;
}

export async function saveSettings(data, newSettings, auditLog) {
  const next = {
    ...data,
    settings: newSettings,
    auditLog: auditLog || data.auditLog,
  };
  await saveAll(next);
  return next;
}

export async function saveMarkets(data, updatedMarkets, auditLog) {
  const next = {
    ...data,
    markets: updatedMarkets,
    auditLog: auditLog || data.auditLog,
  };
  await saveAll(next);
  return next;
}

export function alive(items) {
  return (items || []).filter(item => !item.deleted);
}

export function s3Flush(data) {
  if (data) {
    _memStore.set(STORAGE_KEY, data);
    indexedDbSet(STORAGE_KEY, data).catch(error => {
      console.error("[IndexedDB] Flush cache failed:", formatError(error));
    });
  }
  flushS3(data);
}

export function startAutoSync(getDataFn, setDataFn) {
  stopAutoSync();

  _syncTimer = setInterval(async () => {
    try {
      const localData = getDataFn();
      if (!localData) return;

      const remoteData = await s3Get();
      if (remoteData) {
        assertValidData(remoteData, "AutoSync S3 pull");
        const localJSON = JSON.stringify(localData);
        const remoteJSON = JSON.stringify(remoteData);

        if (localJSON !== remoteJSON) {
          const localLogLength = (localData.auditLog || []).length;
          const remoteLogLength = (remoteData.auditLog || []).length;

          if (remoteLogLength > localLogLength) {
            const persistedData = await persistAndReadBack(remoteData, "AutoSync S3 pull");
            console.info(`[AutoSync] Pull - remote has ${remoteLogLength} logs vs local ${localLogLength}`);
            setDataFn(persistedData);
            _lastSyncedJSON = JSON.stringify(persistedData);
            return;
          }
        }
      }

      const currentJSON = JSON.stringify(localData);
      if (_lastSyncedJSON !== currentJSON) {
        console.info("[AutoSync] Push - local data changed, syncing to S3");
        const saved = await s3Put(localData);
        if (saved) _lastSyncedJSON = currentJSON;
      } else {
        console.info("[AutoSync] No changes detected, skipping");
      }
    } catch (error) {
      console.warn("[AutoSync] Error:", formatError(error));
    }
  }, AUTO_SYNC_INTERVAL);

  console.info(`[AutoSync] Started Push+Pull - every ${AUTO_SYNC_INTERVAL / 1000}s`);
}

export function stopAutoSync() {
  if (!_syncTimer) return;
  clearInterval(_syncTimer);
  _syncTimer = null;
  console.info("[AutoSync] Stopped");
}

export { s3Get, s3GetStrict, s3Put, s3PutStrict, s3PutDebounced };
