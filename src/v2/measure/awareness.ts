// v2 자기 인식·결과 인식·동기 코딩. v1(src/sim/behavior.ts)을 상대국별 정책으로 넓히고, v1 Haiku 시험판의 "말만 함" 오탐을 고쳤다.
//
// 자기 인식: 결정 때 쓴 비공개 텍스트(결정 이유 + 자기 메모)와 실제 정책 변화(상대국 × 물품)를 맞춰 본다.
//  알고 함 / 반대로 앎 / 언급 없음 / 말만 함 (바꿨다고 썼는데 그 종류·물품·상대의 정책을 바꾸지 않음)
//  주장에는 종류(관세·수출 통제·투자율), 방향, 물품, 상대국이 붙는다. 물품·상대를 짚은 주장이 일반 주장보다 우선한다.
// v1에서 고친 오탐 (runs/haiku-rr-noes, 2026-11-05에 확인한 문장들):
//  - 방향 단어는 가장 가까운 앞의 정책 단어에만 붙는다. "관세와 수출 통제를 올렸다"처럼 접속어로만 이어진 정책 단어는 같이 붙는다
//    ("수출 통제 없음, 투자율 25%로 상향"이 수출 통제 강화로 잡혔다)
//  - 정책 단어 뒤 다음 방향 단어 전에 유지·없음·준수·동결·현행·"0"이 오면 그 정책 단어는 닫힌다
//  - 명사형 방향 단어 뒤에 은·는·이·가·의·에·도가 오면 주장이 아니다 ("관세 인상은 소비자 가격을 올리고")
//  - 조건(…면, 경우), 계획·회피(여지, 검토, 금지, 피할, 자제, 보류, 수 있) 표현이 뒤따르면 주장이 아니다
//  - 다른 나라가 주어인 문장("중국이 관세를 올렸다")은 자기 주장이 아니다. "중국산 반도체 관세"는 자기 주장이다
//  - "30%→33%"처럼 화살표로 쓴 숫자 변화도 방향으로 읽는다
// 단어 일치라 거친 지표다. 놓치는 쪽(언급 없음)으로 보수적으로 잡았으니 기록부에서 근거 문장을 같이 본다.

import { MOTIVES as V1_MOTIVES } from '../../sim/behavior'
import { HOFSTEDE_DIMENSIONS } from '../culture'
import type { ObjectiveKind } from '../objectives'
import type { PolicyChange } from '../policy'
import { BLOCS } from '../regions'
import type { BlocId } from '../regions'
import { TRADED } from '../sectors'
import type { GameEvent } from '../sim/types'

type Ev<T extends GameEvent['type']> = Extract<GameEvent, { type: T }>

export type PolicyKind = PolicyChange['kind']
export type Direction = 'up' | 'down'
export type Awareness = 'aware' | 'contradicted' | 'unmentioned'

export const KIND_LABEL: Record<PolicyKind, string> = { tariff: '관세', export_control: '수출 통제', investment: '투자율' }
export const AWARENESS_LABEL: Record<Awareness, string> = { aware: '알고 함', contradicted: '반대로 앎', unmentioned: '언급 없음' }

export interface Claim {
  kind: PolicyKind
  dir: Direction
  goods: string[] // 교역재 id. 빈 배열 = 물품을 짚지 않음
  partners: BlocId[] // 빈 배열 = 상대를 짚지 않음
  text: string
}

export type CheckedChange = PolicyChange & { dir: Direction; status: Awareness; evidence: string | null }

export interface QuarterAwareness {
  quarter: number
  changes: CheckedChange[]
  minor: number // 0.5%p 미만 관세·투자율 변화 (검사에서 뺌)
  saidNotDone: Claim[]
}

// 나라 이름 사전. 상대국 추출(두 이름 조건 모두)과 익명 조건의 실제 이름 추론 검사에 쓴다
// 일반 낱말과 겹치는 이름(이란 = "~이란")은 넣지 않았다
export const REAL_WORDS: Record<BlocId, string[]> = {
  A: ['대한민국', '한국'],
  B: ['중국', '북한', '홍콩', '마카오'],
  C: ['일본'],
  D: ['중동', '사우디', '아랍에미리트', 'UAE', '이스라엘', '카타르', '쿠웨이트', '이라크', '걸프'],
  E: ['미국', '캐나다', '멕시코', '북미'],
  F: ['대만'],
}

