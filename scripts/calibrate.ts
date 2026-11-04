// 보정: 정적 내시(양국 절대 이익)가 Ossa(2014)의 무역전쟁 결과에 가깝도록 엔진 상수를 격자 탐색한다 (무료).
//   npx tsx scripts/calibrate.ts
//   npx tsx scripts/calibrate.ts --mobility 0.5,1 --home 0.7,0.8 --sigma 1.5,2 --spread 0.6,0.8
//
// 목표: 평균 내시 관세 63%, 현상 유지 대비 후생 변화 평균 −2.9% (Ossa 2014, 7개 지역 평균)
// 탐색 변수
//   mobility: 정적 비교에서 임금 균등 배치 쪽으로 옮겨가는 노동 비율 (ENGINE.staticLaborMobility, 1 = 완전 이동)
//   home:     국산 품종 선호 (높을수록 교역 비중이 낮다)
//   sigma:    대체탄력성 배율. σ' = 1 + 배율 × (σ − 1) (물품 간 순서 유지)
//   spread:   생산성 격차 압축. 두 나라 생산성의 기하평균을 m이라 할 때 A' = m·(A/m)^spread (1 = 그대로)
// 배율과 압축은 지금 goods.ts 값 기준이다 (이미 보정된 값). 1, 1이면 현재 값 그대로.
// 결과: reports/<out>.md, reports/<out>.json (기본 calibration-grid. 채택 기록은 reports/calibration.md)

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GOODS } from '../src/engine/goods'
import { nashEquilibrium } from '../src/engine/nash'
import { ENGINE } from '../src/engine/params'
import { clearWorldCache, createWorld, evaluateQuarter, statusQuoPolicy } from '../src/engine/world'

const ROOT = resolve(import.meta.dirname, '..')
const TARGET = { tariff: 0.63, welfare: -2.9 }

const argv = process.argv.slice(2)
const list = (k: string, d: number[]) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1].split(',').map(Number) : d
}
const outIdx = argv.indexOf('--out')
const out = outIdx >= 0 ? argv[outIdx + 1] : 'calibration-grid'
const grid = {
  mobility: list('mobility', [1]),
  home: list('home', [0.8, 0.85, 0.9]),
  sigma: list('sigma', [0.8, 1, 1.25]),
  spread: list('spread', [0.85, 1, 1.15]),
}

const original = GOODS.map((g) => ({ sigma: g.substitutionElasticity, productivity: { ...g.productivity } }))
const originalEngine = { ...ENGINE }

function applyCandidate(c: { mobility: number; home: number; sigma: number; spread: number }) {
  ENGINE.staticLaborMobility = c.mobility
  ENGINE.homeBias = c.home
  GOODS.forEach((g, i) => {
    const o = original[i]
    g.substitutionElasticity = 1 + c.sigma * (o.sigma - 1)
    const m = Math.sqrt(o.productivity.A * o.productivity.B)
    g.productivity = { A: m * Math.pow(o.productivity.A / m, c.spread), B: m * Math.pow(o.productivity.B / m, c.spread) }
  })
  clearWorldCache()
}

interface Row {
  mobility: number
  home: number
  sigma: number
  spread: number
  tariff: number
  tariffA: number
  tariffB: number
  welfareA: number
  welfareB: number
  welfare: number
  converged: boolean
  opennessA: number
  opennessB: number
  energyDepA: number
  loss: number
  seconds: number
}

