/* ============================================================
   Семейный образовательный портал — общий каркас
   Хранение: localStorage (браузер) + экспорт/импорт JSON
   ============================================================ */

const NAV = [
  ['index.html',      'Дашборд'],
  ['plan.html',       'Планы'],
  ['tasks.html',      'Задания'],
  ['tracker.html',    'Трекер'],
  ['olympiads.html',  'Олимпиады'],
  ['admission.html',  'Вузы'],
  ['resources.html',  'Ресурсы'],
  ['tests.html',      'Профориентация'],
  ['professions.html','Профессии'],
  ['ai.html',         'ИИ в учёбе'],
  ['strategy.html',   'Тренды'],
];

/* ---------------- подстановка имён (см. data/config.js) ----------------
   В текстах стоят токены {{U}}, {{Ug}}, {{Ud}}… — они заменяются на имена
   из window.NAMES. Благодаря этому имена задаются ровно в одном файле. */
const N = (window.NAMES) || {u:{},y:{}};
const NAME_TOKENS = {
  '{{U}}': N.u.nom||'Старшая', '{{Ug}}': N.u.gen||'Старшей', '{{Ud}}': N.u.dat||'Старшей',
  '{{Ua}}': N.u.acc||'Старшую', '{{Ui}}': N.u.ins||'Старшей', '{{Up}}': N.u.pre||'Старшей',
  '{{Y}}': N.y.nom||'Младший', '{{Yg}}': N.y.gen||'Младшего', '{{Yd}}': N.y.dat||'Младшему',
  '{{Ya}}': N.y.acc||'Младшего', '{{Yi}}': N.y.ins||'Младшим', '{{Yp}}': N.y.pre||'Младшем',
};
const NAME_RE = /\{\{(U|Ug|Ud|Ua|Ui|Up|Y|Yg|Yd|Ya|Yi|Yp)\}\}/g;
const nm = s => typeof s === 'string' && s.indexOf('{{') >= 0
  ? s.replace(NAME_RE, m => NAME_TOKENS[m] ?? m) : s;

/* глубокая замена во всех загруженных данных (data/*.js уже подключены выше) */
(function substData(){
  const seen = new WeakSet();
  const walk = o => {
    if(!o || typeof o !== 'object' || seen.has(o)) return;
    seen.add(o);
    for(const k of Object.keys(o)){
      const v = o[k];
      if(typeof v === 'string') o[k] = nm(v);
      else if(v && typeof v === 'object') walk(v);
    }
  };
  ['DEADLINES','OLYMPIADS','RESOURCES','PLANS','PROMPTS','TASKS',
   'RIASEC_TYPES','RIASEC_ITEMS','PROFILE_DIRS','PROFILE_ITEMS',
   'OBSERVE_AXES','OBSERVE_ITEMS','PROFESSIONS','DECLINING','SKILLS'].forEach(k => walk(window[k]));
  if(typeof window.SKILLS_CAVEAT === 'string') window.SKILLS_CAVEAT = nm(window.SKILLS_CAVEAT);
})();

const KIDS = {
  elder:   {name:nm('{{U}}'), short:(N.u.short||'С'), age:15, grade:9, cls:'u', color:'var(--u)',
             goal:'9 класс с 01.09.2026 → ОГЭ 2027 → ЕГЭ и поступление 2029'},
  younger: {name:nm('{{Y}}'), short:(N.y.short||'М'), age:10, grade:5, cls:'y', color:'var(--y)',
             goal:'5 класс с 01.09.2026 → поступление 2034. Задача — фундамент и широкие пробы'},
};

