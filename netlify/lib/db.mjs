// 資料儲存：在 Netlify 上用 Netlify Blobs；本機開發時改存到 .data 資料夾
import { getStore } from '@netlify/blobs';
import { promises as fs } from 'node:fs';
import path from 'node:path';

class FileStore {
  constructor(name) {
    this.dir = path.join(process.cwd(), '.data', name);
  }
  file(key) {
    return path.join(this.dir, encodeURIComponent(key) + '.json');
  }
  async getWithMetadata(key) {
    try {
      const text = await fs.readFile(this.file(key), 'utf8');
      return { data: JSON.parse(text), etag: String(text.length) + ':' + hash(text) };
    } catch {
      return null;
    }
  }
  async setJSON(key, value, opts = {}) {
    const cur = await this.getWithMetadata(key);
    if (opts.onlyIfNew && cur) return { modified: false };
    if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.file(key), JSON.stringify(value));
    return { modified: true };
  }
  async list({ prefix = '' } = {}) {
    let names = [];
    try { names = await fs.readdir(this.dir); } catch {}
    const blobs = names
      .map((n) => decodeURIComponent(n.replace(/\.json$/, '')))
      .filter((k) => k.startsWith(prefix))
      .map((key) => ({ key }));
    return { blobs };
  }
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function store(name) {
  try {
    return getStore({ name, consistency: 'strong' });
  } catch (e) {
    // 不在 Netlify 上（本機開發）時才改用檔案
    if (e.name === 'MissingBlobsEnvironmentError') return new FileStore(name);
    throw e;
  }
}

export const orders = () => store('orders');
export const days = () => store('days');

export async function readJSON(st, key) {
  const r = await st.getWithMetadata(key, { type: 'json' });
  return r ? r.data : null;
}

// 安全地「讀取→修改→寫回」，避免兩個人同時預約時互相蓋掉
export async function updateJSON(st, key, fn, fallback) {
  for (let i = 0; i < 8; i++) {
    const cur = await st.getWithMetadata(key, { type: 'json' });
    const value = fn(cur ? cur.data : structuredClone(fallback));
    if (value === undefined) return cur ? cur.data : null; // 不需要寫入
    const opts = cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true };
    const res = await st.setJSON(key, value, opts);
    if (res.modified) return value;
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 150));
  }
  throw new Error('系統忙碌，請再試一次');
}
