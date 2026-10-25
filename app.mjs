import { parseNeteaseInput, parseLyrics, makeSession, isValidSession, submitAnswer, revealAnswer, continueAfterReveal, getModes, sameModes, bestKey, answerIndexes, lyricInitials } from './core.mjs';
import { NeteaseClient, safeHttps } from './api.mjs';
import { loadState, saveState, STORAGE_KEY } from './storage.mjs';
import { MAX_LIBRARY, MAX_BATCH } from './config.mjs';

const api = new NeteaseClient();
const restored = loadState();
let state = restored.state;
let view = state.activeId ? 'game' : 'home';
let query = '';
let results = [];
let resultTitle = '';
let searchError = '';
let searching = false;
let searchController = null;
let searchSerial = 0;
let batchRunning = false;
let feedback = null;
const importing = new Set();
const main = document.querySelector('#main');
const paths = {
  search: 'm21 21-4.4-4.4M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  music: 'M9 18V5l12-2v13M9 9l12-2M9 18a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Zm12-2a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Z',
  check: 'm5 12 4 4L19 6',
  plus: 'M12 5v14M5 12h14',
  link: 'm10 13 4-4M8 16l-1 1a4.2 4.2 0 0 1-6-6l4-4a4.2 4.2 0 0 1 6 0m2 1 1-1a4.2 4.2 0 0 1 6 6l-4 4a4.2 4.2 0 0 1-6 0',
  back: 'M20 12H4m6-6-6 6 6 6',
  replay: 'M3 11a9 9 0 1 1 2.6 7M3 4v7h7',
  bin: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  book: 'M12 6v15M3 3c5-1 7 0 9 3 2-3 4-4 9-3v16c-5-1-7 0-9 2-2-2-4-3-9-2Z',
};

function icon(name, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: `icon ${className}` })) svg.setAttribute(key, value);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[name] || paths.music);
  svg.append(path);
  return svg;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'value') node.value = value;
    else if (key === 'disabled') node.disabled = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}

function button(text, className, action, iconName = '') {
  const node = el('button', { class: className, type: 'button' }, iconName ? icon(iconName) : null, text);
  node.addEventListener('click', action);
  return node;
}

