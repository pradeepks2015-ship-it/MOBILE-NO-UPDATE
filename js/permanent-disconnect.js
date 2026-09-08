        // ===== स्थाई विच्छेदन योग्य उपभोक्ता (Permanent Disconnection Eligible Consumer) =====
        // बिजली चोरी module jaisa hi multi-document slot pattern — sirf pehla slot
        // (परिसर की फोटो) GPS capture karta hai (yahi disconnect-worthy premises ki
        // location prove karta hai); baaki slots (ग्राम पंचायत प्रमाण पत्र + सहायक
        // दस्तावेज़) sirf file upload hain, GPS ki zaroorat nahi.
        const PD_SLOT_LABELS = [
            "परिसर की फोटो (GPS सहित) *",
            "ग्राम पंचायत प्रमाण पत्र *",
            "सहायक दस्तावेज़ 1",
            "सहायक दस्तावेज़ 2",
            "सहायक दस्तावेज़ 3"
        ];
        let pdDocSlots = [null, null, null, null, null]; // each: { name, docData, geo } or null

        function renderPdDocSlots() {
            const container = document.getElementById("pd-doc-slots");
            if (!container) return;
            container.innerHTML = trustedHtml_(pdDocSlots.map((slot, idx) => `
                <div style="border:1.6px solid #ddd6fe; border-radius:14px; padding:10px 12px; margin-bottom:10px; background:#f5f3ff;">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                        <label for="pd-doc-${idx}" style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.78rem; font-weight:900; color:#5b21b6; text-transform:uppercase;">
                            <div style="width:32px; height:32px; border-radius:50%; background:linear-gradient(135deg,#7c3aed,#4c1d95); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                                <svg width="16" height="16" fill="none" stroke="white" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.5A2.5 2.5 0 0 1 5.5 6H8l1.3-1.6A2 2 0 0 1 10.86 4h2.28a2 2 0 0 1 1.56.74L16 6h2.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"></path><circle cx="12" cy="12.5" r="3.5"></circle></svg>
                            </div>
                            ${slot ? "बदलने के लिए दबाएं" : escapeHtml(PD_SLOT_LABELS[idx])}
                        </label>
                        ${slot ? `<button type="button" onclick="removePdDoc(${idx})" style="border:none; background:#ede9fe; color:#5b21b6; border-radius:999px; padding:6px 10px; font-size:0.66rem; font-weight:900; text-transform:uppercase;">हटाएं</button>` : ""}
                    </div>
                    <input type="file" id="pd-doc-${idx}" accept="image/*,application/pdf" ${idx === 0 ? 'capture="environment"' : ""} style="display:none;" onchange="handlePdDocChange(${idx})">
                    ${slot ? `
                        <div style="margin-top:8px;">
                            ${slot.docData && slot.docData.startsWith("data:image") ? `<img src="${escapeHtml(slot.docData)}" alt="चुना गया दस्तावेज़" style="width:100%; max-height:140px; object-fit:cover; border-radius:10px; border:1px solid #ddd6fe;">` : `<div style="font-size:11px; font-weight:800; color:#5b21b6; padding:10px; background:#ede9fe; border-radius:10px;">📄 फ़ाइल चुनी गई (PDF/अन्य)</div>`}
                            <input type="text" value="${escapeHtml(slot.name || "")}" placeholder="दस्तावेज़ का नाम" oninput="updatePdDocName(${idx}, this.value)" style="width:100%; margin-top:8px; height:40px; border-radius:10px; border:1.5px solid #ddd6fe; padding:0 10px; font-size:0.8rem; font-weight:700; color:#4c1d95; background:#ffffff; outline:none;">
                            ${idx === 0 ? `
                                <div class="photo-meta-box" style="display:block; margin-top:8px;">
                                    <div class="photo-meta-row"><strong>Lat-Long:</strong> ${slot.geo ? `${trustedHtml_(slot.geo.latitude)}, ${trustedHtml_(slot.geo.longitude)}` : "Not captured"}</div>
                                    <div class="photo-meta-row"><strong>Location:</strong> ${slot.geo ? escapeHtml(slot.geo.locationText || "GPS location captured") : "Not captured"}</div>
                                </div>
                            ` : ""}
                        </div>
                    ` : ""}
                </div>
            `).join(""));
        }

        async function handlePdDocChange(idx) {
            const input = document.getElementById(`pd-doc-${idx}`);
            if (!input.files || !input.files[0]) return;
            try {
                const docData = await resizeImageForUpload(input.files[0]);
                pdDocSlots[idx] = {
                    name: pdDocSlots[idx]?.name || PD_SLOT_LABELS[idx].replace(" *", ""),
                    docData,
                    geo: idx === 0 ? { latitude: "Fetching...", longitude: "Fetching...", locationText: "GPS location detect ki ja rahi hai" } : null
                };
                renderPdDocSlots();

                if (idx === 0) {
                    try {
                        const position = await getCurrentPositionAsync();
                        const latitude = position.coords.latitude.toFixed(6);
                        const longitude = position.coords.longitude.toFixed(6);
                        const locationText = await reverseGeocodeLocation(latitude, longitude);
                        if (pdDocSlots[0]) {
                            pdDocSlots[0].geo = { latitude, longitude, locationText };
                            renderPdDocSlots();
                        }
                    } catch (_) {
                        if (pdDocSlots[0]) {
                            pdDocSlots[0].geo = {
                                latitude: "Available nahi",
                                longitude: "Available nahi",
                                locationText: "GPS permission allow nahi hui ya signal weak tha"
                            };
                            renderPdDocSlots();
                        }
                    }
                }
            } catch (_) {
                showToast("दस्तावेज़ load karne mein error aaya", false);
            }
        }

        function updatePdDocName(idx, value) {
            if (pdDocSlots[idx]) pdDocSlots[idx].name = value;
        }

        function removePdDoc(idx) {
            pdDocSlots[idx] = null;
            renderPdDocSlots();
        }

        function pdToggleOtherReason_() {
            const sel = document.getElementById("pd-reason");
            const box = document.getElementById("pd-other-reason-box");
            if (!sel || !box) return;
            box.style.display = sel.value === "अन्य" ? "block" : "none";
            if (sel.value !== "अन्य") {
                const inp = document.getElementById("pd-other-reason");
                if (inp) inp.value = "";
            }
        }

        async function getPermanentDisconnectEntries_(mode = "force") {
            return getModuleEntries_("permanent_disconnect", mode);
        }

        async function savePermanentDisconnectEntry_(entry) {
            try {
                await idbAdd_("permanent_disconnect", entry);
                const MAX_PD_ENTRIES = IDB_STORE_LIMITS.permanent_disconnect;
                const count = await idbCount_("permanent_disconnect");
                if (count > MAX_PD_ENTRIES) {
                    await idbDeleteOldest_("permanent_disconnect", count - MAX_PD_ENTRIES);
                    showToast(`Limit ${MAX_PD_ENTRIES} entries hai — sabse purani local entry auto-delete hui (cloud mein safe hai)`, true);
                }
                await checkStoreCapacityWarning_("permanent_disconnect", "स्थाई विच्छेदन योग्य उपभोक्ता");
                return true;
            } catch (_) {
                return false;
            }
        }

        async function submitPermanentDisconnectEntry() {
            const consumerName = document.getElementById("pd-consumer-name").value.trim();
            const reason = document.getElementById("pd-reason").value;
            const otherReason = document.getElementById("pd-other-reason").value.trim();
            const remark = document.getElementById("pd-remark").value.trim();

            if (!consumerName) return showToast("उपभोक्ता का नाम / IVRS No दर्ज करें", false);
            if (!reason) return showToast("कारण चुनें", false);
            if (reason === "अन्य" && !otherReason) return showToast("अन्य कारण विस्तार से लिखें", false);
            if (!pdDocSlots[0]) return showToast("परिसर की फोटो (GPS सहित) ज़रूरी है", false);
            if (!pdDocSlots[1]) return showToast("ग्राम पंचायत प्रमाण पत्र ज़रूरी है", false);

            const finalReason = reason === "अन्य" ? `अन्य: ${otherReason}` : reason;
            const docs = pdDocSlots.filter(Boolean);

            const submitBtn = document.getElementById("pd-submit-btn");
            submitBtn.innerText = "Saving...";
            submitBtn.disabled = true;

            try {
                const entry = {
                    date: getCurrentDateDDMMYYYY(),
                    timestamp: new Date().toISOString(),
                    dc_name: activeDC || "",
                    consumer_name: consumerName,
                    reason: finalReason,
                    remark,
                    photos: docs.map((d) => ({
                        name: d.name || "",
                        photo_data: d.docData,
                        gps_latitude: d.geo?.latitude || "",
                        gps_longitude: d.geo?.longitude || "",
                        gps_location: d.geo?.locationText || ""
                    })),
                    ...currentEmployeeTag_()
                };

                const photoCount = docs.length;
                if (photoCount > 0) {
                    submitBtn.innerText = `📤 ${photoCount} दस्तावेज़ cloud par upload ho rahe hain...`;
                }

                const entryId = await syncEntryToCloud_("permanent_disconnect", entry);
                if (entryId) {
                    entry.entry_id = entryId;
                } else {
                    showToast(window.__lastSyncQueued ? "Internet nahi hai — entry device par save ho gayi 🔄 Internet aane par apne aap cloud sync ho jayegi" : "Internet/sync error: entry sirf is device par save hui, doosre users ko nahi dikhegi", false);
                }

                submitBtn.innerText = "Device par save ho rahi hai...";

                const saved = await savePermanentDisconnectEntry_(entry);
                if (!saved) {
                    return showToast("Save karne mein error aaya, dobara try karein", false);
                }

                showToast("Entry Saved Successfully!", true);

                document.getElementById("pd-consumer-name").value = "";
                document.getElementById("pd-reason").value = "";
                document.getElementById("pd-other-reason").value = "";
                document.getElementById("pd-other-reason-box").style.display = "none";
                document.getElementById("pd-remark").value = "";
                pdDocSlots = [null, null, null, null, null];
                renderPdDocSlots();
                await refreshPermanentDisconnectMisTotal();
                await refreshStorageCounter_("permanent_disconnect");
                if (document.getElementById("entries-list-permanent_disconnect")?.style.display !== "none") {
                    await renderEntriesList_("permanent_disconnect");
                }
            } catch (err) {
                showToast("Save error: " + (err && err.message ? err.message : String(err)), false);
            } finally {
                submitBtn.innerText = "✅ Submit Entry";
                submitBtn.disabled = false;
            }
        }

        async function refreshPermanentDisconnectMisTotal(mode = "force") {
            const fromDate = document.getElementById("pd-mis-from-date")?.value;
            const toDate = document.getElementById("pd-mis-to-date")?.value;
            const totalNode = document.getElementById("pd-mis-total");
            if (!totalNode) return;
            const filtered = await filterPermanentDisconnectEntries_(fromDate, toDate, mode);
            totalNode.innerText = filtered.length;
        }

        async function filterPermanentDisconnectEntries_(fromDate, toDate, mode = "force") {
            const entries = await getPermanentDisconnectEntries_(mode);
            if (!fromDate || !toDate) return entries;
            const fromTs = new Date(fromDate);
            const toTs = new Date(toDate);
            toTs.setHours(23, 59, 59, 999);
            return entries.filter((e) => {
                const parts = String(e.date || "").split(/[-/]/);
                if (parts.length !== 3) return false;
                const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
                return d >= fromTs && d <= toTs;
            });
        }

        async function downloadPermanentDisconnectMisPdf() {
            const fromDate = document.getElementById("pd-mis-from-date").value;
            const toDate = document.getElementById("pd-mis-to-date").value;
            if (!fromDate || !toDate) return showToast("Pehle From aur To date select karein", false);
            if (fromDate > toDate) return showToast("From date, To date se pehle honi chahiye", false);

            const btn = document.getElementById("pd-mis-pdf-btn");
            btn.innerText = "Generating...";
            btn.disabled = true;

            let holder = null;
            try {
                btn.innerText = "PDF library load ho rahi hai...";
                await Promise.all([ensureJsPdf_(), ensureHtml2Canvas_()]);
                btn.innerText = "Generating...";

                const filtered = await filterPermanentDisconnectEntries_(fromDate, toDate);
                await refreshPermanentDisconnectMisTotal();
                await hydratePhotoDataForPdf_(filtered);

                const fmtDate = (iso) => {
                    if (!iso) return "";
                    const [y, m, d] = iso.split("-");
                    return `${d}/${m}/${y}`;
                };

                const { jsPDF } = window.jspdf;
                const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

                holder = document.createElement("div");
                holder.style.cssText = "position:fixed; left:-12000px; top:0; width:760px; background:#ffffff; font-family:'Noto Sans Devanagari','Mangal','Nirmala UI',Arial,sans-serif; color:#1e293b;";
                document.body.appendChild(holder);

                const renderBlock = async (innerHtml) => {
                    const el = document.createElement("div");
                    el.style.cssText = "width:760px; background:#ffffff; padding:4px 2px; box-sizing:border-box;";
                    el.innerHTML = trustedHtml_(innerHtml);
                    holder.appendChild(el);
                    const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", logging: false });
                    holder.removeChild(el);
                    return { dataUrl: canvas.toDataURL("image/jpeg", 0.92), wPx: canvas.width, hPx: canvas.height };
                };

                let y = 10;
                const addBlock = (img, gapMm = 3) => {
                    const hMm = img.hPx * (182 / img.wPx);
                    if (y + hMm > 278 && y > 10) { doc.addPage(); y = 10; }
                    doc.addImage(img.dataUrl, "JPEG", 14, y, 182, hMm);
                    y += hMm + gapMm;
                };

                const headerHtml = `
                    <div style="background:#7c3aed; color:#ffffff; border-radius:8px; padding:16px 12px; text-align:center;">
                        <div style="font-size:24px; font-weight:900; letter-spacing:0.5px;">स्थाई विच्छेदन योग्य उपभोक्ता — MIS रिपोर्ट</div>
                        <div style="font-size:14px; font-weight:700; margin-top:6px;">डीसी: ${escapeHtml(activeDC || "-")} &nbsp;|&nbsp; अवधि: ${fmtDate(fromDate)} से ${fmtDate(toDate)} तक</div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; padding:0 2px;">
                        <div style="color:#7c3aed; font-weight:900; font-size:16px;">कुल एंट्री: ${filtered.length}</div>
                        <div style="font-size:12px; font-weight:700; color:#64748b;">तैयार किया गया: ${new Date().toLocaleString("en-IN")}</div>
                    </div>`;
                addBlock(await renderBlock(headerHtml), 4);

                const cellTh = "border:1px solid #5b21b6; background:#7c3aed; color:#ffffff; padding:7px 5px; font-size:12px; font-weight:900; text-align:center;";
                const cellTd = "border:1px solid #e2e8f0; padding:7px 5px; font-size:12.5px; font-weight:600; text-align:center; vertical-align:top;";
                const theadHtml = `<tr>
                    <th style="${cellTh} width:44px;">क्र.सं.</th>
                    <th style="${cellTh} width:82px;">दिनांक</th>
                    <th style="${cellTh}">उपभोक्ता</th>
                    <th style="${cellTh}">कारण</th>
                    <th style="${cellTh}">रिमार्क</th>
                    <th style="${cellTh} width:70px;">दस्तावेज़</th>
                </tr>`;
                const rowHtml = (e, i) => `<tr style="background:${i % 2 ? "#f5f3ff" : "#ffffff"};">
                    <td style="${cellTd}">${i + 1}</td>
                    <td style="${cellTd}">${escapeHtml(e.date || "")}</td>
                    <td style="${cellTd} text-align:left;">${escapeHtml(e.consumer_name || "")}</td>
                    <td style="${cellTd} text-align:left;">${escapeHtml(e.reason || "")}</td>
                    <td style="${cellTd} text-align:left;">${escapeHtml(e.remark || "")}</td>
                    <td style="${cellTd}">${(e.photos || []).length}</td>
                </tr>`;

                if (!filtered.length) {
                    addBlock(await renderBlock(`<table style="width:100%; border-collapse:collapse;"><thead>${theadHtml}</thead><tbody><tr><td colspan="6" style="${cellTd} padding:14px;">कोई एंट्री नहीं मिली</td></tr></tbody></table>`));
                } else {
                    const CHUNK = 12;
                    for (let s = 0; s < filtered.length; s += CHUNK) {
                        const rows = filtered.slice(s, s + CHUNK).map((e, k) => rowHtml(e, s + k)).join("");
                        addBlock(await renderBlock(`<table style="width:100%; border-collapse:collapse;"><thead>${theadHtml}</thead><tbody>${rows}</tbody></table>`), 2);
                    }
                }

                // Sirf परिसर की फोटो (pehla document) hi PDF me embed karte hain —
                // pramaan-patra/sahayak dastavez बड़े/PDF ho sakte hain, unhe app ke
                // andar entry-detail view me hi dekha ja sakta hai.
                for (let i = 0; i < filtered.length; i++) {
                    const e = filtered[i];
                    const premisesPhoto = (e.photos || [])[0];
                    if (!premisesPhoto || !premisesPhoto.photo_data || !String(premisesPhoto.photo_data).startsWith("data:image")) continue;
                    const gpsLine = (premisesPhoto.gps_latitude && premisesPhoto.gps_longitude) ? `${escapeHtml(String(premisesPhoto.gps_latitude))}, ${escapeHtml(String(premisesPhoto.gps_longitude))}` : "N/A";
                    const photoHtml = `
                        <div style="border:1.5px solid #ddd6fe; border-radius:10px; padding:10px; background:#f5f3ff;">
                            <div style="font-size:14px; font-weight:900; color:#1e293b; margin-bottom:8px;">एंट्री ${i + 1} — ${escapeHtml(e.date || "")} — ${escapeHtml(e.consumer_name || "")} (${escapeHtml(e.reason || "")})</div>
                            <div style="display:flex; gap:12px; align-items:flex-start;">
                                <img src="${escapeHtml(premisesPhoto.photo_data)}" alt="परिसर की फोटो" style="width:330px; height:248px; object-fit:cover; border-radius:8px; border:1px solid #e2e8f0; flex-shrink:0;">
                                <div style="font-size:13px; font-weight:700; color:#475569; line-height:1.7;">
                                    <div><span style="color:#1e293b; font-weight:900;">GPS:</span> ${gpsLine}</div>
                                    <div style="margin-top:4px;"><span style="color:#1e293b; font-weight:900;">स्थान:</span> ${escapeHtml(premisesPhoto.gps_location || "N/A")}</div>
                                    <div style="margin-top:4px;"><span style="color:#1e293b; font-weight:900;">कुल दस्तावेज़:</span> ${(e.photos || []).length}</div>
                                </div>
                            </div>
                        </div>`;
                    addBlock(await renderBlock(photoHtml), 1);
                    if (isValidLatLon_(premisesPhoto.gps_latitude, premisesPhoto.gps_longitude)) {
                        if (y > 274) { doc.addPage(); y = 10; }
                        const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${premisesPhoto.gps_latitude},${premisesPhoto.gps_longitude}`;
                        doc.setFontSize(9);
                        doc.setTextColor(21, 128, 61);
                        doc.setFont(undefined, "bold");
                        doc.text("Open Map (Directions)", 15, y + 2);
                        doc.link(15, y - 1.5, 48, 5.5, { url: mapsUrl });
                        y += 8;
                    }
                }

                holder.remove();
                holder = null;

                const totalPages = doc.internal.getNumberOfPages();
                for (let i = 1; i <= totalPages; i++) {
                    doc.setPage(i);
                    doc.setFontSize(7);
                    doc.setTextColor(150);
                    doc.text(`Page ${i} of ${totalPages}  |  स्थाई विच्छेदन योग्य उपभोक्ता MIS Report`, 105, 290, { align: "center" });
                }

                const filename = `Sthai_Vichchhed_MIS_${fmtDate(fromDate).replace(/\//g,"-")}_to_${fmtDate(toDate).replace(/\//g,"-")}.pdf`;
                doc.save(filename);
                showToast("PDF Downloaded!", true);
            } catch (_) {
                showToast("Report generate karne mein error aaya", false);
            } finally {
                if (holder) { try { holder.remove(); } catch (_) {} }
                btn.innerHTML = '<svg width="16" height="16" fill="white" viewBox="0 0 24 24"><path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z"/></svg> Download PDF MIS Report';
                btn.disabled = false;
            }
        }
