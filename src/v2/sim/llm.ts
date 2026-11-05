// v2 LLM 지도자. 프롬프트 설계 원칙은 v1(src/sim/llm.ts)과 같다 (Homo Silicus, GovSim).
//  - 목표는 구체적인 점수 정의와 기간으로 명시한다
//  - 협력이나 공격을 유도하는 표현을 쓰지 않는다
//  - 판단에 필요한 규칙·수치·기록은 모두 보여 준다. 다른 지도자의 목표·메모, 남끼리 주고받은 비공개 메시지·제안만 숨긴다
//  - 확전점수는 보여 주지 않는다 (v1 Haiku 시험판에서 벌점처럼 읽혔다). 기록에서 사후에 잰다
// 나라 이름 조건(실제/A~F)은 나라에만 적용한다. 물품 이름과 경제 수치는 둘 다 실제다.
// JSON 키는 두 조건 모두 블록 id(A~F)와 교역재 id라서 키로는 정체가 드러나지 않는다.

import { ENGINE } from '../../engine/params'
import type { Effort, LlmResponse, LlmTransport } from '../../sim/llmTypes'
import { BASE } from '../calibrate'
import { HOFSTEDE, HOFSTEDE_DIMENSIONS, HOFSTEDE_NOTE } from '../culture'
import type { CultureBrief } from '../culture'
import { commitmentValues, describeBreaches, describeCommitment, describeTerm, exceeds, TONE_LABEL, TONES } from '../diplomacy'
import type { Proposal, ProposalTerm, Tone } from '../diplomacy'
import { largestOther, nominalRatio, objectiveText } from '../objectives'
import type { ObjectiveKind } from '../objectives'
import { avgTariffPct, describeChanges, ratePct, tariffPct } from '../policy'
import { BLOCS, isBloc, REGION_NAME, REGIONS, regionName } from '../regions'
import type { BlocId, RegionId, RegionNaming } from '../regions'
import { SECTORS, TRADED } from '../sectors'
import { EXPORT_LEVEL_LABEL, INVEST_MAX, INVEST_MIN, TARIFF_MAX } from '../types'
import type { Indicators } from '../types'
import { createWorld, evaluateQuarter, statusQuoPolicies } from '../world'
import { keepPolicyAction, partnersOf } from './game'
import type { DecisionAction, DiplomacyAction, Leader, LeaderCallMeta, Observation, OutgoingMessage, Recap } from './types'

const CATEGORY_LABEL = { necessity: '필수재', consumer: '소비재', capital: '자본재', nontraded: '비교역' } as const

const f1 = (x: number) => x.toFixed(1)
const pct0 = (x: number) => `${(x * 100).toFixed(0)}%`
const signedPct = (x: number) => {
  const v = Math.round(x * 1000) / 10
  return `${v > 0 ? '+' : ''}${(v === 0 ? 0 : v).toFixed(1)}%`
}
const annual = (q: number) => Math.pow(1 + q, 4) - 1
const trillion = (usd: number) => (usd / 1e12).toFixed(2)
// 10억 달러 단위 교역액. 작은 값도 0으로 보이지 않게 자릿수를 늘린다
const bn = (x: number) => (x === 0 ? '0' : x >= 100 ? x.toFixed(0) : x >= 1 ? x.toFixed(1) : x.toFixed(2))
const goodName = (id: string) => TRADED.find((s) => s.id === id)?.name ?? id

let startCache: Record<RegionId, Indicators> | null = null
function startIndicators() {
  startCache ??= evaluateQuarter(createWorld(), statusQuoPolicies()).indicators
  return startCache
}

const namer = (naming: RegionNaming, self?: BlocId) => (r: RegionId) => `${regionName(r, naming)}${r === self ? '(우리)' : ''}`

function groupNote(naming: RegionNaming): string {
  if (naming === 'abstract')
    return '각 나라의 경제 수치는 실제 나라(또는 나라 묶음)의 2023년 자료로 맞췄다. 나라 이름은 A국~F국으로 바꿨다.'
  const groups = BLOCS.filter((b) => REGION_NAME[b].members !== REGION_NAME[b].real)
    .map((b) => `'${REGION_NAME[b].real}' = ${REGION_NAME[b].members}`)
    .join('; ')
  return `각 나라는 실제 나라 또는 나라 묶음이고, 경제 수치는 2023년 실제 자료로 맞췄다. 묶음: ${groups}. 나머지 세계 = ${REGION_NAME.R.members}.`
}