let toastTimer;
function toast(message) {
  const node = document.querySelector('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 5000);
}

let storageWarningShown = false;
function persist() {
  if (!saveState(state) && !storageWarningShown) {
    storageWarningShown = true;
    toast('浏览器未能保存数据。本次可以继续，关闭页面后进度可能丢失。');
  }
}

function navigate(next) {
  view = next;
  feedback = null;
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function cover(song, large = false) {
  const holder = el('div', { class: `song-art ${large ? 'large' : ''}`, 'aria-hidden': 'true' }, icon('music'));
  const url = safeHttps(song.cover);
  if (url) {
    const img = el('img', { src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.remove(), { once: true });
    holder.append(img);
  }
  return holder;
}

function songById(id) { return state.library.find(song => song.id === String(id)); }

function startSong(song, { random = false, restart = false, resume = false } = {}) {
  const existing = state.sessions[song.id];
  if (resume && isValidSession(existing, song)) state.preferences = getModes(existing);
  if (restart || random || !isValidSession(existing, song) || existing.phase === 'complete' || !sameModes(existing, state.preferences)) {
    const start = random ? Math.floor(Math.random() * (song.lines.length - 1)) : 0;
    state.sessions[song.id] = makeSession(song, start, state.preferences);
  }
  state.activeId = song.id;
  persist();
  navigate('game');
  focusAnswer();
}

async function prepareSong(song, play = false) {
  const cached = songById(song.id);
  if (cached) { if (play) startSong(cached); else toast('这首歌已经在曲库里了。'); return cached; }
  if (importing.has(song.id)) return null;
  if (state.library.length >= MAX_LIBRARY) { toast(`曲库最多保存 ${MAX_LIBRARY} 首歌，请先移除一些歌曲。`); return null; }
  importing.add(song.id);
  if (view !== 'game') render();
  try {
    const { raw, provider } = await api.lyrics(song);
    const { lines, revision, metadata } = parseLyrics(raw, song);
    if (state.library.length >= MAX_LIBRARY) throw new Error('曲库已满，请先移除一些歌曲再试。');
    const saved = { ...song, name: song.name || metadata.ti || `网易云歌曲 ${song.id}`, artist: song.artist || metadata.ar || '未知歌手', lines, revision, metadata, provider, importedAt: Date.now() };
    state.library.unshift(saved);
    persist();
    if (play) startSong(saved);
    else { toast(`《${saved.name}》已加入曲库。`); if (view !== 'game') render(); }
    return saved;
  } catch (error) {
    toast(error.message || '读取歌词失败，请稍后重试。');
    return null;
  } finally {
    importing.delete(song.id);
    if (view !== 'game') render();
  }
}

async function performSearch(input) {
  let parsed;
  try { parsed = parseNeteaseInput(input); } catch (error) { searchError = error.message; render(); document.querySelector('#song-search')?.focus(); return; }
  searchController?.abort();
  searchController = new AbortController();
  const controller = searchController;
  const serial = ++searchSerial;
  query = input.trim();
  view = 'home';
  searching = true;
  searchError = '';
  results = [];
  resultTitle = parsed.type === 'playlist' ? '正在读取网易云歌单' : parsed.type === 'song' ? '正在读取网易云歌曲' : `搜索「${parsed.query}」`;
  render();
  try {
    let songs;
    if (parsed.type === 'song') {
      const cached = songById(parsed.id);
      let song = cached;
      if (!song) {
        try { song = await api.song(parsed.id, { signal: controller.signal }); }
        catch (error) {
          if (controller.signal.aborted) throw error;
          // Metadata outages should not prevent fetching an existing song's lyrics.
          song = { id: parsed.id, lyricId: parsed.id, name: `网易云歌曲 ${parsed.id}`, artist: '网易云音乐', source: 'netease', cover: '', album: '' };
        }
      }
      songs = [song];
    } else if (parsed.type === 'playlist') songs = await api.playlist(parsed.id, { signal: controller.signal });
    else songs = await api.search(parsed.query, { signal: controller.signal });
    if (serial !== searchSerial || controller.signal.aborted) return;
    results = songs;
    resultTitle = parsed.type === 'playlist' ? `网易云歌单 · ${songs.length} 首` : parsed.type === 'song' ? '找到了这首歌' : `「${parsed.query}」的搜索结果`;
    if (!songs.length) searchError = '没有找到匹配的歌曲，试试加上歌手名，或粘贴歌曲链接。';
  } catch (error) {
    if (serial === searchSerial && !controller.signal.aborted) searchError = error.message || '读取失败，请稍后重试。';
  } finally {
    if (serial === searchSerial) {
      searching = false;
      if (view === 'home') render();
    }
  }
}

async function importBatch() {
  if (batchRunning) return;
  const songs = results.filter(song => !songById(song.id)).slice(0, Math.min(MAX_BATCH, MAX_LIBRARY - state.library.length));
  if (!songs.length) { toast('这些歌曲已经在曲库里了。'); return; }
  batchRunning = true;
  render();
  let count = 0;
  try {
    // Sequential imports avoid overwhelming shared lyric providers.
    for (const song of songs) if (await prepareSong(song)) count++;
    toast(`已加入 ${count} / ${songs.length} 首歌曲。${count < songs.length ? '部分歌曲暂无可用歌词，可稍后重试。' : ''}`);
  } finally { batchRunning = false; if (view !== 'game') render(); }
}

function searchBox() {
  const input = el('input', { id: 'song-search', type: 'search', placeholder: '搜索歌名 / 歌手，或粘贴网易云链接', autocomplete: 'off', maxlength: '600', value: query, 'aria-label': '歌名、歌手、网易云歌曲或歌单链接' });
  input.addEventListener('input', () => { query = input.value; });
  const submit = el('button', { type: 'submit', class: 'button primary search-submit' }, searching ? el('span', { class: 'spinner', 'aria-hidden': 'true' }) : icon('search'), searching ? '读取中' : '找一首歌');
  const form = el('form', { class: 'search-form', role: 'search' }, el('span', { class: 'search-leading' }, icon('search')), input, submit);
  form.addEventListener('submit', event => { event.preventDefault(); if (!event.isComposing) performSearch(input.value); });
  const box = el('section', { class: 'search-section', 'aria-label': '查找歌曲' }, form,
    el('div', { class: 'search-under' }, el('p', {}, icon('link'), '支持歌曲链接、歌曲 ID 和公开歌单链接'),
      el('div', { class: 'quick-search' }, '试试：', ...['周杰伦', '陈奕迅', '孙燕姿'].map(keyword => button(keyword, 'text-button', () => performSearch(keyword))))));
  if (searchError) box.append(el('div', { class: 'notice error', role: 'alert' }, searchError));
  return box;
}

function resultRow(song, index) {
  const cached = songById(song.id);
  const busy = importing.has(song.id);
  const add = button(cached ? '已加入' : '加入曲库', `button ${cached ? 'added' : 'secondary'} small`, () => prepareSong(song), cached ? 'check' : 'plus');
  add.disabled = Boolean(cached || busy || batchRunning);
  const play = button(busy ? '读取歌词中…' : (state.sessions[song.id]?.phase === 'playing' && sameModes(state.sessions[song.id], state.preferences) ? '继续接龙' : '开始接龙'), 'button primary small', () => prepareSong(song, true), busy ? '' : 'arrow');
  play.disabled = busy || batchRunning;
  if (busy) play.prepend(el('span', { class: 'spinner', 'aria-hidden': 'true' }));
  return el('li', { class: 'result-row' }, el('span', { class: 'row-index' }, String(index + 1).padStart(2, '0')), cover(song),
    el('div', { class: 'song-info' }, el('h3', {}, song.name), el('p', {}, song.artist, song.album ? el('span', { class: 'album' }, ` · ${song.album}`) : null)),
    el('div', { class: 'song-actions' }, add, play));
}

function modeName(modes) {
  const { answerMode, chainMode } = getModes(modes);
  return `${answerMode === 'initials' ? '简易模式' : '标准模式'} · ${chainMode === 'hinted' ? '提示一句接一句' : '连续接龙'}`;
}

function bestForSong(song, modes = state.preferences) { return state.best[bestKey(song.id, modes)] || 0; }

function modePicker(song = null) {
  const modes = getModes(song ? state.sessions[song.id] : state.preferences);
  const groups = [
    ['answerMode', '答题方式', [['full', '标准模式 · 完整歌词'], ['initials', '简易模式 · 拼音首字母']]],
    ['chainMode', '接龙方式', [['continuous', '连续接龙'], ['hinted', '提示模式 · 提示一句接一句']]],
  ];
  const picker = el('section', { class: 'mode-picker', 'aria-label': '接龙模式' },
    el('div', { class: 'mode-heading' }, el('strong', {}, '选择玩法'), el('span', {}, song ? '切换模式会从头开始，纪录按模式保存' : '两种选项可以自由组合')),
    el('div', { class: 'mode-groups' }, ...groups.map(([key, legend, options]) => el('fieldset', {}, el('legend', {}, legend),
      el('div', { class: 'mode-options' }, ...options.map(([value, label]) => {
        const input = el('input', { type: 'radio', name: key, value, checked: modes[key] === value });
        input.addEventListener('change', () => {
          state.preferences = { ...modes, [key]: value };
          if (song) startSong(song, { restart: true }); else { persist(); render(); }
        });
        return el('label', { class: modes[key] === value ? 'mode-option selected' : 'mode-option' }, input, el('span', {}, label));
      }))))),
    el('p', { class: 'mode-description' }, modes.chainMode === 'hinted' ? '网页给第 1 句 → 你接第 2 句 → 网页给第 3 句 → 你接第 4 句。' : '网页给出首句，你逐句往下接，直到整首结束。'),
    modes.answerMode === 'initials' ? el('p', { class: 'mode-description' }, '汉字逐字输入拼音首字母，例如“我爱你”填 wan；英文、数字和其他文字保留原文，忽略标点和空格。') : null);
  return song ? el('details', { class: 'game-mode-settings' }, el('summary', {}, el('span', {}, modeName(modes)), el('span', {}, '更改模式')), picker) : picker;
}

function renderHome() {
  const hero = el('section', { class: 'hero' },
    el('div', { class: 'hero-copy' }, el('span', { class: 'hero-label' }, el('span', { class: 'status-dot' }), '网易云歌词接龙'),
      el('h1', {}, '下一句，', el('br'), el('span', {}, '交给你。')),
      el('p', { class: 'hero-description' }, '有些歌，一开口就会想起。', el('br'), '找一首熟悉的歌，看看你能接到第几句。'),
      el('div', { class: 'hero-tags' }, el('span', {}, icon('check'), '完整下一句'), el('span', {}, icon('check'), '随时继续'), el('span', {}, icon('check'), '无需登录'))),
    el('div', { class: 'hero-art', 'aria-hidden': 'true' },
      el('span', { class: 'orbit-note note-one' }, '♪'), el('span', { class: 'orbit-note note-two' }, '♫'),
      el('div', { class: 'record-sleeve' }, el('div', { class: 'sleeve-top' }, 'RHYTHM', el('span', {}, 'SIDE A')),
        el('div', { class: 'vinyl' }, el('div', { class: 'record-center' }, el('div', { class: 'tiny-bars' }, ...[1, 2, 3, 4].map(() => el('i'))))),
        el('div', { class: 'sleeve-bottom' }, el('span', {}, 'YOUR NEXT LINE'), el('span', {}, '01 / ∞'))),
      el('div', { class: 'art-caption' }, el('span', { class: 'caption-line' }), '熟悉的歌，总有下一句')));
  main.append(hero, modePicker(), searchBox());
  if (searching || results.length || resultTitle) {
    const section = el('section', { class: 'results-section', 'aria-label': '歌曲搜索结果', 'aria-busy': searching });
    const title = el('div', { class: 'section-heading' }, el('div', {}, el('span', { class: 'eyebrow' }, 'FIND YOUR SONG'), el('h2', {}, resultTitle)));
    if (results.length > 1) {
      const addAll = button(batchRunning ? '正在加入…' : `批量加入（最多 ${MAX_BATCH} 首）`, 'button secondary small', importBatch, 'plus');
      addAll.disabled = batchRunning || importing.size > 0;
      title.append(addAll);
    }
    section.append(title);
    if (searching) section.append(el('div', { class: 'search-loading', role: 'status' }, el('span', { class: 'spinner' }), '正在网易云中找歌…'));
    else if (results.length) section.append(el('ul', { class: 'result-list' }, results.map(resultRow)));
    main.append(section);
  } else {
    main.append(el('section', { class: 'how-strip', 'aria-label': '三步开始' },
      ...[['01', '选一首歌', '搜索歌名，或带来你的网易云歌单。'], ['02', '接住下一句', '选完整歌词或拼音首字母，不用纠结标点。'], ['03', '一直唱下去', '一句一句接到最后，留下你的连击纪录。']].map(([n, title, description]) => el('div', { class: 'how-item' }, el('span', { class: 'step-number' }, n), el('div', {}, el('h3', {}, title), el('p', {}, description))))));
  }
  const activeSong = songById(state.activeId);
  if (activeSong && state.sessions[activeSong.id]?.phase === 'playing') {
    const session = state.sessions[activeSong.id];
    main.append(el('section', { class: 'resume-banner' }, el('div', {}, el('span', { class: 'eyebrow' }, 'PICK UP WHERE YOU LEFT OFF'), el('h3', {}, `《${activeSong.name}》还等着你的下一句`), el('p', {}, `${modeName(session)} · 已接对 ${session.correct} 句`)), button('继续上次的接龙', 'button primary', () => startSong(activeSong, { resume: true }), 'arrow')));
  }
  if (state.library.length) renderLibraryPreview();
}

function renderLibraryPreview() {
  main.append(el('section', { class: 'library-preview' }, el('div', { class: 'section-heading' }, el('div', {}, el('span', { class: 'eyebrow' }, 'YOUR COLLECTION'), el('h2', {}, '熟悉的歌，随时再接')), button('查看全部', 'text-button more-button', () => navigate('library'), 'arrow')),
    el('div', { class: 'song-grid' }, state.library.slice(0, 3).map(song => libraryCard(song, false)))));
}

function removeSong(song) {
  state.library = state.library.filter(item => item.id !== song.id);
  delete state.sessions[song.id];
  for (const key of Object.keys(state.best)) if (key.startsWith(`${song.id}:`)) delete state.best[key];
  if (state.activeId === song.id) state.activeId = null;
  persist();
  render();
  toast(`已移除《${song.name}》，可以随时从网易云重新加入。`);
}

function libraryCard(song, removable = true) {
  const session = state.sessions[song.id];
  const continuing = session?.phase === 'playing' && sameModes(session, state.preferences);
  const play = button(continuing ? '继续接龙' : '从头开始', 'button primary small', () => startSong(song), 'arrow');
  return el('article', { class: 'library-card' },
    el('div', { class: 'card-top' }, cover(song, true), removable ? button('移除', 'text-button remove-button', () => removeSong(song), 'bin') : el('span', { class: 'collection-label' }, 'NETEASE')),
    el('h3', {}, song.name), el('p', { class: 'card-artist' }, song.artist),
    el('div', { class: 'card-meta' }, el('span', {}, `${song.lines.length} 句原文`), el('span', {}, `本模式最佳 ${bestForSong(song)}`)),
    continuing ? el('div', { class: 'mini-progress', 'aria-label': `进度 ${session.nextIndex} / ${song.lines.length}` }, el('span', { style: `width:${(session.nextIndex / song.lines.length) * 100}%` })) : el('div', { class: 'card-divider' }),
    el('div', { class: 'card-actions' }, button('随机一句', 'text-button', () => startSong(song, { random: true })), play));
}

function renderLibrary() {
  const best = Math.max(0, ...state.library.map(song => bestForSong(song)));
  main.append(el('section', { class: 'page-heading' }, el('span', { class: 'eyebrow' }, 'YOUR COLLECTION'), el('h1', {}, '我的曲库', el('span', { class: 'heading-count' }, state.library.length)), el('p', {}, '喜欢的歌留在这里，想起来就接着唱。')),
    el('div', { class: 'collection-toolbar' }, el('span', {}, `${state.library.length} 首歌曲`, el('span', { class: 'toolbar-dot' }, '·'), `本模式最佳连击 ${best}`), button('再找一首歌', 'button primary small', () => { navigate('home'); document.querySelector('#song-search')?.focus(); }, 'plus')), modePicker());
  if (!state.library.length) {
    main.append(el('div', { class: 'empty-state' }, el('div', { class: 'empty-icon' }, icon('book')), el('h2', {}, '第一首歌，会是哪一首？'), el('p', {}, '从网易云读取一首熟悉的歌，它就会留在你的曲库里。'), button('去找一首歌', 'button primary', () => { navigate('home'); document.querySelector('#song-search')?.focus(); }, 'search')));
  } else main.append(el('section', { class: 'song-grid library-full', 'aria-label': '已导入的歌曲' }, state.library.map(song => libraryCard(song))));
  main.append(el('p', { class: 'storage-note' }, '曲库与进度保存在当前浏览器。已加入的歌曲无需再次读取歌词。'));
}

function setSession(song, session) {
  state.sessions[song.id] = session;
  const key = bestKey(song.id, session);
  state.best[key] = Math.max(state.best[key] || 0, session.best);
  state.activeId = session.phase === 'playing' ? song.id : null;
  persist();
}

function focusAnswer() {
  requestAnimationFrame(() => document.querySelector('#answer-input')?.focus({ preventScroll: true }));
}

function renderGame() {
  const song = songById(state.activeId) || state.library.find(item => state.sessions[item.id]?.phase === 'complete' && item.id === main.dataset.lastSong);
  if (!song || !isValidSession(state.sessions[song.id], song)) { view = 'home'; renderHome(); return; }
  main.dataset.lastSong = song.id;
  const session = state.sessions[song.id];
  if (session.phase === 'complete') { renderSummary(song, session); return; }
  const total = answerIndexes(song, session).length;
  const modes = getModes(session);
  const easy = modes.answerMode === 'initials';
  const done = session.correct + session.skipped;
  const percent = (done / total) * 100;
  const top = el('div', { class: 'game-top' }, button('返回曲库', 'text-button back-button', () => navigate('library'), 'back'),
    el('a', { class: 'text-button source-link', href: `https://music.163.com/#/song?id=${song.id}`, target: '_blank', rel: 'noopener noreferrer' }, '网易云原文 ', el('span', { 'aria-hidden': 'true' }, '↗')));
  const heading = el('section', { class: 'game-heading' }, cover(song, true), el('div', {}, el('span', { class: 'eyebrow' }, 'KEEP THE SONG GOING'), el('h1', {}, song.name), el('p', {}, song.artist)),
    el('div', { class: 'streak-badge' }, el('span', {}, '连续接对'), el('strong', { id: 'streak-count' }, session.streak), el('span', {}, '句')));
  const progress = el('div', { class: 'game-progress' }, el('div', { class: 'progress-label' }, el('span', {}, `第 ${session.nextIndex + 1} / ${song.lines.length} 句`), el('span', {}, `已接对 ${session.correct} 句${session.skipped ? ` · 跳过 ${session.skipped} 句` : ''}`)),
    el('div', { class: 'progress-track', role: 'progressbar', 'aria-label': '接龙进度', 'aria-valuenow': done, 'aria-valuemin': 0, 'aria-valuemax': total }, el('span', { style: `width:${percent}%` })));
  const context = el('div', { class: 'lyric-context' }, el('span', { class: 'lyric-label' }, modes.chainMode === 'hinted' ? '网页提示这一句，请接下一句' : '上一句是'));
  const from = Math.max(session.startIndex, session.nextIndex - 3);
  for (let index = from; index < session.nextIndex; index++) context.append(el('p', { class: index === session.nextIndex - 1 ? 'current-line' : 'past-line' }, song.lines[index].text));
  const input = el('input', { id: 'answer-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: 2000, placeholder: easy ? '输入下一整句的拼音首字母…' : '把完整的下一句写在这里…', 'aria-label': easy ? '下一整句的拼音首字母' : '完整的下一句歌词', 'aria-describedby': 'answer-rule answer-feedback', disabled: session.revealed });
  if (easy) input.setAttribute('inputmode', 'text');
  let composing = false;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229 || composing)) event.preventDefault(); });
  const submit = el('button', { type: 'submit', class: 'button primary answer-submit', disabled: session.revealed }, '接上这一句', icon('arrow'));
  const form = el('form', { class: `answer-form ${feedback?.kind === 'wrong' ? 'has-error' : ''}` }, el('label', { for: 'answer-input', class: 'input-label' }, '轮到你了'), el('div', { class: 'answer-input-row' }, input, submit));
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (composing) return;
    const current = state.sessions[song.id];
    const result = submitAnswer(current, song, input.value);
    if (result.kind === 'empty') { showFeedback('empty', easy ? '先输入下一整句的首字母吧。' : '先写下完整的下一句吧。'); input.focus(); return; }
    if (result.kind === 'inactive') return;
    setSession(song, result.session);
    if (result.kind === 'wrong') {
      document.querySelector('#streak-count').textContent = '0';
      form.classList.remove('has-error');
      requestAnimationFrame(() => form.classList.add('has-error'));
      showFeedback('wrong', easy ? '首字母还没完全接对。每个汉字都要有首字母，英文和数字请保留原文。' : '还没完全接对。检查一下有没有少字、多字或错字，再试一次。');
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    } else {
      feedback = { kind: 'correct', message: '接对了！旋律继续。' };
      render();
      focusAnswer();
    }
  });
  const feedbackNode = el('div', { id: 'answer-feedback', class: `answer-feedback ${feedback?.kind || ''}`, role: 'status', 'aria-live': 'polite' }, feedback?.message || '慢慢想，不限时间。');
  const actions = el('div', { class: 'game-actions' }, el('p', { id: 'answer-rule' }, icon('check'), easy ? '逐字首字母 · 英文数字保留原文 · 忽略标点空格' : '整句匹配 · 忽略标点、空格与英文大小写'),
    button(session.revealed ? '跳过此句，继续' : '查看答案', 'text-button reveal-button', () => {
      const current = state.sessions[song.id];
      setSession(song, current.revealed ? continueAfterReveal(current, song) : revealAnswer(current));
      feedback = current.revealed ? { kind: 'neutral', message: '已跳过上一句，从这里继续。' } : null;
      render();
      if (current.revealed) focusAnswer();
    }, session.revealed ? 'arrow' : ''));
  const card = el('section', { class: 'game-card', 'aria-label': '歌词接龙' }, context, el('div', { class: 'lyric-separator' }, el('span'), icon('music'), el('span')), form, feedbackNode);
  if (session.revealed) card.append(el('div', { class: 'revealed-answer' }, el('span', {}, '这一句是'), el('p', {}, song.lines[session.nextIndex].text), easy ? el('p', { class: 'initials-answer' }, lyricInitials(song.lines[session.nextIndex].text)) : null, el('small', {}, '答案已展示，这句将记为跳过，不计接对。')));
  card.append(actions);
  main.append(el('div', { class: 'game-wrap' }, top, heading, modePicker(song), progress, card,
    el('div', { class: 'game-bottom' }, el('p', {}, modeName(session)),
      button('重新从头接', 'text-button', () => { feedback = null; startSong(song, { restart: true }); }, 'replay'))));
}

