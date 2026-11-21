// 관세 모드의 '나라별' 화면: 나라마다 실제로 적용하는 관세(World Bank WDI, WITS 계산)로 지도를 칠한다.
// 대세계 수입액 가중 평균이라 상대국별 차이는 없다. 상대국별·품목별 관세는 '블록 사이' 화면(시뮬레이션 엔진 값)에 있다.

import { useMemo, useState, type ReactNode } from 'react'
import { blocOf, regionTitle } from '../blocs'
import { COUNTRIES, DATA, type Country, type Val } from '../data'
import { flagUrl } from '../flags'
import { viewFor } from '../geo'
import { mix, Screen, type Mode } from '../Screen'

export type Group = 'all' | 'manuf' | 'primary'
export const GROUPS: { id: Group; name: string; hint: string }[] = [
  { id: 'all', name: '전 품목', hint: '모든 수입품' },
  { id: 'manuf', name: '공산품', hint: '공업 제품 (SITC 5–8, 68 제외)' },
  { id: 'primary', name: '1차 산품', hint: '농산물·연료·광물 등 (SITC 0–4, 68)' },
]

const RAMP: [string, string] = ['#2F3B48', '#E3A15E']
const CAP = 15
export const cColor = (v: number) => mix(RAMP[0], RAMP[1], Math.sqrt(Math.min(v, CAP) / CAP))
const FIRST = 20

const valOf = (c: Country, g: Group): Val => c.tariff?.[g] ?? null
const median = (xs: number[]) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const p1 = (v: number) => `${v.toFixed(1)}%`

type Props = {
  iso: string
  group: Group
  setIso: (iso: string) => void
  setGroup: (g: Group) => void
  onMode: (m: Mode) => void
  scopeSeg: ReactNode
  onBloc: () => void
}

export function CountryTariffView({ iso, group, setIso, setGroup, onMode, scopeSeg, onBloc }: Props) {
  const c = DATA.countries[iso]
  const ranked = useMemo(
    () =>
      COUNTRIES.map((x) => ({ c: x, v: valOf(x, group) }))
        .filter((x): x is { c: Country; v: NonNullable<Val> } => x.v !== null)
        .sort((a, b) => b.v.value - a.v.value),
    [group],
  )
  const rankOf = (x: string) => ranked.findIndex((r) => r.c.iso === x) + 1
  const world = median(ranked.map((r) => r.v.value))
  const gName = GROUPS.find((g) => g.id === group)!.name
  const v = valOf(c, group)

  const subtitle = v
    ? `${c.name}의 적용 관세 (${gName}, ${v.year}년) ${p1(v.value)} — 높은 순 ${rankOf(iso)}위 / ${ranked.length}곳 · 세계 중앙값 ${p1(world)}`
    : `${c.name}: World Bank 관세 자료가 없습니다 · 세계 중앙값 ${p1(world)} (${gName})`

  return (
    <Screen
      mode="tariff"
      onMode={onMode}
      map={{
        view: viewFor(iso),
        selected: iso,
        dir: 'export',
        arcs: [],
        fillFor: (x) => {
          const y = valOf(DATA.countries[x], group)
          return y ? cColor(y.value) : null
        },
        onSelect: setIso,
      }}
      controls={
        <>
          {scopeSeg}
          <div className="seg" role="group" aria-label="품목 묶음">
            {GROUPS.map((g) => (
              <button key={g.id} className={g.id === group ? 'on' : ''} onClick={() => setGroup(g.id)}>{g.name}</button>
            ))}
          </div>
          <div className="legend">
            <span className="legend-bar" style={{ background: `linear-gradient(90deg, ${RAMP[0]}, ${cColor(5)}, ${RAMP[1]})` }} />
            <span className="legend-ends">
              <span>0%</span>
              <span>5%</span>
              <span>{CAP}% 이상</span>
            </span>
            <span className="legend-note">적용 관세, 수입액 가중 평균 · 회색은 자료 없음</span>
          </div>
        </>
      }
      sources="World Bank WDI (적용 관세, WITS 계산 · 대부분 2022년)"
      subtitle={subtitle}
      hoverText={(h) => {
        if (!h.iso) return { title: h.name, body: '자료 없음' }
        const y = valOf(DATA.countries[h.iso], group)
        return { title: h.name, body: y ? `${gName} ${p1(y.value)} (${y.year}년) · ${rankOf(h.iso)}위` : 'World Bank 관세 자료 없음' }
      }}
      panel={<Panel iso={iso} group={group} ranked={ranked} world={world} onSelect={setIso} onBloc={onBloc} />}
      panelLabel={`${c.name} 관세 보기`}
      panelKey={iso}
    />
  )
}

type Ranked = { c: Country; v: NonNullable<Val> }[]