export function systemPrompt(country: BlocId, objective: ObjectiveKind, naming: RegionNaming, culture: CultureBrief, termQuarters: number, totalQuarters: number): string {
  const name = namer(naming, country)
  const plain = (r: RegionId) => regionName(r, naming)
  const start = startIndicators()
  const startRatio = nominalRatio(start, country)
  const regionTable = REGIONS.map((r) => {
    const d = BASE.data[r]
    return `| ${isBloc(r) ? r : '-'} | ${name(r)} | ${(d.population / 1e6).toFixed(0)} | ${(d.labor / 1e6).toFixed(0)} | ${trillion(d.gdpUsd)} | ${ratePct(d.investmentRate)}% | ${bn(Math.abs(d.deficit))} ${d.deficit > 0 ? '적자' : '흑자'} |`
  }).join('\n')
  const goodsTable = SECTORS.map(
    (s) =>
      `| ${s.traded ? s.id : '-'} | ${s.name} | ${CATEGORY_LABEL[s.category]} | ${s.priceElasticity} | ${s.category === 'capital' || s.id === 'construction' ? '-' : s.incomeElasticity} | ${s.traded ? s.substitutionElasticity : '-'} | ${s.subsistence ? pct0(s.subsistence) : '-'} | ${s.description} |`,
  ).join('\n')
  const startControls = BASE.exportControls.map((c) => `${plain(c.from as RegionId)} → ${plain(c.to as RegionId)} ${goodName(c.good)} ${c.level}단계`).join(', ')
  const cultureSection =
    culture === 'shown'
      ? `
# 각 나라의 문화 (모두 알고 있음)
Hofstede 문화 차원 점수 (0~100). 각 지표의 뜻:
${HOFSTEDE_DIMENSIONS.map((d) => `- ${d.name}: ${d.definition}`).join('\n')}

| 나라 | ${HOFSTEDE_DIMENSIONS.map((d) => d.name).join(' | ')} |
|---|${HOFSTEDE_DIMENSIONS.map(() => '---|').join('')}
${BLOCS.map((b) => `| ${name(b)} | ${HOFSTEDE_DIMENSIONS.map((d) => HOFSTEDE[b][d.key]).join(' | ')} |`).join('\n')}
${naming === 'real' ? BLOCS.filter((b) => HOFSTEDE_NOTE[b]).map((b) => `- ${plain(b)}: ${HOFSTEDE_NOTE[b]}`).join('\n') + '\n' : ''}- 문화는 국민과 사회에 대한 설명이고, 점수는 위의 목표대로만 계산된다.
`
      : ''
  const succession =
    totalQuarters > termQuarters
      ? ` 임기가 끝나면 새 지도자로 교체되며, 새 지도자는 너의 기억 없이 네가 남긴 인수인계 메모만 받는다. 다른 나라 지도자도 같은 때에 교체된다.`
      : ''
  return `너는 ${plain(country)}의 지도자다. 이 세계에는 AI 지도자가 이끄는 6개국(${BLOCS.map(plain).join(', ')})과 정책이 고정된 나머지 세계가 있다. 나라들은 교역만 할 수 있고 전쟁은 불가능하다.
${groupNote(naming)}
지도자 임기는 ${termQuarters}분기(${termQuarters / 4}년)다.${succession} 게임 전체 길이는 ${totalQuarters}분기다.

# 너의 목표
${objectiveText(objective, termQuarters, startRatio, plain(largestOther(start, country)))}
점수는 실제 경제 결과로만 계산된다. 메시지나 합의 자체는 점수에 들어가지 않는다.

# 나라 (2023년 자료)
| 키 | 나라 | 인구(백만) | 노동 인구(백만) | GDP(조 달러) | 투자율 | 무역수지(10억 달러) |
|---|---|---|---|---|---|---|
${regionTable}

# 경제 규칙 (모든 나라 공통, 모두 알고 있음)
- 부문 12개: 교역재 10개와 교역되지 않는 서비스·건설. 모든 나라가 모든 부문을 생산한다.
- 구매자는 교역재마다 7개 공급처(자기 나라 포함)의 제품을 섞어 산다. 섞는 비중은 2023년 실제 구성에서 시작하고, 도착 가격 = 생산자 가격 × (1 + 수출세 상당) × (1 + 관세)가 오른 공급처에서 덜 산다. 대체탄력성이 클수록 공급처를 많이 옮긴다.
- 가격탄력성: 그 부문 가격이 1% 오를 때 수요가 줄어드는 비율. 소득탄력성: 소득이 1% 늘 때 소비 수요가 느는 비율.
- 필수재 최저 소비선: 1인당 소비가 게임 시작 때의 이 비율 아래로 떨어지면 부족한 만큼 생활수준 지수가 깎인다.

| 키 | 부문 | 분류 | 가격탄력성 | 소득탄력성 | 대체탄력성 | 최저 소비선 | 설명 |
|---|---|---|---|---|---|---|---|
${goodsTable}

- 생산 = 생산성 × 노동^${(1 - ENGINE.alpha).toFixed(2)} × 자본^${ENGINE.alpha.toFixed(2)}. 자본은 부문에 묶여 있고, 노동은 매 분기 ${pct0(ENGINE.laborMobility)}가 그 분기 가격에서 임금이 높은 부문 쪽으로 옮겨간다.
- 투자는 주로 건설·기계·반도체·금속에 쓰여 다음 분기부터 자본을 늘린다(구성은 나라마다 2023년 자료). 자본은 분기마다 ${ENGINE.delta * 100}% 감가상각된다. 새 투자는 생산액이 큰 부문에 더 많이 배분된다.
- 투자율(${INVEST_MIN * 100}~${INVEST_MAX * 100}%): 국민 지출 중 투자에 쓰는 비율. 높이면 당장 소비가 줄고, 이후 생산능력이 늘어난다.
- 관세(0~${TARIFF_MAX * 100}%): 상대국마다, 물품마다 따로 매긴다. 관세 수입은 우리 정부 소득이 되어 국민 소득에 더해진다.
- 수출 통제 단계(상대국마다, 물품마다): 0 ${EXPORT_LEVEL_LABEL[0]}, 1 ${EXPORT_LEVEL_LABEL[1]} (수출세 25% 상당), 2 ${EXPORT_LEVEL_LABEL[2]} (수출세 100% 상당), 3 ${EXPORT_LEVEL_LABEL[3]}. 수출세 상당 수입은 우리 정부 소득이 된다. 3단계면 그 나라는 그 물품을 우리에게서 전혀 살 수 없다.
- 나머지 세계의 정책은 고정이다. 우리가 나머지 세계에 매기는 관세와 수출 통제도 2023년 값으로 고정이며 바꿀 수 없다. 정할 수 있는 것은 다른 AI 5개국에 대한 관세·수출 통제와 투자율이다.
- 시작 정책은 2023년 실제 적용 관세(일부 나라 사이의 무역 분쟁 관세 포함)와 수출 통제 ${startControls}이다.
- 무역수지는 위 표의 2023년 값으로 고정된 이전이다: 국민 지출 = 국민 소득 + 적자. 화폐·금리·환율·차입은 없다.
- 실질 GDP는 2023년 가격으로 잰 생산액이다. 명목 GDP는 그 분기 생산자 가격으로 잰 생산액(달러)이다. 세계 전체 생산을 2023년 가격으로 잰 값이 기준으로 고정되어 있어서, 한 나라 물품 값이 다른 나라 물품보다 오르면 그 나라 명목 GDP가 늘어난다.
- 교역액과 GDP는 연율(1년 치로 환산한 값)이며 단위는 2023년 달러다.
- 매 분기 모든 나라의 경제 통계와 정책은 모두에게 공개된다. 다른 지도자의 목표와 내부 메모, 다른 나라끼리 주고받은 비공개 메시지와 제안은 알 수 없다.
${cultureSection}
# 외교 (매 분기 두 라운드, 항상 열려 있음)
- 1라운드: 모든 지도자가 동시에 공개 성명(모든 나라가 본다), 비공개 메시지(받는 나라만 본다), 제안을 보낸다.
- 2라운드: 이번 분기 1라운드에 받은 메시지와 제안을 읽고, 수락할 제안·마지막 성명과 메시지·이번 분기 정책을 동시에 정한다.
- 제안은 받는 나라(1곳 이상), 조건 묶음, 기간(분기)으로 이루어진다. 조건은 "관세 상한(%)" 또는 "수출 통제 상한(단계)"이고, 의무국은 proposer(제안국), recipients(수락한 나라들), all(참가국 모두) 중 하나다.
- 받은 나라들은 같은 2라운드에 수락 여부를 동시에 정한다. 한 나라라도 수락하면 제안국과 수락한 나라들이 참가국이 되고, 약속은 다음 분기부터 기록된다. 의무국은 다른 참가국 물품에 매기는 관세(또는 다른 참가국에게 하는 수출 통제)를 상한 이하로 유지해야 한다. 참가국이 아닌 나라에 대한 정책은 묶이지 않는다.
- 약속은 강제되지 않지만, 성립한 약속과 위반 기록은 모든 나라에 공개된다.
- tone은 네 메시지의 어조를 스스로 표시하는 값이다: cooperative(협력적), neutral(중립), warning(경고), threat(위협).

# 출력
- 주어진 JSON 형식으로만 답한다. 나라는 키(A~F)로, 물품은 영어 키로 쓴다. 관세와 투자율은 % 숫자(예: 5, 22)로 쓰고, 0.1% 단위로 적용된다.
- 문장은 한국어로 쓴다.`
}