function showFeedback(kind, message) {
  feedback = { kind, message };
  const node = document.querySelector('#answer-feedback');
  if (node) { node.className = `answer-feedback ${kind}`; node.textContent = message; }
}

function renderSummary(song, session) {
  main.append(el('section', { class: 'summary' }, el('span', { class: 'summary-check' }, icon('check')), el('span', { class: 'eyebrow' }, 'SONG COMPLETE'),
    el('h1', {}, '这首歌，接完了。'), el('p', { class: 'summary-song' }, `《${song.name}》 · ${song.artist}`), el('p', { class: 'mode-badge' }, modeName(session)),
    el('div', { class: 'summary-stats' }, ...[[session.correct, '接对句数'], [session.best, '本次最佳连击'], [session.mistakes, '答错次数'], [session.skipped, '跳过句数']].map(([number, label]) => el('div', {}, el('strong', {}, number), el('span', {}, label)))),
    getModes(session).chainMode === 'hinted' && !session.results.some(result => result.index === song.lines.length - 1) ? el('div', { class: 'final-hint' }, el('span', {}, '最后一句由网页给出：'), el('p', {}, song.lines.at(-1).text)) : null,
    el('p', { class: 'summary-message' }, session.skipped === 0 && session.mistakes === 0 ? '一遍全对。熟悉的旋律，果然一直都记得。' : '下一次，也许能把每一句都接住。'),
    el('div', { class: 'summary-actions' }, button('再接一遍', 'button primary', () => startSong(song, { restart: true }), 'replay'), button('换一首歌', 'button secondary', () => navigate('library'), 'arrow'))));
}

