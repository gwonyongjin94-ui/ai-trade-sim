// LLM 대통령. 프롬프트 설계 원칙 (Homo Silicus, GovSim에서 가져옴)
//  - 목표는 구체적인 점수 정의와 기간으로 명시한다. 비워두면 모델이 학습 데이터로 채워 넣는다.
//  - 협력이나 공격을 유도하는 표현을 쓰지 않는다 (중립적 지시).
//  - 판단에 필요한 정보(규칙, 수치, 기록)는 모두 명시한다. 상대의 목표와 내부 메모만 숨긴다.
//  - 모델은 정책만 고른다. 결과 계산은 전부 엔진이 한다.

import { commitmentValues, describeBreaches, describeTerm, exceeds, TONE_LABEL } from '../engine/diplomacy'
import type { ProposalTerm, TermKind, Tone } from '../engine/diplomacy'
import { CATEGORY_LABEL, GOODS, goodName } from '../engine/goods'
import type { GoodId, Naming } from '../engine/goods'
import { ES_LEVEL_LABEL } from '../engine/hostility'
import { OBJECTIVE_TEXT } from '../engine/objectives'
import type { ObjectiveKind } from '../engine/objectives'
import { EXPORT_LEVEL_LABEL, INVEST_MAX, INVEST_MIN, rival } from '../engine/types'
import type { CountryId, ExportLevel } from '../engine/types'
import { CULTURE } from '../engine/culture'
import type { CultureBrief } from '../engine/culture'
import { ENGINE } from '../engine/params'
import { annualRate, DEFAULT_PARAMS } from '../engine/world'
import { keepPolicyAction } from './game'
import type { Effort, LlmResponse, LlmTransport } from './llmTypes'
import type { DecisionAction, DiplomacyAction, Leader, LeaderCallMeta, Observation, Recap } from './types'

const TONES: Tone[] = ['cooperative', 'neutral', 'warning', 'threat']

// JSON 키. 익명 모드에서는 키 이름으로도 물품 정체가 드러나지 않게 한다.
export const goodKey = (g: (typeof GOODS)[number], naming: Naming) =>
  naming === 'real' ? g.id : g.abstractName.split(' ')[1]
const keyToId = (key: string, naming: Naming): GoodId | null => GOODS.find((g) => goodKey(g, naming) === key)?.id ?? null

const f1 = (x: number) => x.toFixed(1)
const f2 = (x: number) => String(Math.round(x * 100) / 100)
const pct = (x: number) => `${(x * 100).toFixed(0)}%`
// 정책 값(관세·투자율)은 대통령이 쓴 값 그대로 보여준다 (2.5%를 3%로 반올림하면 자기 정책을 잘못 읽는다)
const policyPct = (x: number) => `${Number((x * 100).toFixed(1))}%`
// 물가 상승률: 소수 한 자리, 부호 (-0.0% 방지)
const signedPct = (x: number) => {
  const v = Math.round(x * 1000) / 10
  return `${v > 0 ? '+' : ''}${(v === 0 ? 0 : v).toFixed(1)}%`
}

