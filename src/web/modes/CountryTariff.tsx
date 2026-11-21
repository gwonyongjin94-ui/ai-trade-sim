// 관세 모드의 '나라별' 화면. 보기 세 가지:
// · 나라 평균: 나라마다 모든 수입품에 매기는 평균 관세 (World Bank WDI, WITS 계산)로 지도를 칠한다
// · 매기는 관세: 고른 나라가 상대국마다 그 나라 물품에 매기는 관세 (WITS TradeStats-Tariff, 나라 쌍)
// · 받는 관세: 수입국마다 고른 나라 물품에 매기는 관세 (같은 자료를 거꾸로)
// 모두 적용 관세(FTA 특혜세율 반영)의 수입액 가중 평균이다. 미중 추가 관세는 들어 있지 않다.

import { useMemo, useState, type ReactNode } from 'react'
import { blocOf, josa, regionTitle } from '../blocs'
import { GROUP_INDEX, MIN_TRADE, partnerOf, rateOf, tradeOf, TRADE_WAR, useTariffs, weighted, yearOf, type TariffFile, type TRow } from '../bilateral'
import { COUNTRIES, DATA, usdMillion, type Country, type Val } from '../data'
import { flagUrl } from '../flags'
import { viewFor } from '../geo'
import { mix, Screen, type Mode } from '../Screen'
import type { Arc } from '../WorldMap'

export type Group = 'all' | 'manuf' | 'primary'
export const GROUPS: { id: Group; name: string; hint: string }[] = [
  { id: 'all', name: '전 품목', hint: '모든 수입품' },
  { id: 'manuf', name: '공산품', hint: '공업 제품 (SITC 5–8, 68 제외)' },
  { id: 'primary', name: '1차 산품', hint: '농산물·연료·광물 등 (SITC 0–4, 68)' },
]
export type View = 'avg' | 'imposes' | 'faces'
export const VIEWS: { id: View; name: string; title: string }[] = [
  { id: 'avg', name: '나라 평균', title: '나라마다 모든 수입품에 매기는 평균 관세' },
  { id: 'imposes', name: '매기는 관세', title: '고른 나라가 상대국마다 매기는 관세' },
  { id: 'faces', name: '받는 관세', title: '수입국마다 고른 나라 물품에 매기는 관세' },
]

const RAMP: [string, string] = ['#2F3B48', '#E3A15E']
const CAP = 15
export const cColor = (v: number) => mix(RAMP[0], RAMP[1], Math.sqrt(Math.min(v, CAP) / CAP))
const FIRST = 20
const LIST = 15
const HIGH_MIN = 10 // '관세 높은 순'에 넣는 최소 수입액 (백만 달러)

const valOf = (c: Country, g: Group): Val => c.tariff?.[g] ?? null
const median = (xs: number[]) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const p1 = (v: number) => `${v.toFixed(1)}%`
const nameOf = (iso: string) => DATA.countries[iso]?.name ?? iso
const groupName = (g: Group) => GROUPS.find((x) => x.id === g)!.name

type Props = {
  iso: string
  view: View
  group: Group
  setIso: (iso: string) => void
  setView: (v: View) => void
  setGroup: (g: Group) => void
  onMode: (m: Mode) => void
  scopeSeg: ReactNode
  onBloc: () => void
}

export function CountryTariffView(props: Props) {
  return props.view === 'avg' ? <AvgView {...props} /> : <PairView {...props} />
}

function Controls({ view, group, setView, setGroup, scopeSeg, note }: Props & { note: string }) {
  return (
    <>
      {scopeSeg}
      <div className="seg" role="group" aria-label="보기">
        {VIEWS.map((v) => (
          <button key={v.id} className={v.id === view ? 'on' : ''} onClick={() => setView(v.id)} title={v.title}>{v.name}</button>
        ))}
      </div>
      <div className="seg" role="group" aria-label="품목 묶음">
        {GROUPS.map((g) => (
          <button key={g.id} className={g.id === group ? 'on' : ''} onClick={() => setGroup(g.id)} title={g.hint}>{g.name}</button>
        ))}
      </div>
      <div className="legend">
        <span className="legend-bar" style={{ background: `linear-gradient(90deg, ${RAMP[0]}, ${cColor(5)}, ${RAMP[1]})` }} />
        <span className="legend-ends">
          <span>0%</span>
          <span>5%</span>
          <span>{CAP}% 이상</span>
        </span>
        <span className="legend-note">{note}</span>
      </div>
    </>
  )
}

