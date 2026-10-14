// ============================================================
//  极简 MD5（UTF-8 输入 → 32 位小写十六进制）
//  百度翻译开放平台的签名要求：sign = MD5(appid + q + salt + 密钥)
//  不依赖 TextEncoder / crypto.subtle，纯 JS，随扩展本地运行
// ============================================================

const SHIFT = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// K[i] = floor(abs(sin(i + 1)) * 2^32)
const K = new Uint32Array(64);
for (let i = 0; i < 64; i++) {
  K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
}

// 字符串 → UTF-8 字节；落单的代理项按 U+FFFD 处理（与 TextEncoder 行为一致）
function utf8Bytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let cp = str.codePointAt(i);
    if (cp > 0xffff) i++;                       // 代理对占两个 code unit
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    }
  }
  return Uint8Array.from(out);
}

function rotl(x, c) {
  return (x << c) | (x >>> (32 - c));
}

function wordToHex(x) {
  let s = '';
  for (let i = 0; i < 4; i++) {
    s += ((x >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
  }
  return s;
}

export function md5(input) {
  const bytes = utf8Bytes(String(input == null ? '' : input));
  const len = bytes.length;

  // 补一个 0x80，再补零，最后 8 字节放原始比特长度（小端），总长是 64 的倍数
  const total = (((len + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(total);
  buf.set(bytes, 0);
  buf[len] = 0x80;

  const bits = len * 8;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, bits % 4294967296, true);
  view.setUint32(total - 4, Math.floor(bits / 4294967296), true);

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  for (let off = 0; off < total; off += 64) {
    let A = a;
    let B = b;
    let C = c;
    let D = d;

    for (let i = 0; i < 64; i++) {
      let f;
      let g;

      if (i < 16) {
        f = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        f = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        f = C ^ (B | ~D);
        g = (7 * i) % 16;
      }

      const m = view.getUint32(off + g * 4, true);
      const sum = (A + f + K[i] + m) | 0;
      const next = (B + rotl(sum, SHIFT[i])) | 0;

      A = D;
      D = C;
      C = B;
      B = next;
    }

    a = (a + A) | 0;
    b = (b + B) | 0;
    c = (c + C) | 0;
    d = (d + D) | 0;
  }

  return wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d);
}

export { utf8Bytes };
