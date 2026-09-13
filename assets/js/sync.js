/* Синхронизация прогресса между устройствами.
   Включается, только если заполнен data/sync-config.js — иначе портал
   работает как раньше, полностью на localStorage.

   Модель слияния: у каждого изменённого пути свой момент времени.
   При встрече двух версий по каждому пути побеждает более поздняя запись.
   Поэтому отметка, поставленная ребёнком на телефоне, не затирает
   заметку, сделанную в это же время на ноутбуке. */

(function(){
  const CFG = window.SYNC || {};
  const ON = !!(CFG.url && CFG.key && CFG.family);
  const TS_KEY = 'edu-portal-ts';
  const SEEN_KEY = 'edu-portal-seen';

  /* ---------- работа с путями ---------- */
  const getPath = (obj, path) => {
    let v = obj;
    for(const k of path.split('.')){ if(v == null || typeof v !== 'object') return undefined; v = v[k]; }
    return v;
  };
  const setPath = (obj, path, val) => {
    const p = path.split('.');
    let v = obj;
    for(let i = 0; i < p.length - 1; i++){
      if(typeof v[p[i]] !== 'object' || v[p[i]] === null) v[p[i]] = {};
      v = v[p[i]];
    }
    v[p[p.length-1]] = val;
  };

  /* ---------- слияние: по каждому пути выигрывает более свежая запись ---------- */
  function merge(localDoc, localTs, remoteDoc, remoteTs){
    const doc = JSON.parse(JSON.stringify(localDoc || {}));
    const ts  = Object.assign({}, localTs || {});
    for(const path of Object.keys(remoteTs || {})){
      const rt = remoteTs[path], lt = (localTs || {})[path] || 0;
      if(rt > lt){
        const val = getPath(remoteDoc, path);
        if(val !== undefined){ setPath(doc, path, val); ts[path] = rt; }
      }
    }
    return {doc, ts};
  }
  window.__syncMerge = merge;   // для тестов

  if(!ON) return;

  /* ---------- отметки времени ---------- */
  const loadTs = () => { try{ return JSON.parse(localStorage.getItem(TS_KEY)) || {}; }catch(e){ return {}; } };
  const saveTs = t => { try{ localStorage.setItem(TS_KEY, JSON.stringify(t)); }catch(e){} };

  document.addEventListener('store:change', e => {
    const t = loadTs(); t[e.detail.path] = Date.now(); saveTs(t);
    schedulePush();
  });

  /* ---------- сеть ---------- */
  const API = CFG.url.replace(/\/$/,'') + '/rest/v1/family_state';
  const H = {
    'apikey': CFG.key,
    'Authorization': 'Bearer ' + CFG.key,
    'Content-Type': 'application/json',
  };

  async function pull(){
    const r = await fetch(`${API}?id=eq.${encodeURIComponent(CFG.family)}&select=doc,ts`, {headers:H});
    if(!r.ok) throw new Error('pull ' + r.status);
    const rows = await r.json();
    return rows[0] || null;
  }

  async function push(doc, ts){
    const r = await fetch(API, {
      method: 'POST',
      headers: Object.assign({}, H, {'Prefer': 'resolution=merge-duplicates'}),
      body: JSON.stringify({id: CFG.family, doc, ts, updated_at: new Date().toISOString()}),
    });
    if(!r.ok) throw new Error('push ' + r.status + ' ' + (await r.text()).slice(0,140));
  }

  let timer = null, busy = false;
  function schedulePush(){
    clearTimeout(timer);
    timer = setTimeout(() => sync().catch(err => status('нет связи: ' + err.message, 'bad')), 1500);
  }

  function status(text, kind){
    document.querySelectorAll('[data-sync-status]').forEach(n => {
      n.textContent = text;
      n.className = 'b ' + (kind || '');
    });
  }

  async function sync(){
    if(busy) return;
    busy = true;
    try{
      status('синхронизация…');
      const remote = await pull();
      const localDoc = Store.load(), localTs = loadTs();
      const {doc, ts} = merge(localDoc, localTs, remote && remote.doc, remote && remote.ts);

      const changed = JSON.stringify(doc) !== JSON.stringify(localDoc);
      if(changed){
        Store._d = doc; Store.save(); saveTs(ts);
        document.dispatchEvent(new CustomEvent('sync:pulled'));
      } else { saveTs(ts); }

      await push(doc, ts);
      try{ localStorage.setItem(SEEN_KEY, String(Date.now())); }catch(e){}
      status('сохранено ✓', 'ok');
      if(changed) setTimeout(() => location.reload(), 400);
    } finally { busy = false; }
  }

  window.Sync = {on:true, now: sync, status};
  window.addEventListener('load', () => sync().catch(err => status('нет связи: ' + err.message, 'bad')));
  window.addEventListener('online', () => sync().catch(()=>{}));
})();
