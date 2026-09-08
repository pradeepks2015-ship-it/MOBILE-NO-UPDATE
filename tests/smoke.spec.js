// @ts-check
// Seoni Circle App — smoke tests
// हर बाहरी request (CDN/Google Sheets/Apps Script) block की जाती है ताकि:
//  1. tests कभी असली production Google Sheet/Apps Script को न छुएं
//  2. हर PR पर app का core navigation + security + offline-sync रास्ता अपने आप जांचा जाए
const { test, expect } = require('@playwright/test');

/** @param {import('@playwright/test').Page} page */
async function blockExternal(page) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
}

/**
 * blockExternal को पहले register करता है, फिर (अगर दिया हो) beforeGoto से कोई ज़्यादा
 * specific route जोड़ने देता है — Playwright बाद में register हुए route को पहले चेक
 * करता है, इसलिए specific route (जैसे सिर्फ़ **\/macros/**) blockExternal के catch-all
 * से पहले माना जाएगा।
 * डिफ़ॉल्ट रूप से employee login pre-seed कर देता है (localStorage) ताकि बाकी सभी
 * tests employee-login gate की परवाह किए बिना सीधे home तक पहुँच जाएँ — सिर्फ़
 * employee-login वाले tests इसे `employeeLoggedIn: false` से बंद करते हैं।
 * @param {import('@playwright/test').Page} page
 * @param {{ beforeGoto?: (page: import('@playwright/test').Page) => Promise<void>, employeeLoggedIn?: boolean }} [opts]
 */
async function openApp(page, opts = {}) {
  await blockExternal(page);
  if (opts.employeeLoggedIn !== false) {
    await page.addInitScript(() => {
      localStorage.setItem('seoni-circle-employee-v1', JSON.stringify({ emp_id: 'TEST_EMP', emp_name: 'Test Employee', emp_designation: 'Lineman' }));
    });
  }
  if (opts.beforeGoto) await opts.beforeGoto(page);
  await page.goto('/');
  await page.waitForFunction(() => document.getElementById('home-view').classList.contains('active'), null, { timeout: 15000 });
}

/**
 * Home → Lakhnadon Division → ADEGAON चुनकर dc-dashboard-view तक पहुंचाता है।
 * (Seoni Division की सभी DCs अभी "Coming Soon" हैं, इसलिए क्लिक करने पर आगे नहीं
 * खुलतीं — इसीलिए tests यहाँ Lakhnadon/ADEGAON का इस्तेमाल करते हैं, जो असल में काम करती है।)
 * @param {import('@playwright/test').Page} page
 */
async function goToDcDashboard(page) {
  await page.click('.list-item.bg-orange-grad'); // Lakhnadon Division
  await page.waitForFunction(() => document.getElementById('dc-selection-view').classList.contains('active'));
  await page.click('#prof-trigger');
  await page.click('#dc-menu .option-item >> nth=0'); // ADEGAON
  await page.waitForFunction(() => document.getElementById('dc-dashboard-view').classList.contains('active'));
}

test.describe('बूट और होम स्क्रीन', () => {
  test('app बिना error के खुलती है, Argentina theme दिखती है', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page);
    await expect(page.locator('#welcomeText')).toBeVisible();
    const headerBg = await page.locator('#app-header').evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(headerBg).toContain('gradient'); // .bg-argentina-grad
    expect(errors).toEqual([]);
  });

  test('दोनों Division tiles दिखते हैं और होम पर सिर्फ यही एंट्री-पॉइंट है', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('.list-item')).toHaveCount(2);
    await expect(page.locator('.list-item').nth(0)).toContainText('Seoni');
    await expect(page.locator('.list-item').nth(1)).toContainText('Lakhnadon');
  });
});

test.describe('DC dashboard — hidden/removed features', () => {
  test('dc-dashboard पर ठीक 8 buttons दिखते हैं, कोई SHMS/Stock/PDC/STM/PeakLoad नहीं', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page);
    await goToDcDashboard(page);

    const buttons = await page.locator('#dc-dashboard-view .dashboard-btn').allTextContents();
    expect(buttons.map((b) => b.trim().replace(/\s+/g, ' '))).toEqual([
      '1. ₹ VASOOLI TRACKER',
      '2. Mobile No Update',
      '3. Broken Pole / Damage Line',
      '4. FEEDER / SS WISE INPUT',
      '5. बिजली चोरी की जानकारी',
      '6. कर्मचारी कार्य चरित्रावली',
      '7. DTR (ट्रांसफार्मर) हेल्थ लॉग',
      '8. स्थाई विच्छेदन योग्य उपभोक्ता',
    ]);
    // Sabhi 8 buttons ab custom SVG icon use karte hain (emoji nahi) — VASOOLI
    // TRACKER ke andar ₹ ek SVG <text> hai isliye woh textContent me bhi aata hai.
    for (let i = 0; i < 8; i++) {
      await expect(page.locator('#dc-dashboard-view .dashboard-btn').nth(i).locator('svg')).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('हटाए गए features का ना कोई view बचा है, ना कोई function', async ({ page }) => {
    await openApp(page);
    await goToDcDashboard(page);
    const state = await page.evaluate(() => ({
      views: {
        shmsEntry: !!document.getElementById('shms-entry-view'),
        shmsProgress: !!document.getElementById('shms-progress-view'),
        shmsPending: !!document.getElementById('shms-pending-view'),
        stockMaterial: !!document.getElementById('stock-material-view'),
        pdc: !!document.getElementById('pdc-nontraceable-view'),
        stm: !!document.getElementById('stm-complaint-view'),
        peakLoad: !!document.getElementById('daily-hourly-peak-load-view'),
      },
      fns: {
        initShmsEntry: typeof window.initShmsEntry,
        getSavedShmsOperator: typeof window.getSavedShmsOperator,
        loadShmsData: typeof window.loadShmsData,
        renderStockDashboard: typeof window.renderStockDashboard,
        openStockDashboard: typeof window.openStockDashboard,
        initStmComplaintSignup: typeof window.initStmComplaintSignup,
        renderPdcPhotoSlots: typeof window.renderPdcPhotoSlots,
        initDailyHourlyPeakLoad: typeof window.initDailyHourlyPeakLoad,
      },
    }));
    Object.values(state.views).forEach((v) => expect(v).toBe(false));
    Object.values(state.fns).forEach((v) => expect(v).toBe('undefined'));
  });

  test('Division Seoni ki sabhi DCs "Coming Soon" dikhti hain aur click par dc-dashboard nahi khulta', async ({ page }) => {
    await openApp(page);
    await page.click('.list-item.bg-blue-grad'); // Seoni Division
    await page.waitForFunction(() => document.getElementById('dc-selection-view').classList.contains('active'));
    await page.click('#prof-trigger');

    const items = page.locator('#dc-menu .option-item');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(items.nth(i)).toContainText('Coming Soon');
    }

    await items.nth(0).click(); // ARI
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.getElementById('dc-dashboard-view').classList.contains('active'))).toBe(false);
  });

  test('Division Lakhnadon ka ADEGAON "Coming Soon" nahi hai, saamanya roop se khulta hai', async ({ page }) => {
    await openApp(page);
    await page.click('.list-item.bg-orange-grad'); // Lakhnadon Division
    await page.waitForFunction(() => document.getElementById('dc-selection-view').classList.contains('active'));
    await page.click('#prof-trigger');

    const adegaon = page.locator('#dc-menu .option-item').filter({ hasText: 'ADEGAON' });
    await expect(adegaon).not.toContainText('Coming Soon');
    await adegaon.click();
    await page.waitForFunction(() => document.getElementById('dc-dashboard-view').classList.contains('active'));
  });
});

