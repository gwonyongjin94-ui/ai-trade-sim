import { useEffect, useState } from 'react'
import { CULTURE, CULTURE_BRIEF_LABEL } from '../engine/culture'
import type { CultureBrief } from '../engine/culture'
import { OBJECTIVE_LABEL, OBJECTIVE_TEXT } from '../engine/objectives'
import type { ObjectiveKind } from '../engine/objectives'
import { COUNTRIES } from '../engine/types'
import type { CountryId } from '../engine/types'
import { DEFAULT_PARAMS } from '../engine/world'
import type { Effort, ModelInfo } from '../sim/llmTypes'
import { RULE_LABEL } from '../sim/rules'
import { RECAP_LABEL } from '../sim/types'
import type { Recap } from '../sim/types'
import type { RuleKind } from '../sim/rules'
import { SPEED_LABEL } from './session'
import type { SetupState, Speed } from './session'

const RULES = Object.keys(RULE_LABEL) as RuleKind[]

export function Setup({ onStart }: { onStart: (s: SetupState) => void }) {
  const [models, setModels] = useState<ModelInfo[] | null>(null)
  const [s, setS] = useState<SetupState>({
    A: { controller: 'human', objective: 'absolute' },
    B: { controller: 'rule:tit-for-tat', objective: 'absolute' },
    naming: 'real',
    culture: 'shown',
    recap: 'off',
    years: 12,
    speed: 'realtime',
    effort: 'medium',
  })

  useEffect(() => {
    fetch('/api/models')
      .then((r) => r.json())
      .then((m: ModelInfo[]) => setModels(m))
      .catch(() => setModels([]))
  }, [])

  const side = (c: CountryId, patch: Partial<SetupState['A']>) => setS((p) => ({ ...p, [c]: { ...p[c], ...patch } }))
  const hasHuman = COUNTRIES.some((c) => s[c].controller === 'human')
  const usesLlm = COUNTRIES.some((c) => s[c].controller !== 'human' && !s[c].controller.startsWith('rule:'))
  const llms = COUNTRIES.map((c) => s[c].controller).filter((id) => id !== 'human' && !id.startsWith('rule:'))
  const paid = llms.some((id) => !id.startsWith('ollama:'))
  const noKey = models !== null && !models.some((m) => m.available)

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr_320px]">
      {COUNTRIES.map((c) => (
        <section key={c} className="card space-y-3">
          <h2 className={`text-lg font-bold ${c === 'A' ? 'text-a' : 'text-b'}`}>
            {c}국 {c === 'A' ? '(공산품 강국)' : '(식량·에너지 강국)'}
          </h2>
          <details className="text-sm">
            <summary className="cursor-pointer">
              <b>{CULTURE[c].label}</b> · 인구 {DEFAULT_PARAMS[c].population} · 노동 인구 {Number(DEFAULT_PARAMS[c].labor.toFixed(1))} (경제활동참가율 {Math.round(CULTURE[c].participation * 100)}%)
            </summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-500">
              {CULTURE[c].traits.map((t) => (
                <li key={t}>{t}</li>
              ))}
              <li>소비 취향: {c === 'A' ? '가전제품·의약품·에너지에 더 많이 쓰고 곡물·의류에 덜 쓴다.' : '곡물·의류·생활용품에 더 많이 쓰고 가전제품·의약품에 덜 쓴다.'}</li>
            </ul>
          </details>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">대통령</span>
            <select className="field w-full" value={s[c].controller} onChange={(e) => side(c, { controller: e.target.value })}>
              <option value="human">사람 (직접 플레이)</option>
              <optgroup label="규칙 대통령 (비교 기준)">
                {RULES.map((r) => (
                  <option key={r} value={`rule:${r}`}>
                    {RULE_LABEL[r]}
                  </option>
                ))}
              </optgroup>
              <optgroup label="LLM 대통령">
                {(models ?? []).map((m) => (
                  <option key={m.id} value={m.id} disabled={!m.available}>
                    {m.label}
                    {m.available ? '' : ' (.env에 키 없음)'}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <fieldset className="text-sm">
            <legend className="mb-1 font-medium">목표</legend>
            {(['absolute', 'relative'] as ObjectiveKind[]).map((o) => (
              <label key={o} className="mb-1 flex items-start gap-2">
                <input type="radio" className="mt-1" checked={s[c].objective === o} onChange={() => side(c, { objective: o })} />
                <span>
                  <b>{OBJECTIVE_LABEL[o]}</b>
                  <span className="block text-xs text-slate-500">{OBJECTIVE_TEXT[o](16)}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </section>
      ))}

      <section className="card space-y-3 text-sm">
        <h2 className="text-lg font-bold">게임</h2>
        <label className="block">
          <span className="mb-1 block font-medium">진행 속도</span>
          <select className="field w-full" value={s.speed} onChange={(e) => setS({ ...s, speed: e.target.value as Speed })}>
            {(Object.keys(SPEED_LABEL) as Speed[]).map((k) => (
              <option key={k} value={k} disabled={k === 'watch' && hasHuman}>
                {SPEED_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block font-medium">기간</span>
          <select className="field w-full" value={s.years} onChange={(e) => setS({ ...s, years: Number(e.target.value) })}>
            <option value={4}>4년 (대통령 1명)</option>
            <option value={8}>8년 (대통령 2명)</option>
            <option value={12}>12년 (대통령 3명)</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block font-medium">물품 이름</span>
          <select className="field w-full" value={s.naming} onChange={(e) => setS({ ...s, naming: e.target.value as SetupState['naming'] })}>
            <option value="real">실제 이름 (곡물, 에너지 …)</option>
            <option value="abstract">익명 (필수재 N1 …)</option>
          </select>
        </label>
        {usesLlm && (
          <label className="block">
            <span className="mb-1 block font-medium">LLM 대통령에게 문화 설명</span>
            <select className="field w-full" value={s.culture} onChange={(e) => setS({ ...s, culture: e.target.value as CultureBrief })}>
              {(Object.keys(CULTURE_BRIEF_LABEL) as CultureBrief[]).map((k) => (
                <option key={k} value={k}>
                  {CULTURE_BRIEF_LABEL[k]}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">소비 취향·노동 인구의 문화 차이는 어느 쪽이든 경제에 들어간다. 이 설정은 프롬프트의 문화 설명만 바꾼다.</span>
          </label>
        )}
        {usesLlm && (
          <label className="block">
            <span className="mb-1 block font-medium">지난 분기 실제 변화 알려주기</span>
            <select className="field w-full" value={s.recap} onChange={(e) => setS({ ...s, recap: e.target.value as Recap })}>
              {(Object.keys(RECAP_LABEL) as Recap[]).map((k) => (
                <option key={k} value={k}>
                  {RECAP_LABEL[k]}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">켜면 LLM 대통령이 매 분기 자기 나라가 지난 분기에 실제로 바꾼 정책과 확전점수를 본다. 자기가 한 일을 착각하는지 보는 실험 조건.</span>
          </label>
        )}
        {paid && (
          <label className="block">
            <span className="mb-1 block font-medium">LLM 사고 수준 (effort)</span>
            <select className="field w-full" value={s.effort} onChange={(e) => setS({ ...s, effort: e.target.value as Effort })}>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
        )}
        {s.speed === 'watch' && hasHuman && <p className="text-amber-600">사람이 있으면 빠르게 관전을 쓸 수 없습니다.</p>}
        {usesLlm && paid && <p className="rounded-md bg-amber-50 p-2 text-amber-800 dark:bg-amber-950 dark:text-amber-200">LLM 대통령은 분기마다 API를 두 번 호출하므로 요금이 듭니다. 12년 게임 한 판 추정: Haiku 약 $0.1, Sonnet 약 $2, Opus 약 $4 (대통령 한 명 기준).</p>}
        {usesLlm && !paid && <p className="text-slate-500">로컬 모델은 무료입니다. 대신 이 컴퓨터에서 돌아 응답이 느립니다 (호출 한 번에 수십 초~몇 분). 대통령이 생각하는 동안 분기가 기다립니다.</p>}
        {noKey && <p className="text-slate-500">LLM을 쓰려면 프로젝트 폴더의 .env에 ANTHROPIC_API_KEY를 넣거나, 무료로 쓰려면 Ollama를 켜고 모델을 받으세요 (README 참고). 그다음 새로고침하세요.</p>}
        <button
          className="btn w-full"
          disabled={s.speed === 'watch' && hasHuman}
          onClick={() => onStart(s)}
        >
          시작
        </button>
      </section>
    </div>
  )
}
