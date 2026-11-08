// ---------- State ----------
const WORDS_FILE = '_words';
let books = [];
let progress = Object.create(null); // bookId -> { answers: { key: { value } }, last: { c, s } }
let words = Object.create(null); // normalized word -> { added, note }

// Null-prototype dicts, so that saving a word like "constructor" can't collide with Object.prototype.
const dict = (o) => Object.assign(Object.create(null), o);

const app = document.getElementById('app');

// ---------- Helpers ----------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids.flat(Infinity).filter((x) => x != null && x !== false));
  return el;
}

const sectionUrl = (bookId, c, s) => `#/book/${encodeURIComponent(bookId)}/${c}/${s}`;
const testsUrl = (bookId, rest = '') => `#/tests/${encodeURIComponent(bookId)}${rest}`;

// ---------- Saving (queued, so an older save can never land after a newer one) ----------
let saveQueue = Promise.resolve();
function setStatus(text, isError = false) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}
function save(name, data) {
  const body = JSON.stringify(data);
  saveQueue = saveQueue
    .then(() => fetch(`/api/progress/${encodeURIComponent(name)}`, { method: 'PUT', body }))
    .then((res) => {
      if (!res.ok) throw new Error(res.status);
      setStatus('');
    })
    .catch(() => setStatus('Not saved. Is the server running?', true));
}

function bookProgress(bookId) {
  const p = (progress[bookId] ??= {});
  p.answers = dict(p.answers);
  p.tests ??= [];
  if (p.activeTest) p.activeTest.answers = dict(p.activeTest.answers);
  return p;
}

// ---------- Grading and progress ----------
const normText = (s) => String(s).normalize('NFC').trim().replace(/[.!?]+$/, '').replace(/’/g, "'").replace(/\s+/g, ' ').toLowerCase();

function grade(q, value) {
  if (value == null) return false;
  if (q.type === 'multiple') {
    return Array.isArray(value) && value.length === q.answer.length && q.answer.every((a) => value.includes(a));
  }
  if (q.type === 'fill') return [].concat(q.answer).some((a) => normText(a) === normText(value));
  return value === q.answer;
}

const formatAnswer = (q, value) => {
  if (q.type === 'fill') return [].concat(value).join(' / ');
  return [].concat(value).map((i) => q.options[i]).join(', ');
};
const answerText = (q) => formatAnswer(q, q.answer);

const qKey = (ch, sec, q) => `${ch.title} / ${sec.title} / ${q.q}`;

function sectionTally(book, ch, sec) {
  const { answers } = bookProgress(book.id);
  const done = sec.questions.filter((q) => grade(q, answers[qKey(ch, sec, q)]?.value)).length;
  return { done, total: sec.questions.length };
}
function sumTally(tallies) {
  return tallies.reduce((a, t) => ({ done: a.done + t.done, total: a.total + t.total }), { done: 0, total: 0 });
}
const chapterTally = (book, ch) => sumTally(ch.sections.map((sec) => sectionTally(book, ch, sec)));
const bookTally = (book) => sumTally(book.chapters.map((ch) => chapterTally(book, ch)));

function bar({ done, total }, label) {
  if (!total) return null;
  const pct = Math.round((done / total) * 100);
  return h('div', { className: 'bar-row' },
    h('div', { className: 'bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': label },
      h('div', { className: `fill${done === total ? ' full' : ''}`, style: `width:${pct}%` })),
    h('span', { className: 'count' }, `${done}/${total}`));
}

// ---------- Words and sentences ----------
const wordSeg = new Intl.Segmenter(undefined, { granularity: 'word' });
const sentenceSeg = new Intl.Segmenter(undefined, { granularity: 'sentence' });
const normWord = (w) => w.normalize('NFC').toLowerCase().replace(/’/g, "'");

// Calls onWord for each word and onGap for the punctuation and spaces between them.
function mapWords(text, onWord, onGap = (s) => s) {
  return Array.from(wordSeg.segment(text), ({ segment, isWordLike }) =>
    isWordLike ? onWord(segment, normWord(segment)) : onGap(segment));
}

