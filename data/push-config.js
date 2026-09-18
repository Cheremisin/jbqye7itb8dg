/* ============================================================
   WEB PUSH (фоновые уведомления) — публичный ключ VAPID.
   Публичный ключ безопасно лежит в коде. ПРИВАТНЫЙ ключ сюда НЕ пишем:
   он задаётся секретом VAPID_PRIVATE_KEY в Edge Function (см. README).
   ============================================================ */
window.PUSH = {
  publicKey: 'BGFFq7LPFsWiTndhRu_COX0J5w_s-NRWWyVidjKptyvtGOwsiW5nBEfC5FWDhceZqmkWHJsELWsNfESN4rvOgSk',
  subject:   'mailto:education-portal@localhost',   // контакт для push-сервиса
};