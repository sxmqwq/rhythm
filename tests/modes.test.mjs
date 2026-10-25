import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLyrics, makeSession, submitAnswer, revealAnswer, continueAfterReveal, isValidSession, lyricInitials, answerIndexes, getModes, bestKey } from '../core.mjs';
import { loadState, saveState, STORAGE_KEY } from '../storage.mjs';

const makeSong = count => ({ id: '456', name: '测试曲', artist: '歌手甲', ...parseLyrics(Array.from({ length: count }, (_, i) => `这一句是第${i + 1}句`).join('\n')) });
const storageFor = value => {
  let raw = JSON.stringify(value);
  return { getItem: key => key === STORAGE_KEY ? raw : null, setItem: (_key, value) => { raw = value; } };
};

test('initials preserve every Chinese character, vowels, non-Chinese lyrics and digits', () => {
  assert.equal(lyricInitials('我，爱你！'), 'wan');
  assert.equal(lyricInitials('我爱你 Ｈｅｌｌｏ ２０２６'), 'wanhello2026');
  assert.equal(lyricInitials('哦爱额'), 'oae');
  assert.equal(lyricInitials('コーヒー Hello'), 'コーヒーhello');
});

test('initials use phrase pronunciation for common polyphones', () => {
  assert.equal(lyricInitials('长大以后'), 'zdyh');
  assert.equal(lyricInitials('重庆的音乐'), 'cqdyy');
  assert.equal(lyricInitials('快乐'), 'kl');
});

test('easy mode requires the entire initials sequence and never accepts substrings', () => {
  const song = { id: '456', ...parseLyrics('灯火亮了\n我爱你 Hello 2026\n晚风来过') };
  const session = makeSession(song, 0, { answerMode: 'initials' });
  for (const wrong of ['w', 'wa', 'wan', 'wanh2026', 'wanhello202', 'wanhello2026x', '我爱你 Hello 2026']) {
    assert.equal(submitAnswer(session, song, wrong).kind, 'wrong', wrong);
  }
  const result = submitAnswer(session, song, 'ＷＡＮ， Hello ２０２６！');
  assert.equal(result.kind, 'correct');
  assert.equal(result.session.nextIndex, 2);
  assert.equal(submitAnswer(makeSession(song), song, 'wanhello2026').kind, 'wrong');
});

test('hinted mode alternates prompt and answer across all small song lengths and random starts', () => {
  for (let length = 2; length <= 13; length++) for (let start = 0; start < length - 1; start++) {
    const song = makeSong(length);
    let session = makeSession(song, start, { chainMode: 'hinted' });
    const indexes = answerIndexes(song, session);
    assert.equal(indexes.length, Math.floor((length - start) / 2));
    for (const index of indexes) {
      assert.equal(session.nextIndex, index);
      assert.equal(isValidSession(session, song), true);
      const result = submitAnswer(session, song, song.lines[index].text);
      assert.equal(result.kind, 'correct');
      session = result.session;
    }
    assert.equal(session.phase, 'complete');
    assert.equal(session.nextIndex, length);
    assert.equal(session.correct, indexes.length);
    assert.equal(session.skipped, 0);
    assert.equal(isValidSession(session, song), true);
    assert.deepEqual(session.results.map(result => result.index), indexes);
  }
});

test('a wrong answer never consumes the current hint or reveals the next one', () => {
  const song = makeSong(6);
  const initial = makeSession(song, 0, { chainMode: 'hinted' });
  const wrong = submitAnswer(initial, song, song.lines[3].text);
  assert.equal(wrong.kind, 'wrong');
  assert.equal(wrong.session.nextIndex, 1);
  assert.deepEqual(wrong.session.results, []);
});

test('revealed answer in hinted mode skips only the answer and advances to the next pair', () => {
  const song = makeSong(5);
  const initial = makeSession(song, 0, { chainMode: 'hinted' });
  const revealed = revealAnswer(initial);
  assert.equal(submitAnswer(revealed, song, song.lines[1].text).kind, 'inactive');
  const next = continueAfterReveal(revealed, song);
  assert.equal(next.nextIndex, 3);
  assert.equal(next.skipped, 1);
  assert.equal(next.correct, 0);
  assert.deepEqual(next.results, [{ index: 1, outcome: 'skipped' }]);
  const finished = continueAfterReveal(revealAnswer(next), song);
  assert.equal(finished.phase, 'complete');
  assert.equal(finished.skipped, 2);
});

test('initials and hinted mode can be combined and restored midway through a song', () => {
  const song = makeSong(6);
  let session = makeSession(song, 0, { answerMode: 'initials', chainMode: 'hinted' });
  session = submitAnswer(session, song, lyricInitials(song.lines[1].text)).session;
  const preferences = getModes(session);
  const state = { version: 2, library: [song], sessions: { '456': session }, activeId: '456', best: { [bestKey(song.id, session)]: 1 }, preferences };
  const storage = storageFor(state);
  saveState(state, storage);
  const restored = loadState(storage).state;
  assert.deepEqual(restored.preferences, preferences);
  assert.equal(restored.sessions['456'].nextIndex, 3);
  assert.equal(restored.sessions['456'].answerMode, 'initials');
  assert.equal(restored.sessions['456'].chainMode, 'hinted');
  assert.equal(restored.best[bestKey(song.id, preferences)], 1);
  assert.equal(restored.best[bestKey(song.id, {})], 0);
});

test('invalid or mismatched mode progress cannot resume', () => {
  const song = makeSong(6);
  const initial = makeSession(song);
  assert.equal(isValidSession({ ...initial, answerMode: 'unknown' }, song), false);
  assert.equal(isValidSession({ ...initial, chainMode: 'unknown' }, song), false);
  const answered = submitAnswer(initial, song, song.lines[1].text).session;
  assert.equal(isValidSession({ ...answered, chainMode: 'hinted' }, song), false);
});

test('version 1 saves migrate to standard continuous mode without losing valid progress', () => {
  const song = makeSong(4);
  const session = submitAnswer(makeSession(song), song, song.lines[1].text).session;
  delete session.answerMode;
  delete session.chainMode;
  const restored = loadState(storageFor({ version: 1, library: [song], sessions: { '456': session }, activeId: '456', best: { '456': 1 } })).state;
  assert.equal(restored.version, 2);
  assert.equal(restored.activeId, '456');
  assert.equal(restored.sessions['456'].nextIndex, 2);
  assert.deepEqual(getModes(restored.sessions['456']), { answerMode: 'full', chainMode: 'continuous' });
  assert.equal(restored.best['456:full:continuous'], 1);
  assert.equal(restored.best['456:initials:continuous'], 0);
});