function allSentencesFor() {
  const found = new Map();
  for (const book of books) {
    if (book.error) continue;
    book.chapters.forEach((ch, c) => ch.sections.forEach((sec, s) => {
      for (const para of sec.text) {
        for (const { segment } of sentenceSeg.segment(para)) {
          const present = new Set();
          mapWords(segment, (_, w) => { if (words[w]) present.add(w); });
          for (const w of present) {
            if (!found.has(w)) found.set(w, []);
            found.get(w).push({ text: segment.trim(), book, c, s, where: `${book.title}: ${ch.title} / ${sec.title}` });
          }
        }
      }
    }));
  }
  return found;
}

function updateWordsLink() {
  const n = Object.keys(words).length;
  document.getElementById('words-link').textContent = n ? `Words (${n})` : 'Words';
}

function addWord(w) {
  words[w] = { added: new Date().toISOString(), note: '' };
  save(WORDS_FILE, words);
  updateWordsLink();
}
function removeWord(w) {
  delete words[w];
  save(WORDS_FILE, words);
  updateWordsLink();
}

function onReadingClick(e) {
  const w = e.target.dataset?.w;
  if (!w || !window.getSelection().isCollapsed) return; // Selecting text to copy shouldn't save a word.
  if (words[w]?.note) {
    setStatus(`"${w}" has a note. Remove it from the Words page.`);
    return;
  }
  if (words[w]) removeWord(w);
  else addWord(w);
  app.querySelectorAll('.w').forEach((el) => {
    if (el.dataset.w === w) el.classList.toggle('fav', !!words[w]);
  });
}

// ---------- Views ----------
function renderLibrary() {
  if (!books.length) {
    app.replaceChildren(h('main', { className: 'page' },
      h('h1', {}, 'Your books'),
      h('p', { className: 'muted' }, 'No books yet. Add a JSON file to the books/ folder and reload.')));
    return;
  }
  app.replaceChildren(h('main', { className: 'page' },
    h('h1', {}, 'Your books'),
    books.map((book) => {
      if (book.error) {
        return h('div', { className: 'card' },
          h('h2', {}, `${book.id}.json`),
          h('p', { className: 'error' }, `Can't load this book: ${book.error}`));
      }
      const tally = bookTally(book);
      const last = lastPosition(book);
      return h('div', { className: 'card' },
        h('h2', {}, book.title),
        book.author && h('p', { className: 'muted' }, book.author),
        bar(tally, `${book.title} progress`),
        h('p', { className: 'actions' },
          h('a', { href: sectionUrl(book.id, last.c, last.s) }, tally.done || bookProgress(book.id).last ? 'Continue reading' : 'Start reading'),
          h('a', { href: testsUrl(book.id) }, bookProgress(book.id).activeTest ? 'Resume test' : 'Tests')));
    })));
}

function lastPosition(book) {
  const { c, s } = bookProgress(book.id).last ?? {};
  return book.chapters[c]?.sections[s] ? { c, s } : { c: 0, s: 0 };
}

function sidebar(book, curC, curS) {
  return [
    h('a', { className: 'book-title', href: '#/' }, book.title),
    bar(bookTally(book), 'Book progress'),
    h('a', { className: 'toc-tests', href: testsUrl(book.id) }, 'Tests'),
    book.chapters.map((ch, c) => h('div', { className: 'toc-chapter' },
      h('h3', {}, ch.title),
      bar(chapterTally(book, ch), `${ch.title} progress`),
      h('ol', {}, ch.sections.map((sec, s) => {
        const t = sectionTally(book, ch, sec);
        const current = c === curC && s === curS;
        return h('li', {},
          h('a', { href: sectionUrl(book.id, c, s), className: current ? 'current' : '', ...(current && { 'aria-current': 'page' }) },
            h('span', {}, sec.title),
            t.total > 0 && h('span', { className: `count${t.done === t.total ? ' complete' : ''}` },
              t.done === t.total ? '✓' : `${t.done}/${t.total}`)));
      })))),
  ];
}

