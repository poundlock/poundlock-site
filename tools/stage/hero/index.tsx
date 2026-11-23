import { useMemo, type ReactNode } from 'react'
// 只引用到用到的部件：从各自的文件引，打包时不把整套套件的样式带进来
import { Stage } from '../kit/stage'
import { Window } from '../kit/window'
import type { Act } from '../kit/act'
import { Collapse } from '../kit/motion/Collapse'
import { Roll } from '../kit/motion/Roll'
import { States } from '../kit/motion/States'
import './hero.css'

// poundlock 官网首屏：一个 Claude Code 会话里跑完一趟。
// 节拍：输入 /poundlock:at 加一句需求 → 项目经理亮出需求稿，回车批准 → 八个阶段一段段往前走（底下一行进度）→
// 实现那一段，有个角色想写不归它管的文件，被门禁拦下，改由认领这个文件的角色去写 → 业务验收「结论：通过」，八段走完，停两秒。
//
// 终端的内容贴着底部往上长，和真的终端一样：开头那一帧，屏幕上是上一趟跑完的样子（也是海报）；
// 新的一趟把它推出顶上。两条需求轮流跑，不重复敲同一条命令；跑完以后屏幕上又是「一趟跑完的样子」，
// 看不见地复位（垫在上面的几趟跟着换一遍，屏幕上分毫不差），接上下一圈。
//
// 真文字只放在故事上：命令、需求稿、批准的那一项、被拦的那次写入和门禁的原话、改由谁写、验收结论、正在跑的那一段。
// 文案不写在这里：在官网的 src/copy/hero-demo.json（中英两页都用这一份，插件本身是中文的），页面挂演示时传进来。
// 没有光标：终端里是键盘在动，回车用键帽表示。

export type Req = {
  command: string
  draft: string
  writer: string
  owner: string
  file: string
  gateSays: string
}

export type Copy = {
  title: string
  draftLabel: string
  approve: string
  revise: string
  answered: string
  gate: string
  verdictWho: string
  verdict: string
  allDone: string
  reqs: [Req, Req]
  stages: { id: string; name: string; who: string }[]
}

type Run = {
  sent: boolean
  ask: boolean
  answered: boolean
  /** 正在跑第几段（1 到 8），0 是还没开始 */
  stage: number
  /** 走完了几段 */
  done: number
  write: boolean
  blocked: boolean
  rewrite: boolean
  verdict: boolean
}

/** n：这一圈敲的是第几条需求（0 或 1）。垫在上面的两趟依次是这一条、另一条，正好是「上上趟、上一趟」 */
type S = Run & { typed: string; n: 0 | 1 }

const FRESH: Run = { sent: false, ask: false, answered: false, stage: 0, done: 0, write: false, blocked: false, rewrite: false, verdict: false }
const FINISHED: Run = { sent: true, ask: false, answered: true, stage: 8, done: 8, write: true, blocked: true, rewrite: true, verdict: true }
const initial: S = { ...FRESH, typed: '', n: 0 }

// 节奏照官网的动效规矩「水慢、闸快」：记录往上推是水位在升（样式里 0.7 秒、水的曲线），段与段之间留够看的时间；
// 只有门禁拦下那一下是快的（样式里那块反白的牌子像闸门落下）。原来每段 0.5 秒上下一换、一行 0.26 秒弹出来，
// 和首屏慢慢晃的水面撞在一起，用户说「不是很和谐，有点冲突」（2026-11-22 放慢）。一圈二十四秒上下。
function makeScript(copy: Copy) {
  return async function script(a: Act<S>) {
    // 这一圈敲哪一条，看状态里的 n（上一圈收尾时换好了）
    let current: 0 | 1 = 0
    await a.set((s) => {
      current = s.n
      return {}
    })
    await a.wait(1200)
    await a.type('typed', copy.reqs[current].command, { interval: 55 })
    await a.wait(420)
    await a.key('enter')
    await a.set({ sent: true, typed: '' })
    await a.wait(900)
    a.mark('ask')
    await a.set({ ask: true })
    await a.wait(2100)
    await a.key('enter')
    // 先把面板收起，新的一行再从下面进来：不在同一个位置叠着淡入两段字（面板收起要 0.5 秒）
    await a.set({ ask: false })
    await a.wait(560)
    await a.set({ answered: true, stage: 1 })
    // S1 到 S4：一段接一段
    for (let i = 1; i <= 4; i++) {
      await a.wait(820)
      await a.set({ done: i, stage: i + 1 })
    }
    // S5 实现：一个角色想写不归它管的文件，门禁拦下，改由认领这个文件的角色写
    await a.wait(980)
    await a.set({ write: true })
    await a.wait(860)
    a.mark('gate')
    await a.set({ blocked: true })
    await a.wait(2400)
    await a.set({ rewrite: true })
    await a.wait(1200)
    await a.set({ done: 5, stage: 6 })
    await a.wait(820)
    await a.set({ done: 6, stage: 7 })
    await a.wait(980)
    a.mark('verdict')
    await a.set({ verdict: true })
    await a.wait(760)
    await a.set({ done: 7, stage: 8 })
    await a.wait(820)
    await a.set({ done: 8 })
    a.mark('payoff')
    await a.wait(3600)
    // 屏幕上这时是「一趟跑完的样子」：活的这一趟收起、换下一条需求，垫在上面的几趟跟着换一遍。看不见地复位
    await a.snap({ ...FRESH, typed: '', n: current === 0 ? 1 : 0 })
  }
}

