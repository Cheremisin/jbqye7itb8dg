/* ============================================================
   ПОРТАЛ: авторизация, роли и персональный прогресс  (этап 1)

   - если в data/sync-config.js заполнены url и key — подключается
     Supabase (Auth + БД); иначе портал работает как раньше;
   - кнопка «Вход» в шапке: родитель входит своей почтой,
     дети — своими аккаунтами (их создаёт родитель);
   - родитель видит прогресс всех детей, ребёнок — только свой
     (защита — RLS самой БД);
   - прогресс синхронизируется по путям (как sync.js): каждая
     запись 'tasks.…' — отдельная строка в таблице progress с меткой
     времени; при встрече версий побеждает более свежая запись.
   ============================================================ */
(function(){
  const CFG = window.SYNC || {};
  const ON  = !!(CFG.url && CFG.key);
  const warn = m => console.warn('portal: ' + m);

  let sb = null;
  try {
    if (ON && window.supabase && window.supabase.createClient) {
      sb = window.supabase.createClient(CFG.url, CFG.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    }
  } catch(e) { warn('init: ' + e.message); }

  const READY = !!sb;

  const state = {
    session: null,   // сессия supabase
    me: null,        // профиль текущего пользователя
    kids: [],        // профили детей (для родителя)
    ctx: null,       // активная персона: {id, name, cls, role}
  };

  /* ---------- утилиты ---------- */
  const $  = (s,r=document)=>r.querySelector(s);
  const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
  const el = (t,a={},...kids)=>{
    const n=document.createElement(t);
    for(const [k,v] of Object.entries(a)){
      if(k==='class') n.className=v;
      else if(k==='html') n.innerHTML=v;
      else if(k.startsWith('on')) n.addEventListener(k.slice(2),v);
      else if(v!==null&&v!==false&&v!==undefined) n.setAttribute(k,v);
    }
    kids.flat().forEach(c=>{ if(c==null||c===false) return; n.append(c.nodeType?c:document.createTextNode(String(c))); });
    return n;
  };
  // защита от зависших запросов: любая операция с Supabase не должна висеть вечно
  const withTimeout = (p, ms = 15000) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('Сервер Supabase не ответил за 15 секунд — проверьте, что проект разбужен, и повторите.')), ms)),
  ]);
  const loadTs = () => { try{ return JSON.parse(localStorage.getItem('edu-portal-ts'))||{}; }catch(e){ return {}; } };
  const saveTs = t  => { try{ localStorage.setItem('edu-portal-ts', JSON.stringify(t)); }catch(e){} };
  const setPath = (obj,path,val)=>{ const p=path.split('.'); let v=obj;
    for(let i=0;i<p.length-1;i++){ if(typeof v[p[i]]!=='object'||v[p[i]]===null) v[p[i]]={}; v=v[p[i]]; } v[p[p.length-1]]=val; };
  const esc = s => String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  /* ================= сессия и профили ================= */

  async function loadProfiles(){
    if(!state.session) return;
    const { data } = await sb.from('kid_profiles')
      .select('id, role, name, cls, parent')
      .or(`id.eq.${state.session.user.id},parent.eq.${state.session.user.id}`);
    const rows = data || [];
    state.me = rows.find(r=>r.id===state.session.user.id) || null;
    state.kids = rows.filter(r=>r.role==='kid' && r.parent===state.session.user.id);
    if(state.me && state.me.role==='kid'){
      state.ctx = {id:state.me.id, name:state.me.name||'Я', cls:state.me.cls||'', role:'kid'};
    } else if(state.me){
      const first = state.kids[0];
      state.ctx = first
        ? {id:first.id, name:first.name||'Ребёнок', cls:first.cls||'', role:'kid'}
        : {id:state.me.id, name:'Родитель', cls:'', role:'parent'};
    }
    return rows;
  }

  /* ================= прогресс: pull / push ================= */

  // Объединить удалённые строки в локальный Store: по каждому пути новее — сильнее.
  function mergeRows(rows){
    const remoteDoc = {}, remoteTs = {};
    for(const r of rows){ remoteTs[r.path] = r.ts; setPath(remoteDoc, r.path, r.value); }
    const doc = Store.load(), ts = loadTs();
    let changed = false, outDoc = doc, outTs = ts;

    if(window.__syncMerge){                       // используем проверенное слияние sync.js
      const m = window.__syncMerge(doc, ts, remoteDoc, remoteTs);
      changed = JSON.stringify(m.doc) !== JSON.stringify(doc);
      outDoc = m.doc; outTs = m.ts;
    } else {                                      // локальная запасная реализация
      for(const [path,rt] of Object.entries(remoteTs)){
        const lt = ts[path] || 0;
        if(rt > lt){ const v = remoteDoc[path]; if(v!==undefined){ setPath(doc,path,v); ts[path]=rt; changed=true; } }
      }
    }
    if(changed){ Store._d = outDoc; Store.save(); saveTs(outTs); }
    return changed;
  }

  async function pullProgress(){
    if(!state.ctx || !sb) return false;
    const { data, error } = await sb.from('progress').select('path, value, ts').eq('kid_id', state.ctx.id);
    if(error){ warn('pull: ' + error.message); return false; }
    return mergeRows(data || []);
  }

  // Буфер путей на запись (kid_id -> {path: {val, ts}})
  const pending = {};
  let timer = null;
  function schedulePush(){
    clearTimeout(timer);
    timer = setTimeout(() => {
      pushNow().catch(err => warn('push: ' + (err && err.message || err)));
    }, 800);
  }
  async function pushNow(){
    if(!state.session || !state.ctx || state.ctx.role!=='kid') return;
    const kidId = state.ctx.id;
    const list = pending[kidId];
    if(!list || !Object.keys(list).length) return;
    pending[kidId] = {};
    const rows = Object.entries(list).map(([path,it]) => ({ kid_id: kidId, path, value: it.val, ts: it.ts }));
    const { error } = await sb.from('progress').upsert(rows, { onConflict: 'kid_id,path' });
    if(error) throw error;
  }

  document.addEventListener('store:change', e => {
    if(!state.session || !state.ctx || state.ctx.role!=='kid') return;
    const path = e.detail.path, val = e.detail.val;
    if(path === undefined) return;
    pending[state.ctx.id] = pending[state.ctx.id] || {};
    pending[state.ctx.id][path] = { val, ts: Date.now() };
    const t = loadTs(); t[path] = Date.now(); saveTs(t);
    schedulePush();
  });

  /* ================= регистрации «куда записались» ================= */

  async function listRegistrations(){
    if(!state.session || !state.ctx) return [];
    const { data, error } = await sb.from('registrations')
      .select('*').eq('kid_id', state.ctx.id)
      .order('deadline', {ascending:true, nullsFirst:false});
    if(error) throw error;
    return data || [];
  }

  async function addRegistration(d){
    if(!state.session || !state.ctx) throw new Error('no session');
    const { error } = await sb.from('registrations').insert({
      kid_id: state.ctx.id,
      title: d.title, place: d.place || null,
      date: d.date || null, deadline: d.deadline || null,
      link: d.link || null, note: d.note || null,
      done_at: d.done ? new Date().toISOString() : null,
    });
    if(error) throw error;
  }

  async function setRegistrationDone(id, done){
    const { error } = await sb.from('registrations')
      .update({ done_at: done ? new Date().toISOString() : null }).eq('id', id);
    if(error) throw error;
  }

  async function deleteRegistration(id){
    const { error } = await sb.from('registrations').delete().eq('id', id);
    if(error) throw error;
  }

  /* ================= календарь и напоминания ================= */

  async function listReminders(){
    if(!state.session || !state.ctx) return [];
    const { data, error } = await sb.from('reminders')
      .select('*').eq('kid_id', state.ctx.id)
      .order('remind_at', {ascending:true});
    if(error) throw error;
    return data || [];
  }

  async function addReminder(d){
    if(!state.session || !state.ctx) throw new Error('no session');
    const { error } = await sb.from('reminders').insert({
      kid_id: state.ctx.id,
      title: d.title,
      remind_at: d.remind_at,
      kind: d.kind || 'training',
      link: d.link || null,
      note: d.note || null,
    });
    if(error) throw error;
  }

  async function setReminderDone(id, done){
    const { error } = await sb.from('reminders').update({
      done_at: done ? new Date().toISOString() : null,
    }).eq('id', id);
    if(error) throw error;
  }

  async function deleteReminder(id){
    const { error } = await sb.from('reminders').delete().eq('id', id);
    if(error) throw error;
  }

  async function requestNotifications(){
    if(!('Notification' in window)) return 'unsupported';
    return Notification.requestPermission();
  }

  // Уведомление показывается при открытии сайта/PWA. Фоновая доставка
  // без открытого сайта потребует отдельной Edge Function/Web Push на следующем этапе.
  function notifyDue(reminders){
    if(!('Notification' in window) || Notification.permission !== 'granted') return;
    const now = Date.now(), horizon = now + 24 * 60 * 60 * 1000;
    const key = 'edu-portal-notified-reminders';
    let seen = {};
    try{ seen = JSON.parse(localStorage.getItem(key)) || {}; }catch(e){}
    for(const r of reminders){
      const at = new Date(r.remind_at).getTime();
      if(r.done_at || at < now || at > horizon || seen[r.id]) continue;
      try{ new Notification('Образование: напоминание', {body:r.title}); seen[r.id] = Date.now(); }catch(e){}
    }
    try{ localStorage.setItem(key, JSON.stringify(seen)); }catch(e){}
  }

  /* ================= действия ================= */

  async function signIn(email, pwd){
    const { error } = await sb.auth.signInWithPassword({ email, password: pwd });
    if(error) throw error;
  }

  async function signUpParent(email, pwd){
    const { data, error } = await sb.auth.signUp({ email, password: pwd });
    if(error) throw error;
    if(!data.session) return false;              // подтверждение почты включено — сессии нет
    try{ await sb.rpc('create_parent_profile'); }catch(e){ warn('create_parent_profile: ' + e.message); }
    return true;
  }

  // Гарантируем профиль: если пользователь вошёл, а профиля нет — делаем его родительским.
  async function ensureParentProfile(){
    if(!state.session) return;
    try{ await loadProfiles(); }catch(e){ warn('loadProfiles: ' + e.message); }
    if(!state.me){
      try{ await sb.rpc('create_parent_profile'); await loadProfiles(); }
      catch(e){ warn('ensureParentProfile: ' + e.message); }
    }
  }

  async function createKid(email, pwd, name, cls){
    if(!state.session || !state.me || state.me.role!=='parent') throw new Error('Только родитель может создавать аккаунты детей');
    // Отдельный клиент без persistSession: создание ребёнка не меняет
    // активную родительскую сессию в браузере.
    const childClient = window.supabase.createClient(CFG.url, CFG.key, {
      auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false },
    });
    const { data, error } = await withTimeout(childClient.auth.signUp({
      email: email.trim(), password: pwd,
    }));
    if(error) throw error;
    if(!data || !data.user) throw new Error('Supabase не вернул созданного пользователя');

    const linked = await withTimeout(sb.rpc('link_kid_profile', {
      p_kid_id: data.user.id, p_name: name, p_cls: cls,
    }));
    if(linked.error) throw linked.error;
    return data.user.id;
  }

  async function signOut(){
    await sb.auth.signOut();
    state.me = null; state.kids = []; state.ctx = null;
    renderAuth();
  }

  async function switchKid(kidId){
    const k = state.kids.find(x=>x.id===kidId);
    if(!k) return;
    state.ctx = {id:k.id, name:k.name||'Ребёнок', cls:k.cls||'', role:'kid'};
    let changed = false;
    try{ changed = await pullProgress(); }catch(e){}
    renderAuth();
    if(changed) setTimeout(()=>location.reload(), 350);
  }

  /* ================= UI: кнопка входа и меню ================= */

  function renderAuth(){
    $('#portal-menu') && $('#portal-menu').remove();
    const btn = $('#portal-auth');
    if(!btn) return;
    if(!READY){ btn.remove(); return; }

    if(!state.session){
      btn.textContent = 'Вход';
      btn.onclick = e => { e.stopPropagation(); openModal(); };
      return;
    }
    const who = (state.me && state.me.role==='parent')
      ? 'Родитель'
      : (state.me && state.me.name) || 'Я';
    btn.textContent = who + ' ▾';
    btn.classList.add('in');
    btn.onclick = e => { e.stopPropagation(); toggleMenu(); };
  }

  function toggleMenu(){
    if($('#portal-menu')){ $('#portal-menu').remove(); return; }
    const btn = $('#portal-auth');
    const m = el('div',{id:'portal-menu',class:'portal-menu'});
    const add  = (t,fn) => m.append(el('button',{class:'pm-item',onclick:()=>{ m.remove(); fn(); }}, t));
    const cap = t => m.append(el('div',{class:'pm-cap'}, t));

    add('Мой прогресс', () => { location.href = 'my.html'; });

    if(state.me && state.me.role==='parent'){
      add('Дети: аккаунты', () => openModal());
    }

    if(state.me && state.me.role==='parent' && state.kids.length){
      cap('Ребёнок в фокусе:');
      for(const k of state.kids){
        const on = state.ctx && state.ctx.id===k.id;
        m.append(el('button',{class:'pm-item'+(on?' on':''),onclick:()=>{ m.remove(); switchKid(k.id); }},
          (k.name||'Ребёнок') + (k.cls==='u'||k.cls==='y' ? ' · '+k.cls : '')));
      }
    }
    add('Выйти', () => signOut());

    const r = btn.getBoundingClientRect();
    m.style.top  = (r.bottom + 6) + 'px';
    m.style.left = Math.max(8, r.right - 200) + 'px';
    document.body.append(m);
    setTimeout(() => {
      const close = e => { if(!m.contains(e.target) && e.target !== btn){ m.remove(); document.removeEventListener('click', close, true); } };
      document.addEventListener('click', close, true);
    }, 0);
  }

  /* ---------- модалка входа ---------- */

  function closeModal(){ $$('.portal-ov').forEach(n=>n.remove()); }

  function openModal(){
    closeModal();
    const ov = el('div',{class:'portal-ov',onclick:closeModal});
    const box = el('div',{class:'portal-box',onclick:e=>e.stopPropagation()});

    const tabs = el('div',{class:'ptabs'});
    const setTab = (btns,which) => btns.forEach(b=>b.classList.toggle('on', b.dataset.tab===which));
    const pane = el('div',{class:'ppane'});

    const errNode = () => el('p',{class:'pm-err'});

    function loginForm(){
      const em = el('input',{type:'email',placeholder:'Почта',required:'required'});
      const pw = el('input',{type:'password',placeholder:'Пароль',required:'required'});
      const er = errNode();
      const f = el('form',{}, em, pw, er, el('button',{class:'btn',type:'submit'},'Войти'));
      f.addEventListener('submit', async e => {
        e.preventDefault(); er.textContent='';
        try{ await signIn(em.value.trim(), pw.value); closeModal(); }
        catch(x){ er.textContent = 'Не удалось войти: ' + esc(x.message); }
      });
      return f;
    }

    function regForm(){
      const em = el('input',{type:'email',placeholder:'Ваша почта (родитель)', required:'required'});
      const pw = el('input',{type:'password',placeholder:'Пароль (мин. 6 символов)', minlength:'6', required:'required'});
      const er = errNode();
      const f = el('form',{}, em, pw,
        el('p',{class:'pm-note'},'Первый аккаунт — родительский. После входа появится панель создания детских аккаунтов.'),
        er, el('button',{class:'btn',type:'submit'},'Создать аккаунт родителя'));
      f.addEventListener('submit', async e => {
        e.preventDefault(); er.textContent='';
        try{
          const ok = await signUpParent(em.value.trim(), pw.value);
          if(ok){ closeModal(); }
          else{
            er.style.color = 'var(--warn)';
            er.textContent = 'Письмо с подтверждением отправлено на почту. Подтвердите его, затем войдите — аккаунт станет родительским автоматически.';
          }
        }
        catch(x){ er.textContent = 'Ошибка: ' + esc(x.message); }
      });
      return f;
    }

    function kidsForm(){
      const nm = el('input',{type:'text',placeholder:'Имя («Дочь», «Сын»)', required:'required'});
      const em = el('input',{type:'email',placeholder:'Почта ребёнка (вход)', required:'required'});
      const pw = el('input',{type:'password',placeholder:'Пароль ребёнка', minlength:'6', required:'required'});
      const cl = el('select',{}, el('option',{value:'u'},'Старший (u)'), el('option',{value:'y'},'Младший (y)'));
      const er = errNode();
      const f = el('form',{class:'pm-kids'},
        nm, em, pw,
        el('div',{class:'row'}, cl, el('button',{class:'btn',type:'submit'},'Создать аккаунт')),
        er);
      f.addEventListener('submit', async e => {
        e.preventDefault(); er.textContent='';
        try{
          await createKid(em.value.trim(), pw.value, nm.value.trim(), cl.value);
          await loadProfiles();
          er.style.color = 'var(--ok)'; er.textContent = 'Аккаунт создан ✓';
        }catch(x){ er.textContent = 'Ошибка: ' + esc(x.message); }
      });
      return f;
    }

    let tabsWire = null;
    if(state.session && state.me && state.me.role==='parent'){
      box.append(
        el('h3',{class:'pm-h'},'Аккаунты детей'),
        el('p',{class:'pm-note'},'Дети входят по своим почте и паролю, а затем видят собственный прогресс и регистрации.'),
        kidsForm());
    } else if(state.session && !state.me){
      const msg   = el('p',{class:'pm-err'});
      const claim = el('button',{class:'btn'},'Сделать этот аккаунт родительским');
      const tryClaim = async () => {
        claim.disabled = true;
        msg.style.color = 'var(--tx2)'; msg.textContent = 'Проверяю профиль…';
        try{
          await withTimeout(sb.rpc('create_parent_profile'));
          await withTimeout(loadProfiles());
          if(state.me){ closeModal(); openModal(); return; }
          msg.style.color = 'var(--bad)';
          msg.textContent = 'Профиль всё ещё не виден. Обновите страницу (F5) и попробуйте снова. Если не поможет — пришлите текст из консоли браузера (F12 → Console).';
        }catch(x){
          msg.style.color = 'var(--bad)';
          msg.textContent = 'Ошибка: ' + esc(x.message);
        } finally { claim.disabled = false; }
      };
      claim.addEventListener('click', tryClaim);
      setTimeout(() => { if(!state.me) tryClaim(); }, 300);
      box.append(
        el('h3',{class:'pm-h'},'Аккаунт без роли'),
        el('p',{class:'pm-note'},'Сейчас попробуем автоматически сделать этот аккаунт родительским. Если по какой-то причине не выйдет — нажмите кнопку; ошибка появится прямо здесь.'),
        claim, msg);
    } else if(state.session){
      box.append(el('p',{class:'pm-note'},'Вы вошли как «'+ esc((state.me&&state.me.name)||'Я') +'». Меню входа — в шапке; ваш кабинет — страница «Мой прогресс».'));
    } else {
      tabs.append(
        el('button',{class:'on','data-tab':'login',onclick:e=>{ setTab([...tabs.children],'login'); pane.innerHTML=''; pane.append(loginForm()); }},'Вход'),
        el('button',{class:'','data-tab':'reg',onclick:e=>{ setTab([...tabs.children],'reg'); pane.innerHTML=''; pane.append(regForm()); }},'Родитель: создать аккаунт'));
      box.append(el('h3',{class:'pm-h'},'Вход в портал'), tabs, pane);
      pane.innerHTML=''; pane.append(loginForm());
      tabsWire = 1;
    }

    box.append(el('button',{class:'portal-x',onclick:closeModal,title:'Закрыть'},'✕'));
    ov.append(box);
    document.body.append(ov);
  }

  /* ================= публичный API ================= */

  window.Portal = {
    ready: READY,
    configured: ON,
    get session(){ return state.session; },
    get me(){ return state.me; },
    get kids(){ return state.kids; },
    get ctx(){ return state.ctx; },
    signIn, signUpParent, signOut,
    createKid,            // (email, pwd, name, cls)
    switchKid,
    pull: pullProgress,
    listRegistrations, addRegistration, setRegistrationDone, deleteRegistration,
    listReminders, addReminder, setReminderDone, deleteReminder,
    requestNotifications, notifyDue,
    refresh: () => loadProfiles(),
    renderAuth,
    showLogin: () => openModal(),
  };

  /* ================= инициализация ================= */

  function refreshAuthUI(){
    renderAuth();
  }

  window.addEventListener('DOMContentLoaded', () => {
    if(!READY) return;
    setTimeout(async () => {
      try{
        const { data } = await sb.auth.getSession();
        if(data.session) state.session = data.session;
      }catch(e){ warn('getSession: ' + e.message); }
      if(state.session){
        await ensureParentProfile();
        let changed = false;
        try{ changed = await pullProgress(); }catch(e){}
        refreshAuthUI();
        document.dispatchEvent(new CustomEvent('portal:login'));
        if(state.ctx && state.ctx.role==='kid' && changed) setTimeout(()=>location.reload(), 350);
      } else {
        refreshAuthUI();
      }
    }, 10);

    sb.auth.onAuthStateChange((event, session) => {
      state.session = session;
      if(event === 'SIGNED_IN' && session){
        ensureParentProfile().then(async () => {
          let changed = false;
          try{ changed = await pullProgress(); }catch(e){ warn('pull: ' + e.message); }
          refreshAuthUI();
          document.dispatchEvent(new CustomEvent('portal:login'));
          // перезагрузка нужна только если подтянулись новые данные ребёнка
          if(changed && state.ctx && state.ctx.role==='kid') setTimeout(()=>location.reload(), 350);
        }).catch(e => warn(e.message));
      } else if(event === 'SIGNED_OUT'){
        state.me=null; state.kids=[]; state.ctx=null;
        refreshAuthUI();
        document.dispatchEvent(new CustomEvent('portal:logout'));
      }
    });
  });
})();