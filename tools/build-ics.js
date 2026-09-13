#!/usr/bin/env node
/* Собирает edu.ics из data/deadlines.js.
   Запуск: node tools/build-ics.js
   Автоматически запускается GitHub Actions при каждом изменении data/deadlines.js. */

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* ---- загружаем data/*.js, подсовывая им window ---- */
const win = {};
const load = f => {
  const code = fs.readFileSync(path.join(ROOT, 'data', f), 'utf8');
  new Function('window', code)(win);
};
load('config.js');
load('deadlines.js');

/* ---- подстановка имён (та же логика, что в assets/js/app.js) ---- */
const N = win.NAMES || {u:{}, y:{}};
const TOK = {
  '{{U}}':  N.u.nom||'Старшая', '{{Ug}}': N.u.gen||'Старшей', '{{Ud}}': N.u.dat||'Старшей',
  '{{Ua}}': N.u.acc||'Старшую', '{{Ui}}': N.u.ins||'Старшей', '{{Up}}': N.u.pre||'Старшей',
  '{{Y}}':  N.y.nom||'Младший', '{{Yg}}': N.y.gen||'Младшего', '{{Yd}}': N.y.dat||'Младшему',
  '{{Ya}}': N.y.acc||'Младшего', '{{Yi}}': N.y.ins||'Младшим', '{{Yp}}': N.y.pre||'Младшем',
};
const RE = /\{\{(U|Ug|Ud|Ua|Ui|Up|Y|Yg|Yd|Ya|Yi|Yp)\}\}/g;
const nm = s => typeof s === 'string' ? s.replace(RE, m => TOK[m] ?? m) : s;

/* ---- утилиты формата iCalendar (RFC 5545) ---- */
const esc = s => String(s)
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
  .replace(/\r?\n/g, '\\n');

// строки длиннее 75 октетов надо переносить; считаем в байтах UTF-8
function fold(line) {
  const buf = Buffer.from(line, 'utf8');
  if (buf.length <= 73) return line;
  const out = [];
  let cur = Buffer.alloc(0);
  for (const ch of Array.from(line)) {
    const b = Buffer.from(ch, 'utf8');
    const limit = out.length === 0 ? 73 : 72;
    if (cur.length + b.length > limit) { out.push(cur.toString('utf8')); cur = Buffer.alloc(0); }
    cur = Buffer.concat([cur, b]);
  }
  if (cur.length) out.push(cur.toString('utf8'));
  return out.join('\r\n ');
}

const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}` +
                   `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const localDT = (iso, hh, mm) => iso.replace(/-/g, '') + `T${pad(hh)}${pad(mm)}00`;

const KID = {u: nm('{{U}}'), y: nm('{{Y}}')};
const SITE = 'https://cheremisin.github.io/jbqye7itb8dg/';
const now = new Date();

/* ---- события ---- */
const lines = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Semejnyj obrazovatelnyj portal//Deadlines//RU',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'X-WR-CALNAME:Образование — дедлайны',
  'X-WR-CALDESC:Олимпиады, кружки, лагеря и подача документов. Обновляется автоматически.',
  'X-WR-TIMEZONE:Europe/Moscow',
  'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
  'X-PUBLISHED-TTL:PT6H',
  /* Москва: UTC+3 круглый год, перевода часов нет с 2014 */
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Moscow',
  'BEGIN:STANDARD',
  'DTSTART:20141026T010000',
  'TZOFFSETFROM:+0400',
  'TZOFFSETTO:+0300',
  'TZNAME:MSK',
  'END:STANDARD',
  'END:VTIMEZONE',
];

const deadlines = (win.DEADLINES || []).slice().sort((a, b) => a.d < b.d ? -1 : 1);
let n = 0;

for (const d of deadlines) {
  const who = (d.who || []).map(w => KID[w]).filter(Boolean).join(' и ');
  const star = d.approx ? ' (дата ориентировочная)' : '';
  const title = `${d.hot ? '❗ ' : ''}${nm(d.t)}${who ? ' — ' + who : ''}`;

  const body = [
    nm(d.s || ''),
    d.approx ? '\nДата по прошлому сезону — официальную объявляют позже, проверьте на сайте организатора.' : '',
    d.url ? '\nСайт: ' + d.url : '',
    '\nПортал: ' + SITE + 'index.html',
  ].filter(Boolean).join('');

  // событие 10:00–10:30 по Москве в день дедлайна
  const uid = `${d.d.replace(/-/g,'')}-${(++n)}@jbqye7itb8dg`;

  lines.push(
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;TZID=Europe/Moscow:${localDT(d.d, 10, 0)}`,
    `DTEND;TZID=Europe/Moscow:${localDT(d.d, 10, 30)}`,
    fold(`SUMMARY:${esc(title + star)}`),
    fold(`DESCRIPTION:${esc(body)}`),
    d.url ? fold(`URL:${esc(d.url)}`) : null,
    d.tag ? fold(`CATEGORIES:${esc(d.tag)}`) : null,
    'TRANSP:TRANSPARENT',
    'STATUS:CONFIRMED',
    // напоминания: за неделю и накануне, оба в 10:00
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER;RELATED=START:-P7D',
    fold(`DESCRIPTION:${esc('Через неделю: ' + title)}`),
    'END:VALARM',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER;RELATED=START:-P1D',
    fold(`DESCRIPTION:${esc('Завтра: ' + title)}`),
    'END:VALARM',
    'END:VEVENT',
  );
}

lines.push('END:VCALENDAR');

const ics = lines.filter(Boolean).join('\r\n') + '\r\n';
fs.writeFileSync(path.join(ROOT, 'edu.ics'), ics, 'utf8');
console.log(`edu.ics собран: ${n} событий, ${(Buffer.byteLength(ics)/1024).toFixed(1)} КБ`);
