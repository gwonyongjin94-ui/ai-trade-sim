// v2 엔진의 기준 연도(2023) 자료를 만든다. 내려받기는 하지 않는다 (data/v2/*.json만 읽는다).
//   npm run base:v2
// 결과: src/data/v2-base-2023.json (엔진이 읽는다)
//
// 지역 7곳: AI 블록 A~F + 나머지 세계 R. 부문 12개: 교역재 10개 + 교역되지 않는 서비스·건설.
// 엔진은 중간재가 없는 최종재 모형이라, 생산을 부가가치가 아니라 총산출로 잡는다 (Ossa 2014처럼 총교역과 맞추려고).
// 부가가치 → 총산출 비율(부가가치율)은 가정이다: 농업 0.5, 광업(자원 지대) 0.8, 제조업 0.3, 서비스 0.6.
//
// 물품별 생산 = 수출 + 국내 판매. 국내 판매는 이렇게 정한다:
//  1. 부문 묶음별 총산출 (World Bank 부가가치 비중 ÷ 부가가치율): 식품 / 화학·의약품 / 기계·운송(기계·자동차·반도체·전자) /
//     나머지(에너지·금속·의류생활 = 자원 지대 + 섬유 + 기타 제조업). 제조업 구성 자료가 없는 대만·나머지 세계는 물품 전체를 한 묶음으로 본다
//  2. 묶음의 흡수(국내 사용) = 총산출 − 수출 + 수입. 묶음 안의 물품 구성은 세계 평균(세계 교역 구성)과 같다고 본다
//  3. 국내 판매 = 물품 흡수 − 수입. 수입이 흡수보다 많으면 국내산 비중을 최소 5%로 두고, 넘친 만큼 같은 묶음의 다른 물품에서 뺀다
// 서비스·건설: (GDP − 농업·제조업·자원 지대 부가가치) ÷ 0.6. 건설 = 투자 − 자본재(기계·반도체·금속) 흡수, 단 투자의 40% 이상.
// 자본재 흡수가 그보다 많으면(대만: 반도체를 조립용으로 많이 쓴다) 넘친 몫은 소비 바구니로 간다. 그래서 물품마다
// 소비 지출과 투자 지출을 따로 적는다. 나머지 서비스·건설 총산출은 서비스(소비).
// 무역 수지는 고정 이전(적자)으로 둔다 (Dekle·Eaton·Kortum 2007): 지출 = 소득 + 적자.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const read = (f: string) => JSON.parse(readFileSync(resolve(ROOT, f), 'utf8'))
const trade = read('data/v2/trade-2023.json')
const macro = read('data/v2/macro-2023.json')
const prod = read('data/v2/production-2023.json')
const manual = read('data/v2/manual-2023.json')
const tariffs = read('data/v2/tariffs.json')

const VA_RATIO = { agriculture: 0.5, mining: 0.8, manufacturing: 0.3, services: 0.6 }
const MIN_DOMESTIC_SHARE = 0.05
const MIN_CONSTRUCTION_SHARE = 0.4 // 투자 중 건설 비중의 하한 (현실은 대략 절반)

const GOODS: string[] = trade.meta.goods
const BLOCS = ['A', 'B', 'C', 'D', 'E', 'F']
const REGIONS = [...BLOCS, 'R']
const CAPITAL_GOODS = ['metals', 'machinery', 'semiconductors']
const SETS: Record<string, string[]> = {
  food: ['food'],
  chem: ['chemicals', 'medicine'],
  mtrn: ['machinery', 'vehicles', 'semiconductors', 'electronics'],
  rest: ['energy', 'metals', 'apparel_household'],
}
const POOLED = { all: GOODS }

