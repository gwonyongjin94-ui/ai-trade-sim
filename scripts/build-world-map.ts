// 지도 화면이 읽는 전 세계 2023년 자료를 만든다. 내려받기는 하지 않는다.
//   npm run map:data
// 읽는 것 (모두 커밋하지 않는 원자료이거나, 앞 단계에서 줄인 결과):
//   data/raw/baci/BACI_HS22_Y2023_V202601.csv   CEPII BACI (HS 2022, 2023년). 한 줄 = 수출국·수입국·HS 6단위 품목 하나의 교역액(천 달러)
//   data/raw/baci/country_codes_V202601.csv     BACI 나라 코드 → ISO
//   data/world/wdi-2023.json                    World Bank 지표 (npm run world:wdi)
//   data/v2/macro-2023.json, manual-2023.json   대만·북한처럼 World Bank에 없는 값
//   data/raw/hofstede/…csv                      Hofstede 문화 지표
//   data/world/tariffs-bilateral.json           나라 쌍 적용 관세 (npm run world:tariffs, WITS)
// 쓰는 것:
//   src/web/data/world-2023.json                나라마다 거시 지표 + 수출입 총액·품목 구성 (화면에 같이 묶인다)
//   public/data/trade-2023/{ISO3}.json          나라마다 모든 교역 상대와 품목별 교역액 (고를 때 내려받는다)
//   public/data/tariffs/{ISO3}.json             나라마다 상대국에 매기는 관세와 받는 관세 (관세 화면에서 고를 때 내려받는다)
//   public/flags/{ISO2}.svg                     원형 배지에 쓰는 정사각형 국기 (country-flag-icons, MIT)
//
// BACI는 수출국 신고와 수입국 신고를 맞춰 한 값으로 만든 자료다(FOB). 그래서 A→B 수출과 B의 A로부터 수입은 같은 값이다.
// 교역액 단위는 백만 달러.

import { createReadStream, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, resolve } from 'node:path'
import { GOODS_V2, goodOfChapter } from './lib/hs'
import { KO_INCOME, KO_NAME, KO_REGION } from './lib/ko-names'

const ROOT = resolve(import.meta.dirname, '..')
const read = (f: string) => JSON.parse(readFileSync(resolve(ROOT, f), 'utf8'))
const BACI_DIR = resolve(ROOT, 'data/raw/baci')
const BACI_CSV = resolve(BACI_DIR, 'BACI_HS22_Y2023_V202601.csv')
const BACI_CODES = resolve(BACI_DIR, 'country_codes_V202601.csv')
const OUT_SUMMARY = resolve(ROOT, 'src/web/data/world-2023.json')
const OUT_TRADE = resolve(ROOT, 'public/data/trade-2023')
const OUT_TARIFF = resolve(ROOT, 'public/data/tariffs')
const OUT_FLAGS = resolve(ROOT, 'public/flags')
const FLAG_SRC = resolve(ROOT, 'node_modules/country-flag-icons/1x1')
const YEAR = 2023
const G = GOODS_V2.length

const SRC = {
  wdi: 'World Bank WDI',
  imf: 'IMF WEO',
  bok: '한국은행 추정',
  dgbas: '대만 통계청(DGBAS)',
  cbc: '대만 중앙은행',
  baci: 'CEPII BACI',
  hofstede: 'Hofstede (2015)',
}

type Val = { value: number; year: number; source: string } | null
const r2 = (v: number) => Math.round(v * 100) / 100

// ---- 나라 코드. world-atlas 지도는 ISO 숫자 코드를 쓴다
const iso = (await import('i18n-iso-countries')).default
const atlas = read('node_modules/world-atlas/countries-50m.json') as { objects: { countries: { geometries: { id?: string; properties: { name: string } }[] } } }
const atlasIds = new Set(atlas.objects.countries.geometries.map((g) => g.id).filter(Boolean))
function mapIdOf(iso3: string): string | null {
  if (iso3 === 'XKX') return 'XKX' // 코소보는 지도에 숫자 코드가 없다. geo.ts가 이름으로 이 코드를 붙인다
  const n = iso.alpha3ToNumeric(iso3)
  return n && atlasIds.has(n) ? n : null
}

