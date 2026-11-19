// 지도 화면이 읽는 나라별 2023년 자료를 만든다. 내려받기는 하지 않는다
// (data/v2/*.json, Hofstede 원자료, fetch-v2-data.ts가 받아 둔 Comtrade 캐시 data/raw/만 읽는다).
//   npm run map:data
// 결과: src/web/data/map-2023.json
//
// 엔진용 v2-base-2023.json과 달리 보정(캘리브레이션)하지 않은 실측값을 나라 단위로 그대로 싣는다.
// 값마다 연도와 출처를 붙인다. 화면은 출처를 항상 함께 보여 준다.
// 튀르키예·이집트는 블록에 넣지 않았으므로(optional) 뺀다.
// 엔진은 같은 블록 안의 교역(미국↔캐나다·멕시코, 중국↔홍콩 등)을 국내로 보아 trade-2023.json에 싣지 않았다.
// 지도에서는 빠지면 안 되므로, fetch-v2-data.ts가 나머지 세계 계산용으로 받아 둔 같은 블록 조회 캐시에서 되살린다.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { goodOfChapter, type GoodV2 } from './lib/hs'

const ROOT = resolve(import.meta.dirname, '..')
const read = (f: string) => JSON.parse(readFileSync(resolve(ROOT, f), 'utf8'))
const trade = read('data/v2/trade-2023.json')
const macro = read('data/v2/macro-2023.json')
const prod = read('data/v2/production-2023.json')
const manual = read('data/v2/manual-2023.json')
const OUT = resolve(ROOT, 'src/web/data/map-2023.json')

const SRC = {
  wdi: 'World Bank WDI',
  imf: 'IMF WEO',
  bok: '한국은행 추정',
  dgbas: '대만 통계청(DGBAS)',
  cbc: '대만 중앙은행',
  comtradeImp: 'UN Comtrade (수입국 보고)',
  comtradeExp: 'UN Comtrade (수출국 보고, 거울 자료)',
  hofstede: 'Hofstede (2015)',
}

// 지도(world-atlas)는 ISO 숫자 코드, 무역 자료는 Comtrade 코드를 쓴다. 둘은 미국(840/842)과 대만(158/490)만 다르다.
const ISO2: Record<string, string> = {
  KOR: 'KR', CHN: 'CN', PRK: 'KP', HKG: 'HK', MAC: 'MO', JPN: 'JP',
  SAU: 'SA', ARE: 'AE', QAT: 'QA', KWT: 'KW', OMN: 'OM', BHR: 'BH', IRN: 'IR', IRQ: 'IQ',
  ISR: 'IL', JOR: 'JO', LBN: 'LB', SYR: 'SY', YEM: 'YE',
  USA: 'US', CAN: 'CA', MEX: 'MX', TWN: 'TW',
}
const MAP_ID: Record<string, string> = { USA: '840', TWN: '158' }

type Val = { value: number; year: number; source: string } | null

const members: { code: number; iso: string; name: string; optional?: boolean }[] = []
const blocs: Record<string, { name: string; members: string[] }> = {}
for (const [id, b] of Object.entries<{ name: string; members: typeof members }>(trade.meta.blocs)) {
  const kept = b.members.filter((m) => !m.optional)
  blocs[id] = { name: b.name, members: kept.map((m) => m.iso) }
  members.push(...kept)
}
const isoByComtrade = new Map(members.map((m) => [m.code, m.iso]))

function wdi(v: { value: number; year: number } | null, source = SRC.wdi): Val {
  return v && Number.isFinite(v.value) ? { value: v.value, year: v.year, source } : null
}

// ---- Hofstede: 나라 값이 있으면 그 값, 아랍 나라는 앞 네 지표가 없어 '아랍 국가' 묶음 값을 쓴다
const HOF_KEYS = ['pdi', 'idv', 'mas', 'uai', 'lto', 'ivr'] as const
const hofRows = new Map<string, (number | null)[]>()
for (const line of readFileSync(resolve(ROOT, 'data/raw/hofstede/6-dimensions-for-website-2015-08-16.csv'), 'utf8').split('\n').slice(1)) {
  const cells = line.trim().split(';')
  if (cells.length < 8) continue
  hofRows.set(cells[0], cells.slice(2, 8).map((c) => (c === '#NULL!' ? null : Number(c))))
}
const HOF_CODE: Record<string, string> = {
  KOR: 'KOR', CHN: 'CHI', HKG: 'HOK', JPN: 'JPN', IRN: 'IRA', ISR: 'ISR', USA: 'USA', CAN: 'CAN', MEX: 'MEX', TWN: 'TAI',
  SAU: 'SAU', IRQ: 'IRQ', JOR: 'JOR',
}
const ARAB = new Set(['SAU', 'ARE', 'QAT', 'KWT', 'OMN', 'BHR', 'IRQ', 'JOR', 'LBN', 'SYR', 'YEM'])
function hofstede(iso: string) {
  const own = HOF_CODE[iso] ? hofRows.get(HOF_CODE[iso]) : undefined
  const arab = hofRows.get('ARA')!
  const values: Record<string, number | null> = {}
  const borrowed: string[] = []
  HOF_KEYS.forEach((k, i) => {
    let v = own?.[i] ?? null
    if (v === null && ARAB.has(iso)) { v = arab[i]; borrowed.push(k) }
    values[k] = v
  })
  if (HOF_KEYS.every((k) => values[k] === null)) return null
  const note = borrowed.length === HOF_KEYS.length ? '나라 값이 없어 아랍 국가 묶음 값'
    : borrowed.length ? `${borrowed.length}개 지표는 나라 값이 없어 아랍 국가 묶음 값` : undefined
  return { values, note, source: SRC.hofstede }
}

