import { METING_BASE, GD_BASE, REQUEST_TIMEOUT } from './config.mjs';

export function safeHttps(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
}

export class NeteaseClient {
  constructor({ fetchImpl = globalThis.fetch.bind(globalThis), timeout = REQUEST_TIMEOUT } = {}) {
    this.fetchImpl = fetchImpl;
    this.timeout = timeout;
  }

  async request(base, params, { signal, text = false } = {}) {
    const url = new URL(base);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, this.timeout);
    try {
      const response = await this.fetchImpl(url.href, { signal: controller.signal, credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error(`歌词服务暂时不可用（${response.status}），请稍后重试。`);
      const body = await response.text();
      if (body.length > 2_000_000) throw new Error('服务返回的内容过大。');
      if (text) return body;
      let data;
      try { data = JSON.parse(body); } catch { throw new Error('歌词服务返回了异常内容，请稍后重试。'); }
      if (data?.error) throw new Error('暂时没有读取到这首歌曲，请检查链接或稍后重试。');
      return data;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (controller.signal.aborted) throw new Error('读取超时了，请重试。已导入的歌曲仍然可以接龙。');
      if (error instanceof TypeError) throw new Error('暂时连接不上歌词服务，请检查网络或稍后重试。');
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  async search(query, { signal } = {}) {
    const data = await this.request(GD_BASE, { types: 'search', source: 'netease', name: query, count: '20', pages: '1' }, { signal });
    if (!Array.isArray(data)) throw new Error('搜索暂时不可用，请重试或粘贴网易云歌曲链接。');
    return data.filter(item => /^\d+$/u.test(String(item.id)) && (!item.source || item.source === 'netease')).map(item => ({
      id: String(item.id), name: String(item.name || '未命名歌曲'),
      artist: Array.isArray(item.artist) ? item.artist.join(' / ') : String(item.artist || '未知歌手'),
      album: String(item.album || ''), lyricId: String(item.lyric_id || item.id),
      cover: '', source: 'netease',
    }));
  }

  async song(id, { signal } = {}) {
    const data = await this.request(METING_BASE, { server: 'netease', type: 'song', id }, { signal });
    const item = Array.isArray(data) ? data[0] : null;
    if (!item?.name) throw new Error('没有读取到歌曲信息，请确认网易云歌曲 ID。');
    return { id: String(id), name: String(item.name), artist: String(item.artist || '未知歌手'), album: '', cover: safeHttps(item.pic), source: 'netease', lyricId: String(id) };
  }

  async playlist(id, { signal } = {}) {
    const data = await this.request(METING_BASE, { server: 'netease', type: 'playlist', id }, { signal });
    if (!Array.isArray(data) || !data.length) throw new Error('歌单为空或暂时无法读取。请使用公开歌单的完整链接。');
    const seen = new Set();
    return data.slice(0, 200).flatMap(item => {
      // The adapter returns a lyric URL containing the original NetEase song ID.
      let songId;
      try {
        const url = new URL(item.lrc);
        if (url.origin !== new URL(METING_BASE).origin || url.searchParams.get('server') !== 'netease') return [];
        songId = url.searchParams.get('id');
      } catch { return []; }
      if (!/^[1-9]\d{0,19}$/u.test(songId ?? '') || seen.has(songId)) return [];
      seen.add(songId);
      return [{ id: songId, lyricId: songId, name: String(item.name || '未命名歌曲'), artist: String(item.artist || '未知歌手'), album: '', cover: safeHttps(item.pic), source: 'netease' }];
    });
  }

  async lyrics(song, { signal } = {}) {
    const providers = [
      async () => {
        const body = await this.request(METING_BASE, { server: 'netease', type: 'lrc', id: song.id }, { signal, text: true });
        if (!body.trim() || /^\s*[\[{]\s*(?:"|\{|\])/u.test(body) || /<(?:!doctype|html)/iu.test(body)) throw new Error('没有读到原文歌词。');
        return { raw: body, provider: 'injahow' };
      },
      async () => {
        const data = await this.request(GD_BASE, { types: 'lyric', source: 'netease', id: song.lyricId || song.id }, { signal });
        if (typeof data?.lyric !== 'string' || !data.lyric.trim()) throw new Error('这首歌暂时没有可用的原文歌词。');
        // tlyric is a separate translation track and must never enter the chain.
        return { raw: data.lyric, provider: 'GD音乐台' };
      },
    ];
    let failure;
    for (const provider of providers) {
      try { return await provider(); } catch (error) { if (signal?.aborted) throw error; failure = error; }
    }
    throw failure || new Error('读取歌词失败，请稍后重试。');
  }
}