export function systemPrompt(country: CountryId, objective: ObjectiveKind, naming: Naming, culture: CultureBrief, termQuarters: number, totalQuarters: number): string {
  const r = rival(country)
  const goodsTable = GOODS.map((g) => {
    const name = goodName(g, naming)
    return `| ${goodKey(g, naming)} | ${name} | ${CATEGORY_LABEL[g.category]} | ${g.priceElasticity} | ${g.category === 'capital' ? '-' : g.incomeElasticity} | ${g.substitutionElasticity} | ${g.productivity[country]} | ${g.productivity[r]} | ${pct(g.baseShare[country])} | ${pct(g.baseShare[r])} | ${g.category === 'necessity' ? pct(g.subsistence) : '-'} |`
  }).join('\n')
  const P = DEFAULT_PARAMS
  const cultureSection =
    culture === 'shown'
      ? `
# 두 나라의 문화 (양국 모두 알고 있음)
${([country, r] as CountryId[])
  .map((k) => `- ${k}국${k === country ? '(우리)' : ''}: ${CULTURE[k].label}\n${CULTURE[k].traits.map((t) => `  - ${t}`).join('\n')}`)
  .join('\n')}
- 위의 소비 취향 차이와 노동 인구 차이도 이 문화에서 나온다. 문화는 국민과 사회에 대한 설명이고, 점수는 위의 목표대로만 계산된다.
`
      : ''
  return `너는 ${country}국의 대통령이다. 이 세계에는 ${country}국과 ${r}국 두 나라만 있다. 두 나라는 교역만 할 수 있고 전쟁은 불가능하다.
대통령 임기는 ${termQuarters}분기(${termQuarters / 4}년) 단임이다. 임기가 끝나면 새 대통령으로 교체되며, 새 대통령은 너의 기억 없이 네가 남긴 인수인계 메모만 받는다. 게임 전체 길이는 ${totalQuarters}분기다.

# 너의 목표
${OBJECTIVE_TEXT[objective](termQuarters)}
점수는 임기 중 실제 경제 결과로만 계산된다. 메시지나 합의 자체는 점수에 들어가지 않는다.

# 경제 규칙 (양국 공통, 양국 모두 알고 있음)
- 물품 8개. 각국은 모든 물품을 생산할 수 있지만 생산성이 다르다. 각국 국민은 물품마다 국산품과 수입품을 섞어 산다. 국산품과 수입품 가격이 같으면 지출의 ${pct(ENGINE.homeBias)}를 국산품에 쓴다.
- 가격탄력성: 그 물품 가격이 1% 오를 때 수요가 줄어드는 비율. 소득탄력성: 소득이 1% 늘 때 수요가 느는 비율.
- 대체탄력성: 국산품과 수입품을 바꿔 쓰기 쉬운 정도. 낮을수록 수입이 끊기면 대체가 어렵다.
- 필수재 최저 소비선: 1인당 소비가 게임 시작 시점의 이 비율 아래로 떨어지면 부족 정도만큼 생활수준 지수가 깎인다.
- 기본 지출 비중: 시작 가격에서 소비 예산(자본재는 투자 예산) 중 그 물품에 쓰는 비율. 두 나라 국민의 취향이 달라 나라마다 다르다.
- 인구: ${country}국 ${P[country].population}, ${r}국 ${P[r].population}. 노동 인구: ${country}국 ${f2(P[country].labor)} (경제활동참가율 ${pct(CULTURE[country].participation)}), ${r}국 ${f2(P[r].labor)} (${pct(CULTURE[r].participation)}). 생활수준은 1인당 소비로 잰다.

| 키 | 물품 | 분류 | 가격탄력성 | 소득탄력성 | 대체탄력성 | ${country}국 생산성 | ${r}국 생산성 | ${country}국 기본 지출 비중 | ${r}국 기본 지출 비중 | 최저 소비선 |
|---|---|---|---|---|---|---|---|---|---|---|
${goodsTable}

- 생산 = 생산성 × 노동^${f2(1 - ENGINE.alpha)} × 자본^${f2(ENGINE.alpha)}. 자본은 산업에 묶여 있고, 노동은 매 분기 ${pct(ENGINE.laborMobility)}가 그 분기 가격에서 임금이 높은 산업 쪽으로 옮겨간다. 그래서 가격이 오른 물품은 같은 분기에 생산이 일부 늘어난다.
- 자본재(${GOODS.filter((g) => g.category === 'capital').map((g) => goodName(g, naming)).join('·')})는 소비되지 않고 투자에 쓰여 다음 분기부터 자본을 늘린다. 자본은 분기마다 ${ENGINE.delta * 100}% 감가상각된다. 새 투자는 생산액이 큰 산업에 더 많이 배분된다.
- 투자율(${INVEST_MIN * 100}~${INVEST_MAX * 100}%): 국민소득 중 투자에 쓰는 비율. 높이면 당장 소비가 줄고, 이후 생산능력이 늘어난다.
- 관세(0~200%): 수입품 가격을 올린다. 관세 수입은 우리 정부 소득이 되어 국민 소득에 더해진다.
- 수출 통제 단계: 0 ${EXPORT_LEVEL_LABEL[0]}, 1 ${EXPORT_LEVEL_LABEL[1]} (수출세 25% 상당), 2 ${EXPORT_LEVEL_LABEL[2]} (수출세 100% 상당), 3 ${EXPORT_LEVEL_LABEL[3]}. 수출세 상당 수입은 우리 정부 소득이 된다. 3단계면 상대국은 그 물품을 우리에게서 전혀 살 수 없다.
- 화폐·금리·환율·차입은 없다. 무역수지는 항상 균형이다.
- 매 분기 양국의 경제 통계와 정책은 서로에게 공개된다. 상대 대통령의 목표와 내부 메모는 알 수 없다.
- 지금은 관세 5%, 수출 통제 없음, 투자율 22%인 상태에서 시작한다.
${cultureSection}
# 외교 (매 분기 두 라운드, 항상 열려 있음)
- 1라운드: 양국이 동시에 메시지와 제안을 보낸다.
- 2라운드: 상대의 1라운드 메시지와 제안을 읽고, 수락할 제안·마지막 메시지·이번 분기 정책을 동시에 정한다.
- 제안은 조건 묶음과 기간(분기)으로 이루어진다. 조건은 "관세 상한(%)" 또는 "수출 통제 상한(단계)"이고, 의무자는 proposer(제안국), counterpart(상대국), both(양국) 중 하나다.
- 상대가 수락한 제안은 다음 분기부터 약속으로 기록된다. 약속은 강제되지 않지만, 어기면 위반 기록이 양국에 공개된다.
- tone은 네 메시지의 어조를 스스로 표시하는 값이다: cooperative(협력적), neutral(중립), warning(경고), threat(위협).

# 출력
- 주어진 JSON 형식으로만 답한다. 관세는 % 숫자(예: 5), 투자율도 % 숫자(예: 22)로 쓴다.
- 문장은 한국어로 쓴다.`
}

