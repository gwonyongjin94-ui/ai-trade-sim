// 사람 대통령의 입력창. 1라운드: 메시지·제안 / 2라운드: 수락·정책·마지막 메시지

import { useEffect, useState } from 'react'
import { describeTerm, TONE_LABEL } from '../engine/diplomacy'
import type { ProposalTerm, Tone } from '../engine/diplomacy'
import { EXPORT_LEVEL_LABEL, INVEST_MAX, INVEST_MIN, rival } from '../engine/types'
import type { CountryId, ExportLevel } from '../engine/types'
import { CATEGORY_LABEL, GOODS, goodName } from '../engine/goods'
import type { GoodId, Naming } from '../engine/goods'
import { keepPolicyAction } from '../sim/game'
import type { HumanLeader, HumanPrompt } from '../sim/human'
import type { DecisionAction } from '../sim/types'

const TONES = Object.keys(TONE_LABEL) as Tone[]

function useHumanPrompt(h: HumanLeader): HumanPrompt | null {
  const [, setTick] = useState(0)
  useEffect(() => h.subscribe(() => setTick((t) => t + 1)), [h])
  return h.pending
}

export function HumanPanel({ country, leader, naming }: { country: CountryId; leader: HumanLeader; naming: Naming }) {
  const prompt = useHumanPrompt(leader)
  const color = country === 'A' ? 'border-a' : 'border-b'
  if (!prompt) {
    return (
      <section className={`card border-l-4 ${color} text-sm text-slate-500`}>
        {country}국 대통령(사람): 상대와 엔진을 기다리는 중…
      </section>
    )
  }
  return (
    <section className={`card border-l-4 ${color} space-y-3`}>
      {prompt.round === 1 ? (
        <Round1 key={`r1-${prompt.obs.quarter}`} country={country} naming={naming} onSubmit={(a) => leader.submitDiplomacy(a)} />
      ) : (
        <Round2 key={`r2-${prompt.obs.quarter}`} country={country} naming={naming} prompt={prompt} onSubmit={(a) => leader.submitDecision(a)} />
      )}
    </section>
  )
}

function ToneSelect({ value, onChange }: { value: Tone; onChange: (t: Tone) => void }) {
  return (
    <select className="field" value={value} onChange={(e) => onChange(e.target.value as Tone)}>
      {TONES.map((t) => (
        <option key={t} value={t}>
          {TONE_LABEL[t]}
        </option>
      ))}
    </select>
  )
}

interface DraftProposal {
  terms: ProposalTerm[]
  durationQuarters: number
  note: string
}