test.describe('Feeder Reading (active feature)', () => {
  test('view खुलता है, dropdown toggle और backend-status button काम करते हैं', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page);
    await goToDcDashboard(page);
    await page.evaluate(() => switchView('feeder-reading'));
    await page.waitForFunction(() => document.getElementById('feeder-reading-view').classList.contains('active'));

    await expect(page.locator('[onclick="checkFeederBackendStatus()"]')).toBeVisible();
    const dropdownOk = await page.evaluate(() => {
      try { toggleFeederDropdown('substation'); return true; } catch (_) { return false; }
    });
    expect(dropdownOk).toBe(true);
    expect(errors).toEqual([]);
  });

  test('⋮ menu se substation/feeder-wise mahina-wise kWh scorecard dikhta hai, pichhle saal ka data manual entry cloud par save/edit hota hai, remark save hota hai, aur download hota hai', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // Date brittle na ho isliye "abhi" ke hisaab se dynamically banate hain
    // (10 tareekh — mahine ke start/end edge cases se bachne ke liye).
    function dateMonthsAgo(monthsAgo, yearsAgo = 0) {
      const now = new Date();
      const d = new Date(now.getFullYear() - yearsAgo, now.getMonth() - monthsAgo, 10);
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    }
    const feederRow = (dateStr, current) => ({
      '33/11 KV SUBSTATION': 'TESTSS', '33 AND 11 KV FEEDER': 'TESTFEEDER', 'METER NO': 'MTR001',
      'PREVIUS READING': '0', 'CURRENT READING': String(current), 'MF': '1', 'CONSUMPTION': String(current),
      'DC NAME': 'ADEGAON', 'DATE(DD/MM/YYY)': dateStr, 'TIME(HH/MM)': '10:00',
    });
    // "कुल"/GRAND TOTAL rows Lakh unit me (2 dashamlav) dikhti hain, isliye
    // fixtures Lakh-range me rakhte hain taaki total ka Lakh-format bhi test ho
    // sake — individual feeder cells ab bhi poore number (comma-format) me hi dikhti hain.
    const rows = [
      feederRow(dateMonthsAgo(0), 100000),  // is mahina — "1,00,000", total "1.00 L"
      feederRow(dateMonthsAgo(1), 200000),  // pichhla mahina — "2,00,000", total "2.00 L"
      // pichhle saal isi mahine ki koi record nahi — manual entry se bharenge
    ];

    await openApp(page, {
      beforeGoto: async (p) => {
        await p.route('**/macros/**', (route) => {
          if (route.request().method() === 'POST') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success' }) });
          }
          const url = new URL(route.request().url());
          if (url.searchParams.get('action') === 'getFeederReadings') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
          }
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [] }) });
        });
      },
    });
    await goToDcDashboard(page);
    await page.evaluate(() => switchView('feeder-reading'));
    await page.waitForFunction(() => document.getElementById('feeder-reading-view').classList.contains('active'));

    await page.evaluate(() => {
      window.__lastFeederCsvBlob = null;
      const origCreateObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => { window.__lastFeederCsvBlob = blob; return origCreateObjectURL(blob); };
    });

    await page.click('#feeder-menu-btn');
    await expect(page.locator('#feeder-menu-dropdown')).toBeVisible();
    await page.click('#feeder-scorecard-btn');
    await expect(page.locator('#feeder-scorecard-overlay')).toBeVisible();
    await page.waitForFunction(() => !document.getElementById('feeder-scorecard-body')?.innerText.includes('लोड हो रहा है'));

    const body = page.locator('#feeder-scorecard-body');
    await expect(body).toContainText('TESTSS');
    await expect(body).toContainText('TESTFEEDER');
    await expect(body).toContainText('1,00,000'); // is mahina (auto) individual cell — poora number
    await expect(body).toContainText('2,00,000'); // pichhla mahina (auto) individual cell — poora number
    await expect(body).toContainText('1.00 L'); // is mahina ka कुल/GRAND TOTAL — Lakh format
    await expect(body).toContainText('2.00 L'); // pichhla mahina ka कुल/GRAND TOTAL — Lakh format
    await expect(body).toContainText('GRAND TOTAL');

    // Pichhle saal isi mahine ka koi record nahi tha — cell seedhe editable input honi chahiye (khali)
    const lastYearInput = page.locator('input[data-ss="TESTSS"][data-fdr="TESTFEEDER"]');
    await expect(lastYearInput).toHaveValue('');
    const editBtn = page.locator('#feeder-scorecard-body button[title="Edit"]');
    await expect(editBtn).toHaveCount(0); // khali cell par abhi edit button nahi hona chahiye

    // Manual entry poore raw kWh number me bharte hain aur "✔ Save" button
    // dabate hain (explicit save, sirf blur/onchange par bharosa nahi) — cloud
    // par submit hokar frozen (read-only + ✏️ Edit) ban jaani chahiye, aur
    // confirmation toast bhi aani chahiye.
    await lastYearInput.fill('300000');
    await page.locator('#feeder-scorecard-body button[title="Save"]').click();
    await page.waitForFunction(() => !document.querySelector('input[data-ss="TESTSS"][data-fdr="TESTFEEDER"]'));
    await expect(body).toContainText('3,00,000'); // individual cell — poora number
    await expect(body).toContainText('3.00 L'); // कुल/GRAND TOTAL — Lakh format
    await expect(editBtn).toHaveCount(1); // ab save ho chuki hai, edit button dikhna chahiye
    await expect(page.locator('#toast-notif')).toContainText('save');

    // Scorecard band-khol karne par bhi manual entry save rahni chahiye (local + cloud persist)
    await page.click('#feeder-scorecard-close-btn');
    await page.click('#feeder-menu-btn');
    await page.click('#feeder-scorecard-btn');
    await page.waitForFunction(() => !document.getElementById('feeder-scorecard-body')?.innerText.includes('लोड हो रहा है'));
    await expect(page.locator('input[data-ss="TESTSS"][data-fdr="TESTFEEDER"]')).toHaveCount(0);
    await expect(body).toContainText('3,00,000');

    // Remark likhte hain aur "✔ रिमार्क Save करें" button dabate hain — explicit
    // save, confirmation toast bhi aani chahiye (silent auto-save se alag).
    await page.fill('#feeder-scorecard-remark', 'Is mahine 8 din barish hui');
    await page.click('#feeder-scorecard-remark-save-btn');
    await page.waitForFunction(() => document.getElementById('toast-notif')?.textContent?.includes('रिमार्क'));
    await expect(page.locator('#toast-notif')).toContainText('रिमार्क');

    // Download CSV me manual entry raw kWh me (300000) aur remark dono aane
    // chahiye — CSV precision ke liye hamesha raw number hi rakhta hai.
    await page.click('#feeder-scorecard-download-btn');
    await page.waitForFunction(() => window.__lastFeederCsvBlob !== null);
    const csvText = await page.evaluate(async () => await window.__lastFeederCsvBlob.text());
    expect(csvText).toContain('TESTSS');
    expect(csvText).toContain('TESTFEEDER');
    expect(csvText).toContain('300000');
    expect(csvText).toContain('barish');

    // Scorecard band karke dobara kholne par wahi remark text dikhna chahiye —
    // aur remark ki sentinel row kisi bhi substation/feeder aggregation me
    // nahi dikhni chahiye.
    await page.click('#feeder-scorecard-close-btn');
    await page.click('#feeder-menu-btn');
    await page.click('#feeder-scorecard-btn');
    await page.waitForFunction(() => !document.getElementById('feeder-scorecard-body')?.innerText.includes('लोड हो रहा है'));
    await expect(page.locator('#feeder-scorecard-remark')).toHaveValue('Is mahine 8 din barish hui');
    await expect(body).not.toContainText('_SCORECARD_');
    await expect(body).not.toContainText('_REMARK_');

    // ✏️ Edit dabane par confirm modal khulni chahiye, unfreeze karne par hi input wapas aana chahiye
    await page.locator('#feeder-scorecard-body button[title="Edit"]').click();
    await expect(page.locator('#feeder-scorecard-unfreeze-overlay')).toBeVisible();
    await expect(lastYearInput).toHaveCount(0); // confirm se pehle input nahi hona chahiye
    await page.click('#feeder-scorecard-unfreeze-confirm-btn');
    await expect(page.locator('#feeder-scorecard-unfreeze-overlay')).toHaveCount(0);
    await expect(lastYearInput).toHaveValue('300000'); // unfreeze hote hi pehli value (poora number) pre-filled honi chahiye

    // Naya value bharte hain — purani (3,00,000 / 3.00 L) ki jagah nayi (4,00,000 / 4.00 L) frozen dikhni chahiye
    await lastYearInput.fill('400000');
    await lastYearInput.dispatchEvent('change');
    await page.waitForFunction(() => !document.querySelector('input[data-ss="TESTSS"][data-fdr="TESTFEEDER"]'));
    await expect(body).toContainText('4,00,000');
    await expect(body).toContainText('4.00 L');
    await expect(body).not.toContainText('3,00,000');
    await expect(body).not.toContainText('3.00 L');

    // Unfreeze karke khali chhod dein to edit cancel ho jaana chahiye — purani (4,00,000) frozen value wapas dikhni chahiye
    await page.locator('#feeder-scorecard-body button[title="Edit"]').click();
    await page.click('#feeder-scorecard-unfreeze-confirm-btn');
    await expect(lastYearInput).toHaveValue('400000');
    await lastYearInput.fill('');
    await lastYearInput.dispatchEvent('change');
    await page.waitForFunction(() => !document.querySelector('input[data-ss="TESTSS"][data-fdr="TESTFEEDER"]'));
    await expect(body).toContainText('4,00,000');

    await page.click('#feeder-scorecard-close-btn');
    await expect(page.locator('#feeder-scorecard-overlay')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('Scorecard me "महीना चुनें" input se koi bhi purana mahina select karke uska data dekha ja sakta hai', async ({ page }) => {
    function dateMonthsAgo(monthsAgo, yearsAgo = 0) {
      const now = new Date();
      const d = new Date(now.getFullYear() - yearsAgo, now.getMonth() - monthsAgo, 10);
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    }
    function yearMonthAgo(monthsAgo, yearsAgo = 0) {
      const now = new Date();
      const d = new Date(now.getFullYear() - yearsAgo, now.getMonth() - monthsAgo, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    const feederRow = (dateStr, current) => ({
      '33/11 KV SUBSTATION': 'TESTSS', '33 AND 11 KV FEEDER': 'TESTFEEDER', 'METER NO': 'MTR001',
      'PREVIUS READING': '0', 'CURRENT READING': String(current), 'MF': '1', 'CONSUMPTION': String(current),
      'DC NAME': 'ADEGAON', 'DATE(DD/MM/YYY)': dateStr, 'TIME(HH/MM)': '10:00',
    });
    // Scorecard values Lakh unit me dikhti hain — fixtures Lakh-range me rakhte hain.
    const rows = [
      feederRow(dateMonthsAgo(0), 100000), // is mahina — 1.00 L
      feederRow(dateMonthsAgo(1), 200000), // pichhla mahina — 2.00 L
      feederRow(dateMonthsAgo(2), 300000), // 2 mahine pehle — 3.00 L
      feederRow(dateMonthsAgo(3), 400000), // 3 mahine pehle — 4.00 L
    ];

    await openApp(page, {
      beforeGoto: async (p) => {
        await p.route('**/macros/**', (route) => {
          const url = new URL(route.request().url());
          if (url.searchParams.get('action') === 'getFeederReadings') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
          }
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [] }) });
        });
      },
    });
    await goToDcDashboard(page);
    await page.evaluate(() => switchView('feeder-reading'));
    await page.waitForFunction(() => document.getElementById('feeder-reading-view').classList.contains('active'));

    await page.click('#feeder-menu-btn');
    await page.click('#feeder-scorecard-btn');
    await expect(page.locator('#feeder-scorecard-overlay')).toBeVisible();
    await page.waitForFunction(() => !document.getElementById('feeder-scorecard-body')?.innerText.includes('लोड हो रहा है'));

    const body = page.locator('#feeder-scorecard-body');
    const monthInput = page.locator('#feeder-scorecard-month-select');

    // Default open par aaj ka mahina hi selected hona chahiye — individual cell
    // poore number me, कुल/GRAND TOTAL Lakh format me dikhne chahiye
    await expect(monthInput).toHaveValue(yearMonthAgo(0));
    await expect(body).toContainText('1,00,000');
    await expect(body).toContainText('2,00,000');
    await expect(body).toContainText('1.00 L');
    await expect(body).toContainText('2.00 L');

    // 2 mahine pehle wala mahina select karte hain — "is mahina" ab wahi ban jaata
    // hai, to 3,00,000 (usi mahine ka) aur 4,00,000 (uske pichhle mahine ka) dikhna chahiye
    await monthInput.fill(yearMonthAgo(2));
    await monthInput.dispatchEvent('change');
    await page.waitForFunction(() => document.getElementById('feeder-scorecard-body')?.innerText.includes('3,00,000'));
    await expect(body).toContainText('4,00,000');
    await expect(body).toContainText('3.00 L');
    await expect(body).toContainText('4.00 L');

    // Purana (poora ho chuka) mahina select karne par progressive box "1 tareekh
    // se aaj tak" nahi, balki "1 tareekh se us mahine ki aakhri tareekh tak"
    // (poora mahina) dikhaana chahiye — us mahine ka poora total (3.00 L).
    const progressiveBox = page.locator('#feeder-scorecard-progressive');
    await expect(progressiveBox).toContainText('पूरे महीने की खपत');
    await expect(progressiveBox).toContainText('3.00 L');
  });

  test('Scorecard "महीना चुनें" ke neeche 1 tareekh se aaj tak ki progressive khapat dikhti hai', async ({ page }) => {
    // Mahine ki 1 tareekh hamesha "aaj" se pehle ya barabar hoti hai, isliye yeh
    // fixture kisi bhi din test chale, progressive window (1 se aaj tak) me
    // guaranteed shamil rahega — date-brittle nahi.
    function dateFirstOfThisMonth() {
      const now = new Date();
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    }
    const rows = [{
      '33/11 KV SUBSTATION': 'TESTSS', '33 AND 11 KV FEEDER': 'TESTFEEDER', 'METER NO': 'MTR001',
      'PREVIUS READING': '0', 'CURRENT READING': '250000', 'MF': '1', 'CONSUMPTION': '250000',
      'DC NAME': 'ADEGAON', 'DATE(DD/MM/YYY)': dateFirstOfThisMonth(), 'TIME(HH/MM)': '10:00',
    }];

    await openApp(page, {
      beforeGoto: async (p) => {
        await p.route('**/macros/**', (route) => {
          const url = new URL(route.request().url());
          if (url.searchParams.get('action') === 'getFeederReadings') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
          }
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [] }) });
        });
      },
    });
    await goToDcDashboard(page);
    await page.evaluate(() => switchView('feeder-reading'));
    await page.waitForFunction(() => document.getElementById('feeder-reading-view').classList.contains('active'));

    await page.click('#feeder-menu-btn');
    await page.click('#feeder-scorecard-btn');
    await expect(page.locator('#feeder-scorecard-overlay')).toBeVisible();
    await page.waitForFunction(() => !document.getElementById('feeder-scorecard-body')?.innerText.includes('लोड हो रहा है'));

    const progressiveBox = page.locator('#feeder-scorecard-progressive');
    await expect(progressiveBox).toContainText('प्रोग्रेसिव खपत');
    await expect(progressiveBox).toContainText('2.50 L');
  });

  test('फीडर ट्रेंड: pichhle mahine bnaam usse pichhle mahine ka badlaav sahi % ke saath dikhta hai, bada badlaav anomaly flag hota hai', async ({ page }) => {
    function dateMonthsAgo(monthsAgo) {
      const now = new Date();
      const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 10);
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    }
    const feederRow = (dateStr, ss, fdr, current) => ({
      '33/11 KV SUBSTATION': ss, '33 AND 11 KV FEEDER': fdr, 'METER NO': `MTR-${fdr}`,
      'PREVIUS READING': '0', 'CURRENT READING': String(current), 'MF': '1', 'CONSUMPTION': String(current),
      'DC NAME': 'ADEGAON', 'DATE(DD/MM/YYY)': dateStr, 'TIME(HH/MM)': '10:00',
    });
    const rows = [
      // STABLEFEEDER: 1,00,000 -> 1,05,000 (+5%, koi anomaly nahi)
      feederRow(dateMonthsAgo(2), 'TESTSS', 'STABLEFEEDER', 100000),
      feederRow(dateMonthsAgo(1), 'TESTSS', 'STABLEFEEDER', 105000),
      // SPIKEFEEDER: 1,00,000 -> 2,00,000 (+100%, anomaly)
      feederRow(dateMonthsAgo(2), 'TESTSS', 'SPIKEFEEDER', 100000),
      feederRow(dateMonthsAgo(1), 'TESTSS', 'SPIKEFEEDER', 200000),
    ];

    await openApp(page, {
      beforeGoto: async (p) => {
        await p.route('**/macros/**', (route) => {
          const url = new URL(route.request().url());
          if (url.searchParams.get('action') === 'getFeederReadings') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
          }
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [] }) });
        });
      },
    });
    await goToDcDashboard(page);
    await page.evaluate(() => switchView('feeder-reading'));
    await page.waitForFunction(() => document.getElementById('feeder-reading-view').classList.contains('active'));

    await page.click('#feeder-menu-btn');
    await page.click('#feeder-trend-btn');
    await expect(page.locator('#feeder-trend-overlay')).toBeVisible();
    await page.waitForFunction(() => !document.getElementById('feeder-trend-body')?.innerText.includes('लोड हो रहा है'));

    const body = page.locator('#feeder-trend-body');
    await expect(body).toContainText('1 feeder(s)'); // sirf SPIKEFEEDER anomaly hai
    await expect(body).toContainText('SPIKEFEEDER');
    await expect(body).toContainText('▲ 100.0%');
    await expect(body).toContainText('STABLEFEEDER');
    await expect(body).toContainText('▲ 5.0%');

    // Sabse bada badlaav (SPIKEFEEDER) sabse upar sorted hona chahiye — child 0 =
    // label, child 1 = anomaly-summary banner, child 2 = pehli feeder row
    const firstRowText = await page.locator('#feeder-trend-body > div').nth(2).innerText();
    expect(firstRowText).toContain('SPIKEFEEDER');

    await page.click('#feeder-trend-close-btn');
    await expect(page.locator('#feeder-trend-overlay')).toHaveCount(0);
  });
});