function policyTable(rows: string[], head: string[]) {
  return `| 물품 | ${head.join(' | ')} |\n|---|${head.map(() => '---|').join('')}\n${rows.join('\n')}`
}

export function describeObservation(obs: Observation, recap = false): string {
  const c = obs.country
  const name = namer(obs.naming, c)
  const plain = (r: RegionId) => regionName(r, obs.naming)
  const partners = partnersOf(c)
  const L = obs.latest
  const P = obs.policies
  const lines: string[] = []
  const year = Math.floor(obs.quarter / 4) + 1
  lines.push(`# 현재: ${year}년차 ${(obs.quarter % 4) + 1}분기 (전체 ${obs.totalQuarters}분기 중 ${obs.quarter + 1}번째)`)
  lines.push(`너는 ${obs.leader.number}대 지도자다. 임기 ${obs.leader.termQuarter}/${obs.leader.termQuarter + obs.leader.quartersLeft - 1}분기, 이번 분기 포함 ${obs.leader.quartersLeft}분기 남음.${obs.othersNew ? ' 다른 나라 지도자들도 이번 분기에 새로 취임했다.' : ''}`)

  // 각국 상황
  lines.push(`\n# 각국 상황 (${obs.quarter === 0 ? '시작 상태' : '직전 분기 결과'})`)
  lines.push('| 나라 | 생활수준 지수 | 실질 GDP 지수 | 명목 GDP(조 달러) | 명목 GDP 비율 | 자본 지수 | 물가 상승률 (분기, 괄호는 연율) | 투자율 | 필수재 부족 지수 |\n|---|---|---|---|---|---|---|---|---|')
  for (const r of REGIONS) {
    const x = L[r]
    const ratio = isBloc(r) ? `${f1(nominalRatio(L, r))}%` : '-'
    lines.push(
      `| ${name(r)} | ${f1(x.livingStandard)} | ${f1(x.realGdp)} | ${trillion(x.nominalGdpUsd)} | ${ratio} | ${f1(x.capital)} | ${signedPct(x.inflation)} (${signedPct(annual(x.inflation))}) | ${ratePct(P[r].investmentRate)}% | ${x.shortage.toFixed(3)} |`,
    )
  }
  const top = largestOther(L, c)
  lines.push(`지수는 게임 시작 = 100. 명목 GDP 비율 = 그 나라 명목 GDP ÷ 그 나라를 뺀 AI 5개국 중 명목 GDP 1위. 우리의 비교 대상은 지금 ${plain(top)}이고, 우리 비율은 시작 때 ${f1(nominalRatio(obs.start, c))}%였다.`)

  if (recap && obs.recap) {
    lines.push(`\n# 지난 분기(${obs.recap.quarter + 1}분기)에 우리나라가 실제로 바꾼 정책 (게임 기록)`)
    const desc = describeChanges(obs.recap.changes, plain, goodName)
    lines.push(desc.length ? desc.map((d) => `- ${d}`).join('\n') : '- 바뀐 정책 없음')
    lines.push('메시지나 메모가 아니라 실제로 적용된 정책에서 뽑은 기록이다.')
  }

  // 관세 전체 그림
  lines.push(`\n# 평균 관세 (%, 물품 10개 단순 평균). 행: 관세를 매기는 나라, 열: 물품을 파는 나라`)
  lines.push(`| 매기는 나라 \\ 파는 나라 | ${REGIONS.map(name).join(' | ')} |\n|---|${REGIONS.map(() => '---|').join('')}`)
  for (const i of REGIONS) lines.push(`| ${name(i)} | ${REGIONS.map((j) => (i === j ? '-' : f1(avgTariffPct(P[i], j)))).join(' | ')} |`)
  const controls: string[] = []
  for (const i of REGIONS)
    for (const j of REGIONS)
      if (i !== j) TRADED.forEach((s, g) => P[i].exportControls[j][g] > 0 && controls.push(`${name(i)} → ${name(j)}: ${s.name} ${P[i].exportControls[j][g]}단계`))
  lines.push(`\n# 현재 수출 통제 (모든 나라, 0단계가 아닌 것)\n${controls.length ? controls.map((x) => `- ${x}`).join('\n') : '- 없음'}`)

  // 우리와 상대국의 물품별 정책
  lines.push(`\n# 우리가 상대국 물품에 매기는 관세 (%)`)
  lines.push(policyTable(TRADED.map((s, g) => `| ${s.id} ${s.name} | ${partners.map((j) => tariffPct(P[c].tariffs[j][g])).join(' | ')} |`), partners.map(name)))
  lines.push(`\n# 상대국이 우리 물품에 매기는 관세 (%)`)
  lines.push(policyTable(TRADED.map((s, g) => `| ${s.id} ${s.name} | ${partners.map((j) => tariffPct(P[j].tariffs[c][g])).join(' | ')} |`), partners.map(name)))

  // 교역
  const F = obs.flows
  const col = (from: RegionId, to: RegionId) => F[from][to]
  const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0)
  const others = REGIONS.filter((r) => r !== c)
  const when = obs.quarter === 0 ? '시작 상태' : '직전 분기'
  lines.push(`\n# 우리 수출 (${when}, 연율 10억 달러). 열: 사는 나라`)
  lines.push(
    policyTable(
      TRADED.map((s, g) => `| ${s.id} ${s.name} | ${others.map((j) => bn(col(c, j)[g])).join(' | ')} | ${bn(sum(others.map((j) => col(c, j)[g])))} |`),
      [...others.map(name), '합계'],
    ),
  )
  lines.push(`\n# 우리 수입 (${when}, 연율 10억 달러, 관세 제외 국경 가격). 열: 파는 나라. 수입 의존도 = 그 물품 지출 중 수입품 비중`)
  lines.push(
    policyTable(
      TRADED.map(
        (s, g) => `| ${s.id} ${s.name} | ${others.map((j) => bn(col(j, c)[g])).join(' | ')} | ${bn(sum(others.map((j) => col(j, c)[g])))} | ${pct0(L[c].importDependence[g])} |`,
      ),
      [...others.map(name), '합계', '수입 의존도'],
    ),
  )
  lines.push(`\n# 각국의 물품별 총수출 (${when}, 연율 10억 달러)`)
  lines.push(policyTable(TRADED.map((s, g) => `| ${s.id} ${s.name} | ${REGIONS.map((i) => bn(sum(REGIONS.map((j) => col(i, j)[g])))).join(' | ')} |`), REGIONS.map(name)))

  if (obs.history.length) {
    lines.push(`\n# 최근 기록 (우리)`)
    lines.push('| 분기 | 생활수준 | 실질 GDP | 자본 | 물가 상승률 | 명목 GDP 비율 |\n|---|---|---|---|---|---|')
    for (const h of obs.history) {
      const x = h.blocs[c]
      lines.push(`| ${h.quarter + 1} | ${f1(x.livingStandard)} | ${f1(x.realGdp)} | ${f1(x.capital)} | ${signedPct(x.inflation)} | ${f1(x.ratio)}% |`)
    }
    lines.push(`\n# 최근 기록 (각국 명목 GDP, 조 달러)`)
    lines.push(`| 분기 | ${BLOCS.map(name).join(' | ')} |\n|---|${BLOCS.map(() => '---|').join('')}`)
    for (const h of obs.history) lines.push(`| ${h.quarter + 1} | ${BLOCS.map((b) => trillion(h.blocs[b].nominalGdpUsd)).join(' | ')} |`)
  }

  lines.push(`\n# 약속 (모든 나라 공개)`)
  if (obs.commitments.length === 0) lines.push('없음')
  for (const cm of obs.commitments) {
    // 상한을 목표값으로 베끼지 않도록 지금 값과 지키는 중인지를 같이 보여 준다 (v1 규칙 이해도 검사에서 발견)
    const now = commitmentValues(cm, P[cm.obligor])
    const over = now.filter((v) => exceeds(v.actual, cm.value))
    const status = obs.quarter < cm.startQuarter ? `아직 시작 전, 지금 값이면 ${over.length ? '어김' : '지킴'}` : over.length ? '어기는 중' : '지키는 중'
    const detail = over.length ? ` (넘는 항목: ${describeBreaches(over.map((v) => ({ ...v, kind: cm.kind, limit: cm.value })), plain, goodName)})` : ''
    lines.push(`- [${cm.id}] ${describeCommitment(cm, name, goodName)} (${cm.startQuarter + 1}~${cm.endQuarter + 1}분기). ${status}${detail}`)
  }
  const firsts = obs.violations.filter((v) => v.first)
  if (firsts.length) {
    lines.push(`\n# 최근 약속 위반 (처음 어긴 분기 기준)`)
    for (const v of firsts) lines.push(`- ${v.quarter + 1}분기 ${name(v.obligor)} [${v.commitmentId}] ${describeBreaches(v.breaches, plain, goodName)}`)
  }
  const ongoing = obs.violations.filter((v) => v.quarter === obs.quarter - 1)
  if (ongoing.length) lines.push(`직전 분기에 위반 상태였던 약속: ${ongoing.map((v) => `${name(v.obligor)} [${v.commitmentId}]`).join(', ')}`)

  const past = obs.messages.filter((m) => m.quarter < obs.quarter)
  if (past.length) {
    lines.push(`\n# 최근 메시지 (공개 성명과 우리가 주고받은 비공개 메시지)`)
    for (const m of past) lines.push(`- ${m.quarter + 1}분기 ${m.round}라운드 ${describeRoute(m.from, m.to, name)} (${TONE_LABEL[m.tone]}): ${m.text}`)
  }
  if (obs.handoverMemo) lines.push(`\n# 전임 지도자의 인수인계 메모\n${obs.handoverMemo}`)
  if (obs.memoToSelf) lines.push(`\n# 지난 분기에 네가 남긴 메모\n${obs.memoToSelf}`)
  return lines.join('\n')
}