type Member = { iso: string; name: string; optional?: boolean }
const members = (b: string): Member[] => trade.meta.blocs[b].members.filter((m: Member) => !m.optional)
const log: string[] = []
const note = (s: string) => log.includes(s) || log.push(s)
const bn = (x: number) => x / 1e9
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
const v = (iso: string, key: string): number | null => prod.countries[iso]?.[key]?.value ?? null
const mv = (iso: string, key: string): number | null => macro.countries[iso]?.[key]?.value ?? null

// ── 거시: 인구·노동·GDP·투자율 ──
function gdpOf(iso: string): number {
  if (iso === 'PRK') return manual.PRK.gdpUsdApprox
  const g = mv(iso, 'gdpUsd')
  if (g == null) throw new Error(`GDP 없음: ${iso}`)
  return g
}
const laborOf = (iso: string) => (iso === 'TWN' ? manual.TWN.laborForce : (mv(iso, 'laborForce') ?? 0))
// 투자율: 없으면 같은 블록 첫 나라 값. 대만은 IMF API에 2023 값이 없어 주계총처 값 (manual)
const gcfOf = (iso: string): number | null => (iso === 'TWN' ? manual.TWN.grossCapitalFormationPctGdp : mv(iso, 'grossCapitalFormationPctGdp'))
// 관세·투자율은 0.1%p 단위로 반올림한다. 지도자는 정책을 0.1% 단위로 읽고 쓰므로, 시작 정책을 그대로 다시 써도 값이 바뀌지 않아야 한다
const round1pct = (x: number) => Math.round(x * 1000) / 1000
const macroOf: Record<string, { population: number; labor: number; gdpUsd: number; investmentRate: number }> = {}
for (const b of BLOCS) {
  const ms = members(b)
  const gdp = sum(ms.map((m) => gdpOf(m.iso)))
  const gcf = sum(ms.map((m) => ((gcfOf(m.iso) ?? gcfOf(ms[0].iso)!) / 100) * gdpOf(m.iso)))
  macroOf[b] = {
    population: sum(ms.map((m) => mv(m.iso, 'population') ?? 0)),
    labor: sum(ms.map((m) => laborOf(m.iso))),
    gdpUsd: gdp,
    investmentRate: round1pct(gcf / gdp),
  }
  for (const m of ms) if (gcfOf(m.iso) == null) note(`${m.iso} 투자율 없음 → ${ms[0].iso} 값`)
}
const W = prod.world
const blocTotal = (k: 'population' | 'labor' | 'gdpUsd') => sum(BLOCS.map((b) => macroOf[b][k]))
macroOf.R = {
  population: W.population.value - blocTotal('population'),
  labor: W.laborForce.value - blocTotal('labor'),
  gdpUsd: W.gdpUsd.value - blocTotal('gdpUsd'),
  investmentRate: round1pct(
    ((W.grossCapitalFormationPctGdp.value / 100) * W.gdpUsd.value - sum(BLOCS.map((b) => macroOf[b].investmentRate * macroOf[b].gdpUsd))) /
      (W.gdpUsd.value - blocTotal('gdpUsd')),
  ),
}

// ── 부가가치 (USD) → 부문 묶음별 총산출 (USD 10억) ──
const SHARE_KEYS = ['agriculturePct', 'manufacturingPct', 'oilRentsPct', 'gasRentsPct', 'coalRentsPct', 'mineralRentsPct'] as const
const COMP_KEYS = ['mfgFoodPct', 'mfgTextilePct', 'mfgChemicalPct', 'mfgMachineryTransportPct', 'mfgOtherPct'] as const
// 비어 있는 값은 같은 블록 안 다른 나라의 GDP 가중 평균으로 채운다
function blocAverage(b: string, key: string): number | null {
  let num = 0
  let den = 0
  for (const m of members(b)) {
    const x = v(m.iso, key)
    if (x == null) continue
    num += x * gdpOf(m.iso)
    den += gdpOf(m.iso)
  }
  return den > 0 ? num / den : null
}
function filled(b: string, iso: string, key: string): number {
  const x = v(iso, key)
  if (x != null) return x
  const avg = blocAverage(b, key)
  note(`${iso}.${key} 없음 → 블록 ${b} 평균 ${avg?.toFixed(1)}`)
  return avg ?? 0
}

