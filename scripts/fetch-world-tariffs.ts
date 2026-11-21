// 나라 쌍 적용 관세: 수입국마다 모든 상대국에 매기는 관세 (2026-11-22, 사용자 승인: "상대국별 관세 자료도 받고 진행해").
//   npm run world:tariffs            # 캐시가 있으면 캐시
//   npm run world:tariffs -- --fresh
// 출처: World Bank WITS TradeStats-Tariff (UNCTAD TRAINS 바탕, 키 없는 공개 API).
//  - 관세: AHS-WGHTD-AVRG = 적용 관세(FTA 특혜세율 포함)의 수입액 가중 평균 (%)
//  - 수입액: AHS-DTBL-MPRT(유세 수입) + AHS-DTY-FR-MPRTs(무세 수입), 천 달러
//  - 품목군: Total(전 품목), manuf(공산품, SITC 5–8 − 667 − 68), 1차 산품 = Food·AgrRaw·Fuels·OresMtls(SITC 0–4 + 68)를
//    품목군 수입액으로 가중 평균. WDI의 TM.TAX.MRCH/MANF/TCOM 지표와 같은 묶음이다
//  - 연도: 그 나라의 WDI 관세 연도(대부분 2022)를 먼저, 없으면 2022·2021·2020·2019.
//    방글라데시·알제리 등 21곳은 어느 해에도 TradeStats 자료가 없다 (WDI 평균은 있어도)
// 호출: 수입국마다 연도 하나에 1번 (품목군 6개 × 지표 3개를 한 번에). 응답 하나가 약 0.3MB, 원 응답은 data/raw/wits에 캐시(커밋 안 함).
// 결과: data/world/tariffs-bilateral.json — 수입국 → { 연도, 대세계, 상대국 → [관세 3개, 수입액 3개(백만 달러)] }
// 미국 301조·중국 보복 같은 추가 관세는 TRAINS에 없어서 이 값에도 없다 (화면에 알린다).

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const RAW = resolve(ROOT, 'data/raw/wits')
const OUT = resolve(ROOT, 'data/world/tariffs-bilateral.json')
const fresh = process.argv.includes('--fresh')
mkdirSync(RAW, { recursive: true })

const WITS = 'https://wits.worldbank.org/API/V1'
const PRODUCTS = ['Total', 'manuf', 'Food', 'AgrRaw', 'Fuels', 'OresMtls']
const PRIMARY = ['Food', 'AgrRaw', 'Fuels', 'OresMtls']
const INDICATORS = ['AHS-WGHTD-AVRG', 'AHS-DTBL-MPRT', 'AHS-DTY-FR-MPRTs']
const FALLBACK_YEARS = [2022, 2021, 2020, 2019]
// WITS 옛 코드 → ISO3. 대만은 TradeStats에 수입국도 상대국도 아니다 ('Other Asia, nes'로 적은 수입국은 3곳뿐이라 대만으로 보지 않는다)
const CODE_FIX: Record<string, string> = { MNT: 'MNE', ROM: 'ROU', SER: 'SRB', TMP: 'TLS', ZAR: 'COD' }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let calls = 0
async function get(url: string, json = true): Promise<any> {
  const file = resolve(RAW, createHash('sha1').update(url).digest('hex').slice(0, 16) + (json ? '.json' : '.xml'))
  if (!fresh && existsSync(file)) return json ? JSON.parse(readFileSync(file, 'utf8')) : readFileSync(file, 'utf8')
  for (let attempt = 0; ; attempt++) {
    await sleep(600)
    calls++
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000) })
      if (res.status === 429 || res.status >= 500) throw new Error(String(res.status))
      const text = await res.text()
      if (!json) {
        writeFileSync(file, text)
        return text
      }
      if (res.status === 413) throw new Error('413 응답이 너무 큼')
      // 자료가 없으면 404와 함께 JSON이 아닌 안내문이 온다
      const body = res.status === 404 || text.includes('NoRecordsFound') ? { empty: true, note: text.slice(0, 200) } : JSON.parse(text)
      writeFileSync(file, JSON.stringify(body))
      return body
    } catch (e) {
      if (attempt >= 5) throw e
      console.warn(`  ${(e as Error).message}, 다시 시도`)
      await sleep(3000 * (attempt + 1))
    }
  }
}

// ── 수입국 목록 (WITS 나라 목록에서 수입국이고 묶음이 아닌 곳)
const xml: string = await get(`${WITS}/wits/datasource/tradestats-tariff/country/all`, false)
const reporters: string[] = []
for (const m of xml.matchAll(/<wits:country countrycode="\d+" isreporter="(\d)" ispartner="\d" isgroup="([^"]*)"[^>]*>\s*<wits:iso3Code>([^<]*)<\/wits:iso3Code>/g))
  if (m[1] === '1' && m[2] === 'No') reporters.push(m[3])
const world = JSON.parse(readFileSync(resolve(ROOT, 'src/web/data/world-2023.json'), 'utf8')).countries as Record<string, { tariff?: { all: { year: number } | null } }>
const isoOf = (code: string) => CODE_FIX[code] ?? code
console.log(`WITS 수입국 ${reporters.length}곳`)