function render() {
  main.replaceChildren();
  main.className = view === 'game' ? 'game-main' : '';
  for (const nav of document.querySelectorAll('[data-nav]')) {
    const active = view === nav.dataset.nav;
    nav.classList.toggle('active', active);
    if (active) nav.setAttribute('aria-current', 'page'); else nav.removeAttribute('aria-current');
  }
  document.querySelector('#nav-count').textContent = state.library.length;
  if (view === 'library') renderLibrary();
  else if (view === 'game') renderGame();
  else renderHome();
}

for (const nav of document.querySelectorAll('[data-nav]')) nav.addEventListener('click', () => navigate(nav.dataset.nav));
document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); navigate('home'); });
const rules = document.querySelector('#rules-dialog');
document.querySelector('#rules-button').addEventListener('click', () => rules.showModal());
document.querySelector('#close-rules').addEventListener('click', () => rules.close());
document.querySelector('#understood').addEventListener('click', () => rules.close());
rules.addEventListener('click', event => { if (event.target === rules && (event.offsetX < 0 || event.offsetY < 0 || event.offsetX > rules.clientWidth || event.offsetY > rules.clientHeight)) rules.close(); });
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  const fresh = loadState();
  if (fresh.warning) return;
  state = fresh.state;
  feedback = null;
  if (view === 'game' && !state.activeId) view = 'library';
  render();
  toast('另一标签页已更新曲库或接龙进度，这里也已同步。');
});
render();
if (restored.warning) toast(restored.warning);
if (restored.notice) { persist(); toast(restored.notice); }
if (view === 'game') focusAnswer();
