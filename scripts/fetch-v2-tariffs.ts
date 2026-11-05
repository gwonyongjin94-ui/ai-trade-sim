// v2 시작 관세와 시작 수출 통제 (2026-11-05, 사용자 승인). 키가 필요 없는 World Bank WITS API를 쓴다.
//   npm run tariffs:v2            # 캐시가 있으면 캐시
//   npm run tariffs:v2 -- --fresh
// 먼저 npm run data:v2 로 data/v2/trade-2023.json 이 있어야 한다 (블록 평균의 수입액 가중치).
// 결과: data/v2/tariffs.json
//  - 적용 관세: WITS TradeStats-Tariff, AHS 수입액 가중 평균 (FTA 특혜세율 포함). 2022년, 없으면 2021·2020·2023
//  - 미중 무역전쟁 관세(미국 301조, 중국 보복)는 WITS에 없어서 PIIE(Bown) 평균으로 덧씌운다:
//    미국의 대중국 19.3% (2023년 내내), 중국의 대미국 21% (2020년 2월 이후 거의 그대로)
//  - 반도체(8542)는 정보기술협정(ITA)으로 대부분 무관세라 0에서 시작하고, 위 덧씌우기만 받는다
//  - 나머지 세계가 매기는 관세는 EU(EUN)의 관세로 대신한다
//  - 대만은 TradeStats에 수입국으로도 상대국으로도 없다. 대만에 매기는 관세는 그 수입국의 최혜국 세율(MFN, 대세계 수입액
//    가중)로 대신한다. 우리 나라 누구도 대만과 FTA가 없어서다 (중국의 ECFA 조기 수확 품목은 넣지 않음). 대만의 관세는 TRAINS(코드 158)의
//    HS 6단위 최혜국 세율을 장(HS 2단위)마다 평균하고, 대만의 장별 수입액(Comtrade 2023, data:v2 캐시)으로 가중한다.
//    대만은 우리 상대국 누구와도 FTA가 없어 모든 상대에게 같은 세율이다 (중국과의 ECFA 조기 수확 품목은 넣지 않음)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const RAW = resolve(ROOT, 'data/raw/wits')
const OUT = resolve(ROOT, 'data/v2')
const fresh = process.argv.includes('--fresh')
mkdirSync(RAW, { recursive: true })

const trade = JSON.parse(readFileSync(resolve(OUT, 'trade-2023.json'), 'utf8'))
const GOODS: string[] = trade.meta.goods
type Member = { code: number; iso: string; name: string; optional?: boolean }
const blocs: Record<string, { name: string; members: Member[] }> = trade.meta.blocs
const blocOfIso = new Map<string, string>()
const codeOfIso = new Map<string, number>()
for (const [b, x] of Object.entries(blocs)) for (const m of x.members) if (!m.optional) (blocOfIso.set(m.iso, b), codeOfIso.set(m.iso, m.code))

// 관세를 받을 나라: 블록마다 교역이 큰 나라
const IMPORTERS = ['KOR', 'CHN', 'HKG', 'JPN', 'SAU', 'ARE', 'ISR', 'USA', 'CAN', 'MEX']
const PARTNERS = ['KOR', 'CHN', 'HKG', 'JPN', 'SAU', 'ARE', 'QAT', 'KWT', 'IRQ', 'OMN', 'ISR', 'USA', 'CAN', 'MEX', 'TWN']
const YEARS = [2022, 2021, 2020, 2023]