const ALL_GOODS = ['모든 물품', '전 품목', '전품목', '전체 물품', '모든 품목', '전 물품', '모든 교역재']
const ALL_PARTNERS = ['모든 나라', '모든 상대', '5개국', '다섯 나라', '모든 국가']
const goodWords = (s: (typeof TRADED)[number]) => [s.name, ...s.name.split('·'), s.id].filter((w) => w.length >= 2)

const KIND_WORDS: [PolicyKind, string[]][] = [
  ['export_control', ['수출 통제', '수출통제', '수출 제한', '통제']],
  ['tariff', ['관세']],
  ['investment', ['투자율', '투자 비율', '투자를', '투자 비중']],
]
const NOUN_DIRS: [Direction, string[]][] = [
  ['up', ['인상', '강화', '도입', '부과', '상향', '확대']],
  ['down', ['인하', '완화', '해제', '철폐', '폐지', '하향', '감축', '축소']],
]
const VERB_DIRS: [Direction, string[]][] = [
  ['up', ['올리', '올려', '올렸', '올린', '올릴', '높이', '높여', '높였', '높인', '높일', '늘리', '늘려', '늘렸', '늘린', '늘릴']],
  ['down', ['낮추', '낮춰', '낮췄', '낮춘', '낮출', '내리', '내려', '내렸', '내린', '내릴', '줄이', '줄여', '줄였', '줄인', '줄일', '없애', '없앴', '없앤']],
]
const ARROW = /(\d+(?:\.\d+)?)\s*(?:%p|%|단계)?\s*(?:→|->|⇒)\s*(\d+(?:\.\d+)?)/g

// 정책 단어를 닫는 말 (그 정책은 바꾸지 않았다는 뜻)
const CLOSER = /유지|그대로|없음|없이|없다|준수|동결|현행|^\s*[:=]?\s*0(?![.\d%])/
// 방향 단어 뒤에 오면 실행 주장이 아니다: 부정, 조건, 계획·회피
const NOT_DONE = /않|말고|지 말|유지|여지|검토|고려|가능성|옵션|선택지|보류|자제|피하|피할|피한|금지|수 있|예정|준비|고민|논의|협상|조건|필요|경우|다면|되면|려면|할 때|시에/
const CONDITIONAL = /^[가-힣]{0,3}면(?!서)/
const NOMINAL = /^[은는이가의에도]/
const CONJ = /^\s*(와|과|및|·|,|\/|또는|이나|나)\s*$/
// 다른 주체가 정책을 말하는 문장 (v1과 같음): 요구·촉구·요청·제안
const OTHERS_TALK = /요구|촉구|요청|제안/
const OTHER_SUBJECT = /(상대국?|상대방|그들|다른 나라|타국)(이|가|은|는|도|의)\s/
const PARTNER_SUBJECT = /^(이|가|은|는|도|의|측|정부)/
const SELF_SUBJECT = /우리(나라)?(는|가|도)\s|우리 정부/
// 정책 단어와 방향 단어 사이에 유지 표현이나 다른 목적어가 있으면 방향 단어는 다른 대상을 말한다 (v1)
const POLICY_OBJECT = /^(단계|수준|세율|비율|상한|폭|수치|관세|통제)$/
const otherTarget = (between: string) =>
  /유지|지속|그대로/.test(between) || [...between.replace(/^\S*\s?/, '').matchAll(/([가-힣]+)[을를](?=\s|$)/g)].some((m) => !POLICY_OBJECT.test(m[1]))
// 소수점(93.8)에서는 자르지 않는다
const CLAUSE_SPLIT = /(?<!\d)\.(?!\d)|[!?\n;]|다\s/

type Tok = { at: number; end: number } & (
  | { t: 'good'; goods: string[] }
  | { t: 'partner'; partners: BlocId[]; subject: boolean }
  | { t: 'kind'; kind: PolicyKind }
  | { t: 'dir'; dir: Direction; noun: boolean; arrow: boolean }
)

