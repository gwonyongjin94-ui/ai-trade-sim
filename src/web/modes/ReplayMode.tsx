// AI 리플레이 모드: 로컬에서 돌린 실험 기록(public/replays/)을 분기마다 다시 보여 준다. 사이트에는 API 키가 없다.
// 지도: 공개 성명 = 말풍선, 비공개 메시지 = 흰 점선, 확전점수 = 행위국 → 대상국 적색 화살표(굵기 = 점수),
// 유효한 약속 = 녹색 선, 약속 위반 = 깜빡이는 적색 고리.
// 주소: #replay/<나라>/<기록 id>/<분기>/<p = 비공개 판단 보기>

import { useEffect, useMemo, useState } from 'react'
import type { ModeProps } from '../App'
import { blocOf, HOME, MEMBERS, rname, SHORT } from '../blocs'
import { DATA } from '../data'
import { flagUrl } from '../flags'
import { quarterLabel, Screen } from '../Screen'
import { Timeline } from '../Timeline'
import type { Link } from '../WorldMap'
import type { ReplayBloc, ReplayFile, ReplayIndexEntry, ReplayKind, ReplayQuarter, Tone } from '../replay/types'
import { BLOCS, type BlocId } from '../../v2/regions'

const ESCALATION = 12
const TONE_COLOR: Record<Tone, string> = { cooperative: '#7DBB96', neutral: '#A9B4BE', warning: '#D9A75A', threat: '#E0566F' }
const TONE_LABEL: Record<Tone, string> = { cooperative: '협력', neutral: '중립', warning: '경고', threat: '위협' }
const KIND_LABEL: Record<ReplayKind, string> = { llm: 'AI 지도자', rule: '규칙 지도자', mock: '모의 응답' }
// 말풍선 자리 (대표국 배지 기준, 화면 px)
const BUBBLE: Record<BlocId, [number, number]> = { A: [26, -96], B: [-226, -86], C: [30, -20], D: [-120, -112], E: [-96, -122], F: [22, 26] }

const base = import.meta.env.BASE_URL
const indexP = fetch(`${base}replays/index.json`).then((r) => (r.ok ? (r.json() as Promise<ReplayIndexEntry[]>) : []))
const files = new Map<string, Promise<ReplayFile>>()
function loadReplay(id: string) {
  let p = files.get(id)
  if (!p) {
    p = fetch(`${base}replays/${id}.json`).then((r) => {
      if (!r.ok) throw new Error(String(r.status))
      return r.json() as Promise<ReplayFile>
    })
    p.catch(() => files.delete(id))
    files.set(id, p)
  }
  return p
}

function useReplay(id: string | null) {
  const [index, setIndex] = useState<ReplayIndexEntry[] | null>(null)
  const [file, setFile] = useState<{ id: string; f: ReplayFile | null; error: boolean } | null>(null)
  useEffect(() => {
    let live = true
    indexP.then((x) => live && setIndex(x), () => live && setIndex([]))
    return () => { live = false }
  }, [])
  const want = id ?? index?.[0]?.id ?? null
  useEffect(() => {
    if (!want) return
    let live = true
    loadReplay(want).then((f) => live && setFile({ id: want, f, error: false }), () => live && setFile({ id: want, f: null, error: true }))
    return () => { live = false }
  }, [want])
  return { index, id: want, file: file?.id === want ? file.f : null, error: file?.id === want && file.error }
}

