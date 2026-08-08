/* One-time GoldMeta UI cache migration for premium shell deploys.
 * Deletes only known obsolete GoldMeta / Workbox UI precaches.
 * Does not touch cookies, IndexedDB, localStorage, or unrelated caches.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      if (!self.caches?.keys) return;
      const keys = await self.caches.keys();
      const obsolete = keys.filter((key) =>
        /goldmeta-hold-lean|goldmeta-v[0-4]|workbox-precache.*hold-lean|goldmeta-autotrade-hardening/i.test(
          key
        )
      );
      await Promise.all(obsolete.map((key) => self.caches.delete(key)));
    })()
  );
});