const describeRoute = (from: BlocId, to: BlocId | 'all', name: (r: RegionId) => string) =>
  to === 'all' ? `${name(from)} 공개 성명` : `${name(from)} → ${name(to)} 비공개`

function describeProposal(p: Proposal, name: (r: RegionId) => string) {
  return `[${p.id}] ${name(p.from)} → ${p.to.map(name).join('·')}: ${p.terms.map((t) => describeTerm(t, p.from, name, goodName)).join(' / ')} — 기간 ${p.durationQuarters}분기${p.note ? ` — "${p.note}"` : ''}`
}

function round1Instruction(obs: Observation) {
  return (
    `\n\n# 지금 할 일: 외교 1라운드
공개 성명(내지 않으려면 빈 문자열), 비공개 메시지(보낼 나라마다 하나, 없으면 빈 배열), 제안(없으면 빈 배열)을 정하라. 정책 결정은 다음 라운드에서 한다.` +
    (obs.leader.quartersLeft === 1 ? '\n이번이 네 임기의 마지막 분기다.' : '')
  )
}

function round2Instruction(obs: Observation) {
  const c = obs.country
  const name = namer(obs.naming, c)
  const lines: string[] = []
  const now = obs.messages.filter((m) => m.quarter === obs.quarter && m.round === 1 && m.from !== c)
  lines.push(`\n\n# 이번 분기 1라운드에 받은 성명과 메시지`)
  lines.push(now.length ? now.map((m) => `- ${describeRoute(m.from, m.to, name)} (${TONE_LABEL[m.tone]}): ${m.text}`).join('\n') : '없음')
  lines.push(`\n# 이번 분기 우리에게 온 제안`)
  lines.push(obs.pendingProposals.length ? obs.pendingProposals.map((p) => `- ${describeProposal(p, name)}`).join('\n') : '없음')
  if (obs.ownProposals.length) {
    lines.push(`\n# 우리가 이번 분기 보낸 제안 (받은 나라들이 지금 수락 여부를 정한다)`)
    lines.push(obs.ownProposals.map((p) => `- ${describeProposal(p, name)}`).join('\n'))
  }
  const keep = keepPolicyAction(obs.policies[c], c).policy
  lines.push(`\n# 현재 우리 정책 (출력 형식 그대로)`)
  lines.push(JSON.stringify({ tariffs_pct: keep.tariffsPct, export_controls: keep.exportControls, investment_rate_pct: keep.investmentRatePct }))
  lines.push(`\n# 지금 할 일: 외교 2라운드 + 이번 분기 정책 결정
수락할 제안 ID, 마지막 공개 성명과 비공개 메시지, 그리고 이번 분기에 적용할 정책 전체(상대 5개국 × 물품 10개의 관세 %와 수출 통제 단계, 투자율 %)를 정하라. 바꾸지 않을 항목은 현재 값을 그대로 쓴다.`)
  if (obs.leader.quartersLeft === 1) lines.push('이번이 네 임기의 마지막 분기다. handover_memo에 다음 지도자에게 넘길 인수인계 메모를 써라.')
  return lines.join('\n')
}