const NOTES_COMMON = [
  '적용 관세(AHS)는 FTA 특혜세율을 반영해 실제로 매긴 세율이고, 수입액으로 가중 평균했습니다.',
  '미국 301조, 중국의 보복 관세 같은 미중 추가 관세는 들어 있지 않습니다. 시뮬레이션의 블록 관세에는 이 추가 관세를 PIIE 평균(미국→중국 19.3%, 중국→미국 21%)으로 더했습니다.',
  'EU 회원국은 같은 공동 관세를 쓰지만 수입 구성이 달라 평균이 조금씩 다르고, 회원국끼리는 0%입니다.',
  '수입액 가중 평균은 관세가 너무 높아 거의 수입하지 않는 품목의 비중이 작아서, 실제 보호 수준보다 낮게 나오는 경향이 있습니다.',
]

function Head({ c, sub }: { c: Country; sub: string }) {
  return (
    <header className="panel-head">
      <img src={flagUrl(c)} alt="" className="panel-flag" />
      <div>
        <h1>{c.name}</h1>
        <p className="muted">{sub}</p>
      </div>
    </header>
  )
}

// ───────────── 나라 평균 (WDI)

function AvgView(props: Props) {
  const { iso, group, setIso, onMode } = props
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
  const gName = groupName(group)
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
      controls={<Controls {...props} note="나라마다 모든 수입품에 매기는 평균 · 회색은 자료 없음" />}
      sources="World Bank WDI (적용 관세, WITS 계산 · 대부분 2022년)"
      subtitle={subtitle}
      hoverText={(h) => {
        if (!h.iso) return { title: h.name, body: '자료 없음' }
        const y = valOf(DATA.countries[h.iso], group)
        return { title: h.name, body: y ? `${gName} ${p1(y.value)} (${y.year}년) · ${rankOf(h.iso)}위` : 'World Bank 관세 자료 없음' }
      }}
      panel={<AvgPanel {...props} ranked={ranked} world={world} />}
      panelLabel={`${c.name} 관세 보기`}
      panelKey={iso}
    />
  )
}

type Ranked = { c: Country; v: NonNullable<Val> }[]

function AvgPanel({ iso, group, ranked, world, setIso, setView, onBloc }: Props & { ranked: Ranked; world: number }) {
  const c = DATA.countries[iso]
  const [openFor, setOpenFor] = useState<string | null>(null)
  const showAll = openFor === group
  const gName = groupName(group)
  const rank = ranked.findIndex((r) => r.c.iso === iso)
  const sameRegion = ranked.filter((r) => r.c.region && r.c.region === c.region).map((r) => r.v.value)
  const shown = showAll ? ranked : ranked.slice(0, FIRST)
  const max = Math.max(1, ...ranked.map((r) => Math.min(r.v.value, 40)))
  const bloc = blocOf(iso)
  const who = josa(c.name, '이', '가')

  const row = (r: Ranked[number], i: number) => (
    <button key={r.c.iso} className={`bar-row ${r.c.iso === iso ? 'on' : ''}`} onClick={() => setIso(r.c.iso)}>
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
      <Head c={c} sub={[c.region, c.income && `${c.income} 국가`].filter(Boolean).join(' · ') || '지역 분류 없음'} />

      <section className="panel-section" style={{ ['--accent' as string]: '#D9A75A' }}>
        <h2>적용 관세 (모든 수입품, 수입액 가중 평균)</h2>
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
            {sameRegion.length > 1 && <div className="kv"><span>{c.region} 중앙값 ({sameRegion.length}곳)</span><span>{p1(median(sameRegion))}</span></div>}
          </>
        ) : (
          <p className="section-note">
            {iso === 'TWN' ? 'World Bank 자료에 대만의 평균 관세가 없습니다. ' : 'World Bank 관세 자료가 없는 곳입니다. '}
            {bloc ? '시뮬레이션 블록 관세(WITS TRAINS 등으로 따로 구한 값)는 블록 사이 화면에서 볼 수 있습니다.' : ''}
          </p>
        )}
        <div className="btn-row">
          <button className="more inline" onClick={() => setView('imposes')}>{who} 상대국마다 매기는 관세</button>
          <button className="more inline" onClick={() => setView('faces')}>{who} 받는 관세</button>
        </div>
        {bloc && (
          <button className="more" onClick={onBloc}>
            {regionTitle(bloc)}의 블록 사이·품목별 관세 보기 (시뮬레이션 값)
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
          <li>World Bank WDI 지표 (WITS가 계산): 모든 상대에서 들여온 수입품의 평균입니다.</li>
          {NOTES_COMMON.map((n) => <li key={n}>{n}</li>)}
          <li>값이 늦게 나와 대부분 2022년 값입니다. 2022년이 아닌 나라는 연도를 따로 적었습니다. 대만은 World Bank 자료에 없습니다.</li>
        </ul>
      </footer>
    </div>
  )
}

