import * as fs from 'fs';
import * as path from 'path';

/** 上传根目录：server/data/uploads/YYYYMM/（按年月归档） */
export const UPLOAD_ROOT = path.join(process.cwd(), 'data', 'uploads');

export const ALLOWED_IMAGE_EXT = ['.jpg', '.jpeg', '.png'];

export function yyyymm(d: Date = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const SAFE_NAME = /^[\w.-]+$/;
const SAFE_YM = /^\d{6}$/;

/** 由访问 url（/api/common/files/YYYYMM/name）解析磁盘路径；非法/越界返回 null */
export function resolveUploadUrl(url: string): string | null {
  const m = /^\/api\/common\/files\/(\d{6})\/([\w.-]+)$/.exec(url ?? '');
  if (!m) return null;
  const [, ym, name] = m;
  if (!SAFE_YM.test(ym) || !SAFE_NAME.test(name)) return null;
  const p = path.join(UPLOAD_ROOT, ym, name);
  if (!p.startsWith(UPLOAD_ROOT)) return null;
  return p;
}

/** 服务器端完整性校验：存在、非空、格式合法 */
export function checkFileIntegrity(
  ym: string,
  name: string,
): { ok: boolean; size: number; reason?: string } {
  if (!SAFE_YM.test(ym) || !SAFE_NAME.test(name)) {
    return { ok: false, size: 0, reason: '非法文件名' };
  }
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_IMAGE_EXT.includes(ext)) {
    return { ok: false, size: 0, reason: `不支持的格式 ${ext}` };
  }
  const p = path.join(UPLOAD_ROOT, ym, name);
  if (!fs.existsSync(p)) return { ok: false, size: 0, reason: '文件不存在（待传）' };
  const size = fs.statSync(p).size;
  if (size <= 0) return { ok: false, size: 0, reason: '空文件' };
  return { ok: true, size };
}

export function parseUploadUrl(url: string): { ym: string; name: string } | null {
  const m = /^\/api\/common\/files\/(\d{6})\/([\w.-]+)$/.exec(url ?? '');
  return m ? { ym: m[1], name: m[2] } : null;
}
