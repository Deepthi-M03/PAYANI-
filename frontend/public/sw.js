/* PAYANI service worker: shows push notifications and opens the linked page.
   It does not cache API responses, so stale journey data is never shown offline. */
self.addEventListener("push", (event) => {
  let data = { title: "PAYANI", body: "You have a journey update.", url: "/app/pulse" };
  try {
    data = { ...data, ...event.data.json() };
  } catch (_) {
    /* keep defaults */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/app/pulse";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
