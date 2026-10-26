import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLyrics, stripMetingTranslation, cleanLyricLines, lyricsRevision, makeSession, submitAnswer, lyricInitials } from '../core.mjs';
import { loadState, saveState } from '../storage.mjs';

const screenshotLyrics = '[00:07]Hello (哈喽)\n[00:08.90]Am I working right today? (我今天运行是否如常？)';

test('screenshot regression: inline translations are excluded from display and both answer modes', () => {
  const song = { id: '3330872139', name: 'Colorful Array', provider: 'injahow', ...parseLyrics(screenshotLyrics, { provider: 'injahow' }) };
  assert.deepEqual(song.lines.map(line => line.text), ['Hello', 'Am I working right today?']);
  assert.equal(submitAnswer(makeSession(song), song, 'Am I working right today?').kind, 'correct');
  assert.equal(lyricInitials(song.lines[1].text), 'amiworkingrighttoday');
  const easy = makeSession(song, 0, { answerMode: 'initials' });
  assert.equal(submitAnswer(easy, song, 'amiworkingrighttoday').kind, 'correct');
  assert.equal(submitAnswer(easy, song, 'amiworkingrighttodaywjtyxsfrc').kind, 'wrong');
});

test('only the final translated group is removed, including nested or fullwidth parentheses', () => {
  assert.equal(stripMetingTranslation('Hello（哈喽）'), 'Hello');
  assert.equal(stripMetingTranslation("What's new (again)? (又有什么（新鲜事）？)"), "What's new (again)?");
  assert.equal(stripMetingTranslation('Hello (oh) (哈喽（哦）)'), 'Hello (oh)');
});

test('original ad-libs, Chinese lyrics, mixed-language passages and uncertain brackets remain intact', () => {
  for (const line of ['Hello (oh)', '我爱你（真的）', 'Hello 你好 (一起唱)', 'Hello (你好) (你好（你好）)', 'Hello (哈喽', 'Hello (你好）', '(你好)', 'Hello world']) {
    assert.equal(stripMetingTranslation(line), line);
  }
  const canonical = parseLyrics('Hello (你好)\nSing with me (一起唱)', { provider: 'GD音乐台' });
  assert.equal(canonical.lines[0].text, 'Hello (你好)');
  assert.equal(canonical.lines[1].text, 'Sing with me (一起唱)');
});

test('cleaning deduplicates an original and its translated copy at the same time, retaining chorus repeats', () => {
  const song = parseLyrics('[00:01]Hello\n[00:01]Hello (你好)\n[00:02]Hello (你好)\n[00:03]Next (下一句)', { provider: 'injahow' });
  assert.deepEqual(song.lines, [{ time: 1000, text: 'Hello' }, { time: 2000, text: 'Hello' }, { time: 3000, text: 'Next' }]);
});

test('cached merged translations are repaired once while unaffected songs and their progress survive', () => {
  const lines = [{ time: 7000, text: 'Hello (哈喽)' }, { time: 8900, text: 'Am I working right today? (我今天运行是否如常？)' }];
  const affected = { id: '1', name: 'Colorful Array', provider: 'injahow', lines, revision: lyricsRevision(lines) };
  const unaffected = { id: '2', provider: 'GD音乐台', ...parseLyrics('Hello (你好)\nOriginal (原文)', { provider: 'GD音乐台' }) };
  let saved = JSON.stringify({ version: 2, library: [affected, unaffected], sessions: { '1': makeSession(affected), '2': makeSession(unaffected) }, activeId: '1', best: { '1:full:continuous': 5, '2:full:continuous': 3 } });
  const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
  const restored = loadState(storage);
  assert.equal(restored.state.library.length, 2);
  assert.equal(restored.state.library[0].lines[0].text, 'Hello');
  assert.equal(restored.state.sessions['1'], undefined);
  assert.equal(restored.state.best['1:full:continuous'], 0);
  assert.equal(restored.state.library[1].lines[0].text, 'Hello (你好)');
  assert.equal(restored.state.sessions['2'].nextIndex, 1);
  assert.equal(restored.state.best['2:full:continuous'], 3);
  assert.match(restored.notice, /翻译/);
  saveState(restored.state, storage);
  assert.equal(loadState(storage).notice, '');
});

test('translation cleanup is idempotent for parsed lyric snapshots', () => {
  const parsed = parseLyrics(screenshotLyrics, { provider: 'injahow' });
  assert.deepEqual(cleanLyricLines(parsed.lines, { provider: 'injahow' }), parsed.lines);
});