function Round1({ country, naming, onSubmit }: { country: CountryId; naming: Naming; onSubmit: (a: { message: string; tone: Tone; proposals: DraftProposal[] }) => void }) {
  const [message, setMessage] = useState('')
  const [tone, setTone] = useState<Tone>('neutral')
  const [proposals, setProposals] = useState<DraftProposal[]>([])
  const name = (id: GoodId) => goodName(GOODS.find((g) => g.id === id)!, naming)
  const update = (i: number, p: DraftProposal) => setProposals((ps) => ps.map((x, j) => (j === i ? p : x)))

  return (
    <>
      <h3 className="font-semibold">{country}국 대통령: 외교 1라운드 — 메시지와 제안</h3>
      <textarea className="field h-20 w-full" placeholder={`${rival(country)}국 대통령에게 보낼 메시지 (비워도 됨)`} value={message} onChange={(e) => setMessage(e.target.value)} />
      <div className="flex items-center gap-2 text-sm">
        어조 <ToneSelect value={tone} onChange={setTone} />
      </div>
      {proposals.map((p, i) => (
        <div key={i} className="space-y-2 rounded-md border border-slate-200 p-2 text-sm dark:border-slate-700">
          {p.terms.map((t, k) => (
            <TermEditor
              key={k}
              term={t}
              naming={naming}
              onChange={(nt) => update(i, { ...p, terms: p.terms.map((x, j) => (j === k ? nt : x)) })}
              onRemove={() => update(i, { ...p, terms: p.terms.filter((_, j) => j !== k) })}
            />
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-ghost" onClick={() => update(i, { ...p, terms: [...p.terms, { obligor: 'both', kind: 'tariff_max', goods: ['all'], value: 5 }] })}>
              조건 추가
            </button>
            기간
            <input type="number" min={1} max={16} className="field w-16" value={p.durationQuarters} onChange={(e) => update(i, { ...p, durationQuarters: Number(e.target.value) })} />
            분기
            <button className="btn-ghost ml-auto" onClick={() => setProposals((ps) => ps.filter((_, j) => j !== i))}>
              제안 삭제
            </button>
          </div>
          <p className="text-xs text-slate-500">{p.terms.map((t) => describeTerm(t, country, name)).join(' / ')}</p>
        </div>
      ))}
      <div className="flex gap-2">
        <button className="btn-ghost" onClick={() => setProposals((ps) => [...ps, { terms: [{ obligor: 'both', kind: 'tariff_max', goods: ['all'], value: 5 }], durationQuarters: 4, note: '' }])}>
          제안 만들기
        </button>
        <button className="btn ml-auto" onClick={() => onSubmit({ message, tone, proposals })}>
          보내기
        </button>
      </div>
    </>
  )
}

function TermEditor({ term, naming, onChange, onRemove }: { term: ProposalTerm; naming: Naming; onChange: (t: ProposalTerm) => void; onRemove: () => void }) {
  const all = term.goods.includes('all')
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="field" value={term.obligor} onChange={(e) => onChange({ ...term, obligor: e.target.value as ProposalTerm['obligor'] })}>
        <option value="both">양국은</option>
        <option value="proposer">우리는</option>
        <option value="counterpart">상대는</option>
      </select>
      <select className="field" value={all ? 'all' : term.goods[0]} onChange={(e) => onChange({ ...term, goods: [e.target.value as GoodId | 'all'] })}>
        <option value="all">전 품목</option>
        {GOODS.map((g) => (
          <option key={g.id} value={g.id}>
            {goodName(g, naming)}
          </option>
        ))}
      </select>
      <select className="field" value={term.kind} onChange={(e) => onChange({ ...term, kind: e.target.value as ProposalTerm['kind'], value: e.target.value === 'tariff_max' ? 5 : 0 })}>
        <option value="tariff_max">관세 상한 (%)</option>
        <option value="export_control_max">수출 통제 상한 (단계)</option>
      </select>
      <input type="number" className="field w-20" min={0} max={term.kind === 'tariff_max' ? 200 : 3} value={term.value} onChange={(e) => onChange({ ...term, value: Number(e.target.value) })} />
      <button className="text-xs text-slate-500 underline" onClick={onRemove}>
        빼기
      </button>
    </div>
  )
}

function Round2({ country, naming, prompt, onSubmit }: { country: CountryId; naming: Naming; prompt: Extract<HumanPrompt, { round: 2 }>; onSubmit: (a: DecisionAction) => void }) {
  const own = prompt.obs.policies[country]
  const [draft, setDraft] = useState<DecisionAction>(() => keepPolicyAction(own))
  const [accept, setAccept] = useState<string[]>([])
  const name = (id: GoodId) => goodName(GOODS.find((g) => g.id === id)!, naming)
  const r = rival(country)
  const setTariff = (id: GoodId, v: number) => setDraft((d) => ({ ...d, policy: { ...d.policy, tariffsPct: { ...d.policy.tariffsPct, [id]: v } } }))
  const setControl = (id: GoodId, v: ExportLevel) => setDraft((d) => ({ ...d, policy: { ...d.policy, exportControls: { ...d.policy.exportControls, [id]: v } } }))

  return (
    <>
      <h3 className="font-semibold">{country}국 대통령: 외교 2라운드 + 이번 분기 정책</h3>
      <div className="rounded-md bg-slate-100 p-2 text-sm dark:bg-slate-800">
        <div className="mb-1 text-xs text-slate-500">
          {r}국 1라운드 메시지 ({TONE_LABEL[prompt.rivalMessage.tone]})
        </div>
        {prompt.rivalMessage.message || '(메시지 없음)'}
        {prompt.obs.pendingProposals.map((p) => (
          <label key={p.id} className="mt-2 flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={accept.includes(p.id)} onChange={(e) => setAccept((a) => (e.target.checked ? [...a, p.id] : a.filter((x) => x !== p.id)))} />
            <span>
              <b>[{p.id}] 수락</b> — {p.terms.map((t) => describeTerm(t, p.from, name)).join(' / ')} · {p.durationQuarters}분기
              {p.note && <span className="text-slate-500"> · “{p.note}”</span>}
            </span>
          </label>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="py-1">물품</th>
              <th>관세 %</th>
              <th>수출 통제</th>
              <th className="text-right">수입 의존도</th>
            </tr>
          </thead>
          <tbody>
            {GOODS.map((g, i) => (
              <tr key={g.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1">
                  {goodName(g, naming)} <span className="text-xs text-slate-400">{CATEGORY_LABEL[g.category]}</span>
                </td>
                <td>
                  <input type="number" min={0} max={200} step={1} aria-label={`${goodName(g, naming)} 관세 %`} className="field w-20" value={draft.policy.tariffsPct[g.id]} onChange={(e) => setTariff(g.id, Number(e.target.value))} />
                </td>
                <td>
                  <select className="field" aria-label={`${goodName(g, naming)} 수출 통제`} value={draft.policy.exportControls[g.id]} onChange={(e) => setControl(g.id, Number(e.target.value) as ExportLevel)}>
                    {EXPORT_LEVEL_LABEL.map((l, k) => (
                      <option key={k} value={k}>
                        {k} {l}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="text-right tabular-nums">{(prompt.obs.trade[i].importDependence * 100).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="flex items-center gap-3 text-sm">
        투자율 {draft.policy.investmentRatePct.toFixed(0)}%
        <input
          type="range"
          min={INVEST_MIN * 100}
          max={INVEST_MAX * 100}
          step={1}
          value={draft.policy.investmentRatePct}
          onChange={(e) => setDraft((d) => ({ ...d, policy: { ...d.policy, investmentRatePct: Number(e.target.value) } }))}
        />
      </label>
      <textarea className="field h-16 w-full" placeholder="마지막 메시지 (비워도 됨)" value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} />
      <div className="flex items-center gap-2 text-sm">
        어조 <ToneSelect value={draft.tone} onChange={(t) => setDraft({ ...draft, tone: t })} />
        <button className="btn ml-auto" onClick={() => onSubmit({ ...draft, acceptProposals: accept })}>
          확정
        </button>
      </div>
    </>
  )
}