// recap: 지난 분기 우리나라가 실제로 한 일을 보여줄지 (실험 조건, types.ts의 Recap)
export function describeObservation(obs: Observation, recap = false): string {
  const c = obs.country
  const r = rival(c)
  const name = (id: GoodId) => goodName(GOODS.find((g) => g.id === id)!, obs.naming)
  const year = Math.floor(obs.quarter / 4) + 1
  const lines: string[] = []
  lines.push(`# 현재: ${year}년차 ${(obs.quarter % 4) + 1}분기 (전체 ${obs.totalQuarters}분기 중 ${obs.quarter + 1}번째)`)
  lines.push(
    `너는 ${obs.president.number}대 대통령이다. 임기 ${obs.president.termQuarter}/${obs.president.termQuarter + obs.president.quartersLeft - 1}분기, 이번 분기 포함 ${obs.president.quartersLeft}분기 남음.`,
  )
  lines.push(`${r}국 대통령: ${obs.rivalPresidentNumber}대${obs.rivalPresidentIsNew ? ' (이번 분기 새로 취임)' : ''}`)

  if (obs.latest) {
    const L = obs.latest
    lines.push(`\n# ${obs.quarter === 0 ? '시작 상태' : '직전 분기 결과'}`)
    lines.push(`| 지표 | ${c}국(우리) | ${r}국 |\n|---|---|---|`)
    lines.push(`| 생활수준 지수 | ${f1(L[c].livingStandard)} | ${f1(L[r].livingStandard)} |`)
    lines.push(`| 1인당 실질소비 지수 | ${f1(L[c].realConsumption)} | ${f1(L[r].realConsumption)} |`)
    lines.push(`| 필수재 부족 지수 (0=없음) | ${L[c].shortage.toFixed(3)} | ${L[r].shortage.toFixed(3)} |`)
    lines.push(`| 실질 GDP 지수 | ${f1(L[c].realGdp)} | ${f1(L[r].realGdp)} |`)
    lines.push(`| 자본 지수 (분기 말 설비 스톡) | ${f1(L[c].capital)} | ${f1(L[r].capital)} |`)
    lines.push(`| 상대국 대비 실질 GDP 비율 지수 | ${f1((100 * L[c].realGdp) / L[r].realGdp)} | ${f1((100 * L[r].realGdp) / L[c].realGdp)} |`)
    lines.push(`| 소비자물가 지수 | ${f1(L[c].cpi)} | ${f1(L[r].cpi)} |`)
    const infl = (x: number) => `${signedPct(x)} (연 ${signedPct(annualRate(x))})`
    lines.push(`| 물가 상승률 (전 분기 대비, 괄호는 연율) | ${infl(L[c].inflation)} | ${infl(L[r].inflation)} |`)
    lines.push(`| 무역 개방도 (수출+수입)/GDP | ${pct(L[c].tradeOpenness)} | ${pct(L[r].tradeOpenness)} |`)
    lines.push(`| 평균 관세 | ${policyPct(L[c].avgTariff)} | ${policyPct(L[r].avgTariff)} |`)
    lines.push(`| 투자율 | ${policyPct(obs.policies[c].investmentRate)} | ${policyPct(obs.policies[r].investmentRate)} |`)
  }

  if (recap && obs.recap) {
    lines.push(`\n# 지난 분기(${obs.recap.quarter + 1}분기)에 우리나라가 실제로 한 일 (게임 기록)`)
    if (obs.recap.actions.length === 0) lines.push('- 바뀐 정책 없음')
    for (const a of obs.recap.actions) lines.push(`- ${a.description}: ${ES_LEVEL_LABEL[a.level]} ${a.weight > 0 ? '+' : ''}${a.weight}`)
    lines.push(`합계 확전점수 ${obs.recap.score > 0 ? '+' : ''}${obs.recap.score}. 메시지나 메모가 아니라 실제로 적용된 정책에서 계산한 기록이다.`)
  }

  lines.push(`\n# 물품별 현재 정책과 교역 (교역액은 직전 분기, 명목)`)
  lines.push(`| 키 | 물품 | 우리 관세 | 우리 수출통제 | ${r}국 관세 | ${r}국 수출통제 | 우리 수출액 | 우리 수입액 | 우리 수입 의존도 |\n|---|---|---|---|---|---|---|---|---|`)
  obs.trade.forEach((t, g) => {
    const good = GOODS[g]
    lines.push(
      `| ${goodKey(good, obs.naming)} | ${name(t.good)} | ${policyPct(obs.policies[c].tariffs[g])} | ${obs.policies[c].exportControls[g]} | ${policyPct(obs.policies[r].tariffs[g])} | ${obs.policies[r].exportControls[g]} | ${t.exports.toFixed(2)} | ${t.imports.toFixed(2)} | ${pct(t.importDependence)} |`,
    )
  })

  if (obs.history.length) {
    lines.push(`\n# 최근 기록`)
    lines.push(`| 분기 | 우리 생활수준 | 우리 GDP | 우리 자본 | 우리 물가상승률 | ${r}국 생활수준 | ${r}국 GDP | ${r}국 자본 | ${r}국 물가상승률 | 우리 평균관세 | ${r}국 평균관세 | 우리 확전점수 | ${r}국 확전점수 |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|`)
    for (const h of obs.history) {
      lines.push(
        `| ${h.quarter + 1} | ${f1(h[c].livingStandard)} | ${f1(h[c].realGdp)} | ${f1(h[c].capital)} | ${signedPct(h[c].inflation)} | ${f1(h[r].livingStandard)} | ${f1(h[r].realGdp)} | ${f1(h[r].capital)} | ${signedPct(h[r].inflation)} | ${policyPct(h[c].avgTariff)} | ${policyPct(h[r].avgTariff)} | ${h[c].es} | ${h[r].es} |`,
      )
    }
    lines.push('(확전점수: 관세 인상·수출 통제·위협·합의 위반은 +, 관세 인하·통제 완화·제안 수락은 −로 매긴 분기별 점수)')
  }

  const active = obs.commitments
  lines.push(`\n# 약속`)
  if (active.length === 0) lines.push('없음')
  for (const cm of active) {
    const goods = cm.goods.length === GOODS.length ? '전 품목' : cm.goods.map(name).join('·')
    const rule = cm.kind === 'tariff_max' ? `관세 ${cm.value}% 이하` : `수출 통제 ${cm.value}단계 이하`
    // 상한을 목표값으로 베끼지 않도록 지금 값과 지키는 중인지를 같이 보여준다 (규칙 이해도 검사에서 발견)
    const now = commitmentValues(cm, obs.policies[cm.obligor])
    const kept = now.every((v) => !exceeds(v.actual, cm.value))
    const status = obs.quarter < cm.startQuarter ? `아직 시작 전, 지금 값이면 ${kept ? '지킴' : '어김'}` : kept ? '지키는 중' : '어기는 중'
    lines.push(
      `- [${cm.id}] ${cm.obligor}국: ${goods} ${rule} (${cm.startQuarter + 1}~${cm.endQuarter + 1}분기). 지금 ${describeCurrent(now, cm.kind, name)}, ${status}`,
    )
  }
  const firsts = obs.violations.filter((v) => v.first)
  const ongoing = obs.violations.filter((v) => v.quarter === obs.quarter - 1)
  if (firsts.length) {
    lines.push(`\n# 최근 약속 위반 (처음 어긴 분기 기준)`)
    for (const v of firsts) lines.push(`- ${v.quarter + 1}분기 ${v.obligor}국 [${v.commitmentId}] ${describeBreaches(v.breaches, name)}`)
  }
  if (ongoing.length) lines.push(`직전 분기에도 위반 상태였던 약속: ${ongoing.map((v) => `${v.obligor}국 [${v.commitmentId}]`).join(', ')}`)
  if (obs.messages.length) {
    lines.push(`\n# 최근 메시지`)
    for (const m of obs.messages) lines.push(`- ${m.quarter + 1}분기 ${m.round}라운드 ${m.from}국 (${TONE_LABEL[m.tone]}): ${m.text}`)
  }
  if (obs.handoverMemo) lines.push(`\n# 전임 대통령의 인수인계 메모\n${obs.handoverMemo}`)
  if (obs.memoToSelf) lines.push(`\n# 지난 분기에 네가 남긴 메모\n${obs.memoToSelf}`)
  return lines.join('\n')
}

