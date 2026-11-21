// 정책 실험 모드: 시나리오(또는 직접 만든 정책 변경)를 v2 엔진으로 16분기 계산하고,
// 2023년 정책 그대로 계산한 값과의 차이로 지도를 칠한다. 계산은 Web Worker에서 돈다.
// 주소: #sim/<나라>/<시나리오>/<지표>/<분기>/<직접 만든 변경(base64)>

import { useEffect, useMemo, useState } from 'react'
import type { ModeProps } from '../App'
import { HOME, pickIso, regionOf, regionTitle, rname } from '../blocs'
import { DATA, GOODS } from '../data'
import { flagUrl } from '../flags'
import { viewFor } from '../geo'
import { divergeColor, DIVERGE, quarterLabel, Screen } from '../Screen'
import { decodeChanges, encodeChanges, PRESETS, QUARTERS, type Change, type ChangeKind, type PresetId, type QuarterOut, type RegionOut } from '../sim/scenario'
import { useSimulation } from '../sim/useSimulation'
import { Timeline } from '../Timeline'
import type { Arc } from '../WorldMap'
import { BLOCS, REGIONS, type BlocId, type RegionId } from '../../v2/regions'
import { EXPORT_LEVEL_LABEL } from '../../v2/types'
import { statusQuoPolicies } from '../../v2/world'

type IndicatorId = 'livingStandard' | 'realGdp' | 'nominalGdpUsd' | 'exports' | 'imports' | 'welfare' | 'cpi'
const INDICATORS: { id: IndicatorId; name: string; hint: string }[] = [
  { id: 'livingStandard', name: '생활수준', hint: '1인당 실질 소비 (필수재가 모자라면 깎음)' },
  { id: 'realGdp', name: '실질 GDP', hint: '2023년 가격으로 잰 생산' },
  { id: 'nominalGdpUsd', name: '명목 GDP (달러)', hint: '그 분기 가격으로 잰 생산. 교역 조건이 좋아지면 오른다' },
  { id: 'exports', name: '수출액', hint: '모든 상대로의 상품 수출 (국경 가격)' },
  { id: 'imports', name: '수입액', hint: '모든 상대로부터의 상품 수입 (국경 가격)' },
  { id: 'welfare', name: '후생', hint: '생활수준을 반영한 소비 + 실질 투자' },
  { id: 'cpi', name: '물가', hint: '소비자 물가 지수' },
]
const KIND_LABEL: Record<ChangeKind, string> = { tariffAdd: '관세 올리기·내리기 (%p)', tariffSet: '관세 정하기 (%)', control: '수출 통제 (단계)', invest: '투자율 (%)' }
const BASE = statusQuoPolicies()

// 변화율 표기: 작은 값은 자리를 더 보여 준다 (관세의 실질 GDP 효과는 0.01%보다 작을 때가 많다)
const pct = (x: number, d?: number) => {
  const a = Math.abs(x)
  if (a < 0.0005) return '0%'
  const digits = d ?? (a >= 10 ? 1 : a >= 0.1 ? 2 : 3)
  return `${x > 0 ? '+' : '−'}${a.toFixed(digits)}%`
}
const changePct = (a: number, b: number) => (100 * (a - b)) / b

function describe(c: Change) {
  const who = rname(c.actor)
  if (c.kind === 'invest') return `${who} 투자율 ${c.value}% (2023년 ${(BASE[c.actor].investmentRate * 100).toFixed(1)}%)`
  const to = c.partner === 'all' ? 'AI 5개국' : rname(c.partner)
  const g = c.good === 'all' ? '전 품목' : GOODS.find((x) => x.id === c.good)?.name ?? c.good
  if (c.kind === 'control') return `${who} → ${to} ${g} 수출 통제 ${c.value}단계 (${EXPORT_LEVEL_LABEL[c.value as 0 | 1 | 2 | 3]})`
  if (c.kind === 'tariffSet') return `${who}: ${to}산 ${g} 관세 ${c.value}%로`
  return `${who}: ${to}산 ${g} 관세 2023년 ${c.value >= 0 ? '+' : '−'}${Math.abs(c.value)}%p`
}