type SetGo = Record<string, number>
const setGo: Record<string, SetGo> = {}
const vaGoods: Record<string, number> = {} // 교역재 부가가치 합 (서비스 계산용)
for (const b of BLOCS) {
  const go: SetGo = {}
  let va = 0
  for (const m of members(b)) {
    const gdp = gdpOf(m.iso)
    let agr: number, mfg: number, energyRents: number, mineralRents: number
    let comp: number[] | null
    if (m.iso === 'TWN') {
      const t = manual.TWN.production
      agr = (t.agriculturePct / 100) * gdp
      mfg = (t.manufacturingPct / 100) * gdp
      energyRents = 0
      mineralRents = 0
      comp = null
    } else {
      const s = Object.fromEntries(SHARE_KEYS.map((k) => [k, filled(b, m.iso, k) / 100]))
      agr = s.agriculturePct * gdp
      mfg = s.manufacturingPct * gdp
      energyRents = (s.oilRentsPct + s.gasRentsPct + s.coalRentsPct) * gdp
      mineralRents = s.mineralRentsPct * gdp
      const raw = COMP_KEYS.map((k) => filled(b, m.iso, k))
      const tot = sum(raw)
      comp = tot > 0 ? raw.map((x) => x / tot) : null
    }
    va += agr + mfg + energyRents + mineralRents
    const agrGo = bn(agr) / VA_RATIO.agriculture
    const minGo = bn(energyRents + mineralRents) / VA_RATIO.mining
    const mfgGo = bn(mfg) / VA_RATIO.manufacturing
    if (!comp) {
      go.all = (go.all ?? 0) + agrGo + minGo + mfgGo
      continue
    }
    const [fFood, fText, fChem, fMtrn, fOther] = comp
    go.food = (go.food ?? 0) + agrGo + mfgGo * fFood
    go.chem = (go.chem ?? 0) + mfgGo * fChem
    go.mtrn = (go.mtrn ?? 0) + mfgGo * fMtrn
    go.rest = (go.rest ?? 0) + minGo + mfgGo * (fText + fOther)
  }
  if (go.all && Object.keys(go).length > 1) throw new Error(`블록 ${b}: 묶음 방식이 섞였다`)
  setGo[b] = go
  vaGoods[b] = va
}
{
  // 나머지 세계 = 세계 − 6개 블록. 제조업 구성 자료가 없어 한 묶음
  const wGdp = W.gdpUsd.value
  const wv = (k: string) => ((prod.countries.WLD[k]?.value ?? 0) / 100) * wGdp
  const agr = wv('agriculturePct') - sum(BLOCS.flatMap((b) => members(b).map((m) => (m.iso === 'TWN' ? (manual.TWN.production.agriculturePct / 100) * gdpOf(m.iso) : (filled(b, m.iso, 'agriculturePct') / 100) * gdpOf(m.iso)))))
  const mfg = wv('manufacturingPct') - sum(BLOCS.flatMap((b) => members(b).map((m) => (m.iso === 'TWN' ? (manual.TWN.production.manufacturingPct / 100) * gdpOf(m.iso) : (filled(b, m.iso, 'manufacturingPct') / 100) * gdpOf(m.iso)))))
  const rentKeys = ['oilRentsPct', 'gasRentsPct', 'coalRentsPct', 'mineralRentsPct']
  const rents = sum(rentKeys.map(wv)) - sum(BLOCS.flatMap((b) => members(b).filter((m) => m.iso !== 'TWN').map((m) => (sum(rentKeys.map((k) => filled(b, m.iso, k))) / 100) * gdpOf(m.iso))))
  setGo.R = { all: bn(agr) / VA_RATIO.agriculture + bn(rents) / VA_RATIO.mining + bn(mfg) / VA_RATIO.manufacturing }
  vaGoods.R = agr + mfg + rents
}

