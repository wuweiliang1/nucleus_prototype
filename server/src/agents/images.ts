export interface ChatImage {
  name: string;
  dataUrl: string;
}

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_URL = /^data:image\/(jpeg|png|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

function matchesFormat(format: string, bytes: Buffer): boolean {
  switch (format) {
    case 'jpeg':
      return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    case 'png':
      return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case 'gif':
      return /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6));
    case 'webp':
      return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    default:
      return false;
  }
}

export function parseChatImages(value: unknown): ChatImage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_IMAGES) {
    throw new Error('每条消息最多可发送 3 张图片');
  }

  return value.map((item: unknown, index) => {
    if (!item || typeof item !== 'object' || !('dataUrl' in item) || typeof item.dataUrl !== 'string') {
      throw new Error('请上传 JPEG、PNG、GIF 或 WebP 图片');
    }
    const dataUrl = item.dataUrl;
    if (dataUrl.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 32) {
      throw new Error('单张图片不能超过 2 MB');
    }
    const match = IMAGE_URL.exec(dataUrl);
    if (!match || match[2].length % 4 !== 0) {
      throw new Error('请上传 JPEG、PNG、GIF 或 WebP 图片');
    }
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('单张图片不能超过 2 MB');
    if (!matchesFormat(match[1], bytes)) throw new Error('图片文件与声明的格式不匹配');
    const name = 'name' in item && typeof item.name === 'string' ? item.name.trim().slice(0, 120) : '';
    return { name: name || `图片 ${index + 1}`, dataUrl };
  });
}
