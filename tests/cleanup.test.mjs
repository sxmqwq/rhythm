import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLyrics, cleanLyricLines, lyricsRevision, makeSession } from '../core.mjs';
import { loadState } from '../storage.mjs';

test('known singer names, song headers and Chinese or English credits never become questions', () => {
  const data = parseLyrics('[ar:歌手甲 / 歌手乙]\n[ti:夜行]\n[00:00]夜行 - 歌手甲\n[00:01]歌手甲\n[00:02]歌手名称：歌手乙\n[00:03]Artist: 歌手甲\n[00:04]发行公司：测试\n[00:05]作词 测试\n[00:06]Lyrics by Test\n[00:07]Music Director: Test\n[00:08]【副歌】\n[00:10]晚风来过\n[00:20]星光亮起\n[ar:歌手甲 / 歌手乙]');
  assert.deepEqual(data.lines.map(line => line.text), ['晚风来过', '星光亮起']);
});

test('API metadata cleans bare artist and combined title headers without requiring LRC tags', () => {
  const data = parseLyrics('[00:00]歌手甲\n[00:01]歌手甲 - 夜行\n[00:10]晚风来过\n[00:20]星光亮起', { artist: '歌手甲', name: '夜行' });
  assert.deepEqual(data.lines.map(line => line.text), ['晚风来过', '星光亮起']);
});

test('duet singer labels are stripped while their sung text and timings are preserved', () => {
  const data = parseLyrics('[ar:歌手甲 / 歌手乙]\n[00:10]歌手甲：晚风来过\n[00:20]【歌手乙】星光亮起\n[00:30]男：我们继续\n[00:40]合：一起向前');
  assert.deepEqual(data.lines, [{ time: 10000, text: '晚风来过' }, { time: 20000, text: '星光亮起' }, { time: 30000, text: '我们继续' }, { time: 40000, text: '一起向前' }]);
});

test('real lyrics mentioning singers, titles or credit words are preserved', () => {
  const data = parseLyrics('作词是我的爱好\n我听歌手甲唱夜行\n她说：你好\n夜行\n歌手甲夜行\n演唱让我快乐\nMusic makes me happy', { artist: '歌手甲', name: '夜行' });
  assert.equal(data.lines.length, 7);
});

test('cached version 1 lyrics are cleaned and only affected sessions and records are reset', () => {
  const lines = [{ time: 0, text: '歌手甲' }, { time: 10000, text: '歌手甲：晚风来过' }, { time: 20000, text: '星光亮起' }];
  const song = { id: '1', artist: '歌手甲', name: '夜行', lines, revision: lyricsRevision(lines) };
  const clean = { id: '2', artist: '歌手乙', name: '另一首', ...parseLyrics('天色很美\n我们向前\n一同出发') };
  const raw = { version: 1, library: [song, clean], activeId: '1', sessions: { '1': makeSession(song), '2': makeSession(clean) }, best: { '1': 5, '2': 3 } };
  const restored = loadState({ getItem: () => JSON.stringify(raw) });
  assert.equal(restored.state.library.length, 2);
  assert.deepEqual(restored.state.library[0].lines, [{ time: 10000, text: '晚风来过' }, { time: 20000, text: '星光亮起' }]);
  assert.equal(restored.state.sessions['1'], undefined);
  assert.equal(restored.state.best['1:full:continuous'], 0);
  assert.equal(restored.state.best['2:full:continuous'], 3);
  assert.equal(restored.state.sessions['2'].nextIndex, 1);
  assert.equal(restored.state.activeId, null);
  assert.match(restored.notice, /1 首/);
});

test('cleaning is idempotent and preserves repeated chorus positions', () => {
  const lines = [{ time: 0, text: '歌手甲' }, { time: 1000, text: '歌手甲：晚风来过' }, { time: 2000, text: '晚风来过' }];
  const cleaned = cleanLyricLines(lines, { artist: '歌手甲' });
  assert.equal(cleaned.length, 2);
  assert.deepEqual(cleanLyricLines(cleaned, { artist: '歌手甲' }), cleaned);
});