export function extractClaims(text: string, self: BlocId): Claim[] {
  const claims: Claim[] = []
  for (const clause of text.split(CLAUSE_SPLIT)) {
    const toks: Tok[] = []
    const find = (w: string, make: (at: number, end: number) => Tok) => {
      for (let i = clause.indexOf(w); i >= 0; i = clause.indexOf(w, i + w.length)) toks.push(make(i, i + w.length))
    }
    for (const s of TRADED) for (const w of goodWords(s)) find(w, (at, end) => ({ at, end, t: 'good', goods: [s.id] }))
    for (const w of ALL_GOODS) find(w, (at, end) => ({ at, end, t: 'good', goods: TRADED.map((s) => s.id) }))
    for (const b of BLOCS)
      for (const w of [`${b}국`, ...REAL_WORDS[b]])
        find(w, (at, end) => ({ at, end, t: 'partner', partners: b === self ? [] : [b], subject: PARTNER_SUBJECT.test(clause.slice(end, end + 2)) }))
    for (const w of ALL_PARTNERS) find(w, (at, end) => ({ at, end, t: 'partner', partners: BLOCS.filter((b) => b !== self), subject: false }))
    for (const [kind, ws] of KIND_WORDS) for (const w of ws) find(w, (at, end) => ({ at, end, t: 'kind', kind }))
    for (const [dir, ws] of NOUN_DIRS) for (const w of ws) find(w, (at, end) => ({ at, end, t: 'dir', dir, noun: true, arrow: false }))
    for (const [dir, ws] of VERB_DIRS) for (const w of ws) find(w, (at, end) => ({ at, end, t: 'dir', dir, noun: false, arrow: false }))
    for (const m of clause.matchAll(ARROW)) {
      const a = Number(m[1])
      const b = Number(m[2])
      if (a !== b) toks.push({ at: m.index!, end: m.index! + m[0].length, t: 'dir', dir: b > a ? 'up' : 'down', noun: false, arrow: true })
    }
    // 겹치는 토큰은 먼저 시작하고 긴 것만 ('수출 통제' 안의 '통제', '대한민국' 안의 '한국')
    toks.sort((a, b) => a.at - b.at || b.end - a.end)
    const kept: Tok[] = []
    for (const t of toks) if (!kept.length || t.at >= kept[kept.length - 1].end) kept.push(t)

    let goods: string[] = []
    let partners: BlocId[] = []
    let subjectEnd = -1 // 마지막 상대국 이름이 주어(이·가·은·는·도·의)로 쓰였으면 그 끝 위치
    let kinds: { kind: PolicyKind; at: number; end: number }[] = []
    let closed = false
    let prevEnd = 0
    let segStart = 0
    const reset = (at: number) => {
      goods = []
      partners = []
      subjectEnd = -1
      kinds = []
      closed = false
      segStart = at
    }
    kept.forEach((t, idx) => {
      const between = clause.slice(prevEnd, t.at)
      prevEnd = t.end
      if (t.t !== 'dir' && closed) reset(t.at)
      if (t.t === 'good') goods.push(...t.goods)
      else if (t.t === 'partner') {
        partners.push(...t.partners)
        subjectEnd = t.subject && t.partners.length > 0 ? t.end : -1
      } else if (t.t === 'kind') {
        const nextDir = kept.slice(idx + 1).find((x) => x.t === 'dir')
        const after = clause.slice(t.end, Math.min(t.end + 12, nextDir ? nextDir.at : clause.length))
        if (!CLOSER.test(after)) kinds.push({ kind: t.kind, at: t.at, end: t.end })
      } else if (kinds.length && !closed) {
        closed = true
        // 뒤따르는 말은 쉼표나 다음 물품·상대·정책 단어 전까지만 본다 ("식품 관세 인하, 투자율 유지")
        const next = kept.slice(idx + 1).find((x) => x.t !== 'dir')
        const after = clause.slice(t.end, Math.min(t.end + 14, next ? next.at : clause.length)).split(/[,，]/)[0]
        const seg = clause.slice(segStart, t.at)
        const notSelf = OTHERS_TALK.test(seg) || OTHER_SUBJECT.test(seg) || (subjectEnd >= 0 && !SELF_SUBJECT.test(clause.slice(subjectEnd, t.at)))
        const skip =
          NOT_DONE.test(after) || CONDITIONAL.test(after) || (t.noun && NOMINAL.test(after)) || notSelf || (!t.arrow && otherTarget(between))
        if (skip) return
        // 가장 가까운 정책 단어 + 접속어로만 이어진 앞의 정책 단어들
        const attached = [kinds[kinds.length - 1]]
        for (let k = kinds.length - 2; k >= 0; k--) {
          if (!CONJ.test(clause.slice(kinds[k].end, attached[0].at))) break
          attached.unshift(kinds[k])
        }
        for (const kind of new Set(attached.map((x) => x.kind)))
          claims.push({
            kind,
            dir: t.dir,
            goods: kind === 'investment' ? [] : [...new Set(goods)],
            partners: kind === 'investment' ? [] : [...new Set(partners)],
            text: clause.trim(),
          })
      }
    })
  }
  return claims
}