export function SimMode({ iso, rest, setIso, setRest, onMode }: ModeProps) {
  const presetId = (rest[0] === 'custom' || PRESETS.some((p) => p.id === rest[0]) ? rest[0] : 'provoke') as PresetId | 'custom'
  const indicator: IndicatorId = INDICATORS.some((x) => x.id === rest[1]) ? (rest[1] as IndicatorId) : 'livingStandard'
  const qRaw = Number(rest[2])
  const q = Number.isInteger(qRaw) && qRaw >= 0 && qRaw < QUARTERS ? qRaw : QUARTERS - 1
  const custom = useMemo(() => decodeChanges(rest[3] ?? ''), [rest[3]])
  const set = (p: { preset?: PresetId | 'custom'; indicator?: IndicatorId; q?: number; custom?: Change[] }) =>
    setRest([p.preset ?? presetId, p.indicator ?? indicator, String(p.q ?? q), encodeChanges(p.custom ?? custom)].filter((x, i) => i < 3 || x))

  const changes = presetId === 'custom' ? custom : PRESETS.find((p) => p.id === presetId)!.changes
  const base = useSimulation([])
  const scen = useSimulation(changes)
  const ready = base.result && scen.result
  const region = regionOf(iso)
  const c = DATA.countries[iso]

  const delta = (out: QuarterOut[], b: QuarterOut[], r: RegionId, k: IndicatorId, qq: number) => changePct(out[qq].regions[r][k], b[qq].regions[r][k])
  // 색 눈금: 이 시나리오에서 16분기 동안 나온 가장 큰 변화 (최소 0.05%)
  const span = useMemo(() => {
    if (!base.result || !scen.result) return 1
    let m = 0.05
    for (let k = 0; k < QUARTERS; k++) for (const r of REGIONS) m = Math.max(m, Math.abs(delta(scen.result, base.result, r, indicator, k)))
    return m
  }, [base.result, scen.result, indicator])

  const d = (r: RegionId) => (ready ? delta(scen.result!, base.result!, r, indicator, q) : 0)
  const fillFor = ready ? (x: string) => divergeColor(d(regionOf(x)), span) : null
  const arcs: Arc[] =
    ready && region !== 'R'
      ? BLOCS.filter((b) => b !== region).map((b) => {
          const v = scen.result![q].regions[region].exportsTo[b]
          const v0 = base.result![q].regions[region].exportsTo[b]
          return { iso: HOME[b], value: v, label: `수출 ${pct(changePct(v, v0), 1)}` }
        })
      : []
  const ind = INDICATORS.find((x) => x.id === indicator)!
  const preset = PRESETS.find((p) => p.id === presetId)
  const scenName = preset?.name ?? '직접 만든 시나리오'

  const ranked = ready ? REGIONS.map((r) => ({ r, v: d(r) })).sort((a, b) => a.v - b.v) : []
  const subtitle = !ready
    ? scen.error ? `계산하지 못했습니다: ${scen.error}` : `${scenName}: 16분기를 계산하는 중…`
    : changes.length === 0
      ? `${scenName} · ${quarterLabel(q)} — 기준 시나리오라 차이가 없습니다. 다른 시나리오를 고르거나 직접 만들어 보세요`
      : `${scenName} · ${quarterLabel(q)} ${ind.name} — ` +
        [ranked[0], ranked[ranked.length - 1]].filter((x, i, a) => a.indexOf(x) === i).map((x) => `${rname(x.r)} ${pct(x.v)}`).join(' · ') +
        ' (2023년 정책 그대로 대비)'

  return (
    <Screen
      mode="sim"
      onMode={onMode}
      map={{
        view: viewFor(region === 'R' ? 'KOR' : HOME[region]),
        selected: iso,
        dir: 'export',
        arcs,
        fillFor,
        onSelect: setIso,
        lead: BLOCS.map((b) => HOME[b]),
        labelFor: (x) => (x === HOME.D ? '중동' : DATA.countries[x].name),
        subLabelFor: (x) => {
          const b = BLOCS.find((bb) => HOME[bb] === x)
          if (!b || !ready || b === region) return null
          const v = d(b)
          return { text: `${ind.name} ${pct(v)}`, color: v < 0 ? '#F0A3B0' : v > 0 ? '#A9C6F0' : '#C8D0D7' }
        },
      }}
      controls={
        <>
          <label className="ctl">
            <span>시나리오</span>
            <select value={presetId} onChange={(e) => set({ preset: e.target.value as PresetId | 'custom' })}>
              {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="custom">직접 만들기</option>
            </select>
          </label>
          <label className="ctl">
            <span>지표 보기</span>
            <select value={indicator} onChange={(e) => set({ indicator: e.target.value as IndicatorId })}>
              {INDICATORS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <div className="legend">
            <span className="legend-bar" style={{ background: `linear-gradient(90deg, ${DIVERGE.neg}, ${DIVERGE.zero}, ${DIVERGE.pos})` }} />
            <span className="legend-ends">
              <span>{pct(-span)}</span>
              <span>0</span>
              <span>{pct(span)}</span>
            </span>
            <span className="legend-note">{ind.name}: 2023년 정책 그대로 대비 · 블록 단위</span>
          </div>
        </>
      }
      sources="v2 엔진 (2023년 보정: UN Comtrade · World Bank · IMF · WITS)"
      subtitle={subtitle}
      bottomBar={<Timeline q={q} n={QUARTERS} onChange={(x) => set({ q: x })} />}
      hoverText={(h) => {
        if (!h.iso) return { title: h.name, body: '자료 없음' }
        const r = regionOf(h.iso)
        if (!ready) return { title: h.name, body: '계산 중' }
        return { title: h.name, body: `${r === 'R' ? '나머지 세계' : regionTitle(r)} · ${ind.name} ${pct(d(r))}` }
      }}
      panel={
        <SimPanel
          iso={iso}
          q={q}
          presetId={presetId}
          custom={custom}
          base={base.result}
          scen={scen.result}
          indicator={indicator}
          onPreset={(p) => set({ preset: p })}
          onCustom={(cs) => set({ preset: 'custom', custom: cs })}
          onRegion={(r) => setIso(pickIso(r, iso))}
          onIndicator={(x) => set({ indicator: x })}
        />
      }
      panelLabel={`${c.name} 실험 결과 보기`}
      panelKey={presetId}
    />
  )
}

type PanelProps = {
  iso: string
  q: number
  presetId: PresetId | 'custom'
  custom: Change[]
  base: QuarterOut[] | null
  scen: QuarterOut[] | null
  indicator: IndicatorId
  onPreset: (p: PresetId | 'custom') => void
  onCustom: (cs: Change[]) => void
  onRegion: (r: RegionId) => void
  onIndicator: (x: IndicatorId) => void
}

function SimPanel({ iso, q, presetId, custom, base, scen, indicator, onPreset, onCustom, onRegion, onIndicator }: PanelProps) {
  const region = regionOf(iso)
  const c = DATA.countries[iso]
  const home = region === 'R' ? c : DATA.countries[HOME[region]]
  const preset = PRESETS.find((p) => p.id === presetId)
  const ready = base && scen
  const ind = INDICATORS.find((x) => x.id === indicator)!
  const series = (r: RegionId, k: IndicatorId) => (ready ? scen.map((x, i) => changePct(x.regions[r][k], base[i].regions[r][k])) : [])
  const maxAbs = ready ? Math.max(0.05, ...REGIONS.flatMap((r) => series(r, indicator).map(Math.abs))) : 1
  const R = (r: RegionId): RegionOut | null => (ready ? scen[q].regions[r] : null)

  return (
    <div className="panel-inner">
      <header className="panel-head">
        <img src={flagUrl(home)} alt="" className="panel-flag" />
        <div>
          <h1>정책 실험</h1>
          <p className="muted">AI 블록 6개 + 나머지 세계, 16분기(4년) · 2023년에서 시작</p>
        </div>
      </header>

      <section className="panel-section" style={{ ['--accent' as string]: '#D9A75A' }}>
        <h2>시나리오</h2>
        <div className="choice-list">
          {PRESETS.map((p) => (
            <button key={p.id} className={`choice ${p.id === presetId ? 'on' : ''}`} onClick={() => onPreset(p.id)}>
              <strong>{p.name}</strong>
              <span>{p.detail}</span>
            </button>
          ))}
          <button className={`choice ${presetId === 'custom' ? 'on' : ''}`} onClick={() => onPreset('custom')}>
            <strong>직접 만들기</strong>
            <span>나라·상대·품목·시작 분기를 골라 관세, 수출 통제, 투자율을 바꿉니다. 주소를 복사하면 같은 실험을 공유할 수 있습니다</span>
          </button>
        </div>
        {preset && preset.changes.length > 0 && (
          <button className="more" onClick={() => onCustom(preset.changes)}>이 시나리오를 바탕으로 직접 고치기</button>
        )}
        {presetId === 'custom' && <ChangeEditor changes={custom} onChange={onCustom} defaultActor={region === 'R' ? 'A' : region} />}
      </section>

      <section className="panel-section" style={{ ['--accent' as string]: '#6A98D8' }}>
        <h2>
          {quarterLabel(q)} 결과 — {ind.name}
        </h2>
        <div className="seg small" role="group" aria-label="지표">
          {INDICATORS.slice(0, 5).map((x) => (
            <button key={x.id} className={x.id === indicator ? 'on' : ''} onClick={() => onIndicator(x.id)}>{x.name.replace(' (달러)', '')}</button>
          ))}
        </div>
        {!ready && <p className="section-note">계산 중…</p>}
        {ready &&
          REGIONS.map((r) => {
            const s = series(r, indicator)
            const v = s[q]
            return (
              <button key={r} className={`sim-row ${r === region ? 'on' : ''}`} onClick={() => onRegion(r)}>
                <span className="sim-name">{r === 'R' ? '나머지 세계' : regionTitle(r)}</span>
                <Spark values={s} q={q} max={maxAbs} />
                <span className="sim-value" style={{ color: v < -1e-9 ? '#F0A3B0' : v > 1e-9 ? '#A9C6F0' : undefined }}>{pct(v)}</span>
              </button>
            )
          })}
        <p className="section-note">{ind.hint}. 값은 같은 분기 '2023년 그대로'와의 차이(%). 작은 그림은 16분기 흐름, 점은 지금 분기.</p>
      </section>

      {ready && (
        <section className="panel-section" style={{ ['--accent' as string]: '#4FB3A6' }}>
          <h2>{region === 'R' ? '나머지 세계' : regionTitle(region)} 자세히 ({quarterLabel(q)})</h2>
          <div className="tiles">
            {(['livingStandard', 'realGdp', 'nominalGdpUsd'] as const).map((k) => (
              <div key={k} className="tile" style={{ ['--accent' as string]: '#4FB3A6' }}>
                <span className="tile-label">{INDICATORS.find((x) => x.id === k)!.name.replace(' (달러)', '')}</span>
                <span className="tile-value">{pct(series(region, k)[q])}</span>
              </div>
            ))}
          </div>
          <div className="kv"><span>수출액</span><span>{(R(region)!.exports * 10).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}억 달러 <span className="muted-inline">({pct(series(region, 'exports')[q], 1)})</span></span></div>
          <div className="kv"><span>수입액</span><span>{(R(region)!.imports * 10).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}억 달러 <span className="muted-inline">({pct(series(region, 'imports')[q], 1)})</span></span></div>
          <div className="kv"><span>물가</span><span>{pct(series(region, 'cpi')[q])}</span></div>
          {region !== 'R' && (
            <div className="kv">
              <span>명목 GDP 비율 (상대 이익 목표)</span>
              <span>{scen[q].ratio[region].toFixed(2)}% <span className="muted-inline">(2023년 그대로 {base[q].ratio[region].toFixed(2)}%)</span></span>
            </div>
          )}
          {region !== 'R' && (
            <>
              <p className="section-note">다른 블록으로의 수출 (2023년 그대로 대비)</p>
              {BLOCS.filter((b) => b !== region).map((b) => {
                const v = scen[q].regions[region].exportsTo[b]
                const v0 = base[q].regions[region].exportsTo[b]
                return (
                  <div key={b} className="kv indent">
                    <span>→ {rname(b)}</span>
                    <span>{(v * 10).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}억 달러 <span className="muted-inline">({pct(changePct(v, v0), 1)})</span></span>
                  </div>
                )
              })}
            </>
          )}
          {scen.some((x) => !x.converged) && <p className="section-note warn">일부 분기에서 시장 균형 계산이 수렴하지 않았습니다. 그 분기 값은 근삿값입니다.</p>}
        </section>
      )}

      <footer className="panel-foot">
        <p>
          엔진: 지역 7곳 × 부문 12개(교역재 10 + 서비스·건설), 아밍턴(CES) 수요, 콥-더글러스 생산, 분기마다 노동 30% 이동과 자본 축적. 2023년 교역·생산·지출을 그대로
          재현하도록 보정한 정상상태에서 시작합니다. AI 리플레이와 같은 엔진이라, 같은 정책이면 결과도 같습니다 (테스트로 확인).
        </p>
        <ul>
          <li>지도 색과 흐름선은 블록 단위입니다. 같은 블록의 나라는 같은 값입니다.</li>
          <li>나머지 세계의 정책과, AI 블록이 나머지 세계에 매기는 관세는 바뀌지 않습니다.</li>
          <li>내시 균형 관세는 자본을 고정하고 노동이 완전히 움직이는 정적 조건에서 구한 값을 16분기 동학에 그대로 넣은 것입니다.</li>
          <li>엔진의 교역 자료는 UN Comtrade 2023(블록 사이)이라 자료 모드의 CEPII BACI 숫자와 조금 다릅니다.</li>
        </ul>
      </footer>
    </div>
  )
}

function Spark({ values, q, max }: { values: number[]; q: number; max: number }) {
  const w = 96
  const h = 22
  const x = (i: number) => (i / (values.length - 1)) * (w - 4) + 2
  const y = (v: number) => h / 2 - (v / max) * (h / 2 - 2)
  return (
    <svg width={w} height={h} className="spark" aria-hidden="true">
      <line x1={0} x2={w} y1={h / 2} y2={h / 2} stroke="rgba(255,255,255,0.15)" />
      <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke="#C8D0D7" strokeWidth={1.3} />
      <circle cx={x(q)} cy={y(values[q])} r={2.6} fill="#F1F3F4" />
    </svg>
  )
}

function ChangeEditor({ changes, onChange, defaultActor }: { changes: Change[]; onChange: (cs: Change[]) => void; defaultActor: BlocId }) {
  const [draft, setDraft] = useState<Change>({ kind: 'tariffAdd', actor: defaultActor, partner: defaultActor === 'B' ? 'E' : 'B', good: 'all', value: 10, from: 0 })
  useEffect(() => setDraft((d) => ({ ...d, actor: defaultActor, partner: d.partner === defaultActor ? (defaultActor === 'B' ? 'E' : 'B') : d.partner })), [defaultActor])
  const up = (p: Partial<Change>) => setDraft((d) => ({ ...d, ...p }))
  const range =
    draft.kind === 'tariffAdd' ? { min: -50, max: 200, step: 1, unit: '%p' } : draft.kind === 'tariffSet' ? { min: 0, max: 200, step: 1, unit: '%' } : draft.kind === 'control' ? { min: 0, max: 3, step: 1, unit: '단계' } : { min: 10, max: 50, step: 0.5, unit: '%' }
  const setKind = (kind: ChangeKind) =>
    up({ kind, value: kind === 'tariffAdd' ? 10 : kind === 'tariffSet' ? 0 : kind === 'control' ? 1 : Math.round(BASE[draft.actor].investmentRate * 1000) / 10 })

  return (
    <div className="editor">
      {changes.length === 0 && <p className="section-note">아직 바꾼 정책이 없습니다. 아래에서 고르고 '추가'를 누르세요.</p>}
      {changes.map((ch, i) => (
        <div key={i} className="change-row">
          <span>
            {describe(ch)} <span className="muted-inline">· {quarterLabel(ch.from)}부터</span>
          </span>
          <button aria-label="빼기" onClick={() => onChange(changes.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div className="editor-form">
        <label>
          <span>누가</span>
          <select value={draft.actor} onChange={(e) => up({ actor: e.target.value as BlocId, partner: draft.partner === e.target.value ? 'all' : draft.partner })}>
            {BLOCS.map((b) => <option key={b} value={b}>{rname(b)}</option>)}
          </select>
        </label>
        <label>
          <span>무엇을</span>
          <select value={draft.kind} onChange={(e) => setKind(e.target.value as ChangeKind)}>
            {(Object.keys(KIND_LABEL) as ChangeKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        {draft.kind !== 'invest' && (
          <>
            <label>
              <span>상대</span>
              <select value={draft.partner} onChange={(e) => up({ partner: e.target.value as BlocId | 'all' })}>
                <option value="all">AI 5개국 모두</option>
                {BLOCS.filter((b) => b !== draft.actor).map((b) => <option key={b} value={b}>{rname(b)}</option>)}
              </select>
            </label>
            <label>
              <span>품목</span>
              <select value={draft.good} onChange={(e) => up({ good: e.target.value })}>
                <option value="all">전 품목</option>
                {GOODS.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
          </>
        )}
        <label className="wide">
          <span>값</span>
          <input type="range" min={range.min} max={range.max} step={range.step} value={draft.value} onChange={(e) => up({ value: Number(e.target.value) })} />
          <strong>
            {draft.kind === 'tariffAdd' && draft.value > 0 ? '+' : ''}
            {draft.value}
            {range.unit}
            {draft.kind === 'control' ? ` ${EXPORT_LEVEL_LABEL[draft.value as 0 | 1 | 2 | 3]}` : ''}
          </strong>
        </label>
        <label>
          <span>언제부터</span>
          <select value={draft.from} onChange={(e) => up({ from: Number(e.target.value) })}>
            {Array.from({ length: QUARTERS }, (_, i) => <option key={i} value={i}>{quarterLabel(i)}</option>)}
          </select>
        </label>
        <button className="add" onClick={() => onChange([...changes, draft])}>추가</button>
      </div>
      {changes.length > 0 && (
        <button className="more" onClick={() => onChange([])}>모두 지우기</button>
      )}
      <p className="section-note">관세 올리기·내리기는 2023년 관세에 더합니다 (0~200%로 자름). 같은 칸을 여러 번 바꾸면 목록에서 아래 것이 이깁니다.</p>
    </div>
  )
}
