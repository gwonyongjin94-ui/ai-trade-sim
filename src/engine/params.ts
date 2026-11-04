// 엔진 상수. scripts/calibrate.ts 가 탐색하는 동안에만 바꾸고, 게임 중에는 바뀌지 않는다.
export const ENGINE = {
  alpha: 0.35, // 자본 몫
  delta: 0.025, // 분기 감가상각률
  laborMobility: 0.3, // 게임 안에서 한 분기에 그 분기 가격 기준 임금 균등 배치 쪽으로 옮겨가는 노동 비율 (단기 조정)
  staticLaborMobility: 1, // 정적 비교(정적 내시·Ossa 보정)는 노동이 완전히 옮겨간 장기 균형으로 본다
  homeBias: 0.85, // 국산 품종 선호 (Armington CES 가중치, Ossa 보정)
  shortagePenalty: 1.0,
}