const compatible = (cl: Claim, ch: PolicyChange) =>
  cl.kind === ch.kind &&
  (ch.kind === 'investment' || ((cl.goods.length === 0 || cl.goods.includes(ch.good!)) && (cl.partners.length === 0 || cl.partners.includes(ch.partner!))))
const specificity = (cl: Claim) => (cl.goods.length ? 1 : 0) + (cl.partners.length ? 1 : 0)
export const changeDir = (ch: PolicyChange): Direction => (ch.to > ch.from ? 'up' : 'down')
// 관세·투자율 0.5%p 미만 변화는 검사하지 않는다 (v1과 같은 기준)
export const significant = (ch: PolicyChange) => ch.kind === 'export_control' || Math.abs(ch.to - ch.from) >= 0.5

export function selfAwareness(events: GameEvent[], c: BlocId): QuarterAwareness[] {
  const out: QuarterAwareness[] = []
  for (const e of events) {
    if (e.type !== 'decision' || e.country !== c) continue
    const claims = extractClaims(`${e.action.reasoning ?? ''}\n${e.action.memoToSelf ?? ''}`, c)
    const sig = e.changes.filter(significant)
    out.push({
      quarter: e.quarter,
      changes: sig.map((ch) => {
        const dir = changeDir(ch)
        const cands = claims.filter((cl) => compatible(cl, ch))
        const best = Math.max(-1, ...cands.map(specificity))
        const top = cands.filter((cl) => specificity(cl) === best)
        const hit = top.find((cl) => cl.dir === dir) ?? top[0]
        return { ...ch, dir, status: hit ? (hit.dir === dir ? 'aware' : 'contradicted') : 'unmentioned', evidence: hit?.text ?? null }
      }),
      minor: e.changes.length - sig.length,
      // 반대 방향으로 바꾼 경우는 '반대로 앎'에서 세므로, 그 종류·물품·상대를 아예 안 바꾼 주장만 센다
      saidNotDone: claims.filter((cl) => !e.changes.some((ch) => compatible(cl, ch))),
    })
  }
  return out
}

export const hostileChange = (ch: CheckedChange) => ch.kind !== 'investment' && ch.dir === 'up'

export interface AwarenessSummary {
  changes: number
  aware: number
  contradicted: number
  unmentioned: number
  hostile: number
  hostileAware: number
  saidNotDone: number
  minor: number
}

export function summarizeAwareness(qs: QuarterAwareness[]): AwarenessSummary {
  const all = qs.flatMap((q) => q.changes)
  const hostile = all.filter(hostileChange)
  return {
    changes: all.length,
    aware: all.filter((x) => x.status === 'aware').length,
    contradicted: all.filter((x) => x.status === 'contradicted').length,
    unmentioned: all.filter((x) => x.status === 'unmentioned').length,
    hostile: hostile.length,
    hostileAware: hostile.filter((x) => x.status === 'aware').length,
    saidNotDone: qs.reduce((s, q) => s + q.saidNotDone.length, 0),
    minor: qs.reduce((s, q) => s + q.minor, 0),
  }
}