// ---- 나라
const countries: Record<string, unknown> = {}
for (const m of members) {
  const iso = m.iso
  const mc = macro.countries[iso]
  const pc = prod.countries[iso]
  if (!mc) throw new Error(`macro 자료 없음: ${iso}`)
  const twn = iso === 'TWN'
  const gdp: Val = iso === 'PRK'
    ? { value: manual.PRK.gdpUsdApprox, year: 2023, source: SRC.bok }
    : wdi(mc.gdpUsd, twn ? SRC.imf : SRC.wdi)
  const population = wdi(mc.population, twn ? SRC.imf : SRC.wdi)
  const laborForce = twn ? { value: manual.TWN.laborForce, year: 2023, source: SRC.dgbas } : wdi(mc.laborForce)
  const investmentPct = twn
    ? { value: manual.TWN.grossCapitalFormationPctGdp, year: 2023, source: SRC.cbc }
    : wdi(mc.grossCapitalFormationPctGdp)
  const structure = twn
    ? {
        agriculturePct: { value: manual.TWN.production.agriculturePct, year: 2023, source: SRC.dgbas },
        industryPct: { value: 38.58, year: 2023, source: SRC.dgbas },
        manufacturingPct: { value: manual.TWN.production.manufacturingPct, year: 2023, source: "Statista (DGBAS 기반)" },
        servicesPct: { value: 59.91, year: 2023, source: SRC.dgbas },
        resourceRentsPct: { value: 0, year: 2023, source: SRC.dgbas },
      }
    : pc
      ? {
          agriculturePct: wdi(pc.agriculturePct),
          industryPct: wdi(pc.industryPct),
          manufacturingPct: wdi(pc.manufacturingPct),
          servicesPct: wdi(pc.servicesPct),
          resourceRentsPct: rents(pc),
        }
      : null
  countries[iso] = {
    iso,
    iso2: ISO2[iso],
    mapId: MAP_ID[iso] ?? String(m.code).padStart(3, '0'),
    name: m.name,
    bloc: mc.bloc,
    gdp,
    population,
    gdpPerCapita: gdp && population ? { value: gdp.value / population.value, year: Math.max(gdp.year, population.year), source: gdp.source } : null,
    laborForce,
    investmentPct,
    exportsPct: wdi(mc.exportsPctGdp),
    importsPct: wdi(mc.importsPctGdp),
    merchExports: wdi(mc.merchExportsUsd),
    merchImports: wdi(mc.merchImportsUsd),
    structure,
    culture: hofstede(iso),
  }
}

function rents(pc: Record<string, { value: number; year: number } | null>): Val {
  const parts = ['oilRentsPct', 'gasRentsPct', 'coalRentsPct', 'mineralRentsPct'].map((k) => pc[k]).filter((v) => v !== null)
  if (!parts.length) return null
  return { value: parts.reduce((s, v) => s + v!.value, 0), year: Math.max(...parts.map((v) => v!.year)), source: SRC.wdi }
}

// ---- 나라 사이 교역 (백만 달러). 자료가 없는 짝(중동 나라끼리 등)은 뺀다
const flows = []
for (const p of trade.pairFlows as { from: number; to: number; source: string; values: Record<string, number> }[]) {
  if (p.source === 'none') continue
  const from = isoByComtrade.get(p.from)
  const to = isoByComtrade.get(p.to)
  if (!from || !to) continue
  const values = Object.fromEntries(Object.entries(p.values).map(([k, v]) => [k, Math.round(v * 10) / 10]))
  const total = Math.round(Object.values(p.values).reduce((s, v) => s + v, 0) * 10) / 10
  flows.push({ from, to, total, values, source: p.source === 'importer' ? SRC.comtradeImp : SRC.comtradeExp })
}