type Cell = Record<string, Record<string, Record<string, number>>> // 상대 → 품목군 → 지표 → 값
function parse(body: any): Cell | null {
  const series = body.dataSets?.[0]?.series
  if (!series) return null
  const dims: { id: string; values: { id: string }[] }[] = body.structure.dimensions.series
  const at = (id: string) => dims.findIndex((d) => d.id === id)
  const [pi, gi, ii] = [at('PARTNER'), at('PRODUCTCODE'), at('INDICATOR')]
  const out: Cell = {}
  for (const [k, v] of Object.entries<any>(series)) {
    const key = k.split(':').map(Number)
    const par = dims[pi].values[key[pi]].id
    const grp = dims[gi].values[key[gi]].id
    const ind = dims[ii].values[key[ii]].id
    const val = v.observations?.['0']?.[0]
    if (typeof val !== 'number') continue
    ;((out[par] ??= {})[grp] ??= {})[ind] = val
  }
  return Object.keys(out).length ? out : null
}

const r2 = (v: number) => Math.round(v * 100) / 100
const m2 = (k: number) => Math.round(k / 10) / 100 // 천 달러 → 백만 달러, 소수 둘째 자리
// 한 상대에 대한 [전 품목, 공산품, 1차 산품 관세(%), 수입액 3개(백만 달러)]. 수입이 없는 품목군은 null
function row(c: Record<string, Record<string, number>>): (number | null)[] {
  const imp = (g: string) => (c[g]?.['AHS-DTBL-MPRT'] ?? 0) + (c[g]?.['AHS-DTY-FR-MPRTs'] ?? 0)
  const rate = (g: string) => (imp(g) > 0 && c[g]?.['AHS-WGHTD-AVRG'] != null ? c[g]['AHS-WGHTD-AVRG'] : null)
  let w = 0
  let s = 0
  for (const g of PRIMARY) {
    const t = rate(g)
    if (t === null) continue
    w += imp(g)
    s += t * imp(g)
  }
  const primary = w > 0 ? s / w : null
  const all = rate('Total')
  const manuf = rate('manuf')
  return [all === null ? null : r2(all), manuf === null ? null : r2(manuf), primary === null ? null : r2(primary), m2(imp('Total')), m2(imp('manuf')), m2(w)]
}

const out: Record<string, { year: number; world: (number | null)[]; partners: Record<string, (number | null)[]> }> = {}
const missing: string[] = []
let n = 0
for (const code of reporters) {
  const iso = isoOf(code)
  n++
  const wdiYear = world[iso]?.tariff?.all?.year
  const years = [...new Set([...(wdiYear ? [wdiYear] : []), ...FALLBACK_YEARS])]
  let got: { year: number; cell: Cell } | null = null
  for (const year of years) {
    const url = `${WITS}/SDMX/V21/datasource/tradestats-tariff/reporter/${code.toLowerCase()}/year/${year}/partner/all/product/${PRODUCTS.join(';')}/indicator/${INDICATORS.join(';')}?format=JSON`
    const cell = parse(await get(url))
    if (cell?.WLD) {
      got = { year, cell }
      break
    }
  }
  if (!got) {
    missing.push(iso)
    continue
  }
  const partners: Record<string, (number | null)[]> = {}
  for (const [par, c] of Object.entries(got.cell)) {
    if (par === 'WLD') continue
    const p = isoOf(par)
    if (!world[p] || p === iso) continue // 지도에 없는 곳(자유무역지대·미상·옛 나라)과 자기 자신은 뺀다
    const r = row(c)
    if (!r[3]) continue // 수입이 없는 상대
    partners[p] = r
  }
  out[iso] = { year: got.year, world: row(got.cell.WLD), partners }
  if (n % 20 === 0) console.log(`  ${n}/${reporters.length} (새로 받은 호출 ${calls}번)`)
}

writeFileSync(
  OUT,
  JSON.stringify({
    meta: {
      source: 'World Bank WITS TradeStats-Tariff (UNCTAD TRAINS), wits.worldbank.org',
      fetched: new Date().toISOString().slice(0, 10),
      indicators: INDICATORS,
      products: PRODUCTS,
      row: ['전 품목 관세 %', '공산품 관세 %', '1차 산품 관세 %', '전 품목 수입 백만 달러', '공산품 수입', '1차 산품 수입'],
      note: '적용 관세(AHS)의 수입액 가중 평균. 1차 산품 = Food·AgrRaw·Fuels·OresMtls를 수입액으로 가중. 연도는 WDI 관세 연도 우선. 미국 301조·중국 보복 관세 없음. 대만 없음',
      missing,
    },
    reporters: out,
  }),
)
const pairs = Object.values(out).reduce((s, r) => s + Object.keys(r.partners).length, 0)
const years: Record<number, number> = {}
for (const r of Object.values(out)) years[r.year] = (years[r.year] ?? 0) + 1
console.log(`수입국 ${Object.keys(out).length}곳, 나라 쌍 ${pairs}개, 연도 ${JSON.stringify(years)}, 자료 없음 ${missing.length}곳: ${missing.join(' ')}`)
console.log(`새로 받은 호출 ${calls}번 → ${OUT}`)
