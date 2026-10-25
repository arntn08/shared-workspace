/* Web push handlers, pulled into the generated service worker via workbox.importScripts */
self.addEventListener('push', (event) => {
  let d = {}
  try {
    d = event.data ? event.data.json() : {}
  } catch (e) {
    d = { title: 'Shared Workspace', body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(d.title || 'Shared Workspace', {
      body: d.body || '',
      tag: d.tag || undefined,
      icon: '/shared-workspace/icon-192.png',
      badge: '/shared-workspace/icon-192.png',
      data: { url: d.url || '/shared-workspace/#/notifications' }
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/shared-workspace/#/notifications'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          if ('navigate' in c) c.navigate(url)
          return c.focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