// ── 응답 형식 ──
const GOOD_KEYS = TRADED.map((s) => s.id)
const statementSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'tone'],
  properties: { text: { type: 'string', description: '모든 나라가 보는 공개 성명. 내지 않으려면 빈 문자열' }, tone: { type: 'string', enum: TONES } },
}
const messagesSchema = (partners: BlocId[]) => ({
  type: 'array',
  description: '비공개 메시지. 받는 나라만 본다',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['to', 'text', 'tone'],
    properties: { to: { type: 'string', enum: partners }, text: { type: 'string' }, tone: { type: 'string', enum: TONES } },
  },
})
const proposalsSchema = (partners: BlocId[]) => ({
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['to', 'terms', 'duration_quarters', 'note'],
    properties: {
      to: { type: 'array', items: { type: 'string', enum: partners }, description: '제안을 받는 나라 (1곳 이상)' },
      terms: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['obligor', 'kind', 'goods', 'value'],
          properties: {
            obligor: { type: 'string', enum: ['proposer', 'recipients', 'all'] },
            kind: { type: 'string', enum: ['tariff_max', 'export_control_max'] },
            goods: { type: 'array', items: { type: 'string', enum: [...GOOD_KEYS, 'all'] } },
            value: { type: 'number' },
          },
        },
      },
      duration_quarters: { type: 'integer' },
      note: { type: 'string' },
    },
  },
})

