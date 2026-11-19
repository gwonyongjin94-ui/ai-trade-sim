// 오른쪽 패널: 고른 나라의 2023년 자료. 값마다 연도와 출처를 함께 적는다.

import type { ReactNode } from 'react'
import { DATA, GOODS, goodsMix, partners, people, pct, perCapita, usd, usdMillion, type Direction, type HofKey, type Val } from './data'
import { flagUrl } from './flags'

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

      <Section title="경제 규모">
        <Row label="GDP" v={c.gdp} f={usd} />
        <Row label="1인당 GDP" v={c.gdpPerCapita} f={perCapita} />
        <Row label="인구" v={c.population} f={people} />
        <Row label="노동력" v={c.laborForce} f={people} />
        <Row label="투자율 (GDP 대비)" v={c.investmentPct} f={pct} />
      </Section>

      <Section title="무역 총액">
        <Row label="상품 수출" v={c.merchExports} f={usd} />
        <Row label="상품 수입" v={c.merchImports} f={usd} />
        <Row label="수출 / GDP" v={c.exportsPct} f={pct} note="서비스 포함" />
        <Row label="수입 / GDP" v={c.importsPct} f={pct} note="서비스 포함" />
      </Section>

      <Section title={`${word} 상대 · ${goodName}`} note="지도에 있는 나라 사이 상품 교역 · UN Comtrade 2023">
        {rows.length === 0 && <p className="muted">자료 없음</p>}
        {rows.map((r) => (
          <button key={r.iso} className="bar-row" onClick={() => onSelect(r.iso)} title={r.source}>
            <span className="bar-label">{DATA.countries[r.iso].name}</span>
            <span className="bar-track">
              <span className={`bar-fill ${dir}`} style={{ width: `${(r.value / maxRow) * 100}%` }} />
            </span>
            <span className="bar-value">{usdMillion(r.value)}</span>
          </button>
        ))}
      </Section>

      {mix.total > 0 && (
        <Section title={`${word} 품목 구성`} note={`지도에 있는 나라와의 ${word} ${usdMillion(mix.total)} 기준`}>
          <div className="mix-bar">
            {mix.rows.filter((g) => g.value > 0).map((g, i) => (
              <span
                key={g.id}
                className={g.id === good ? 'on' : ''}
                style={{ width: `${(g.value / mix.total) * 100}%`, opacity: 1 - Math.min(i, 6) * 0.11 }}
                title={`${g.name} ${pct((g.value / mix.total) * 100)}`}
              />
            ))}
          </div>
          {mix.rows.slice(0, 5).map((g) => (
            <div key={g.id} className={`kv ${g.id === good ? 'on' : ''}`}>
              <span>{g.name}</span>
              <span>
                {pct((g.value / mix.total) * 100)} <span className="muted">· {usdMillion(g.value)}</span>
              </span>
            </div>
          ))}
        </Section>
      )}

      {c.structure && (
        <Section title="산업 구조 (GDP 대비)">
          <Row label="농업" v={c.structure.agriculturePct} f={pct} />
          <Row label="산업 (제조업·광업·건설 등)" v={c.structure.industryPct} f={pct} />
          <Row label="그중 제조업" v={c.structure.manufacturingPct} f={pct} />
          <Row label="서비스" v={c.structure.servicesPct} f={pct} />
          <Row label="자원 지대 (석유·가스·석탄·광물)" v={c.structure.resourceRentsPct} f={pct} />
        </Section>
      )}

      <Section title="문화 (Hofstede 6개 지표)" note={c.culture ? [c.culture.note, c.culture.source].filter(Boolean).join(' · ') : undefined}>
        {!c.culture && <p className="muted">자료 없음</p>}
        {c.culture &&
          HOF.map((h) => {
            const v = c.culture!.values[h.key]
            return (
              <div key={h.key} className="hof-row" title={h.hint}>
                <span className="bar-label">{h.name}</span>
                <span className="bar-track">{v !== null && <span className="bar-fill neutral" style={{ width: `${v}%` }} />}</span>
                <span className="bar-value">{v ?? '자료 없음'}</span>
              </div>
            )
          })}
      </Section>

      <footer className="panel-foot">
        <p>모든 값은 2023년 기준이고, 2023년 값이 없으면 가장 최근 값을 썼습니다.</p>
        <p>교역: {DATA.meta.flowNote}.</p>
        <ul>
          {DATA.meta.sources.map((s) => (
            <li key={s.id}>
              {s.link ? <a href={s.link} target="_blank" rel="noreferrer">{s.name}</a> : s.name} — {s.detail}
            </li>
          ))}
        </ul>
      </footer>
    </div>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="panel-section">
      <h2>{title}</h2>
      {children}
      {note && <p className="section-note">{note}</p>}
    </section>
  )
}

function Row({ label, v, f, note }: { label: string; v: Val; f: (n: number) => string; note?: string }) {
  return (
    <div className="kv">
      <span>{label}</span>
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
        <span className="muted">자료 없음</span>
      )}
    </div>
  )
}
