// 오른쪽 패널: 고른 나라의 2023년 자료. 값마다 연도와 출처를 함께 적는다.
// 색: 녹색은 '고른 나라'에만 쓴다. 섹션마다 다른 강조색, 품목은 품목별 색, 산업 구조는 세 부문 색 (모두 채도를 낮춘 색).

import type { CSSProperties, ReactNode } from 'react'
import { DATA, GOODS, GOOD_COLOR, goodsMix, partners, people, pct, perCapita, usd, usdMillion, type Direction, type HofKey, type Val } from './data'
import { flagUrl } from './flags'

const ACCENT = {
  economy: '#6A98D8', // 경제 규모: 파랑
  trade: '#D9A75A', // 무역 총액: 호박색
  culture: '#B596D6', // 문화: 라벤더
  structure: '#4FB3A6', // 산업 구조: 청록
}
const SECTOR = { agriculture: '#8BB174', industry: '#6A98D8', services: '#C9A86A', rents: '#D9915A' }
const EXPORT = '#DDE3E8'
const IMPORT = '#C9566C'

const HOF: { key: HofKey; name: string; hint: string }[] = [
  { key: 'pdi', name: '권력거리', hint: '권력이 고르지 않게 나뉘는 것을 받아들이는 정도' },
  { key: 'idv', name: '개인주의', hint: '높을수록 개인 중심, 낮을수록 집단 결속' },
  { key: 'mas', name: '성취 지향', hint: '높을수록 경쟁·성취, 낮을수록 협의·삶의 질' },
  { key: 'uai', name: '불확실성 회피', hint: '모호함을 불편해하고 규칙을 선호하는 정도' },
  { key: 'lto', name: '장기 지향', hint: '높을수록 미래 대비, 낮을수록 전통·현재 의무' },
  { key: 'ivr', name: '쾌락 추구', hint: '삶을 즐기려는 욕구를 자유롭게 채우는 정도' },
]

type Props = { iso: string; dir: Direction; good: string | null; onSelect: (iso: string) => void }

