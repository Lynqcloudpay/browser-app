import fs from 'fs';

/**
 * Strictly validate that a buffer is a genuine MP4/WebM video (>= 250KB, valid container magic bytes, never JPEG/PNG/WebP).
 */
export function isValidVideoBuffer(buf: Buffer | null | undefined): boolean {
  if (!buf || buf.length < 250000) return false;
  // Reject JPEG (FF D8 FF)
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return false;
  // Reject PNG (89 50 4E 47)
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return false;
  const headStr = buf.slice(0, 16).toString('ascii');
  if (headStr.startsWith('RIFF') && headStr.includes('WEBP')) return false;
  if (headStr.startsWith('GIF8')) return false;
  const isMp4 = buf.slice(4, 8).toString('ascii') === 'ftyp' || headStr.includes('ftyp') || headStr.includes('moov');
  const isWebm = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
  return isMp4 || isWebm;
}

/**
 * Strictly validate that a file on disk is a genuine MP4/WebM video file.
 */
export function isValidVideoFile(filePath: string): boolean {
  try {
    if (!filePath || !fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    if (stat.size < 250000) return false;
    const fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(32);
    fs.readSync(fd, header, 0, 32, 0);
    fs.closeSync(fd);
    if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return false;
    if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) return false;
    const headStr = header.slice(0, 16).toString('ascii');
    if (headStr.startsWith('RIFF') && headStr.includes('WEBP')) return false;
    const isMp4 = header.slice(4, 8).toString('ascii') === 'ftyp' || headStr.includes('ftyp') || headStr.includes('moov');
    const isWebm = header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3;
    return isMp4 || isWebm;
  } catch {
    return false;
  }
}