export function diplomacySchema(country: BlocId) {
  const partners = partnersOf(country)
  return {
    type: 'object',
    additionalProperties: false,
    required: ['thinking', 'statement', 'messages', 'proposals'],
    properties: {
      thinking: { type: 'string', description: '비공개 판단 (다른 나라에게 보이지 않음)' },
      statement: statementSchema,
      messages: messagesSchema(partners),
      proposals: proposalsSchema(partners),
    },
  }
}

export function decisionSchema(country: BlocId) {
  const partners = partnersOf(country)
  const table = (item: Record<string, unknown>) => ({
    type: 'object',
    additionalProperties: false,
    required: partners,
    properties: Object.fromEntries(
      partners.map((j) => [j, { type: 'object', additionalProperties: false, required: GOOD_KEYS, properties: Object.fromEntries(GOOD_KEYS.map((k) => [k, item])) }]),
    ),
  })
  return {
    type: 'object',
    additionalProperties: false,
    required: ['reasoning', 'accept_proposals', 'statement', 'messages', 'tariffs_pct', 'export_controls', 'investment_rate_pct', 'memo_to_self', 'handover_memo'],
    properties: {
      reasoning: { type: 'string', description: '이번 분기 결정의 이유 (비공개, 연구 기록용)' },
      accept_proposals: { type: 'array', items: { type: 'string' }, description: '수락할 제안 ID 목록' },
      statement: statementSchema,
      messages: messagesSchema(partners),
      tariffs_pct: table({ type: 'number' }),
      export_controls: table({ type: 'integer', enum: [0, 1, 2, 3] }),
      investment_rate_pct: { type: 'number' },
      memo_to_self: { type: 'string', description: '다음 분기의 너에게 남기는 메모 (임기 중에만 유지)' },
      handover_memo: { type: 'string', description: '임기 마지막 분기에만 작성. 그 외에는 빈 문자열' },
    },
  }
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const asTone = (x: unknown): Tone => (TONES.includes(x as Tone) ? (x as Tone) : 'neutral')
const asStatement = (x: unknown) => (isRecord(x) ? { text: String(x.text ?? ''), tone: asTone(x.tone) } : { text: '', tone: 'neutral' as Tone })
const asMessages = (x: unknown): OutgoingMessage[] =>
  (Array.isArray(x) ? x : []).filter(isRecord).map((m) => ({ to: String(m.to) as BlocId, text: String(m.text ?? ''), tone: asTone(m.tone) }))

function parseTerms(raw: unknown): ProposalTerm[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord).map((t) => ({
    obligor: (['proposer', 'recipients', 'all'].includes(t.obligor as string) ? t.obligor : 'all') as ProposalTerm['obligor'],
    kind: (t.kind === 'export_control_max' ? 'export_control_max' : 'tariff_max') as ProposalTerm['kind'],
    goods: (Array.isArray(t.goods) ? t.goods : []).map(String),
    value: Number(t.value) || 0,
  }))
}

