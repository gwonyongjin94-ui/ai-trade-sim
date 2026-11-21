// 관세 모드. 두 화면이 있다.
// · 나라별 (기본): 나라마다 실제로 적용하는 평균 관세 (World Bank WDI) — CountryTariff.tsx
// · 블록 사이: 시뮬레이션 엔진이 시작점으로 쓰는 2023년 관세. 지역 단위(블록 6개 + 나머지 세계)다.
//   나라를 누르면 그 나라가 속한 지역이 매기는 관세(또는 받는 관세)로 지도를 칠하고, 다른 블록 대표국으로 흐름선을 긋는다.
// 주소: #tariff/<나라>[/<품목 묶음>] · #tariff/<나라>/bloc/<방향>/<품목>

import { Fragment, type ReactNode } from 'react'
import type { ModeProps } from '../App'
import { HOME, isosOf, josa, pickIso, regionMembers, regionName, regionOf, regionTitle, rname, SHORT } from '../blocs'
import { DATA, GOODS, GOOD_COLOR } from '../data'
import { flagUrl } from '../flags'
import { viewFor } from '../geo'
import { mix, Screen } from '../Screen'
import { CONTROL_REASON, EXPORT_CONTROLS, flowB, REGION_LIST, TARIFF_NOTES, tariffOf } from '../tariffs'
import { BLOCS, type RegionId } from '../../v2/regions'
import { EXPORT_LEVEL_LABEL } from '../../v2/types'
import type { Arc } from '../WorldMap'
import { CountryTariffView, GROUPS, type Group } from './CountryTariff'

type Side = 'imposed' | 'faced'
const RAMP: [string, string] = ['#2F3B48', '#E3A15E']
const CAP = 40 // 이 값 이상은 가장 밝은 색
const tColor = (v: number) => mix(RAMP[0], RAMP[1], Math.sqrt(Math.min(v, CAP) / CAP))
const fmt = (v: number | null) => (v === null ? '—' : v >= 10 ? `${Math.round(v)}%` : `${v.toFixed(1)}%`)
const fmtCell = (v: number | null) => (v === null ? '' : v >= 10 ? String(Math.round(v)) : v.toFixed(1))
// 칸 색과 글자 색 (밝은 칸은 어두운 글자)
const cell = (v: number | null) => (v === null ? { background: 'transparent' } : { background: tColor(v), color: v >= 12 ? '#10161c' : '#E8ECEF' })

export function TariffMode({ iso, rest, setIso, setRest, onMode }: ModeProps) {
  // 예전 주소 (#tariff/<나라>/imposed|faced/<품목>)는 블록 사이 화면으로 연다
  const legacy = rest[0] === 'imposed' || rest[0] === 'faced'
  const bloc = rest[0] === 'bloc' || legacy
  const bRest = legacy ? rest : rest.slice(1)
  const group: Group = GROUPS.some((g) => g.id === rest[0]) ? (rest[0] as Group) : 'all'

  const scopeSeg = (
    <div className="seg" role="group" aria-label="관세 범위">
      <button className={bloc ? '' : 'on'} onClick={() => setRest([])} title="나라마다 실제로 적용하는 평균 관세 (World Bank)">나라별</button>
      <button className={bloc ? 'on' : ''} onClick={() => setRest(['bloc'])} title="시뮬레이션 엔진이 쓰는 지역 사이 관세">블록 사이</button>
    </div>
  )

  if (!bloc)
    return (
      <CountryTariffView
        iso={iso}
        group={group}
        setIso={setIso}
        setGroup={(g) => setRest(g === 'all' ? [] : [g])}
        onMode={onMode}
        scopeSeg={scopeSeg}
        onBloc={() => setRest(['bloc'])}
      />
    )
  return <BlocTariffView iso={iso} rest={bRest} setIso={setIso} setRest={(r) => setRest(['bloc', ...r])} onMode={onMode} scopeSeg={scopeSeg} />
}