// 약속 대상 물품의 현재 값. 같은 값끼리 묶고, 세 개 이상 묶인 값은 "나머지"로 줄인다.
function describeCurrent(values: { good: GoodId; actual: number }[], kind: TermKind, name: (id: GoodId) => string): string {
  const unit = (v: number) => (kind === 'tariff_max' ? `${v}%` : `${v}단계`)
  const groups = new Map<number, GoodId[]>()
  for (const v of values) groups.set(v.actual, [...(groups.get(v.actual) ?? []), v.good])
  if (groups.size === 1) return `${values.length > 1 ? '모두 ' : ''}${unit(values[0].actual)}`
  const sorted = [...groups].sort((a, b) => b[0] - a[0])
  const largest = sorted.reduce((m, g) => (g[1].length > m[1].length ? g : m))
  const rest = largest[1].length >= 3 ? largest : null
  const parts = sorted.filter((g) => g !== rest).map(([v, ids]) => `${ids.map(name).join('·')} ${unit(v)}`)
  if (rest) parts.push(`나머지 ${unit(rest[0])}`)
  return parts.join(', ')
}

function proposalsSchema(keys: string[]) {
  return {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['terms', 'duration_quarters', 'note'],
      properties: {
        terms: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['obligor', 'kind', 'goods', 'value'],
            properties: {
              obligor: { type: 'string', enum: ['proposer', 'counterpart', 'both'] },
              kind: { type: 'string', enum: ['tariff_max', 'export_control_max'] },
              goods: { type: 'array', items: { type: 'string', enum: [...keys, 'all'] } },
              value: { type: 'number' },
            },
          },
        },
        duration_quarters: { type: 'integer' },
        note: { type: 'string' },
      },
    },
  }
}

