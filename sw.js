/* Mis Deberes — service worker
   - Guarda la app para que abra sin internet.
   - Al tocar una notificación, abre (o enfoca) la app en la línea de tiempo.
   - periodicsync: si el navegador lo permite (Chrome Android con la app instalada),
     revisa en segundo plano y muestra el recordatorio general / alertas de entrega. */
const CACHE = "misdeberes-app-v1";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-badge.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("misdeberes-app-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("./index.html")))
  );
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./#timeline", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) { if ("focus" in c) { c.navigate && c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});

/* ---------- Revisión en segundo plano ---------- */
const pad = n => String(n).padStart(2, "0");
const parseLocal = s => { const [a, b] = s.split("T"); const [y, m, d] = a.split("-").map(Number); const [h, mi] = (b || "23:59").split(":").map(Number); return new Date(y, m - 1, d, h, mi); };
async function backgroundCheck() {
  const cache = await caches.open("misdeberes-state");
  const r = await cache.match("state.json"); if (!r) return;
  const st = await r.json();
  const now = new Date(), last = new Date(st.ultimoChequeo || now - 3 * 36e5);
  // alertas de entrega pendientes
  for (const t of st.tareas) {
    const due = parseLocal(t.fecha);
    for (const off of st.ajustes.alertas || []) {
      const at = new Date(due - off * 6e4);
      if (!t.avisadas.includes(off) && at <= now && due > now && now - at < 2 * 36e5) {
        t.avisadas.push(off);
        await self.registration.showNotification(`⏰ ${t.materia}: ${t.titulo}`, { body: `Se entrega hasta las ${pad(due.getHours())}:${pad(due.getMinutes())}.`, tag: "due-" + t.id, icon: "icon-192.png", badge: "icon-badge.png", data: { url: "./#timeline" } });
      }
    }
  }
  // recordatorio general si tocaba uno desde la última revisión
  const hs = st.generales || [];
  let toca = false;
  for (let d = new Date(last.getFullYear(), last.getMonth(), last.getDate()); d <= now; d.setDate(d.getDate() + 1))
    for (const m of hs) { const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(m / 60), m % 60); if (t > last && t <= now) toca = true; }
  if (toca && st.resumen) await self.registration.showNotification(st.resumen.title, { body: st.resumen.body, tag: "general", icon: "icon-192.png", badge: "icon-badge.png", data: { url: "./#timeline" } });
  st.ultimoChequeo = now.getTime();
  await cache.put("state.json", new Response(JSON.stringify(st), { headers: { "Content-Type": "application/json" } }));
}
self.addEventListener("periodicsync", e => { if (e.tag === "deberes") e.waitUntil(backgroundCheck()); });