// ───────────── 매기는 관세 · 받는 관세 (WITS 나라 쌍)

function PairView(props: Props) {
  const { iso, view, group, setIso, onMode } = props
  const c = DATA.countries[iso]
  const { file, error } = useTariffs(iso)
  const gi = GROUP_INDEX[group]
  const gName = groupName(group)
  const imposes = view === 'imposes'
  const rows: TRow[] = file ? (imposes ? file.imposed : file.faced) : []
  const byIso = new Map(rows.map((r) => [partnerOf(r), r]))
  const rate = (r: TRow) => rateOf(r, gi)
  const trade = (r: TRow) => tradeOf(r, gi)
  const byTrade = rows.filter((r) => rate(r) !== null && trade(r) > 0).sort((a, b) => trade(b) - trade(a))
  const reporters = DATA.meta.pairTariffs.reporters
  const who = josa(c.name, '이', '가')

  const arcs: Arc[] = byTrade
    .filter((r) => DATA.countries[partnerOf(r)])
    .slice(0, 6)
    .map((r) => ({ iso: partnerOf(r), value: trade(r), label: `관세 ${p1(rate(r)!)}` }))

  const top = byTrade.slice(0, 4).map((r) => `${nameOf(partnerOf(r))} ${p1(rate(r)!)}`).join(' · ')
  const subtitle = !file
    ? error
      ? '관세 자료를 불러오지 못했습니다'
      : '관세 자료를 불러오는 중…'
    : !byTrade.length
      ? `${c.name}: WITS에 ${imposes ? '이 나라가 상대국마다 매기는 관세' : '이 나라 물품에 매기는 관세'} 자료가 없습니다`
      : imposes
        ? `${who} 매기는 관세 (${gName}, ${file.year}년) — 주요 수입국: ${top}`
        : `${c.name} 물품이 받는 관세 (${gName}) — 주요 수출 시장: ${top}`

  return (
    <Screen
      mode="tariff"
      onMode={onMode}
      map={{
        view: viewFor(iso),
        selected: iso,
        dir: imposes ? 'import' : 'export',
        arcs,
        fillFor: (x) => {
          const r = byIso.get(x)
          return r && rate(r) !== null && trade(r) >= MIN_TRADE ? cColor(rate(r)!) : null
        },
        onSelect: setIso,
      }}
      controls={
        <Controls
          {...props}
          note={imposes ? `${who} 그 나라 물품에 매기는 관세 · 회색: 자료 없음·교역 아주 적음` : `그 나라가 ${c.name} 물품에 매기는 관세 · 회색: 자료 없음·교역 아주 적음`}
        />
      }
      sources="World Bank WITS TradeStats-Tariff (UNCTAD TRAINS · 대부분 2022년)"
      subtitle={subtitle}
      hoverText={(h) => {
        if (!h.iso) return { title: h.name, body: '자료 없음' }
        if (h.iso === iso) return { title: h.name, body: '고른 나라' }
        const r = byIso.get(h.iso)
        const other = DATA.countries[h.iso].name
        if (!r || rate(r) === null || !(trade(r) > 0)) {
          if (imposes) return { title: other, body: file?.year ? `${c.name}의 ${gName} 수입 기록 없음` : '자료 없음' }
          return { title: other, body: reporters[h.iso] ? `${c.name}에서 들여온 ${gName} 기록 없음` : 'WITS 관세 자료가 없는 나라' }
        }
        const line = imposes ? `${who} ${other} 물품에 ${p1(rate(r)!)}` : `${josa(other, '이', '가')} ${c.name} 물품에 ${p1(rate(r)!)}`
        const war = TRADE_WAR[imposes ? `${iso}>${h.iso}` : `${h.iso}>${iso}`]
        const small = trade(r) < MIN_TRADE ? ' · 교역이 아주 적어 지도에 칠하지 않음' : ''
        return { title: other, body: `${line} · 수입 ${usdMillion(trade(r))}${small}${war ? ` · ${war.what} 빠짐 (실제 평균 약 ${war.pct}%)` : ''}` }
      }}
      panel={<PairPanel {...props} rows={rows} file={file} error={error} />}
      panelLabel={`${c.name} 관세 보기`}
      panelKey={`${iso}-${view}`}
    />
  )
}