function renderSection(book, c, s) {
  const ch = book.chapters[c];
  const sec = ch?.sections[s];
  if (!sec) return renderMissing();

  const p = bookProgress(book.id);
  if (p.last?.c !== c || p.last?.s !== s) {
    p.last = { c, s };
    save(book.id, p);
  }

  const nav = h('nav', { className: 'sidebar', 'aria-label': 'Chapters' }, sidebar(book, c, s));
  const sectionBar = h('div', {}, bar(sectionTally(book, ch, sec), 'Section progress'));
  const refresh = () => {
    nav.replaceChildren(...sidebar(book, c, s).flat(Infinity).filter(Boolean));
    sectionBar.replaceChildren(...[bar(sectionTally(book, ch, sec), 'Section progress')].filter(Boolean));
  };

  const flat = book.chapters.flatMap((chap, ci) => chap.sections.map((_, si) => ({ c: ci, s: si })));
  const i = flat.findIndex((x) => x.c === c && x.s === s);
  const prev = flat[i - 1];
  const next = flat[i + 1];

  app.replaceChildren(h('div', { className: 'layout' },
    nav,
    h('main', { className: 'content' },
      h('p', { className: 'muted eyebrow' }, ch.title),
      h('h1', {}, sec.title),
      sectionBar,
      h('div', { className: 'reading', onclick: onReadingClick },
        sec.text.map((para) => h('p', {}, mapWords(para, (raw, w) =>
          h('span', { className: `w${words[w] ? ' fav' : ''}`, 'data-w': w }, raw))))),
      sec.text.length > 0 && h('p', { className: 'muted hint' }, 'Click a word to save it. Saved words collect their sentences on the Words page.'),
      sec.questions.length > 0 && h('section', { 'aria-label': 'Questions' },
        h('h2', {}, 'Check your understanding'),
        sec.questions.map((q, n) => questionForm(book, ch, sec, q, n, refresh))),
      h('div', { className: 'pager' },
        prev ? h('a', { href: sectionUrl(book.id, prev.c, prev.s) }, '← Previous') : h('span'),
        next ? h('a', { href: sectionUrl(book.id, next.c, next.s) }, 'Next →') : h('span')))));
  window.scrollTo(0, 0);
}

function optionList(q, type, name, saved) {
  const isChecked = (i) => (type === 'checkbox' ? Array.isArray(saved) && saved.includes(i) : saved === i);
  return h('div', { className: 'options' }, q.options.map((opt, i) =>
    h('label', { className: 'option' },
      h('input', { type, name, value: i, checked: isChecked(i) }), h('span', {}, opt))));
}

function questionInput(q, name, saved) {
  if (q.type === 'single') return optionList(q, 'radio', name, saved);
  if (q.type === 'multiple') return optionList(q, 'checkbox', name, saved);
  if (q.type === 'dropdown') {
    return h('select', { name, 'aria-label': 'Your answer' },
      h('option', { value: '' }, 'Choose…'),
      q.options.map((opt, i) => h('option', { value: i, selected: saved === i }, opt)));
  }
  return h('input', { type: 'text', name, value: saved ?? '', autocomplete: 'off', 'aria-label': 'Your answer', placeholder: 'Type your answer' });
}

function readValue(q, form, name) {
  if (q.type === 'multiple') {
    const picked = [...form.querySelectorAll('input:checked')].map((el) => Number(el.value));
    return picked.length ? picked : null;
  }
  const raw = new FormData(form).get(name);
  if (raw == null || raw === '') return null;
  if (q.type === 'fill') return raw.trim() || null;
  return Number(raw);
}

