#!/usr/bin/env node
/* Утренний дайджест в Телеграм: что горит сегодня, на неделе и в ближайшие две,
   плюс личные данные детей (напоминания, дедлайны регистраций, серия тренировок).
   Запускается GitHub Actions по расписанию (.github/workflows/digest.yml).

   Переменные окружения:
     TG_TOKEN  — токен бота от @BotFather
     TG_CHAT   — id чата (у групп отрицательный)
     SUPABASE_URL — адрес проекта, например https://xxxx.supabase.co
     SUPABASE_SERVICE_KEY — секретный ключ service_role (только в Secrets, не в код!)
     DRY_RUN=1 — не отправлять, только напечатать сообщение
     FAKE_DATE=2026-09-15 — прогнать на другую дату (для проверки)                */

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const win = {};
const load = f => new Function('window', fs.readFileSync(path.join(ROOT,'data',f),'utf8'))(win);
load('config.js'); load('deadlines.js'); load('tasks.js');

/* имена */
const N = win.NAMES || {u:{},y:{}};
const TOK = {
  '{{U}}':N.u.nom||'Старшая','{{Ug}}':N.u.gen||'Старшей','{{Ud}}':N.u.dat||'Старшей',
  '{{Ua}}':N.u.acc||'Старшую','{{Ui}}':N.u.ins||'Старшей','{{Up}}':N.u.pre||'Старшей',
  '{{Y}}':N.y.nom||'Младший','{{Yg}}':N.y.gen||'Младшего','{{Yd}}':N.y.dat||'Младшему',
  '{{Ya}}':N.y.acc||'Младшего','{{Yi}}':N.y.ins||'Младшим','{{Yp}}':N.y.pre||'Младшем',
};
const RE = /\{\{(U|Ug|Ud|Ua|Ui|Up|Y|Yg|Yd|Ya|Yi|Yp)\}\}/g;
const nm = s => typeof s === 'string' ? s.replace(RE, m => TOK[m] ?? m) : s;
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

/* сегодня по Москве */
const now = process.env.FAKE_DATE
  ? new Date(process.env.FAKE_DATE + 'T09:00:00+03:00')
  : new Date();
const msk = new Date(now.getTime() + (3*60 + now.getTimezoneOffset()) * 60000);
const today = new Date(msk.getFullYear(), msk.getMonth(), msk.getDate());
const iso = d => d.toISOString().slice(0,10);
const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const days = s => Math.round((parse(s) - today) / 864e5);
const isMonday = today.getDay() === 1;

const MON = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const fmt = s => { const d = parse(s); return `${d.getDate()} ${MON[d.getMonth()]}`; };
const KID = {u:nm('{{U}}'), y:nm('{{Y}}')};
const SITE = 'https://cheremisin.github.io/jbqye7itb8dg/';

/* строка одного события */
const line = d => {
  const n = days(d.d);
  const who = (d.who||[]).map(w => KID[w]).filter(Boolean).join(' и ');
  const when = n === 0 ? 'сегодня' : n === 1 ? 'завтра' : `через ${n} дн. · ${fmt(d.d)}`;
  const t = esc(nm(d.t));
  const title = d.url ? `<a href="${esc(d.url)}">${t}</a>` : `<b>${t}</b>`;
  return `• ${title}\n  <i>${when}${who ? ' · ' + esc(who) : ''}${d.approx ? ' · дата ориентировочная' : ''}</i>`;
};

const all = (win.DEADLINES||[]).slice().sort((a,b) => a.d < b.d ? -1 : 1);
const inRange = (lo, hi) => all.filter(d => { const n = days(d.d); return n >= lo && n <= hi; });

const todayL = inRange(0, 0);
const week   = inRange(1, 7);
const soon   = inRange(8, 14);

/* задания текущей учебной недели (только по понедельникам) */
function weekTasks(){
  const START = parse('2026-09-01');
  const wk = Math.floor((today - START) / (7*864e5)) + 1;
  if(wk < 1 || wk > 8 || !win.TASKS) return null;
  const out = [];
  for(const key of ['younger','elder_core','elder_a','elder_b']){
    const T = win.TASKS[key]; if(!T) continue;
    const w = (T.weeks||[]).find(x => x.n === wk); if(!w) continue;
    out.push(`• <b>${esc(nm(T.title))}</b> — ${esc(nm(w.topic))}`);
  }
  return out.length ? {wk, out} : null;
}