// WITS 품목군 → 우리 물품. 여러 품목군이면 단순 평균 (품목군별 수입액이 없어서)
const GROUPS: Record<string, string[]> = {
  food: ['Food'],
  energy: ['27-27_Fuels'],
  medicine: ['28-38_Chemicals'],
  chemicals: ['Chemical'],
  apparel_household: ['50-63_TextCloth', '64-67_Footwear', '41-43_HidesSkin', '44-49_Wood', '90-99_Miscellan'],
  vehicles: ['86-89_Transport'],
  metals: ['25-26_Minerals', '68-71_StoneGlas', '72-83_Metals'],
  machinery: ['84-85_MachElec'],
  semiconductors: [], // ITA: 0에서 시작
  electronics: ['84-85_MachElec'],
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let calls = 0
async function getJson(url: string): Promise<any> {
  const file = resolve(RAW, createHash('sha1').update(url).digest('hex').slice(0, 16) + '.json')
  if (!fresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  for (let attempt = 0; ; attempt++) {
    await sleep(600)
    calls++
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
      if (res.status === 429 || res.status >= 500) throw new Error(String(res.status))
      const text = await res.text()
      // 자료가 없으면 404와 함께 JSON이 아닌 안내문이 온다 ("{}Not Found - NoRecordsFound")
      const body = res.status === 404 || text.includes('NoRecordsFound') ? { empty: true, note: text.slice(0, 200) } : JSON.parse(text)
      writeFileSync(file, JSON.stringify(body))
      return body
    } catch (e) {
      if (attempt >= 5) throw e
      await sleep(3000 * (attempt + 1))
    }
  }
}

const WITS = 'https://wits.worldbank.org/API/V1/SDMX/V21/datasource/tradestats-tariff'
// 시리즈 키("0:0:0:3:0")에서 품목 번호의 자리. TRAINS 응답은 keyPosition(3)과 달리 2번째 자리에 품목이 있어서,
// 선언을 믿지 않고 값이 가장 많이 바뀌는 자리를 쓴다
const productPos = (keys: string[]) => {
  const parts = keys.map((k) => k.split(':'))
  let best = 0
  for (let i = 1; i < parts[0].length; i++) if (new Set(parts.map((x) => x[i])).size > new Set(parts.map((x) => x[best])).size) best = i
  return best
}
async function ahs(reporter: string, partner: string, indicator = 'AHS-WGHTD-AVRG'): Promise<{ year: number; groups: Record<string, number> } | null> {
  for (const year of YEARS) {
    const body = await getJson(`${WITS}/reporter/${reporter.toLowerCase()}/year/${year}/partner/${partner.toLowerCase()}/product/all/indicator/${indicator}?format=JSON`)
    const series = body.dataSets?.[0]?.series
    if (!series) continue
    const prods: string[] = body.structure.dimensions.series.find((d: any) => d.id === 'PRODUCTCODE').values.map((v: any) => v.id)
    const pIdx = productPos(Object.keys(series))
    const groups: Record<string, number> = {}
    for (const [k, v] of Object.entries<any>(series)) groups[prods[Number(k.split(':')[pIdx])]] = v.observations['0'][0]
    if (Object.keys(groups).length) return { year, groups }
  }
  return null
}
const toGoods = (groups: Record<string, number>) =>
  Object.fromEntries(
    GOODS.map((g) => {
      const vs = GROUPS[g].map((x) => groups[x]).filter((x) => x != null)
      return [g, GROUPS[g].length === 0 ? 0 : vs.length ? vs.reduce((s, x) => s + x, 0) / vs.length / 100 : (groups.Total ?? 0) / 100]
    }),
  ) as Record<string, number>

// 대만에 매기는 관세: 최혜국 세율 (위 설명)
const tariffOn = (imp: string, par: string) => (par === 'TWN' ? ahs(imp, 'WLD', 'MFN-WGHTD-AVRG') : ahs(imp, par))

// ── 나라 쌍 관세 ──
const pair: Record<string, Record<string, { year: number; rates: Record<string, number> }>> = {}
const missing: string[] = []
console.log(`WITS 적용 관세: 수입국 ${IMPORTERS.length}곳`)
for (const imp of IMPORTERS) {
  for (const par of [...PARTNERS, 'WLD']) {
    if (par !== 'WLD' && blocOfIso.get(par) === blocOfIso.get(imp)) continue
    const r = await tariffOn(imp, par)
    if (!r) {
      missing.push(`${imp}←${par}`)
      continue
    }
    ;(pair[imp] ??= {})[par] = { year: r.year, rates: toGoods(r.groups) }
  }
  console.log(`  ${imp} 완료 (호출 ${calls}회)`)
}
// 대만: TRAINS HS 6단위 → 장 평균 → 장별 수입액 가중 (반도체 8542는 따로, 전자는 85장에서 8542를 뺀다)
// 장 → 물품은 fetch-v2-data.ts의 goodOfChapter와 같다
function goodOfChapter(ch: number) {
  if (ch <= 24) return 'food'
  if (ch === 27) return 'energy'
  if (ch === 30) return 'medicine'
  if (ch >= 28 && ch <= 40) return 'chemicals'
  if (ch >= 86 && ch <= 89) return 'vehicles'
  if ((ch >= 72 && ch <= 83) || [25, 26, 68, 69, 70, 71].includes(ch)) return 'metals'
  if (ch === 84) return 'machinery'
  if (ch === 85 || (ch >= 90 && ch <= 92)) return 'electronics'
  return 'apparel_household'
}
const comtradeCache = (q: Record<string, string>) => {
  const url = `https://comtradeapi.un.org/public/v1/preview/C/A/HS?${new URLSearchParams(q)}`
  const body = JSON.parse(readFileSync(resolve(ROOT, 'data/raw', createHash('sha1').update(url).digest('hex').slice(0, 16) + '.json'), 'utf8'))
  return (body.data as any[]).filter((r) => r.customsCode === 'C00' && r.motCode === 0 && r.partner2Code === 0)
}
{
  const trn = await getJson('https://wits.worldbank.org/API/V1/SDMX/V21/datasource/TRN/reporter/158/partner/000/product/all/year/2022/datatype/reported?format=JSON')
  const prods: string[] = trn.structure.dimensions.series.find((d: any) => d.id === 'PRODUCTCODE').values.map((v: any) => v.id)
  const pIdx = productPos(Object.keys(trn.dataSets[0].series))
  const lines = new Map<string, number[]>() // '85' 같은 장, 또는 '8542'
  for (const [k, v] of Object.entries<any>(trn.dataSets[0].series)) {
    const hs = prods[Number(k.split(':')[pIdx])]
    const rate = v.observations['0'][0]
    if (rate == null) continue
    const key = hs.startsWith('8542') ? '8542' : hs.slice(0, 2)
    lines.set(key, [...(lines.get(key) ?? []), rate])
  }
  const imp = new Map<string, number>()
  for (const r of comtradeCache({ reporterCode: '490', period: '2023', flowCode: 'M', partnerCode: '0', cmdCode: 'AG2' })) imp.set(String(r.cmdCode).padStart(2, '0'), r.primaryValue)
  const semi = comtradeCache({ reporterCode: '490', period: '2023', flowCode: 'M', partnerCode: '0', cmdCode: '8542' }).reduce((s, r) => s + r.primaryValue, 0)
  imp.set('8542', semi)
  imp.set('85', (imp.get('85') ?? 0) - semi)
  const num: Record<string, number> = {}
  const den: Record<string, number> = {}
  for (const [key, rates] of lines) {
    const g = key === '8542' ? 'semiconductors' : goodOfChapter(Number(key))
    const w = imp.get(key) ?? 0
    num[g] = (num[g] ?? 0) + (w * rates.reduce((s, x) => s + x, 0)) / rates.length
    den[g] = (den[g] ?? 0) + w
  }
  const rates = Object.fromEntries(GOODS.map((g) => [g, den[g] > 0 ? num[g] / den[g] / 100 : 0])) as Record<string, number>
  pair.TWN = Object.fromEntries([...PARTNERS.filter((x) => x !== 'TWN'), 'WLD'].map((x) => [x, { year: 2022, rates: { ...rates } }]))
  console.log(`  TWN 완료 (TRAINS ${prods.length}개 품목)`)
}

// 나머지 세계(EU로 대신)가 각 나라에 매기는 관세
console.log('WITS: EU (나머지 세계 대신)')
for (const par of PARTNERS) {
  const r = await tariffOn('EUN', par)
  if (r) (pair.EUN ??= {})[par] = { year: r.year, rates: toGoods(r.groups) }
  else missing.push(`EUN←${par}`)
}

// ── 미중 무역전쟁 관세 덧씌우기: 그 나라 쌍의 수입액 가중 평균이 목표값이 되도록 물품마다 같은 폭을 더한다 ──
const pairImports = (imp: string, exp: string) => {
  const f = trade.pairFlows.find((x: any) => x.from === codeOfIso.get(exp) && x.to === codeOfIso.get(imp))
  return (f?.values ?? {}) as Record<string, number>
}
const OVERLAYS = [
  // 홍콩산은 301조 관세 대상이 아니다 (원산지 기준)
  { importer: 'USA', exporters: ['CHN'], target: 0.193, source: 'PIIE (Bown), US-China Trade War Tariffs: 미국의 대중국 평균 관세 19.3% (2023년)' },
  { importer: 'CHN', exporters: ['USA'], target: 0.21, source: 'PIIE (Bown): 중국의 대미국 평균 관세 21% (2020년 2월 이후 거의 그대로)' },
]
const overlayLog: any[] = []
for (const o of OVERLAYS) {
  for (const exp of o.exporters) {
    const p = pair[o.importer]?.[exp]
    if (!p) continue
    const w = pairImports(o.importer, exp)
    const tot = GOODS.reduce((s, g) => s + (w[g] ?? 0), 0)
    const before = GOODS.reduce((s, g) => s + (w[g] ?? 0) * p.rates[g], 0) / tot
    const add = Math.max(0, o.target - before)
    for (const g of GOODS) p.rates[g] += add
    overlayLog.push({ importer: o.importer, exporter: exp, before: Number(before.toFixed(4)), add: Number(add.toFixed(4)), target: o.target, source: o.source })
  }
}

// ── 블록 평균: 수입국 회원 × 수출국 회원, 물품별 수입액 가중 ──
const B = Object.keys(blocs)
const bloc: Record<string, Record<string, Record<string, number>>> = {}
for (const I of B)
  for (const J of B) {
    if (I === J) continue
    const out: Record<string, number> = {}
    for (const g of GOODS) {
      let num = 0
      let den = 0
      const plain: number[] = []
      for (const imp of [...IMPORTERS, 'TWN'].filter((x) => blocOfIso.get(x) === I))
        for (const exp of PARTNERS.filter((x) => blocOfIso.get(x) === J)) {
          const r = pair[imp]?.[exp]?.rates[g]
          if (r == null) continue
          const w = pairImports(imp, exp)[g] ?? 0
          num += w * r
          den += w
          plain.push(r)
        }
      out[g] = den > 0 ? num / den : plain.length ? plain.reduce((s, x) => s + x, 0) / plain.length : 0
    }
    ;(bloc[I] ??= {})[J] = out
  }
// 블록이 나머지 세계에 매기는 관세: 회원국의 대세계(WLD) 관세 단순 평균. 나머지 세계가 블록에 매기는 관세: EU 관세 단순 평균
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
const onRow: Record<string, Record<string, number>> = {}
const byRow: Record<string, Record<string, number>> = {}
for (const I of B) {
  onRow[I] = Object.fromEntries(GOODS.map((g) => [g, avg([...IMPORTERS, 'TWN'].filter((x) => blocOfIso.get(x) === I).map((x) => pair[x]?.WLD?.rates[g]).filter((x): x is number => x != null))]))
  byRow[I] = Object.fromEntries(GOODS.map((g) => [g, avg(PARTNERS.filter((x) => blocOfIso.get(x) === I).map((x) => pair.EUN?.[x]?.rates[g]).filter((x): x is number => x != null))]))
}

// ── 시작 수출 통제 (사용자 승인): 미국 → 중국 반도체 1단계 ──
const exportControls = [{ from: 'E', to: 'B', good: 'semiconductors', level: 1, reason: '2022·2023년 미국의 첨단 반도체 대중 수출 통제. 반도체 전체가 아니라 첨단 칩 일부만 대상이라 1단계(약한 통제)' }]

writeFileSync(
  resolve(OUT, 'tariffs.json'),
  JSON.stringify(
    {
      meta: {
        source: 'World Bank WITS TradeStats-Tariff, AHS weighted average (%), year 2022 (fallback 2021, 2020, 2023); Taiwan from WITS TRAINS (reporter 158, MFN HS6, 2022) weighted by Comtrade 2023 chapter imports; overlays from PIIE (Bown)',
        fetched: new Date().toISOString().slice(0, 10),
        unit: 'rate (0.05 = 5%)',
        groupMapping: GROUPS,
        notes: [
          'WITS 품목군은 기계·반도체·전기·전자(HS 84–85)를 나누지 않는다. 반도체는 ITA로 0에서 시작',
          '의약품은 화학(HS 28–38) 품목군 관세를 쓴다',
          '여러 품목군을 묶은 물품은 단순 평균',
          '미국 232조(철강·알루미늄) 등 다른 추가 관세는 넣지 않았다',
          '나머지 세계가 매기는 관세는 EU 관세로 대신한다',
          '대만의 관세는 TRAINS 최혜국 세율 (장 안은 단순 평균, 장끼리는 수입액 가중). 중국과의 ECFA 조기 수확 품목은 넣지 않았다',
          '대만에 매기는 관세는 수입국의 최혜국 세율 (WITS MFN-WGHTD-AVRG, 대세계). WITS에 대만이 상대국으로 없어서',
          '블록이 나머지 세계에 매기는 관세는 회원국의 대세계 관세를 단순 평균',
        ],
        missing,
      },
      overlays: overlayLog,
      bloc,
      row: { blocOnRow: onRow, rowOnBloc: byRow },
      exportControls,
      pair,
    },
    null,
    1,
  ),
)
console.log(`\n끝: 호출 ${calls}회 (나머지는 캐시). 빈 쌍 ${missing.length}개: ${missing.join(', ')}`)
console.log('data/v2/tariffs.json')