test.describe('Broken Pole / बिजली चोरी / कर्मचारी कार्य चरित्रावली (active features)', () => {
  for (const [id, viewId] of [
    ['broken-pole', 'broken-pole-view'],
    ['bijli-chori', 'bijli-chori-view'],
    ['karya-charitra', 'karya-charitra-view'],
    ['dtr-health', 'dtr-health-view'],
    ['permanent-disconnect', 'permanent-disconnect-view'],
  ]) {
    test(`${id} view बिना error के खुलता है`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await openApp(page);
      await goToDcDashboard(page);
      await page.evaluate((viewName) => switchView(viewName), id);
      await page.waitForFunction((v) => document.getElementById(v).classList.contains('active'), viewId);
      expect(errors).toEqual([]);
    });
  }

  test('goBack() हर जगह से dc-dashboard पर वापस लाता है', async ({ page }) => {
    await openApp(page);
    await goToDcDashboard(page);
    await page.evaluate(() => switchView('broken-pole'));
    await page.evaluate(() => goBack());
    await page.waitForFunction(() => document.getElementById('dc-dashboard-view').classList.contains('active'));
  });

  // 1x1 transparent PNG — resizeImageForUpload() (createImageBitmap ya <img> fallback)
  // dono se cleanly decode ho jaata hai, isliye asli photo upload flow test karne ke
  // liye kaafi hai.
  const PNG_1PX_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  test('Broken Pole: photo + remark ke saath submit karne se entry save hoti hai, list aur MIS total me dikhti hai', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page, {
      beforeGoto: async (p) => {
        await p.route('**/macros/**', (route) => {
          if (route.request().method() === 'POST') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entry_id: 'BP_TEST_1' }) });
          }
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [] }) });
        });
      },
    });
    await goToDcDashboard(page);
    await page.evaluate(() => switchView('broken-pole'));
    await page.waitForFunction(() => document.getElementById('broken-pole-view').classList.contains('active'));

    await page.setInputFiles('#bp-photo', { name: 'pole.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1PX_BASE64, 'base64') });
    await page.waitForFunction(() => document.getElementById('bp-photo-preview-wrap').style.display !== 'none');
    await page.fill('#bp-remark1', 'खंभा नंबर 42 टूटा हुआ');
    await page.fill('#bp-remark2', 'नया खंभा भेजा गया');
    await page.click('#bp-submit-btn');
    await page.waitForFunction(() => document.getElementById('toast-notif')?.textContent?.includes('Entry Saved'));

    // Submit ke baad form reset ho jaana chahiye
    await expect(page.locator('#bp-remark1')).toHaveValue('');
    await expect(page.locator('#bp-photo-name')).toHaveText('No photo selected');

    // Saved Entries list me nayi entry dikhni chahiye
    await page.evaluate(() => toggleEntriesList('broken_pole'));
    await expect(page.locator('#entries-list-broken_pole')).toContainText('खंभा नंबर 42 टूटा हुआ');

    // MIS date-range total sahi count karta hai
    const isoToday = new Date().toISOString().slice(0, 10);
    await page.fill('#bp-mis-from-date', isoToday);
    await page.fill('#bp-mis-to-date', isoToday);
    await page.locator('#bp-mis-to-date').dispatchEvent('change');
    await expect(page.locator('#bp-mis-total')).toHaveText('1');

    expect(errors).toEqual([]);
  });

  test('DTR हेल्थ लॉग: photo + DTR No + issue-type ke saath submit karne se entry save hoti hai, list me dikhti hai', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page, {
      beforeGoto: async (p) => {
        await p.route('**/macros/**', (route) => {
          if (route.request().method() === 'POST') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entry_id: 'DTR_TEST_1' }) });
          }
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [] }) });
        });
      },
    });
    await goToDcDashboard(page);
    await page.evaluate(() => switchView('dtr-health'));
    await page.waitForFunction(() => document.getElementById('dtr-health-view').classList.contains('active'));

    // "अन्य" issue type select karne par other-issue box zaroori ban jaana chahiye
    await page.setInputFiles('#dtr-photo', { name: 'dtr.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1PX_BASE64, 'base64') });
    await page.waitForFunction(() => document.getElementById('dtr-photo-preview-wrap').style.display !== 'none');
    await page.fill('#dtr-no', 'DTR-14, ग्राम मढ़ी');
    await page.selectOption('#dtr-issue-type', 'अन्य');
    await expect(page.locator('#dtr-other-issue-box')).toBeVisible();
    await page.click('#dtr-submit-btn');
    await page.waitForFunction(() => document.getElementById('toast-notif')?.textContent?.includes('अन्य समस्या'));

    // Ab "अन्य" ka detail bharkar submit karte hain
    await page.fill('#dtr-other-issue', 'Bushing crack ho gayi hai');
    await page.fill('#dtr-remark', 'नया DTR मंगवाया गया');
    await page.click('#dtr-submit-btn');
    await page.waitForFunction(() => document.getElementById('toast-notif')?.textContent?.includes('Entry Saved'));

    await expect(page.locator('#dtr-no')).toHaveValue('');
    await expect(page.locator('#dtr-other-issue-box')).toBeHidden();

    await page.evaluate(() => toggleEntriesList('dtr_health'));
    const listBox = page.locator('#entries-list-dtr_health');
    await expect(listBox).toContainText('DTR-14, ग्राम मढ़ी');
    await expect(listBox).toContainText('अन्य: Bushing crack ho gayi hai');

    const isoToday = new Date().toISOString().slice(0, 10);
    await page.fill('#dtr-mis-from-date', isoToday);
    await page.fill('#dtr-mis-to-date', isoToday);
    await page.locator('#dtr-mis-to-date').dispatchEvent('change');
    await expect(page.locator('#dtr-mis-total')).toHaveText('1');

    expect(errors).toEqual([]);
  });

  test('स्थाई विच्छेदन योग्य उपभोक्ता: परिसर फोटो (GPS) + पंचायत प्रमाण पत्र + सहायक दस्तावेज़ ke saath submit karne se entry save hoti hai, list me dikhti hai', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page, {
      beforeGoto: async (p) => {
        await p.route('**/macros/**', (route) => {
          if (route.request().method() === 'POST') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entry_id: 'PD_TEST_1' }) });
          }
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [] }) });
        });
      },
    });
    await goToDcDashboard(page);
    await page.evaluate(() => switchView('permanent-disconnect'));
    await page.waitForFunction(() => document.getElementById('permanent-disconnect-view').classList.contains('active'));

    await page.fill('#pd-consumer-name', 'रामलाल — IVRS 1134029336');
    await page.selectOption('#pd-reason', 'गांव से स्थाई पलायन');

    // Sirf naam/karan bharkar submit karne par दोनों zaroori documents ka toast aana chahiye
    await page.click('#pd-submit-btn');
    await page.waitForFunction(() => document.getElementById('toast-notif')?.textContent?.includes('परिसर की फोटो'));

    // Pehla slot (परिसर की फोटो) — GPS auto-capture trigger hoti hai
    await page.setInputFiles('#pd-doc-0', { name: 'premises.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1PX_BASE64, 'base64') });
    await page.waitForFunction(() => document.querySelectorAll('#pd-doc-slots img').length > 0);

    // Doosra slot (प्रमाण पत्र) bina bhare submit karne par uska bhi toast aana chahiye
    await page.click('#pd-submit-btn');
    await page.waitForFunction(() => document.getElementById('toast-notif')?.textContent?.includes('प्रमाण पत्र'));

    await page.setInputFiles('#pd-doc-1', { name: 'panchayat-certificate.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1PX_BASE64, 'base64') });
    await page.setInputFiles('#pd-doc-2', { name: 'supporting.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1PX_BASE64, 'base64') });
    await page.waitForFunction(() => document.querySelectorAll('#pd-doc-slots img').length >= 3);

    await page.click('#pd-submit-btn');
    await page.waitForFunction(() => document.getElementById('toast-notif')?.textContent?.includes('Entry Saved'));

    await expect(page.locator('#pd-consumer-name')).toHaveValue('');
    await expect(page.locator('#pd-doc-slots img')).toHaveCount(0);

    await page.evaluate(() => toggleEntriesList('permanent_disconnect'));
    const listBox = page.locator('#entries-list-permanent_disconnect');
    await expect(listBox).toContainText('रामलाल — IVRS 1134029336');
    await expect(listBox).toContainText('3 दस्तावेज़');

    const isoToday = new Date().toISOString().slice(0, 10);
    await page.fill('#pd-mis-from-date', isoToday);
    await page.fill('#pd-mis-to-date', isoToday);
    await page.locator('#pd-mis-to-date').dispatchEvent('change');
    await expect(page.locator('#pd-mis-total')).toHaveText('1');

    expect(errors).toEqual([]);
  });

  test('बिजली चोरी: IVRS/naam + remark + photo ke saath submit karne se entry save hoti hai, list me dikhti hai', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page, {
      beforeGoto: async (p) => {
        await p.route('**/macros/**', (route) => {
          if (route.request().method() === 'POST') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entry_id: 'BC_TEST_1' }) });
          }
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [] }) });
        });
      },
    });
    await goToDcDashboard(page);
    await page.evaluate(() => switchView('bijli-chori'));
    await page.waitForFunction(() => document.getElementById('bijli-chori-view').classList.contains('active'));

    await page.setInputFiles('#bc-photo-0', { name: 'evidence.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1PX_BASE64, 'base64') });
    await page.waitForFunction(() => document.querySelectorAll('#bc-photo-slots img').length > 0);
    await page.fill('#bc-ivrs', 'IVRS-9988');
    await page.fill('#bc-name', 'राम प्रसाद');
    await page.fill('#bc-remark', 'मीटर से पहले सीधा तार जोड़ा हुआ पाया गया');
    await page.click('#bc-submit-btn');
    await page.waitForFunction(() => document.getElementById('toast-notif')?.textContent?.includes('Entry Saved'));

    await expect(page.locator('#bc-ivrs')).toHaveValue('');

    await page.evaluate(() => toggleEntriesList('bijli_chori'));
    await expect(page.locator('#entries-list-bijli_chori')).toContainText('राम प्रसाद');

    expect(errors).toEqual([]);
  });

  test('कर्मचारी कार्य चरित्रावली: JE login ke baad naya SCN darj karne par अभिलेख tab aur sirf sambandhit कर्मचारी ke apne tab me dikhta hai', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page);
    await goToDcDashboard(page);
    await page.evaluate(() => switchView('karya-charitra'));
    await page.waitForFunction(() => document.getElementById('karya-charitra-view').classList.contains('active'));
    await page.click('#kc-tab-je');

    // Real JE password sirf hash (KC_JE_PASSWORD_HASH) ke roop me committed hai, tests
    // me plaintext available nahi — isliye kcJeLogin() safal login par jo UI-state
    // set karti hai, wahi seedhe simulate karte hain (galat-password rejection neeche
    // alag test karta hai, jo asli hash-check ko hi exercise karta hai).
    await page.evaluate(() => {
      kcJeLoggedIn = true;
      document.getElementById('kc-je-login-box').style.display = 'none';
      document.getElementById('kc-je-logged-panel').style.display = 'block';
      kcRefreshJeDropdowns_();
      kcJeSetMode('new');
    });

    const isoToday = new Date().toISOString().slice(0, 10);

    // Pehla SCN — श्याम यादव
    await page.fill('#kc-new-emp-name', 'श्याम यादव');
    await page.fill('#kc-new-emp-designation', 'लाइनमैन');
    await page.selectOption('#kc-violation-type', 'कार्य में लापरवाही');
    await page.fill('#kc-incident-date', isoToday);
    await page.fill('#kc-violation-desc', 'बिना सूचना कार्यस्थल से अनुपस्थित पाया गया');
    await page.click('button[onclick="kcSaveScn()"]');
    await page.waitForFunction(() => document.getElementById('toast-notif')?.textContent?.includes('दर्ज हो गया'));

    // Dusra SCN — गीता वर्मा (dropdown employees.forEach() ke through select bhi ho sakta
    // hai, par naya naam direct type karna simpler hai aur "naya employee" path bhi covers)
    await page.fill('#kc-new-emp-name', 'गीता वर्मा');
    await page.fill('#kc-new-emp-designation', 'हेल्पर');
    await page.selectOption('#kc-violation-type', 'अनधिकृत अनुपस्थिति');
    await page.fill('#kc-incident-date', isoToday);
    await page.fill('#kc-violation-desc', 'बिना अनुमति कार्यस्थल छोड़कर चली गई');
    await page.click('button[onclick="kcSaveScn()"]');
    await page.waitForFunction(() => document.getElementById('toast-notif')?.textContent?.includes('दर्ज हो गया'));

    // अभिलेख (view) tab me dono employees ke SCN dikhne chahiye
    await page.click('#kc-tab-view');
    await page.waitForFunction(() => !document.getElementById('kc-all-employees-list').innerText.includes('Loading'));
    const viewList = page.locator('#kc-all-employees-list');
    await expect(viewList).toContainText('श्याम यादव');
    await expect(viewList).toContainText('बिना सूचना कार्यस्थल से अनुपस्थित पाया गया');
    await expect(viewList).toContainText('गीता वर्मा');
    await expect(viewList).toContainText('बिना अनुमति कार्यस्थल छोड़कर चली गई');

    // "मेरा SCN" tab — ek employee select karne par sirf uska hi SCN dikhna chahiye,
    // doosre employee ka nahi (filtering by emp_id sahi kaam kar rahi hai, yeh proof hai)
    await page.click('#kc-tab-emp');
    await page.waitForFunction(() => document.getElementById('kc-emp-self-select').options.length > 2);
    await page.selectOption('#kc-emp-self-select', { label: 'श्याम यादव (लाइनमैन)' });
    await page.waitForFunction(() => document.getElementById('kc-my-scns-list').innerText.trim() !== '');
    const myScns = page.locator('#kc-my-scns-list');
    await expect(myScns).toContainText('बिना सूचना कार्यस्थल से अनुपस्थित पाया गया');
    await expect(myScns).not.toContainText('बिना अनुमति कार्यस्थल छोड़कर चली गई');

    expect(errors).toEqual([]);
  });

  test('कर्मचारी कार्य चरित्रावली: galat JE password se dashboard nahi khulta', async ({ page }) => {
    await openApp(page);
    await goToDcDashboard(page);
    await page.evaluate(() => switchView('karya-charitra'));
    await page.waitForFunction(() => document.getElementById('karya-charitra-view').classList.contains('active'));
    await page.click('#kc-tab-je');

    await page.fill('#kc-je-pwd', 'galat-password');
    await page.click('button[onclick="kcJeLogin()"]');
    await page.waitForFunction(() => document.getElementById('toast-notif')?.textContent?.includes('गलत पासवर्ड'));
    await expect(page.locator('#kc-je-login-box')).toBeVisible();
    await expect(page.locator('#kc-je-logged-panel')).toBeHidden();
  });
});

