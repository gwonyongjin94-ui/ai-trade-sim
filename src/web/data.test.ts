// 지도 자료가 원자료(data/v2)와 맞는지, 지도에 그릴 수 있는지 확인한다

import { describe, expect, it } from 'vitest'
import world from 'world-atlas/countries-50m.json'
import macro from '../../data/v2/macro-2023.json'
import trade from '../../data/v2/trade-2023.json'
import { COUNTRIES, DATA, goodsMix, partners, people, usd, usdMillion } from './data'
import { ANCHOR, PRIORITY } from './geo'
import { flagUrl } from './flags'

const atlasIds = new Set((world as unknown as { objects: { countries: { geometries: { id: string }[] } } }).objects.countries.geometries.map((g) => g.id))

describe('지도 자료', () => {
  it('모든 나라가 지도 모양·배지 자리·국기를 가진다', () => {
    expect(COUNTRIES).toHaveLength(23)
    for (const c of COUNTRIES) {
      expect(atlasIds.has(c.mapId), c.iso).toBe(true)
      expect(ANCHOR[c.iso], c.iso).toBeDefined()
      expect(PRIORITY[c.iso], c.iso).toBeDefined()
      expect(flagUrl(c.iso2).length, c.iso).toBeGreaterThan(100)
    }
  })

  it('거시 값은 원자료 그대로다', () => {
    const m = (macro as unknown as { countries: Record<string, { gdpUsd: { value: number } | null; population: { value: number } }> }).countries
    expect(DATA.countries.KOR.gdp!.value).toBe(m.KOR.gdpUsd!.value)
    expect(DATA.countries.CHN.population!.value).toBe(m.CHN.population.value)
    expect(DATA.countries.TWN.gdp!.source).toBe('IMF WEO')
    expect(DATA.countries.PRK.gdp!.source).toBe('한국은행 추정')
  })

  it('블록 사이 교역은 trade-2023.json의 나라 쌍 값과 같다', () => {
    const p = (trade as unknown as { pairFlows: { from: number; to: number; values: Record<string, number> }[] }).pairFlows.find(
      (x) => x.from === 410 && x.to === 156,
    )!
    const total = Object.values(p.values).reduce((s, v) => s + v, 0)
    const f = DATA.flows.find((x) => x.from === 'KOR' && x.to === 'CHN')!
    expect(f.total).toBeCloseTo(total, 0)
    expect(f.values.semiconductors).toBeCloseTo(p.values.semiconductors, 0)
  })

  it('같은 블록 안 교역도 들어 있다 (미국의 최대 수출 상대는 캐나다·멕시코)', () => {
    const top = partners('USA', 'export', null).slice(0, 2).map((r) => r.iso)
    expect(top.sort()).toEqual(['CAN', 'MEX'])
    expect(partners('CHN', 'export', null).some((r) => r.iso === 'HKG')).toBe(true)
  })

  it('교역 상대는 큰 순이고, 품목 구성의 합은 상대별 합과 같다', () => {
    const rows = partners('KOR', 'export', null)
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].value).toBeGreaterThanOrEqual(rows[i].value)
    const mix = goodsMix('KOR', 'export')
    expect(mix.total).toBeCloseTo(rows.reduce((s, r) => s + r.value, 0), 0)
  })

  it('한국식 숫자 표기', () => {
    expect(usd(1844800934391.54)).toBe('1.8조 달러')
    expect(usdMillion(161739.4)).toBe('1,617억 달러')
    expect(usdMillion(3.2)).toBe('320만 달러')
    expect(people(51712619)).toBe('5,171만 명')
    expect(people(1410710000)).toBe('14.1억 명')
  })
})