// ---- BACI 나라 코드 (BACI 코드 → ISO 3자리)
const baciIso = new Map<number, string>()
const baciName = new Map<string, string>()
{
  const lines = readFileSync(BACI_CODES, 'utf8').trim().split(/\r?\n/)
  const head = splitCsv(lines[0])
  const ci = head.indexOf('country_code')
  const ni = head.indexOf('country_name')
  const i3 = head.indexOf('country_iso3')
  for (const line of lines.slice(1)) {
    const cells = splitCsv(line)
    const code = Number(cells[ci])
    // BACI는 대만을 "Other Asia, nes"(490, S19)로 싣는다. 그 밖에 ISO 코드가 없는 묶음(EFTA nes 등)은 뺀다
    const a3 = code === 490 ? 'TWN' : cells[i3]
    if (!a3 || (a3 !== 'TWN' && !iso.alpha3ToNumeric(a3))) continue
    baciIso.set(code, a3)
    baciName.set(a3, cells[ni])
  }
}

// ---- BACI 합치기: (수출국, 수입국) 짝마다 품목 10개
const pair = new Map<number, Float64Array>()
const GOOD_INDEX = Object.fromEntries(GOODS_V2.map((g, i) => [g, i])) as Record<string, number>
const SEMI = GOOD_INDEX.semiconductors
let rows = 0
let worldTotal = 0
let dropped = 0
const unknownCodes = new Set<number>()
{
  const rl = createInterface({ input: createReadStream(BACI_CSV), crlfDelay: Infinity })
  let header = true
  let col = { t: 0, i: 1, j: 2, k: 3, v: 4 }
  for await (const line of rl) {
    if (header) {
      const h = line.split(',').map((s) => s.trim().replace(/"/g, ''))
      col = { t: h.indexOf('t'), i: h.indexOf('i'), j: h.indexOf('j'), k: h.indexOf('k'), v: h.indexOf('v') }
      header = false
      continue
    }
    const c = line.split(',')
    if (Number(c[col.t]) !== YEAR) continue
    const i = Number(c[col.i])
    const j = Number(c[col.j])
    const v = Number(c[col.v]) / 1000 // 천 달러 → 백만 달러
    if (!Number.isFinite(v) || v <= 0) continue
    const k = c[col.k].replace(/"/g, '').trim().padStart(6, '0')
    const g = k.startsWith('8542') ? SEMI : GOOD_INDEX[goodOfChapter(Number(k.slice(0, 2)))]
    const key = i * 1000 + j
    let cell = pair.get(key)
    if (!cell) pair.set(key, (cell = new Float64Array(G)))
    cell[g] += v
    rows++
    worldTotal += v
    if (!baciIso.has(i) || !baciIso.has(j)) {
      dropped += v
      if (!baciIso.has(i)) unknownCodes.add(i)
      if (!baciIso.has(j)) unknownCodes.add(j)
    }
  }
}
if (rows === 0) throw new Error(`BACI ${YEAR}년 줄이 없다: ${BACI_CSV}`)
console.log(`BACI ${rows.toLocaleString()}줄, 나라 짝 ${pair.size.toLocaleString()}개, 세계 교역 ${(worldTotal / 1e6).toFixed(2)}조 달러`)
if (unknownCodes.size)
  console.warn(`  ISO 코드가 없는 BACI 코드 (뺀다): ${[...unknownCodes].join(', ')} — 세계 교역의 ${((dropped / worldTotal) * 100).toFixed(3)}%`)

// 나라별로 모으기
type Partner = [string, number, ...number[]]
const exp = new Map<string, Partner[]>()
const imp = new Map<string, Partner[]>()
const expMix = new Map<string, number[]>()
const impMix = new Map<string, number[]>()
const addMix = (m: Map<string, number[]>, k: string, cell: Float64Array) => {
  const a = m.get(k) ?? new Array(G).fill(0)
  for (let g = 0; g < G; g++) a[g] += cell[g]
  m.set(k, a)
}
for (const [key, cell] of pair) {
  const a = baciIso.get(Math.floor(key / 1000))
  const b = baciIso.get(key % 1000)
  if (!a || !b || a === b) continue
  const total = cell.reduce((s, v) => s + v, 0)
  const row = (p: string): Partner => [p, r2(total), ...Array.from(cell, r2)]
  if (total >= 0.005) {
    ;(exp.get(a) ?? exp.set(a, []).get(a)!).push(row(b))
    ;(imp.get(b) ?? imp.set(b, []).get(b)!).push(row(a))
  }
  addMix(expMix, a, cell)
  addMix(impMix, b, cell)
}

// ---- World Bank + 대만·북한 보충
const wdi = read('data/world/wdi-2023.json').countries as Record<
  string,
  { iso2: string; nameEn: string; region: string; income: string; values: Record<string, { value: number; year: number } | null> }
>
const macro = read('data/v2/macro-2023.json')
const manual = read('data/v2/manual-2023.json')
const wv = (iso3: string, key: string, source = SRC.wdi): Val => {
  const v = wdi[iso3]?.values[key]
  return v && Number.isFinite(v.value) ? { value: v.value, year: v.year, source } : null
}

// ---- Hofstede. 나라 값이 없으면 같은 묶음(아랍 국가·동아프리카·서아프리카) 값을 빌려 쓰고 그 사실을 적는다
const HOF_KEYS = ['pdi', 'idv', 'mas', 'uai', 'lto', 'ivr'] as const
const hofRows = new Map<string, (number | null)[]>()
for (const line of readFileSync(resolve(ROOT, 'data/raw/hofstede/6-dimensions-for-website-2015-08-16.csv'), 'utf8').split('\n').slice(1)) {
  const cells = line.trim().split(';')
  if (cells.length < 8) continue
  hofRows.set(cells[0], cells.slice(2, 8).map((c) => (c === '#NULL!' ? null : Number(c))))
}
// Hofstede 코드는 ISO와 다르다 (예: CHI = 중국, MNG = 몬테네그로, MAC = 마케도니아)
const HOF_CODE: Record<string, string> = {
  ALB: 'ALB', DZA: 'ALG', AND: 'AND', ARG: 'ARG', ARM: 'ARM', AUS: 'AUL', AUT: 'AUT', AZE: 'AZE', BGD: 'BAN', BLR: 'BLR', BEL: 'BEL',
  BIH: 'BOS', BRA: 'BRA', BGR: 'BUL', BFA: 'BUF', CAN: 'CAN', CHL: 'CHL', CHN: 'CHI', COL: 'COL', CRI: 'COS', HRV: 'CRO', CYP: 'CYP',
  CZE: 'CZE', DNK: 'DEN', DOM: 'DOM', ECU: 'ECA', EGY: 'EGY', ETH: 'ETH', SLV: 'SAL', EST: 'EST', FIN: 'FIN', FRA: 'FRA', GEO: 'GEO',
  DEU: 'GER', GHA: 'GHA', GBR: 'GBR', GRC: 'GRE', GTM: 'GUA', HKG: 'HOK', HUN: 'HUN', ISL: 'ICE', IND: 'IND', IDN: 'IDO', IRN: 'IRA',
  IRQ: 'IRQ', IRL: 'IRE', ISR: 'ISR', ITA: 'ITA', JAM: 'JAM', JPN: 'JPN', JOR: 'JOR', KOR: 'KOR', KGZ: 'KYR', LVA: 'LAT', LTU: 'LIT',
  LUX: 'LUX', MKD: 'MAC', MYS: 'MAL', MLI: 'MLI', MLT: 'MLT', MEX: 'MEX', MDA: 'MOL', MNE: 'MNG', MAR: 'MOR', NLD: 'NET', NZL: 'NZL',
  NGA: 'NIG', NOR: 'NOR', PAK: 'PAK', PAN: 'PAN', PER: 'PER', PHL: 'PHI', POL: 'POL', PRT: 'POR', PRI: 'PUE', ROU: 'ROM', RUS: 'RUS',
  RWA: 'RWA', SAU: 'SAU', SRB: 'SER', SGP: 'SIN', SVK: 'SLK', SVN: 'SLV', ZAF: 'SAF', ESP: 'SPA', SUR: 'SUR', SWE: 'SWE', CHE: 'SWI',
  TWN: 'TAI', TZA: 'TAN', THA: 'THA', TTO: 'TRI', TUR: 'TUR', USA: 'USA', UGA: 'UGA', UKR: 'UKR', URY: 'URU', VEN: 'VEN', VNM: 'VIE',
  ZMB: 'ZAM', ZWE: 'ZIM',
}
// 묶음 값을 빌려 쓰는 나라. Hofstede가 묶음을 만들 때 넣은 나라와 같은 지역의 이웃
const HOF_GROUP: Record<string, { code: string; name: string }> = {
  ...Object.fromEntries(
    ['SAU', 'ARE', 'QAT', 'KWT', 'OMN', 'BHR', 'IRQ', 'JOR', 'LBN', 'SYR', 'YEM', 'LBY', 'EGY'].map((k) => [k, { code: 'ARA', name: '아랍 국가' }]),
  ),
  KEN: { code: 'AFE', name: '동아프리카' },
  SLE: { code: 'AFW', name: '서아프리카' },
}
function hofstede(iso3: string) {
  const own = HOF_CODE[iso3] ? hofRows.get(HOF_CODE[iso3]) : undefined
  const group = HOF_GROUP[iso3]
  const groupRow = group ? hofRows.get(group.code) : undefined
  const values: Record<string, number | null> = {}
  let borrowed = 0
  HOF_KEYS.forEach((k, i) => {
    let v = own?.[i] ?? null
    if (v === null && groupRow?.[i] != null) { v = groupRow[i]; borrowed++ }
    values[k] = v
  })
  if (HOF_KEYS.every((k) => values[k] === null)) return null
  const note = !borrowed ? undefined
    : borrowed === HOF_KEYS.length ? `나라 값이 없어 ${group!.name} 묶음 값`
    : `${borrowed}개 지표는 나라 값이 없어 ${group!.name} 묶음 값`
  return { values, note, source: SRC.hofstede }
}

// ---- 나라 목록: BACI 또는 World Bank에 있는 곳. 지도 모양이 없어도 교역 상대로는 나온다
const isoList = [...new Set([...baciIso.values(), ...Object.keys(wdi)])].filter((k) => k !== 'CHI' || wdi[k]).sort()
const flagFiles = new Set<string>()
rmSync(OUT_FLAGS, { recursive: true, force: true })
mkdirSync(OUT_FLAGS, { recursive: true })

// BACI가 다른 나라 교역에 합쳐 싣는 곳 (BACI 842 미국 = 푸에르토리코·미국령 버진아일랜드 포함, 757 스위스 = 리히텐슈타인 포함, 251 프랑스 = 모나코 포함)
const INCLUDED_IN: Record<string, string> = { PRI: 'USA', VIR: 'USA', LIE: 'CHE', MCO: 'FRA' }

const countries: Record<string, unknown> = {}
const missingName: string[] = []
for (const k of isoList) {
  const w = wdi[k]
  const iso2 = (w?.iso2 && w.iso2.length === 2 ? w.iso2 : iso.alpha3ToAlpha2(k)) ?? null
  const twn = k === 'TWN'
  if (!KO_NAME[k]) missingName.push(`${k} ${baciName.get(k) ?? w?.nameEn}`)

  const gdp: Val = k === 'PRK'
    ? { value: manual.PRK.gdpUsdApprox, year: YEAR, source: SRC.bok }
    : twn ? { value: macro.countries.TWN.gdpUsd.value, year: YEAR, source: SRC.imf } : wv(k, 'gdpUsd')
  const population: Val = twn ? { value: macro.countries.TWN.population.value, year: YEAR, source: SRC.imf } : wv(k, 'population')
  const structure = twn
    ? {
        agriculturePct: { value: manual.TWN.production.agriculturePct, year: YEAR, source: SRC.dgbas },
        industryPct: { value: 38.58, year: YEAR, source: SRC.dgbas },
        manufacturingPct: { value: manual.TWN.production.manufacturingPct, year: YEAR, source: 'Statista (DGBAS 기반)' },
        servicesPct: { value: 59.91, year: YEAR, source: SRC.dgbas },
        resourceRentsPct: { value: 0, year: YEAR, source: SRC.dgbas },
      }
    : (() => {
        const s = {
          agriculturePct: wv(k, 'agriculturePct'),
          industryPct: wv(k, 'industryPct'),
          manufacturingPct: wv(k, 'manufacturingPct'),
          servicesPct: wv(k, 'servicesPct'),
          resourceRentsPct: wv(k, 'resourceRentsPct'),
        }
        return Object.values(s).some(Boolean) ? s : null
      })()

  const em = expMix.get(k)
  const im = impMix.get(k)
  const sum = (a?: number[]) => (a ? a.reduce((s, v) => s + v, 0) : 0)
  const baciVal = (a?: number[]): Val => (a && sum(a) > 0 ? { value: Math.round(sum(a) * 1e6), year: YEAR, source: SRC.baci } : null)

  if (iso2 && existsSync(resolve(FLAG_SRC, `${iso2}.svg`))) {
    copyFileSync(resolve(FLAG_SRC, `${iso2}.svg`), resolve(OUT_FLAGS, `${iso2}.svg`))
    flagFiles.add(iso2)
  }

  countries[k] = {
    iso: k,
    iso2,
    flag: iso2 !== null && flagFiles.has(iso2),
    mapId: mapIdOf(k),
    name: KO_NAME[k] ?? baciName.get(k) ?? w?.nameEn ?? k,
    region: w ? KO_REGION[w.region] ?? null : twn ? KO_REGION.EAS : null,
    income: w ? KO_INCOME[w.income] ?? null : null,
    gdp,
    population,
    gdpPerCapita: gdp && population ? { value: gdp.value / population.value, year: Math.max(gdp.year, population.year), source: gdp.source } : null,
    laborForce: twn ? { value: manual.TWN.laborForce, year: YEAR, source: SRC.dgbas } : wv(k, 'laborForce'),
    investmentPct: twn ? { value: manual.TWN.grossCapitalFormationPctGdp, year: YEAR, source: SRC.cbc } : wv(k, 'investmentPct'),
    exportsPct: wv(k, 'exportsPct'),
    importsPct: wv(k, 'importsPct'),
    merchExports: baciVal(em),
    merchImports: baciVal(im),
    expMix: em ? em.map(r2) : null,
    impMix: im ? im.map(r2) : null,
    partnerCount: { export: exp.get(k)?.length ?? 0, import: imp.get(k)?.length ?? 0 },
    tradeIn: INCLUDED_IN[k] ?? null,
    structure,
    culture: hofstede(k),
    // 적용 관세 (수입액 가중 평균, 대세계). 대만은 World Bank 자료에 없다
    tariff: { all: wv(k, 'tariffAllPct'), manuf: wv(k, 'tariffManufPct'), primary: wv(k, 'tariffPrimaryPct') },
  }
}
if (missingName.length) console.warn(`  한국어 이름이 없어 영어 이름을 쓴 곳: ${missingName.join(' | ')}`)

// ---- 나라별 교역 상대 파일
rmSync(OUT_TRADE, { recursive: true, force: true })
mkdirSync(OUT_TRADE, { recursive: true })
let bytes = 0
for (const k of isoList) {
  const byTotal = (a: Partner, b: Partner) => b[1] - a[1]
  const body = JSON.stringify({ export: (exp.get(k) ?? []).sort(byTotal), import: (imp.get(k) ?? []).sort(byTotal) })
  writeFileSync(resolve(OUT_TRADE, `${k}.json`), body)
  bytes += body.length
}

// ── 나라 쌍 관세 (WITS): 나라마다 매기는 관세(imposed)와 받는 관세(faced, 각 수입국의 신고와 그 연도)
type BRow = (number | null)[]
const bil = read('data/world/tariffs-bilateral.json') as {
  meta: { note: string }
  reporters: Record<string, { year: number; world: BRow; partners: Record<string, BRow> }>
}
const faced = new Map<string, (string | number | null)[][]>()
for (const [rep, r] of Object.entries(bil.reporters))
  for (const [par, row] of Object.entries(r.partners)) {
    if (!faced.has(par)) faced.set(par, [])
    faced.get(par)!.push([rep, ...row, r.year])
  }
rmSync(OUT_TARIFF, { recursive: true, force: true })
mkdirSync(OUT_TARIFF, { recursive: true })
let tariffBytes = 0
const byImport = (a: (string | number | null)[], b: (string | number | null)[]) => ((b[4] as number) ?? 0) - ((a[4] as number) ?? 0)
for (const k of isoList) {
  const r = bil.reporters[k]
  const body = JSON.stringify({
    year: r?.year ?? null,
    world: r?.world ?? null,
    imposed: r ? Object.entries(r.partners).map(([p, row]) => [p, ...row]).sort(byImport) : [],
    faced: (faced.get(k) ?? []).sort(byImport),
  })
  writeFileSync(resolve(OUT_TARIFF, `${k}.json`), body)
  tariffBytes += body.length
}
const pairTariffs = { note: bil.meta.note, reporters: Object.fromEntries(Object.entries(bil.reporters).map(([k, r]) => [k, r.year])) }

const GOOD_NAME: Record<string, string> = {
  food: '식품', energy: '에너지', medicine: '의약품', apparel_household: '의류·생활용품', chemicals: '화학·플라스틱',
  vehicles: '자동차·운송장비', metals: '금속·광물', machinery: '기계', semiconductors: '반도체', electronics: '전자·정밀기기',
}

const out = {
  meta: {
    year: YEAR,
    built: new Date().toISOString().slice(0, 10),
    flowUnit: 'USD million',
    flowNote: '상품 교역(HS 2022 6단위를 10개 품목으로 묶음). CEPII BACI는 수출국과 수입국의 신고를 맞춰 한 값으로 만든 자료라, A의 B로 수출과 B의 A로부터 수입이 같다(본선인도 FOB 기준)',
    goods: GOODS_V2.map((id) => ({ id, name: GOOD_NAME[id] })),
    sources: [
      { id: 'baci', name: 'CEPII BACI (HS22, V202601)', detail: '나라 사이 상품 교역, 2023년. Etalab Open License 2.0', link: 'https://www.cepii.fr/CEPII/en/bdd_modele/bdd_modele_item.asp?id=37' },
      { id: 'wdi', name: SRC.wdi, detail: '인구·노동력·GDP·투자율·수출입 비중·산업 구성·적용 관세(수입액 가중 평균, WITS 계산). 최신 값(2015–2023)', link: 'https://data.worldbank.org' },
      { id: 'imf', name: SRC.imf, detail: '대만 GDP·인구', link: 'https://www.imf.org/external/datamapper' },
      { id: 'bok', name: SRC.bok, detail: '북한 GDP (2023년 명목 GNI 44.4조 원을 원/달러 1,305.4원으로 환산)', link: 'https://www.bok.or.kr' },
      { id: 'dgbas', name: '대만 통계청·중앙은행', detail: '대만 노동력·산업 구성·투자율' },
      { id: 'wits', name: 'World Bank WITS TradeStats-Tariff', detail: '나라 쌍 적용 관세(수입액 가중 평균, UNCTAD TRAINS 바탕). 대부분 2022년', link: 'https://wits.worldbank.org' },
      { id: 'hofstede', name: SRC.hofstede, detail: '문화 6개 지표 (Cultures and Organizations 3판, 2015년판 자료)', link: 'https://geerthofstede.com/research-and-vsm/dimension-data-matrix/' },
    ],
    pairTariffs,
  },
  countries,
}

mkdirSync(dirname(OUT_SUMMARY), { recursive: true })
writeFileSync(OUT_SUMMARY, JSON.stringify(out))
const onMap = Object.values(countries).filter((c) => (c as { mapId: string | null }).mapId).length
console.log(
  `나라 ${isoList.length}곳 (지도에 모양이 있는 곳 ${onMap}), 국기 ${flagFiles.size}개, ` +
    `교역 상대 파일 ${isoList.length}개 ${(bytes / 1e6).toFixed(1)}MB, 관세 파일 ${(tariffBytes / 1e6).toFixed(1)}MB (수입국 ${Object.keys(bil.reporters).length}곳) → ${OUT_SUMMARY}`,
)

function splitCsv(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (const ch of line) {
    if (ch === '"') q = !q
    else if (ch === ',' && !q) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}
