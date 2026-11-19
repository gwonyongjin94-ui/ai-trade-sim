// 지도 자료가 원자료와 맞는지, 지도에 그릴 수 있는지 확인한다

import { describe, expect, it } from 'vitest'
import world from 'world-atlas/countries-50m.json'
import wdi from '../../data/world/wdi-2023.json'
import macro from '../../data/v2/macro-2023.json'
import { COUNTRIES, DATA, goodsMix, partners, people, usd, usdMillion, type TradeFile } from './data'
import { ANCHOR, viewFor } from './geo'

const atlasIds = new Set((world as unknown as { objects: { countries: { geometries: { id?: string }[] } } }).objects.countries.geometries.map((g) => g.id))
// public/ 아래 파일은 화면이 fetch로 읽는다. 테스트에서는 Vite glob으로 읽는다
const TRADE = import.meta.glob<TradeFile>('/public/data/trade-2023/*.json', { eager: true, import: 'default' })
const FLAGS = new Set(Object.keys(import.meta.glob('/public/flags/*.svg')))
const tradeFile = (iso: string) => TRADE[`/public/data/trade-2023/${iso}.json`]
const W = (wdi as unknown as { countries: Record<string, { values: Record<string, { value: number } | null> }> }).countries

describe('지도 자료', () => {
  it('전 세계 나라가 들어 있고, 지도 모양이 있는 나라는 배지 자리·국기·교역 파일을 가진다', () => {
    expect(COUNTRIES.length).toBeGreaterThan(200)
    const onMap = COUNTRIES.filter((c) => c.mapId)
    expect(onMap.length).toBeGreaterThan(190)
    for (const c of onMap) {
      if (c.mapId !== 'XKX') expect(atlasIds.has(c.mapId!), c.iso).toBe(true)
      expect(ANCHOR[c.iso], c.iso).toBeDefined()
    }
    for (const c of COUNTRIES) {
      expect(tradeFile(c.iso), c.iso).toBeDefined()
      if (c.flag) expect(FLAGS.has(`/public/flags/${c.iso2}.svg`), c.iso).toBe(true)
      expect(c.name, c.iso).toMatch(/[가-힣]/)
    }
    // 원래 지도에 있던 23개 나라는 모두 국기가 있다
    for (const iso of ['KOR', 'CHN', 'JPN', 'TWN', 'HKG', 'MAC', 'PRK', 'USA', 'CAN', 'MEX', 'SAU', 'ARE', 'IRN', 'ISR', 'YEM'])
      expect(DATA.countries[iso].flag, iso).toBe(true)
  })

  it('거시 값은 원자료 그대로다', () => {
    expect(DATA.countries.KOR.gdp!.value).toBe(W.KOR.values.gdpUsd!.value)
    expect(DATA.countries.DEU.population!.value).toBe(W.DEU.values.population!.value)
    expect(DATA.countries.BRA.structure!.manufacturingPct!.value).toBe(W.BRA.values.manufacturingPct!.value)
    const m = (macro as unknown as { countries: Record<string, { gdpUsd: { value: number } }> }).countries
    expect(DATA.countries.TWN.gdp).toMatchObject({ value: m.TWN.gdpUsd.value, source: 'IMF WEO' })
    expect(DATA.countries.PRK.gdp!.source).toBe('한국은행 추정')
    expect(DATA.countries.TWN.name).toBe('대만')
  })

  it('BACI는 한 값이다: A의 B로 수출 = B의 A로부터 수입', () => {
    const kor = tradeFile('KOR')
    const chn = tradeFile('CHN')
    const a = kor.export.find((r) => r[0] === 'CHN')!
    const b = chn.import.find((r) => r[0] === 'KOR')!
    expect(a).toEqual(b.map((v, i) => (i === 0 ? 'CHN' : v)))
  })

  it('나라 요약의 수출 총액과 품목 구성은 상대별 교역 파일의 합과 같다', () => {
    for (const iso of ['KOR', 'USA', 'DEU', 'BRA', 'NGA']) {
      const f = tradeFile(iso)
      const sum = f.export.reduce((s, r) => s + r[1], 0)
      const c = DATA.countries[iso]
      expect(c.merchExports!.value / 1e6, iso).toBeCloseTo(sum, -1)
      expect(goodsMix(iso, 'export').total, iso).toBeCloseTo(sum, -1)
      // 품목 10개의 합 = 상대 합계 (반올림 차이만큼)
      for (const r of f.export.slice(0, 5)) expect((r.slice(2) as number[]).reduce((s, v) => s + v, 0)).toBeCloseTo(r[1], 0)
    }
  })

  it('알려진 교역 순위가 맞다', () => {
    const top = (iso: string, dir: 'export' | 'import', good: string | null = null) => partners(tradeFile(iso), dir, good).map((r) => r.iso)
    expect(top('USA', 'export').slice(0, 2).sort()).toEqual(['CAN', 'MEX'])
    expect(top('KOR', 'export').slice(0, 2).sort()).toEqual(['CHN', 'USA'])
    expect(top('CHN', 'export')).toContain('HKG')
    expect(top('TWN', 'export', 'semiconductors').slice(0, 3)).toContain('CHN')
    const rows = partners(tradeFile('KOR'), 'export', null)
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].value).toBeGreaterThanOrEqual(rows[i].value)
  })

  it('고른 나라에 맞는 지도를 고른다', () => {
    expect(viewFor('KOR')).toBe('pacific')
    expect(viewFor('USA')).toBe('pacific')
    expect(viewFor('DEU')).toBe('atlantic')
    expect(viewFor('BRA')).toBe('atlantic')
    expect(viewFor('SAU')).toBe('atlantic')
  })

  it('한국식 숫자 표기', () => {
    expect(usd(1844800934391.54)).toBe('1.8조 달러')
    expect(usdMillion(161739.4)).toBe('1,617억 달러')
    expect(usdMillion(3.2)).toBe('320만 달러')
    expect(people(51712619)).toBe('5,171만 명')
    expect(people(1410710000)).toBe('14.1억 명')
  })
})
