/* ============================================================
   send-reminders — фоновая рассылка Web Push-уведомлений.

   Вызывается Supabase pg_cron → pg_net каждые 10 минут.
   Находит активные напоминания (remind_at в ближайшие 2 часа,
   не отмеченные выполненными) и отправляет уведомление на все
   подписки ребёнка из таблицы push_subscriptions.

   Секреты функции (Edge Functions → Secrets):
     VAPID_PUBLIC_KEY  — публичный VAPID (в data/push-config.js)
     VAPID_PRIVATE_KEY — приватный VAPID (сгенерирован вместе с публичным)
     VAPID_SUBJECT     — mailto: для push-сервиса
     CRON_SECRET       — случайная строка; тот же X-Cron-Secret в SQL-задании

   Код запускается в Supabase Edge Functions (Deno). web-push берётся
   из npm, поэтому код работает как есть при вставке в Dashboard.
   ============================================================ */
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CRON_SECRET  = Deno.env.get('CRON_SECRET') || '';

const VAPID = {
  publicKey:  Deno.env.get('VAPID_PUBLIC_KEY') || '',
  privateKey: Deno.env.get('VAPID_PRIVATE_KEY') || '',
  subject:    Deno.env.get('VAPID_SUBJECT') || 'mailto:education-portal@localhost',
};
webpush.setVapidDetails(VAPID.subject, VAPID.publicKey, VAPID.privateKey);

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

Deno.serve(async (req) => {
  if(req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  // защита от посторонних: проверяем секрет
  if(CRON_SECRET && req.headers.get('x-cron-secret') !== CRON_SECRET){
    return new Response('forbidden', { status: 403, headers: cors });
  }

  try{
    const now = new Date();
    const horizon = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    // нижняя граница: просроченное больше суток назад уже неактуально,
    // а без неё старые напоминания уходили бы в телефон бесконечно
    const floor = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const reminders = await rest(
      `reminders?select=id,kid_id,title,kind&done_at=is.null&sent_at=is.null` +
      `&remind_at=lte.${encodeURIComponent(horizon.toISOString())}` +
      `&remind_at=gte.${encodeURIComponent(floor.toISOString())}` +
      `&order=remind_at.asc&limit=200`);

    let sent = 0, skipped = 0;
    for(const r of reminders || []){
      const subs = await rest(`push_subscriptions?select=endpoint,keys&kid_id=eq.${r.kid_id}`);
      // некому отправлять — всё равно закрываем, иначе будет висеть вечно
      if(!subs || !subs.length){ await markSent(r.id); skipped++; continue; }
      const payload = JSON.stringify({
        title: r.kind === 'registration' ? '📝 Регистрация' : r.kind === 'event' ? '🗓 Событие' : r.kind === 'training' ? '💪 Тренировка' : '⏰ Напоминание',
        body: r.title,
        url: 'my.html',
      });
      for(const sub of subs){
        try{
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, { TTL: 3600 });
          sent++;
        }catch(e){
          // 404/410 — подписка недействительна, чистим
          if(e && (e.statusCode === 404 || e.statusCode === 410)){
            await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' });
          }
          skipped++;
        }
      }
      // отправили (или попытались по всем подпискам) — закрываем напоминание,
      // чтобы следующий запуск планировщика его уже не взял
      await markSent(r.id);
    }
    return new Response(JSON.stringify({ ok: true, sent, skipped, reminders: (reminders||[]).length }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }catch(err){
    return new Response(JSON.stringify({ ok: false, error: String(err && err.message || err) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});

/* пометить напоминание отправленным — ровно один push на напоминание */
async function markSent(id){
  try{
    await rest(`reminders?id=eq.${id}`, { method: 'PATCH', body: { sent_at: new Date().toISOString() } });
  }catch(e){ /* не смогли пометить — не роняем всю рассылку */ }
}

/* мелкий REST-клиент к PostgREST с правами service_role */
async function rest(path, opts = {}){
  const method = opts.method || 'GET';
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: 'Bearer ' + SERVICE_KEY,
    'Content-Type': 'application/json',
  };
  // return=minimal только для записи: на GET это заголовок не для того
  if(method !== 'GET') headers.Prefer = 'return=minimal';
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if(!res.ok) throw new Error('rest ' + res.status + ' ' + path.slice(0, 60));
  if(method !== 'GET') return null;
  return res.json();
}