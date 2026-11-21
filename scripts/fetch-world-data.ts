// 전 세계 나라의 2023년 거시 지표를 World Bank API에서 받는다 (무료 공개 API, 키 없음).
//   npm run world:wdi
// 원 응답은 data/raw/에 캐시하고(커밋 안 함), 줄인 결과만 data/world/wdi-2023.json에 쓴다.
// 2023년 값이 비어 있으면 2015~2023 중 가장 최근 값을 쓰고, 그 연도를 함께 적는다.
// 호출: 나라 목록 1번 + 지표 14개 = 15번. 관세 3개는 2026-11-22에 더했다 (사용자 승인).
// 관세는 적용 관세(AHS, FTA 특혜세율 반영)의 수입액 가중 평균이고, 해마다 늦게 나와 최신 값이 2021~2022년인 나라가 많다.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const RAW = resolve(ROOT, 'data/raw')
const OUT = resolve(ROOT, 'data/world/wdi-2023.json')
const YEAR = 2023
const FROM = 2015
const WB = 'https://api.worldbank.org/v2'

export const WDI = {
  population: 'SP.POP.TOTL',
  laborForce: 'SL.TLF.TOTL.IN',
  gdpUsd: 'NY.GDP.MKTP.CD',
  investmentPct: 'NE.GDI.TOTL.ZS',
  exportsPct: 'NE.EXP.GNFS.ZS',
  importsPct: 'NE.IMP.GNFS.ZS',
  agriculturePct: 'NV.AGR.TOTL.ZS',
  industryPct: 'NV.IND.TOTL.ZS',
  manufacturingPct: 'NV.IND.MANF.ZS',
  servicesPct: 'NV.SRV.TOTL.ZS',
  resourceRentsPct: 'NY.GDP.TOTL.RT.ZS',
  tariffAllPct: 'TM.TAX.MRCH.WM.AR.ZS', // 적용 관세, 전 품목, 가중 평균 (%)
  tariffManufPct: 'TM.TAX.MANF.WM.AR.ZS', // 적용 관세, 공산품, 가중 평균 (%)
  tariffPrimaryPct: 'TM.TAX.TCOM.WM.AR.ZS', // 적용 관세, 1차 산품, 가중 평균 (%)
} as const

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let calls = 0
async function getJson(url: string): Promise<any> {
  const file = resolve(RAW, createHash('sha1').update(url).digest('hex').slice(0, 16) + '.json')
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  for (let attempt = 0; ; attempt++) {
    await sleep(800)
    calls++
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000) })
      if (!res.ok) throw new Error(`${res.status} ${url}`)
      const body = await res.json()
      writeFileSync(file, JSON.stringify(body))
      return body
    } catch (e) {
      if (attempt >= 4) throw e
      console.warn(`  ${(e as Error).message}, 다시 시도`)
      await sleep(3000 * (attempt + 1))
    }
  }
}

mkdirSync(RAW, { recursive: true })
mkdirSync(resolve(ROOT, 'data/world'), { recursive: true })

// 나라 목록: 지역 묶음(aggregate)을 빼고 실제 나라·지역만
const meta = await getJson(`${WB}/country?format=json&per_page=400`)
type WbCountry = { id: string; iso2Code: string; name: string; region: { id: string; value: string }; incomeLevel: { id: string; value: string } }
const economies = (meta[1] as WbCountry[]).filter((c) => c.region.id !== 'NA')
const countries: Record<string, { iso2: string; nameEn: string; region: string; income: string; values: Record<string, { value: number; year: number } | null> }> = {}
for (const c of economies) {
  countries[c.id] = { iso2: c.iso2Code, nameEn: c.name, region: c.region.id, income: c.incomeLevel.id, values: {} }
}

for (const [key, ind] of Object.entries(WDI)) {
  console.log(`World Bank ${ind}`)
  const body = await getJson(`${WB}/country/all/indicator/${ind}?date=${FROM}:${YEAR}&format=json&per_page=20000`)
  const rows = (body[1] ?? []) as { countryiso3code: string; date: string; value: number | null }[]
  for (const c of Object.values(countries)) c.values[key] = null
  for (const r of rows) {
    const c = countries[r.countryiso3code]
    if (!c || r.value == null) continue
    const cur = c.values[key]
    if (!cur || Number(r.date) > cur.year) c.values[key] = { value: r.value, year: Number(r.date) }
  }
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      meta: {
        source: 'World Bank World Development Indicators (api.worldbank.org)',
        fetched: new Date().toISOString().slice(0, 10),
        note: `${YEAR}년 값이 없으면 ${FROM}~${YEAR} 중 가장 최근 값`,
        indicators: WDI,
      },
      countries,
    },
    null,
    1,
  ),
)
const n = Object.keys(countries).length
const gdp2023 = Object.values(countries).filter((c) => c.values.gdpUsd?.year === YEAR).length
console.log(`나라 ${n}곳 (2023년 GDP가 있는 곳 ${gdp2023}), 새로 부른 횟수 ${calls} → ${OUT}`)