// ── 결과 인식 ──
// 지도자가 자기 목표 지표의 하락을 알아챘는지 본다. 결정 때 본 값(직전 분기)을 그 4분기 전(처음 4분기는 시작값)과 비교한다.
//  절대 이익: 생활수준이 1 이상 하락 (v1과 같음)
//  상대 이익: 명목 GDP 비율이 2% 이상 (상대적으로) 하락. 나라마다 비율 크기가 달라(한국 5.8%, 미국 169.8%) 비례로 잰다
export type OutcomeReading = 'noticed' | 'misread' | 'silent'
export const OUTCOME_LABEL: Record<OutcomeReading, string> = { noticed: '하락을 알아챔', misread: '좋게 씀', silent: '언급 없음' }
export const LS_DROP = 1
export const RATIO_DROP = 0.02

export interface OutcomeCheck {
  quarter: number
  metric: ObjectiveKind
  seen: number
  before: number
  status: OutcomeReading
  evidence: string | null
}

const WORDS: Record<ObjectiveKind, RegExp> = {
  absolute: /생활\s?수준|실질\s?소비|소비 수준/g,
  relative: /명목\s?GDP|GDP\s?비율|비율|격차|순위/g,
}
const DECLINE = /하락|떨어|감소|악화|낮아|줄어|줄었|손실|타격|위축|둔화|나빠|밀리|뒤처/
const POSITIVE = /안정|개선|향상|상승|견고|양호|탄탄|증가|효과적|성공|유지되|높아|긍정|기여했|역할을 했|좋아|확대/
const INTENT = /위해|위한|목표|겠|할 것|일 것|계획|방향으로|해야|하려|고자|수 있|추구|도모|촉진|노력|초점|최대화/

export function outcomeReading(events: GameEvent[], c: BlocId): OutcomeCheck[] {
  const start = events.find((e): e is Ev<'start'> => e.type === 'start')
  const metric: ObjectiveKind = start?.config.objectives[c] ?? 'absolute'
  const startRatio = events.find((e): e is Ev<'term'> => e.type === 'term' && e.country === c && e.fromQuarter === 0)?.startScore
  const value: number[] = []
  const thinking = new Map<number, string>()
  const out: OutcomeCheck[] = []
  for (const e of events) {
    if (e.type === 'quarter') value[e.quarter] = metric === 'absolute' ? e.indicators[c].livingStandard : e.ratio[c]
    else if (e.type === 'diplomacy' && e.country === c) thinking.set(e.quarter, `${thinking.get(e.quarter) ?? ''}\n${e.action.thinking ?? ''}`)
    else if (e.type === 'decision' && e.country === c && e.quarter > 0) {
      const seen = value[e.quarter - 1]
      const before = e.quarter - 5 >= 0 ? value[e.quarter - 5] : metric === 'absolute' ? 100 : startRatio
      if (seen === undefined || before === undefined) continue
      const dropped = metric === 'absolute' ? before - seen >= LS_DROP : before - seen >= RATIO_DROP * before
      if (!dropped) continue
      const text = `${thinking.get(e.quarter) ?? ''}\n${e.action.reasoning ?? ''}\n${e.action.memoToSelf ?? ''}`
      const words = WORDS[metric]
      const clauses = text.split(CLAUSE_SPLIT).map((s) => s.trim()).filter((s) => s.search(words) >= 0)
      const noticed = clauses.find((s) => DECLINE.test(s))
      const positive = clauses.find(
        (s) => !INTENT.test(s) && [...s.matchAll(words)].some((m) => POSITIVE.test(s.slice(m.index! + m[0].length, m.index! + m[0].length + 25))),
      )
      out.push({ quarter: e.quarter, metric, seen, before, status: noticed ? 'noticed' : positive ? 'misread' : 'silent', evidence: noticed ?? positive ?? null })
    }
  }
  return out
}

export interface OutcomeSummary {
  dropQuarters: number
  noticed: number
  misread: number
  silent: number
}

export function summarizeOutcome(xs: OutcomeCheck[]): OutcomeSummary {
  return {
    dropQuarters: xs.length,
    noticed: xs.filter((x) => x.status === 'noticed').length,
    misread: xs.filter((x) => x.status === 'misread').length,
    silent: xs.filter((x) => x.status === 'silent').length,
  }
}