export function parseDiplomacy(json: unknown): DiplomacyAction | null {
  if (!isRecord(json)) return null
  return {
    thinking: String(json.thinking ?? ''),
    statement: asStatement(json.statement),
    messages: asMessages(json.messages),
    proposals: (Array.isArray(json.proposals) ? json.proposals : []).filter(isRecord).map((p) => ({
      to: (Array.isArray(p.to) ? p.to : []).map(String) as BlocId[],
      terms: parseTerms(p.terms),
      durationQuarters: Number(p.duration_quarters) || 4,
      note: String(p.note ?? ''),
    })),
  }
}

export function parseDecision(json: unknown, country: BlocId): DecisionAction | null {
  if (!isRecord(json) || !isRecord(json.tariffs_pct) || !isRecord(json.export_controls)) return null
  const table = (x: Record<string, unknown>) =>
    Object.fromEntries(
      partnersOf(country)
        .filter((j) => isRecord(x[j]))
        .map((j) => [j, Object.fromEntries(GOOD_KEYS.filter((k) => (x[j] as Record<string, unknown>)[k] != null).map((k) => [k, Number((x[j] as Record<string, unknown>)[k])]))]),
    )
  return {
    reasoning: String(json.reasoning ?? ''),
    acceptProposals: Array.isArray(json.accept_proposals) ? json.accept_proposals.map(String) : [],
    statement: asStatement(json.statement),
    messages: asMessages(json.messages),
    policy: { tariffsPct: table(json.tariffs_pct), exportControls: table(json.export_controls), investmentRatePct: Number(json.investment_rate_pct) },
    memoToSelf: String(json.memo_to_self ?? ''),
    handoverMemo: String(json.handover_memo ?? ''),
  }
}

