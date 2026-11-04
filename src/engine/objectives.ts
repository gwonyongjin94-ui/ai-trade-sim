import type { CountryId, QuarterResult } from './types'
import { rival } from './types'

// 대통령의 목표. 임기(기본 4년 = 16분기) 단위로 평가한다.
export type ObjectiveKind = 'absolute' | 'relative'

export const OBJECTIVE_LABEL: Record<ObjectiveKind, string> = {
  absolute: '절대 이익',
  relative: '상대 이익',
}

// 절대 이익 점수의 임기 말 자본 가중치. 임기 뒤 국민 생활수준에 남기는 효과를 점수에 넣는다.
// 엔진으로 잰 값: 시작 상태에서 자본을 1% 늘리면 다음 임기(16분기) 평균 생활수준이 약 0.29 오른다 (양국 같음). 반올림해 0.3.
export const CAPITAL_WEIGHT = 0.3

export const OBJECTIVE_TEXT: Record<ObjectiveKind, (termQuarters: number) => string> = {
  absolute: (n) =>
    `다음 점수를 최대화하라: 임기 ${n}분기 동안 우리 국민의 생활수준 지수(실질소비 × (1 − 필수재 부족 페널티), 게임 시작 = 100)의 분기 평균 + ${CAPITAL_WEIGHT} × (임기 말 자본 지수 − 100). 자본 지수는 우리나라 전체 자본(설비) 스톡이다(게임 시작 = 100). 두 번째 항은 임기 뒤 국민 생활수준에 남기는 효과다: 자본이 1% 많으면 다음 임기 생활수준이 평균 약 ${CAPITAL_WEIGHT} 높아진다. 상대국의 성과는 그 자체로는 중요하지 않다.`,
  relative: (n) =>
    `임기 ${n}분기가 끝나는 시점에 상대국 대비 우리 실질 GDP 비율 지수(우리 실질 GDP ÷ 상대국 실질 GDP, 게임 시작 = 100)를 최대화하라. 우리 경제가 줄어들더라도 상대국이 더 많이 줄면 성공이다.`,
}

// 임기 중 분기 결과로 목표 점수를 계산한다. 마지막 결과가 임기 말이다.
// staticMode: 한 분기만 보는 정적 평가 (Ossa 2014 비교용). 투자도 후생에 넣는 후생 지수(실질소득)를 쓰고,
// 상대 이익은 후생 비율로 본다. 한 분기 안에서는 GDP가 거의 움직이지 않기 때문이다.
export function objectiveScore(results: QuarterResult[], c: CountryId, kind: ObjectiveKind, staticMode = false): number {
  if (results.length === 0) return NaN
  if (staticMode) {
    const w = results[results.length - 1].indicators
    return kind === 'absolute' ? w[c].welfare : (100 * w[c].welfare) / w[rival(c)].welfare
  }
  if (kind === 'absolute') {
    const ls = results.reduce((s, r) => s + r.indicators[c].livingStandard, 0) / results.length
    return ls + CAPITAL_WEIGHT * (results[results.length - 1].indicators[c].capital - 100)
  }
  const last = results[results.length - 1]
  return (100 * last.indicators[c].realGdp) / last.indicators[rival(c)].realGdp
}