const involved = (qq: ReplayQuarter | null, b: BlocId) => (qq ? qq.es.reduce((a, e) => a + (e.from === b || e.to === b ? Math.abs(e.score) : 0), 0) : 0)
const signed = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x)}`
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

function quarterSummary(qq: ReplayQuarter) {
  const big = [...qq.es].filter((e) => e.score >= ESCALATION).sort((a, b) => b.score - a.score)
  if (big.length)
    return big
      .slice(0, 2)
      .map((e) => `${rname(e.from)} → ${rname(e.to)} 확전 ${signed(e.score)}${e.items.length ? ` (${clip(e.items[0], 22)}${e.items.length > 1 ? ` 외 ${e.items.length - 1}건` : ''})` : ''}`)
      .join(' · ')
  const parts: string[] = []
  if (qq.newCommitments.length) parts.push(`새 약속 ${qq.newCommitments.length}건`)
  const firstV = qq.violations.filter((v) => v.first)
  if (firstV.length) parts.push(`약속 위반 ${firstV.map((v) => rname(v.obligor)).join('·')}`)
  const posts = BLOCS.reduce((a, b) => a + qq.blocs[b].statements.length, 0)
  const msgs = BLOCS.reduce((a, b) => a + qq.blocs[b].messages.length, 0)
  const changed = BLOCS.filter((b) => qq.blocs[b].changeCount > 0)
  if (changed.length) parts.push(`정책을 바꾼 나라 ${changed.map((b) => SHORT[b]).join('·')}`)
  if (posts || msgs) parts.push(`공개 성명 ${posts} · 비공개 메시지 ${msgs}`)
  return parts.length ? parts.join(' · ') : '아무도 정책을 바꾸지 않았습니다'
}

export function ReplayMode({ iso, rest, setIso, setRest, onMode }: ModeProps) {
  const { index, id, file, error } = useReplay(rest[0] || null)
  const n = file?.quarters.length ?? 16
  const qRaw = Number(rest[1])
  const q = Number.isInteger(qRaw) && qRaw >= 0 && qRaw < n ? qRaw : 0
  const showPrivate = rest[2] === 'p'
  const set = (p: { id?: string; q?: number; priv?: boolean }) =>
    setRest([p.id ?? id ?? '', String(p.q ?? (p.id && p.id !== id ? 0 : q)), (p.priv ?? showPrivate) ? 'p' : ''])

  const focus = blocOf(iso)
  const qq = file?.quarters[q] ?? null
  const c = DATA.countries[iso]

  const links: Link[] = useMemo(() => {
    if (!qq) return []
    const out: Link[] = []
    for (const [a, b] of qq.active) out.push({ from: HOME[a], to: HOME[b], color: '#7DBB96', width: 1.6, bend: -0.35, opacity: 0.7, key: `cm-${a}${b}` })
    for (const b of BLOCS)
      for (const m of qq.blocs[b].messages) out.push({ from: HOME[b], to: HOME[m.to], color: '#F1F3F4', width: 1, dashed: '2 5', bend: 0.55, opacity: 0.55, key: `m-${b}${m.to}${m.round}` })
    for (const e of qq.es) {
      if (e.score > 0) out.push({ from: HOME[e.from], to: HOME[e.to], color: '#E0566F', width: 1.5 + Math.min(7, e.score / 18), arrow: true, bend: e.from < e.to ? 1 : -1, key: `es-${e.from}${e.to}` })
      else out.push({ from: HOME[e.from], to: HOME[e.to], color: '#6A98D8', width: 1.4, arrow: true, dashed: '6 4', bend: e.from < e.to ? 0.8 : -0.8, key: `es-${e.from}${e.to}` })
    }
    return out
  }, [qq])

  const startLs = 100
  const marks = (file?.quarters ?? []).flatMap((x) => [
    ...(x.es.some((e) => e.score >= ESCALATION) ? [{ q: x.q, color: '#E0566F', title: `${quarterLabel(x.q)} 확전` }] : []),
    ...(x.violations.some((v) => v.first) ? [{ q: x.q, color: '#D9A75A', title: `${quarterLabel(x.q)} 약속 위반` }] : []),
    ...(x.newCommitments.length ? [{ q: x.q, color: '#7DBB96', title: `${quarterLabel(x.q)} 새 약속` }] : []),
  ])

  const subtitle = !file
    ? error ? '리플레이 기록을 불러오지 못했습니다' : index && !index.length ? '아직 리플레이 기록이 없습니다' : '리플레이 기록을 불러오는 중…'
    : `${file.title} · ${quarterLabel(q)} — ${quarterSummary(qq!)}`

  return (
    <Screen
      mode="replay"
      onMode={onMode}
      map={{
        view: 'pacific',
        selected: focus ? iso : HOME.A,
        dir: 'export',
        arcs: [],
        fillFor: (x) => {
          const b = blocOf(x)
          if (!b || b === focus) return null
          return '#3A4C5F'
        },
        onSelect: (x) => setIso(blocOf(x) ? x : iso),
        highlight: focus ? new Set(MEMBERS[focus]) : undefined,
        // 이번 분기 확전에 얽힌 나라의 배지를 먼저 놓는다 (겹치면 뒤에 놓인 쪽이 점이 된다)
        lead: [...BLOCS].sort((a, b) => involved(qq, b) - involved(qq, a)).map((b) => HOME[b]),
        labelFor: (x) => {
          const b = blocOf(x)
          return b && HOME[b] === x ? rname(b) : DATA.countries[x].name
        },
        subLabelFor: (x) => {
          const b = blocOf(x)
          if (!b || HOME[b] !== x || !qq) return null
          const v = qq.ind[b].livingStandard - startLs
          return { text: `생활 ${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`, color: v < -0.005 ? '#F0A3B0' : v > 0.005 ? '#A9C6F0' : '#C8D0D7' }
        },
        links,
        overlay: (screen) =>
          qq && (
            <>
              {qq.violations.filter((v) => v.first).map((v) => {
                const p = screen(HOME[v.obligor])
                return p ? <circle key={v.id} cx={p[0]} cy={p[1]} r={22} className="violation-ring" /> : null
              })}
              {BLOCS.map((b) => {
                const st = qq.blocs[b].statements.at(-1)
                const p = screen(HOME[b])
                if (!st || !p) return null
                const [dx, dy] = BUBBLE[b]
                return (
                  <g key={b} className="bubble" pointerEvents="none">
                    <line x1={p[0]} y1={p[1]} x2={p[0] + dx + (dx < 0 ? 180 : 0)} y2={p[1] + dy + 30} stroke={TONE_COLOR[st.tone]} strokeWidth={1} opacity={0.7} />
                    <foreignObject x={p[0] + dx} y={p[1] + dy} width={180} height={66}>
                      <div className="bubble-box" style={{ borderColor: TONE_COLOR[st.tone] }}>
                        <b>{rname(b)}</b> {st.text}
                      </div>
                    </foreignObject>
                  </g>
                )
              })}
            </>
          ),
      }}
      controls={
        <>
          <label className="ctl">
            <span>기록</span>
            <select value={id ?? ''} onChange={(e) => set({ id: e.target.value })}>
              {(index ?? []).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
            </select>
          </label>
          <div className="legend replay-legend">
            <span><i style={{ background: '#E0566F' }} />확전 (굵을수록 큼)</span>
            <span><i style={{ background: '#6A98D8' }} />완화</span>
            <span><i className="dotted" />비공개 메시지</span>
            <span><i style={{ background: '#7DBB96' }} />유효한 약속</span>
          </div>
        </>
      }
      sources={file ? `${file.source.run}${file.source.commit ? ` (코드 ${file.source.commit})` : ''}` : '실험 기록'}
      subtitle={subtitle}
      bottomBar={<Timeline q={q} n={n} onChange={(x) => set({ q: x })} marks={marks} stepMs={2200} />}
      hoverText={(h) => {
        if (!h.iso) return { title: h.name, body: '자료 없음' }
        const b = blocOf(h.iso)
        if (!b) return { title: h.name, body: '나머지 세계 (정책 고정)' }
        return { title: h.name, body: `${rname(b)} · ${file?.leaders[b] ?? ''}` }
      }}
      panel={
        <ReplayPanel
          file={file}
          index={index}
          id={id}
          q={q}
          focus={focus}
          showPrivate={showPrivate}
          onPick={(x) => set({ id: x })}
          onFocus={(b) => setIso(HOME[b])}
          onPrivate={(v) => set({ priv: v })}
          onQuarter={(x) => set({ q: x })}
        />
      }
      panelLabel={`${focus ? rname(focus) : c.name} 리플레이 보기`}
      panelKey={`${id}`}
    />
  )
}

type PanelProps = {
  file: ReplayFile | null
  index: ReplayIndexEntry[] | null
  id: string | null
  q: number
  focus: BlocId | null
  showPrivate: boolean
  onPick: (id: string) => void
  onFocus: (b: BlocId) => void
  onPrivate: (v: boolean) => void
  onQuarter: (q: number) => void
}

function ReplayPanel({ file, index, id, q, focus, showPrivate, onPick, onFocus, onPrivate, onQuarter }: PanelProps) {
  if (!file) return <div className="panel-inner"><p className="muted">기록을 불러오는 중…</p></div>
  const qq = file.quarters[q]
  const order = focus ? [focus, ...BLOCS.filter((b) => b !== focus)] : BLOCS
  const totals = file.totals
  const maxTotal = Math.max(1, ...BLOCS.flatMap((i) => BLOCS.map((j) => Math.abs(totals.es[i][j]))))

  return (
    <div className="panel-inner">
      <header className="panel-head">
        <img src={flagUrl(DATA.countries[HOME[focus ?? 'A']])} alt="" className="panel-flag" />
        <div>
          <h1>AI 리플레이</h1>
          <p className="muted">
            <span className={`kind-chip ${file.kind}`}>{KIND_LABEL[file.kind]}</span> {file.config.years}년 · 나라 이름 {file.config.naming === 'real' ? '실명' : 'A~F'} · 문화 지표 {file.config.culture === 'shown' ? '보여 줌' : '숨김'}
          </p>
        </div>
      </header>

      <div className="choice-list">
        <div className="choice on static">
          <strong>{file.title}</strong>
          <span>{file.note}</span>
        </div>
      </div>
      <details className="fold">
        <summary>다른 기록 {Math.max(0, (index?.length ?? 1) - 1)}개</summary>
        <div className="choice-list">
          {(index ?? []).filter((x) => x.id !== id).map((x) => (
            <button key={x.id} className="choice" onClick={() => onPick(x.id)}>
              <strong>{x.title}</strong>
              <span>{x.note}</span>
            </button>
          ))}
        </div>
      </details>
      {file.kind !== 'llm' && (
        <p className="notice">
          {file.kind === 'mock' ? '이 기록의 문장은 가짜 응답입니다.' : '이 기록의 지도자는 정해진 규칙대로 움직이는 프로그램입니다.'} 실제 AI(LLM) 지도자 기록은 아직 없습니다. 유료 실행(Haiku 한 판 약
          $0.45)을 허락받아 돌리면 이 목록에 'AI 지도자' 기록으로 추가됩니다.
        </p>
      )}

      <section className="panel-section" style={{ ['--accent' as string]: '#E0566F' }}>
        <h2>{quarterLabel(q)}</h2>
        {qq.es.length === 0 && qq.newCommitments.length === 0 && qq.violations.length === 0 && <p className="section-note">확전·약속·위반 없음.</p>}
        {qq.es.map((e) => (
          <div key={`${e.from}${e.to}`} className="es-line">
            <span className="es-score" style={{ color: e.score > 0 ? '#F0A3B0' : '#A9C6F0' }}>{signed(e.score)}</span>
            <span>
              <b>{rname(e.from)} → {rname(e.to)}</b> {e.items.slice(0, 3).join(', ')}
              {e.items.length > 3 ? ` 외 ${e.items.length - 3}건` : ''}
            </span>
          </div>
        ))}
        {qq.newCommitments.length > 0 && (
          <details className="fold">
            <summary>새 약속 {qq.newCommitments.length}건</summary>
            {qq.newCommitments.map((cm) => <p key={cm.id} className="feed-line">{cm.text}</p>)}
          </details>
        )}
        {qq.violations.map((v) => (
          <p key={v.id} className="feed-line warn">
            약속 {v.first ? '처음 ' : ''}위반 · {rname(v.obligor)}: {v.text}
          </p>
        ))}
        <label className="toggle">
          <input type="checkbox" checked={showPrivate} onChange={(e) => onPrivate(e.target.checked)} /> 비공개 판단도 보기 (게임 안에서는 본인만 본다)
        </label>
        {order.map((b) => (
          <BlocCard key={b} b={b} x={qq.blocs[b]} leader={file.leaders[b]} focus={b === focus} showPrivate={showPrivate} onFocus={() => onFocus(b)} />
        ))}
      </section>

      <section className="panel-section" style={{ ['--accent' as string]: '#D9A75A' }}>
        <h2>판 전체: 누가 누구에게 (확전점수 합)</h2>
        <div className="tgrid matrix" style={{ gridTemplateColumns: `52px repeat(6, minmax(0,1fr))` }}>
          <span className="tgrid-corner">준↓ 받은→</span>
          {BLOCS.map((j) => <button key={j} className="tgrid-head" onClick={() => onFocus(j)}>{SHORT[j]}</button>)}
          {BLOCS.map((i) => (
            <MatrixRow key={i} i={i} values={BLOCS.map((j) => (i === j ? null : totals.es[i][j]))} max={maxTotal} onFocus={() => onFocus(i)} />
          ))}
        </div>
        {BLOCS.map((b) => {
          const a = totals.actors[b]
          return (
            <div key={b} className="actor-row">
              <span className="actor-name">{rname(b)}</span>
              <span className="actor-body">
                {a.strategy}
                <span className="src">
                  준 {signed(a.given)} · 받은 {signed(a.received)}
                  {a.retaliationRate !== null ? ` · 보복률 ${Math.round(a.retaliationRate * 100)}%` : ''}
                  {a.firstEscalation !== null ? ` · 첫 확전 ${quarterLabel(a.firstEscalation)}` : ''}
                  {a.score !== null ? ` · ${a.objective} 점수 ${a.score.toFixed(2)} (시작 ${a.startScore?.toFixed(2)})` : ''}
                </span>
              </span>
            </div>
          )
        })}
        <div className="quarter-jumps">
          {file.quarters.filter((x) => x.es.some((e) => e.score >= ESCALATION) || x.violations.some((v) => v.first)).map((x) => (
            <button key={x.q} className="more inline" onClick={() => onQuarter(x.q)}>{quarterLabel(x.q)}로</button>
          ))}
        </div>
      </section>

      <footer className="panel-foot">
        <p>
          확전점수는 v1과 같은 가중치(Rivera 등 2024)를 물품마다, 행위국 → 대상국마다 센다: 관세 1%p 이상 인하 −2, 인상 +4, 10%p 이상 +12, 100% 이상으로 +28, 수출 통제
          강화 +12(필수재 +28), 비공개 위협 +4, 제안 수락 −2, 약속 처음 위반 +12. 12 이상을 '확전'으로 센다. 지도자는 이 점수를 보지 못한다.
        </p>
        <p>기록: {file.source.run} · 지도자 {BLOCS.map((b) => `${SHORT[b]} ${file.leaders[b]}`).join(', ')}</p>
      </footer>
    </div>
  )
}

function MatrixRow({ i, values, max, onFocus }: { i: BlocId; values: (number | null)[]; max: number; onFocus: () => void }) {
  return (
    <>
      <button className="tgrid-row" onClick={onFocus}>{SHORT[i]}</button>
      {values.map((v, k) => (
        <span
          key={k}
          className="tgrid-cell"
          style={{
            color: '#E8ECEF',
            background: v === null ? 'transparent' : v > 0 ? `rgba(224,86,111,${0.2 + 0.7 * (v / max)})` : v < 0 ? `rgba(106,152,216,${0.2 + 0.7 * (-v / max)})` : undefined,
          }}
        >
          {v === null ? '' : v === 0 ? '·' : signed(v)}
        </span>
      ))}
    </>
  )
}

function BlocCard({ b, x, leader, focus, showPrivate, onFocus }: { b: BlocId; x: ReplayBloc; leader: string; focus: boolean; showPrivate: boolean; onFocus: () => void }) {
  const empty = !x.statements.length && !x.messages.length && !x.proposals.length && !x.accepted.length && !x.changes.length
  const priv = showPrivate && (x.thinking || x.reasoning)
  return (
    <div className={`bloc-card ${focus ? 'on' : ''}`}>
      <button className="bloc-head" onClick={onFocus}>
        <img src={flagUrl(DATA.countries[HOME[b]])} alt="" className="mini-flag" />
        <b>{rname(b)}</b>
        <span className="muted-inline">{leader}</span>
        {empty && <span className="muted-inline">· 조용함</span>}
      </button>
      {x.statements.map((s, i) => (
        <p key={`s${i}`} className="feed-line">
          <span className="tag" style={{ color: TONE_COLOR[s.tone] }}>공개 성명 · {TONE_LABEL[s.tone]}</span> {s.text}
        </p>
      ))}
      {x.messages.map((m, i) => (
        <p key={`m${i}`} className="feed-line">
          <span className="tag" style={{ color: TONE_COLOR[m.tone] }}>→ {rname(m.to)} 비공개 · {TONE_LABEL[m.tone]}</span> {m.text}
        </p>
      ))}
      {x.proposals.map((p) => (
        <p key={p.id} className="feed-line">
          <span className="tag">제안 {p.id} → {p.to.map(rname).join('·')} · {p.duration}분기</span> {p.terms.join(' / ')}
        </p>
      ))}
      {x.accepted.length > 0 && <p className="feed-line"><span className="tag">수락</span> {x.accepted.join(', ')}</p>}
      {x.changes.map((ch, i) => (
        <p key={`c${i}`} className="feed-line policy"><span className="tag">정책</span> {ch}</p>
      ))}
      {x.clamped.length > 0 && <p className="feed-line warn"><span className="tag">범위 밖이라 고침</span> {x.clamped.join('; ')}</p>}
      {priv && (
        <div className="private">
          {x.thinking && <p className="feed-line"><span className="tag">외교 전 판단</span> {x.thinking}</p>}
          {x.reasoning && <p className="feed-line"><span className="tag">결정 이유</span> {x.reasoning}</p>}
        </div>
      )}
    </div>
  )
}
