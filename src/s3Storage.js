// ============================================================
// S3 Data Layer - GC BCKD v21
// Bucket: report-management-prod | Region: ap-southeast-1
//
// App state is stored as one JSON object. Uploaded source files are
// stored separately as base64 text objects and mirrored to browser
// storage so the app can still work when S3 is unavailable.
// ============================================================

export const STORAGE_KEY = "gochek_v5";

const S3_BUCKET = "report-management-prod";
const S3_REGION = "ap-southeast-1";
const S3_DATA_KEY = "report_data.json";
const S3_FILE_PREFIX = "gcbckd_files";
const S3_BASE_URL = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`;
const S3_DATA_URL = `${S3_BASE_URL}/${S3_DATA_KEY}`;

const FILE_KEY_PREFIX = "gcfile_";
const DEBOUNCE_MS = 1500;
const AUTO_SYNC_INTERVAL = 2 * 60 * 1000;

let _saveTimer = null;
let _syncTimer = null;
let _lastSyncedJSON = null;
const _memStore = {};

const hasLocalStorage = () => typeof localStorage !== "undefined";
const hasClaudeStorage = () =>
  typeof window !== "undefined" &&
  window.storage &&
  typeof window.storage.get === "function";

const safeJsonParse = (value) => {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

const clone = (value) => safeJsonParse(JSON.stringify(value));

const bckdArrayKeys = [
  "groups",
  "sources",
  "markets",
  "companies",
  "channels",
  "cats",
  "users",
  "products",
  "logs",
];

const bckdObjectKeys = [
  "rates",
  "skuMap",
  "catMap",
  "colMap",
  "costHint",
  "combos",
  "bankAccounts",
  "entries",
  "stock",
  "orderIds",
];

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isBckdState(data) {
  if (!isPlainObject(data)) return false;
  if (!Array.isArray(data.companies) || !Array.isArray(data.markets)) return false;
  if (!Array.isArray(data.channels) || !Array.isArray(data.cats)) return false;
  if (!Array.isArray(data.users)) return false;
  if (!isPlainObject(data.entries) || !isPlainObject(data.stock)) return false;
  return true;
}

function validateBckdStateBeforeSave(data) {
  if (!isPlainObject(data)) return { ok: false, reason: "Data is null or not an object" };
  if (!isBckdState(data)) return { ok: false, reason: "Data is not a GC BCKD state object" };

  for (const key of bckdArrayKeys) {
    if (!(key in data)) return { ok: false, reason: `Missing required key: ${key}` };
    if (!Array.isArray(data[key])) return { ok: false, reason: `${key} must be an array` };
  }

  for (const key of bckdObjectKeys) {
    if (!(key in data)) return { ok: false, reason: `Missing required key: ${key}` };
    if (!isPlainObject(data[key])) return { ok: false, reason: `${key} must be an object` };
  }

  if (data.markets.length === 0) return { ok: false, reason: "markets is empty" };
  if (data.companies.length === 0) return { ok: false, reason: "companies is empty" };
  if (data.channels.length === 0) return { ok: false, reason: "channels is empty" };
  if (data.cats.length === 0) return { ok: false, reason: "cats is empty" };
  if (!data.users.some((u) => u && u.username && u.role === "admin")) {
    return { ok: false, reason: "Missing admin user" };
  }

  return { ok: true };
}

function newestTimestamp(data) {
  if (!isPlainObject(data)) return 0;
  const stamps = [];
  (data.logs || []).forEach((x) => x && x.at && stamps.push(Date.parse(x.at) || 0));
  Object.values(data.fileMeta || {}).forEach((x) => x && x.at && stamps.push(Date.parse(x.at) || 0));
  return Math.max(0, ...stamps);
}

function fileStorageKey(id) {
  return `${FILE_KEY_PREFIX}${id}`;
}

function s3FileUrl(id) {
  return `${S3_BASE_URL}/${S3_FILE_PREFIX}/${encodeURIComponent(fileStorageKey(id))}.txt`;
}

function cacheSetRaw(key, value) {
  _memStore[key] = value;
  try {
    if (hasLocalStorage()) localStorage.setItem(key, value);
  } catch {}
}

function cacheGetRaw(key) {
  try {
    if (hasLocalStorage()) {
      const value = localStorage.getItem(key);
      if (value != null) return value;
    }
  } catch {}
  return _memStore[key] || null;
}

function cacheRemove(key) {
  delete _memStore[key];
  try {
    if (hasLocalStorage()) localStorage.removeItem(key);
  } catch {}
}

async function claudeGetRaw(key) {
  if (!hasClaudeStorage()) return null;
  try {
    const r = await window.storage.get(key);
    return r && r.value != null ? r.value : null;
  } catch {
    return null;
  }
}

async function claudeSetRaw(key, value) {
  if (!hasClaudeStorage() || typeof window.storage.set !== "function") return;
  try {
    await window.storage.set(key, value);
  } catch {}
}

async function claudeDelete(key) {
  if (!hasClaudeStorage() || typeof window.storage.delete !== "function") return;
  try {
    await window.storage.delete(key);
  } catch {}
}

// ============================================================
// Low-level S3
// ============================================================

export async function s3Get() {
  try {
    const res = await fetch(S3_DATA_URL, { method: "GET", cache: "no-store" });
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

export async function s3Put(data) {
  const check = validateBckdStateBeforeSave(data);
  if (!check.ok) {
    console.error("[S3] BLOCKED save:", check.reason);
    return false;
  }

  try {
    const res = await fetch(S3_DATA_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`S3 PUT failed: ${res.status} ${res.statusText}`);
    _lastSyncedJSON = JSON.stringify(data);
    console.log("[S3] Saved GC BCKD state");
    return true;
  } catch (err) {
    console.error("[S3] PUT error:", err.message);
    return false;
  }
}

export function s3PutDebounced(data) {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    s3Put(data);
  }, DEBOUNCE_MS);
}

export function s3Flush(data) {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  return data ? s3Put(data) : Promise.resolve(false);
}

// ============================================================
// State storage - S3 -> localStorage -> window.storage -> memory
// ============================================================

export async function loadAll() {
  const remote = await s3Get();
  if (isBckdState(remote)) {
    const json = JSON.stringify(remote);
    cacheSetRaw(STORAGE_KEY, json);
    await claudeSetRaw(STORAGE_KEY, json);
    _lastSyncedJSON = json;
    return remote;
  }
  if (remote && !isBckdState(remote)) {
    console.warn("[S3] Ignoring non-GC-BCKD report_data.json shape");
  }

  const local = safeJsonParse(cacheGetRaw(STORAGE_KEY));
  if (isBckdState(local)) return local;

  const claude = safeJsonParse(await claudeGetRaw(STORAGE_KEY));
  if (isBckdState(claude)) {
    cacheSetRaw(STORAGE_KEY, JSON.stringify(claude));
    return claude;
  }

  return null;
}

export async function saveAll(data) {
  const check = validateBckdStateBeforeSave(data);
  if (!check.ok) {
    console.error("[Storage] BLOCKED save:", check.reason);
    return false;
  }

  const json = JSON.stringify(data);
  cacheSetRaw(STORAGE_KEY, json);
  await claudeSetRaw(STORAGE_KEY, json);
  s3PutDebounced(clone(data));
  return true;
}

// ============================================================
// Uploaded file blobs
// ============================================================

export async function saveFileBlob(id, b64) {
  if (!id || !b64) return false;
  const key = fileStorageKey(id);
  cacheSetRaw(key, b64);
  await claudeSetRaw(key, b64);

  try {
    const res = await fetch(s3FileUrl(id), {
      method: "PUT",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: b64,
    });
    if (!res.ok) throw new Error(`S3 file PUT failed: ${res.status}`);
    return true;
  } catch (err) {
    console.warn("[S3] File PUT error, kept local cache:", err.message);
    return false;
  }
}

export async function loadFileBlob(id) {
  if (!id) return null;
  const key = fileStorageKey(id);

  const local = cacheGetRaw(key);
  if (local) return local;

  const claude = await claudeGetRaw(key);
  if (claude) {
    cacheSetRaw(key, claude);
    return claude;
  }

  try {
    const res = await fetch(s3FileUrl(id), { method: "GET", cache: "no-store" });
    if (!res.ok) return null;
    const b64 = await res.text();
    if (b64) {
      cacheSetRaw(key, b64);
      await claudeSetRaw(key, b64);
    }
    return b64 || null;
  } catch (err) {
    console.warn("[S3] File GET error:", err.message);
    return null;
  }
}

export async function deleteFileBlob(id) {
  if (!id) return;
  const key = fileStorageKey(id);
  cacheRemove(key);
  await claudeDelete(key);
  try {
    await fetch(s3FileUrl(id), { method: "DELETE" });
  } catch {}
}

export async function clearSavedFileBlobs(ids) {
  const list = Array.isArray(ids) ? ids : [];
  await Promise.all(list.map((id) => deleteFileBlob(id)));
}

export function clearLocalCache() {
  cacheRemove(STORAGE_KEY);
}

// ============================================================
// Auto sync
// ============================================================

export function startAutoSync(getDataFn, setDataFn) {
  stopAutoSync();
  _syncTimer = setInterval(async () => {
    try {
      const localData = getDataFn();
      if (!isBckdState(localData)) return;

      const remoteData = await s3Get();
      if (isBckdState(remoteData)) {
        const localJSON = JSON.stringify(localData);
        const remoteJSON = JSON.stringify(remoteData);

        if (remoteJSON !== localJSON) {
          const remoteTime = newestTimestamp(remoteData);
          const localTime = newestTimestamp(localData);
          if (remoteTime > localTime) {
            console.log("[AutoSync] Pull newer GC BCKD state from S3");
            cacheSetRaw(STORAGE_KEY, remoteJSON);
            await claudeSetRaw(STORAGE_KEY, remoteJSON);
            _lastSyncedJSON = remoteJSON;
            setDataFn(remoteData);
            return;
          }
        }
      }

      const currentJSON = JSON.stringify(localData);
      if (_lastSyncedJSON !== currentJSON) {
        console.log("[AutoSync] Push GC BCKD state to S3");
        await s3Put(localData);
      }
    } catch (err) {
      console.warn("[AutoSync] Error:", err.message);
    }
  }, AUTO_SYNC_INTERVAL);
  console.log(`[AutoSync] Started - every ${AUTO_SYNC_INTERVAL / 1000}s`);
}

export function stopAutoSync() {
  if (_syncTimer) {
    clearInterval(_syncTimer);
    _syncTimer = null;
    console.log("[AutoSync] Stopped");
  }
}

export function alive(arr) {
  return (arr || []).filter((x) => !x.deleted);
}
