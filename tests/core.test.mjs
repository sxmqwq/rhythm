import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLyrics, normalizeAnswer, parseNeteaseInput, makeSession, submitAnswer, revealAnswer, continueAfterReveal, isValidSession } from '../core.mjs';
import { loadState, saveState, STORAGE_KEY } from '../storage.mjs';

const fixture = '[ti:测试曲]\n[ar:示例]\n[00:00.00]作词：测试\n[00:10]灯火照着回家的路\n[00:15.50]晚风翻过安静的书\n[00:20.125]我们沿着星光追逐';
const parsed = parseLyrics(fixture);
const song = { id: '123', name: '测试曲', artist: '示例', ...parsed };

test('imports NetEase line timings and omits credits without losing sung lines', () => {
  assert.deepEqual(parsed.lines.map(x => x.time), [10000, 15500, 20125]);
  assert.equal(parsed.metadata.ti, '测试曲');
  assert.equal(parsed.lines.length, 3);
  assert.equal(parseLyrics('[00:01]作词是我的爱好\n[00:02]音乐响起了').lines.length, 2);
  assert.equal(parseLyrics('[00:00]和声编写 : 示例\n[00:01]录音工程 : 示例\n[00:02]录音助理：示例\n[00:03]鼓：示例\n[00:10]晚风来过\n[00:20]星光亮起').lines.length, 2);
});
test('multiple timestamps expand repeated verses, enhanced timings are removed', () => {
  const data = parseLyrics('[offset:250]\n[00:10.1][01:10.10]<00:10.100>晚风<00:10.500>来过\n[00:20.123]星光亮起');
  assert.deepEqual(data.lines.map(x => x.time), [10350, 20373, 70350]);
  assert.equal(data.lines[0].text, '晚风来过');
  assert.equal(data.lines[2].text, '晚风来过');
});
test('preserves repeated lines at distinct song positions and drops duplicate timestamps only', () => {
  const data = parseLyrics('[00:01]同一句\n[00:01]同一句\n[00:02]同一句\n[00:03]下一句');
  assert.equal(data.lines.length, 3);
  assert.equal(data.lines[0].text, data.lines[1].text);
});
test('plain lyrics work, instrumental and empty responses cannot start a game', () => {
  assert.equal(parseLyrics('作曲：测试\n晚风来过\n星光亮起').lines.length, 2);
  assert.throws(() => parseLyrics('[00:00]纯音乐，请欣赏'));
  assert.throws(() => parseLyrics(''));
});
test('normalization accepts formatting but retains lyric letters, kana and symbols', () => {
  assert.equal(normalizeAnswer(' Ｈｅｌｌｏ，World！ '), 'helloworld');
  assert.equal(normalizeAnswer('コーヒー'), 'コーヒー');
  assert.notEqual(normalizeAnswer('风'), normalizeAnswer('疯'));
});
test('supports IDs, desktop hash links, mobile links and copied share messages', () => {
  for (const input of ['186016', 'https://music.163.com/#/song?id=186016', '分享歌曲：https://y.music.163.com/m/song?id=186016&userid=1', 'https://music.163.com/song/186016/']) assert.deepEqual(parseNeteaseInput(input), { type: 'song', id: '186016' });
  assert.deepEqual(parseNeteaseInput('https://music.163.com/#/playlist?id=60198'), { type: 'playlist', id: '60198' });
  assert.deepEqual(parseNeteaseInput('周杰伦 晴天'), { type: 'search', query: '周杰伦 晴天' });
  assert.throws(() => parseNeteaseInput('https://music.163.com.evil.example/song?id=1'));
  assert.throws(() => parseNeteaseInput('https://163cn.tv/abc'));
  assert.throws(() => parseNeteaseInput('https://music.163.com/user/home?id=1'));
});
test('a partial line, substring, typo, extra words and a later line never pass', () => {
  const initial = makeSession(song);
  for (const wrong of ['晚风', '晚风翻过安静的', '晚风翻过安静的树', '晚风翻过安静的书啊', '我们沿着星光追逐']) {
    const result = submitAnswer(initial, song, wrong);
    assert.equal(result.kind, 'wrong');
    assert.equal(result.session.nextIndex, 1);
    assert.equal(result.session.correct, 0);
  }
});
test('blank submission does not spend a guess; full next line advances exactly once', () => {
  const initial = makeSession(song);
  assert.equal(submitAnswer(initial, song, ' ！ ').kind, 'empty');
  const result = submitAnswer(initial, song, '晚风，翻过安静的书。');
  assert.equal(result.kind, 'correct');
  assert.equal(result.session.nextIndex, 2);
  assert.equal(result.session.correct, 1);
  assert.equal(result.session.streak, 1);
  assert.equal(submitAnswer(result.session, song, '晚风翻过安静的书').kind, 'wrong');
});
test('mistakes reset the streak but preserve progress and allow a corrected whole answer', () => {
  let current = submitAnswer(makeSession(song), song, song.lines[1].text).session;
  current = submitAnswer(current, song, '错误').session;
  assert.equal(current.streak, 0);
  assert.equal(current.best, 1);
  assert.equal(current.nextIndex, 2);
  current = submitAnswer(current, song, song.lines[2].text).session;
  assert.equal(current.phase, 'complete');
  assert.equal(current.correct, 2);
  assert.equal(current.mistakes, 1);
  assert.equal(submitAnswer(current, song, song.lines[2].text).kind, 'inactive');
});
test('revealing an answer never awards a correct line and only explicit continue skips it', () => {
  const initial = makeSession(song);
  assert.equal(continueAfterReveal(initial, song), initial);
  const revealed = revealAnswer(initial);
  assert.equal(submitAnswer(revealed, song, song.lines[1].text).kind, 'inactive');
  const continued = continueAfterReveal(revealed, song);
  assert.equal(continued.skipped, 1);
  assert.equal(continued.correct, 0);
  assert.equal(continued.streak, 0);
  assert.equal(continued.nextIndex, 2);
});
test('changed lyric revisions invalidate a saved session', () => {
  assert.equal(isValidSession(makeSession(song), { ...song, revision: 'changed' }), false);
  assert.equal(isValidSession({ ...makeSession(song), nextIndex: 500 }, song), false);
});
test('browser persistence restores a mid-song chain and tolerates storage failures', () => {
  const current = submitAnswer(makeSession(song), song, song.lines[1].text).session;
  const state = { version: 1, library: [song], sessions: { '123': current }, activeId: '123', best: { '123': 1 } };
  const memory = new Map();
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  assert.equal(saveState(state, storage), true);
  assert.equal(loadState(storage).state.sessions['123'].nextIndex, 2);
  assert.equal(loadState(storage).state.activeId, '123');
  memory.set(STORAGE_KEY, 'broken');
  assert.equal(loadState(storage).state.library.length, 0);
  assert.ok(loadState(storage).warning);
  assert.equal(saveState(state, { setItem() { throw new Error('quota'); } }), false);
});