// width、height：宽版的设计尺寸；compactHeight：手机那一版的设计高（宽固定 358）。官网按留给演示的那块地方的
// 长宽比传进来（字的放大倍数保持在一个范围里），终端跟着变宽、变高。
export function PoundlockHero({
  copy,
  className,
  fill = false,
  width = 720,
  height = 540,
  compactHeight = 372,
}: {
  copy: Copy
  className?: string
  fill?: boolean
  width?: number
  height?: number
  compactHeight?: number
}) {
  // 同一份文案只造一次脚本：脚本换了舞台会从头放
  const script = useMemo(() => makeScript(copy), [copy])
  return (
    <Stage<S>
      width={width}
      height={height}
      compact={{ below: 600, width: 358, height: compactHeight }}
      theme="dark"
      fill={fill}
      initial={initial}
      poster={initial}
      script={script}
      keys={{ wide: 'bottom-right', compact: 'bottom-right' }}
      className={`ph${className ? ` ${className}` : ''}`}
    >
      {(s, _rect, layout) => {
        const other = s.n === 0 ? 1 : 0
        return (
          <Window chrome="terminal" lights="color" title={layout === 'wide' ? copy.title : undefined} className="ph-win">
            <div className="ss-term ph-term" data-crop>
              {/* 跑完的样子垫在上面，两条需求交替、紧挨着活的这一趟的是另一条：复位那一下前后看起来分毫不差。
                  垫三趟：官网在高屏上把终端放得很高，两趟垫不满时顶上会露出空白、复位也看得见 */}
              <Transcript copy={copy} req={copy.reqs[other]} run={FINISHED} />
              <Transcript copy={copy} req={copy.reqs[s.n]} run={FINISHED} />
              <Transcript copy={copy} req={copy.reqs[other]} run={FINISHED} />
              <Transcript copy={copy} req={copy.reqs[s.n]} run={s} live />
              <div className="ph-input">
                <span className="ph-input__sigil">&gt;</span>
                <span className="ph-input__text" data-typing>
                  {s.typed}
                </span>
                <span className="ss-term__caret ph-caret" data-snap data-still={s.typed ? true : undefined} />
              </div>
            </div>
          </Window>
        )
      }}
    </Stage>
  )
}

// 一趟的记录：你说的那句、需求稿的面板（只在问你的时候）、批准的那一项、被拦的那次写入、改由谁写、验收结论；
// 最下面紧挨着输入框是一行进度（正在跑的那一段、谁在干、八格），像 Claude Code 干活时钉在底下的那一行。
function Transcript({ copy, req, run, live }: { copy: Copy; req: Req; run: Run; live?: boolean }) {
  const all = run.done >= 8
  const current = copy.stages[Math.max(0, Math.min(7, run.stage - 1))]
  return (
    <div className="ph-run" data-live={live || undefined}>
      <Collapse open={run.sent}>
        <div className="ph-user">
          <span className="ph-user__sigil">&gt;</span>
          {req.command}
        </div>
      </Collapse>

      <Collapse open={run.ask} reveal="drop">
        <div className="ph-ask">
          <div className="ph-ask__head">{copy.draftLabel}</div>
          <div className="ph-ask__body">{req.draft}</div>
          <div className="ph-ask__opt" data-on>
            <span className="ph-ask__pick">❯</span>1. {copy.approve}
          </div>
          <div className="ph-ask__opt">
            <span className="ph-ask__pick" />2. {copy.revise}
          </div>
        </div>
      </Collapse>

      <Collapse open={run.answered}>
        <Line>
          {copy.answered} <span className="ph-faint">→</span> <b>{copy.approve}</b>
        </Line>
      </Collapse>

      <Collapse open={run.write}>
        <Line>
          <b>{req.writer}</b> <span className="ph-faint">Write({req.file})</span>
        </Line>
      </Collapse>

      <Collapse open={run.blocked}>
        <div className="ph-result">
          <span className="ph-result__hook">└</span>
          <span className="ph-gate">{copy.gate}</span>
          <span className="ph-result__text">{req.gateSays}</span>
        </div>
      </Collapse>

      <Collapse open={run.rewrite}>
        <Line>
          <b>{req.owner}</b> <span className="ph-faint">Write({req.file})</span>
        </Line>
      </Collapse>

      <Collapse open={run.verdict}>
        <Line>
          <b>{copy.verdictWho}</b> <span className="ph-ok">{copy.verdict}</span>
        </Line>
      </Collapse>

      <Collapse open={run.answered}>
        <div className="ph-status" data-all={all || undefined}>
          <States className="ph-status__mark" align="start" value={all ? 'done' : 'run'} states={{ run: <span className="ph-spin" />, done: <span className="ph-tick">✓</span> }} />
          <span className="ph-status__label">
            <Roll>{all ? copy.allDone : `${current.id} ${current.name}`}</Roll>
          </span>
          <span className="ph-status__who">
            <Roll>{all ? ' ' : current.who}</Roll>
          </span>
          <span className="ph-meter" aria-hidden>
            {copy.stages.map((stage, i) => (
              <i key={stage.id} data-state={i < run.done ? 'done' : i === run.stage - 1 ? 'run' : 'todo'} />
            ))}
          </span>
        </div>
      </Collapse>
    </div>
  )
}

function Line({ children }: { children: ReactNode }) {
  return (
    <div className="ph-line">
      <span className="ph-line__dot">●</span>
      <span className="ph-line__text">{children}</span>
    </div>
  )
}
