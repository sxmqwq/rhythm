import test from 'node:test';
import assert from 'node:assert/strict';
import { NeteaseClient, safeHttps } from '../api.mjs';

const response = value => new Response(typeof value === 'string' ? value : JSON.stringify(value));
test('search requests NetEase only and normalizes metadata without accepting foreign sources', async () => {
  const client = new NeteaseClient({ fetchImpl: async (url, options) => {
    assert.equal(new URL(url).searchParams.get('source'), 'netease');
    assert.equal(options.credentials, 'omit');
    return response([{ id: '1', name: '<script>测试</script>', artist: ['歌手甲', '歌手乙'], source: 'netease' }, { id: '2', source: 'tencent' }]);
  } });
  const songs = await client.search('测试');
  assert.equal(songs.length, 1);
  assert.equal(songs[0].name, '<script>测试</script>');
  assert.equal(songs[0].artist, '歌手甲 / 歌手乙');
});
test('lyric requests prefer a separate original track and never mix in translation', async () => {
  const calls = [];
  const client = new NeteaseClient({ fetchImpl: async url => {
    calls.push(url);
    assert.equal(new URL(url).searchParams.get('types'), 'lyric');
    return response({ lyric: '[00:01]original one\n[00:02]original two', tlyric: '[00:01]翻译一\n[00:02]翻译二' });
  } });
  const result = await client.lyrics({ id: '1' });
  assert.equal(calls.length, 1);
  assert.equal(result.provider, 'GD音乐台');
  assert.ok(result.raw.includes('original one'));
  assert.ok(!result.raw.includes('翻译'));
});
test('an original-track outage falls back to Meting with its provider identity retained', async () => {
  const calls = [];
  const client = new NeteaseClient({ fetchImpl: async url => {
    calls.push(url);
    if (new URL(url).searchParams.has('types')) throw new TypeError('network');
    return response('[00:01]original one (翻译一)\n[00:02]original two (翻译二)');
  } });
  const result = await client.lyrics({ id: '1' });
  assert.equal(calls.length, 2);
  assert.equal(result.provider, 'injahow');
  assert.ok(result.raw.includes('original one'));
});
test('a translation-only response cannot replace the original lyric track', async () => {
  const client = new NeteaseClient({ fetchImpl: async url => new URL(url).searchParams.has('types')
    ? response({ lyric: '', tlyric: '[00:01]翻译一\n[00:02]翻译二' })
    : response('[00:01]original one\n[00:02]original two') });
  const result = await client.lyrics({ id: '1' });
  assert.equal(result.provider, 'injahow');
  assert.ok(!result.raw.includes('翻译'));
});
test('playlist song IDs must come from the expected NetEase adapter URL', async () => {
  const client = new NeteaseClient({ fetchImpl: async () => response([
    { name: '有效', lrc: 'https://api.injahow.cn/meting/?server=netease&type=lrc&id=1' },
    { name: '恶意', lrc: 'https://example.com/?server=netease&id=2' },
    { name: '另一来源', lrc: 'https://api.injahow.cn/meting/?server=tencent&id=3' },
  ]) });
  assert.deepEqual((await client.playlist('9')).map(song => song.id), ['1']);
  assert.equal(safeHttps('javascript:alert(1)'), '');
  assert.equal(safeHttps('http://example.com'), '');
});
test('caller cancellation does not trigger another provider request', async () => {
  const controller = new AbortController();
  let calls = 0;
  const client = new NeteaseClient({ fetchImpl: async () => {
    calls++;
    controller.abort();
    throw new DOMException('aborted', 'AbortError');
  } });
  await assert.rejects(client.lyrics({ id: '1' }, { signal: controller.signal }));
  assert.equal(calls, 1);
});
