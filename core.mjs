import { pinyin } from './vendor/pinyin-pro.mjs';

export const SCHEMA_VERSION = 2;
export const DEFAULT_MODES = Object.freeze({ answerMode: 'full', chainMode: 'continuous' });

export function getModes(value = {}) {
  return {
    answerMode: value?.answerMode === 'initials' ? 'initials' : 'full',
    chainMode: value?.chainMode === 'hinted' ? 'hinted' : 'continuous',
  };
}

export function sameModes(left, right) {
  const a = getModes(left), b = getModes(right);
  return a.answerMode === b.answerMode && a.chainMode === b.chainMode;
}

export function bestKey(songId, modes) {
  const { answerMode, chainMode } = getModes(modes);
  return `${songId}:${answerMode}:${chainMode}`;
}

export function normalizeAnswer(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/[\p{P}\p{Z}\s\u200b-\u200d\ufeff]/gu, '');
}

export function lyricInitials(value) {
  return normalizeAnswer(pinyin(String(value ?? '').normalize('NFKC'), {
    pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive',
  }).join(''));
}

const credit = /^(?:作\s*词|作\s*曲|编\s*曲|词曲|作詞|作曲|編曲|演唱|歌手|专辑|專輯|制作人|製作人|制作|製作|出品|发行|發行|录音|錄音|混音|母带|母帶|监制|監製|和声|和聲|吉他|贝斯|貝斯|键盘|鍵盤|钢琴|鋼琴|弦乐|弦樂|小提琴|大提琴|管弦乐|管弦樂|乐器|樂器|配唱|统筹|統籌|企划|企劃|封面|词|詞|曲|编|編|唱|鼓|OP|SP|ISRC|Lyrics(?:\s+by)?|Music(?:\s+by)?|Arrang(?:e|ed)(?:\s+by)?|Produced(?:\s+by)?|Vocal(?:s)?|Mix(?:ed)?(?:\s+by)?|Master(?:ed)?(?:\s+by)?|Composer|Lyricist|Guitar|Bass|Drums?|Piano)(?:编写|編寫|编配|編配|设计|設計|制作|製作|录制|錄製|编辑|編輯|指导|指導|工程(?:师|師)?|助理|师|師|人)?\s*[:：]/iu;
const section = /^[\[【](?:verse|chorus|bridge|intro|outro|interlude|instrumental|pre[- ]?chorus|hook|副歌|主歌|间奏|間奏|前奏|尾奏)(?:\s*\d+)?(?:\s*[:：][^\]】]+)?[\]】]$/iu;
const extraCredit = /^(?:(?:作\s*词|作\s*曲|编\s*曲|演唱(?:者)?|原唱|歌手(?:名称)?|人声|和声(?:编写|编配|录制)?|配唱制作人|音乐制作人|音乐总监|制作(?:人|团队)?|录音(?:师|室|棚|工程师)?|混音(?:师|室|工程师)?|母带(?:处理|工程师)?|发行(?:公司)?|出品(?:人|公司)?|词曲作者|吉他|贝斯|钢琴|键盘|鼓手|监制|宣发|策划|企划|统筹|封面设计|歌词(?:制作|提供|贡献))\s*(?:[:：=]|\s+\S)|(?:作词|作曲|编曲|演唱|歌手)\s*[/／&]\s*(?:作词|作曲|编曲|演唱|歌手)\s*[:：]|(?:lrc|artist(?:\s+name)?|singer|album|title|performed|written|lyrics|music|arrang(?:e|ed|ement)|produc(?:ed|er)|vocal(?:s)?|mix(?:ed|ing)?|master(?:ed|ing)?)(?:\s+(?:director|engineer|producer|by))?\s*[:：=]|(?:lrc|performed|written|lyrics|music|arranged|produced|mixed|mastered)\s+by\s+\S)/iu;
const rights = /^(?:(?:本歌曲|本作品|此歌曲)?.{0,8}未经.{0,8}(?:许可|授权).{0,16}(?:翻唱|翻录|使用)|版权所有\s*[:：]|copyright\s*(?:©|\(c\))|all rights reserved\b)/iu;
const speaker = /^(?:男(?:声)?|女(?:声)?|合(?:唱)?|齐唱|独白|旁白|合声|合聲|合唱团|合唱團)\s*[:：]\s*/u;

function artistNames(artist) {
  return String(artist || '').split(/\s*[/／、,，;&＆；]\s*/u).map(value => value.trim()).filter(Boolean);
}