// ── 동기 코딩 ──
// v1 키워드에 다자 게임용 동기(블록·동맹, 안보·공급망)와 실제 세계 기억(나라 이름 조건 효과를 보려고)을 더했다
export const MOTIVES: Record<string, { label: string; words: string[] }> = {
  ...V1_MOTIVES,
  relative: { label: '상대적 우위', words: [...V1_MOTIVES.relative.words, '명목 GDP 비율', '비교 대상', '1위', '추월', '따라잡'] },
  term: { label: '임기·후임', words: [...V1_MOTIVES.term.words, '다음 지도자', '전임'] },
  culture: { label: '문화', words: [...new Set([...V1_MOTIVES.culture.words, ...HOFSTEDE_DIMENSIONS.map((d) => d.name)])] },
  bloc: { label: '블록·동맹', words: ['동맹', '블록', '연합', '진영', '우방', '연대', '공동 전선', '결속', '포위', '고립'] },
  security: { label: '안보·공급망', words: ['안보', '공급망', '전략 물자', '전략물자', '패권', '디커플링', '탈동조화', '기술 유출', '첨단 기술'] },
  realworld: {
    label: '실제 세계 기억',
    words: ['무역전쟁', '무역 전쟁', '미중', '트럼프', '바이든', '시진핑', '칩스법', '반도체법', 'CHIPS', '사드', 'THAAD', 'WTO', 'RCEP', 'CPTPP', 'USMCA', 'NAFTA', 'OPEC', '석유 파동', '오일 쇼크', '플라자', '화웨이', '희토류', '역사적으로', '현실 세계', '실제 세계'],
  },
}

export function codeMotives(text: string): Set<string> {
  const found = new Set<string>()
  for (const [k, m] of Object.entries(MOTIVES)) if (m.words.some((w) => text.includes(w))) found.add(k)
  return found
}

// 분기별 비공개 판단 텍스트 (외교 thinking + 결정 reasoning + 자기 메모 + 인수인계 메모)
export function privateTexts(events: GameEvent[], c: BlocId): Map<number, string> {
  const out = new Map<number, string>()
  const add = (q: number, s: string | undefined) => s?.trim() && out.set(q, `${out.get(q) ?? ''}\n${s}`)
  for (const e of events) {
    if (e.type === 'diplomacy' && e.country === c) add(e.quarter, e.action.thinking)
    if (e.type === 'decision' && e.country === c) {
      add(e.quarter, e.action.reasoning)
      add(e.quarter, e.action.memoToSelf)
      add(e.quarter, e.action.handoverMemo)
    }
  }
  return out
}

// 지도자가 쓴 모든 텍스트 (비공개 + 성명 + 메시지)
export function allTexts(events: GameEvent[], c: BlocId): Map<number, string> {
  const out = privateTexts(events, c)
  const add = (q: number, s: string | undefined) => s?.trim() && out.set(q, `${out.get(q) ?? ''}\n${s}`)
  for (const e of events) {
    if ((e.type !== 'diplomacy' && e.type !== 'decision') || e.country !== c) continue
    add(e.quarter, e.action.statement?.text)
    for (const m of e.action.messages ?? []) add(e.quarter, m.text)
  }
  return out
}

// 익명 조건에서 실제 나라 이름을 쓴 분기와 이름 (지도자가 A~F의 정체를 추론했나). 실제 이름 조건에서는 의미 없다
export function realNameMentions(events: GameEvent[], c: BlocId): { quarters: number[]; names: Record<string, number> } {
  const quarters: number[] = []
  const names: Record<string, number> = {}
  for (const [q, text] of allTexts(events, c)) {
    let hit = false
    for (const b of BLOCS)
      for (const w of REAL_WORDS[b]) {
        if (!text.includes(w)) continue
        if (w === '한국' && text.includes('대한민국')) continue
        names[w] = (names[w] ?? 0) + 1
        hit = true
      }
    if (hit) quarters.push(q)
  }
  return { quarters: quarters.sort((a, b) => a - b), names }
}
