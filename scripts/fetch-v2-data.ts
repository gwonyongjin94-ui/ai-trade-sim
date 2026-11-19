// v2(6개국) 보정용 실제 데이터를 내려받는다 (2026-11-05, 사용자 승인). 키가 필요 없는 공개 API만 쓴다.
//   npm run data:v2            # 캐시가 있으면 캐시를 쓴다
//   npm run data:v2 -- --fresh # 캐시를 무시하고 다시 받는다
// 원자료 캐시: data/raw/ (git 제외). 결과: data/v2/trade-2023.json, data/v2/macro-2023.json
//  - 양자 교역: UN Comtrade 공개 preview API. 보고국 7곳의 상대국별 HS 2단위 수출입 + 반도체(8542)
//    수입국이 보고하면 수입 보고값, 아니면 수출국 보고값을 쓴다 (거울 자료). 같은 블록 안의 교역은 국내로 본다
//  - GDP·인구·노동력·소비·투자: World Bank API. 대만은 IMF WEO API
// 호출은 Korea Trade Map(scripts/fetch-trade.mjs)처럼 하나씩, 쉬어 가며, 429면 기다렸다 다시 한다.

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { GOODS_V2, goodOfChapter, type GoodV2 } from './lib/hs'

const ROOT = resolve(import.meta.dirname, '..')
const RAW = resolve(ROOT, 'data/raw')
const OUT = resolve(ROOT, 'data/v2')
const YEAR = 2023
const fresh = process.argv.includes('--fresh')
mkdirSync(RAW, { recursive: true })
mkdirSync(OUT, { recursive: true })

// ── 나라 묶음 (docs/V2_DESIGN.md). code = Comtrade 코드, iso = World Bank 코드 ──
type Member = { code: number; iso: string; name: string; optional?: boolean }
export const BLOCS: Record<string, { name: string; members: Member[] }> = {
  A: { name: '대한민국', members: [{ code: 410, iso: 'KOR', name: '대한민국' }] },
  B: {
    name: '중국·북한',
    members: [
      { code: 156, iso: 'CHN', name: '중국' },
      { code: 408, iso: 'PRK', name: '북한' },
      { code: 344, iso: 'HKG', name: '홍콩' },
      { code: 446, iso: 'MAC', name: '마카오' },
    ],
  },
  C: { name: '일본', members: [{ code: 392, iso: 'JPN', name: '일본' }] },
  D: {
    name: '중동',
    members: [
      { code: 682, iso: 'SAU', name: '사우디아라비아' },
      { code: 784, iso: 'ARE', name: '아랍에미리트' },
      { code: 634, iso: 'QAT', name: '카타르' },
      { code: 414, iso: 'KWT', name: '쿠웨이트' },
      { code: 512, iso: 'OMN', name: '오만' },
      { code: 48, iso: 'BHR', name: '바레인' },
      { code: 364, iso: 'IRN', name: '이란' },
      { code: 368, iso: 'IRQ', name: '이라크' },
      { code: 376, iso: 'ISR', name: '이스라엘' },
      { code: 400, iso: 'JOR', name: '요르단' },
      { code: 422, iso: 'LBN', name: '레바논' },
      { code: 760, iso: 'SYR', name: '시리아' },
      { code: 887, iso: 'YEM', name: '예멘' },
      // 넣을지 나중에 정한다. 데이터만 받아 둔다
      { code: 792, iso: 'TUR', name: '튀르키예', optional: true },
      { code: 818, iso: 'EGY', name: '이집트', optional: true },
    ],
  },
  E: {
    name: '미국·캐나다·멕시코',
    members: [
      { code: 842, iso: 'USA', name: '미국' },
      { code: 124, iso: 'CAN', name: '캐나다' },
      { code: 484, iso: 'MEX', name: '멕시코' },
    ],
  },
  // Comtrade는 대만을 "Other Asia, nes"(490)로 싣는다
  F: { name: '대만', members: [{ code: 490, iso: 'TWN', name: '대만' }] },
}
const REPORTERS = [410, 156, 392, 842, 124, 484, 490]

// 물품 10개와 HS 장 → 물품 대응은 scripts/lib/hs.ts (지도 자료 만들기와 같이 쓴다)

