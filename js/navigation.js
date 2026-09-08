        function resetForm(keepDc = false) {
            currentData = null;
            document.getElementById("search-ivrs").value = "";
            document.getElementById("result-box").style.display = "none";
            if (!keepDc) {
                activeDC = "";
                const label = document.getElementById("selected-dc-label");
                if (label) label.innerText = "Choose DC Name...";
            }
        }

        function switchView(id) {
            document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
            const target = document.getElementById(id + "-view");
            if (target) {
                target.classList.add("active");
                if (id === "broken-pole") {
                    const today = localTodayIso_();
                    const now = new Date();
                    const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;
                    if (document.getElementById("bp-mis-from-date")) document.getElementById("bp-mis-from-date").value = firstOfMonth;
                    if (document.getElementById("bp-mis-to-date")) document.getElementById("bp-mis-to-date").value = today;
                    refreshBrokenPoleMisTotal("soft");
                    refreshStorageCounter_("broken_pole");
                    const bpEntriesList = document.getElementById("entries-list-broken_pole");
                    if (bpEntriesList) { bpEntriesList.style.display = "none"; bpEntriesList.innerHTML = ""; }
                }
                if (id === "bijli-chori") {
                    const today = localTodayIso_();
                    const now = new Date();
                    const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;
                    if (document.getElementById("bc-mis-from-date")) document.getElementById("bc-mis-from-date").value = firstOfMonth;
                    if (document.getElementById("bc-mis-to-date")) document.getElementById("bc-mis-to-date").value = today;
                    renderBcPhotoSlots();
                    refreshBijliChoriMisTotal("soft");
                    refreshStorageCounter_("bijli_chori");
                    const bcEntriesList = document.getElementById("entries-list-bijli_chori");
                    if (bcEntriesList) { bcEntriesList.style.display = "none"; bcEntriesList.innerHTML = ""; }
                }
                if (id === "dtr-health") {
                    const today = localTodayIso_();
                    const now = new Date();
                    const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;
                    if (document.getElementById("dtr-mis-from-date")) document.getElementById("dtr-mis-from-date").value = firstOfMonth;
                    if (document.getElementById("dtr-mis-to-date")) document.getElementById("dtr-mis-to-date").value = today;
                    refreshDtrHealthMisTotal("soft");
                    refreshStorageCounter_("dtr_health");
                    const dtrEntriesList = document.getElementById("entries-list-dtr_health");
                    if (dtrEntriesList) { dtrEntriesList.style.display = "none"; dtrEntriesList.innerHTML = ""; }
                }
                if (id === "permanent-disconnect") {
                    const today = localTodayIso_();
                    const now = new Date();
                    const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;
                    if (document.getElementById("pd-mis-from-date")) document.getElementById("pd-mis-from-date").value = firstOfMonth;
                    if (document.getElementById("pd-mis-to-date")) document.getElementById("pd-mis-to-date").value = today;
                    pdDocSlots = new Array(PD_SLOT_LABELS.length).fill(null);
                    renderPdDocSlots();
                    refreshPermanentDisconnectMisTotal("soft");
                    refreshStorageCounter_("permanent_disconnect");
                    const pdEntriesList = document.getElementById("entries-list-permanent_disconnect");
                    if (pdEntriesList) { pdEntriesList.style.display = "none"; pdEntriesList.innerHTML = ""; }
                }
                if (id === "karya-charitra") {
                    kcInitView_();
                }
                if (id === "mobile-update" && activeDC) {
                    ensureDcDataLoaded(activeDC).then(() => {
                        if (typeof mcPopulateHqFilter_ === "function") mcPopulateHqFilter_();
                        if (typeof mcResyncOrphanedEntries_ === "function") mcResyncOrphanedEntries_();
                    });
                }
                if (id === "feeder-reading") {
                    initFeederReading();
                    setDefaultMisDates_("feeder-mis-from-date", "feeder-mis-to-date");
                }
                document.getElementById("back-btn").style.display = id === "home" ? "none" : "flex";
                let headerTitle = "SEONI CIRCLE";
                if (id === "dc-selection") headerTitle = activeDiv;
                if (id === "dc-dashboard") headerTitle = `DC: ${activeDC}`;
                if (id === "feeder-reading") headerTitle = "FEEDER / SS WISE INPUT";
                if (id === "mobile-update") headerTitle = "UPDATE MOBILE NO";
                if (id === "broken-pole") headerTitle = "BROKEN POLE / DAMAGE LINE";
                if (id === "bijli-chori") headerTitle = "बिजली चोरी की जानकारी";
                if (id === "karya-charitra") headerTitle = "कर्मचारी कार्य चरित्रावली";
                if (id === "dtr-health") headerTitle = "DTR (ट्रांसफार्मर) हेल्थ लॉग";
                if (id === "permanent-disconnect") headerTitle = "स्थाई विच्छेदन योग्य उपभोक्ता";
                if (id === "summary") headerTitle = "PROGRESS REPORT";
                if (id === "admin-dashboard") headerTitle = "ADMIN DASHBOARD";
                document.getElementById("main-header-title").innerText = headerTitle;
                const header = document.getElementById("app-header");
                const searchBtn = document.getElementById("search-btn");
                if (id === "home") {
                    document.documentElement.style.setProperty("--theme-color", "#6cb1e1");
                    document.documentElement.style.setProperty("--theme-grad", "linear-gradient(135deg, #6cb1e1 0%, #2f74ad 100%)");
                    header.className = "app-header bg-argentina-grad";
                    renderScnReminderBanner_();
                } else if (id === "admin-dashboard") {
                    document.documentElement.style.setProperty("--theme-color", "#6cb1e1");
                    document.documentElement.style.setProperty("--theme-grad", "linear-gradient(135deg, #6cb1e1 0%, #2f74ad 100%)");
                    header.className = "app-header bg-argentina-grad";
                } else if (id === "mobile-update") {
                    header.className = "app-header bg-red-grad";
                    if (searchBtn) searchBtn.style.background = "linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)";
                } else if (id === "feeder-reading") {
                    document.documentElement.style.setProperty("--theme-color", "#ec4899");
                    document.documentElement.style.setProperty("--theme-grad", "linear-gradient(135deg, #fbcfe8 0%, #f9a8d4 100%)");
                    header.className = "app-header btn-feeder-light-pink";
                    if (searchBtn) searchBtn.style.background = "linear-gradient(135deg, #fbcfe8 0%, #f9a8d4 100%)";
                } else {
                    header.className = "app-header " + activeGrad;
                    if (searchBtn) searchBtn.style.background = "var(--theme-grad)";
                }
                window.scrollTo(0, 0);
            }
        }

        function goBack() {
            const activeNode = document.querySelector(".view.active");
            if (!activeNode) return;
            const act = activeNode.id;
            if (act === "dc-selection-view") {
                activeDC = "";
                const label = document.getElementById("selected-dc-label");
                if (label) label.innerText = "Choose DC Name...";
                switchView("home");
            } else if (act === "feeder-reading-view") {
                resetFeederReading();
                switchView("dc-dashboard");
            } else if (act === "dc-dashboard-view") {
                activeDC = "";
                const label = document.getElementById("selected-dc-label");
                if (label) label.innerText = "Choose DC Name...";
                switchView("dc-selection");
            } else if (act === "mobile-update-view" || act === "broken-pole-view" || act === "bijli-chori-view" || act === "dtr-health-view" || act === "permanent-disconnect-view") {
                if (act === "mobile-update-view") {
                    resetForm(true);
                }
                switchView("dc-dashboard");
            } else if (act === "summary-view") {
                if (activeViewLevel === "DC") switchView("dc-dashboard");
                else if (activeViewLevel === "DIVISION") switchView("dc-selection");
                else switchView("home");
            } else {
                switchView("home");
            }
        }

        function changeTheme(c) {
            document.documentElement.style.setProperty("--theme-color", c);
            (function () {
                const homeLogo = document.querySelector(".mpez-home-logo img");
                const headerLogo = document.getElementById("header-mpez-logo");
                if (homeLogo && headerLogo) headerLogo.src = homeLogo.src;
            })();
        // Header MPEZ logo: reuse home page logo image (no animation)
        (function initHeaderMpezLogo_() {
            const setLogo = () => {
                const homeLogo = document.getElementById("home-mpez-logo");
                const headerLogo = document.getElementById("header-mpez-logo");
                if (homeLogo && headerLogo && !headerLogo.getAttribute("src")) {
                    headerLogo.src = homeLogo.src;
                }
            };
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", setLogo);
            } else {
                setLogo();
            }
        })();

            const welcomeText = document.getElementById("welcomeText");
            if (welcomeText) welcomeText.style.color = c;
        }

        function setMode(m) {
            summaryMode = m;
            const input = document.getElementById("report-date");
            document.getElementById("opt-daily").classList.toggle("active", m === "DAILY");
            document.getElementById("opt-monthly").classList.toggle("active", m === "MONTHLY");
            if (m === "MONTHLY") {
                input.type = "month";
                input.value = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
            } else {
                input.type = "date";
                input.value = localTodayIso_();
            }
            refreshSummary();
        }