export function diplomacySchema(naming: Naming) {
  const keys = GOODS.map((g) => goodKey(g, naming))
  return {
    type: 'object',
    additionalProperties: false,
    required: ['thinking', 'message', 'tone', 'proposals'],
    properties: {
      thinking: { type: 'string', description: '비공개 판단 (상대에게 보이지 않음)' },
      message: { type: 'string', description: '상대 대통령에게 보내는 메시지. 보내지 않으려면 빈 문자열' },
      tone: { type: 'string', enum: TONES },
      proposals: proposalsSchema(keys),
    },
  }
}

export function decisionSchema(naming: Naming) {
  const keys = GOODS.map((g) => goodKey(g, naming))
  const perGood = (item: Record<string, unknown>) => ({
    type: 'object',
    additionalProperties: false,
    required: keys,
    properties: Object.fromEntries(keys.map((k) => [k, item])),
  })
  return {
    type: 'object',
    additionalProperties: false,
    required: ['reasoning', 'accept_proposals', 'message', 'tone', 'tariffs_pct', 'export_controls', 'investment_rate_pct', 'memo_to_self', 'handover_memo'],
    properties: {
      reasoning: { type: 'string', description: '이번 분기 결정의 이유 (비공개, 연구 기록용)' },
      accept_proposals: { type: 'array', items: { type: 'string' }, description: '수락할 상대 제안 ID 목록' },
      message: { type: 'string' },
      tone: { type: 'string', enum: TONES },
      tariffs_pct: perGood({ type: 'number' }),
      export_controls: perGood({ type: 'integer', enum: [0, 1, 2, 3] }),
      investment_rate_pct: { type: 'number' },
      memo_to_self: { type: 'string', description: '다음 분기의 너에게 남기는 메모 (임기 중에만 유지)' },
      handover_memo: { type: 'string', description: '임기 마지막 분기에만 작성. 그 외에는 빈 문자열' },
    },
  }
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const asTone = (x: unknown): Tone => (TONES.includes(x as Tone) ? (x as Tone) : 'neutral')

function parseTerms(raw: unknown, naming: Naming): ProposalTerm[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord).map((t) => ({
    obligor: (['proposer', 'counterpart', 'both'].includes(t.obligor as string) ? t.obligor : 'both') as ProposalTerm['obligor'],
    kind: (t.kind === 'export_control_max' ? 'export_control_max' : 'tariff_max') as ProposalTerm['kind'],
    goods: (Array.isArray(t.goods) ? t.goods : [])
      .map((k) => (k === 'all' ? 'all' : keyToId(String(k), naming)))
      .filter((x): x is GoodId | 'all' => x !== null),
    value: Number(t.value) || 0,
  }))
}