function BlocTariffView({ iso, rest, setIso, setRest, onMode, scopeSeg }: ModeProps & { scopeSeg: ReactNode }) {
  const side: Side = rest[0] === 'faced' ? 'faced' : 'imposed'
  const good = GOODS.some((g) => g.id === rest[1]) ? rest[1] : null
  const set = (p: { side?: Side; good?: string | null }) => setRest([p.side ?? side, (p.good !== undefined ? p.good : good) ?? ''])

  const region = regionOf(iso)
  const c = DATA.countries[iso]
  const value = (other: RegionId) => (side === 'imposed' ? tariffOf(region, other, good) : tariffOf(other, region, good))
  const others = REGION_LIST.filter((r) => r !== region)
  const goodName = good ? GOODS.find((g) => g.id === good)!.name : '10개 품목 평균'
  const members = region === 'R' ? new Set<string>() : new Set(isosOf(region))

  const fillFor = (x: string) => {
    const rx = regionOf(x)
    if (rx === region) return null
    const v = value(rx)
    return v === null ? null : tColor(v)
  }
  // 블록이면 다른 블록 대표국으로 선을 긋는다. 나머지 세계는 EU 관세로 대신한 값이라 선을 긋지 않는다
  const arcs: Arc[] =
    region === 'R'
      ? []
      : BLOCS.filter((b) => b !== region).map((b) => ({ iso: HOME[b], value: Math.max(0.3, value(b) ?? 0), label: `관세 ${fmt(value(b))}` }))

  const sorted = others.map((r) => ({ r, v: value(r) })).sort((a, b) => (b.v ?? 0) - (a.v ?? 0))
  const who = rname(region)
  const whoGa = josa(who, '이', '가')
  const subtitle =
    side === 'imposed'
      ? `${whoGa} 매기는 관세 (${goodName}) — ` + sorted.slice(0, 4).map((x) => `${rname(x.r)}산 ${fmt(x.v)}`).join(' · ')
      : `${whoGa} 받는 관세 (${goodName}) — ` + sorted.slice(0, 4).map((x) => `${rname(x.r)} ${fmt(x.v)}`).join(' · ')

  return (
    <Screen
      mode="tariff"
      onMode={onMode}
      map={{
        view: viewFor(iso),
        selected: iso,
        dir: side === 'imposed' ? 'import' : 'export',
        arcs,
        fillFor,
        onSelect: setIso,
        highlight: members,
        labelFor: (x) => (x === HOME.D && region !== 'D' ? '중동' : DATA.countries[x].name),
      }}
      controls={
        <>
          {scopeSeg}
          <div className="seg" role="group" aria-label="관세 방향">
            <button className={side === 'imposed' ? 'on' : ''} onClick={() => set({ side: 'imposed' })}>매기는 관세</button>
            <button className={side === 'faced' ? 'on' : ''} onClick={() => set({ side: 'faced' })}>받는 관세</button>
          </div>
          <label className="ctl">
            <span>품목</span>
            <select value={good ?? ''} onChange={(e) => set({ good: e.target.value || null })}>
              <option value="">10개 품목 평균 (수입액 가중)</option>
              {GOODS.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <div className="legend">
            <span className="legend-bar" style={{ background: `linear-gradient(90deg, ${RAMP[0]}, ${tColor(10)}, ${RAMP[1]})` }} />
            <span className="legend-ends">
              <span>0%</span>
              <span>10%</span>
              <span>{CAP}% 이상</span>
            </span>
            <span className="legend-note">{side === 'imposed' ? `${whoGa} 그 지역 물품에 매기는 관세` : `그 지역이 ${who} 물품에 매기는 관세`}</span>
          </div>
        </>
      }
      sources="World Bank WITS (적용 관세 2022) · PIIE (미중 추가 관세) · WITS TRAINS (대만)"
      subtitle={subtitle}
      hoverText={(h) => {
        if (!h.iso) return { title: h.name, body: '자료 없음' }
        const rx = regionOf(h.iso)
        if (rx === region) return { title: h.name, body: `${region === 'R' ? '나머지 세계' : regionTitle(region)} (고른 지역)` }
        const v = value(rx)
        const where = rx === 'R' ? '나머지 세계' : regionTitle(rx)
        const line = side === 'imposed' ? `${whoGa} ${where} 물품에 ${fmt(v)}` : `${josa(where, '이', '가')} ${who} 물품에 ${fmt(v)}`
        return { title: h.name, body: `${line}${rx === 'R' ? ' (나머지 세계는 EU 관세로 대신)' : ''}` }
      }}
      panel={<TariffPanel iso={iso} side={side} good={good} onRegion={(r) => setIso(pickIso(r, iso))} onGood={(g) => set({ good: g })} />}
      panelLabel={`${c.name} 관세 보기`}
      panelKey={region}
    />
  )
}

function TariffPanel({ iso, side, good, onRegion, onGood }: { iso: string; side: Side; good: string | null; onRegion: (r: RegionId) => void; onGood: (g: string | null) => void }) {
  const region = regionOf(iso)
  const c = DATA.countries[iso]
  const others = REGION_LIST.filter((r) => r !== region)
  const controls = EXPORT_CONTROLS.filter((x) => x.from === region || x.to === region)
  const home = region === 'R' ? c : DATA.countries[HOME[region]]
  const goodName = good ? GOODS.find((g) => g.id === good)!.name : '10개 품목 평균 (수입액 가중)'

  // 표: 줄 = 품목, 칸 = 상대 지역
  const grid = (imp: (o: RegionId) => RegionId, exp: (o: RegionId) => RegionId, weightOf: (o: RegionId, g: string) => number) => (
    <div className="tgrid" style={{ gridTemplateColumns: `minmax(0,1fr) repeat(${others.length}, 40px)` }}>
      <span />
      {others.map((o) => (
        <button key={o} className="tgrid-head" onClick={() => onRegion(o)} title={o === 'R' ? '나머지 세계' : regionTitle(o)}>
          {SHORT[o]}
        </button>
      ))}
      <button className={`tgrid-row ${good === null ? 'on' : ''}`} onClick={() => onGood(null)}>
        가중 평균
      </button>
      {others.map((o) => {
        const v = tariffOf(imp(o), exp(o), null)
        return <span key={o} className="tgrid-cell avg" style={cell(v)}>{fmtCell(v)}</span>
      })}
      {GOODS.map((g) => (
        <Fragment key={g.id}>
          <button className={`tgrid-row ${good === g.id ? 'on' : ''}`} onClick={() => onGood(good === g.id ? null : g.id)}>
            <span className="dot" style={{ background: GOOD_COLOR[g.id] }} />
            {g.name}
          </button>
          {others.map((o) => {
            const v = tariffOf(imp(o), exp(o), g.id)
            const w = weightOf(o, g.id)
            return (
              <span
                key={o}
                className={`tgrid-cell ${w < 0.5 ? 'thin' : ''}`}
                style={cell(v)}
                title={`${fmt(v)} · 2023년 교역 ${(w * 10).toLocaleString('ko-KR', { maximumFractionDigits: w * 10 < 10 ? 1 : 0 })}억 달러`}
              >
                {fmtCell(v)}
              </span>
            )
          })}
        </Fragment>
      ))}
    </div>
  )

  return (
    <div className="panel-inner">
      <header className="panel-head">
        <img src={flagUrl(home)} alt="" className="panel-flag" />
        <div>
          <h1>{regionTitle(region)}</h1>
          <p className="muted">{region === 'R' ? '엔진은 나머지 세계를 한 지역으로 계산합니다' : regionMembers(region)}</p>
        </div>
      </header>
      {region !== 'R' && iso !== HOME[region] && <p className="section-note">{josa(c.name, '은', '는')} {regionTitle(region)}의 일부로 계산합니다.</p>}
      {region === 'R' && (
        <p className="section-note">
          {josa(c.name, '은', '는')} 시뮬레이션의 AI 블록 6개에 들지 않아 '나머지 세계'로 계산합니다. 나머지 세계가 매기는 관세는 EU 관세로 대신한 값입니다.
        </p>
      )}

      <section className="panel-section" style={{ ['--accent' as string]: '#D9A75A' }}>
        <h2>{josa(rname(region), '이', '가')} {side === 'imposed' ? '매기는' : '받는'} 관세 (%)</h2>
        {side === 'imposed'
          ? grid(() => region, (o) => o, (o, g) => flowB(o, region, g))
          : grid((o) => o, () => region, (o, g) => flowB(region, o, g))}
        <p className="section-note">
          {side === 'imposed' ? '칸 = 그 지역에서 들여오는 물품에 매기는 관세.' : '칸 = 그 지역이 우리 물품에 매기는 관세.'} 흐린 칸은 2023년 교역이 5억 달러 미만. 머리글을 누르면 그 지역을 봅니다.
        </p>
      </section>

      <section className="panel-section" style={{ ['--accent' as string]: '#C9566C' }}>
        <h2>수출 통제 (2023년 시작값)</h2>
        {controls.length ? (
          controls.map((x) => (
            <div key={`${x.from}${x.to}${x.good}`} className="kv-block">
              <div className="kv">
                <span>
                  {regionName(x.from as RegionId)} → {regionName(x.to as RegionId)} · {GOODS.find((g) => g.id === x.good)?.name}
                </span>
                <span>{x.level}단계 ({EXPORT_LEVEL_LABEL[x.level]})</span>
              </div>
              {CONTROL_REASON[`${x.from}>${x.to}>${x.good}`] && <p className="section-note">{CONTROL_REASON[`${x.from}>${x.to}>${x.good}`]}</p>}
            </div>
          ))
        ) : (
          <p className="section-note">이 지역이 걸거나 받는 수출 통제는 없습니다.</p>
        )}
        <p className="section-note">시뮬레이션의 수출 통제 단계: 0 없음 · 1 약한 통제(수출세 25% 상당) · 2 강한 통제(100% 상당) · 3 전면 금지.</p>
      </section>

      <section className="panel-section" style={{ ['--accent' as string]: '#6A98D8' }}>
        <h2>전체 관세 행렬 — {goodName}</h2>
        <div className="tgrid matrix" style={{ gridTemplateColumns: `52px repeat(${REGION_LIST.length}, minmax(0,1fr))` }}>
          <span className="tgrid-corner">매김↓ 산지→</span>
          {REGION_LIST.map((e) => (
            <button key={e} className={`tgrid-head ${e === region ? 'sel' : ''}`} onClick={() => onRegion(e)}>{SHORT[e]}</button>
          ))}
          {REGION_LIST.map((i) => (
            <Fragment key={i}>
              <button className={`tgrid-row ${i === region ? 'sel' : ''}`} onClick={() => onRegion(i)}>{SHORT[i]}</button>
              {REGION_LIST.map((e) => {
                const v = tariffOf(i, e, good)
                const on = i === region || e === region
                return (
                  <span key={e} className={`tgrid-cell ${on ? '' : 'dim'}`} style={cell(v)}>
                    {fmtCell(v)}
                  </span>
                )
              })}
            </Fragment>
          ))}
        </div>
        <p className="section-note">줄은 관세를 매기는 지역, 칸은 물품이 나온 지역. 위 품목 선택이나 표의 품목 줄을 누르면 바뀝니다.</p>
      </section>

      <footer className="panel-foot">
        <p>엔진(정책 실험·AI 리플레이)이 1분기에 쓰는 관세 그대로입니다. 0.1%p 단위로 반올림했습니다.</p>
        <ul>
          {TARIFF_NOTES.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </footer>
    </div>
  )
}
