/* GoldMeta push click handler — opens the relevant plan without exposing tokens. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const planId = data.planId || data.decisionId || "";
  const targetUrl = planId ? `/?planId=${encodeURIComponent(String(planId))}` : "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true
      });
      for (const client of allClients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            await client.navigate(targetUrl);
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "GoldMeta", body: event.data ? event.data.text() : "New plan update" };
  }
  const title = payload.title || "GoldMeta";
  const options = {
    body: payload.body || "Open GoldMeta to review the current plan.",
    data: payload.data || {},
    icon: "/icons/pwa-192x192.png",
    badge: "/icons/pwa-192x192.png"
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
