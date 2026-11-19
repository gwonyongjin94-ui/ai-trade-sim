// 큰 세계 지도: 나라 모양, 교역 흐름선, 원형 국기 배지. 확대·이동은 d3-zoom.
// 나라 모양만 지도 좌표로 그리고 확대는 transform으로 한다. 선과 배지는 화면 좌표로 다시 계산해 확대해도 크기가 그대로다.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import { ANCHOR, LAND, makeProjection, pathFor, type ViewId } from './geo'
import { BY_MAP_ID, DATA, GDP_RANK, type Direction } from './data'
import { flagUrl } from './flags'

export const COLOR = {
  land: '#27323F',
  landData: '#2F3D4C',
  partner: '#3A4C5F',
  border: '#4F6073',
  friend: '#417F5C', // 우호·성장 (영상의 녹색)
  hostile: '#B5485E', // 적대·유출 (영상의 탁한 적색을 어두운 바탕에서 보이게 밝힘)
  line: '#F1F3F4',
}

export type Arc = { iso: string; value: number; label: string }
export type Hover = { x: number; y: number; iso?: string; name: string } | null

type Props = {
  view: ViewId
  selected: string
  dir: Direction
  arcs: Arc[]
  fillFor: ((iso: string) => string | null) | null
  onSelect: (iso: string) => void
  onHover: (h: Hover) => void
  padRight: number
  padBottom: number
}

