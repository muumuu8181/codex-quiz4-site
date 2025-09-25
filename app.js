
(() => {
  const ROUND_SIZE = 5;
  const VERSION = '0.04';
  const KEYS = {
    stats: 'quizStats_v1',
    setName: 'quizSetName_v1',
  };

  const $ = (sel) => document.querySelector(sel);
  const screens = {
    menu: $('#screen-menu'),
    quiz: $('#screen-quiz'),
    result: $('#screen-result'),
    history: $('#screen-history'),
    stats: $('#screen-stats'),
  };

  const els = {
    total: $('#stat-total'),
    attempts: $('#stat-attempts'),
    start: $('#btn-start'),
    again: $('#btn-again'),
    menu: $('#btn-menu'),
    exit: $('#btn-exit'),
    next: $('#btn-next'),
    progress: $('#quiz-progress'),
    category: $('#quiz-category'),
    question: $('#quiz-question'),
    choices: $('#choices'),
    feedback: $('#feedback'),
    roundScore: $('#round-score'),
    roundReview: $('#round-review'),
    file: $('#file-input'),
    setName: $('#set-name'),
    historyBtn: $('#btn-history'),
    historyBack: $('#btn-history-back'),
    historyList: $('#history-list'),
    statsBtn: $('#btn-stats'),
    statsBack: $('#btn-stats-back'),
    statsList: $('#stats-list'),
  };

  // simple beep sounds
  let audioCtx = null;
  function playTone(freq = 880, duration = 150, type = 'sine', gain = 0.04) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type; osc.frequency.value = freq;
      g.gain.value = gain;
      osc.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime;
      osc.start(t);
      // quick envelope to avoid click
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + duration / 1000);
      osc.stop(t + duration / 1000 + 0.02);
    } catch { /* ignore */ }
  }
  const playCorrect = () => playTone(1200, 160, 'triangle', 0.05);
  const playWrong = () => { playTone(300, 180, 'sawtooth', 0.05); setTimeout(() => playTone(220, 180, 'sawtooth', 0.04), 120); };

  function getStats() {
    try {
      const s = JSON.parse(localStorage.getItem(KEYS.stats)) || {};
      return {
        totalCorrect: s.totalCorrect || 0,
        totalQuestions: s.totalQuestions || 0,
        attemptsCount: s.attemptsCount || 0,
        attempts: Array.isArray(s.attempts) ? s.attempts : [],
        byId: s.byId || {},
      };
    } catch {
      return { totalCorrect: 0, totalQuestions: 0, attemptsCount: 0, attempts: [], byId: {} };
    }
  }
  function setStats(s) { localStorage.setItem(KEYS.stats, JSON.stringify(s)); }
  function setSetName(name) { localStorage.setItem(KEYS.setName, name); }
  function getSetName() { return localStorage.getItem(KEYS.setName) || '冁E��サンプル'; }

  // Canonical key helpers for per-ID stats
  function canonicalKeyForQuestion(q) {
    return (q && q.id != null) ? `id:${q.id}` : `q:${q?.question ?? ''}`;
  }
  function ensureEntryForQuestion(s, q) {
    const key = canonicalKeyForQuestion(q);
    if (!s.byId[key]) s.byId[key] = { id: q.id ?? null, title: q.question, attempts: 0, correct: 0, wrong: 0, last: null, category: q.category, series: [], recent: [] };
    // migrate legacy keys (pure id string or pure question string)
    const legacyIdKey = String(q.id ?? '');
    const legacyQKey = String(q.question ?? '');
    [legacyIdKey, legacyQKey].forEach(k => {
      if (!k) return;
      if (s.byId[k] && s.byId[k] !== s.byId[key]) {
        const from = s.byId[k];
        const to = s.byId[key];
        to.attempts += from.attempts || 0;
        to.correct += from.correct || 0;
        to.wrong += from.wrong || 0;
        to.last = Math.max(to.last || 0, from.last || 0) || null;
        to.category = to.category || from.category;
        // merge series by date
        const map = new Map();
        (to.series || []).forEach(x => map.set(x.d, (map.get(x.d) || 0) + (x.c || 0)));
        (from.series || []).forEach(x => map.set(x.d, (map.get(x.d) || 0) + (x.c || 0)));
        to.series = Array.from(map.entries()).map(([d, c]) => ({ d, c })).sort((a,b)=>a.d.localeCompare(b.d));
        delete s.byId[k];
      }
    });
    // backfill metadata
    const e = s.byId[key];
    if (e) { e.id = q.id ?? e.id ?? null; e.title = q.question ?? e.title ?? ''; e.category = q.category ?? e.category; }
    return key;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function show(screen) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screen].classList.add('active');
  }

  function updateMenuStats() {
    const s = getStats();
    els.total.textContent = `${s.totalCorrect} / ${s.totalQuestions}`;
    els.attempts.textContent = `${s.attemptsCount}`;
    els.setName.textContent = `現在の問題セチE��: ${getSetName()}`;
    const v = document.getElementById('version');
    if (v) v.textContent = VERSION;
  }

  // Minimal YAML parser for simple structures used here
  function parseYAML(yaml) {
    const lines = yaml.replace(/\r\n?/g, '\n').split('\n');
    const root = { type: 'map', value: {}, indent: -1 };
    const stack = [root];

    const toValue = (raw) => {
      const v = (raw ?? '').trim();
      if (v === '' ) return '';
      if (v === 'null' || v === '~') return null;
      if (v === 'true') return true;
      if (v === 'false') return false;
      if (/^-?\d+(?:\.\d+)?$/.test(v)) return Number(v);
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
      return v;
    };

    for (const rawLine of lines) {
      if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
      const indent = rawLine.match(/^ */)[0].length;
      const line = rawLine.trim();
      while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
      const parent = stack[stack.length - 1];

      if (line.startsWith('- ')) {
        const val = line.slice(2).trim();
        if (!Array.isArray(parent.value)) parent.value = [];
        if (val.includes(':')) {
          const idx = val.indexOf(':');
          const obj = {};
          const k = val.slice(0, idx).trim();
          const v = val.slice(idx + 1).trim();
          if (v) obj[k] = toValue(v);
          parent.value.push(obj);
          stack.push({ type: 'map', value: obj, indent });
        } else if (val) {
          parent.value.push(toValue(val));
          stack.push({ type: 'item', value: toValue(val), indent });
        } else {
          const obj = {};
          parent.value.push(obj);
          stack.push({ type: 'map', value: obj, indent });
        }
      } else {
        const idx = line.indexOf(':');
        const key = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim();
        if (v) {
          if (Array.isArray(parent.value)) parent.value.push({ [key]: toValue(v) });
          else parent.value[key] = toValue(v);
        } else {
          const obj = {};
          if (Array.isArray(parent.value)) parent.value.push({ [key]: obj });
          else parent.value[key] = obj;
          stack.push({ type: 'map', value: obj, indent });
        }
      }
    }
    return root.value;
  }

  function normalizeData(data) {
    const list = Array.isArray(data) ? data : data?.questions;
    if (!Array.isArray(list)) throw new Error('不正なチE�Eタ形弁E questions 配�Eが見つかりません');
    return list.map((q, i) => {
      const question = q.question || q.text;
      const choices = q.choices || q.options;
      const answer = q.answer ?? q.correctIndex ?? q.correct;
      return {
        id: q.id ?? (i + 1),
        category: q.category || '一般',
        question: String(question),
        choices: Array.from(choices || []).map(String),
        answer: Number(answer),
        explanation: q.explanation ? String(q.explanation) : '',
      };
    });
  }

  async function loadFromFile(file) {
    const text = await file.text();
    const name = file.name.toLowerCase();
    let data;
    if (name.endsWith('.json')) data = JSON.parse(text);
    else if (name.endsWith('.yml') || name.endsWith('.yaml')) data = parseYAML(text);
    else throw new Error('未対応�E拡張子でぁE);
    const list = normalizeData(data);
    if (!list.length) throw new Error('問題がありません');
    questionBank = list;
    setSetName(file.name);
    updateMenuStats();
  }

  // Default questions (30)
  const DEFAULT_QUESTIONS = [
    { id: 1, category: '化学', question: '水の化学式�Eどれ！E, choices: ['HO', 'H2O', 'H2O2', 'OH2O'], answer: 1 },
    { id: 2, category: '化学', question: '食塩の主成�Eは�E�E, choices: ['NaCl', 'KCl', 'CaCO3', 'Na2CO3'], answer: 0 },
    { id: 3, category: '化学', question: 'pH=7 の水溶液は�E�E, choices: ['酸性', '中性', '塩基性', '強酸性'], answer: 1 },
    { id: 4, category: '化学', question: '炭酸の化学式�E�E�E, choices: ['HCO3∁E, 'H2CO3', 'CO2', 'CO3^2∁E], answer: 1 },
    { id: 5, category: '化学', question: 'アボガドロ定数のオーダーは�E�E, choices: ['10^19', '10^20', '10^23', '10^26'], answer: 2 },
    { id: 6, category: '化学', question: '酸化とは一般に何が増えること�E�E, choices: ['水素', '電孁E, '酸素', '中性孁E], answer: 2 },
    { id: 7, category: '化学', question: '塩酸の主成�Eは�E�E, choices: ['HCl', 'HNO3', 'H2SO4', 'CH3COOH'], answer: 0 },
    { id: 8, category: '化学', question: 'メタンの化学式�E�E�E, choices: ['CH4', 'C2H6', 'C3H8', 'CH3OH'], answer: 0 },
    { id: 9, category: '化学', question: 'イオン結合の例�Eどれ！E, choices: ['H2O', 'NaCl', 'CH4', 'CO2'], answer: 1 },
    { id: 10, category: '化学', question: '触媒�E働きは�E�E, choices: ['平衡を変えめE, '反応�Eを増やぁE, '活性化エネルギーを下げめE, '生�E物を増やぁE], answer: 2 },
    { id: 11, category: '人佁E, question: '赤血琁E�E主な働きは�E�E, choices: ['免疫', '酸素運搬', '血液凝固', 'ホルモン刁E��E], answer: 1 },
    { id: 12, category: '人佁E, question: '忁E��の忁E��はぁE��つ�E�E, choices: ['1', '2', '3', '4'], answer: 1 },
    { id: 13, category: '人佁E, question: 'インスリンを�E泌する臓器は�E�E, choices: ['肝臓', '膵臁E, '腎臓', '甲状腺'], answer: 1 },
    { id: 14, category: '人佁E, question: '神経伝達物質でなぁE��のは�E�E, choices: ['ド�Eパミン', 'アセチルコリン', 'セロトニン', 'ヘモグロビン'], answer: 3 },
    { id: 15, category: '人佁E, question: '呼吸で主に吸ぁE��体�E�E�E, choices: ['酸素', '窒素', '二�E化炭素', 'アルゴン'], answer: 1 },
    { id: 16, category: '人佁E, question: '骨の主成�Eは�E�E, choices: ['セルロース', 'キチン', 'ヒドロキシアパタイチE, 'ケラチン'], answer: 2 },
    { id: 17, category: '人佁E, question: '腎臓の機�E単位�E�E�E, choices: ['ニューロン', 'ネフロン', 'サルコメア', '肺胁E], answer: 1 },
    { id: 18, category: '人佁E, question: '血液凝固に関与する�Eは�E�E, choices: ['白血琁E, '赤血琁E, '血小板', 'リンパ球'], answer: 2 },
    { id: 19, category: '人佁E, question: '視覚�E受容体�Eどこ！E, choices: ['網膁E, '角�E', '虹彩', '水晶佁E], answer: 0 },
    { id: 20, category: '人佁E, question: '体温調節の中枢は�E�E, choices: ['小脳', '延髁E, '視床下部', '大脳皮質'], answer: 2 },
    { id: 21, category: '生物', question: '細胞�Eエネルギー通貨は�E�E, choices: ['NADH', 'ATP', 'GTP', 'ADP'], answer: 1 },
    { id: 22, category: '生物', question: 'DNAの塩基になぁE��のは�E�E, choices: ['アチE��ン', 'ウラシル', 'グアニン', 'シトシン'], answer: 1 },
    { id: 23, category: '生物', question: '光合成�E主な場は�E�E, choices: ['ミトコンドリア', '葉緑佁E, '小�E佁E, 'ゴルジ佁E], answer: 1 },
    { id: 24, category: '生物', question: '生物の刁E��で界�E直下�E�E�E, choices: ['網', '門', '私E, '屁E], answer: 1 },
    { id: 25, category: '生物', question: '原核生物になぁE��造は�E�E, choices: ['核膁E, '細胞�E', 'リボソーム', '細胞壁E], answer: 0 },
    { id: 26, category: '生物', question: '酵素活性に最も影響するのは�E�E, choices: ['允E, '温度とpH', '音', '圧劁E], answer: 1 },
    { id: 27, category: '生物', question: '浸透圧で正しいのは�E�E, choices: ['水は低濁E��へ', '溶質が移勁E, '水は高濁E��へ', '圧は温度に無関俁E], answer: 2 },
    { id: 28, category: '生物', question: '常染色体�E説明で正しいのは�E�E, choices: ['性決定�Eみ関丁E, '体細胞に存在', '減数刁E��で消失', 'ミトコンドリアにある'], answer: 1 },
    { id: 29, category: '生物', question: '相利共生�E例�E�E�E, choices: ['寁E��バチと宿主', 'コロナとヒト', '地衣顁E, 'ノミとイチE], answer: 2 },
    { id: 30, category: '生物', question: '生�E系の生産老E�E�E�E, choices: ['草食動物', '肉食動物', '刁E��老E, '光合成生物'], answer: 3 },
  ];

  let questionBank = DEFAULT_QUESTIONS.slice();
  let currentRound = [];
  let idx = 0;
  let correctCount = 0;
  let answered = false;
  let advanceTimer = null;
  let roundLog = [];

  function clearAdvanceTimer() {
    if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
  }

  function startRound() {
    clearAdvanceTimer();
    const pool = questionBank.slice();
    shuffle(pool);
    currentRound = pool.slice(0, ROUND_SIZE);
    idx = 0;
    correctCount = 0;
    roundLog = [];
    show('quiz');
    renderQuestion();
  }

  function renderQuestion() {
    clearAdvanceTimer();
    const q = currentRound[idx];
    els.progress.textContent = `${idx + 1} / ${ROUND_SIZE}`;
    els.category.textContent = q.category || '';
    els.question.textContent = q.question;
    els.choices.innerHTML = '';
    els.feedback.textContent = '';
    els.feedback.className = 'feedback';
    els.next.disabled = true;
    answered = false;

    q.choices.forEach((text, i) => {
      const btn = document.createElement('button');
      btn.className = 'choice';
      btn.textContent = text;
      btn.onclick = () => selectChoice(i);
      els.choices.appendChild(btn);
    });
  }

  function recordAnswer(q, isCorrect) {
    const s = getStats();
    const key = ensureEntryForQuestion(s, q);
    s.byId[key].attempts += 1;
    if (isCorrect) s.byId[key].correct += 1; else s.byId[key].wrong += 1;
    s.byId[key].last = Date.now();
    // per-day series compact counts
    const d = new Date();
    const today = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    const ser = s.byId[key].series || [];
    if (ser.length && ser[ser.length-1].d === today) ser[ser.length-1].c += 1; else ser.push({ d: today, c: 1 });
    s.byId[key].series = ser;
    const rec = s.byId[key].recent || [];
    rec.push({ ts: Date.now(), ok: isCorrect ? 1 : 0 });
    s.byId[key].recent = rec.slice(-50);
    setStats(s);
  }

  function selectChoice(choiceIndex) {
    if (answered) return;
    answered = true;
    const q = currentRound[idx];
    const nodes = Array.from(els.choices.children);
    nodes.forEach((n, i) => {
      n.disabled = true;
      if (i === q.answer) n.classList.add('correct');
      if (i === choiceIndex && choiceIndex !== q.answer) n.classList.add('wrong');
    });
    const isCorrect = choiceIndex === q.answer;
    if (isCorrect) {
      els.feedback.textContent = '正解�E�E;
      els.feedback.classList.add('ok');
      correctCount++;
      playCorrect();
    } else {
      els.feedback.textContent = '不正解';
      els.feedback.classList.add('ng');
      playWrong();
    }
    recordAnswer(q, isCorrect);
    // keep round log
    roundLog.push({ id: q.id, category: q.category, question: q.question, choices: q.choices.slice(), selected: choiceIndex, correct: q.answer, correctFlag: isCorrect });

    if (q.explanation) {
      const ex = document.createElement('div');
      ex.style.marginTop = '6px';
      ex.textContent = `解説: ${q.explanation}`;
      els.feedback.appendChild(ex);
    }
    els.next.disabled = false;
    const delay = isCorrect ? 500 : 1500;
    advanceTimer = setTimeout(() => { nextQuestion(); }, delay);
  }

  function nextQuestion() {
    if (idx + 1 < ROUND_SIZE) {
      idx++;
      renderQuestion();
    } else {
      endRound();
    }
  }

  function endRound() {
    clearAdvanceTimer();
    els.roundScore.textContent = `${correctCount} / ${ROUND_SIZE}`;
    const s = getStats();
    s.totalCorrect += correctCount;
    s.totalQuestions += ROUND_SIZE;
    s.attemptsCount += 1;
    s.attempts.unshift({ ts: Date.now(), correct: correctCount, total: ROUND_SIZE, set: getSetName() });
    s.attempts = s.attempts.slice(0, 200);
    setStats(s);
    // render review list
    if (els.roundReview) {
      els.roundReview.innerHTML = '';
      roundLog.forEach((r, i) => {
        const li = document.createElement('li');
        li.className = 'review-item';
        const left = document.createElement('div');
        const right = document.createElement('div');
        left.innerHTML = `<div class="meta">#${i + 1} ・ID ${r.id}・${r.category || ''}</div><div class="q">${r.question}</div>`;
        const your = r.choices[r.selected] ?? '-';
        const corr = r.choices[r.correct] ?? '-';
        right.innerHTML = r.correctFlag ? `<div class="correct">正解</div><small>${corr}</small>` : `<div class="wrong">不正解</div><small>あなぁE ${your}<br/>正解: ${corr}</small>`;
        li.appendChild(left); li.appendChild(right);
        els.roundReview.appendChild(li);
      });
    }
    show('result');
    updateMenuStats();
  }

  function showHistory() {
    const s = getStats();
    els.historyList.innerHTML = '';
    if (!s.attempts.length) {
      const li = document.createElement('li');
      li.textContent = 'まだ履歴がありません';
      els.historyList.appendChild(li);
    } else {
      s.attempts.forEach(a => {
        const li = document.createElement('li');
        const left = document.createElement('div');
        const right = document.createElement('div');
        const d = new Date(a.ts);
        left.innerHTML = `<strong>${a.correct} / ${a.total}</strong><br/><small>${d.toLocaleString()}・${a.set || 'セチE��'}</small>`;
        right.innerHTML = `<small>#${s.attempts.length - (s.attempts.indexOf(a))}</small>`;
        li.appendChild(left); li.appendChild(right);
        els.historyList.appendChild(li);
      });
    }
    show('history');
  }

  function showStats() {
    const s = getStats();
    els.statsList.innerHTML = '';
    const items = Object.values(s.byId || {});
    if (!items.length) {
      const li = document.createElement('li');
      li.textContent = 'まだ統計がありません';
      els.statsList.appendChild(li);
    } else {
      const mode = (document.getElementById('stats-sort')?.value) || 'id';
      items.sort((a,b) => {
        const accA = (a.attempts ? a.correct / a.attempts : 0);
        const accB = (b.attempts ? b.correct / b.attempts : 0);
        if (mode === 'wrong') return (b.wrong||0) - (a.wrong||0);
        if (mode === 'acc') return accA - accB;
        if (mode === 'recent') return (b.last||0) - (a.last||0);
        const ai = Number(a.id), bi = Number(b.id);
        if (!Number.isNaN(ai) && !Number.isNaN(bi)) return ai - bi;
        if (!Number.isNaN(ai)) return -1; if (!Number.isNaN(bi)) return 1;
        return String(a.title||'').localeCompare(String(b.title||''));
      });
      items.forEach(it => {
        const total = (it.attempts || 0);
        const acc = total ? Math.round(((it.correct || 0) / total) * 1000) / 10 : 0;
        const li = document.createElement('li');
        const series = (it.series || []).map(x => x.c).join(',');
        const labelId = (it.id != null && !Number.isNaN(Number(it.id))) ? `ID ${it.id}` : 'ID -';
        const title = it.title || '';
        li.innerHTML = `<div><strong>${labelId}</strong><br/><small>${it.category || ''}</small><br/><small class=\"meta\">${title}</small><br/><small class=\"meta\">${series}</small></div><div><strong>${acc}%</strong><br/><small>${it.correct||0}/${total} 正解・誤筁E${it.wrong||0}</small></div>`;
        els.statsList.appendChild(li);
      });
    }
    show('stats');
  }

  // Events
  els.start.addEventListener('click', startRound);
  els.again.addEventListener('click', startRound);
  els.menu.addEventListener('click', () => { clearAdvanceTimer(); show('menu'); updateMenuStats(); });
  els.exit.addEventListener('click', () => { clearAdvanceTimer(); show('menu'); updateMenuStats(); });
  els.next.addEventListener('click', nextQuestion);
  els.historyBtn.addEventListener('click', showHistory);
  els.historyBack.addEventListener('click', () => { clearAdvanceTimer(); show('menu'); });
  els.statsBtn?.addEventListener('click', showStats);
  els.statsBack?.addEventListener('click', () => { clearAdvanceTimer(); show('menu'); });
  document.getElementById('stats-sort')?.addEventListener('change', showStats); show('menu'); });

  els.file.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await loadFromFile(file);
      alert('問題セチE��を読み込みました');
    } catch (err) {
      console.error(err);
      alert('読み込みエラー: ' + (err?.message || err));
    } finally {
      e.target.value = '';
    }
  });

  // init
  updateMenuStats();
})();





