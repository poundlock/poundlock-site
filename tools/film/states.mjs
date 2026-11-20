// 给渲染影片的脚本算每一帧的过闸状态：用的就是页面上那个 lockStateAt，保证影片和页面上的文字是同一套节拍。
//   node tools/film/states.mjs --frames 240 > states.json     整段影片，第一帧是进度 0，最后一帧是进度 1
//   node tools/film/states.mjs --progress 0.34,0.9 > states.json   只要某几个进度（出静帧用）
import { lockStateAt } from '../../src/scripts/lock-state.js';

const args = process.argv.slice(2);
const value = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : null;
};

let points = [];
if (value('--progress')) {
  points = value('--progress').split(',').map(Number);
} else {
  const frames = Number(value('--frames') ?? 240);
  points = Array.from({ length: frames }, (_, i) => i / (frames - 1));
}

const states = points.map((progress, index) => ({ index, progress, ...lockStateAt(progress) }));
process.stdout.write(JSON.stringify(states));
