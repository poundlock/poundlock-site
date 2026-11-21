// 给渲染影片的脚本算每一帧的过闸状态：用的就是页面上那个 lockStateAt，保证影片和页面上的文字是同一套节拍。
//   node tools/film/states.mjs --schedule > states.json          整段影片：照取帧表（src/scripts/film-schedule.js）取，船在走的地方密
//   node tools/film/states.mjs --schedule --every 30 > states.json  同上，但每隔 30 帧只留一帧（先抽着看镜头用）；帧号仍是取帧表里的帧号
//   node tools/film/states.mjs --frames 240 > states.json        按进度均匀取 240 帧（第一版影片的取法，留着对比用）
//   node tools/film/states.mjs --progress 0.34,0.9 > states.json  只要某几个进度（出静帧用）
import { filmSchedule } from '../../src/scripts/film-schedule.js';
import { lockStateAt } from '../../src/scripts/lock-state.js';

const args = process.argv.slice(2);
const value = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : null;
};

let points = [];
if (value('--progress')) {
  points = value('--progress').split(',').map((text, index) => ({ index, progress: Number(text) }));
} else if (args.includes('--schedule')) {
  const every = Number(value('--every') ?? 1);
  const table = filmSchedule();
  points = table.map((progress, index) => ({ index, progress })).filter(({ index }) => index % every === 0 || index === table.length - 1);
} else {
  const frames = Number(value('--frames') ?? 240);
  points = Array.from({ length: frames }, (_, index) => ({ index, progress: index / (frames - 1) }));
}

const states = points.map(({ index, progress }) => ({ index, progress, ...lockStateAt(progress) }));
process.stdout.write(JSON.stringify(states));