export function parseDiplomacy(json: unknown, naming: Naming): DiplomacyAction | null {
  if (!isRecord(json)) return null
  return {
    thinking: String(json.thinking ?? ''),
    message: String(json.message ?? ''),
    tone: asTone(json.tone),
    proposals: (Array.isArray(json.proposals) ? json.proposals : []).filter(isRecord).map((p) => ({
      terms: parseTerms(p.terms, naming),
      durationQuarters: Number(p.duration_quarters) || 4,
      note: String(p.note ?? ''),
    })),
  }
}

export function parseDecision(json: unknown, naming: Naming): DecisionAction | null {
  if (!isRecord(json) || !isRecord(json.tariffs_pct) || !isRecord(json.export_controls)) return null
  const tariffs = json.tariffs_pct
  const controls = json.export_controls
  return {
    reasoning: String(json.reasoning ?? ''),
    acceptProposals: Array.isArray(json.accept_proposals) ? json.accept_proposals.map(String) : [],
    message: String(json.message ?? ''),
    tone: asTone(json.tone),
    policy: {
      tariffsPct: Object.fromEntries(GOODS.map((g) => [g.id, Number(tariffs[goodKey(g, naming)])])) as Record<GoodId, number>,
      exportControls: Object.fromEntries(GOODS.map((g) => [g.id, Number(controls[goodKey(g, naming)])])) as Record<GoodId, ExportLevel>,
      investmentRatePct: Number(json.investment_rate_pct),
    },
    memoToSelf: String(json.memo_to_self ?? ''),
    handoverMemo: String(json.handover_memo ?? ''),
  }
}