export function WorldMap({ view, selected, dir, arcs, fillFor, onSelect, onHover, padRight, padBottom }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const [size, setSize] = useState({ w: 1200, h: 760 })
  const [t, setT] = useState<ZoomTransform>(zoomIdentity)

  useLayoutEffect(() => {
    const el = wrap.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.7, 16])
      .on('zoom', (e) => setT(e.transform))
    zoomRef.current = z
    select(svgRef.current!).call(z).on('dblclick.zoom', null)
  }, [])

  // 지도가 바뀌면(태평양 ↔ 대서양) 확대를 처음으로 되돌린다. 확대 값은 투영 좌표에 붙어 있어서다
  useEffect(() => {
    if (zoomRef.current) zoomRef.current.transform(select(svgRef.current!), zoomIdentity)
  }, [view])

  const projection = useMemo(() => makeProjection(view, size.w, size.h, padRight, padBottom), [view, size, padRight, padBottom])
  const land = useMemo(() => {
    const path = pathFor(projection)
    return LAND.map((f) => ({ id: String(f.id), name: f.properties.name, d: path(f) ?? '', c: BY_MAP_ID.get(String(f.id)) }))
  }, [projection])
  const anchors = useMemo(
    () => Object.fromEntries(Object.entries(ANCHOR).map(([iso, ll]) => [iso, projection(ll)!])) as Record<string, [number, number]>,
    [projection],
  )

  const screen = (iso: string): [number, number] => {
    const [x, y] = anchors[iso]
    return [t.applyX(x), t.applyY(y)]
  }

  const partnerSet = new Set(arcs.map((a) => a.iso))
  const maxArc = Math.max(1, ...arcs.map((a) => a.value))

  // 배지 배치: 고른 나라 → 교역 상대(큰 순) → 나머지(GDP 큰 순, 화면 안에 있는 나라만).
  // 고른 나라와 교역 상대는 국기 원이 겹치면 점으로 둔다. 나머지는 겹치면 아예 빼고, 확대할수록 더 많이 놓는다.
  // 이름표는 아래 → 위 → 오른쪽 → 왼쪽 중 빈 자리에 놓고, 없으면 뺀다
  // 화면이 넓을수록, 확대할수록 많이 (데스크톱 처음 화면에서 GDP 상위 약 40곳)
  const restLimit = Math.max(8, Math.round(40 * ((size.w - padRight) / 1040) * Math.pow(t.k, 1.4)))
  const onScreen = (iso: string) => {
    const [x, y] = screen(iso)
    return x > -20 && x < size.w - padRight + 20 && y > -20 && y < size.h - padBottom + 20
  }
  const order = [
    selected,
    ...arcs.map((a) => a.iso),
    ...Object.keys(anchors)
      .filter((iso) => iso !== selected && !partnerSet.has(iso) && onScreen(iso))
      .sort((a, b) => GDP_RANK[a] - GDP_RANK[b]),
  ].filter((iso) => anchors[iso])
  // 순서: ① 고른 나라와 교역 상대의 국기 원 ② 그 이름표 ③ 나머지 나라의 원과 이름표. 그래야 교역 상대 국기가 이름표에 가리지 않는다
  type Box = { x0: number; y0: number; x1: number; y1: number }
  const placed: Box[] = []
  const free = (b: Box) => !placed.some((p) => b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0)
  const badges = order.map((iso) => {
    const [x, y] = screen(iso)
    const c = DATA.countries[iso]
    const arc = arcs.find((a) => a.iso === iso)
    const r = iso === selected ? 17 : 11
    const textW = Math.max(c.name.length * 11.5, arc ? arc.label.length * 6.6 : 0) + 12
    const textH = arc ? 30 : 17
    const circle = { x0: x - r - 1, y0: y - r - 1, x1: x + r + 1, y1: y + r + 1 }
    return { iso, x, y, r, c, arc, circle, full: false, label: null as { lx: number; ly: number } | null, textW, textH }
  })
  const placeCircle = (b: (typeof badges)[number]) => {
    b.full = b.iso === selected || free(b.circle)
    if (b.full) placed.push(b.circle)
  }
  const placeLabel = (b: (typeof badges)[number]) => {
    if (!b.full) return
    const slots = [
      { lx: 0, ly: b.r + 5 },
      { lx: 0, ly: -b.r - 5 - b.textH },
      { lx: b.r + 6 + b.textW / 2, ly: -b.textH / 2 },
      { lx: -b.r - 6 - b.textW / 2, ly: -b.textH / 2 },
    ]
    for (const s of slots) {
      const box = { x0: b.x + s.lx - b.textW / 2, y0: b.y + s.ly, x1: b.x + s.lx + b.textW / 2, y1: b.y + s.ly + b.textH }
      if (free(box)) { placed.push(box); b.label = s; return }
    }
    if (b.iso === selected) b.label = slots[0]
  }
  const lead = badges.filter((b) => b.iso === selected || partnerSet.has(b.iso))
  const rest = badges.filter((b) => !lead.includes(b))
  lead.forEach(placeCircle)
  lead.forEach(placeLabel)
  // GDP 상위 restLimit곳만 후보로 둔다. 큰 나라가 겹쳐 빠진 자리를 작은 나라가 채우지 않게
  const candidates = rest.slice(0, restLimit)
  for (const b of candidates) {
    placeCircle(b)
    if (b.full) placeLabel(b)
  }
  const shown = [...lead, ...candidates.filter((b) => b.full)]

  const zoomBy = (k: number) => zoomRef.current?.scaleBy(select(svgRef.current!), k)
  const reset = () => zoomRef.current?.transform(select(svgRef.current!), zoomIdentity)

  const landFill = (iso: string | undefined) => {
    if (!iso) return COLOR.land
    const f = fillFor?.(iso)
    if (f) return f
    if (iso === selected) return COLOR.friend
    if (partnerSet.has(iso)) return COLOR.partner
    return COLOR.landData
  }

  return (
    <div ref={wrap} className="map-wrap">
      <svg ref={svgRef} width={size.w} height={size.h} className="map-svg" role="img" aria-label="세계 지도">
        <defs>
          <marker id="head-export" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M1 1 L8 5 L1 9 Z" fill={COLOR.line} />
          </marker>
          <marker id="head-import" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M1 1 L8 5 L1 9 Z" fill={COLOR.hostile} />
          </marker>
          <clipPath id="clip-selected"><circle r={17} /></clipPath>
          <clipPath id="clip-badge"><circle r={11} /></clipPath>
        </defs>

        <g transform={t.toString()}>
          {land.map((f) => (
            <path
              key={f.id + f.name}
              d={f.d}
              className={f.c ? 'land has-data' : 'land'}
              fill={landFill(f.c?.iso)}
              stroke={f.c?.iso === selected && !fillFor ? '#8FC3A2' : COLOR.border}
              strokeWidth={f.c?.iso === selected ? 1.1 : 0.5}
              vectorEffect="non-scaling-stroke"
              onClick={() => f.c && onSelect(f.c.iso)}
              onMouseMove={(e) => onHover({ x: e.clientX, y: e.clientY, iso: f.c?.iso, name: f.c?.name ?? f.name })}
              onMouseLeave={() => onHover(null)}
            />
          ))}
        </g>

        <g className="arcs" pointerEvents="none">
          {arcs.map((a) => {
            const [sx, sy] = screen(selected)
            const [px, py] = screen(a.iso)
            const [x0, y0, x1, y1] = dir === 'export' ? [sx, sy, px, py] : [px, py, sx, sy]
            return (
              <path
                key={a.iso}
                d={arcPath(x0, y0, x1, y1, dir === 'export' ? 19 : 14, dir === 'export' ? 14 : 19)}
                fill="none"
                stroke={dir === 'export' ? COLOR.line : COLOR.hostile}
                strokeWidth={1.2 + 5 * (a.value / maxArc)}
                strokeDasharray={dir === 'import' ? '7 5' : undefined}
                strokeLinecap="round"
                opacity={0.92}
                markerEnd={`url(#head-${dir})`}
              />
            )
          })}
        </g>

        <g className="badges">
          {[...shown].reverse().map((b) =>
            b.full ? (
              <g
                key={b.iso}
                transform={`translate(${b.x},${b.y})`}
                className="badge"
                onClick={() => onSelect(b.iso)}
                onMouseMove={(e) => onHover({ x: e.clientX, y: e.clientY, iso: b.iso, name: b.c.name })}
                onMouseLeave={() => onHover(null)}
              >
                <circle r={b.r + 2} fill={b.iso === selected ? '#8FC3A2' : '#E9EDF0'} />
                <image
                  href={flagUrl(b.c)}
                  x={-b.r}
                  y={-b.r}
                  width={b.r * 2}
                  height={b.r * 2}
                  clipPath={b.iso === selected ? 'url(#clip-selected)' : 'url(#clip-badge)'}
                  preserveAspectRatio="xMidYMid slice"
                />
                {b.label && (
                  <g transform={`translate(${b.label.lx},${b.label.ly})`}>
                    <rect x={-b.textW / 2} y={0} width={b.textW} height={b.textH} rx={3} fill="rgba(14,19,25,0.86)" />
                    <text y={12.5} textAnchor="middle" className="badge-name">{b.c.name}</text>
                    {b.arc && (
                      <text y={26} textAnchor="middle" className="badge-value" fill={dir === 'export' ? '#DDE3E8' : '#F0A3B0'}>
                        {b.arc.label}
                      </text>
                    )}
                  </g>
                )}
              </g>
            ) : (
              <circle
                key={b.iso}
                cx={b.x}
                cy={b.y}
                r={3.5}
                className="badge-dot"
                fill={partnerSet.has(b.iso) ? (dir === 'export' ? COLOR.line : COLOR.hostile) : '#9AA8B5'}
                onClick={() => onSelect(b.iso)}
                onMouseMove={(e) => onHover({ x: e.clientX, y: e.clientY, iso: b.iso, name: b.c.name })}
                onMouseLeave={() => onHover(null)}
              />
            ),
          )}
        </g>
      </svg>

      <div className="zoom-buttons" style={{ bottom: padBottom + 20 }}>
        <button onClick={() => zoomBy(1.6)} aria-label="확대">+</button>
        <button onClick={() => zoomBy(1 / 1.6)} aria-label="축소">−</button>
        <button onClick={reset} aria-label="처음 보기로">⟲</button>
      </div>
    </div>
  )
}

// 두 점을 잇는 완만한 곡선. 위쪽으로 휘고, 양 끝은 배지에 가리지 않게 조금 줄인다
function arcPath(x0: number, y0: number, x1: number, y1: number, trimStart: number, trimEnd: number) {
  const dx = x1 - x0
  const dy = y1 - y0
  const dist = Math.hypot(dx, dy) || 1
  let nx = -dy / dist
  let ny = dx / dist
  if (ny > 0) { nx = -nx; ny = -ny }
  const bend = Math.min(0.28 * dist, 160)
  const cx = (x0 + x1) / 2 + nx * bend
  const cy = (y0 + y1) / 2 + ny * bend
  const a = trimToward(x0, y0, cx, cy, trimStart)
  const b = trimToward(x1, y1, cx, cy, trimEnd)
  return `M${a[0]},${a[1]} Q${cx},${cy} ${b[0]},${b[1]}`
}

function trimToward(x: number, y: number, tx: number, ty: number, d: number): [number, number] {
  const len = Math.hypot(tx - x, ty - y) || 1
  const k = Math.min(d, len * 0.4) / len
  return [x + (tx - x) * k, y + (ty - y) * k]
}
