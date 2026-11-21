// 把 ffmpeg 压出来的 H.264 裸流拆成一帧一帧，改成浏览器的解码器（WebCodecs 的 VideoDecoder）吃的样子。
// 裸流（Annex B）是一个个 NAL 用起始码（00 00 01 或 00 00 00 01）隔开；解码器要的是 AVCC：每个 NAL 前面四字节长度，
// 参数集（SPS、PPS）不放在帧里，单独拼成一份 description 在配置解码器时给。
// 都是纯函数，Node 里能直接测。

export const nalType = (nal) => nal[0] & 0x1f;

const TYPE = { slice: 1, idr: 5, sei: 6, sps: 7, pps: 8, aud: 9 };

// 按起始码切出 NAL（不带起始码）。载荷里的 00 00 03 是转义，不是起始码，不会被切开。
export function splitAnnexB(bytes) {
  const starts = [];
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
      starts.push(i);
      i += 2;
    }
  }
  const nals = [];
  for (let k = 0; k < starts.length; k++) {
    const from = starts[k] + 3;
    let to = k + 1 < starts.length ? starts[k + 1] : bytes.length;
    // 下一个起始码是四字节的话，前面那个 00 属于它；流的末尾可能补着零。
    while (to > from && bytes[to - 1] === 0) to--;
    if (to > from) nals.push(bytes.subarray(from, to));
  }
  return nals;
}

// 按分隔符（每帧开头的那个 NAL，压片时开 aud 才有）归成一帧一帧。key：这一帧能不能单独解（有 IDR）。
export function accessUnits(nals) {
  if (nals.length && nalType(nals[0]) !== TYPE.aud) throw new Error('流不是以分隔符开头的：压片时要给 x264 开 aud=1');
  const units = [];
  for (const nal of nals) {
    if (nalType(nal) === TYPE.aud) units.push({ key: false, nals: [] });
    const unit = units[units.length - 1];
    unit.nals.push(nal);
    if (nalType(nal) === TYPE.idr) unit.key = true;
  }
  return units;
}

// 头一个 SPS 和 PPS。
export function parameterSets(nals) {
  const sps = nals.find((nal) => nalType(nal) === TYPE.sps);
  const pps = nals.find((nal) => nalType(nal) === TYPE.pps);
  if (!sps || !pps) throw new Error('流里没有 SPS 或 PPS');
  return { sps, pps };
}

// 一帧的 NAL 拼成 AVCC：每个前面四字节长度（大端）。分隔符和参数集不要。
export function toAvcc(nals) {
  const keep = nals.filter((nal) => ![TYPE.aud, TYPE.sps, TYPE.pps].includes(nalType(nal)));
  const out = new Uint8Array(keep.reduce((sum, nal) => sum + 4 + nal.length, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const nal of keep) {
    view.setUint32(at, nal.length);
    out.set(nal, at + 4);
    at += 4 + nal.length;
  }
  return out;
}

// 配置解码器用的 description（avcC）。High 这几档后面还要带色度格式和位深：4:2:0、8 位。
export function avcDescription(sps, pps) {
  const head = [1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 0xff];
  const middle = [1, pps.length >> 8, pps.length & 0xff];
  const tail = [100, 110, 122, 144].includes(sps[1]) ? [0xfd, 0xf8, 0xf8, 0] : [];
  return Uint8Array.from([...head, ...sps, ...middle, ...pps, ...tail]);
}

// 解码器配置里的 codec 字符串：avc1 加档次、限制位、级别的十六进制。
export function codecString(sps) {
  const hex = (n) => n.toString(16).padStart(2, '0');
  return `avc1.${hex(sps[1])}${hex(sps[2])}${hex(sps[3])}`;
}