export function CountryPanel({ iso, dir, good, onSelect }: Props) {
  const c = DATA.countries[iso]
  const bloc = DATA.blocs[c.bloc]
  const rows = partners(iso, dir, good)
  const maxRow = Math.max(1, ...rows.map((r) => r.value))
  const mix = goodsMix(iso, dir)
  const goodName = good ? GOODS.find((g) => g.id === good)!.name : '전체 상품'
  const word = dir === 'export' ? '수출' : '수입'
  const flowColor = dir === 'export' ? EXPORT : IMPORT
  const balance = c.merchExports && c.merchImports ? c.merchExports.value - c.merchImports.value : null
  const s = c.structure

  return (
    <div className="panel-inner">
      <header className="panel-head">
        <img src={flagUrl(c.iso2)} alt="" className="panel-flag" />
        <div>
          <h1>{c.name}</h1>
          <p className="muted">
            블록 · {bloc.name}
            {bloc.members.length > 1 && <> ({bloc.members.map((m) => DATA.countries[m].name).join(', ')})</>}
          </p>
        </div>
      </header>

      <Section title="경제 규모" accent={ACCENT.economy}>
        <div className="tiles">
          <Tile label="GDP" v={c.gdp} f={usd} color={ACCENT.economy} />
          <Tile label="1인당 GDP" v={c.gdpPerCapita} f={perCapita} color={ACCENT.economy} />
          <Tile label="인구" v={c.population} f={people} color={ACCENT.economy} />
        </div>
        <Row label="노동력" v={c.laborForce} f={people} />
        <Row label="투자율 (GDP 대비)" v={c.investmentPct} f={pct} />
      </Section>

      <Section title="무역 총액" accent={ACCENT.trade}>
        <div className="tiles two">
          <Tile label="상품 수출" v={c.merchExports} f={usd} color={EXPORT} />
          <Tile label="상품 수입" v={c.merchImports} f={usd} color={IMPORT} />
        </div>
        {balance !== null && (
          <div className="kv">
            <span>상품 무역수지</span>
            <span style={{ color: balance >= 0 ? '#7FC4B3' : '#E08497' }}>
              {balance >= 0 ? '흑자 ' : '적자 '}
              {usd(Math.abs(balance))}
            </span>
          </div>
        )}
        <Row label="수출 / GDP" v={c.exportsPct} f={pct} note="서비스 포함" />
        <Row label="수입 / GDP" v={c.importsPct} f={pct} note="서비스 포함" />
      </Section>

      <Section title={`${word} 상대 · ${goodName}`} accent={flowColor} note="지도에 있는 나라 사이 상품 교역 · UN Comtrade 2023">
        {rows.length === 0 && <p className="muted">자료 없음</p>}
        {rows.map((r) => (
          <button key={r.iso} className="bar-row" onClick={() => onSelect(r.iso)} title={r.source}>
            <span className="bar-label">
              <img src={flagUrl(DATA.countries[r.iso].iso2)} alt="" className="mini-flag" />
              {DATA.countries[r.iso].name}
            </span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${(r.value / maxRow) * 100}%`, background: good ? GOOD_COLOR[good] : flowColor }} />
            </span>
            <span className="bar-value">{usdMillion(r.value)}</span>
          </button>
        ))}
      </Section>

      {mix.total > 0 && (
        <Section title={`${word} 품목 구성`} accent={GOOD_COLOR[mix.rows[0].id]} note={`지도에 있는 나라와의 ${word} ${usdMillion(mix.total)} 기준`}>
          <div className="stack-bar">
            {mix.rows.filter((g) => g.value > 0).map((g) => (
              <span
                key={g.id}
                className={good && g.id !== good ? 'dim' : ''}
                style={{ width: `${(g.value / mix.total) * 100}%`, background: GOOD_COLOR[g.id] }}
                title={`${g.name} ${pct((g.value / mix.total) * 100)}`}
              />
            ))}
          </div>
          {mix.rows.filter((g) => g.value > 0).map((g) => (
            <div key={g.id} className={`kv legend-row ${g.id === good ? 'on' : ''}`}>
              <span>
                <Dot color={GOOD_COLOR[g.id]} />
                {g.name}
              </span>
              <span>
                {pct((g.value / mix.total) * 100)} <span className="muted-inline">· {usdMillion(g.value)}</span>
              </span>
            </div>
          ))}
        </Section>
      )}

      {s && (
        <Section title="산업 구조 (GDP 대비)" accent={ACCENT.structure} note="세 부문은 부가가치 기준이라, 합이 100%에 못 미치는 만큼은 순생산물세입니다">

          {s.agriculturePct && s.industryPct && s.servicesPct && (
            <div className="stack-bar">
              <span style={{ width: `${s.agriculturePct.value}%`, background: SECTOR.agriculture }} title="농업" />
              <span style={{ width: `${s.industryPct.value}%`, background: SECTOR.industry }} title="산업" />
              <span style={{ width: `${s.servicesPct.value}%`, background: SECTOR.services }} title="서비스" />
            </div>
          )}
          <Row label="농업" v={s.agriculturePct} f={pct} dot={SECTOR.agriculture} />
          <Row label="산업 (제조업·광업·건설 등)" v={s.industryPct} f={pct} dot={SECTOR.industry} />
          <Row label="그중 제조업" v={s.manufacturingPct} f={pct} indent />
          <Row label="서비스" v={s.servicesPct} f={pct} dot={SECTOR.services} />
          <Row label="자원 지대 (석유·가스·석탄·광물)" v={s.resourceRentsPct} f={pct} dot={SECTOR.rents} />
        </Section>
      )}

      <Section
        title="문화 (Hofstede 6개 지표)"
        accent={ACCENT.culture}
        note={c.culture ? ['0–100 눈금, 가운데 선이 50', c.culture.note, c.culture.source].filter(Boolean).join(' · ') : undefined}
      >
        {!c.culture && <p className="muted">자료 없음</p>}
        {c.culture &&
          HOF.map((h) => {
            const v = c.culture!.values[h.key]
            return (
              <div key={h.key} className="hof-row" title={h.hint}>
                <span className="bar-label">{h.name}</span>
                <span className="bar-track mid">{v !== null && <span className="bar-fill" style={{ width: `${v}%`, background: ACCENT.culture }} />}</span>
                <span className="bar-value">{v ?? '자료 없음'}</span>
              </div>
            )
          })}
      </Section>

      <footer className="panel-foot">
        <p>모든 값은 2023년 기준이고, 2023년 값이 없으면 가장 최근 값을 썼습니다.</p>
        <p>교역: {DATA.meta.flowNote}.</p>
        <ul>
          {DATA.meta.sources.map((src) => (
            <li key={src.id}>
              {src.link ? <a href={src.link} target="_blank" rel="noreferrer">{src.name}</a> : src.name} — {src.detail}
            </li>
          ))}
        </ul>
      </footer>
    </div>
  )
}

function Section({ title, accent, note, children }: { title: string; accent: string; note?: string; children: ReactNode }) {
  return (
    <section className="panel-section" style={{ '--accent': accent } as CSSProperties}>
      <h2>{title}</h2>
      {children}
      {note && <p className="section-note">{note}</p>}
    </section>
  )
}

const Dot = ({ color }: { color: string }) => <span className="dot" style={{ background: color }} />

function Tile({ label, v, f, color }: { label: string; v: Val; f: (n: number) => string; color: string }) {
  return (
    <div className="tile" style={{ borderTopColor: color }}>
      <span className="tile-label">{label}</span>
      <span className="tile-value">{v ? f(v.value) : '자료 없음'}</span>
      {v && <span className="src">{v.year !== 2023 ? `${v.year} · ` : ''}{v.source}</span>}
    </div>
  )
}

function Row({ label, v, f, note, dot, indent }: { label: string; v: Val; f: (n: number) => string; note?: string; dot?: string; indent?: boolean }) {
  return (
    <div className={`kv ${indent ? 'indent' : ''}`}>
      <span>
        {dot && <Dot color={dot} />}
        {label}
      </span>
      {v ? (
        <span>
          {f(v.value)}
          <span className="src">
            {v.year !== 2023 ? `${v.year} · ` : ''}
            {v.source}
            {note ? ` · ${note}` : ''}
          </span>
        </span>
      ) : (
        <span className="muted-inline">자료 없음</span>
      )}
    </div>
  )
}
