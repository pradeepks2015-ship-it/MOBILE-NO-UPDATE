        // ===== Shared Module Sync helpers (Broken Pole / Bijli Chori) =====
        // In-memory cache of remote (shared) entries per module, refreshed on view open.
        const sharedModuleEntriesCache = {
            broken_pole: [],
            bijli_chori: [],
            karya_charitra: [],
            dtr_health: [],
            permanent_disconnect: []
        };
        const sharedModuleLastFetch = {};

        // Sends a single entry (with photo(s) as base64 data URLs) to the shared backend.
        // Returns the entry_id assigned by the server, or "" on failure (caller should
        // continue working with local-only storage in that case).
        // Backend/config error hone par bhi entry queue me daal dete hain (network
        // error jaisa hi) — taaki koi bhi failure "silently local-only" na reh
        // jaaye. Caller __lastSyncErrorReason ("network"/"backend"/"disabled") aur
        // __lastSyncErrorMessage dekh kar sahi toast dikha sakta hai (galat "internet
        // nahi hai" na bole jab asal me backend/server error ho).
        async function mcQueueSyncFailure_(module, entry, isReplay) {
            if (isReplay) return;
            try {
                if (!entry.client_id) entry.client_id = genClientId_();
                await queueOfflineSync_({ kind: "shared_entry", module, entry: JSON.parse(JSON.stringify(entry)) });
                window.__lastSyncQueued = true;
            } catch (qErr) { console.error(qErr); }
        }

        async function syncEntryToCloud_(module, entry, isReplay = false) {
            window.__lastSyncQueued = false;
            window.__lastSyncErrorReason = "";
            window.__lastSyncErrorMessage = "";
            if (!sharedModuleSyncEnabled) { window.__lastSyncErrorReason = "disabled"; return ""; }
            try {
                // Step 1: Send entry metadata only (no photo_data) to get entry_id
                const entryToSync = JSON.parse(JSON.stringify(entry));
                if (entryToSync.photo_data) delete entryToSync.photo_data;
                if (Array.isArray(entryToSync.photos)) {
                    entryToSync.photos = entryToSync.photos.map((p) => {
                        const s = { ...p }; delete s.photo_data; return s;
                    });
                }

                const payload = new URLSearchParams();
                payload.append("module", module);
                payload.append("entry_json", JSON.stringify(entryToSync));
                payload.append("auth_token", APPS_SCRIPT_AUTH_TOKEN);

                const response = await fetchWithTimeout_(sharedModuleSyncScriptUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
                    body: payload.toString()
                });
                const responseText = await response.text();
                let parsed = null;
                try { parsed = JSON.parse(responseText || "{}"); } catch (_) {}
                if (!parsed || parsed.status !== "success") {
                    window.__lastSyncErrorReason = "backend";
                    window.__lastSyncErrorMessage = (parsed && parsed.message) || `Server ne HTTP ${response.status} diya`;
                    logErr_(`sync-${module}`, null, window.__lastSyncErrorMessage);
                    await mcQueueSyncFailure_(module, entry, isReplay);
                    return "";
                }
                const entryId = parsed.entry_id || "";
                if (!entryId) {
                    window.__lastSyncErrorReason = "backend";
                    window.__lastSyncErrorMessage = "Server se entry_id नहीं मिला";
                    logErr_(`sync-${module}`, null, window.__lastSyncErrorMessage);
                    await mcQueueSyncFailure_(module, entry, isReplay);
                    return "";
                }

                // Step 2: Upload each photo — AWAIT each one so they actually save to Drive
                // before we return. This makes submit slightly slower but ensures photos
                // are visible to other users immediately after submission.
                const photoUploads = [];
                if (entry.photo_data) {
                    photoUploads.push({ data: entry.photo_data, name: entry.photo_name || "", index: -1 });
                }
                if (Array.isArray(entry.photos)) {
                    entry.photos.forEach((p, idx) => {
                        if (p && p.photo_data) {
                            photoUploads.push({ data: p.photo_data, name: p.name || "", index: idx });
                        }
                    });
                }

                // Upload photos sequentially with retry (sequential avoids overwhelming Apps Script)
                for (const photo of photoUploads) {
                    let uploaded = false;
                    for (let attempt = 0; attempt < 3 && !uploaded; attempt++) {
                        try {
                            const photoPayload = new URLSearchParams();
                            photoPayload.append("module", module);
                            photoPayload.append("action", "uploadPhoto");
                            photoPayload.append("entry_id", entryId);
                            photoPayload.append("photo_data", photo.data);
                            photoPayload.append("photo_name", photo.name);
                            photoPayload.append("photo_index", String(photo.index));
                            photoPayload.append("auth_token", APPS_SCRIPT_AUTH_TOKEN);

                            const photoResponse = await fetchWithTimeout_(sharedModuleSyncScriptUrl, {
                                method: "POST",
                                headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
                                body: photoPayload.toString()
                            }, 30000); // photo data bada ho sakta hai, isliye lamba timeout
                            const photoResult = JSON.parse((await photoResponse.text()) || "{}");
                            if (photoResult && photoResult.status === "success") {
                                uploaded = true;
                            }
                        } catch (_) {
                            // Wait 1s before retry
                            await new Promise((r) => setTimeout(r, 1000));
                        }
                    }
                }

                // Invalidate cache so other users get fresh data with photos on next fetch
                sharedModuleLastFetch[module] = 0;

                return entryId;
            } catch (err) {
                // Network error (offline) ho ya koi aur unexpected error — dono cases
                // me queue me daal dete hain (internet aane/retry hone par apne aap
                // cloud me bhej degi), sirf reason/message alag hota hai taaki caller
                // sahi toast dikha sake (galat "internet nahi hai" na bole).
                const isNetworkErr = navigator.onLine === false || err instanceof TypeError || err?.name === "AbortError";
                window.__lastSyncErrorReason = isNetworkErr ? "network" : "backend";
                if (!isNetworkErr) {
                    window.__lastSyncErrorMessage = err && err.message ? err.message : String(err);
                    logErr_(`sync-${module}`, err);
                }
                console.error(err);
                await mcQueueSyncFailure_(module, entry, isReplay);
                return "";
            }
        }

        // ===================== OFFLINE SYNC QUEUE =====================
        // Internet na hone par submit hui entries is queue me jaati hain aur
        // internet aate hi APNE AAP cloud me sync ho jaati hain.
        function genClientId_() {
            return "C" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        }

        async function idbPut_(storeName, record) {
            const db = await openPhotoDb_();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, "readwrite");
                const req = tx.objectStore(storeName).put(record);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }

        async function queueOfflineSync_(item) {
            await idbAdd_("sync_queue", { ...item, createdAt: Date.now() });
            updateSyncQueueBadge_();
        }

        // Sync hone ke baad local record me cloud ka entry_id bhar deta hai,
        // taaki wahi entry duplicate na dikhe.
        async function backfillEntryId_(module, clientId, entryId) {
            if (!clientId || !entryId) return;
            try {
                if (!IDB_STORES.includes(module)) return;
                const all = await idbGetAll_(module);
                const rec = all.find((r) => r.client_id === clientId);
                if (rec && !rec.entry_id) {
                    rec.entry_id = entryId;
                    await idbPut_(module, rec);
                }
            } catch (err) { console.error(err); }
        }

        // Generic version of kcUpdateRecord_ — kisi bhi module ki ek existing entry
        // (jaise mobile_correction ka status "pending" se "corrected" karna) cloud +
        // local dono jagah update karta hai, offline hone par sync_queue me daal deta hai.
        async function updateSharedEntry_(module, id, updates) {
            window.__lastSyncErrorReason = "";
            window.__lastSyncErrorMessage = "";
            if (sharedModuleSyncEnabled) {
                let cloudEntryId = (typeof id === "string" && id.startsWith("E")) ? id : null;
                if (!cloudEntryId) {
                    const all = await idbGetAll_(module);
                    cloudEntryId = all.find((r) => r.id === id)?.entry_id || null;
                }
                if (cloudEntryId) {
                    try {
                        const payload = new URLSearchParams();
                        payload.append("module", module);
                        payload.append("action", "updateEntry");
                        payload.append("entry_id", cloudEntryId);
                        payload.append("updates_json", JSON.stringify(updates));
                        payload.append("auth_token", APPS_SCRIPT_AUTH_TOKEN);
                        const response = await fetchWithTimeout_(sharedModuleSyncScriptUrl, {
                            method: "POST",
                            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
                            body: payload.toString()
                        });
                        const responseText = await response.text();
                        let parsed = null;
                        try { parsed = JSON.parse(responseText || "{}"); } catch (_) {}
                        if (!response.ok || !parsed || parsed.status !== "success") {
                            window.__lastSyncErrorReason = "backend";
                            window.__lastSyncErrorMessage = (parsed && parsed.message) || `Server ne HTTP ${response.status} diya`;
                            logErr_(`update-${module}`, null, window.__lastSyncErrorMessage);
                            await queueOfflineSync_({ kind: "entry_update", module, entryId: cloudEntryId, updates });
                        } else {
                            sharedModuleLastFetch[module] = 0;
                        }
                    } catch (err) {
                        const isNetworkErr = navigator.onLine === false || err instanceof TypeError || err?.name === "AbortError";
                        window.__lastSyncErrorReason = isNetworkErr ? "network" : "backend";
                        if (!isNetworkErr) {
                            window.__lastSyncErrorMessage = err && err.message ? err.message : String(err);
                            logErr_(`update-${module}`, err);
                        }
                        try {
                            await queueOfflineSync_({ kind: "entry_update", module, entryId: cloudEntryId, updates });
                        } catch (_) {}
                    }
                } else {
                    // Original entry khud abhi tak cloud par sync nahi hui (uska
                    // apna sync_queue item pending hai) — isliye update bhejne ke
                    // liye koi cloud entry_id nahi hai. Jab wo original entry sync
                    // ho jaayegi, tab tak yeh correction sirf local rahega.
                    window.__lastSyncErrorReason = "pending_original";
                    window.__lastSyncErrorMessage = "मूल entry अभी cloud पर sync नहीं हुई";
                }
            }
            try {
                const db = await openPhotoDb_();
                return await new Promise((resolve) => {
                    const tx = db.transaction(module, "readwrite");
                    const store = tx.objectStore(module);
                    const req = store.get(id);
                    req.onsuccess = () => {
                        if (req.result) {
                            store.put({ ...req.result, ...updates });
                        } else {
                            const allReq = store.getAll();
                            allReq.onsuccess = () => {
                                const found = (allReq.result || []).find((r) => r.entry_id === id);
                                if (found) store.put({ ...found, ...updates });
                            };
                        }
                    };
                    tx.oncomplete = () => resolve(true);
                    tx.onerror = () => resolve(false);
                });
            } catch (_) {
                return false;
            }
        }

        async function updateSyncQueueBadge_() {
            try {
                const badge = document.getElementById("sync-queue-badge");
                if (!badge) return;
                const items = await idbGetAll_("sync_queue");
                if (items.length) {
                    badge.style.display = "inline-flex";
                    // Kai baar fail ho chuki entries alag se dikhati hain — ye
                    // apne aap kabhi sync nahi hongi, JE ko dekhna padega
                    // (Diagnostics me ctx "sync-..." dhoondh sakte hain).
                    const stuckCount = items.filter((it) => (it.failCount || 0) >= STUCK_ENTRY_THRESHOLD).length;
                    if (stuckCount) {
                        badge.style.background = "#dc2626";
                        badge.style.color = "#ffffff";
                        badge.innerText = `⚠️ ${items.length} pending (${stuckCount} अटकी हुई)`;
                    } else {
                        badge.style.background = "#fff7ed";
                        badge.style.color = "#9a3412";
                        badge.innerText = `🔄 ${items.length} pending`;
                    }
                } else {
                    badge.style.display = "none";
                }
            } catch (err) { console.error(err); }
        }

        // Ek entry baar-baar (STUCK_ENTRY_THRESHOLD baar) fail ho jaaye to use
        // "stuck" maante hain — badge me alag se dikhega taaki JE ko pata chale
        // ki iske liye manual dekhna padega (queue khud kabhi nahi rukegi).
        const STUCK_ENTRY_THRESHOLD = 5;
        async function bumpSyncQueueFailCount_(item) {
            try {
                item.failCount = (item.failCount || 0) + 1;
                await idbPut_("sync_queue", item);
            } catch (err) { console.error(err); }
        }

        let syncQueueProcessing_ = false;
        async function processSyncQueue_() {
            if (syncQueueProcessing_) return;
            if (navigator.onLine === false) return;
            syncQueueProcessing_ = true;
            let done = 0;
            let networkDown = false;
            try {
                const items = (await idbGetAll_("sync_queue")).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
                for (const item of items) {
                    // Network hi down ho gaya ho to baaki items try karne ka fayda
                    // nahi — sab isi wajah se fail honge, agli baar poori queue
                    // dobara try hogi. Lekin ek item ka apna (backend/logical)
                    // fail baaki queue ko kabhi block nahi karta — bas usi item
                    // ko skip karke aage badhte hain.
                    if (networkDown) break;
                    let ok = false;
                    try {
                        if (item.kind === "shared_entry") {
                            const entryId = await syncEntryToCloud_(item.module, item.entry, true);
                            if (entryId) {
                                await backfillEntryId_(item.module, item.entry.client_id, entryId);
                                sharedModuleLastFetch[item.module] = 0;
                                ok = true;
                            } else if (window.__lastSyncErrorReason === "network") {
                                networkDown = true;
                            }
                        } else if (item.kind === "post_form") {
                            const response = await fetchWithTimeout_(APPS_SCRIPT_EXEC_URL, {
                                method: "POST",
                                headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
                                body: item.body
                            });
                            ok = response.ok;
                        } else if (item.kind === "kc_update") {
                            const payload = new URLSearchParams();
                            payload.append("module", "karya_charitra");
                            payload.append("action", "updateEntry");
                            payload.append("entry_id", item.entryId);
                            payload.append("updates_json", JSON.stringify(item.updates));
                            payload.append("auth_token", APPS_SCRIPT_AUTH_TOKEN);
                            const response = await fetchWithTimeout_(sharedModuleSyncScriptUrl, {
                                method: "POST",
                                headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
                                body: payload.toString()
                            });
                            ok = response.ok;
                            if (ok) sharedModuleLastFetch["karya_charitra"] = 0;
                        } else if (item.kind === "entry_update") {
                            // Generic version of kc_update — kisi bhi module ke liye
                            // (jaise mobile_correction) offline me hui update ko replay karta hai.
                            const payload = new URLSearchParams();
                            payload.append("module", item.module);
                            payload.append("action", "updateEntry");
                            payload.append("entry_id", item.entryId);
                            payload.append("updates_json", JSON.stringify(item.updates));
                            payload.append("auth_token", APPS_SCRIPT_AUTH_TOKEN);
                            const response = await fetchWithTimeout_(sharedModuleSyncScriptUrl, {
                                method: "POST",
                                headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
                                body: payload.toString()
                            });
                            ok = response.ok;
                            if (ok) sharedModuleLastFetch[item.module] = 0;
                        }
                    } catch (err) {
                        console.error(err);
                        const isNetworkErr = navigator.onLine === false || err instanceof TypeError || err?.name === "AbortError";
                        if (isNetworkErr) networkDown = true;
                    }

                    if (ok) {
                        await idbDelete_("sync_queue", item.id);
                        done++;
                    } else if (!networkDown) {
                        await bumpSyncQueueFailCount_(item);
                    }
                }
            } finally {
                syncQueueProcessing_ = false;
                updateSyncQueueBadge_();
                if (done) showToast(`${done} offline entry cloud me sync ho gayi ✅`, true);
            }
        }

        // Internet wapas aate hi sync; app khulne par bhi check; har 2 min safety check
        window.addEventListener("online", () => setTimeout(processSyncQueue_, 1500));
        setTimeout(processSyncQueue_, 5000);
        setTimeout(updateSyncQueueBadge_, 3000);
        setInterval(processSyncQueue_, 120000);
        // ================== END OFFLINE SYNC QUEUE ====================

        // Error-log cloud sync — asli user-data (upar wali queue) se kam priority
        // isliye zyada delay se shuru hoti hai aur kam baar chalti hai, taaki field
        // me limited network/Apps Script slot pehle asli kaam ke liye mile.
        setTimeout(syncErrorLogsToCloud_, 20000);
        setInterval(syncErrorLogsToCloud_, 300000);

        // Fetches all shared entries for a module from the backend. Returns [] on
        // failure (offline, not configured, etc.) so callers can fall back to local data.
        async function fetchSharedEntries_(module, forceRefresh) {
            if (!sharedModuleSyncEnabled) return [];
            const now = Date.now();
            if (!forceRefresh && sharedModuleLastFetch[module] && (now - sharedModuleLastFetch[module] < 10000)) {
                return sharedModuleEntriesCache[module] || [];
            }
            try {
                const url = `${sharedModuleSyncScriptUrl}?action=getEntries&module=${encodeURIComponent(module)}&auth_token=${encodeURIComponent(APPS_SCRIPT_AUTH_TOKEN)}`;
                const data = await loadRemoteJson(url);
                if (data && data.status === "success" && Array.isArray(data.entries)) {
                    sharedModuleEntriesCache[module] = data.entries;
                    sharedModuleLastFetch[module] = now;
                    return data.entries;
                }
                return sharedModuleEntriesCache[module] || [];
            } catch (_) {
                return sharedModuleEntriesCache[module] || [];
            }
        }

        // Deletes a shared entry on the backend by its entry_id (string assigned by server).
        async function deleteSharedEntry_(module, entryId) {
            if (!sharedModuleSyncEnabled || !entryId) return false;
            try {
                const payload = new URLSearchParams();
                payload.append("module", module);
                payload.append("action", "deleteEntry");
                payload.append("entry_id", entryId);
                payload.append("auth_token", APPS_SCRIPT_AUTH_TOKEN);
                const response = await fetchWithTimeout_(sharedModuleSyncScriptUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
                    body: payload.toString()
                });
                const text = await response.text();
                const parsed = JSON.parse(text || "{}");
                return parsed && parsed.status === "success";
            } catch (_) {
                return false;
            }
        }

        // Merges local IndexedDB entries with shared (remote) entries for a module,
        // de-duplicating by entry_id (entries synced from this device will have the
        // same entry_id locally and remotely once sync succeeds).
        function mergeLocalAndSharedEntries_(localEntries, sharedEntries) {
            const merged = [];
            const seenIds = new Set();

            // Shared entries first (so cloud copy - with Drive photo URLs - wins on id collision)
            (sharedEntries || []).forEach((e) => {
                const id = e.entry_id || "";
                if (id) seenIds.add(id);
                merged.push(e);
            });

            (localEntries || []).forEach((e) => {
                const id = e.entry_id || "";
                if (id && seenIds.has(id)) return; // already represented by shared copy
                merged.push(e);
            });

            // Sort by timestamp ascending (fallback to local id) so newest-first reversal works consistently
            merged.sort((a, b) => {
                const ta = a.timestamp ? new Date(a.timestamp).getTime() : (a.id || 0);
                const tb = b.timestamp ? new Date(b.timestamp).getTime() : (b.id || 0);
                return ta - tb;
            });
            return merged;
        }

        // Generic version of getMobileCorrectionEntries_/getBrokenPoleEntries_/
        // getBijliChoriEntries_ — teeno pehle bilkul yehi 6 lines alag-alag copy
        // kiye hue the (sirf storeName badalta tha). mode: "force" = hamesha
        // fresh network fetch (default). "soft" = 10s cache window respect karo.
        // "cache" = jo bhi cached hai turant, koi network wait nahi.
        async function getModuleEntries_(storeName, mode = "force") {
            const rows = await idbGetAll_(storeName);
            const local = rows.slice().sort((a, b) => (a.id || 0) - (b.id || 0));
            const shared = mode === "cache"
                ? (sharedModuleEntriesCache[storeName] || [])
                : await fetchSharedEntries_(storeName, mode === "force");
            return mergeLocalAndSharedEntries_(local, shared);
        }

        let feederRecentSubmittedEntries = [];