function questionForm(book, ch, sec, q, n, onChange) {
  const key = qKey(ch, sec, q);
  const name = `q${n}`;
  const p = bookProgress(book.id);
  const feedback = h('div', { className: 'feedback', role: 'status' });

  function showFeedback(value) {
    if (grade(q, value)) {
      feedback.className = 'feedback good';
      feedback.replaceChildren(h('strong', {}, 'Correct.'), q.explain ? ` ${q.explain}` : '');
      return;
    }
    feedback.className = 'feedback bad';
    const reveal = h('button', {
      type: 'button',
      className: 'text-btn',
      onclick: () => reveal.replaceWith(h('span', {}, `Answer: ${answerText(q)}. ${q.explain ?? ''}`)),
    }, 'Show answer');
    feedback.replaceChildren(h('strong', {}, 'Not quite.'), ' Try again, or ', reveal);
  }

  const form = h('form', {
    className: 'question',
    onsubmit: (e) => {
      e.preventDefault();
      const value = readValue(q, form, name);
      if (value == null) {
        feedback.className = 'feedback';
        feedback.textContent = 'Give an answer first.';
        return;
      }
      p.answers[key] = { value };
      save(book.id, p);
      showFeedback(value);
      onChange();
    },
  },
    h('p', { className: 'prompt' }, h('span', { className: 'num' }, `${n + 1}.`), ' ', q.q),
    q.type === 'multiple' && h('p', { className: 'muted small' }, 'Select all that apply.'),
    questionInput(q, name, p.answers[key]?.value),
    h('div', { className: 'q-actions' }, h('button', { type: 'submit' }, 'Check')),
    feedback);

  if (p.answers[key]) showFeedback(p.answers[key].value);
  return form;
}

function highlighted(sentence, word) {
  return mapWords(sentence, (raw, w) => (w === word ? h('mark', {}, raw) : raw));
}

function renderWords() {
  const sentences = allSentencesFor();
  const entries = Object.entries(words).sort((a, b) => b[1].added.localeCompare(a[1].added));
  const input = h('input', { type: 'text', 'aria-label': 'Word to save', placeholder: 'Add a word', autocomplete: 'off' });
  const message = h('p', { className: 'muted small', role: 'status' });

  app.replaceChildren(h('main', { className: 'page' },
    h('h1', {}, 'Favorite words'),
    h('form', {
      className: 'add-word',
      onsubmit: (e) => {
        e.preventDefault();
        const found = mapWords(input.value, (_, w) => w).filter((x) => x.trim() && /[\p{L}\p{N}]/u.test(x));
        if (found.length !== 1) {
          message.textContent = 'Enter a single word.';
          return;
        }
        if (!words[found[0]]) addWord(found[0]);
        renderWords();
      },
    }, input, h('button', { type: 'submit' }, 'Add')),
    message,
    !entries.length && h('p', { className: 'muted' }, 'No saved words yet. Click any word while reading to save it.'),
    entries.map(([word, data]) => {
      const list = sentences.get(word) ?? [];
      return h('details', { className: 'card word', open: true },
        h('summary', {},
          h('span', { className: 'word-title' }, word),
          h('span', { className: 'muted small' }, list.length === 1 ? '1 sentence' : `${list.length} sentences`)),
        h('textarea', {
          value: data.note,
          rows: 2,
          placeholder: 'Your note',
          'aria-label': `Note for ${word}`,
          onchange: (e) => {
            data.note = e.target.value;
            save(WORDS_FILE, words);
          },
        }),
        list.length
          ? h('ul', { className: 'sentences' }, list.map((item) => h('li', {},
              h('p', {}, highlighted(item.text, word)),
              h('a', { className: 'muted small', href: sectionUrl(item.book.id, item.c, item.s) }, item.where))))
          : h('p', { className: 'muted small' }, 'This exact word is not in any book yet.'),
        h('button', {
          type: 'button',
          className: 'text-btn',
          onclick: () => {
            removeWord(word);
            renderWords();
          },
        }, 'Remove word'));
    })));
  window.scrollTo(0, 0);
}

// ---------- Tests ----------
// An unfinished test is stored as progress.activeTest and a finished one is appended to
// progress.tests. Test answers are kept apart from the practice answers behind the progress bars.
let testTimer = null;
let testSaveTimer = null;

function questionsByKey(book) {
  const byKey = new Map();
  book.chapters.forEach((ch, c) => ch.sections.forEach((sec, s) => sec.questions.forEach((q) => {
    const key = qKey(ch, sec, q);
    if (!byKey.has(key)) byKey.set(key, { key, q, c, s, where: `${ch.title} / ${sec.title}` });
  })));
  return byKey;
}