/* ---------- личные данные детей из Supabase (reminders/registrations/progress) ---------- */
async function personalBlock(){
  const SU = process.env.SUPABASE_URL, SK = process.env.SUPABASE_SERVICE_KEY;
  if(!SU || !SK) return null;
  const base = SU.replace(/\/$/,'') + '/rest/v1/';
  const H = { 'apikey': SK, 'Authorization': 'Bearer ' + SK, 'Content-Type': 'application/json' };
  const get = async p => {
    const r = await fetch(base + p, { headers: H });
    if(!r.ok) throw new Error('supabase ' + r.status + ' ' + p.slice(0,60));
    return r.json();
  };
  const timeFmt = isoStr => {
    const d = new Date(isoStr);
    const m = new Date(d.getTime() + (3*60 + d.getTimezoneOffset())*60000);
    return String(m.getHours()).padStart(2,'0') + ':' + String(m.getMinutes()).padStart(2,'0');
  };

  const kids = await get('kid_profiles?select=id,name,cls&role=eq.kid&order=created_at.asc');
  if(!kids || !kids.length) return null;

  const nowIso = new Date().toISOString();
  const horizon = new Date(Date.now() + 2*864e5).toISOString();
  const parts = [];
  let any = false;

  for(const k of kids){
    const notes = [];
    try{
      const rem = await get(`reminders?select=title,remind_at,kind&kid_id=eq.${k.id}&done_at=is.null&remind_at=gte.${encodeURIComponent(nowIso)}&remind_at=lte.${encodeURIComponent(horizon)}&order=remind_at.asc`);
      (rem || []).forEach(r => {
        const kind = r.kind==='registration' ? '📝 регистрация' : r.kind==='event' ? '🗓 событие' : r.kind==='training' ? '💪 тренировка' : '⏰ напоминание';
        notes.push(`${kind} — ${esc(r.title)}, сегодня в ${timeFmt(r.remind_at)}`);
      });
      const reg = await get(`registrations?select=title,deadline&kid_id=eq.${k.id}&done_at=is.null&deadline=not.is.null&order=deadline.asc`);
      (reg || []).forEach(r => {
        const n = days(r.deadline);
        if(n >= 0 && n <= 14 && !notes.some(x => x.includes(esc(r.title))))
          notes.push(`📝 ${esc(r.title)} — запись до ${fmt(r.deadline)}${n===0?' (сегодня)':''}`);
      });
      const st = await get(`progress?select=value&kid_id=eq.${k.id}&path=eq.agent.streak`);
      const v = st && st[0] && st[0].value;
      if(v && v.days >= 2) notes.push(`🔥 тренируется ${v.days} ${v.days < 5 ? 'дня' : 'дней'} подряд`);
    }catch(e){ console.warn('personal: ' + e.message); }
    if(notes.length){ any = true; parts.push(`<b>${esc(k.name || 'Ребёнок')}</b>\n` + notes.slice(0, 8).join('\n')); }
  }
  return any ? '👨‍👩‍👧 <b>Личное</b>\n' + parts.join('\n\n') : null;
}

/* сборка сообщения */
const parts = [];
const head = isMonday ? '🗓 <b>Неделя впереди</b>' : '☀️ <b>Доброе утро</b>';
parts.push(`${head} · ${fmt(iso(today))}`);

if(todayL.length){
  parts.push('\n🔴 <b>Сегодня</b>\n' + todayL.map(line).join('\n'));
}
if(week.length){
  parts.push('\n🟡 <b>На этой неделе</b>\n' + week.map(line).join('\n'));
}
if(isMonday && soon.length){
  parts.push('\n🟢 <b>Через одну-две недели</b>\n' + soon.map(line).join('\n'));
}
if(isMonday){
  const wt = weekTasks();
  if(wt) parts.push(`\n📚 <b>Задания недели ${wt.wk}</b>\n` + wt.out.join('\n'));
}

const nothing = !todayL.length && !week.length && !(isMonday && soon.length);
if(nothing){
  const next = all.find(d => days(d.d) > 0);
  parts.push('\nБлижайшие две недели чистые.' +
    (next ? ` Следующая дата — ${fmt(next.d)}: ${esc(nm(next.t))}.` : ''));
}
const footer = `\n<a href="${SITE}index.html">Портал</a> · <a href="${SITE}my.html">Мой прогресс</a> · <a href="${SITE}olympiads.html#calendar">весь календарь</a>`;

/* отправка */
(async () => {
  let personal = null;
  try{ personal = await personalBlock(); }catch(e){ console.warn('personalBlock: ' + e.message); }
  const text = parts.join('\n') + (personal ? '\n\n' + personal : '\n') + footer;

  if(process.env.DRY_RUN === '1' || !process.env.TG_TOKEN){
    console.log('--- DRY RUN, сообщение не отправлено ---\n');
    console.log(text.replace(/<[^>]+>/g,''));
    console.log('\n--- длина:', text.length, 'символов ---');
    if(!process.env.TG_TOKEN && process.env.DRY_RUN !== '1'){
      console.error('\nTG_TOKEN не задан — нечего отправлять.');
      process.exit(1);
    }
    return;
  }
  // не будить семью в тихий день: если ничего нет и это не понедельник — молчим
  // (кроме ручного запуска с FORCE_SEND=true — для проверки)
  if(nothing && !isMonday && process.env.FORCE_SEND !== 'true'){
    console.log('Ничего срочного и не понедельник — сообщение не отправляем.');
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      chat_id: process.env.TG_CHAT,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  const j = await res.json();
  if(!j.ok){ console.error('Telegram API вернул ошибку:', JSON.stringify(j)); process.exit(1); }
  console.log('Отправлено, message_id =', j.result.message_id);
})();