// ── 내려받기 (캐시, 쉬어 가기, 재시도) ──
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let calls = 0
async function getJson(url: string): Promise<any> {
  const file = resolve(RAW, createHash('sha1').update(url).digest('hex').slice(0, 16) + '.json')
  if (!fresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  for (let attempt = 0; ; attempt++) {
    await sleep(1200)
    calls++
    let res: Response
    let body: any
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(90_000) })
      if (res.status !== 429 && res.ok) body = await res.json()
    } catch (e) {
      if (attempt >= 6) throw e
      console.warn(`  ${(e as Error).name}, 다시 시도`)
      await sleep(5000 * (attempt + 1))
      continue
    }
    if (res.status === 429 && attempt < 6) {
      const wait = 3000 * 2 ** attempt
      console.warn(`  429, ${wait / 1000}초 기다림`)
      await sleep(wait)
      continue
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`)
    if (body?.error) throw new Error(`${body.error} ${url}`)
    writeFileSync(file, JSON.stringify(body))
    return body
  }
}

// ── Comtrade ──
const COMTRADE = 'https://comtradeapi.un.org/public/v1/preview/C/A/HS'
const ROW_CAP = 500
type Row = { reporterCode: number; partnerCode: number; flowCode: string; cmdCode: string; primaryValue: number; customsCode: string; motCode: number; partner2Code: number }
async function comtrade(reporter: number, flow: 'M' | 'X', partners: number[], cmd: string): Promise<Row[]> {
  const q = new URLSearchParams({ reporterCode: String(reporter), period: String(YEAR), flowCode: flow, partnerCode: partners.join(','), cmdCode: cmd })
  const body = await getJson(`${COMTRADE}?${q}`)
  const data: Row[] = body.data ?? []
  if (data.length >= ROW_CAP) {
    if (partners.length < 2) throw new Error(`행 상한에 걸림: ${q}`)
    const mid = Math.ceil(partners.length / 2)
    return [...(await comtrade(reporter, flow, partners.slice(0, mid), cmd)), ...(await comtrade(reporter, flow, partners.slice(mid), cmd))]
  }
  return data.filter((r) => r.customsCode === 'C00' && r.motCode === 0 && r.partner2Code === 0)
}

const allMembers = Object.entries(BLOCS).flatMap(([bloc, b]) => b.members.map((m) => ({ ...m, bloc })))
const blocOfCode = new Map(allMembers.map((m) => [m.code, m.bloc]))
const chunks = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

// reported[flow][reporter][partner][good] = 백만 달러
type Table = Record<number, Record<number, Partial<Record<GoodV2, number>>>>
const reported: Record<'M' | 'X', Table> = { M: {}, X: {} }
const add = (flow: 'M' | 'X', rep: number, par: number, good: GoodV2, v: number) => {
  const t = (((reported[flow][rep] ??= {})[par] ??= {}) as Partial<Record<GoodV2, number>>)
  t[good] = (t[good] ?? 0) + v / 1e6
}

console.log(`UN Comtrade ${YEAR}: 보고국 ${REPORTERS.length}곳`)
for (const rep of REPORTERS) {
  const own = blocOfCode.get(rep)
  const partners = allMembers.filter((m) => m.bloc !== own).map((m) => m.code)
  for (const flow of ['M', 'X'] as const) {
    for (const group of chunks(partners, 5)) {
      for (const r of await comtrade(rep, flow, group, 'AG2')) add(flow, rep, r.partnerCode, goodOfChapter(Number(r.cmdCode)), r.primaryValue)
    }
    // 반도체는 전기·전자(85)에서 옮긴다
    for (const r of await comtrade(rep, flow, partners, '8542')) {
      add(flow, rep, r.partnerCode, 'semiconductors', r.primaryValue)
      add(flow, rep, r.partnerCode, 'electronics', -r.primaryValue)
    }
    console.log(`  보고국 ${rep} ${flow === 'M' ? '수입' : '수출'} 완료 (호출 ${calls}회)`)
  }
}

// 나라 쌍(수출국 e → 수입국 m) 값: 수입국 보고 우선, 없으면 수출국 보고, 둘 다 없으면 빈칸
const pairFlows: { from: number; to: number; source: 'importer' | 'exporter' | 'none'; values: Partial<Record<GoodV2, number>> }[] = []
for (const e of allMembers)
  for (const m of allMembers) {
    if (e.bloc === m.bloc) continue
    const imp = reported.M[m.code]?.[e.code]
    const exp = reported.X[e.code]?.[m.code]
    const source = imp ? 'importer' : exp ? 'exporter' : 'none'
    pairFlows.push({ from: e.code, to: m.code, source, values: imp ?? exp ?? {} })
  }

// 블록 쌍 합계 (선택 회원국 제외)
const included = (code: number) => !allMembers.find((m) => m.code === code)?.optional
const blocFlows: Record<string, Record<string, Record<GoodV2, number>>> = {}
for (const f of pairFlows) {
  if (!included(f.from) || !included(f.to)) continue
  const a = blocOfCode.get(f.from)!
  const b = blocOfCode.get(f.to)!
  const cell = ((blocFlows[a] ??= {})[b] ??= Object.fromEntries(GOODS_V2.map((g) => [g, 0])) as Record<GoodV2, number>)
  for (const g of GOODS_V2) cell[g] += f.values[g] ?? 0
}
const missing = pairFlows.filter((f) => f.source === 'none' && included(f.from) && included(f.to)).map((f) => `${f.from}→${f.to}`)

// ── 나머지 세계 (6개 블록 밖: EU, 아세안, 인도 등) ──
// 보고국마다 대세계 총액 − 6개 블록 회원국(같은 블록 포함, 선택국 제외)과의 교역. 모두 보고국 자신의 보고값이다
console.log('UN Comtrade: 대세계 총액, 같은 블록 안 교역 (나머지 세계 계산용)')
const world: Record<'M' | 'X', Record<number, Partial<Record<GoodV2, number>>>> = { M: {}, X: {} }
const addTo = (t: Partial<Record<GoodV2, number>>, g: GoodV2, v: number) => (t[g] = (t[g] ?? 0) + v / 1e6)
for (const rep of REPORTERS) {
  const own = blocOfCode.get(rep)
  const sameBloc = allMembers.filter((m) => m.bloc === own && m.code !== rep).map((m) => m.code)
  for (const flow of ['M', 'X'] as const) {
    const w = (world[flow][rep] ??= {})
    for (const r of await comtrade(rep, flow, [0], 'AG2')) addTo(w, goodOfChapter(Number(r.cmdCode)), r.primaryValue)
    for (const r of await comtrade(rep, flow, [0], '8542')) {
      addTo(w, 'semiconductors', r.primaryValue)
      addTo(w, 'electronics', -r.primaryValue)
    }
    if (sameBloc.length) {
      for (const r of await comtrade(rep, flow, sameBloc, 'AG2')) add(flow, rep, r.partnerCode, goodOfChapter(Number(r.cmdCode)), r.primaryValue)
      for (const r of await comtrade(rep, flow, sameBloc, '8542')) {
        add(flow, rep, r.partnerCode, 'semiconductors', r.primaryValue)
        add(flow, rep, r.partnerCode, 'electronics', -r.primaryValue)
      }
    }
  }
  console.log(`  보고국 ${rep} 완료 (호출 ${calls}회)`)
}
const zero = () => Object.fromEntries(GOODS_V2.map((g) => [g, 0])) as Record<GoodV2, number>
const toRow: Record<string, Record<GoodV2, number>> = {}
const fromRow: Record<string, Record<GoodV2, number>> = {}
let clampedCells = 0
for (const rep of REPORTERS) {
  const bloc = blocOfCode.get(rep)!
  const others = allMembers.filter((m) => m.code !== rep && included(m.code)).map((m) => m.code)
  for (const [flow, target] of [['X', toRow], ['M', fromRow]] as const) {
    const cell = (target[bloc] ??= zero())
    for (const g of GOODS_V2) {
      let v = world[flow][rep]?.[g] ?? 0
      for (const p of others) v -= reported[flow][rep]?.[p]?.[g] ?? 0
      if (v < 0) {
        clampedCells++
        v = 0
      }
      cell[g] += v
    }
  }
}

// ── World Bank ──
const WB = 'https://api.worldbank.org/v2/country'
const WB_INDICATORS: Record<string, string> = {
  population: 'SP.POP.TOTL',
  laborForce: 'SL.TLF.TOTL.IN',
  gdpUsd: 'NY.GDP.MKTP.CD',
  householdConsumptionUsd: 'NE.CON.PRVT.CD',
  grossCapitalFormationPctGdp: 'NE.GDI.TOTL.ZS',
  exportsPctGdp: 'NE.EXP.GNFS.ZS',
  importsPctGdp: 'NE.IMP.GNFS.ZS',
  merchExportsUsd: 'TX.VAL.MRCH.CD.WT',
  merchImportsUsd: 'TM.VAL.MRCH.CD.WT',
}
const isoList = allMembers.filter((m) => m.iso !== 'TWN').map((m) => m.iso)
const macro: Record<string, Record<string, { value: number; year: number } | null>> = {}
console.log('World Bank')
for (const [key, ind] of Object.entries(WB_INDICATORS)) {
  // 2023이 비어 있는 나라(시리아·예멘 등)는 2018~2023 중 가장 최근 값
  const body = await getJson(`${WB}/${isoList.join(';')}/indicator/${ind}?date=2018:${YEAR}&format=json&per_page=1000`)
  for (const iso of isoList) (macro[iso] ??= {})[key] = null
  for (const r of body[1] ?? []) {
    const iso = r.countryiso3code
    if (!macro[iso] || r.value == null) continue
    const cur = macro[iso][key]
    if (!cur || Number(r.date) > cur.year) macro[iso][key] = { value: r.value, year: Number(r.date) }
  }
}

// ── IMF WEO (대만) ──
const IMF = 'https://www.imf.org/external/datamapper/api/v1'
console.log('IMF WEO (대만)')
const imf: Record<string, Record<string, number>> = {}
for (const [key, ind] of Object.entries({ gdpUsdBn: 'NGDPD', populationMn: 'LP', investmentPctGdp: 'NID_NGDP' })) {
  const body = await getJson(`${IMF}/${ind}/TWN`)
  imf[key] = body.values?.[ind]?.TWN ?? {}
}
macro.TWN = {
  population: imf.populationMn[YEAR] ? { value: imf.populationMn[YEAR] * 1e6, year: YEAR } : null,
  laborForce: null, // World Bank·IMF에 없다. 대만 통계청(DGBAS) 값을 따로 넣는다
  gdpUsd: imf.gdpUsdBn[YEAR] ? { value: imf.gdpUsdBn[YEAR] * 1e9, year: YEAR } : null,
  householdConsumptionUsd: null,
  grossCapitalFormationPctGdp: imf.investmentPctGdp[YEAR] ? { value: imf.investmentPctGdp[YEAR], year: YEAR } : null,
  exportsPctGdp: null,
  importsPctGdp: null,
  merchExportsUsd: null,
  merchImportsUsd: null,
}


// 중동은 Comtrade 보고국이 없다: World Bank 상품 수출입 총액 − 다른 블록과의 교역(거울 자료). 물품 구성은 다른 블록과의 교역 비율로 나눈다
const dMembers = BLOCS.D.members.filter((m) => !m.optional)
const dTotal = (key: 'merchExportsUsd' | 'merchImportsUsd') => dMembers.reduce((s, m) => s + (macro[m.iso]?.[key]?.value ?? 0), 0) / 1e6
const spread = (total: number, shape: Record<GoodV2, number>) => {
  const sum = GOODS_V2.reduce((s, g) => s + shape[g], 0)
  return Object.fromEntries(GOODS_V2.map((g) => [g, sum > 0 ? (Math.max(0, total) * shape[g]) / sum : 0])) as Record<GoodV2, number>
}
const dExportsToBlocs = zero()
const dImportsFromBlocs = zero()
for (const b of Object.keys(BLOCS)) {
  if (b === 'D') continue
  for (const g of GOODS_V2) {
    dExportsToBlocs[g] += blocFlows.D?.[b]?.[g] ?? 0
    dImportsFromBlocs[g] += blocFlows[b]?.D?.[g] ?? 0
  }
}
const sumG = (x: Record<GoodV2, number>) => GOODS_V2.reduce((s, g) => s + x[g], 0)
toRow.D = spread(dTotal('merchExportsUsd') - sumG(dExportsToBlocs), dExportsToBlocs)
fromRow.D = spread(dTotal('merchImportsUsd') - sumG(dImportsFromBlocs), dImportsFromBlocs)

writeFileSync(
  resolve(OUT, `macro-${YEAR}.json`),
  JSON.stringify(
    {
      meta: { source: `World Bank WDI API (${Object.values(WB_INDICATORS).join(', ')}); Taiwan from IMF WEO datamapper (NGDPD, LP, NID_NGDP)`, year: YEAR, fetched: new Date().toISOString().slice(0, 10) },
      countries: Object.fromEntries(allMembers.map((m) => [m.iso, { bloc: m.bloc, name: m.name, optional: !!m.optional, ...macro[m.iso] }])),
    },
    null,
    1,
  ),
)

writeFileSync(
  resolve(OUT, `trade-${YEAR}.json`),
  JSON.stringify(
    {
      meta: {
        source: `UN Comtrade public preview API, HS, annual ${YEAR}, primaryValue (USD), importer-reported preferred, exporter-reported as mirror`,
        unit: 'USD million',
        fetched: new Date().toISOString().slice(0, 10),
        reporters: REPORTERS,
        goods: GOODS_V2,
        hsMapping: 'food 01–24 · energy 27 · medicine 30 · chemicals 28–29,31–40 · vehicles 86–89 · metals 25–26,68–83 · machinery 84 · semiconductors 8542 · electronics 85(−8542),90–92 · apparel_household 41–67,93–97',
        blocs: Object.fromEntries(Object.entries(BLOCS).map(([k, b]) => [k, { name: b.name, members: b.members }])),
        missingPairs: missing.length,
      },
      blocFlows,
      rowFlows: {
        method: '보고국: 대세계 총액 − 6개 블록 회원국과의 교역 (자기 보고값). 중동: World Bank 상품 수출입 총액 − 다른 블록과의 교역(거울), 물품 구성은 다른 블록과의 교역 비율. 홍콩·마카오·북한의 나머지 세계 교역은 빠짐 (보고하지 않음)',
        clampedCells,
        toRow,
        fromRow,
      },
      pairFlows,
    },
    null,
    1,
  ),
)

console.log(`\n끝: 호출 ${calls}회 (나머지는 캐시). 빈 나라 쌍 ${missing.length}개`)
console.log(`data/v2/trade-${YEAR}.json, data/v2/macro-${YEAR}.json`)