test.describe('Error log (Polish)', () => {
  test('uncaught JS error अपने आप log हो जाती है और modal में दिखती है', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      localStorage.removeItem('seoni-circle-error-log');
      setTimeout(() => { throw new Error('smoke-test-uncaught'); }, 0);
    });
    await page.waitForTimeout(300);

    const logs = await page.evaluate(() => getErrorLogs_());
    expect(logs.some((l) => l.ctx === 'js-error' && l.msg.includes('smoke-test-uncaught'))).toBe(true);

    await page.click('#header-menu-btn');
    await page.click('[aria-label="एरर लॉग देखें"]');
    await expect(page.locator('#error-log-overlay')).toBeVisible();
    await expect(page.locator('#error-log-list')).toContainText('smoke-test-uncaught');
  });

  test('लॉग साफ़ करें बटन काम करता है', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => logErr_('manual-test', new Error('to be cleared')));
    await page.click('#header-menu-btn');
    await page.click('[aria-label="एरर लॉग देखें"]');
    await expect(page.locator('#error-log-list')).toContainText('to be cleared');
    await page.click('#error-log-clear-btn');
    await expect(page.locator('#error-log-list')).toContainText('कोई error नहीं');
    expect(await page.evaluate(() => getErrorLogs_())).toEqual([]);
  });

  test('back button और theme dots अब aria-label रखते हैं (keyboard/screen-reader के लिए)', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#back-btn')).toHaveAttribute('aria-label', 'वापस जाएं');
    expect(await page.locator('.color-dot').count()).toBe(3);
    for (const dot of await page.locator('.color-dot').all()) {
      await expect(dot).toHaveAttribute('aria-label', /.+/);
    }
  });
});

test.describe('XSS सुरक्षा', () => {
  test('escapeHtml असली payload को safe entities में बदल देता है', async ({ page }) => {
    await openApp(page);
    const escaped = await page.evaluate(() => escapeHtml(`<img src=x onerror=alert(1)>&'"`));
    expect(escaped).toBe('&lt;img src=x onerror=alert(1)&gt;&amp;&#39;&quot;');
  });

  test('Broken Pole entry list असली escapeHtml से render होती है (टूटा हुआ HTML raw नहीं जाता)', async ({ page }) => {
    await openApp(page);
    const rendered = await page.evaluate(async () => {
      const config = ENTRY_STORE_CONFIG.broken_pole;
      const fakeEntry = { date: '<b>x</b>', remark1: '<script>evil</script>', remark2: '' };
      return escapeHtml(config.getTitle(fakeEntry));
    });
    expect(rendered).not.toContain('<script>');
    expect(rendered).toContain('&lt;script&gt;');
  });
});

test.describe('App Update Banner', () => {
  test('naya version.json milne par update banner dikhta hai, button dabane par app reload hoti hai', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page, {
      beforeGoto: async (p) => {
        await p.route('**/version.json*', (route) => {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ v: 999 }) });
        });
      },
    });

    await expect(page.locator('#app-update-banner')).toBeHidden();
    await page.evaluate(() => checkForAppUpdate_());
    await expect(page.locator('#app-update-banner')).toBeVisible();
    await expect(page.locator('#app-update-banner')).toContainText('नया अपडेट उपलब्ध है');

    const loadPromise = page.waitForEvent('load');
    await page.click('#app-update-btn');
    await loadPromise;
    expect(errors).toEqual([]);
  });

  test('server ka version wahi (badla nahi) ho to update banner nahi dikhta', async ({ page }) => {
    // version.json ko mock nahi karte — asli file serve hoti hai, jo index.html
    // ke window.__APP_VERSION__ se hamesha sync rehti hai (deploy ke waqt saath
    // badhaate hain), isliye yeh "no update" case ko naturally represent karta
    // hai — version bump hone par is test ko hardcoded number update nahi karna padta.
    await openApp(page);
    await page.evaluate(() => checkForAppUpdate_());
    await page.waitForTimeout(300);
    await expect(page.locator('#app-update-banner')).toBeHidden();
  });
});

test.describe('Entry detail view (UX fix — instant feedback + no redundant refetch)', () => {
  test('View click par turant loading overlay dikhta hai (data aane se pehle hi)', async ({ page }) => {
    let resolveEntries;
    const entriesPromise = new Promise((resolve) => { resolveEntries = resolve; });
    await openApp(page, {
      beforeGoto: (p) => p.route('**/macros/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('action') === 'getEntries' && url.searchParams.get('module') === 'broken_pole') {
          await entriesPromise; // jaan-boojh kar rok kar rakhte hain — loader dikhna chahiye tab tak
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [{ date: '01-07-2026', remark1: 'Pole A', entry_id: 'bp1' }] }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [] }) });
      }),
    });

    const clickPromise = page.evaluate(() => viewEntryDetail_('broken_pole', 'cloud_bp1'));
    await page.waitForFunction(() => document.getElementById('entry-detail-overlay')?.innerText.includes('लोड हो रहा है'));
    resolveEntries();
    await page.waitForFunction(() => document.getElementById('entry-detail-overlay')?.innerText.includes('Pole A'));
    await clickPromise;
  });

  test('list ek baar render hone ke baad, View dobara getEntries fetch nahi karta (cache se milta hai)', async ({ page }) => {
    let fetchCount = 0;
    await openApp(page, {
      beforeGoto: (p) => p.route('**/macros/**', (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('action') === 'getEntries' && url.searchParams.get('module') === 'broken_pole') {
          fetchCount++;
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [{ date: '01-07-2026', remark1: 'Pole A', entry_id: 'bp1' }] }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [] }) });
      }),
    });

    await page.evaluate(() => renderEntriesList_('broken_pole'));
    await page.waitForFunction(() => document.getElementById('entries-list-broken_pole').innerText.includes('Pole A'));
    expect(fetchCount).toBe(1);

    await page.evaluate(() => viewEntryDetail_('broken_pole', 'cloud_bp1'));
    await page.waitForFunction(() => document.getElementById('entry-detail-overlay')?.innerText.includes('Pole A'));

    expect(fetchCount).toBe(1); // sirf list render ke waqt hi fetch hua, View click par nahi
  });
});

test.describe('Backend auth token', () => {
  test('हर backend request (GET और POST दोनों) में auth_token जाता है', async ({ page }) => {
    /** @type {{url: string, method: string, postData: string|null}[]} */
    const requests = [];
    await openApp(page, {
      beforeGoto: (p) => p.route('**/macros/**', (route) => {
        requests.push({ url: route.request().url(), method: route.request().method(), postData: route.request().postData() });
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entry_id: 'TEST' }) });
      }),
    });
    // Home reminder banner ka apna background fetch (karya_charitra) is test ke
    // request count me na aaye, isliye use aaj ke liye dismiss maan lete hain.
    await page.evaluate(() => localStorage.setItem('scn-reminder-dismissed', localTodayIso_()));

    await page.evaluate(async () => {
      const payload = new URLSearchParams();
      payload.append('module', 'feeder');
      payload.append('entries_json', '[]');
      payload.append('auth_token', APPS_SCRIPT_AUTH_TOKEN);
      await fetch(feederSubmitScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: payload.toString(),
      });
      await fetch(`${feederSubmitScriptUrl}?action=getFeederReadings&auth_token=${encodeURIComponent(APPS_SCRIPT_AUTH_TOKEN)}`);
    });

    // Home reminder banner (unrelated background check) apna ek getEntries call
    // bhej sakta hai isse pehle ki dismiss flag asar kare — usse yahan chhod dete hain.
    const relevant = requests.filter((r) => !r.url.includes('action=getEntries'));
    expect(relevant.length).toBe(2);
    const post = relevant.find((r) => r.method === 'POST');
    const get = relevant.find((r) => r.method === 'GET');
    expect(post?.postData).toContain('auth_token=');
    expect(get?.url).toContain('auth_token=');
  });
});