// Meting's TLYRIC formatter appends Chinese translations as `original (translation)`.
// This rule is only used for that provider; canonical original tracks keep their parentheses.
export function stripMetingTranslation(value) {
  const text = String(value ?? '').trim();
  const pairs = new Map([[')', '('], ['）', '（']]);
  if (!pairs.has(text.at(-1))) return text;
  const stack = [];
  let start = -1;
  for (let index = text.length - 1; index >= 0; index--) {
    const char = text[index];
    if (pairs.has(char)) stack.push(pairs.get(char));
    else if (char === '(' || char === '（') {
      if (stack.pop() !== char) return text;
      if (!stack.length) { start = index; break; }
    }
  }
  if (start <= 0) return text;
  const original = text.slice(0, start).trimEnd();
  const translation = text.slice(start + 1, -1);
  // Do not guess at Chinese or mixed-language sung passages, or remove English ad-libs.
  if (/\p{Script=Han}/u.test(original) || !/[\p{Script=Latin}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(original) || !/\p{Script=Han}/u.test(translation)) return text;
  return original;
}

// Keep music text intact: only known names, explicit credits and provider-added translations are removed.
export function cleanLyricLines(input, { name = '', artist = '', metadata = {}, provider = '' } = {}) {
  const names = [...new Set([...artistNames(artist), ...artistNames(metadata.ar)])];
  const titles = [...new Set([name, metadata.ti].map(normalizeAnswer).filter(Boolean))];
  const identities = new Set(names.map(normalizeAnswer).filter(Boolean));
  const headings = new Set(names.flatMap(value => titles.flatMap(title => [title + normalizeAnswer(value), normalizeAnswer(value) + title])));
  const seen = new Set();
  return input.flatMap(line => {
    let text = line.text.trim();
    if (credit.test(text) || extraCredit.test(text) || rights.test(text) || section.test(text)) return [];
    const normalized = normalizeAnswer(text);
    if (identities.has(normalized) || (/[-–—|·•]/u.test(text) && headings.has(normalized))) return [];
    if (/^(?:纯音乐请欣赏|純音樂請欣賞|暂无歌词|暫無歌詞|无歌词|無歌詞)$/u.test(normalized)) return [];
    text = text.replace(speaker, '');
    // Duet lines sometimes begin with a performer's name. Remove the label, not the sung words.
    const label = text.match(/^(?:[\[【(（]([^\]】)）]+)[\]】)）]\s*[:：]?|([^:：]{1,100})[:：])\s*/u);
    if (label && identities.has(normalizeAnswer(label[1] || label[2]))) text = text.slice(label[0].length).trim();
    if (provider === 'injahow') text = stripMetingTranslation(text);
    if (!normalizeAnswer(text)) return [];
    if (Number.isFinite(line.time)) {
      const key = `${line.time}\u0000${text}`;
      if (seen.has(key)) return [];
      seen.add(key);
    }
    return [{ ...line, text }];
  });
}

