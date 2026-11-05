// v2 생산 구조 자료 (2026-11-05, 사용자 승인). 키가 필요 없는 World Bank API만 쓴다.
//   npm run production:v2            # 캐시가 있으면 캐시
//   npm run production:v2 -- --fresh
// 먼저 npm run data:v2 로 data/v2/trade-2023.json 이 있어야 한다 (블록 회원국 목록).
// 결과: data/v2/production-2023.json
//  - 부가가치 비중 (% GDP): 농업, 산업, 제조업, 서비스
//  - 자원 지대 (% GDP): 석유, 천연가스, 석탄, 광물. 광업 부가가치 대신 쓴다
//  - 제조업 구성 (% 제조업 부가가치, UNIDO 기반): 식품·음료·담배, 섬유·의류, 화학, 기계·운송장비, 기타
//  - 세계(WLD) 값: 나머지 세계 = 세계 − 6개 블록 계산용 (GDP·인구·노동력·투자율도 같이)
// 대만은 World Bank에 없어서 data/v2/manual-2023.json 에 대만 통계청 값을 따로 적는다.
// 지표마다 최신 값은 연도가 다르다 (지대·제조업 구성은 늦게 나온다). 2015~2023 중 가장 최근 값을 쓰고 연도를 같이 적는다.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const RAW = resolve(ROOT, 'data/raw')
const OUT = resolve(ROOT, 'data/v2')
const fresh = process.argv.includes('--fresh')
mkdirSync(RAW, { recursive: true })

const trade = JSON.parse(readFileSync(resolve(OUT, 'trade-2023.json'), 'utf8'))
type Member = { code: number; iso: string; name: string; optional?: boolean }
const members: (Member & { bloc: string })[] = Object.entries<{ members: Member[] }>(trade.meta.blocs).flatMap(([bloc, b]) =>
  b.members.filter((m) => !m.optional).map((m) => ({ ...m, bloc })),
)

const INDICATORS = {
  agriculturePct: 'NV.AGR.TOTL.ZS',
  industryPct: 'NV.IND.TOTL.ZS',
  manufacturingPct: 'NV.IND.MANF.ZS',
  servicesPct: 'NV.SRV.TOTL.ZS',
  oilRentsPct: 'NY.GDP.PETR.RT.ZS',
  gasRentsPct: 'NY.GDP.NGAS.RT.ZS',
  coalRentsPct: 'NY.GDP.COAL.RT.ZS',
  mineralRentsPct: 'NY.GDP.MINR.RT.ZS',
  mfgFoodPct: 'NV.MNF.FBTO.ZS.UN',
  mfgTextilePct: 'NV.MNF.TXTL.ZS.UN',
  mfgChemicalPct: 'NV.MNF.CHEM.ZS.UN',
  mfgMachineryTransportPct: 'NV.MNF.MTRN.ZS.UN',
  mfgOtherPct: 'NV.MNF.OTHR.ZS.UN',
}
// 세계 합계는 블록에서 빼야 해서 따로 받는다
const WORLD_INDICATORS = {
  gdpUsd: 'NY.GDP.MKTP.CD',
  population: 'SP.POP.TOTL',
  laborForce: 'SL.TLF.TOTL.IN',
  grossCapitalFormationPctGdp: 'NE.GDI.TOTL.ZS',
  householdConsumptionUsd: 'NE.CON.PRVT.CD',
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let calls = 0
async function getJson(url: string): Promise<any> {
  const file = resolve(RAW, createHash('sha1').update(url).digest('hex').slice(0, 16) + '.json')
  if (!fresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  for (let attempt = 0; ; attempt++) {
    await sleep(1200)
    calls++
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000) })
      if (res.status === 429 || res.status >= 500) throw new Error(String(res.status))
      if (!res.ok) throw new Error(`${res.status} ${url}`)
      const body = await res.json()
      writeFileSync(file, JSON.stringify(body))
      return body
    } catch (e) {
      if (attempt >= 5) throw e
      await sleep(3000 * (attempt + 1))
    }
  }
}

const WB = 'https://api.worldbank.org/v2/country'
type Obs = { value: number; year: number } | null
async function latest(isos: string[], ind: string): Promise<Record<string, Obs>> {
  const body = await getJson(`${WB}/${isos.join(';')}/indicator/${ind}?date=2015:2023&format=json&per_page=2000`)
  const out: Record<string, Obs> = Object.fromEntries(isos.map((i) => [i, null]))
  for (const r of body[1] ?? []) {
    const iso = r.countryiso3code || r.country?.id
    if (!(iso in out) || r.value == null) continue
    const cur = out[iso]
    if (!cur || Number(r.date) > cur.year) out[iso] = { value: r.value, year: Number(r.date) }
  }
  return out
}

const isos = [...members.filter((m) => m.iso !== 'TWN').map((m) => m.iso), 'WLD']
const countries: Record<string, Record<string, Obs>> = Object.fromEntries(isos.map((i) => [i, {}]))
console.log(`World Bank 생산 구조: 지표 ${Object.keys(INDICATORS).length}개 × 나라 ${isos.length}곳`)
for (const [key, ind] of Object.entries(INDICATORS)) {
  const r = await latest(isos, ind)
  for (const iso of isos) countries[iso][key] = r[iso]
}
const world: Record<string, Obs> = {}
for (const [key, ind] of Object.entries(WORLD_INDICATORS)) world[key] = (await latest(['WLD'], ind)).WLD

writeFileSync(
  resolve(OUT, 'production-2023.json'),
  JSON.stringify(
    {
      meta: {
        source: `World Bank WDI API (${[...Object.values(INDICATORS), ...Object.values(WORLD_INDICATORS)].join(', ')}), latest value 2015–2023`,
        fetched: new Date().toISOString().slice(0, 10),
        note: '대만은 World Bank에 없다. data/v2/manual-2023.json 참고. 값 단위는 % (GDP 또는 제조업 부가가치 대비)',
      },
      countries: Object.fromEntries(Object.entries(countries).map(([iso, v]) => [iso, { bloc: members.find((m) => m.iso === iso)?.bloc ?? null, ...v }])),
      world,
    },
    null,
    1,
  ),
)
const empty = Object.entries(countries).flatMap(([iso, v]) => Object.entries(v).filter(([, o]) => !o).map(([k]) => `${iso}.${k}`))
console.log(`\n끝: 호출 ${calls}회. 빈 값 ${empty.length}개: ${empty.join(', ')}`)
console.log('data/v2/production-2023.json')