// ── 교역 (국경 가격, USD 10억). flows[수출][수입][물품] ──
// 블록 간 교역은 나라 쌍 자료(pairFlows)를 다시 더한다. 홍콩·마카오가 신고한 수입은 뺀다: 대부분 중국으로 다시 나가는
// 중계 무역이고, 중국은 원산지 기준으로 같은 물건을 그 나라에서 들여온 수입으로 또 적는다 (이중 계산, 2023년 약 1,480억 달러)
const REEXPORT_HUBS = new Set([344, 446])
const blocOfCode = new Map<number, string>()
for (const b of BLOCS) for (const m of members(b) as (Member & { code: number })[]) blocOfCode.set(m.code, b)
const pairSum: Record<string, Record<string, Record<string, number>>> = {}
for (const f of trade.pairFlows) {
  const i = blocOfCode.get(f.from)
  const j = blocOfCode.get(f.to)
  if (!i || !j || i === j || REEXPORT_HUBS.has(f.to)) continue
  const cell = ((pairSum[i] ??= {})[j] ??= Object.fromEntries(GOODS.map((g) => [g, 0])))
  for (const g of GOODS) cell[g] += f.values[g] ?? 0
}
const flows: Record<string, Record<string, Record<string, number>>> = {}
for (const i of REGIONS) {
  flows[i] = {}
  for (const j of REGIONS) {
    if (i === j) continue
    const src = i === 'R' ? trade.rowFlows.fromRow[j] : j === 'R' ? trade.rowFlows.toRow[i] : pairSum[i]?.[j]
    flows[i][j] = Object.fromEntries(GOODS.map((g) => [g, (src?.[g] ?? 0) / 1000]))
  }
}
// 관세 tariff[수입][수출][물품]
const tariff: Record<string, Record<string, Record<string, number>>> = {}
for (const i of REGIONS) {
  tariff[i] = {}
  for (const j of REGIONS) {
    if (i === j) continue
    const src = i === 'R' ? tariffs.row.rowOnBloc[j] : j === 'R' ? tariffs.row.blocOnRow[i] : tariffs.bloc[i][j]
    tariff[i][j] = Object.fromEntries(Object.entries(src as Record<string, number>).map(([g, t]) => [g, round1pct(t)]))
  }
}
const EXPORT_TAX = [0, 0.25, 1.0]
const controls: { from: string; to: string; good: string; level: number }[] = tariffs.exportControls.map((c: any) => ({ from: c.from, to: c.to, good: c.good, level: c.level }))
const xtax = (from: string, to: string, g: string) => EXPORT_TAX[controls.find((c) => c.from === from && c.to === to && c.good === g)?.level ?? 0]

// 세계 교역 구성 (흡수 구성의 대리값)
const worldTrade = Object.fromEntries(GOODS.map((g) => [g, sum(REGIONS.flatMap((i) => REGIONS.filter((j) => j !== i).map((j) => flows[i][j][g])))]))

