// Seoni Circle App — pure cache-first service worker (v3.1)
// App ki apni files (JS/CSS/HTML) ek baar cache hone ke baad seedhe cache se
// milti hain — koi background revalidation nahi (pehle har request par bhi
// ek chupchaap network refetch chalti thi, jisse data cost bewajah badhta
// tha). Naya version aane par App Update Banner (index.html) hi ise pakadta
// hai aur "अभी अपडेट करें" dabane par poora cache ek saath force-refresh
// hota hai (neeche FORCE_REFRESH message handler). Apps Script/Google Sheets
// jaisi external API calls yahaan chhuti nahi — wo apni jagah (app code me)
// alag se handle hoti hain, isliye humesha live/fresh rehti hain.
//
// BUG FIX (v3.1): FORCE_REFRESH pehle sirf un URLs ko dobara fetch karta tha
// jo cache me PEHLE SE maujood the (c.keys()) — isliye jab koi bilkul NAYI
// file (jaise ek naya module js/permanent-disconnect.js) kisi update me
// jud-ti thi, wo kabhi bhi refresh se cache nahi ho paati thi (kyunki uski
// koi purani cache-key hi nahi hoti thi), aur us file ka feature silently
// tuta hua dikhta tha — user ko app delete/reinstall karna padta tha. Ab
// FORCE_REFRESH poora cache clear karke dobara CORE se seed karta hai, taaki
// har naya/badla hua asset agli baar seedhe network se aa jaaye. CACHE naam
// bhi is baar badla hai — isse maujooda (already-broken) users bhi bina
// kuch dabaye, sirf agli baar app kholte hi apne-aap theek ho jaayenge
// (browser SW script ka byte-diff khud detect karke naya SW activate karta
// hai, jo purana-naam-wala cache activate hote hi delete kar deta hai).
const CACHE = "seoni-circle-v3.1";
const CORE = ["./", "./index.html", "./manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// App-update check/button explicitly {cache:"reload"} fetch karte hain — usse
// SW cache bilkul bypass karke seedhe network se fresh jawab milta hai, taaki
// version check aur "अभी अपडेट करें" hamesha bharosemand rahein.
self.addEventListener("message", (e) => {
  if (e.data?.type !== "FORCE_REFRESH") return;
  e.waitUntil(
    caches.delete(CACHE)
      .then(() => caches.open(CACHE))
      .then((c) => c.addAll(CORE))
      .catch(() => {})
      .then(() => { e.source?.postMessage({ type: "FORCE_REFRESH_DONE" }); })
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // POST (data submit) ko kabhi intercept nahi karte
  if (req.cache === "reload") return; // explicit force-fresh request — SW cache bypass, seedha network

  let url;
  try {
    url = new URL(req.url);
  } catch (_) {
    return;
  }
  if (url.origin !== self.location.origin) return; // external API calls (Apps Script/Sheets) SW ke bahar

  // Query string (jaise cache-busting ?t=...) hata kar normalize karte hain,
  // taaki wahi file baar-baar alag key se cache me duplicate hokar storage na bhare.
  const cacheKey = url.origin + url.pathname;

  e.respondWith(
    caches.match(cacheKey).then((cached) => {
      // Cache me mil gaya to seedha wahi de do — koi background refetch nahi
      // (data cost bachane ke liye). Fresh content sirf Update Banner ke
      // FORCE_REFRESH se hi aati hai.
      if (cached) return cached;

      // Cache me nahi mila (pehli baar) — network se laao aur cache kar lo.
      return fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(cacheKey, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