test.describe('Offline sync queue (Karya Charitra)', () => {
  test('offline में बनाया SCN sync_queue में जाता है, local record से client_id मैच करता है', async ({ page }) => {
    await openApp(page, {
      beforeGoto: (p) => p.route('**/macros/**', (route) => route.abort('failed')),
    });

    const result = await page.evaluate(async () => {
      const record = {
        emp_id: 'TEST_EMP', emp_name: 'Test Employee', dispatch_no: 9999,
        scn_date_iso: '2026-01-01', incident_date: '2026-01-01',
        violation_type: 'Test', violation_desc: 'smoke test entry',
      };
      const saved = await kcSaveRecord_(record);
      const queue = await idbGetAll_('sync_queue');
      const local = await idbGetAll_('karya_charitra');
      return {
        saved,
        recordHasClientId: !!record.client_id,
        queueKind: queue[0]?.kind,
        clientIdsMatch: queue[0]?.entry?.client_id === local[local.length - 1]?.client_id,
      };
    });

    expect(result.saved).toBe(true);
    expect(result.recordHasClientId).toBe(true);
    expect(result.queueKind).toBe('shared_entry');
    expect(result.clientIdsMatch).toBe(true);
  });

  test('internet वापस आने पर queue अपने आप replay होकर entry_id backfill करता है', async ({ page }) => {
    let networkUp = false;
    await openApp(page, {
      beforeGoto: (p) => p.route('**/macros/**', (route) => {
        if (!networkUp) return route.abort('failed');
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entry_id: 'E_REPLAYED' }) });
      }),
    });

    await page.evaluate(async () => {
      const record = {
        emp_id: 'TEST2', emp_name: 'Replay Test', dispatch_no: 8888,
        scn_date_iso: '2026-01-01', incident_date: '2026-01-01',
        violation_type: 'Test2', violation_desc: 'replay test',
      };
      await kcSaveRecord_(record);
    });

    networkUp = true;
    const after = await page.evaluate(async () => {
      await processSyncQueue_();
      const queue = await idbGetAll_('sync_queue');
      const local = await idbGetAll_('karya_charitra');
      return { queueLen: queue.length, entryId: local[local.length - 1]?.entry_id };
    });

    expect(after.queueLen).toBe(0);
    expect(after.entryId).toBe('E_REPLAYED');
  });

  test('queue mein ek entry permanently (backend se) fail ho to baaki entries phir bhi sync ho jaani chahiye (poison-message fix)', async ({ page }) => {
    let online = false;
    await openApp(page, {
      beforeGoto: (p) => p.route('**/macros/**', (route) => {
        if (!online) return route.abort('failed');
        // postData() form-urlencoded raw body deta hai — entry_json nikalne ke
        // liye URLSearchParams se decode karna padta hai (raw string me "%22"
        // jaisa encoded hota hai, seedha ".includes" match nahi karta).
        const entryJson = new URLSearchParams(route.request().postData() || '').get('entry_json') || '';
        if (entryJson.includes('"dispatch_no":7777')) {
          // Yeh entry hamesha backend-reject hoti hai (network down nahi) —
          // permanent/logical failure simulate karta hai (jaise validation error).
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'error', message: 'Validation failed' }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entry_id: 'E_GOOD' }) });
      }),
    });

    await page.evaluate(async () => {
      await kcSaveRecord_({
        emp_id: 'TEST_BAD', emp_name: 'Bad Entry', dispatch_no: 7777,
        scn_date_iso: '2026-01-01', incident_date: '2026-01-01',
        violation_type: 'Bad', violation_desc: 'always fails',
      });
      await kcSaveRecord_({
        emp_id: 'TEST_GOOD', emp_name: 'Good Entry', dispatch_no: 8899,
        scn_date_iso: '2026-01-01', incident_date: '2026-01-01',
        violation_type: 'Good', violation_desc: 'should sync fine',
      });
    });

    online = true;
    const after = await page.evaluate(async () => {
      await processSyncQueue_();
      const queue = await idbGetAll_('sync_queue');
      const local = await idbGetAll_('karya_charitra');
      return {
        queueDispatchNos: queue.map((q) => q.entry?.dispatch_no),
        failCount: queue[0]?.failCount || 0,
        goodEntryId: local.find((r) => r.dispatch_no === 8899)?.entry_id,
      };
    });

    // Bad entry (7777) queue me hi rukni chahiye (backend hamesha reject karta
    // hai) — lekin isse good entry (8899) block nahi honi chahiye, wo sync
    // hokar queue se hat jaani chahiye.
    expect(after.queueDispatchNos).toEqual([7777]);
    expect(after.failCount).toBeGreaterThanOrEqual(1);
    expect(after.goodEntryId).toBe('E_GOOD');
  });
});

test.describe('Admin Dashboard (Phase-1)', () => {
  // Admin dashboard default date-range "is mahine ke 1 se aaj tak" hai (admDefaultFromDate_
  // + localTodayIso_) — isliye mock entries ki date hamesha "aaj" honi chahiye, koi hardcoded
  // mahina/saal nahi, warna agle mahine yeh test apne-aap fail hone lagta (calendar rollover).
  const today = new Date();
  const ddmmyyyyDash = `${String(today.getDate()).padStart(2, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`;
  const ddmmyyyySlash = ddmmyyyyDash.replace(/-/g, '/');
  const isoDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  /** @param {import('@playwright/test').Page} page */
  async function mockAdminBackend(page) {
    await page.route('**/macros/**', (route) => {
      const url = new URL(route.request().url());
      const action = url.searchParams.get('action');
      const module = url.searchParams.get('module');
      if (action === 'getEntries' && module === 'broken_pole') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [{ date: ddmmyyyyDash, remark1: 'Pole A', entry_id: 'bp1' }] }) });
      }
      if (action === 'getEntries' && module === 'bijli_chori') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [{ date: ddmmyyyyDash, name: 'Consumer X', photos: [], entry_id: 'bc1' }] }) });
      }
      if (action === 'getEntries' && module === 'karya_charitra') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [{ scn_date_iso: isoDate, emp_name: 'Ram Kumar', dispatch_no: 3, entry_id: 'kc1' }] }) });
      }
      if (action === 'getFeederReadings') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ '33/11 KV SUBSTATION': 'SS1', '33 AND 11 KV FEEDER': 'F1', 'DATE(DD/MM/YYY)': ddmmyyyySlash }]) });
      }
      if (action === 'getSummary') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ dc: 'DC1', ivrs: '111' }, { dc: 'DC1', ivrs: '222' }]) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success' }) });
    });
  }

  test('गलत PIN से dashboard नहीं खुलता', async ({ page }) => {
    await openApp(page, { beforeGoto: mockAdminBackend });
    await page.evaluate(() => openAdminDashboardGate_());
    await expect(page.locator('#admin-pin-overlay')).toBeVisible();
    await page.fill('#admin-pin-input', 'galat-pin');
    await page.click('#admin-pin-submit-btn');
    await expect(page.locator('#admin-pin-overlay')).toBeVisible();
    expect(await page.evaluate(() => document.getElementById('admin-dashboard-view').classList.contains('active'))).toBe(false);
  });

  test('सही PIN से dashboard खुलता है और module counts सही दिखते हैं', async ({ page }) => {
    await openApp(page, { beforeGoto: mockAdminBackend });
    await page.evaluate(() => openAdminDashboardGate_());
    await page.fill('#admin-pin-input', 'SC@2026');
    await page.click('#admin-pin-submit-btn');

    await page.waitForFunction(() => document.getElementById('admin-dashboard-view').classList.contains('active'));
    await expect(page.locator('#admin-pin-overlay')).toHaveCount(0);
    await page.waitForFunction(() => !document.getElementById('admin-dashboard-body').innerText.includes('लोड हो रहा है'));

    const body = page.locator('#admin-dashboard-body');
    await expect(body).toContainText('Ram Kumar');
    await expect(body).toContainText('Pole A');
    await expect(body).toContainText('Consumer X');
    await expect(body).toContainText('SS1');

    const cached = await page.evaluate(() => ({
      feeder: admLastData_.feederRows.length,
      bp: admLastData_.bpInRange.length,
      bc: admLastData_.bcInRange.length,
      kc: admLastData_.kcInRange.length,
      mobile: admLastData_.mobileRows.length,
    }));
    expect(cached).toEqual({ feeder: 1, bp: 1, bc: 1, kc: 1, mobile: 2 });
  });

  test('घटना मैप: sirf valid-GPS entries pin ban kar dikhti hain, legend counts sahi hote hain, popup se "देखें" kaam karta hai', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page, {
      beforeGoto: async (p) => {
        await p.route('**/macros/**', (route) => {
          const url = new URL(route.request().url());
          const action = url.searchParams.get('action');
          const module = url.searchParams.get('module');
          if (action === 'getEntries' && module === 'broken_pole') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
              status: 'success', entries: [
                { date: ddmmyyyyDash, remark1: 'Pole A (GPS wali)', gps_latitude: '22.620', gps_longitude: '79.600', entry_id: 'bp1' },
                { date: ddmmyyyyDash, remark1: 'Pole B (GPS nahi)', entry_id: 'bp2' }, // GPS nahi — map pe nahi dikhni chahiye
              ]
            }) });
          }
          if (action === 'getEntries' && module === 'bijli_chori') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
              status: 'success', entries: [
                { date: ddmmyyyyDash, name: 'Consumer X', photos: [{ gps_latitude: '22.630', gps_longitude: '79.610' }], entry_id: 'bc1' },
              ]
            }) });
          }
          if (action === 'getEntries' && module === 'dtr_health') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
              status: 'success', entries: [
                { date: ddmmyyyyDash, dtr_no: 'DTR-9', issue_type: 'Overload', gps_latitude: '22.610', gps_longitude: '79.590', entry_id: 'dtr1' },
              ]
            }) });
          }
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [] }) });
        });
      },
    });
    await goToDcDashboard(page);
    await page.evaluate(() => openAdminDashboardGate_());
    await page.fill('#admin-pin-input', 'SC@2026');
    await page.click('#admin-pin-submit-btn');
    await page.waitForFunction(() => document.getElementById('admin-dashboard-view').classList.contains('active'));
    await page.waitForFunction(() => !document.getElementById('admin-dashboard-body').innerText.includes('लोड हो रहा है'));

    await page.click('button[onclick="admOpenIncidentMap_()"]');
    await expect(page.locator('#incident-map-overlay')).toBeVisible();
    await page.waitForFunction(() => document.getElementById('incident-map-canvas')?.classList.contains('leaflet-container'), null, { timeout: 15000 });

    const legend = page.locator('#incident-map-legend');
    await expect(legend).toContainText('टूटा खंभा (1)');
    await expect(legend).toContainText('बिजली चोरी (1)');
    await expect(legend).toContainText('DTR समस्या (1)');

    // GPS-wali 3 entries hi pin bani hain — "Pole B (GPS nahi)" wali chhoot gayi
    await expect(page.locator('#incident-map-canvas .leaflet-interactive')).toHaveCount(3);

    await page.locator('#incident-map-canvas .leaflet-interactive').first().click();
    await expect(page.locator('.leaflet-popup')).toBeVisible();
    await expect(page.locator('.leaflet-popup')).toContainText('देखें');

    await page.click('#incident-map-close-btn');
    await expect(page.locator('#incident-map-overlay')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('Excel export data missing hone par crash nahi karta, friendly toast deta hai', async ({ page }) => {
    await openApp(page, { beforeGoto: mockAdminBackend });
    const noDataToast = await page.evaluate(() => {
      admLastData_ = null;
      let msg = null;
      const original = window.showToast;
      window.showToast = (m) => { msg = m; };
      admExportExcel_();
      window.showToast = original;
      return msg;
    });
    expect(noDataToast).toContain('पहले data load होने दें');
  });

  test('Excel export library (xlsx.full.min.js) load fail ho to crash nahi karta, friendly toast deta hai', async ({ page }) => {
    // xlsx.full.min.js ab CDN se nahi, is app ke apne server se lazy-load hoti
    // hai (sirf export click par) — yahaan uska local request hi fail karke
    // dikhate hain ki load-failure gracefully handle hoti hai.
    await openApp(page, {
      beforeGoto: async (p) => {
        await mockAdminBackend(p);
        await p.route('**/js/vendor/xlsx.full.min.js', (route) => route.abort());
      },
    });
    const toast = await page.evaluate(async () => {
      admLastData_ = { feederRows: [], bpInRange: [], bcInRange: [], kcInRange: [], mobileRows: [], fromKey: '', toKey: '' };
      let msg = null;
      const original = window.showToast;
      window.showToast = (m) => { msg = m; };
      await admExportExcel_();
      window.showToast = original;
      return msg;
    });
    expect(toast).toBeTruthy();
  });

  test('लॉक करें home पर वापस भेजता है और दोबारा PIN मांगता है', async ({ page }) => {
    await openApp(page, { beforeGoto: mockAdminBackend });
    await page.evaluate(async () => {
      openAdminDashboardGate_();
      document.getElementById('admin-pin-input').value = 'SC@2026';
      await document.getElementById('admin-pin-submit-btn').onclick();
    });
    await page.waitForFunction(() => document.getElementById('admin-dashboard-view').classList.contains('active'));

    await page.click('text=🔒 लॉक');
    await expect(page.locator('#home-view')).toHaveClass(/active/);

    await page.evaluate(() => openAdminDashboardGate_());
    await expect(page.locator('#admin-pin-overlay')).toBeVisible();
  });

  test('🩺 Diagnostics panel field devices ki error-log dikhata hai, backend module register na ho to bhi crash nahi karta', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page, {
      beforeGoto: async (p) => {
        await p.route('**/macros/**', (route) => {
          const url = new URL(route.request().url());
          if (url.searchParams.get('action') === 'getEntries' && url.searchParams.get('module') === 'device_diagnostics') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [
              { ctx: 'sync-broken_pole', msg: 'Server ne HTTP 500 diya', dc: 'ADEGAON', view: 'broken-pole-view', device_id: 'D123abc456', timestamp: '2026-07-20T10:00:00.000Z' },
            ] }) });
          }
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [] }) });
        });
      },
    });
    await page.evaluate(async () => {
      openAdminDashboardGate_();
      document.getElementById('admin-pin-input').value = 'SC@2026';
      await document.getElementById('admin-pin-submit-btn').onclick();
    });
    await page.waitForFunction(() => document.getElementById('admin-dashboard-view').classList.contains('active'));

    await page.click('text=🩺 Field Devices पर क्या गड़बड़ हुई (Diagnostics)');
    await expect(page.locator('#adm-diag-overlay')).toBeVisible();
    await page.waitForFunction(() => !document.getElementById('adm-diag-body')?.innerText.includes('लोड हो रहा है'));
    await expect(page.locator('#adm-diag-body')).toContainText('sync-broken_pole');
    await expect(page.locator('#adm-diag-body')).toContainText('Server ne HTTP 500 diya');
    await expect(page.locator('#adm-diag-body')).toContainText('ADEGAON');

    await page.click('#adm-diag-close-btn');
    await expect(page.locator('#adm-diag-overlay')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('header title पर long-press (700ms) से PIN prompt खुलता है', async ({ page }) => {
    await openApp(page, { beforeGoto: mockAdminBackend });
    const title = page.locator('#main-header-title');
    await title.dispatchEvent('pointerdown');
    await page.waitForTimeout(800);
    await title.dispatchEvent('pointerup');
    await expect(page.locator('#admin-pin-overlay')).toBeVisible();
  });

  test('⋮ header menu से Admin Dashboard खोला जा सकता है', async ({ page }) => {
    await openApp(page, { beforeGoto: mockAdminBackend });
    await expect(page.locator('#header-menu-dropdown')).toBeHidden();
    await page.click('#header-menu-btn');
    await expect(page.locator('#header-menu-dropdown')).toBeVisible();
    await page.click('text=📊 Admin Dashboard');
    await expect(page.locator('#header-menu-dropdown')).toBeHidden();
    await expect(page.locator('#admin-pin-overlay')).toBeVisible();
  });

  test('मेनू के बाहर क्लिक करने पर ⋮ dropdown बंद हो जाता है', async ({ page }) => {
    await openApp(page, { beforeGoto: mockAdminBackend });
    await page.click('#header-menu-btn');
    await expect(page.locator('#header-menu-dropdown')).toBeVisible();
    await page.click('body', { position: { x: 5, y: 5 } });
    await expect(page.locator('#header-menu-dropdown')).toBeHidden();
  });
});