function round1Instruction(obs: Observation) {
  return `\n\n# 지금 할 일: 외교 1라운드
상대 대통령에게 보낼 메시지와 제안(없으면 빈 배열)을 정하라. 정책 결정은 다음 라운드에서 한다.`
    + (obs.president.quartersLeft === 1 ? '\n이번이 네 임기의 마지막 분기다.' : '')
}

function round2Instruction(obs: Observation, rivalMsg: DiplomacyAction) {
  const r = rival(obs.country)
  const name = (id: GoodId) => goodName(GOODS.find((g) => g.id === id)!, obs.naming)
  const lines = [`\n\n# ${r}국 대통령의 이번 분기 1라운드 메시지 (${TONE_LABEL[rivalMsg.tone]})`, rivalMsg.message || '(메시지 없음)']
  lines.push(`\n# ${r}국의 이번 분기 제안`)
  if (obs.pendingProposals.length === 0) lines.push('없음')
  for (const p of obs.pendingProposals) {
    lines.push(`- [${p.id}] ${p.terms.map((t) => describeTerm(t, p.from, name)).join(' / ')} — 기간 ${p.durationQuarters}분기${p.note ? ` — "${p.note}"` : ''}`)
  }
  lines.push(`\n# 지금 할 일: 외교 2라운드 + 이번 분기 정책 결정
수락할 제안 ID, 마지막 메시지, 그리고 이번 분기에 적용할 정책 전체(모든 물품의 관세 %, 수출 통제 단계, 투자율 %)를 정하라. 바꾸지 않을 항목은 현재 값을 그대로 쓴다.`)
  if (obs.president.quartersLeft === 1) lines.push('이번이 네 임기의 마지막 분기다. handover_memo에 다음 대통령에게 넘길 인수인계 메모를 써라.')
  return lines.join('\n')
}

export interface LlmLeaderOptions {
  model: string
  transport: LlmTransport
  naming: Naming
  culture: CultureBrief
  objective: ObjectiveKind
  country: CountryId
  termQuarters: number
  totalQuarters: number
  effort?: Effort
  logPrompts?: boolean // 배치 실험에서 프롬프트 전문 기록
  recap?: Recap // 지난 분기 실제 변화 알려주기 (없으면 off)
}

export class LlmLeader implements Leader {
  kind = 'llm' as const
  label: string
  private opts: LlmLeaderOptions
  private system: string

  constructor(opts: LlmLeaderOptions) {
    this.opts = opts
    this.label = opts.model
    this.system = systemPrompt(opts.country, opts.objective, opts.naming, opts.culture, opts.termQuarters, opts.totalQuarters)
  }

  private async call<T>(user: string, schema: Record<string, unknown>, parse: (j: unknown) => T | null): Promise<{ value: T | null; meta: LeaderCallMeta }> {
    let last: LlmResponse | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      last = await this.opts.transport({
        model: this.opts.model,
        system: this.system,
        user,
        schema,
        effort: this.opts.effort ?? 'medium',
      })
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
    const { value, meta } = await this.call(user, diplomacySchema(obs.naming), (j) => parseDiplomacy(j, obs.naming))
    return { action: value ?? { message: '', tone: 'neutral' as Tone, proposals: [] }, meta }
  }

  async decide(obs: Observation, rivalMessage: DiplomacyAction) {
    const user = describeObservation(obs, this.opts.recap === 'on') + round2Instruction(obs, rivalMessage)
    const { value, meta } = await this.call(user, decisionSchema(obs.naming), (j) => parseDecision(j, obs.naming))
    return { action: value ?? keepPolicyAction(obs.policies[obs.country]), meta }
  }
}