// ---- 같은 블록 안 교역 (Comtrade 캐시). 조회 주소를 fetch-v2-data.ts와 똑같이 만들어 캐시 파일 이름을 찾는다
const COMTRADE = 'https://comtradeapi.un.org/public/v1/preview/C/A/HS'
const REPORTERS = [410, 156, 392, 842, 124, 484, 490]
type Row = { partnerCode: number; cmdCode: string; primaryValue: number; customsCode: string; motCode: number; partner2Code: number }
function cachedComtrade(reporter: number, flow: 'M' | 'X', partners: number[], cmd: string): Row[] {
  const q = new URLSearchParams({ reporterCode: String(reporter), period: '2023', flowCode: flow, partnerCode: partners.join(','), cmdCode: cmd })
  const url = `${COMTRADE}?${q}`
  const file = resolve(ROOT, 'data/raw', createHash('sha1').update(url).digest('hex').slice(0, 16) + '.json')
  if (!existsSync(file)) throw new Error(`Comtrade 캐시가 없다 (npm run data:v2가 받는다): ${url}`)
  const data: Row[] = JSON.parse(readFileSync(file, 'utf8')).data ?? []
  if (data.length >= 500) throw new Error(`행 상한(500)에 걸린 캐시: ${url}`)
  return data.filter((r) => r.customsCode === 'C00' && r.motCode === 0 && r.partner2Code === 0)
}
const allMembers = Object.entries<{ members: { code: number; optional?: boolean }[] }>(trade.meta.blocs).flatMap(([bloc, b]) =>
  b.members.map((m) => ({ ...m, bloc })),
)
const intra: Record<'M' | 'X', Map<string, Partial<Record<GoodV2, number>>>> = { M: new Map(), X: new Map() }
const addIntra = (flow: 'M' | 'X', rep: number, par: number, good: GoodV2, v: number) => {
  const key = `${rep}>${par}`
  const t = intra[flow].get(key) ?? {}
  t[good] = (t[good] ?? 0) + v / 1e6
  intra[flow].set(key, t)
}
for (const rep of REPORTERS) {
  const own = allMembers.find((m) => m.code === rep)!.bloc
  const same = allMembers.filter((m) => m.bloc === own && m.code !== rep).map((m) => m.code)
  if (!same.length) continue
  for (const flow of ['M', 'X'] as const) {
    for (const r of cachedComtrade(rep, flow, same, 'AG2')) addIntra(flow, rep, r.partnerCode, goodOfChapter(Number(r.cmdCode)), r.primaryValue)
    for (const r of cachedComtrade(rep, flow, same, '8542')) {
      addIntra(flow, rep, r.partnerCode, 'semiconductors', r.primaryValue)
      addIntra(flow, rep, r.partnerCode, 'electronics', -r.primaryValue)
    }
  }
}
let intraCount = 0
for (const e of members)
  for (const m of members) {
    if (e.code === m.code || allMembers.find((x) => x.code === e.code)!.bloc !== allMembers.find((x) => x.code === m.code)!.bloc) continue
    const imp = intra.M.get(`${m.code}>${e.code}`)
    const exp = intra.X.get(`${e.code}>${m.code}`)
    const v = imp ?? exp
    if (!v) continue
    const values = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Math.round(x * 10) / 10]))
    const total = Math.round(Object.values(v).reduce((s, x) => s + x, 0) * 10) / 10
    flows.push({ from: e.iso, to: m.iso, total, values, source: imp ? SRC.comtradeImp : SRC.comtradeExp })
    intraCount++
  }

const GOOD_NAME: Record<string, string> = {
  food: '식품', energy: '에너지', medicine: '의약품', apparel_household: '의류·생활용품', chemicals: '화학·플라스틱',
  vehicles: '자동차·운송장비', metals: '금속·광물', machinery: '기계', semiconductors: '반도체', electronics: '전자·정밀기기',
}

const out = {
  meta: {
    year: 2023,
    built: new Date().toISOString().slice(0, 10),
    flowUnit: 'USD million',
    flowNote: '상품 교역(HS 기준). 수입국이 보고한 값을 우선 쓰고, 없으면 수출국이 보고한 값을 쓴다. 보고국은 한국·중국·일본·미국·캐나다·멕시코·대만 7곳이라, 이 중 어느 나라도 끼지 않은 교역(중동 나라끼리, 홍콩↔마카오 등)은 자료가 없다',
    goods: (trade.meta.goods as string[]).map((id) => ({ id, name: GOOD_NAME[id] })),
    sources: [
      { id: 'wdi', name: SRC.wdi, detail: '인구·노동력·GDP·투자율·수출입 비중·산업 구성. 최신 값(2015–2023)', link: 'https://data.worldbank.org' },
      { id: 'comtrade', name: 'UN Comtrade', detail: '나라 사이 상품 교역, 2023년', link: 'https://comtradeplus.un.org' },
      { id: 'imf', name: SRC.imf, detail: '대만 GDP·인구', link: 'https://www.imf.org/external/datamapper' },
      { id: 'bok', name: SRC.bok, detail: '북한 GDP (2023년 명목 GNI 44.4조 원을 원/달러 1,305.4원으로 환산)', link: 'https://www.bok.or.kr' },
      { id: 'dgbas', name: '대만 통계청·중앙은행', detail: '대만 노동력·산업 구성·투자율' },
      { id: 'hofstede', name: SRC.hofstede, detail: '문화 6개 지표 (Cultures and Organizations 3판, 2015년판 자료)', link: 'https://geerthofstede.com/research-and-vsm/dimension-data-matrix/' },
    ],
  },
  blocs,
  countries,
  flows,
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out))
console.log(`나라 ${Object.keys(countries).length}곳, 교역 짝 ${flows.length}개 (그중 같은 블록 안 ${intraCount}개) → ${OUT}`)