function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function finishTest(book, timedOut = false) {
  const p = bookProgress(book.id);
  const test = p.activeTest;
  const byKey = questionsByKey(book);
  // Snapshot the question text so old results stay readable after the book is edited.
  const items = test.keys.filter((key) => byKey.has(key)).map((key) => {
    const { q, where } = byKey.get(key);
    const value = test.answers[key]?.value ?? null;
    return {
      q: q.q,
      where,
      yours: value == null ? null : formatAnswer(q, value),
      correctAnswer: answerText(q),
      ok: grade(q, value),
      explain: q.explain ?? null,
    };
  });
  const result = {
    id: test.id,
    label: test.label,
    startedAt: test.startedAt,
    finishedAt: new Date().toISOString(),
    limitMinutes: test.limitMinutes,
    timedOut,
    score: items.filter((item) => item.ok).length,
    total: items.length,
    items,
  };
  p.tests.push(result);
  delete p.activeTest;
  save(book.id, p);
  return result;
}

function finishExpiredTests() {
  for (const book of books) {
    if (book.error) continue;
    const { activeTest } = bookProgress(book.id);
    if (activeTest?.deadline && Date.now() >= activeTest.deadline) {
      finishTest(book, true);
      setStatus(`Time ran out on "${activeTest.label}". Your answers were scored.`);
    }
  }
}

const formatClock = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const clock = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return hours ? `${hours}:${clock}` : clock;
};
const formatDate = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const percent = ({ score, total }) => (total ? Math.round((score / total) * 100) : 0);

function renderTests(book) {
  const p = bookProgress(book.id);
  const backLink = h('a', { href: `#/` }, '← Your books');
  const history = [...p.tests].reverse();

  const historyBlock = history.length > 0 && h('section', { className: 'history' },
    h('h2', {}, 'Past tests'),
    h('ul', {}, history.map((t) => h('li', {},
      h('a', { href: testsUrl(book.id, `/result/${t.id}`) }, t.label),
      h('span', { className: 'muted small' }, formatDate(t.finishedAt)),
      h('span', { className: 'score' }, `${t.score}/${t.total} (${percent(t)}%)`)))));

  if (p.activeTest) {
    app.replaceChildren(h('main', { className: 'page' },
      backLink,
      h('h1', {}, `Tests: ${book.title}`),
      h('div', { className: 'card' },
        h('h2', {}, 'Unfinished test'),
        h('p', {}, p.activeTest.label),
        p.activeTest.deadline && h('p', { className: 'muted small' }, `${formatClock(p.activeTest.deadline - Date.now())} left. The timer keeps running while you're away.`),
        h('p', { className: 'actions' },
          h('a', { href: testsUrl(book.id, '/run') }, 'Resume test'),
          h('button', {
            type: 'button',
            className: 'text-btn',
            onclick: () => {
              delete p.activeTest;
              save(book.id, p);
              renderTests(book);
            },
          }, 'Discard it'))),
      historyBlock));
    window.scrollTo(0, 0);
    return;
  }

  const all = [...questionsByKey(book).values()];
  if (!all.length) {
    app.replaceChildren(h('main', { className: 'page' },
      backLink,
      h('h1', {}, `Tests: ${book.title}`),
      h('p', { className: 'muted' }, 'This book has no questions yet.')));
    return;
  }

  const type = h('select', { name: 'type' },
    h('option', { value: 'section' }, 'Section test'),
    h('option', { value: 'chapter' }, 'Chapter test'),
    h('option', { value: 'final', selected: true }, 'Final test (whole book)'),
    h('option', { value: 'random' }, 'Random test (from the whole book)'));
  const chapterPick = h('select', { name: 'chapter' }, book.chapters.flatMap((ch, c) =>
    (all.some((x) => x.c === c) ? [h('option', { value: c }, ch.title)] : [])));
  const sectionPick = h('select', { name: 'section' }, book.chapters.flatMap((ch, c) =>
    ch.sections.flatMap((sec, s) =>
      (all.some((x) => x.c === c && x.s === s) ? [h('option', { value: `${c}.${s}` }, `${ch.title} / ${sec.title}`)] : []))));
  const count = h('input', { type: 'number', name: 'count', min: 1, step: 1, required: true });
  const minutes = h('input', { type: 'number', name: 'minutes', min: 0, step: 'any', value: 0, required: true });
  const available = h('span', { className: 'muted small' });
  const chapterField = h('label', { className: 'field' }, h('span', {}, 'Chapter'), chapterPick);
  const sectionField = h('label', { className: 'field' }, h('span', {}, 'Section'), sectionPick);

  function currentPool() {
    if (type.value === 'chapter') return all.filter((x) => x.c === Number(chapterPick.value));
    if (type.value === 'section') {
      const [c, s] = sectionPick.value.split('.').map(Number);
      return all.filter((x) => x.c === c && x.s === s);
    }
    return all;
  }
  function currentLabel() {
    if (type.value === 'chapter') return `Chapter test: ${chapterPick.selectedOptions[0].textContent}`;
    if (type.value === 'section') return `Section test: ${sectionPick.selectedOptions[0].textContent}`;
    return type.value === 'final' ? 'Final test' : 'Random test';
  }
  function refreshPool() {
    chapterField.hidden = type.value !== 'chapter';
    sectionField.hidden = type.value !== 'section';
    const size = currentPool().length;
    count.max = size;
    count.value = type.value === 'random' ? Math.min(10, size) : size;
    available.textContent = `${size} available`;
  }
  [type, chapterPick, sectionPick].forEach((el) => el.addEventListener('change', refreshPool));
  refreshPool();

  app.replaceChildren(h('main', { className: 'page' },
    backLink,
    h('h1', {}, `Tests: ${book.title}`),
    h('form', {
      className: 'card test-setup',
      onsubmit: (e) => {
        e.preventDefault();
        const limitMinutes = Number(minutes.value);
        p.activeTest = {
          id: Date.now().toString(36),
          label: currentLabel(),
          startedAt: new Date().toISOString(),
          limitMinutes,
          deadline: limitMinutes > 0 ? Date.now() + limitMinutes * 60000 : null,
          keys: shuffled(currentPool()).slice(0, Number(count.value)).map((x) => x.key),
          answers: dict({}),
        };
        save(book.id, p);
        location.hash = testsUrl(book.id, '/run');
      },
    },
      h('label', { className: 'field' }, h('span', {}, 'Type of test'), type),
      chapterField,
      sectionField,
      h('label', { className: 'field' }, h('span', {}, 'Number of questions'), count, available),
      h('label', { className: 'field' }, h('span', {}, 'Time limit in minutes (0 for no limit)'), minutes),
      h('button', { type: 'submit' }, 'Start test')),
    historyBlock));
  window.scrollTo(0, 0);
}

