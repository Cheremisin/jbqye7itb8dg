/* ============================================================
   ТРЕНЕР-АГЕНТ (этап 2)
   - Ребёнок после каждого задания отмечает, как оно пошло:
     1 — легко, 2 — средне, 3 — трудно (Store, синк в Supabase).
   - Движок считает уровень набора, серию дней и собирает
     «тренировку дня»: повторить трудное + следующее по плану +
     одно лёгкое для разминки.
   ============================================================ */
(function(){
  const Store = window.Store;
  if(!Store) { console.warn('coach: Store не найден'); return; }

  const OUTCOME_KEY = 'task.outcome.';

  const fmtDay = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  /* ---------- оценки ---------- */
  function getOutcome(id){ return Store.get(OUTCOME_KEY + id, null); }
  function setOutcome(id, r){
    Store.set(OUTCOME_KEY + id, { r, t: Date.now() });
  }

  /* ---------- задачи набора ---------- */
  function taskIdsOf(set){
    const T = window.TASKS && TASKS[set];
    if(!T || !T.weeks) return [];
    const ids = [];
    T.weeks.forEach(w => w.items.forEach((_, i) => ids.push(`tk.${set}.${w.n}.${i}`)));
    return ids;
  }
  function taskText(id){
    const m = /^tk\.([^.]+)\.(\d+)\.(\d+)$/.exec(id);
    if(!m) return '';
    const T = window.TASKS && TASKS[m[1]];
    const w = T && T.weeks && T.weeks.find(x => x.n === Number(m[2]));
    const it = w && w.items && w.items[Number(m[3])];
    if(!it) return '';
    const t = String(it.q || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > 70 ? t.slice(0, 70) + '…' : t;
  }

  /* ---------- статистика набора ---------- */
  function stats(set){
    const ids = taskIdsOf(set);
    let done = 0, rated = 0, easy = 0, mid = 0, hard = 0;
    ids.forEach(id => {
      if(Store.get('tasks.' + id, false)) done++;
      const o = getOutcome(id);
      if(o){ rated++; if(o.r === 1) easy++; else if(o.r === 2) mid++; else hard++; }
    });
    return { total: ids.length, done, rated, easy, mid, hard, level: levelOf(easy, mid, hard, rated) };
  }
  function levelOf(easy, mid, hard, rated){
    if(!rated) return null;
    const score = (easy + mid * 2 + hard * 3) / rated;
    return score < 1.7 ? 'easy' : score < 2.4 ? 'steady' : 'hard';
  }
  const LEVEL_LABEL = { easy: 'пока легко — можно скорость и больше нового', steady: 'ровно — держим план', hard: 'трудновато — добавляем повторы' };

  /* ---------- рекомендации «тренировки дня» ---------- */
  function suggested(set, n = 3){
    const ids = taskIdsOf(set);
    const unrated = ids.filter(id => !Store.get('tasks.' + id, false) && !getOutcome(id));
    const hard = ids
      .map(id => ({ id, o: getOutcome(id) }))
      .filter(x => x.o && x.o.r >= 3 && !Store.get('tasks.' + x.id, false))
      .sort((a, b) => a.o.t - b.o.t)
      .map(x => x.id);
    const easy = ids.filter(id => { const o = getOutcome(id); return o && o.r === 1; });

    const picks = [];
    if(hard.length)   picks.push({ id: hard[hard.length - 1], kind: 'Повторить сложное', group: null });
    if(unrated.length) picks.push({ id: unrated[0],           kind: 'Следующее задание', group: null });
    const weak = weakTopics(set, 1)[0];
    if(weak){
      const fromWeak = weak.ids.find(id => !Store.get('tasks.' + id, false));
      if(fromWeak && !picks.some(p => p.id === fromWeak)){
        picks.push({ id: fromWeak, kind: 'Прокачать слабую тему: ' + weak.topic, group: weak.topic });
      }
    }
    if(picks.length < n && easy.length) picks.push({ id: easy[easy.length - 1], kind: 'Разминка', group: null });
    return picks.slice(0, n).map(p => ({ ...p, text: taskText(p.id) }));
  }

  /* ---------- темы недель: статистика по каждой ---------- */
  function groupsOf(set){
    const T = window.TASKS && TASKS[set];
    if(!T || !T.weeks) return [];
    const map = new Map();
    T.weeks.forEach(w => {
      const g = map.get(w.topic) || { topic: w.topic, ids: [] };
      w.items.forEach((_, i) => g.ids.push(`tk.${set}.${w.n}.${i}`));
      map.set(w.topic, g);
    });
    return [...map.values()].filter(g => g.topic);
  }

  // Проблемность группы: много «Трудно» и нерешённых — выше.
  function topicStats(set){
    return groupsOf(set).map(g => {
      let rated = 0, easy = 0, mid = 0, hard = 0, done = 0;
      g.ids.forEach(id => {
        if(Store.get('tasks.' + id, false)) done++;
        const o = getOutcome(id);
        if(o){ rated++; if(o.r === 1) easy++; else if(o.r === 2) mid++; else hard++; }
      });
      const avg = rated ? (easy + mid * 2 + hard * 3) / rated : null;
      const wrong = hard * 2 + (g.ids.length - done) - easy * 0.5;
      return { topic: g.topic, ids: g.ids, total: g.ids.length, rated, done, avg, wrong };
    })
    .sort((a, b) => b.wrong - a.wrong);
  }

  // Слабые темы: первая — самая проблемная
  function weakTopics(set, n = 3){ return topicStats(set).slice(0, n); }

  /* ---------- серия дней ---------- */
  function streakInfo(){
    const s = Store.get('agent.streak', null);
    return s ? { days: s.days, last: s.last } : null;
  }
  function bumpStreak(){
    const today = fmtDay(new Date());
    const s = Store.get('agent.streak', null);
    if(s && s.last === today) return;
    const yest = fmtDay(new Date(Date.now() - 864e5));
    const days = (s && s.last === yest) ? s.days + 1 : 1;
    Store.set('agent.streak', { days, last: today });
  }
  document.addEventListener('store:change', e => {
    if(!e.detail.path || !e.detail.path.startsWith('tasks.') || e.detail.val !== true) return;
    bumpStreak();
  });

  window.Coach = {
    getOutcome, setOutcome, stats, suggested, streakInfo,
    taskIdsOf, taskText, groupsOf, topicStats, weakTopics,
    OUTCOME_KEY, LEVEL_LABEL,
  };
})();