// ── 물품별 생산 ──
const production: Record<string, Record<string, number>> = {}
const domestic: Record<string, Record<string, number>> = {}
for (const r of REGIONS) {
  const exportsP = (g: string) => sum(REGIONS.filter((j) => j !== r).map((j) => flows[r][j][g] / (1 + xtax(r, j, g))))
  const imports = (g: string) => sum(REGIONS.filter((j) => j !== r).map((j) => flows[j][r][g]))
  production[r] = {}
  domestic[r] = {}
  const sets = setGo[r].all != null ? POOLED : SETS
  for (const [name, goods] of Object.entries(sets)) {
    const go = setGo[r][name]
    const X = sum(goods.map(exportsP))
    const M = sum(goods.map(imports))
    const absorb = go - X + M
    const wt = sum(goods.map((g) => worldTrade[g]))
    const raw = Object.fromEntries(goods.map((g) => [g, (worldTrade[g] / wt) * absorb - imports(g)]))
    const floor = Object.fromEntries(goods.map((g) => [g, (MIN_DOMESTIC_SHARE / (1 - MIN_DOMESTIC_SHARE)) * imports(g) + 1e-3 * (worldTrade[g] / wt) * Math.max(absorb, 0)]))
    const target = go - X
    const d: Record<string, number> = {}
    const floored = new Set(goods.filter((g) => raw[g] < floor[g]))
    for (const g of floored) d[g] = floor[g]
    const free = goods.filter((g) => !floored.has(g))
    const rest = target - sum([...floored].map((g) => d[g]))
    const freeRaw = sum(free.map((g) => raw[g] - floor[g]))
    if (free.length && rest > sum(free.map((g) => floor[g]))) {
      // 넘친 만큼을 바닥 위 여유분에 비례해 뺀다
      const slack = rest - sum(free.map((g) => floor[g]))
      for (const g of free) d[g] = floor[g] + ((raw[g] - floor[g]) / freeRaw) * slack
    } else {
      for (const g of free) d[g] = floor[g]
      const extra = sum(goods.map((g) => d[g])) - target
      note(`${r} ${name}: 수출 + 최소 국내 판매가 총산출보다 ${extra.toFixed(1)}(10억 달러) 많아 총산출을 늘림`)
    }
    if (floored.size) note(`${r} ${name}: 국내산 비중 최소 ${MIN_DOMESTIC_SHARE * 100}%로 맞춤 → ${[...floored].join(', ')}`)
    for (const g of goods) {
      domestic[r][g] = d[g]
      production[r][g] = d[g] + exportsP(g)
    }
  }
}

// ── 서비스·건설, 소득·지출·적자 ──
const regions: Record<string, any> = {}
for (const r of REGIONS) {
  const m = macroOf[r]
  const nontraded = bn(m.gdpUsd - vaGoods[r]) / VA_RATIO.services
  if (nontraded <= 0) throw new Error(`${r}: 서비스 총산출이 0 이하`)
  const importsB = sum(REGIONS.filter((j) => j !== r).flatMap((j) => GOODS.map((g) => flows[j][r][g])))
  const exportsB = sum(REGIONS.filter((j) => j !== r).flatMap((j) => GOODS.map((g) => flows[r][j][g])))
  const tariffRev = sum(REGIONS.filter((j) => j !== r).flatMap((j) => GOODS.map((g) => flows[j][r][g] * tariff[r][j][g])))
  const xtaxRev = sum(REGIONS.filter((j) => j !== r).flatMap((j) => GOODS.map((g) => (flows[r][j][g] * xtax(r, j, g)) / (1 + xtax(r, j, g)))))
  const income = sum(GOODS.map((g) => production[r][g])) + nontraded + tariffRev + xtaxRev
  const deficit = importsB - exportsB
  const expenditure = income + deficit
  const investment = m.investmentRate * expenditure
  const absorption = (g: string) => domestic[r][g] + sum(REGIONS.filter((j) => j !== r).map((j) => flows[j][r][g] * (1 + tariff[r][j][g])))
  const capitalGoods = sum(CAPITAL_GOODS.map(absorption))
  const construction = Math.max(investment - capitalGoods, MIN_CONSTRUCTION_SHARE * investment)
  // 투자 바구니에 들어가는 자본재 비율 (1보다 작으면 나머지는 소비)
  const toInvestment = Math.min(1, (investment - construction) / capitalGoods)
  if (toInvestment < 0.999) note(`${r}: 자본재 흡수의 ${(100 * (1 - toInvestment)).toFixed(0)}%를 소비 바구니로 (투자 ${investment.toFixed(0)} < 자본재 ${capitalGoods.toFixed(0)} + 건설 하한)`)
  if (construction >= nontraded) throw new Error(`${r}: 건설 ${construction.toFixed(0)} ≥ 서비스·건설 ${nontraded.toFixed(0)}`)
  const consumptionSpend: Record<string, number> = { services: nontraded - construction, construction: 0 }
  const investmentSpend: Record<string, number> = { services: 0, construction }
  for (const g of GOODS) {
    const a = absorption(g)
    const inv = CAPITAL_GOODS.includes(g) ? a * toInvestment : 0
    investmentSpend[g] = inv
    consumptionSpend[g] = a - inv
  }
  regions[r] = {
    population: m.population,
    labor: m.labor,
    gdpUsd: m.gdpUsd,
    investmentRate: m.investmentRate,
    production: { ...production[r], services: nontraded - construction, construction },
    consumptionSpend,
    investmentSpend,
    deficit,
    check: { income, expenditure, tariffRev, xtaxRev, importsB, exportsB, capitalGoods },
  }
}

