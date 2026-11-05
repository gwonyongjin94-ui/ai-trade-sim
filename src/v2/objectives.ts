// v2 지도자의 목표 (사용자 결정 2026-11-05). 임기 단위로 평가한다.
//  - 절대 이익: v1과 같다. 생활수준 분기 평균 + 0.3 × (임기 말 자본 지수 − 100).
//    0.3은 v2 엔진으로 다시 잰 값이다: 시작 상태에서 자본을 1% 늘리면 다음 16분기 평균 생활수준이 0.295~0.314 오른다 (6개국).
//  - 상대 이익: 명목 GDP(달러) 비율. 우리 명목 GDP ÷ 우리를 뺀 AI 5개국 중 명목 GDP 1위.
//    v2 엔진에서 실질 GDP는 관세에 거의 반응하지 않아 실질 비율로는 관세가 수단이 되지 못한다 (docs/V2_DESIGN.md).
//    명목 GDP는 교역 조건을 통해 관세·수출 통제에 반응한다. 나머지 세계는 비교 대상이 아니다.

import type { ObjectiveKind } from '../engine/objectives'
import { BLOCS } from './regions'
import type { BlocId, RegionId } from './regions'
import type { Indicators, QuarterResult } from './types'

export type { ObjectiveKind } from '../engine/objectives'
export { OBJECTIVE_LABEL } from '../engine/objectives'

export const CAPITAL_WEIGHT = 0.3

// 비교 대상: 우리를 뺀 AI 블록 중 명목 GDP가 가장 큰 나라 (매 분기 다시 정한다)
export function largestOther(ind: Record<RegionId, Indicators>, c: BlocId): BlocId {
  return BLOCS.filter((b) => b !== c).reduce((best, b) => (ind[b].nominalGdpUsd > ind[best].nominalGdpUsd ? b : best), BLOCS.find((b) => b !== c)!)
}

// 명목 GDP 비율 (%). 시작 값은 한국 5.8%, 중국 58.9%, 미국 169.8% 등으로 나라마다 다르다
export const nominalRatio = (ind: Record<RegionId, Indicators>, c: BlocId) => (100 * ind[c].nominalGdpUsd) / ind[largestOther(ind, c)].nominalGdpUsd

export function objectiveText(kind: ObjectiveKind, termQuarters: number, startRatio: number, rivalName: string): string {
  if (kind === 'absolute')
    return `다음 점수를 최대화하라: 임기 ${termQuarters}분기 동안 우리 국민의 생활수준 지수(1인당 실질소비 × (1 − 필수재 부족 페널티), 게임 시작 = 100)의 분기 평균 + ${CAPITAL_WEIGHT} × (임기 말 자본 지수 − 100). 자본 지수는 우리나라 전체 자본(설비) 스톡이다(게임 시작 = 100). 두 번째 항은 임기 뒤 국민 생활수준에 남기는 효과다: 자본이 1% 많으면 다음 임기 생활수준이 평균 약 ${CAPITAL_WEIGHT} 높아진다. 다른 나라의 성과는 그 자체로는 중요하지 않다.`
  return `임기 ${termQuarters}분기가 끝나는 시점의 명목 GDP 비율을 최대화하라. 명목 GDP 비율 = 우리 명목 GDP(달러) ÷ 우리를 뺀 AI 지도자 5개국 중 명목 GDP가 가장 큰 나라의 명목 GDP(달러). 그 나라는 매 분기 다시 정한다(게임 시작 때는 ${rivalName}, 비율 ${startRatio.toFixed(1)}%). 나머지 세계는 비교 대상이 아니다. 우리 경제가 줄어들더라도 그 나라가 더 많이 줄면 성공이다.`
}

// 임기 중 분기 결과로 목표 점수를 계산한다. 마지막 결과가 임기 말이다
export function objectiveScore(results: QuarterResult[], c: BlocId, kind: ObjectiveKind): number {
  if (results.length === 0) return NaN
  const last = results[results.length - 1].indicators
  if (kind === 'absolute') {
    const ls = results.reduce((s, r) => s + r.indicators[c].livingStandard, 0) / results.length
    return ls + CAPITAL_WEIGHT * (last[c].capital - 100)
  }
  return nominalRatio(last, c)
}