const rows: Row[] = []
const total = grid.mobility.length * grid.home.length * grid.sigma.length * grid.spread.length
let n = 0
for (const mobility of grid.mobility)
  for (const home of grid.home)
    for (const sigma of grid.sigma)
      for (const spread of grid.spread) {
        const t = performance.now()
        applyCandidate({ mobility, home, sigma, spread })
        const world = createWorld()
        const sq = { A: statusQuoPolicy(), B: statusQuoPolicy() }
        const start = evaluateQuarter(world, sq, ENGINE.staticLaborMobility).indicators
        const nash = nashEquilibrium(world, sq, { horizon: 1, objectives: { A: 'absolute', B: 'absolute' }, groups: 'good' })
        const w = nash.results[0].indicators
        const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
        const row: Row = {
          mobility,
          home,
          sigma,
          spread,
          tariff: mean([...nash.policies.A.tariffs, ...nash.policies.B.tariffs]),
          tariffA: mean(nash.policies.A.tariffs),
          tariffB: mean(nash.policies.B.tariffs),
          welfareA: w.A.welfare - start.A.welfare,
          welfareB: w.B.welfare - start.B.welfare,
          welfare: (w.A.welfare - start.A.welfare + w.B.welfare - start.B.welfare) / 2,
          converged: nash.converged,
          opennessA: start.A.tradeOpenness,
          opennessB: start.B.tradeOpenness,
          energyDepA: start.A.importDependence[1],
          loss: 0,
          seconds: (performance.now() - t) / 1000,
        }
        row.loss = ((row.tariff - TARGET.tariff) / 0.1) ** 2 + (row.welfare - TARGET.welfare) ** 2 + (row.converged ? 0 : 4)
        rows.push(row)
        n++
        console.log(
          `[${n}/${total}] m=${mobility} h=${home} σ×${sigma} spread=${spread} → 관세 ${(row.tariff * 100).toFixed(0)}% 후생 A ${row.welfareA.toFixed(2)} B ${row.welfareB.toFixed(2)} 개방도 ${(row.opennessA * 100).toFixed(0)}/${(row.opennessB * 100).toFixed(0)}% ${row.converged ? '' : '미수렴 '}loss ${row.loss.toFixed(2)} (${row.seconds.toFixed(1)}s)`,
        )
      }

// 원래 값 복구 (같은 프로세스에서 다른 계산을 이어갈 때를 위해)
Object.assign(ENGINE, originalEngine)
applyCandidate({ mobility: originalEngine.staticLaborMobility, home: originalEngine.homeBias, sigma: 1, spread: 1 })

rows.sort((a, b) => a.loss - b.loss)
const pct = (x: number) => `${(x * 100).toFixed(0)}%`
const md = [
  '# 보정: Ossa (2014) 수준 맞추기',
  '',
  `목표: 정적 내시(양국 절대 이익, 물품별 관세) 평균 관세 ${pct(TARGET.tariff)}, 현상 유지 대비 후생 변화 평균 ${TARGET.welfare}%. 후생 = 생활수준을 반영한 소비 + 실질 투자.`,
  `손실 = ((관세 − 63%)/10%p)² + (후생 − (−2.9))² (+4 미수렴). 후보 ${rows.length}개.`,
  '',
  '| 순위 | 노동 이동 | 자국 편향 | σ 배율 | 생산성 격차 | 평균 관세 (A/B) | 후생 A | 후생 B | 개방도 A/B | A 에너지 수입의존 | 수렴 | 손실 |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.slice(0, 20).map(
    (r, i) =>
      `| ${i + 1} | ${r.mobility} | ${r.home} | ${r.sigma} | ${r.spread} | ${pct(r.tariff)} (${pct(r.tariffA)}/${pct(r.tariffB)}) | ${r.welfareA.toFixed(2)}% | ${r.welfareB.toFixed(2)}% | ${pct(r.opennessA)}/${pct(r.opennessB)} | ${pct(r.energyDepA)} | ${r.converged ? '예' : '아니오'} | ${r.loss.toFixed(2)} |`,
  ),
  '',
]
mkdirSync(resolve(ROOT, 'reports'), { recursive: true })
writeFileSync(resolve(ROOT, `reports/${out}.md`), md.join('\n') + '\n')
writeFileSync(resolve(ROOT, `reports/${out}.json`), JSON.stringify({ target: TARGET, grid, rows }, null, 1))
console.log('\n상위 5개')
for (const r of rows.slice(0, 5)) console.log(JSON.stringify(r))