function PairPanel({ iso, view, group, setIso, setView, rows, file, error }: Props & { rows: TRow[]; file: TariffFile | null; error: boolean }) {
  const c = DATA.countries[iso]
  const [sort, setSort] = useState<'trade' | 'high'>('trade')
  const [more, setMore] = useState(false)
  const gi = GROUP_INDEX[group]
  const gName = groupName(group)
  const imposes = view === 'imposes'
  const rate = (r: TRow) => rateOf(r, gi)
  const trade = (r: TRow) => tradeOf(r, gi)
  const valid = rows.filter((r) => rate(r) !== null && trade(r) > 0)
  const list =
    sort === 'trade' ? [...valid].sort((a, b) => trade(b) - trade(a)) : valid.filter((r) => trade(r) >= HIGH_MIN).sort((a, b) => rate(b)! - rate(a)!)
  const shown = more ? list : list.slice(0, LIST)
  const max = Math.max(1, ...shown.map((r) => Math.min(rate(r)!, 40)))
  const who = josa(c.name, '이', '가')

  if (!file)
    return (
      <div className="panel-inner">
        <Head c={c} sub={imposes ? '상대국마다 매기는 관세' : '이 나라 물품이 받는 관세'} />
        <p className="section-note">{error ? '관세 자료를 불러오지 못했습니다.' : '불러오는 중…'}</p>
      </div>
    )

  // 요약 칸: 매기는 관세는 WITS의 대세계 값, 받는 관세는 수입국들의 값을 수입액으로 가중한 평균
  const tiles = GROUPS.map((g) => {
    const i = GROUP_INDEX[g.id]
    if (imposes) {
      const w = file.world
      return { g, v: w ? w[i] : null, m: w ? ((w[3 + i] as number | null) ?? 0) : 0 }
    }
    const w = weighted(rows, i)
    return { g, v: w?.value ?? null, m: w?.trade ?? 0 }
  })

  const line = (r: TRow, i: number) => {
    const t = rate(r)!
    const war = TRADE_WAR[imposes ? `${iso}>${partnerOf(r)}` : `${partnerOf(r)}>${iso}`]
    const year = imposes ? null : yearOf(r)
    return (
      <button key={partnerOf(r)} className="bar-row" onClick={() => DATA.countries[partnerOf(r)] && setIso(partnerOf(r))}>
        <span className="bar-label">
          <span className="rank wide">{i + 1}</span>
          {DATA.countries[partnerOf(r)] && <img src={flagUrl(DATA.countries[partnerOf(r)])} alt="" className="mini-flag" />}
          {nameOf(partnerOf(r))}
        </span>
        <span className="bar-track">
          <span className="bar-fill" style={{ width: `${(100 * Math.min(t, 40)) / max}%`, background: cColor(t) }} />
        </span>
        <span className="bar-value">
          {p1(t)}
          <span className="share">
            {usdMillion(trade(r))}
            {year && year !== 2022 ? ` · ${year}년` : ''}
          </span>
          {war && <span className="share warn">추가 관세 빠짐 · 실제 약 {war.pct}%</span>}
        </span>
      </button>
    )
  }

  const notReporter = imposes && file.year === null
  return (
    <div className="panel-inner">
      <Head c={c} sub={imposes ? `상대국마다 매기는 관세${file.year ? ` · ${file.year}년` : ''}` : `수입국들이 ${c.name} 물품에 매기는 관세`} />

      {notReporter ? (
        <section className="panel-section" style={{ ['--accent' as string]: '#D9A75A' }}>
          <p className="section-note">
            WITS에 {who} 상대국마다 매기는 관세 자료가 없습니다{iso === 'TWN' ? ' (대만은 WITS TradeStats에 없습니다)' : ''}.{file.faced.length ? ` 다른 나라가 ${c.name} 물품에 매기는 관세는 볼 수 있습니다.` : ''}
          </p>
          {file.faced.length > 0 && <button className="more" onClick={() => setView('faces')}>{who} 받는 관세 보기</button>}
        </section>
      ) : (
        <>
          <section className="panel-section" style={{ ['--accent' as string]: '#D9A75A' }}>
            <h2>{imposes ? `${who} 매기는 평균 관세 (대세계)` : `${c.name} 물품이 받는 평균 관세`}</h2>
            <div className="tiles">
              {tiles.map(({ g, v, m }) => (
                <div key={g.id} className="tile" style={{ ['--accent' as string]: g.id === group ? '#D9A75A' : 'rgba(255,255,255,0.15)' }}>
                  <span className="tile-label">{g.name}</span>
                  <span className="tile-value">{v === null ? '—' : p1(v)}</span>
                  {m > 0 && <span className="src">{imposes ? '수입' : '수출'} {usdMillion(m)}</span>}
                </div>
              ))}
            </div>
            <p className="section-note">
              {imposes
                ? `모든 상대에서 들여온 물품의 평균입니다 (WITS 대세계 값, ${file.year}년).`
                : `자료가 있는 수입국 ${valid.length}곳이 ${c.name}에서 들여온 ${gName}에 매긴 관세를 그 수입액으로 가중 평균했습니다. 수입국마다 연도가 조금 다릅니다 (대부분 2022년).`}
              {c.tariff.all && imposes ? ` 나라 평균 화면의 World Bank WDI 값(전 품목 ${p1(c.tariff.all.value)})과는 계산 방식이 조금 달라 차이가 납니다.` : ''}
            </p>
          </section>

          <section className="panel-section" style={{ ['--accent' as string]: '#C9566C' }}>
            <h2>{imposes ? '상대국별' : '수출 시장별'} — {gName}</h2>
            <div className="seg small" role="group" aria-label="줄 세우기">
              <button className={sort === 'trade' ? 'on' : ''} onClick={() => setSort('trade')}>{imposes ? '수입액 순' : '수출액 순'}</button>
              <button className={sort === 'high' ? 'on' : ''} onClick={() => setSort('high')}>관세 높은 순</button>
            </div>
            {shown.length ? shown.map(line) : <p className="section-note">자료가 없습니다.</p>}
            {list.length > LIST && (
              <button className="more" onClick={() => setMore((m) => !m)}>
                {more ? `${LIST}곳만 보기` : `${list.length - LIST}곳 더 보기`}
              </button>
            )}
            <p className="section-note">
              {sort === 'high' ? `수입액 ${HIGH_MIN}백만 달러 이상인 상대만. ` : ''}
              금액은 {imposes ? `${c.name}의` : '각 수입국의'} 수입액(WITS, 관세 자료가 있는 품목)입니다. 줄을 누르면 그 나라를 고릅니다.
            </p>
          </section>
        </>
      )}

      <section className="panel-section" style={{ ['--accent' as string]: '#6A98D8' }}>
        <div className="btn-row">
          <button className="more inline" onClick={() => setView('avg')}>나라 평균 지도</button>
          {(imposes ? file.faced.length > 0 : file.year !== null) && (
            <button className="more inline" onClick={() => setView(imposes ? 'faces' : 'imposes')}>
              {imposes ? `${who} 받는 관세` : `${who} 매기는 관세`}
            </button>
          )}
        </div>
      </section>

      <footer className="panel-foot">
        <ul>
          <li>
            World Bank WITS TradeStats-Tariff (UNCTAD TRAINS 바탕). 수입국이 그 상대국에서 들여온 물품에 매긴 세율을 품목 수입액으로 가중
            평균했습니다. 1차 산품은 식품·농산 원료·연료·광석·금속(SITC 0–4, 68)을 수입액으로 묶었습니다.
          </li>
          <li>교역이 아주 적은 상대(수입 {MIN_TRADE}백만 달러 미만)는 한두 품목이 평균을 좌우해 수백 %가 나오기도 해서 지도에 칠하지 않았습니다.</li>
          {NOTES_COMMON.map((n) => <li key={n}>{n}</li>)}
          <li>WITS에 자료가 있는 수입국은 {Object.keys(DATA.meta.pairTariffs.reporters).length}곳입니다. 대만은 WITS TradeStats에 수입국으로도 상대국으로도 없고, 방글라데시·알제리·베네수엘라 등도 빠져 있습니다.</li>
        </ul>
      </footer>
    </div>
  )
}
