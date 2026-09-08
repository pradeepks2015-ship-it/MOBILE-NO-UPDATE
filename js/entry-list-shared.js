        // ===== Generic Saved Entries List / View / Delete (all photo-store tabs) =====
        const ENTRY_STORE_CONFIG = {
            broken_pole: {
                label: "Broken Pole / Damage Line",
                accent: "#b45309",
                getEntries: getBrokenPoleEntries_,
                getThumb: (e) => e.photo_data || normalizeDrivePhotoUrl_(e.photo_url) || "",
                getTitle: (e) => `${e.date || ""} — ${e.remark1 || "Entry"}`,
                getSubtitle: (e) => e.remark2 || (e.gps_location || ""),
                refreshFn: () => refreshBrokenPoleMisTotal()
            },
            bijli_chori: {
                label: "बिजली चोरी की जानकारी",
                accent: "#dc2626",
                getEntries: getBijliChoriEntries_,
                getThumb: (e) => (e.photos && e.photos[0] && (e.photos[0].photo_data || normalizeDrivePhotoUrl_(e.photos[0].photo_url))) || "",
                getTitle: (e) => `${e.date || ""} — ${e.name || e.ivrs || "Entry"}`,
                getSubtitle: (e) => `${(e.photos || []).length} photo(s) | ${e.remark || ""}`,
                refreshFn: () => refreshBijliChoriMisTotal()
            },
            dtr_health: {
                label: "DTR (ट्रांसफार्मर) हेल्थ लॉग",
                accent: "#7c3aed",
                getEntries: getDtrHealthEntries_,
                getThumb: (e) => e.photo_data || normalizeDrivePhotoUrl_(e.photo_url) || "",
                getTitle: (e) => `${e.date || ""} — ${e.dtr_no || "Entry"}`,
                getSubtitle: (e) => e.issue_type || (e.gps_location || ""),
                refreshFn: () => refreshDtrHealthMisTotal()
            },
            permanent_disconnect: {
                label: "स्थाई विच्छेदन योग्य उपभोक्ता",
                accent: "#7c3aed",
                getEntries: getPermanentDisconnectEntries_,
                getThumb: (e) => (e.photos && e.photos[0] && (e.photos[0].photo_data || normalizeDrivePhotoUrl_(e.photos[0].photo_url))) || "",
                getTitle: (e) => `${e.date || ""} — ${e.consumer_name || "Entry"}`,
                getSubtitle: (e) => `${(e.photos || []).length} दस्तावेज़ | ${e.reason || ""}`,
                refreshFn: () => refreshPermanentDisconnectMisTotal()
            }
        };

        async function refreshStorageCounter_(storeName) {
            const config = ENTRY_STORE_CONFIG[storeName];
            if (!config) return;
            const usedNode = document.getElementById(`${storageCounterPrefix_(storeName)}-storage-used`);
            const limitNode = document.getElementById(`${storageCounterPrefix_(storeName)}-storage-limit`);
            if (!usedNode || !limitNode) return;
            const count = await idbCount_(storeName);
            const limit = IDB_STORE_LIMITS[storeName] || 2000;
            usedNode.innerText = count;
            limitNode.innerText = limit;
            const wrapper = document.getElementById(`${storageCounterPrefix_(storeName)}-storage-counter`);
            if (wrapper) {
                if (count / limit >= 0.95) {
                    wrapper.style.color = "#fee2e2";
                    wrapper.style.fontWeight = "900";
                }
                const syncNoteId = `${storageCounterPrefix_(storeName)}-sync-note`;
                let syncNote = document.getElementById(syncNoteId);
                if (!syncNote) {
                    syncNote = document.createElement("div");
                    syncNote.id = syncNoteId;
                    syncNote.style.fontSize = "10px";
                    syncNote.style.fontWeight = "700";
                    syncNote.style.marginTop = "2px";
                    wrapper.insertAdjacentElement("afterend", syncNote);
                }
                syncNote.innerText = sharedModuleSyncEnabled
                    ? "🌐 Shared: sabhi users ko yeh entries dikhengi"
                    : "⚠️ Sirf is device par save (cloud sync OFF)";
                syncNote.style.color = sharedModuleSyncEnabled ? "#d1fae5" : "#fde68a";
                syncNote.style.textAlign = "center";
            }
        }

        function storageCounterPrefix_(storeName) {
            const map = {
                broken_pole: "bp",
                bijli_chori: "bc",
                dtr_health: "dtr",
                permanent_disconnect: "pd"
            };
            return map[storeName] || storeName;
        }

        async function toggleEntriesList(storeName) {
            const container = document.getElementById(`entries-list-${storeName}`);
            if (!container) return;
            const isOpen = container.style.display !== "none";
            if (isOpen) {
                container.style.display = "none";
                container.innerHTML = "";
                return;
            }
            container.style.display = "block";

            // Turant jo bhi data maujood hai (local + jo bhi cached hai, chahe abhi
            // tak fetch hi na hui ho) turant dikha dete hain — network ka slow/hang
            // hona list-open ko kabhi block nahi karta. Fresh cloud data background
            // me load hoke chupchaap list update kar deta hai.
            await renderEntriesList_(storeName, "cache");
            renderEntriesList_(storeName, "force"); // background refresh, fire-and-forget
        }

        // Returns a stable string identifier for an entry, usable for view/delete lookups
        // regardless of whether the entry came from local IndexedDB (numeric `id`) or
        // the shared cloud backend (string `entry_id`).
        function getEntryUid_(entry) {
            if (entry.entry_id) return `cloud_${entry.entry_id}`;
            return `local_${entry.id}`;
        }

        // Entry-detail overlay ke liye chhota sa client-side cache — jab list ya Admin
        // Dashboard entries already fetch kar chuka ho, "View" click par dobara pura
        // getEntries() (aur uske saath bijli_chori ke saare photos) re-fetch nahi karna
        // padta. Cache-miss hone par viewEntryDetail_ purani tarah fetch kar leta hai.
        const entryDetailCache_ = {};
        function cacheEntriesForDetail_(storeName, entries) {
            entryDetailCache_[storeName] = entryDetailCache_[storeName] || {};
            entries.forEach((e) => { entryDetailCache_[storeName][getEntryUid_(e)] = e; });
        }

        async function renderEntriesList_(storeName, mode = "force") {
            const config = ENTRY_STORE_CONFIG[storeName];
            const container = document.getElementById(`entries-list-${storeName}`);
            if (!config || !container) return;

            const entries = await config.getEntries(mode);
            cacheEntriesForDetail_(storeName, entries);
            const sorted = entries.slice().reverse(); // newest first

            // "cache" mode me agar is session me abhi tak cloud se ek baar bhi fetch
            // nahi hui, to sirf is device ka local data dikh sakta hai — dusre users
            // ki entries abhi load ho rahi hain, isliye ek chhota syncing note.
            const stillSyncing = mode === "cache" && !sharedModuleLastFetch[storeName];
            const syncingNoteHtml = stillSyncing
                ? `<div style="text-align:center; padding:6px; margin-bottom:8px; font-size:10.5px; font-weight:800; color:#fef3c7; background:rgba(0,0,0,0.18); border-radius:8px;">☁️ बाकी users की entries load हो रही हैं...</div>`
                : "";

            if (!sorted.length) {
                container.innerHTML = `${trustedHtml_(syncingNoteHtml)}<div style="text-align:center; padding:14px; font-size:12px; font-weight:800; color:#ffffff; background:rgba(0,0,0,0.12); border-radius:12px;">Koi saved entry nahi hai.</div>`;
                return;
            }

            container.innerHTML = `
                ${trustedHtml_(syncingNoteHtml)}
                <div style="background:rgba(255,255,255,0.92); border-radius:14px; padding:8px; max-height:340px; overflow-y:auto;">
                    ${trustedHtml_(sorted.map((e) => {
                        const thumb = config.getThumb(e) || "";
                        const uidJs = mcJsEscape_(getEntryUid_(e));
                        return `
                        <div style="display:flex; align-items:center; gap:10px; padding:8px; border-bottom:1px solid #e5e7eb;">
                            ${thumb ? `<img src="${escapeHtml(thumb)}" alt="एंट्री थंबनेल" referrerpolicy="no-referrer" style="width:46px; height:46px; object-fit:cover; border-radius:8px; border:1px solid #e5e7eb; flex-shrink:0;">` : `<div style="width:46px; height:46px; border-radius:8px; background:#f1f5f9; flex-shrink:0;"></div>`}
                            <div style="flex:1; min-width:0;">
                                <div style="font-size:11px; font-weight:900; color:#1e293b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(config.getTitle(e))}</div>
                                <div style="font-size:10px; font-weight:700; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(config.getSubtitle(e))}</div>
                            </div>
                            <button onclick="viewEntryDetail_('${storeName}', '${uidJs}')" style="border:none; background:#e0f2fe; color:#075985; border-radius:999px; padding:6px 10px; font-size:10px; font-weight:900; text-transform:uppercase; flex-shrink:0;">View</button>
                            <button onclick="deleteEntryConfirm_('${storeName}', '${uidJs}')" style="border:none; background:#fee2e2; color:#b91c1c; border-radius:999px; padding:6px 10px; font-size:10px; font-weight:900; text-transform:uppercase; flex-shrink:0;">Delete</button>
                        </div>`;
                    }).join(""))}
                </div>
            `;
        }

        async function viewEntryDetail_(storeName, uid) {
            const config = ENTRY_STORE_CONFIG[storeName];
            if (!config) return;

            // Turant loading feedback dikhao — network/IDB fetch me lagne wale samay
            // me bhi user ko turant pata chale ki click register ho gaya hai.
            const existingLoader = document.getElementById("entry-detail-overlay");
            if (existingLoader) existingLoader.remove();
            const overlay = document.createElement("div");
            overlay.id = "entry-detail-overlay";
            overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px;";
            overlay.innerHTML = `<div style="background:#ffffff; border-radius:16px; padding:20px 28px; font-size:12px; font-weight:900; color:#1e293b;">लोड हो रहा है...</div>`;
            overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
            document.body.appendChild(overlay);

            let entry = entryDetailCache_[storeName]?.[uid];
            if (!entry) {
                const entries = await config.getEntries();
                cacheEntriesForDetail_(storeName, entries);
                entry = entries.find((e) => getEntryUid_(e) === uid);
            }
            if (!document.getElementById("entry-detail-overlay")) return; // is beech user ne loader band kar diya
            if (!entry) {
                overlay.remove();
                return showToast("Entry nahi mili", false);
            }
            overlay.innerHTML = "";

            let bodyHtml = "";
            if (storeName === "broken_pole") {
                bodyHtml = `
                    ${entry.photo_data ? `<img src="${escapeHtml(entry.photo_data)}" alt="एंट्री फोटो" style="width:100%; max-height:240px; object-fit:cover; border-radius:10px; margin-bottom:8px;">` : (entry.photo_url ? `<img src="${escapeHtml(normalizeDrivePhotoUrl_(entry.photo_url))}" alt="एंट्री फोटो" style="width:100%; max-height:240px; object-fit:cover; border-radius:10px; margin-bottom:8px;" referrerpolicy="no-referrer">` : "")}
                    <div class="photo-meta-row"><strong>Date:</strong> ${escapeHtml(entry.date || "")}</div>
                    <div class="photo-meta-row"><strong>Remark 1:</strong> ${escapeHtml(entry.remark1 || "")}</div>
                    <div class="photo-meta-row"><strong>Remark 2:</strong> ${escapeHtml(entry.remark2 || "")}</div>
                    <div class="photo-meta-row"><strong>GPS:</strong> ${escapeHtml((entry.gps_latitude && entry.gps_longitude) ? `${entry.gps_latitude}, ${entry.gps_longitude}` : "N/A")}</div>
                    <div class="photo-meta-row"><strong>Location:</strong> ${escapeHtml(entry.gps_location || "N/A")}</div>
                    ${isValidLatLon_(entry.gps_latitude, entry.gps_longitude) ? `<div style="margin-top:8px;"><a href="https://www.google.com/maps/dir/?api=1&destination=${trustedHtml_(entry.gps_latitude)},${trustedHtml_(entry.gps_longitude)}" target="_blank" rel="noopener" style="display:inline-flex; align-items:center; gap:6px; background:linear-gradient(135deg,#16a34a,#15803d); color:#fff; font-size:11px; font-weight:900; text-transform:uppercase; padding:8px 14px; border-radius:10px; text-decoration:none;">Get Directions</a></div>` : ""}
                `;
            } else if (storeName === "bijli_chori") {
                bodyHtml = `
                    <div class="photo-meta-row"><strong>Date:</strong> ${escapeHtml(entry.date || "")}</div>
                    <div class="photo-meta-row"><strong>IVRS/Ref:</strong> ${escapeHtml(entry.ivrs || "")}</div>
                    <div class="photo-meta-row"><strong>Naam/Sthan:</strong> ${escapeHtml(entry.name || "")}</div>
                    <div class="photo-meta-row"><strong>Remark:</strong> ${escapeHtml(entry.remark || "")}</div>
                    ${trustedHtml_((entry.photos || []).map((p, idx) => `
                        <div style="margin-top:10px; padding-top:10px; border-top:1px solid #e5e7eb;">
                            <div style="font-size:11px; font-weight:900; color:#1e293b; margin-bottom:6px;">${escapeHtml(p.name || ("Photo " + (idx + 1)))}</div>
                            ${p.photo_data ? `<img src="${escapeHtml(p.photo_data)}" alt="एंट्री फोटो" style="width:100%; max-height:200px; object-fit:cover; border-radius:10px; margin-bottom:6px;">` : (p.photo_url ? `<img src="${escapeHtml(normalizeDrivePhotoUrl_(p.photo_url))}" alt="एंट्री फोटो" style="width:100%; max-height:200px; object-fit:cover; border-radius:10px; margin-bottom:6px;" referrerpolicy="no-referrer">` : "")}
                            <div class="photo-meta-row"><strong>GPS:</strong> ${escapeHtml((p.gps_latitude && p.gps_longitude) ? `${p.gps_latitude}, ${p.gps_longitude}` : "N/A")}</div>
                            <div class="photo-meta-row"><strong>Location:</strong> ${escapeHtml(p.gps_location || "N/A")}</div>
                            ${isValidLatLon_(p.gps_latitude, p.gps_longitude) ? `<div style="margin-top:6px;"><a href="https://www.google.com/maps/dir/?api=1&destination=${trustedHtml_(p.gps_latitude)},${trustedHtml_(p.gps_longitude)}" target="_blank" rel="noopener" style="display:inline-flex; align-items:center; gap:6px; background:linear-gradient(135deg,#16a34a,#15803d); color:#fff; font-size:11px; font-weight:900; text-transform:uppercase; padding:8px 14px; border-radius:10px; text-decoration:none;">Get Directions</a></div>` : ""}
                        </div>
                    `).join(""))}
                `;
            } else if (storeName === "permanent_disconnect") {
                bodyHtml = `
                    <div class="photo-meta-row"><strong>Date:</strong> ${escapeHtml(entry.date || "")}</div>
                    <div class="photo-meta-row"><strong>उपभोक्ता:</strong> ${escapeHtml(entry.consumer_name || "")}</div>
                    <div class="photo-meta-row"><strong>कारण:</strong> ${escapeHtml(entry.reason || "")}</div>
                    <div class="photo-meta-row"><strong>Remark:</strong> ${escapeHtml(entry.remark || "")}</div>
                    ${trustedHtml_((entry.photos || []).map((p, idx) => {
                        const isImg = String(p.photo_data || "").startsWith("data:image") || (p.photo_url && !p.photo_url.match(/\.pdf($|\?)/i));
                        return `
                        <div style="margin-top:10px; padding-top:10px; border-top:1px solid #e5e7eb;">
                            <div style="font-size:11px; font-weight:900; color:#1e293b; margin-bottom:6px;">${escapeHtml(p.name || ("दस्तावेज़ " + (idx + 1)))}</div>
                            ${isImg
                                ? (p.photo_data ? `<img src="${escapeHtml(p.photo_data)}" alt="दस्तावेज़" style="width:100%; max-height:200px; object-fit:cover; border-radius:10px; margin-bottom:6px;">` : (p.photo_url ? `<img src="${escapeHtml(normalizeDrivePhotoUrl_(p.photo_url))}" alt="दस्तावेज़" style="width:100%; max-height:200px; object-fit:cover; border-radius:10px; margin-bottom:6px;" referrerpolicy="no-referrer">` : ""))
                                : `<a href="${escapeHtml(p.photo_data || normalizeDrivePhotoUrl_(p.photo_url) || "")}" target="_blank" rel="noopener" style="display:inline-block; margin-bottom:6px; font-size:11px; font-weight:800; color:#5b21b6; background:#ede9fe; border-radius:8px; padding:6px 10px;">📄 दस्तावेज़ देखें</a>`
                            }
                            ${(p.gps_latitude && p.gps_longitude) ? `
                                <div class="photo-meta-row"><strong>GPS:</strong> ${escapeHtml(`${p.gps_latitude}, ${p.gps_longitude}`)}</div>
                                <div class="photo-meta-row"><strong>Location:</strong> ${escapeHtml(p.gps_location || "N/A")}</div>
                                ${isValidLatLon_(p.gps_latitude, p.gps_longitude) ? `<div style="margin-top:6px;"><a href="https://www.google.com/maps/dir/?api=1&destination=${trustedHtml_(p.gps_latitude)},${trustedHtml_(p.gps_longitude)}" target="_blank" rel="noopener" style="display:inline-flex; align-items:center; gap:6px; background:linear-gradient(135deg,#16a34a,#15803d); color:#fff; font-size:11px; font-weight:900; text-transform:uppercase; padding:8px 14px; border-radius:10px; text-decoration:none;">Get Directions</a></div>` : ""}
                            ` : ""}
                        </div>
                    `;
                    }).join(""))}
                `;
            } else if (storeName === "dtr_health") {
                bodyHtml = `
                    ${entry.photo_data ? `<img src="${escapeHtml(entry.photo_data)}" alt="एंट्री फोटो" style="width:100%; max-height:240px; object-fit:cover; border-radius:10px; margin-bottom:8px;">` : (entry.photo_url ? `<img src="${escapeHtml(normalizeDrivePhotoUrl_(entry.photo_url))}" alt="एंट्री फोटो" style="width:100%; max-height:240px; object-fit:cover; border-radius:10px; margin-bottom:8px;" referrerpolicy="no-referrer">` : "")}
                    <div class="photo-meta-row"><strong>Date:</strong> ${escapeHtml(entry.date || "")}</div>
                    <div class="photo-meta-row"><strong>DTR No / स्थान:</strong> ${escapeHtml(entry.dtr_no || "")}</div>
                    <div class="photo-meta-row"><strong>समस्या का प्रकार:</strong> ${escapeHtml(entry.issue_type || "")}</div>
                    <div class="photo-meta-row"><strong>Remark:</strong> ${escapeHtml(entry.remark || "")}</div>
                    <div class="photo-meta-row"><strong>GPS:</strong> ${escapeHtml((entry.gps_latitude && entry.gps_longitude) ? `${entry.gps_latitude}, ${entry.gps_longitude}` : "N/A")}</div>
                    <div class="photo-meta-row"><strong>Location:</strong> ${escapeHtml(entry.gps_location || "N/A")}</div>
                    ${isValidLatLon_(entry.gps_latitude, entry.gps_longitude) ? `<div style="margin-top:8px;"><a href="https://www.google.com/maps/dir/?api=1&destination=${trustedHtml_(entry.gps_latitude)},${trustedHtml_(entry.gps_longitude)}" target="_blank" rel="noopener" style="display:inline-flex; align-items:center; gap:6px; background:linear-gradient(135deg,#16a34a,#15803d); color:#fff; font-size:11px; font-weight:900; text-transform:uppercase; padding:8px 14px; border-radius:10px; text-decoration:none;">Get Directions</a></div>` : ""}
                `;
            }

            const card = document.createElement("div");
            card.style.cssText = "background:#ffffff; border-radius:18px; padding:16px; width:100%; max-width:360px; max-height:85vh; overflow-y:auto; box-shadow:0 12px 30px rgba(0,0,0,0.25);";
            card.innerHTML = `
                <div style="font-size:14px; font-weight:900; color:#1e293b; text-transform:uppercase; text-align:center; margin-bottom:12px;">${escapeHtml(ENTRY_STORE_CONFIG[storeName].label)} — Entry Detail</div>
                ${trustedHtml_(bodyHtml)}
                <button onclick="document.getElementById('entry-detail-overlay').remove()" style="width:100%; height:44px; border:none; border-radius:12px; background:#e2e8f0; color:#1e293b; font-size:13px; font-weight:900; text-transform:uppercase; margin-top:12px;">Band Karein</button>
            `;
            overlay.appendChild(card);
        }

        function deleteEntryConfirm_(storeName, uid) {
            const uidJs = mcJsEscape_(uid);
            const overlay = document.createElement("div");
            overlay.id = "entry-delete-overlay";
            overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;";
            const card = document.createElement("div");
            card.style.cssText = "background:#ffffff; border-radius:18px; padding:18px; width:100%; max-width:300px; box-shadow:0 12px 30px rgba(0,0,0,0.25); text-align:center;";
            card.innerHTML = `
                <div style="font-size:14px; font-weight:900; color:#b91c1c; text-transform:uppercase; margin-bottom:10px;">Entry Delete Karein?</div>
                <div style="font-size:12px; font-weight:700; color:#475569; margin-bottom:16px;">Yeh entry permanently delete ho jayegi (sabhi users ke liye). Pehle MIS report download kar lein agar zaroorat ho.</div>
                <div style="display:flex; gap:10px;">
                    <button onclick="document.getElementById('entry-delete-overlay').remove()" style="flex:1; height:44px; border:none; border-radius:12px; background:#e2e8f0; color:#1e293b; font-size:12px; font-weight:900; text-transform:uppercase;">Cancel</button>
                    <button onclick="confirmDeleteEntry_('${trustedHtml_(storeName)}', '${uidJs}')" style="flex:1; height:44px; border:none; border-radius:12px; background:#ef4444; color:#fff; font-size:12px; font-weight:900; text-transform:uppercase;">Delete</button>
                </div>
            `;
            overlay.appendChild(card);
            overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
            document.body.appendChild(overlay);
        }

        async function confirmDeleteEntry_(storeName, uid) {
            const overlay = document.getElementById("entry-delete-overlay");
            if (overlay) overlay.remove();

            const config = ENTRY_STORE_CONFIG[storeName];
            let entries = await config.getEntries("cache");
            let entry = entries.find((e) => getEntryUid_(e) === uid);
            if (!entry) {
                entries = await config.getEntries("force");
                entry = entries.find((e) => getEntryUid_(e) === uid);
            }
            if (!entry) return showToast("Entry nahi mili, list dobara kholein", false);

            // Optimistic: turant local IndexedDB + in-memory cloud-cache dono se
            // hata dete hain aur list turant refresh dikha dete hain. Asli cloud
            // delete background me hoti hai — Apps Script slow hone par bhi delete
            // turant hota mehsoos hota hai.
            if (entry.entry_id) {
                sharedModuleEntriesCache[storeName] = (sharedModuleEntriesCache[storeName] || []).filter((e) => e.entry_id !== entry.entry_id);
            }
            if (entry.id) {
                await idbDelete_(storeName, entry.id);
            }

            showToast("Entry delete ho gayi", true);
            await renderEntriesList_(storeName, "cache");
            await refreshStorageCounter_(storeName);
            if (config?.refreshFn) config.refreshFn();

            if (entry.entry_id) {
                deleteSharedEntry_(storeName, entry.entry_id).then((ok) => {
                    if (!ok) showToast("Cloud se delete nahi ho paya (internet check karein) — dobara dikh sakti hai", false);
                }).catch(() => {});
            }
        }