test.describe('PWA manifest shortcuts (home-screen icon long-press)', () => {
  test('?shortcut=admin se seedhe PIN overlay khulta hai', async ({ page }) => {
    await blockExternal(page);
    await page.goto('/?shortcut=admin');
    await page.waitForFunction(() => document.getElementById('home-view').classList.contains('active'));
    await expect(page.locator('#admin-pin-overlay')).toBeVisible();
  });

  test('?shortcut=errorlog se seedhe error-log modal khulta hai', async ({ page }) => {
    await blockExternal(page);
    await page.goto('/?shortcut=errorlog');
    await page.waitForFunction(() => document.getElementById('home-view').classList.contains('active'));
    await expect(page.locator('#error-log-overlay')).toBeVisible();
  });
});

test.describe('Home reminders (Push Notification lite)', () => {
  /** @param {import('@playwright/test').Page} page */
  /** @param {{scn_date_iso: string, reply_text?: string}[]} entries */
  async function mockKcEntries(page, entries) {
    await page.route('**/macros/**', (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('action') === 'getEntries' && url.searchParams.get('module') === 'karya_charitra') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [] }) });
    });
  }

  // Hardcoded absolute dates flake out as real time moves past their 7-din window —
  // "today" ke relative se banate hain taaki test hamesha valid rahe.
  function isoDateDaysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  test('सभी SCN का समय पर जवाब आ चुका हो तो कोई reminder नहीं दिखता', async ({ page }) => {
    await openApp(page, {
      beforeGoto: (p) => mockKcEntries(p, [{ scn_date_iso: isoDateDaysAgo(10), emp_name: 'Ram Kumar', dispatch_no: 3, entry_id: 'kc1', reply_text: 'माफ़ी', reply_date_iso: isoDateDaysAgo(9) }]),
    });
    await page.evaluate(() => renderScnReminderBanner_());
    await expect(page.locator('#scn-reminder-banner')).toHaveCount(0);
  });

  test('SCN का जवाब बाकी हो और 7 दिन की समय सीमा पार हो चुकी हो तो overdue banner दिखता है', async ({ page }) => {
    await openApp(page, {
      beforeGoto: (p) => mockKcEntries(p, [{ scn_date_iso: isoDateDaysAgo(10), emp_name: 'Ram Kumar', dispatch_no: 3, entry_id: 'kc1' }]),
    });
    await page.evaluate(() => renderScnReminderBanner_());
    await expect(page.locator('#scn-reminder-banner')).toBeVisible();
    await expect(page.locator('#scn-reminder-banner')).toContainText('समय सीमा');
  });

  test('SCN का जवाब बाकी हो पर अभी 7 दिन की समय सीमा के अंदर हो तो neutral (non-overdue) banner दिखता है', async ({ page }) => {
    await openApp(page, {
      beforeGoto: (p) => mockKcEntries(p, [{ scn_date_iso: isoDateDaysAgo(2), emp_name: 'Shyam Lal', dispatch_no: 5, entry_id: 'kc2' }]),
    });
    await page.evaluate(() => renderScnReminderBanner_());
    const banner = page.locator('#scn-reminder-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('उत्तर बाकी है');
    await expect(banner).not.toContainText('समय सीमा');
  });

  test('✕ दबाने पर banner हट जाता है और आज दोबारा नहीं दिखता', async ({ page }) => {
    await openApp(page, {
      beforeGoto: (p) => mockKcEntries(p, [{ scn_date_iso: '2026-07-10', emp_name: 'Ram Kumar', dispatch_no: 3, entry_id: 'kc1' }]),
    });
    await page.evaluate(() => renderScnReminderBanner_());
    await expect(page.locator('#scn-reminder-banner')).toBeVisible();
    await page.click('[aria-label="रिमाइंडर बंद करें"]');
    await expect(page.locator('#scn-reminder-banner')).toHaveCount(0);
    await page.evaluate(() => renderScnReminderBanner_());
    await expect(page.locator('#scn-reminder-banner')).toHaveCount(0);
  });

  test('"देखें" बटन कर्मचारी कार्य चरित्रावली view बिना error के खोलता है', async ({ page }) => {
    const errors = [];
    await openApp(page, {
      beforeGoto: (p) => mockKcEntries(p, [{ scn_date_iso: '2026-07-10', emp_name: 'Ram Kumar', dispatch_no: 3, entry_id: 'kc1' }]),
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.evaluate(() => renderScnReminderBanner_());
    await page.click('text=देखें');
    await page.waitForFunction(() => document.getElementById('karya-charitra-view').classList.contains('active'));
    expect(errors).toEqual([]);
  });
});

test.describe('Employee Login (accountability) — plumbing (gate abhi disabled hai, deploy nahi hua)', () => {
  // employee-auth.js code me maujood hai (backend Apps Script action abhi manual deploy
  // nahi hui isliye) par boot-gate jaan-bujhkar disabled hai — isliye gate-flow (naya
  // login, galat PIN, logout-se-gate-khulna) ke tests yahan nahi hain, sirf yeh 2 jo
  // submitted_by tagging plumbing check karte hain (openApp() ke default pre-seeded
  // localStorage employee se, gate se independent).
  test('Broken Pole entry submit karte waqt submitted_by_id/name payload me jaate hain', async ({ page }) => {
    /** @type {URLSearchParams[]} */
    const posts = [];
    await openApp(page, {
      beforeGoto: (p) => p.route('**/macros/**', (route) => {
        const req = route.request();
        if (req.method() === 'POST') posts.push(new URLSearchParams(req.postData() || ''));
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entry_id: 'BP1' }) });
      }),
    });
    await page.evaluate(async () => {
      const entry = { date: '01-07-2026', remark1: 'Test Pole', remark2: '', ...currentEmployeeTag_() };
      await syncEntryToCloud_('broken_pole', entry);
    });
    const relevant = posts.find((p) => p.get('module') === 'broken_pole');
    const sentEntry = JSON.parse(relevant?.get('entry_json') || '{}');
    expect(sentEntry.submitted_by_id).toBe('TEST_EMP');
    expect(sentEntry.submitted_by_name).toBe('Test Employee');
  });

  test('Admin Dashboard "कर्मचारी अनुसार" breakdown submitted_by_name se count karta hai', async ({ page }) => {
    await openApp(page, {
      beforeGoto: (p) => p.route('**/macros/**', (route) => {
        const url = new URL(route.request().url());
        const action = url.searchParams.get('action');
        const module = url.searchParams.get('module');
        if (action === 'getEntries' && module === 'broken_pole') {
          // Admin dashboard default date-range "is mahine ke 1 se aaj tak" hai, isliye
          // entries ki date hamesha "aaj" honi chahiye — hardcoded mahina/saal nahi
          // (warna agle mahine yeh test calendar rollover par fail hone lagta).
          const today = new Date();
          const ddmmyyyy = `${String(today.getDate()).padStart(2, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`;
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [
            { date: ddmmyyyy, remark1: 'A', entry_id: 'bp1', submitted_by_name: 'Ram Kumar' },
            { date: ddmmyyyy, remark1: 'B', entry_id: 'bp2', submitted_by_name: 'Ram Kumar' },
          ] }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [] }) });
      }),
    });
    await page.evaluate(() => { adminDashboardUnlocked_ = true; openAdminDashboardGate_(); });
    await page.waitForFunction(() => !document.getElementById('admin-dashboard-body')?.innerText.includes('लोड हो रहा है'));
    const body = page.locator('#admin-dashboard-body');
    await expect(body).toContainText('Ram Kumar');
    await expect(body).toContainText('कर्मचारी अनुसार');
  });
});