export function parseLyrics(raw, context = {}) {
  if (typeof raw !== 'string' || raw.length > 500_000) throw new Error('歌词内容为空或过长。');
  const metadata = {};
  const timed = [];
  const plain = [];
  let offset = 0;
  let order = 0;
  for (const source of raw.replace(/^\ufeff/, '').split(/\r?\n/)) {
    const line = source.trim();
    if (!line) continue;
    const meta = line.match(/^\[(ti|ar|al|by|offset|re|ve|length):([^\]]*)\]$/iu);
    if (meta) {
      metadata[meta[1].toLowerCase()] = meta[2].trim();
      if (meta[1].toLowerCase() === 'offset') offset = Number(meta[2]) || 0;
      continue;
    }
    const stamps = [];
    let rest = line;
    for (;;) {
      const match = rest.match(/^\[(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?\]/u);
      if (!match) break;
      stamps.push((Number(match[1]) * 60 + Number(match[2])) * 1000 + Number((match[3] ?? '').padEnd(3, '0')));
      rest = rest.slice(match[0].length).trimStart();
    }
    const text = rest.replace(/<\d{1,3}:[0-5]?\d(?:\.\d{1,3})?>/gu, '').trim();
    if (!text || credit.test(text) || section.test(text) || /^\{.*\}$/u.test(text)) continue;
    if (!normalizeAnswer(text)) continue;
    if (/^(?:纯音乐[，,]?请欣赏|純音樂[，,]?請欣賞|暂无歌词|暫無歌詞|无歌词|無歌詞)$/u.test(normalizeAnswer(text))) continue;
    if (stamps.length) for (const time of stamps) timed.push({ time, text, order: order++ });
    else if (!/^\[[a-z][a-z\d_-]*:/iu.test(text)) plain.push({ time: null, text });
  }
  const seen = new Set();
  const sorted = timed.length
    ? timed.sort((a, b) => a.time - b.time || a.order - b.order).filter(line => {
      const key = `${line.time}\u0000${line.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(({ time, text }) => ({ time: Math.max(0, time + offset), text }))
    : plain;
  const lines = cleanLyricLines(sorted, { ...context, metadata });
  if (lines.length < 2) throw new Error('这首歌暂无足够的原文歌词，暂时无法接龙。');
  if (lines.length > 2000 || lines.some(line => line.text.length > 2000)) throw new Error('歌词分行异常，请换一首歌试试。');
  return { metadata, lines, revision: lyricsRevision(lines) };
}

export function lyricsRevision(lines) {
  let hash = 2166136261;
  for (const char of lines.map(line => line.text).join('\n')) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function parseNeteaseInput(value) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error('输入歌名、歌手或网易云歌曲链接。');
  if (/^[1-9]\d{0,19}$/u.test(text)) return { type: 'song', id: text };
  const found = text.match(/https?:\/\/[^\s<>"'，。；）)]+/iu);
  if (!found) {
    if (text.length > 100) throw new Error('搜索词请控制在 100 个字以内。');
    return { type: 'search', query: text };
  }
  let url;
  try { url = new URL(found[0]); } catch { throw new Error('这个链接无法识别。'); }
  if (!/^(?:[a-z\d-]+\.)*music\.163\.com$/iu.test(url.hostname)) {
    throw new Error('请粘贴网易云的完整歌曲或歌单链接，短链接请先在浏览器中打开。');
  }
  const path = `${url.pathname}${url.hash.replace(/^#/, '')}`;
  const type = /(?:^|\/)playlist(?:[/?]|$)/iu.test(path) ? 'playlist'
    : /(?:^|\/)song(?:[/?]|$)/iu.test(path) ? 'song' : null;
  const id = path.match(/\/(?:song|playlist)\/(\d+)/iu)?.[1]
    ?? new URLSearchParams(url.hash.includes('?') ? url.hash.split('?').slice(1).join('?') : url.search).get('id');
  if (!type || !/^[1-9]\d{0,19}$/u.test(id ?? '')) throw new Error('需要包含 song 或 playlist 及歌曲 ID 的网易云完整链接。');
  return { type, id };
}

export function answerIndexes(song, session) {
  const step = getModes(session).chainMode === 'hinted' ? 2 : 1;
  const indexes = [];
  for (let index = session.startIndex + 1; index < song.lines.length; index += step) indexes.push(index);
  return indexes;
}

export function makeSession(song, start = 0, modes = DEFAULT_MODES) {
  const startIndex = Math.max(0, Math.min(song.lines.length - 2, Number.isInteger(start) ? start : 0));
  return {
    ...getModes(modes),
    songId: String(song.id), revision: song.revision, startIndex, nextIndex: startIndex + 1,
    correct: 0, mistakes: 0, skipped: 0, streak: 0, best: 0,
    revealed: false, phase: 'playing', startedAt: Date.now(), finishedAt: null,
    results: [],
  };
}

export function isValidSession(session, song) {
  if (!session || session.songId !== String(song.id) || session.revision !== song.revision) return false;
  if (!Number.isInteger(session.startIndex) || session.startIndex < 0 || session.startIndex >= song.lines.length - 1) return false;
  if (session.answerMode !== undefined && !['full', 'initials'].includes(session.answerMode)) return false;
  if (session.chainMode !== undefined && !['continuous', 'hinted'].includes(session.chainMode)) return false;
  if (!Number.isInteger(session.nextIndex)) return false;
  if (!['playing', 'complete'].includes(session.phase) || (session.phase === 'complete') !== (session.nextIndex === song.lines.length)) return false;
  if (!['correct', 'mistakes', 'skipped', 'streak', 'best'].every(k => Number.isInteger(session[k]) && session[k] >= 0)) return false;
  if (!Array.isArray(session.results)) return false;
  const indexes = answerIndexes(song, session);
  if (session.results.length > indexes.length || session.nextIndex !== (indexes[session.results.length] ?? song.lines.length)) return false;
  if (!session.results.every((result, i) => result.index === indexes[i] && ['correct', 'skipped'].includes(result.outcome))) return false;
  return session.correct === session.results.filter(result => result.outcome === 'correct').length
    && session.skipped === session.results.filter(result => result.outcome === 'skipped').length
    && session.streak <= session.correct && session.best <= session.correct;
}

function advance(session, song, outcome) {
  const results = [...session.results, { index: session.nextIndex, outcome }];
  const next = { ...session, results, nextIndex: answerIndexes(song, session)[results.length] ?? song.lines.length, revealed: false };
  if (outcome === 'correct') {
    next.correct++;
    next.streak++;
    next.best = Math.max(next.best, next.streak);
  } else {
    next.skipped++;
    next.streak = 0;
  }
  if (next.nextIndex === song.lines.length) {
    next.phase = 'complete';
    next.finishedAt = Date.now();
  }
  return next;
}

export function submitAnswer(session, song, value) {
  if (!isValidSession(session, song)) throw new Error('歌词或进度已变更，请重新开始接龙。');
  if (session.phase !== 'playing' || session.revealed) return { kind: 'inactive', session };
  const input = normalizeAnswer(value);
  if (!input) return { kind: 'empty', session };
  // Compare the entire next line. Neither substrings nor similarity can pass.
  const expected = getModes(session).answerMode === 'initials'
    ? lyricInitials(song.lines[session.nextIndex].text)
    : normalizeAnswer(song.lines[session.nextIndex].text);
  if (input !== expected) {
    return { kind: 'wrong', session: { ...session, mistakes: session.mistakes + 1, streak: 0 } };
  }
  return { kind: 'correct', session: advance(session, song, 'correct') };
}

export function revealAnswer(session) {
  if (session.phase !== 'playing') return session;
  return { ...session, revealed: true, streak: 0 };
}

export function continueAfterReveal(session, song) {
  if (!isValidSession(session, song) || session.phase !== 'playing' || !session.revealed) return session;
  return advance(session, song, 'skipped');
}