/* ---------------- storage ---------------- */
const KEY = 'edu-portal-v1';
const Store = {
  _d: null,
  load(){
    if(this._d) return this._d;
    try{ this._d = JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch(e){ this._d = {}; }
    return this._d;
  },
  save(){ try{ localStorage.setItem(KEY, JSON.stringify(this._d)); }catch(e){ alert('Не удалось сохранить: '+e.message); } },
  get(path, def){
    const d = this.load(); const p = path.split('.');
    let v = d; for(const k of p){ if(v==null || typeof v!=='object') return def; v = v[k]; }
    return v===undefined ? def : v;
  },
  set(path, val){
    const d = this.load(); const p = path.split('.');
    let v = d;
    for(let i=0;i<p.length-1;i++){ if(typeof v[p[i]]!=='object'||v[p[i]]===null) v[p[i]]={}; v=v[p[i]]; }
    v[p[p.length-1]] = val; this.save();
    document.dispatchEvent(new CustomEvent('store:change',{detail:{path,val}}));
  },
  del(path){
    const d=this.load(); const p=path.split('.');
    let v=d; for(let i=0;i<p.length-1;i++){ if(!v[p[i]]) return; v=v[p[i]]; }
    delete v[p[p.length-1]]; this.save();
  },
  export(){
    const blob = new Blob([JSON.stringify(this.load(),null,2)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='edu-portal-'+new Date().toISOString().slice(0,10)+'.json';
    a.click(); URL.revokeObjectURL(a.href);
  },
  import(file, cb){
    const r=new FileReader();
    r.onload=()=>{ try{ this._d=JSON.parse(r.result); this.save(); cb&&cb(true); }
                   catch(e){ cb&&cb(false,e.message); } };
    r.readAsText(file);
  },
  reset(){ if(confirm('Стереть все локальные данные (прогресс, заметки, результаты тестов)? Отменить нельзя.')){ localStorage.removeItem(KEY); this._d=null; location.reload(); } }
};

/* ---------------- helpers ---------------- */
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const el = (t,a={},...kids)=>{
  const n=document.createElement(t);
  for(const [k,v] of Object.entries(a)){
    if(k==='class') n.className=v;
    else if(k==='html') n.innerHTML=nm(v);
    else if(k.startsWith('on')) n.addEventListener(k.slice(2),v);
    else if(v!==null&&v!==false&&v!==undefined) n.setAttribute(k,v);
  }
  kids.flat().forEach(c=>{ if(c==null||c===false) return; n.append(c.nodeType?c:document.createTextNode(nm(String(c)))); });
  return n;
};
const esc = s => String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const TODAY = new Date();
const dparse = s => { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); };
const dfmt = s => { const d=dparse(s); return d.toLocaleDateString('ru-RU',{day:'numeric',month:'short'}); };
const dfmtFull = s => dparse(s).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
const daysTo = s => Math.ceil((dparse(s)-TODAY)/864e5);
const plural = (n,a,b,c)=>{ const m=n%100, k=n%10; return n+' '+(m>=11&&m<=14?c:k===1?a:k>=2&&k<=4?b:c); };

/* ---------------- chrome ---------------- */
/* замена токенов имён в уже свёрстанном тексте страницы */
function substDOM(root=document.body){
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  for(let n = w.nextNode(); n; n = w.nextNode()) if(n.nodeValue.indexOf('{{') >= 0) hits.push(n);
  hits.forEach(n => n.nodeValue = nm(n.nodeValue));
  document.title = nm(document.title);
}

function buildChrome(){
  substDOM();
  const page = location.pathname.split('/').pop() || 'index.html';
  const head = el('header',{class:'top'},
    el('div',{class:'wrap topin'},
      el('a',{class:'brand',href:'index.html'}, '🎓 ', el('span',{},'Образование'), ' · семейный портал'),
      el('nav',{class:'main'}, NAV.map(([h,t])=>el('a',{href:h,class:h===page?'on':''},t))),
      el('button',{class:'tbtn',title:'Светлая / тёмная тема',onclick:toggleTheme},'◐')
    )
  );
  document.body.prepend(head);

  document.body.append(el('footer',{},
    el('div',{class:'wrap'},
      el('p',{class:'mb0'},'Данные исследования собраны 9 августа 2026 г. Правила приёма, перечни олимпиад и сроки меняются ежегодно — перед решениями сверяйтесь с первоисточниками (ссылки на каждой странице).'),
      el('p',{class:'mb0 xs'},'Ваш прогресс хранится только в этом браузере. Регулярно делайте резервную копию: ',
        el('a',{href:'#',onclick:e=>{e.preventDefault();Store.export();}},'скачать JSON'),' · ',
        el('a',{href:'#',onclick:e=>{e.preventDefault();Store.reset();}},'сбросить всё'))
    )
  ));
}
function toggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme')==='light'?'dark':'light';
  document.documentElement.setAttribute('data-theme',cur);
  try{ localStorage.setItem('edu-theme',cur); }catch(e){}
}
(function initTheme(){
  try{ const t=localStorage.getItem('edu-theme'); if(t) document.documentElement.setAttribute('data-theme',t); }catch(e){}
})();

/* ---------------- reusable widgets ---------------- */

// Чекбокс-задача, состояние в localStorage
function taskItem(id, text, meta){
  const done = Store.get('tasks.'+id, false);
  const cb = el('input',{type:'checkbox', id:'t_'+id, ...(done?{checked:'checked'}:{})});
  const row = el('div',{class:'task'+(done?' done':'')}, cb,
    el('label',{for:'t_'+id}, el('span',{html:text}), meta?el('span',{class:'m',html:meta}):null));
  cb.addEventListener('change',()=>{
    Store.set('tasks.'+id, cb.checked);
    row.classList.toggle('done', cb.checked);
  });
  return row;
}

// Прогресс-бар по набору id задач
function progressBar(ids){
  const n = ids.filter(i=>Store.get('tasks.'+i,false)).length;
  const box = el('div',{},
    el('div',{class:'bar'}, el('i',{style:`width:${ids.length?n/ids.length*100:0}%`})),
    el('div',{class:'xs muted'}, `${n} из ${ids.length} выполнено`));
  document.addEventListener('store:change',e=>{
    if(!e.detail.path.startsWith('tasks.')) return;
    const m = ids.filter(i=>Store.get('tasks.'+i,false)).length;
    box.querySelector('.bar i').style.width = (ids.length?m/ids.length*100:0)+'%';
    box.querySelector('.xs').textContent = `${m} из ${ids.length} выполнено`;
  });
  return box;
}

// Кнопка «копировать»
function copyBtn(getText){
  const b = el('button',{class:'btn sec sm cp'},'Копировать');
  b.addEventListener('click',async()=>{
    try{ await navigator.clipboard.writeText(getText()); }
    catch(e){ const ta=el('textarea',{}); ta.value=getText(); document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    b.textContent='Скопировано ✓'; setTimeout(()=>b.textContent='Копировать',1600);
  });
  return b;
}

// Автосохраняемое текстовое поле
function noteField(path, placeholder, rows=3){
  const ta = el('textarea',{rows, placeholder});
  ta.value = Store.get(path,'');
  let t; ta.addEventListener('input',()=>{ clearTimeout(t); t=setTimeout(()=>Store.set(path,ta.value),400); });
  return ta;
}

// Универсальный фильтруемый список
function filterList({items, container, render, facets, searchFields, searchPlaceholder='Поиск…'}){
  const state = {q:'', ...Object.fromEntries(facets.map(f=>[f.key, f.multi?[]:'']))};
  const bar = el('div',{class:'filters'});
  const search = el('input',{type:'search',placeholder:searchPlaceholder});
  search.addEventListener('input',()=>{state.q=search.value.toLowerCase();draw();});
  bar.append(search);
  facets.forEach(f=>{
    if(f.type==='chips'){
      const wrap = el('div',{style:'display:flex;gap:6px;flex-wrap:wrap;align-items:center'},
        el('span',{class:'xs muted',style:'margin-right:2px'},f.label+':'));
      f.options.forEach(([val,lab])=>{
        const c = el('span',{class:'chip'},lab);
        c.addEventListener('click',()=>{
          if(f.multi){
            const i=state[f.key].indexOf(val);
            i>=0?state[f.key].splice(i,1):state[f.key].push(val);
            c.classList.toggle('on');
          }else{
            state[f.key] = state[f.key]===val?'':val;
            wrap.querySelectorAll('.chip').forEach(x=>x.classList.remove('on'));
            if(state[f.key]) c.classList.add('on');
          }
          draw();
        });
        wrap.append(c);
      });
      bar.append(wrap);
    }else{
      const s = el('select',{}, el('option',{value:''},f.label+': все'),
        f.options.map(([v,l])=>el('option',{value:v},l)));
      s.addEventListener('change',()=>{state[f.key]=s.value;draw();});
      bar.append(s);
    }
  });
  const count = el('span',{class:'xs muted'});
  bar.append(count);
  const list = el('div',{});
  container.append(bar, list);

  function match(it){
    if(state.q){
      const hay = searchFields.map(f=>JSON.stringify(it[f]||'')).join(' ').toLowerCase();
      if(!hay.includes(state.q)) return false;
    }
    for(const f of facets){
      const v = state[f.key];
      if(f.multi){ if(v.length && !v.some(x=>f.test(it,x))) return false; }
      else if(v && !f.test(it,v)) return false;
    }
    return true;
  }
  function draw(){
    const res = items.filter(match);
    list.innerHTML='';
    count.textContent = `${res.length} из ${items.length}`;
    if(!res.length){ list.append(el('p',{class:'muted'},'Ничего не найдено. Сбросьте фильтры.')); return; }
    render(res, list);
  }
  draw();
}

document.addEventListener('DOMContentLoaded', buildChrome);