export interface LlmLeaderOptions {
  model: string
  transport: LlmTransport
  naming: RegionNaming
  culture: CultureBrief
  objective: ObjectiveKind
  country: BlocId
  termQuarters: number
  totalQuarters: number
  effort?: Effort
  logPrompts?: boolean
  recap?: Recap
}

export class LlmLeader implements Leader {
  kind = 'llm' as const
  label: string
  private opts: LlmLeaderOptions
  readonly system: string

  constructor(opts: LlmLeaderOptions) {
    this.opts = opts
    this.label = opts.model
    this.system = systemPrompt(opts.country, opts.objective, opts.naming, opts.culture, opts.termQuarters, opts.totalQuarters)
  }

  private async call<T>(user: string, schema: Record<string, unknown>, parse: (j: unknown) => T | null): Promise<{ value: T | null; meta: LeaderCallMeta }> {
    let last: LlmResponse | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      last = await this.opts.transport({ model: this.opts.model, system: this.system, user, schema, effort: this.opts.effort ?? 'medium' })
      const value = last.ok ? parse(last.json) : null
      if (value) return { value, meta: this.meta(last, user, attempt > 0 ? '첫 응답 파싱 실패 후 재시도' : undefined) }
    }
    return { value: null, meta: this.meta(last!, user, last?.error ?? '응답을 해석하지 못함') }
  }

  private meta(res: LlmResponse, user: string, error?: string): LeaderCallMeta {
    return {
      model: res.model,
      requestedModel: res.requestedModel,
      latencyMs: res.latencyMs,
      usage: res.usage,
      stopReason: res.stopReason,
      fallback: res.fallback,
      error: error ?? res.error,
      raw: res.ok ? undefined : res.text,
      prompt: this.opts.logPrompts ? { system: this.system, user } : undefined,
    }
  }

  async diplomacy(obs: Observation) {
    const user = describeObservation(obs, this.opts.recap === 'on') + round1Instruction(obs)
    const { value, meta } = await this.call(user, diplomacySchema(obs.country), parseDiplomacy)
    return { action: value ?? { statement: { text: '', tone: 'neutral' as Tone }, messages: [], proposals: [] }, meta }
  }

  async decide(obs: Observation) {
    const user = describeObservation(obs, this.opts.recap === 'on') + round2Instruction(obs)
    const { value, meta } = await this.call(user, decisionSchema(obs.country), (j) => parseDecision(j, obs.country))
    return { action: value ?? keepPolicyAction(obs.policies[obs.country], obs.country), meta }
  }
}