function Panel({ iso, group, ranked, world, onSelect, onBloc }: { iso: string; group: Group; ranked: Ranked; world: number; onSelect: (iso: string) => void; onBloc: () => void }) {
  const c = DATA.countries[iso]
  const [openFor, setOpenFor] = useState<string | null>(null)
  const showAll = openFor === group
  const gName = GROUPS.find((g) => g.id === group)!.name
  const rank = ranked.findIndex((r) => r.c.iso === iso)
  const sameRegion = ranked.filter((r) => r.c.region && r.c.region === c.region).map((r) => r.v.value)
  const regionMedian = median(sameRegion)
  const shown = showAll ? ranked : ranked.slice(0, FIRST)
  const max = Math.max(1, ...ranked.map((r) => Math.min(r.v.value, 40)))
  const bloc = blocOf(iso)

  const row = (r: Ranked[number], i: number) => (
    <button key={r.c.iso} className={`bar-row ${r.c.iso === iso ? 'on' : ''}`} onClick={() => onSelect(r.c.iso)}>
      <span className="bar-label">
        <span className="rank wide">{i + 1}</span>
        <img src={flagUrl(r.c)} alt="" className="mini-flag" />
        {r.c.name}
      </span>
      <span className="bar-track">
        <span className="bar-fill" style={{ width: `${(100 * Math.min(r.v.value, 40)) / max}%`, background: cColor(r.v.value) }} />
      </span>
      <span className="bar-value">
        {p1(r.v.value)}
        {r.v.year !== 2022 && <span className="share">{r.v.year}년</span>}
      </span>
    </button>
  )

  return (
    <div className="panel-inner">
      <header className="panel-head">
        <img src={flagUrl(c)} alt="" className="panel-flag" />
        <div>
          <h1>{c.name}</h1>
          <p className="muted">{[c.region, c.income && `${c.income} 국가`].filter(Boolean).join(' · ') || '지역 분류 없음'}</p>
        </div>
      </header>

      <section className="panel-section" style={{ ['--accent' as string]: '#D9A75A' }}>
        <h2>적용 관세 (수입액 가중 평균)</h2>
        <div className="tiles">
          {GROUPS.map((g) => {
            const y = c.tariff?.[g.id] ?? null
            return (
              <div key={g.id} className="tile" style={{ ['--accent' as string]: g.id === group ? '#D9A75A' : 'rgba(255,255,255,0.15)' }}>
                <span className="tile-label">{g.name}</span>
                <span className="tile-value">{y ? p1(y.value) : '—'}</span>
                {y && <span className="src">{y.year}년</span>}
              </div>
            )
          })}
        </div>
        {c.tariff?.[group] ? (
          <>
            <div className="kv"><span>{gName} 높은 순위</span><span>{rank + 1}위 / {ranked.length}곳</span></div>
            <div className="kv"><span>세계 중앙값</span><span>{p1(world)}</span></div>
            {sameRegion.length > 1 && <div className="kv"><span>{c.region} 중앙값 ({sameRegion.length}곳)</span><span>{p1(regionMedian)}</span></div>}
          </>
        ) : (
          <p className="section-note">
            {iso === 'TWN' ? 'World Bank 자료에 대만이 없습니다. ' : 'World Bank 관세 자료가 없는 곳입니다. '}
            {bloc ? '시뮬레이션 블록 관세(WITS TRAINS 등으로 따로 구한 값)는 블록 사이 화면에서 볼 수 있습니다.' : ''}
          </p>
        )}
        {bloc && (
          <button className="more" onClick={onBloc}>
            {regionTitle(bloc)}의 상대국별·품목별 관세 보기 (시뮬레이션 값)
          </button>
        )}
      </section>

      <section className="panel-section" style={{ ['--accent' as string]: '#C9566C' }}>
        <h2>나라별 순위 — {gName}</h2>
        {shown.map((r, i) => row(r, i))}
        {!showAll && rank >= FIRST && (
          <>
            <p className="section-note">…</p>
            {row(ranked[rank], rank)}
          </>
        )}
        <button className="more" onClick={() => setOpenFor(showAll ? null : group)}>
          {showAll ? `${FIRST}곳만 보기` : `${ranked.length - FIRST}곳 더 보기`}
        </button>
      </section>

      <footer className="panel-foot">
        <ul>
          <li>적용 관세(AHS)는 FTA 특혜세율을 반영해 실제로 매긴 세율입니다. 모든 상대에서 들여온 수입품을 수입액으로 가중 평균했습니다 (World Bank가 WITS로 계산).</li>
          <li>미국 301조, 중국의 보복 관세 같은 추가 관세는 들어 있지 않습니다 (그래서 미국 1.5%, 중국 2.2%). 시뮬레이션의 블록 관세에는 이 추가 관세를 PIIE 평균으로 더했습니다.</li>
          <li>값이 늦게 나와 대부분 2022년 값입니다. 2022년이 아닌 나라는 연도를 따로 적었습니다. 대만은 World Bank 자료에 없습니다.</li>
          <li>EU 회원국은 같은 공동 관세를 쓰지만 수입 구성이 달라 평균이 조금씩 다릅니다.</li>
          <li>수입액 가중 평균은 관세가 너무 높아 거의 수입하지 않는 품목의 비중이 작아서, 실제 보호 수준보다 낮게 나오는 경향이 있습니다.</li>
        </ul>
      </footer>
    </div>
  )
}