const out = {
  meta: {
    year: 2023,
    unit: 'USD 10억 (교역·생산), 인구·노동은 사람 수, gdpUsd는 달러',
    built: new Date().toISOString().slice(0, 10),
    sources: 'data/v2/trade-2023.json, macro-2023.json, production-2023.json, manual-2023.json, tariffs.json',
    assumptions: {
      vaRatio: VA_RATIO,
      minDomesticShare: MIN_DOMESTIC_SHARE,
      absorptionMix: '묶음 안의 물품별 흡수 구성 = 세계 교역 구성',
      pooled: '대만·나머지 세계는 제조업 구성 자료가 없어 물품 전체를 한 묶음으로 나눔',
      deficit: '무역 수지는 고정 이전 (Dekle·Eaton·Kortum 2007)',
      reexportHubs: '홍콩·마카오가 신고한 수입은 블록 B 수입에서 뺌 (중국의 원산지 기준 수입과 이중 계산)',
      minConstructionShare: MIN_CONSTRUCTION_SHARE,
      exportTaxEquivalent: EXPORT_TAX,
    },
    log,
  },
  regions: REGIONS,
  goods: GOODS,
  capitalGoods: CAPITAL_GOODS,
  data: regions,
  flows,
  tariffs: tariff,
  exportControls: controls,
}
writeFileSync(resolve(ROOT, 'src/data/v2-base-2023.json'), JSON.stringify(out, null, 1))

// ── 확인용 출력 ──
const pct = (x: number) => (100 * x).toFixed(0).padStart(4)
console.log('지역   GDP($조)  인구(억)  투자율  교역재/서비스(10억$)  수입/지출  적자/지출')
for (const r of REGIONS) {
  const d = regions[r]
  const goodsGo = sum(GOODS.map((g) => d.production[g]))
  console.log(
    `${r}     ${(d.gdpUsd / 1e12).toFixed(2).padStart(6)}  ${(d.population / 1e8).toFixed(2).padStart(7)}  ${pct(d.investmentRate)}%  ${goodsGo.toFixed(0).padStart(7)} / ${(d.production.services + d.production.construction).toFixed(0).padStart(6)}   ${pct(d.check.importsB / d.check.expenditure)}%  ${pct(d.deficit / d.check.expenditure)}%`,
  )
}
console.log('\n국내산 비중 (국내 판매 ÷ 흡수, %)')
console.log('     ' + GOODS.map((g) => g.slice(0, 6).padStart(7)).join(''))
for (const r of REGIONS) {
  const imp = (g: string) => sum(REGIONS.filter((j) => j !== r).map((j) => flows[j][r][g]))
  console.log(`${r}    ` + GOODS.map((g) => pct(domestic[r][g] / (domestic[r][g] + imp(g))).padStart(7)).join(''))
}
console.log(`\n기록 ${log.length}건:\n  ` + log.join('\n  '))
console.log('\nsrc/data/v2-base-2023.json')