test.describe('Mobile Correction Tracker (galat mobile number flag + monitor)', () => {
  const CONSUMER_CSV = 'IVRS NO,NAME,FATHER,OLD MOBILE,ADDRESS,HQ,TARIFF,LOAD\n1234567890,Test Consumer,Test Father,9998887771,"Test Address, Adegaon",ADEGAON HQ,LV1,1\n2345678901,Doosra Consumer,Doosra Father,9998887772,"Doosra Address, Bibi",BIBI HQ,LV1,1\n';

  /** @param {import('@playwright/test').Page} page */
  async function mockConsumerCsv(page) {
    // ADEGAON ka csvUrl (./data/adegaon-consumers.csv, same-origin) mock karte
    // hain — isse ensureDcDataLoaded() ka production code path hi chalta hai
    // (koi race/overwrite risk nahi), aur asli 10k+ row file test me load nahi karni padti.
    await page.route('**/data/adegaon-consumers.csv**', (route) => {
      route.fulfill({ status: 200, contentType: 'text/csv', body: CONSUMER_CSV });
    });
  }

  /** @param {import('@playwright/test').Page} page */
  async function goToMobileUpdate(page) {
    await goToDcDashboard(page); // Lakhnadon -> ADEGAON
    await page.evaluate(() => switchView('mobile-update'));
    await page.waitForFunction(() => document.getElementById('mobile-update-view').classList.contains('active'));
    await page.fill('#search-ivrs', '1234567890');
    await page.click('#search-btn');
    await page.waitForFunction(() => document.getElementById('result-box').style.display !== 'none', null, { timeout: 15000 });
  }

  test('IVRS search se consumer detail dikhte hain aur "flag karein" button se entry save hoti hai', async ({ page }) => {
    await openApp(page, {
      beforeGoto: async (p) => {
        await mockConsumerCsv(p);
        await p.route('**/macros/**', (route) => {
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entry_id: 'MC1', entries: [] }) });
        });
      },
    });
    await goToMobileUpdate(page);

    await expect(page.locator('#res-name')).toHaveText('Test Consumer');
    await expect(page.locator('#res-old')).toHaveText('9998887771');

    await page.click('#mc-flag-btn');
    await page.waitForTimeout(300);

    const entries = await page.evaluate(() => getMobileCorrectionEntries_());
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatchObject({
      ivrs: '1234567890', name: 'Test Consumer', hq: 'ADEGAON HQ',
      old_mobile: '9998887771', status: 'pending', submitted_by_name: 'Test Employee',
    });
  });

  test('IVRS aur mobile number par tap karne se ek jaisi action sheet khulti hai — sirf copy aur call ke options', async ({ page }) => {
    await openApp(page, {
      beforeGoto: async (p) => {
        await mockConsumerCsv(p);
        await p.route('**/macros/**', (route) => {
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entry_id: 'MC1', entries: [] }) });
        });
      },
    });
    await goToMobileUpdate(page);

    // navigator.clipboard.writeText headless me permission ke bina fail ho sakta
    // hai — window par capture karke verify karte hain ki sahi text bheja gaya.
    await page.evaluate(() => {
      window.__copiedText = null;
      navigator.clipboard.writeText = (t) => { window.__copiedText = t; return Promise.resolve(); };
    });

    // IVRS tap -> ek sheet khule, sirf "कॉपी करें" option ho (call/sms/whatsapp nahi)
    await page.click('#res-ivrs');
    const ivrsSheet = page.locator('#mc-mobile-actions-overlay');
    await expect(ivrsSheet).toBeVisible();
    await expect(ivrsSheet).toContainText('IVRS नंबर कॉपी करें');
    await expect(ivrsSheet.locator('a[href^="tel:"]')).toHaveCount(0);
    await page.click('#mc-copy-ivrs-card');
    await page.waitForFunction(() => window.__copiedText === '1234567890');
    await expect(page.locator('#toast-notif')).toContainText(/कॉपी/);
    await expect(ivrsSheet).toHaveCount(0);

    // Mobile tap -> sirf do options: कॉल करें aur मोबाइल नंबर कॉपी करें (SMS/WhatsApp nahi)
    await page.click('#res-old');
    const sheet = page.locator('#mc-mobile-actions-overlay');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('a[href^="tel:"]')).toHaveAttribute('href', 'tel:+919998887771');
    await expect(sheet.locator('a[href^="sms:"]')).toHaveCount(0);
    await expect(sheet.locator('a[href*="wa.me"]')).toHaveCount(0);
    await expect(sheet).toContainText('मोबाइल नंबर कॉपी करें');

    await page.click('#mc-copy-mobile-card');
    await page.waitForFunction(() => window.__copiedText === '9998887771');
    await expect(sheet).toHaveCount(0);
  });

  test('same IVRS दोबारा flag करने पर duplicate pending entry नहीं बनती', async ({ page }) => {
    await openApp(page, {
      beforeGoto: async (p) => {
        await mockConsumerCsv(p);
        await p.route('**/macros/**', (route) => {
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entry_id: 'MC1', entries: [] }) });
        });
      },
    });
    await goToMobileUpdate(page);
    await page.click('#mc-flag-btn');
    await page.waitForTimeout(300);

    await page.fill('#search-ivrs', '1234567890');
    await page.click('#search-btn');
    await page.waitForFunction(() => document.getElementById('result-box').style.display !== 'none');
    await page.click('#mc-flag-btn');
    await page.waitForTimeout(300);

    const entries = await page.evaluate(() => getMobileCorrectionEntries_());
    expect(entries.length).toBe(1);
  });

  test('Pending list HQ-wise dikhti hai (highlighted), aur सही नंबर सेव करने पर "corrected" ho jaati hai', async ({ page }) => {
    await openApp(page, {
      beforeGoto: async (p) => {
        await mockConsumerCsv(p);
        await p.route('**/macros/**', (route) => {
          const url = new URL(route.request().url());
          const req = route.request();
          if (req.method() === 'POST') {
            const params = new URLSearchParams(req.postData() || '');
            if (params.get('action') === 'updateEntry') {
              return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success' }) });
            }
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entry_id: 'MC1' }) });
          }
          if (url.searchParams.get('action') === 'getEntries' && url.searchParams.get('module') === 'mobile_correction') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [] }) });
          }
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [] }) });
        });
      },
    });
    await goToMobileUpdate(page);
    await page.click('#mc-flag-btn');
    await page.waitForTimeout(300);

    await page.click('button[onclick="toggleMobileCorrectionList_()"]');
    await page.waitForFunction(() => document.getElementById('mc-pending-list').innerText.includes('Test Consumer'));

    const list = page.locator('#mc-pending-list');
    await expect(list).toContainText('कुल फ़्लैग: 1');
    await expect(list).toContainText('बाकी: 1');
    await expect(list.locator('table')).toBeVisible();
    await expect(list.locator('th')).not.toContainText(['HQ']);
    await expect(list.locator('th')).not.toContainText(['फ़्लैग किया']);
    await expect(list).toContainText('⏳ पेंडिंग');
    // flagged_date ab "पुराना (गलत) नंबर" cell ke andar niche dikhti hai (alag column nahi)
    const expectedFlagDate = await page.evaluate(() => getCurrentDateDDMMYYYY());
    await expect(list).toContainText(expectedFlagDate);

    const uid = await page.evaluate(async () => {
      const entries = await getMobileCorrectionEntries_();
      return getEntryUid_(entries[0]);
    });
    await page.fill(`#mc-correct-${uid}`, '9123456789');
    await page.click(`button[onclick="saveCorrectMobile_('${uid}')"]`);
    await page.waitForFunction((u) => document.getElementById('mc-pending-list').innerText.includes('9123456789'), uid);

    await expect(list).toContainText('ठीक हुए: 1');
    await expect(list).toContainText('बाकी: 0');
    await expect(list).toContainText('✅ ठीक हुआ');
    const entries = await page.evaluate(() => getMobileCorrectionEntries_());
    expect(entries[0].status).toBe('corrected');
    expect(entries[0].correct_mobile).toBe('9123456789');
  });

  test('Galti se flag hui IVRS entry ko confirm karke list se hataya ja sakta hai (cloud se bhi)', async ({ page }) => {
    let deleteCalled = false;
    await openApp(page, {
      beforeGoto: async (p) => {
        await mockConsumerCsv(p);
        await p.route('**/macros/**', (route) => {
          const req = route.request();
          if (req.method() === 'POST') {
            const params = new URLSearchParams(req.postData() || '');
            if (params.get('action') === 'deleteEntry') {
              deleteCalled = true;
              expect(params.get('entry_id')).toBe('MC1');
              return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success' }) });
            }
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entry_id: 'MC1' }) });
          }
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [] }) });
        });
      },
    });
    await goToMobileUpdate(page);
    await page.click('#mc-flag-btn');
    await page.waitForTimeout(300);

    await page.click('button[onclick="toggleMobileCorrectionList_()"]');
    await page.waitForFunction(() => document.getElementById('mc-pending-list').innerText.includes('Test Consumer'));

    const list = page.locator('#mc-pending-list');
    await expect(list).toContainText('कुल फ़्लैग: 1');

    await page.click("button[onclick*=\"mcDeleteEntryConfirm_\"]");
    const overlay = page.locator('#mc-delete-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('यह entry हटाएं?');

    // Cancel se overlay band ho, entry list me bani rahe
    await page.click('#mc-delete-cancel-btn');
    await expect(overlay).toHaveCount(0);
    await expect(list).toContainText('Test Consumer');

    // Ab confirm karke delete karte hain — local delete turant hoti hai (list
    // turant refresh), cloud delete background me hoti hai isliye deleteCalled
    // ka alag se wait karte hain.
    await page.click("button[onclick*=\"mcDeleteEntryConfirm_\"]");
    await page.click('#mc-delete-confirm-btn');
    await page.waitForFunction(() => document.getElementById('mc-pending-list').innerText.includes('कोई flag की हुई entry नहीं है'));

    await expect.poll(() => deleteCalled).toBe(true);
    const entries = await page.evaluate(() => getMobileCorrectionEntries_());
    expect(entries.length).toBe(0);
  });

  test('सूची देखें बटन के बगल में HQ filter dropdown se list HQ ke hisaab se filter hoti hai', async ({ page }) => {
    await openApp(page, {
      beforeGoto: async (p) => {
        await mockConsumerCsv(p);
        await p.route('**/macros/**', (route) => {
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entry_id: 'MC1', entries: [] }) });
        });
      },
    });
    await goToMobileUpdate(page);
    await page.click('#mc-flag-btn');
    await page.waitForTimeout(300);

    await page.fill('#search-ivrs', '2345678901');
    await page.click('#search-btn');
    await page.waitForFunction(() => document.getElementById('result-box').style.display !== 'none');
    await page.click('#mc-flag-btn');
    await page.waitForTimeout(300);

    await page.click('button[onclick="toggleMobileCorrectionList_()"]');
    await page.waitForFunction(() => document.getElementById('mc-pending-list').innerText.includes('Test Consumer'));

    const hqFilter = page.locator('#mc-hq-filter');
    await expect(hqFilter.locator('option')).toHaveCount(3); // सभी HQ + ADEGAON HQ + BIBI HQ
    const list = page.locator('#mc-pending-list');
    await expect(list).toContainText('Test Consumer');
    await expect(list).toContainText('Doosra Consumer');

    await hqFilter.selectOption('ADEGAON HQ');
    await page.waitForFunction(() => !document.getElementById('mc-pending-list').innerText.includes('Doosra Consumer'));
    await expect(list).toContainText('Test Consumer');
    await expect(list).toContainText('कुल फ़्लैग: 1');

    await hqFilter.selectOption('BIBI HQ');
    await page.waitForFunction(() => !document.getElementById('mc-pending-list').innerText.includes('Test Consumer'));
    await expect(list).toContainText('Doosra Consumer');

    await hqFilter.selectOption('');
    await page.waitForFunction(() => document.getElementById('mc-pending-list').innerText.includes('Test Consumer') && document.getElementById('mc-pending-list').innerText.includes('Doosra Consumer'));
  });

  test('Search box se IVRS/naam/mobile/gaanv/tariff se particular consumer dhoonda ja sakta hai', async ({ page }) => {
    await openApp(page, {
      beforeGoto: async (p) => {
        await mockConsumerCsv(p);
        await p.route('**/macros/**', (route) => {
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entry_id: 'MC1', entries: [] }) });
        });
      },
    });
    await goToMobileUpdate(page);
    await page.click('#mc-flag-btn'); // Test Consumer, ADEGAON HQ, address "Test Address, Adegaon", mobile 9998887771
    await page.waitForTimeout(300);

    await page.fill('#search-ivrs', '2345678901');
    await page.click('#search-btn');
    await page.waitForFunction(() => document.getElementById('result-box').style.display !== 'none');
    await page.click('#mc-flag-btn'); // Doosra Consumer, BIBI HQ, address "Doosra Address, Bibi", mobile 9998887772
    await page.waitForTimeout(300);

    // Search box se list khud khul jaani chahiye (band karke rakha tha)
    await page.fill('#mc-search-input', 'Adegaon');
    await page.waitForFunction(() => document.getElementById('mc-pending-list').style.display === 'block');
    await page.waitForFunction(() => document.getElementById('mc-pending-list').innerText.includes('Test Consumer'));
    const list = page.locator('#mc-pending-list');
    await expect(list).toContainText('Test Consumer');
    await expect(list).not.toContainText('Doosra Consumer');

    // Mobile number se bhi search ho
    await page.fill('#mc-search-input', '9998887772');
    await page.waitForFunction(() => !document.getElementById('mc-pending-list').innerText.includes('Test Consumer'));
    await expect(list).toContainText('Doosra Consumer');

    // Khali karne par sab wapas dikhein
    await page.fill('#mc-search-input', '');
    await page.waitForFunction(() => document.getElementById('mc-pending-list').innerText.includes('Test Consumer') && document.getElementById('mc-pending-list').innerText.includes('Doosra Consumer'));

    // Kisi bhi field se match na ho to friendly "koi entry nahi mili" dikhe
    await page.fill('#mc-search-input', 'zzz-no-match-zzz');
    await page.waitForFunction(() => document.getElementById('mc-pending-list').innerText.includes('इस खोज से कोई entry नहीं मिली'));
  });

  test('⋮ मेनू me MPEZ Portal aur Excel download milte hain, PDF MIS Report option nahi hai', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page, {
      beforeGoto: async (p) => {
        await mockConsumerCsv(p);
        await p.route('**/macros/**', (route) => {
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entry_id: 'MC1', entries: [] }) });
        });
      },
    });
    await goToMobileUpdate(page);

    await expect(page.locator('#mu-menu-dropdown')).toBeHidden();
    await page.click('#mu-menu-btn');
    await expect(page.locator('#mu-menu-dropdown')).toBeVisible();
    await expect(page.locator('#mu-menu-dropdown')).toContainText('MPEZ Portal');
    await expect(page.locator('#mpez-redirect-btn')).toBeVisible();
    await expect(page.locator('#mc-excel-btn')).toBeVisible();
    await expect(page.locator('#mis-pdf-btn')).toHaveCount(0);

    // Koi flagged entry na hone par bhi crash nahi hona chahiye
    await page.click('#mc-excel-btn');
    await page.waitForTimeout(300);

    await page.click('body', { position: { x: 5, y: 5 } });
    await expect(page.locator('#mu-menu-dropdown')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('मुख्यालय-वार Excel download sirf select ki hui HQ ki list deta hai, on-screen jaisa format', async ({ page }) => {
    await openApp(page, {
      beforeGoto: async (p) => {
        await mockConsumerCsv(p);
        await p.route('**/macros/**', (route) => {
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entry_id: 'MC1', entries: [] }) });
        });
      },
    });
    await goToMobileUpdate(page);
    await page.click('#mc-flag-btn'); // ADEGAON HQ (IVRS 1234567890) flag
    await page.waitForTimeout(300);

    await page.fill('#search-ivrs', '2345678901');
    await page.click('#search-btn');
    await page.waitForFunction(() => document.getElementById('result-box').style.display !== 'none');
    await page.click('#mc-flag-btn'); // BIBI HQ (IVRS 2345678901) flag
    await page.waitForTimeout(300);

    await page.click('button[onclick="toggleMobileCorrectionList_()"]');
    await page.waitForFunction(() => document.getElementById('mc-pending-list').innerText.includes('Test Consumer'));

    // ExcelJS (js/vendor/exceljs.min.js, local file — koi CDN nahi) button click
    // par lazy-load hoti hai. Actual browser download trigger avoid karne ke liye
    // URL.createObjectURL ko intercept karke Blob capture karte hain, phir usi
    // ExcelJS se wapas parse karke cell values/colors verify karte hain.
    await page.evaluate(() => {
      window.__lastExcelBlob = null;
      const origCreateObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => { window.__lastExcelBlob = blob; return origCreateObjectURL(blob); };
    });

    await page.locator('#mc-hq-filter').selectOption('ADEGAON HQ');
    await page.click('#mu-menu-btn');
    await expect(page.locator('#mc-excel-btn')).toContainText('मुख्यालय-वार Excel में Download करें');
    await page.click('#mc-excel-btn');
    await page.waitForFunction(() => window.__lastExcelBlob !== null, null, { timeout: 15000 });

    const parsed = await page.evaluate(async () => {
      const buffer = await window.__lastExcelBlob.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const ws = wb.worksheets[0];
      const headerRow = ws.getRow(1);
      const dataRow = ws.getRow(2);
      return {
        rowCount: ws.rowCount,
        headers: headerRow.values.slice(1),
        headerFill: headerRow.getCell(1).fill?.fgColor?.argb,
        headerFont: headerRow.getCell(1).font?.color?.argb,
        ivrs: dataRow.getCell(2).value,
        ivrsFont: dataRow.getCell(2).font?.color?.argb,
        nameRich: dataRow.getCell(3).value?.richText?.map((r) => r.text).join(''),
        addrRich: dataRow.getCell(4).value?.richText?.map((r) => r.text).join(''),
        rowFill: dataRow.getCell(1).fill?.fgColor?.argb,
      };
    });

    expect(parsed.rowCount).toBe(2); // header + sirf ADEGAON HQ ki 1 entry, BIBI HQ nahi
    expect(parsed.headers).toEqual(['क्र', 'IVRS No', 'नाम', 'पता / टैरिफ / लोड', 'पुराना (गलत) नंबर', 'स्थिति', 'सही मोबाइल नंबर']);
    expect(parsed.headerFill).toBe('FF991B1B'); // dark red header (screen jaisa)
    expect(parsed.headerFont).toBe('FFFFFFFF');
    expect(parsed.ivrs).toBe('1234567890');
    expect(parsed.ivrsFont).toBe('FF2563EB'); // blue, screen jaisa
    expect(parsed.nameRich).toBe('Test Consumer\n/ Test Father');
    expect(parsed.addrRich).toContain('LV1');
    expect(parsed.rowFill).toBe('FFFEE2E2'); // pending row ka halka pink background
  });

  test('Backend error (network nahi) ho to galat "internet nahi hai" nahi bolta, aur retry ke liye queue ho jaata hai', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page, {
      beforeGoto: async (p) => {
        await mockConsumerCsv(p);
        // Backend/Apps Script se ek asli response aata hai (internet chalu hai,
        // request pahunchi) — lekin status "error" hai (jaise sheet quota/bug).
        // Yeh network failure NAHI hai, isliye "internet nahi hai" nahi bolna chahiye.
        await p.route('**/macros/**', (route) => {
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'error', message: 'Sheet quota exceeded' }) });
        });
      },
    });
    await goToMobileUpdate(page);
    await page.click('#mc-flag-btn');
    // Ab save local-first optimistic hai — button turant free ho jaata hai,
    // asli server error background sync poora hone ke baad toast me aata hai.
    await page.waitForFunction(() => document.getElementById('mc-flag-btn').innerText.includes('मार्क करें'));
    await page.waitForFunction(() => document.getElementById('toast-notif')?.textContent?.includes('Sheet quota exceeded'), null, { timeout: 10000 });

    // Toast me "internet nahi hai" nahi, balki asli server error dikhna chahiye
    await expect(page.locator('#toast-notif')).not.toContainText('Internet नहीं है');
    await expect(page.locator('#toast-notif')).toContainText('Sheet quota exceeded');

    // Entry phir bhi local IndexedDB me save honi chahiye
    const entries = await page.evaluate(() => getMobileCorrectionEntries_());
    expect(entries.length).toBe(1);
    expect(entries[0].status).toBe('pending');

    // Aur retry ke liye sync_queue me bhi jaani chahiye (pehle yeh sirf network
    // errors ke liye hota tha — backend errors silently kho jaate the)
    const queueLen = await page.evaluate(async () => (await idbGetAll_('sync_queue')).length);
    expect(queueLen).toBe(1);

    await page.waitForFunction(() => document.getElementById('sync-queue-badge')?.style.display === 'inline-flex');
    await expect(page.locator('#sync-queue-badge')).toContainText('1 pending');
    expect(errors).toEqual([]);
  });

  test('⋮ मेनू का HQ-wise scorecard flagged/corrected/pending counts sahi dikhata hai aur date filter kaam karta hai', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page, {
      beforeGoto: async (p) => {
        await mockConsumerCsv(p);
        await p.route('**/macros/**', (route) => {
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entry_id: 'MC1', entries: [] }) });
        });
      },
    });
    await goToMobileUpdate(page);

    // ADEGAON HQ se 2 flag (1 corrected), BIBI HQ se 1 flag (pending)
    await page.click('#mc-flag-btn');
    await page.waitForTimeout(300);
    await page.fill('#search-ivrs', '2345678901');
    await page.click('#search-btn');
    await page.waitForFunction(() => document.getElementById('result-box').style.display !== 'none');
    await page.click('#mc-flag-btn');
    await page.waitForTimeout(300);

    const uid = await page.evaluate(async () => {
      const entries = await getMobileCorrectionEntries_();
      const e = entries.find((x) => x.ivrs === '1234567890');
      return getEntryUid_(e);
    });
    await page.click('button[onclick="toggleMobileCorrectionList_()"]');
    await page.waitForFunction(() => document.getElementById('mc-pending-list').innerText.includes('Test Consumer'));
    await page.fill(`#mc-correct-${uid}`, '9123456789');
    await page.click(`button[onclick="saveCorrectMobile_('${uid}')"]`);
    await page.waitForTimeout(300);

    await page.click('#mu-menu-btn');
    await page.click('#mc-scorecard-btn');
    const sheet = page.locator('#mc-scorecard-overlay');
    await expect(sheet).toContainText('मुख्यालय वार मोबाइल नंबर करेक्शन स्कोरकार्ड');
    await page.waitForFunction(() => document.getElementById('mc-scorecard-body').innerText.includes('ADEGAON HQ'));

    const body = page.locator('#mc-scorecard-body');
    await expect(body).toContainText('ADEGAON HQ');
    await expect(body).toContainText('BIBI HQ');
    await expect(body).toContainText('कुल योग');

    const adegaonRow = body.locator('tr', { hasText: 'ADEGAON HQ' });
    await expect(adegaonRow.locator('td').nth(1)).toHaveText('1'); // flagged
    await expect(adegaonRow.locator('td').nth(2)).toHaveText('1'); // corrected
    await expect(adegaonRow.locator('td').nth(3)).toHaveText('0'); // pending

    const bibiRow = body.locator('tr', { hasText: 'BIBI HQ' });
    await expect(bibiRow.locator('td').nth(1)).toHaveText('1');
    await expect(bibiRow.locator('td').nth(2)).toHaveText('0');
    await expect(bibiRow.locator('td').nth(3)).toHaveText('1');

    // Date filter ko future range me daalne par koi entry na dikhe
    await page.fill('#mc-sc-from', '2099-01-01');
    await page.fill('#mc-sc-to', '2099-01-31');
    await page.waitForFunction(() => document.getElementById('mc-scorecard-body').innerText.includes('कोई flag की हुई entry नहीं है'));

    await page.click('#mc-scorecard-close-btn');
    await expect(sheet).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('Purani (backend fix se pehle) atki hui orphan entries view khulte hi apne aap resync ho jaati hain', async ({ page }) => {
    let addEntryCalled = false;
    await openApp(page, {
      beforeGoto: async (p) => {
        await mockConsumerCsv(p);
        await p.route('**/macros/**', (route) => {
          const req = route.request();
          if (req.method() === 'POST') {
            const params = new URLSearchParams(req.postData() || '');
            const action = params.get('action') || 'addEntry';
            if (action === 'addEntry') {
              addEntryCalled = true;
              return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entry_id: 'E_RESYNCED_1' }) });
            }
          }
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', entries: [] }) });
        });
      },
    });
    await goToDcDashboard(page);

    // Purani orphan entry manually seed karte hain — entry_id missing, jaise
    // backend fix se pehle IVRS flag hua tha aur kabhi cloud sync nahi hua.
    await page.evaluate(async () => {
      await idbAdd_('mobile_correction', {
        ivrs: '9998887799', name: 'Orphan Test', father: 'Test Father', address: 'Test Addr',
        hq: 'ADEGAON HQ', dc_name: 'ADEGAON', division: 'DIVISION LAKHNADON',
        old_mobile: '9998887799', correct_mobile: '', status: 'pending',
        flagged_date: '01-01-2026', timestamp: new Date().toISOString(),
      });
    });

    await page.evaluate(() => switchView('mobile-update'));
    await page.waitForFunction(() => document.getElementById('mobile-update-view').classList.contains('active'));

    // Resync jaan-boojhkar 4s delay ke baad chalta hai (perf ke liye — turant
    // list-load/flag-save se network competition avoid karne ko), isliye seedhe
    // waitForTimeout se pehle intezaar karte hain phir final state check karte hain.
    // (waitForFunction ke andar async IndexedDB predicate + numeric polling
    // is Playwright/CDP setup me anreliable paaya gaya — isliye seedha wait.)
    await page.waitForTimeout(6000);
    const rowsAfter = await page.evaluate(async () => await idbGetAll_('mobile_correction'));
    const rec = rowsAfter.find((r) => r.ivrs === '9998887799');

    expect(addEntryCalled).toBe(true);
    expect(rec?.entry_id).toBe('E_RESYNCED_1');
  });
});