function renderTestRun(book) {
  const p = bookProgress(book.id);
  const test = p.activeTest;
  if (!test) {
    location.replace(testsUrl(book.id));
    return;
  }
  const byKey = questionsByKey(book);
  const keys = test.keys.filter((key) => byKey.has(key));

  const answeredCount = () => keys.filter((key) => test.answers[key]).length;
  const progressLabel = h('span', { className: 'count' });
  const updateCount = () => { progressLabel.textContent = `${answeredCount()}/${keys.length} answered`; };
  updateCount();

  const finish = (timedOut) => {
    clearInterval(testTimer);
    clearTimeout(testSaveTimer);
    const result = finishTest(book, timedOut);
    location.hash = testsUrl(book.id, `/result/${result.id}`);
  };

  const clock = h('span', { className: 'clock', role: 'timer' });
  if (test.deadline) {
    const tick = () => {
      const left = test.deadline - Date.now();
      clock.textContent = formatClock(left);
      clock.classList.toggle('low', left < 60000);
      if (left <= 0) finish(true);
    };
    tick();
    testTimer = setInterval(tick, 500);
  }

  const finishNote = h('p', { className: 'muted small', role: 'status' });
  let confirming = false;

  app.replaceChildren(h('main', { className: 'page' },
    h('div', { className: 'test-bar' },
      h('strong', {}, test.label), progressLabel, test.deadline && clock),
    keys.map((key, n) => {
      const { q } = byKey.get(key);
      const name = `q${n}`;
      const form = h('form', {
        className: 'question',
        onsubmit: (e) => e.preventDefault(),
        oninput: () => {
          const value = readValue(q, form, name);
          if (value == null) delete test.answers[key];
          else test.answers[key] = { value };
          updateCount();
          confirming = false;
          finishNote.textContent = '';
          clearTimeout(testSaveTimer);
          testSaveTimer = setTimeout(() => save(book.id, p), 400);
        },
      },
        h('p', { className: 'prompt' }, h('span', { className: 'num' }, `${n + 1}.`), ' ', q.q),
        q.type === 'multiple' && h('p', { className: 'muted small' }, 'Select all that apply.'),
        questionInput(q, name, test.answers[key]?.value));
      return form;
    }),
    finishNote,
    h('button', {
      type: 'button',
      onclick: () => {
        const missing = keys.length - answeredCount();
        if (missing && !confirming) {
          confirming = true;
          finishNote.textContent = `${missing} unanswered. Select Finish test again to submit anyway.`;
          return;
        }
        finish(false);
      },
    }, 'Finish test')));
  window.scrollTo(0, 0);
}

