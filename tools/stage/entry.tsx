// 官网首屏用的入口：把演示挂到页面上给的那个元素里。build.mjs 把它连同 React 打包成一个 ES 模块，
// 放在 src/assets/stage/hero-demo.js（样式在旁边的 hero-demo.css），页面的 main.js 动态引进来。
//
// 文案：元素上的 data-demo-copy（页面构建时从 src/copy/hero-demo.json 写进去）。取不到、解析不了就抛出去，
// main.js 接住以后退回图标的三片。
//
// 尺寸：元素多大由页面的样式定（宽屏、高屏两种版式，见 src/styles/sections/hero.css）；按它的长宽比给舞台定
// 设计尺寸（size.js）：字放大到 1.45 倍就不再放大，多出来的地方让终端变宽、变高，不让字越来越大。
//
// 舞台头一帧按设计尺寸画、量过容器以后才放大：等缩放连着两帧不变了再给元素标 data-ready，由样式淡入，不闪那一下。
import { useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PoundlockHero, type Copy } from './hero'
import { designSize } from './size.js'

type Size = { width: number; height: number; compactHeight: number }

function SiteHero({ element, copy }: { element: HTMLElement; copy: Copy }) {
  const [size, setSize] = useState<Size>(() => designSize(element.clientWidth, element.clientHeight))
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => {
      const next = designSize(element.clientWidth, element.clientHeight)
      setSize((prev) =>
        prev.width === next.width && prev.height === next.height && prev.compactHeight === next.compactHeight ? prev : next,
      )
    })
    ro.observe(element)
    return () => ro.disconnect()
  }, [element])
  return (
    <PoundlockHero className="ph--site" fill copy={copy} width={size.width} height={size.height} compactHeight={size.compactHeight} />
  )
}

export function mountHeroDemo(element: HTMLElement) {
  const copy = JSON.parse(element.dataset.demoCopy || '') as Copy
  if (!copy || !Array.isArray(copy.reqs) || copy.reqs.length !== 2 || !Array.isArray(copy.stages) || copy.stages.length !== 8) {
    throw new Error('首屏演示的文案不全')
  }
  const root = createRoot(element)
  root.render(<SiteHero element={element} copy={copy} />)
  let last = ''
  let steady = 0
  let frames = 0
  const settle = () => {
    const stage = element.querySelector<HTMLElement>('.ss-stage')
    const now = stage ? stage.style.transform : ''
    steady = now && now === last ? steady + 1 : 0
    last = now
    frames++
    if (steady >= 2 || frames > 30) element.setAttribute('data-ready', '')
    else requestAnimationFrame(settle)
  }
  requestAnimationFrame(settle)
  return {
    destroy() {
      root.unmount()
    },
  }
}
