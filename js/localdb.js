const DB_NAME = "controle-kits-v6";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ["items", "kits", "kit_items", "sales", "meta", "pending_ops"]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    try { result = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("IndexedDB transaction aborted"));
  });
}

export async function put(store, value) { return tx(store, "readwrite", s => s.put(value)); }
export async function remove(store, id) { return tx(store, "readwrite", s => s.delete(id)); }
export async function getAll(store) {
  return tx(store, "readonly", s => new Promise((resolve, reject) => {
    const r = s.getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  }));
}
export async function clear(store) { return tx(store, "readwrite", s => s.clear()); }
export async function setMeta(key, value) { return put("meta", { id:key, value }); }
export async function getMeta(key) {
  const all = await getAll("meta");
  return all.find(x => x.id === key)?.value;
}