function renderTestResult(book, id) {
  const t = bookProgress(book.id).tests.find((x) => x.id === id);
  if (!t) return renderMissing();
  const used = new Date(t.finishedAt) - new Date(t.startedAt);
  app.replaceChildren(h('main', { className: 'page' },
    h('a', { href: testsUrl(book.id) }, '← Tests'),
    h('h1', {}, t.label),
    h('p', { className: 'big-score' }, `${t.score}/${t.total}`, h('span', { className: 'muted' }, ` ${percent(t)}%`)),
    h('p', { className: 'muted small' }, [
      formatDate(t.finishedAt),
      `Time used ${formatClock(used)}`,
      t.limitMinutes > 0 && `Limit ${t.limitMinutes} min`,
      t.timedOut && 'Time ran out',
    ].filter(Boolean).join(' · ')),
    t.items.map((item, n) => h('div', { className: `question result ${item.ok ? 'right' : 'wrong'}` },
      h('p', { className: 'prompt' }, h('span', { className: 'num' }, `${n + 1}.`), ' ', item.q),
      h('p', { className: 'muted small' }, item.where),
      h('p', {}, item.ok ? '✓ ' : '✗ ', `Your answer: ${item.yours ?? 'No answer'}`),
      !item.ok && h('p', {}, `Correct answer: ${item.correctAnswer}`),
      item.explain && h('p', { className: 'muted' }, item.explain)))));
  window.scrollTo(0, 0);
}

function renderMissing() {
  app.replaceChildren(h('main', { className: 'page' },
    h('h1', {}, 'Page not found'),
    h('a', { href: '#/' }, 'Back to your books')));
}

function route() {
  clearInterval(testTimer);
  finishExpiredTests();
  const [, view, id, c, s] = location.hash.split('/');
  if (!view) return renderLibrary();
  if (view === 'words') return renderWords();
  if (view === 'tests') {
    const book = books.find((b) => b.id === decodeURIComponent(id) && !b.error);
    if (book && !c) return renderTests(book);
    if (book && c === 'run') return renderTestRun(book);
    if (book && c === 'result') return renderTestResult(book, s);
  }
  if (view === 'book') {
    const book = books.find((b) => b.id === decodeURIComponent(id) && !b.error);
    if (book) return renderSection(book, Number(c), Number(s));
  }
  renderMissing();
}

// ---------- Start ----------
async function start() {
  const [booksRes, progressRes] = await Promise.all([fetch('/api/books'), fetch('/api/progress')]);
  const saved = await progressRes.json();
  if (!booksRes.ok || !progressRes.ok) throw new Error(saved.error ?? 'The server returned an error.');
  books = await booksRes.json();
  words = dict(saved[WORDS_FILE]);
  delete saved[WORDS_FILE];
  progress = dict(saved);
  updateWordsLink();
  addEventListener('hashchange', route);
  route();
}

start().catch((err) => {
  // Stop here rather than continue with empty data, which a later save would write over real progress.
  app.replaceChildren(h('main', { className: 'page' },
    h('h1', {}, "Couldn't load your data"),
    h('p', { className: 'error' }, err.message)));
});
