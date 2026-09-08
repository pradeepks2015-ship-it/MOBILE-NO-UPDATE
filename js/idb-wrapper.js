        // ===== IndexedDB wrapper for photo-heavy entries (Broken Pole) =====
        // localStorage has a tiny ~5-10MB shared limit; IndexedDB allows much larger storage
        // for entries that include base64 photo data.
        const IDB_DB_NAME = "seoni-circle-photo-store";
        const IDB_DB_VERSION = 7;
        const IDB_STORES = ["broken_pole", "bijli_chori", "karya_charitra", "mobile_correction", "dtr_health", "permanent_disconnect", "sync_queue"];
        // Max entries allowed per store (raised from 500 to 2000 - photos are resized small,
        // so 2000 entries comfortably fits within typical IndexedDB quotas on mobile browsers).
        const IDB_STORE_LIMITS = {
            broken_pole: 500,
            bijli_chori: 200,
            karya_charitra: 1000,  // Text-only, no photos — higher limit ok
            mobile_correction: 2000, // Text-only, no photos — higher limit ok
            dtr_health: 500,
            permanent_disconnect: 150 // Har entry me 2-5 documents ho sakte hain — sabse zyada storage-heavy
        };
        // Note: Cloud (Google Sheet/Drive) has no practical limit for DC-level usage.
        // Local limits above are conservative since cloud sync backs up all entries.
        // Oldest local entries are auto-deleted when limit is reached — cloud copy remains safe.
        let idbInstance = null;

        // Shows a warning toast when a store is nearing its limit, so the user can
        // download the MIS report and clear old entries before data starts getting removed.
        async function checkStoreCapacityWarning_(storeName, labelHi) {
            try {
                const limit = IDB_STORE_LIMITS[storeName] || 500;
                const count = await idbCount_(storeName);
                const pct = count / limit;
                if (pct >= 1) {
                    showToast(`${labelHi}: Device cache full (${limit} entries) — sabse purani local entry auto-delete ho gayi. Cloud mein sab safe hai.`, false);
                } else if (pct >= 0.9) {
                    showToast(`${labelHi}: ${count}/${limit} entries device par. Limit ke paas — purani entries auto-delete hongi (cloud mein safe rahegi).`, false);
                } else if (pct >= 0.75) {
                    showToast(`${labelHi}: ${count}/${limit} entries device par (75% full).`, true);
                }
                return count;
            } catch (_) {
                return 0;
            }
        }

        function openPhotoDb_() {
            return new Promise((resolve, reject) => {
                if (idbInstance) return resolve(idbInstance);
                if (!window.indexedDB) return reject(new Error("IndexedDB not supported"));
                const request = indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    IDB_STORES.forEach((storeName) => {
                        if (!db.objectStoreNames.contains(storeName)) {
                            db.createObjectStore(storeName, { keyPath: "id", autoIncrement: true });
                        }
                    });
                };
                request.onsuccess = (event) => {
                    idbInstance = event.target.result;
                    resolve(idbInstance);
                };
                request.onerror = () => reject(request.error);
            });
        }

        async function idbGetAll_(storeName) {
            try {
                const db = await openPhotoDb_();
                return await new Promise((resolve, reject) => {
                    const tx = db.transaction(storeName, "readonly");
                    const store = tx.objectStore(storeName);
                    const req = store.getAll();
                    req.onsuccess = () => resolve(req.result || []);
                    req.onerror = () => reject(req.error);
                });
            } catch (_) {
                return [];
            }
        }

        async function idbAdd_(storeName, entry) {
            const db = await openPhotoDb_();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, "readwrite");
                const store = tx.objectStore(storeName);
                const req = store.add(entry);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }

        async function idbDelete_(storeName, id) {
            try {
                const db = await openPhotoDb_();
                const tx = db.transaction(storeName, "readwrite");
                const store = tx.objectStore(storeName);
                store.delete(id);
                return new Promise((resolve) => {
                    tx.oncomplete = () => resolve(true);
                    tx.onerror = () => resolve(false);
                });
            } catch (_) {
                return false;
            }
        }

        async function idbCount_(storeName) {
            try {
                const db = await openPhotoDb_();
                return await new Promise((resolve, reject) => {
                    const tx = db.transaction(storeName, "readonly");
                    const store = tx.objectStore(storeName);
                    const req = store.count();
                    req.onsuccess = () => resolve(req.result || 0);
                    req.onerror = () => reject(req.error);
                });
            } catch (_) {
                return 0;
            }
        }

        async function idbDeleteOldest_(storeName, count) {
            try {
                const db = await openPhotoDb_();
                const all = await idbGetAll_(storeName);
                const sorted = all.slice().sort((a, b) => (a.id || 0) - (b.id || 0));
                const toDelete = sorted.slice(0, count);
                const tx = db.transaction(storeName, "readwrite");
                const store = tx.objectStore(storeName);
                toDelete.forEach((item) => store.delete(item.id));
                return new Promise((resolve) => {
                    tx.oncomplete = () => resolve(true);
                    tx.onerror = () => resolve(false);
                });
            } catch (_) {
                return false;
            }
        }

        const feederAlertStartDateKey = "2026-07-01";

