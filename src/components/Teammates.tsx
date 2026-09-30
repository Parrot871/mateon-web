import { useCallback, useEffect, useRef, useState } from 'react'
import { getRecommendedUsers, getUserRecommendationReason } from '../api/recommend'
import { draftProposalForUser } from '../api/proposal'
import { createTeamOffer, getTeamOffers, cancelTeamOffer } from '../api/counteroffer'
import { SchoolNotVerifiedError } from '../api/team'
import {
  MatchingIntentRequiredError,
  TeamEmbeddingNotReadyError,
  ForbiddenAccessError,
  ResourceNotFoundError,
  RecommendationNotFoundError,
  TeamRecruitmentClosedError,
  InvalidInputError,
  DuplicateResourceError,
  OfferAlreadyRespondedError,
} from '../lib/error'
import type { UserRecommendation } from '../types/recommend'
import type { TeamOfferResponseDTO, OfferStatus } from '../types/team'

const RECOMMEND_LIMIT = 3
const MAX_VISIBLE_SKILLS = 6
const REASON_CONCURRENCY = 3

const ROLE_LABEL: Record<string, string> = {
  BE: '백엔드',
  FE: '프론트엔드',
  PM: '기획/PM',
  DESIGN: '디자인',
  DATA: '데이터',
  AI: 'AI/ML',
}

const EXPERIENCE_LABEL: Record<string, string> = {
  beginner: '입문',
  intermediate: '중급',
  advanced: '숙련',
}

const OFFER_STATUS: Record<OfferStatus, { label: string; className: string }> = {
  PENDING: { label: '대기 중', className: 'bg-amber-50 text-amber-700 border-amber-100' },
  ACCEPTED: { label: '수락됨', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  REJECTED: { label: '거절됨', className: 'bg-slate-100 text-slate-500 border-slate-200' },
  CANCELED: { label: '취소됨', className: 'bg-slate-100 text-slate-400 border-slate-200' },
}

function toErrorMessage(e: unknown): string {
  if (e instanceof TeamEmbeddingNotReadyError) {
    return '팀 정보 분석이 아직 끝나지 않았어요. 잠시 후 다시 시도해 주세요.'
  }
  if (e instanceof MatchingIntentRequiredError) {
    return '매칭 의도 추출이 완료되어야 추천을 받을 수 있어요.'
  }
  if (e instanceof ForbiddenAccessError) {
    return '팀장만 이용할 수 있어요.'
  }
  if (e instanceof ResourceNotFoundError) {
    return '팀을 찾을 수 없어요.'
  }
  if (e instanceof RecommendationNotFoundError) {
    return '추천 이력을 찾을 수 없어요. 추천을 새로고침해 주세요.'
  }
  if (e instanceof SchoolNotVerifiedError) {
    return '학교 인증이 완료되지 않았어요.'
  }
  if (e instanceof TeamRecruitmentClosedError) {
    return '이미 모집이 마감된 팀이에요.'
  }
  if (e instanceof InvalidInputError) {
    return '입력 내용을 다시 확인해 주세요.'
  }
  if (e instanceof DuplicateResourceError) {
    return '이미 제안을 보낸 유저예요.'
  }
  if (e instanceof OfferAlreadyRespondedError) {
    return '이미 응답이 완료된 제안이에요.'
  }
  return e instanceof Error ? e.message : '알 수 없는 오류가 발생했어요.'
}

function formatScore(score: number | null | undefined): string | null {
  if (typeof score !== 'number' || Number.isNaN(score)) return null
  return `${Math.round(Math.min(Math.max(score, 0), 1) * 100)}%`
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  let index = 0
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (index < items.length) {
        const item = items[index++]
        await worker(item)
      }
    },
  )
  await Promise.all(runners)
}

type ReasonState =
  | { status: 'loading' }
  | { status: 'done'; text: string }
  | { status: 'error'; error: string }

interface Props {
  teamId: number
  isLeader: boolean
}

export default function Teammates({ teamId, isLeader }: Props) {
  const [users, setUsers] = useState<UserRecommendation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reasons, setReasons] = useState<Record<number, ReasonState>>({})
  const [selectedUser, setSelectedUser] = useState<UserRecommendation | null>(null)
  const requestSeq = useRef(0)
  const sentUserIds = useRef<Set<number>>(new Set())

  const fetchReason = useCallback(
    async (userId: number, seq: number) => {
      setReasons((prev) => ({ ...prev, [userId]: { status: 'loading' } }))
      try {
        const text = await getUserRecommendationReason({ teamId, userId })
        if (seq !== requestSeq.current) return
        setReasons((prev) => ({ ...prev, [userId]: { status: 'done', text } }))
      } catch (e) {
        if (seq !== requestSeq.current) return
        setReasons((prev) => ({
          ...prev,
          [userId]: { status: 'error', error: toErrorMessage(e) },
        }))
      }
    },
    [teamId],
  )

  const load = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    setReasons({})
    try {
      const data = await getRecommendedUsers({ teamId, limit: RECOMMEND_LIMIT })
      if (seq !== requestSeq.current) return
      const filtered = data.filter((u) => !sentUserIds.current.has(u.userId))
      setUsers(filtered)
      void runWithConcurrency(filtered, REASON_CONCURRENCY, (u) => fetchReason(u.userId, seq))
    } catch (e) {
      if (seq !== requestSeq.current) return
      setUsers([])
      setError(toErrorMessage(e))
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [teamId, fetchReason])

  const handleSent = useCallback(
    (userId: number) => {
      sentUserIds.current.add(userId)
      void load()
    },
    [load],
  )

  useEffect(() => {
    if (!isLeader) return
    load()
    return () => {
      requestSeq.current++
    }
  }, [isLeader, load])

  if (!isLeader) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 py-16 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          🔒
        </div>
        <p className="text-sm font-semibold text-slate-700">팀장만 이용할 수 있어요</p>
        <p className="mt-1 text-sm text-slate-500">팀원 추천 기능은 팀장 권한이 필요합니다.</p>
      </div>
    )
  }

  return (
    <section className="w-full">
      {/* 헤더 영역 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">
            우리 팀에 맞는 유저 추천 ✨
          </h2>
          <p className="mt-1.5 text-sm text-slate-500">
            팀 정보와 모집 조건을 분석해 가장 시너지가 좋을 팀원을 찾아봤어요.
          </p>
        </div>

        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:opacity-50"
        >
          {loading ? (
            <svg className="h-4 w-4 animate-spin text-slate-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          {loading ? '분석 중...' : '새로고침'}
        </button>
      </div>

      {/* 추천 유저 리스트 */}
      <div className="mt-6">
        {loading ? (
          <div className="grid gap-4 md:grid-cols-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[280px] w-full animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white py-16 text-center shadow-sm">
            <p className="text-sm font-medium text-slate-600">{error}</p>
            <button onClick={load} className="mt-4 rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">
              다시 시도하기
            </button>
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 py-16 text-center">
            <p className="text-sm text-slate-500">추천할 유저가 아직 없어요.</p>
          </div>
        ) : (
          <ul className="grid gap-4 md:grid-cols-1">
            {users.map((user) => (
              <UserCard
                key={user.userId}
                user={user}
                reason={reasons[user.userId]}
                onRetry={() => fetchReason(user.userId, requestSeq.current)}
                onPropose={(u) => setSelectedUser(u)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* 제안하기 모달 */}
      {selectedUser && (
        <ProposalModal
          teamId={teamId}
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onSent={handleSent}
        />
      )}
    </section>
  )
}

export function OfferManagement({ teamId, isLeader }: Props) {
  const [offers, setOffers] = useState<TeamOfferResponseDTO[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelingId, setCancelingId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const requestSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const data = await getTeamOffers(teamId)
      if (seq !== requestSeq.current) return
      setOffers(data)
    } catch (e) {
      if (seq !== requestSeq.current) return
      setOffers([])
      setError(toErrorMessage(e))
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [teamId])

  useEffect(() => {
    if (!isLeader) return
    load()
    return () => {
      requestSeq.current++
    }
  }, [isLeader, load])

  const handleCancel = useCallback(
    async (offerId: number) => {
      if (cancelingId !== null) return
      if (!window.confirm('이 제안을 취소할까요?')) return
      setCancelingId(offerId)
      setActionError(null)
      try {
        await cancelTeamOffer(offerId)
        setOffers((prev) =>
          prev.map((o) => (o.offerId === offerId ? { ...o, status: 'CANCELED' as const } : o)),
        )
      } catch (e) {
        setActionError(toErrorMessage(e))
        // 이미 응답된 경우 등 서버 상태와 어긋났을 수 있으니 목록 갱신
        if (e instanceof OfferAlreadyRespondedError) void load()
      } finally {
        setCancelingId(null)
      }
    },
    [cancelingId, load],
  )

  if (!isLeader) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 py-16 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          🔒
        </div>
        <p className="text-sm font-semibold text-slate-700">팀장만 이용할 수 있어요</p>
        <p className="mt-1 text-sm text-slate-500">제안 관리 기능은 팀장 권한이 필요합니다.</p>
      </div>
    )
  }

  return (
    <section className="w-full">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">제안 관리</h2>
          <p className="mt-1.5 text-sm text-slate-500">
            우리 팀이 유저에게 보낸 합류 제안의 진행 상태를 확인하고 관리해요.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? '불러오는 중...' : '새로고침'}
        </button>
      </div>

      {actionError && <p className="mt-4 text-sm text-red-500">{actionError}</p>}

      <div className="mt-6">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 w-full animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white py-16 text-center shadow-sm">
            <p className="text-sm font-medium text-slate-600">{error}</p>
            <button
              onClick={load}
              className="mt-4 rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
            >
              다시 시도하기
            </button>
          </div>
        ) : offers.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 py-16 text-center">
            <p className="text-sm text-slate-500">아직 보낸 제안이 없어요.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {offers.map((offer) => {
              const status = OFFER_STATUS[offer.status]
              const isPending = offer.status === 'PENDING'
              const affiliation = [offer.targetUserSchool, offer.targetUserMajor]
                .filter(Boolean)
                .join(' · ')
              const score = formatScore(offer.aiScore)

              return (
                <li
                  key={offer.offerId}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-bold text-slate-900">
                          {offer.targetUserName}
                        </h3>
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${status.className}`}
                        >
                          {status.label}
                        </span>
                        {score && (
                          <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                            {offer.aiLabel ? `${offer.aiLabel} · ${score}` : `${score} 매칭`}
                          </span>
                        )}
                      </div>
                      {affiliation && (
                        <p className="mt-0.5 text-sm text-slate-500">{affiliation}</p>
                      )}
                      <p className="mt-0.5 text-xs text-slate-400">
                        {new Date(offer.createdAt).toLocaleDateString('ko-KR')} 발송
                        {offer.respondedAt &&
                          ` · ${new Date(offer.respondedAt).toLocaleDateString('ko-KR')} 응답`}
                      </p>
                    </div>

                    {isPending && (
                      <button
                        type="button"
                        onClick={() => handleCancel(offer.offerId)}
                        disabled={cancelingId !== null}
                        className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {cancelingId === offer.offerId ? '취소 중...' : '제안 취소'}
                      </button>
                    )}
                  </div>

                  {offer.message && (
                    <p className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">
                      {offer.message}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

function UserCard({
  user,
  reason,
  onRetry,
  onPropose,
}: {
  user: UserRecommendation
  reason?: ReasonState
  onRetry: () => void
  onPropose: (user: UserRecommendation) => void
}) {
  const score = formatScore(user.score)
  const affiliation = [user.school, user.major, user.grade].filter(Boolean).join(' · ')
  const roles = user.desiredRoles ?? []
  const skills = user.skills ?? []
  const visibleSkills = skills.slice(0, MAX_VISIBLE_SKILLS)
  const hiddenSkillCount = skills.length - visibleSkills.length
  const temperature = typeof user.collaborationTemperature === 'number' ? user.collaborationTemperature : null

  return (
    <li className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-blue-200 hover:shadow-md">
      <div>
        {/* 상단 프로필 및 스코어 */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-indigo-50 text-base font-bold text-blue-700 ring-4 ring-white">
              {user.name.slice(0, 1)}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">{user.name}</h3>
              {affiliation && <p className="mt-0.5 text-sm text-slate-500">{affiliation}</p>}
            </div>
          </div>
          {score && (
            <div className="flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 shadow-sm">
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
              </svg>
              {score} 매칭
            </div>
          )}
        </div>

        {/* 자기소개 */}
        {user.tagline && (
          <p className="mt-4 text-sm font-medium italic text-slate-600">
            "{user.tagline}"
          </p>
        )}

        {/* AI 추천 이유 박스 */}
        <div className="mt-5 rounded-xl border border-blue-100/50 bg-blue-50/40 p-4">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-blue-700">AI 추천 포인트</span>
          </div>
          <div className="mt-2">
            {!reason || reason.status === 'loading' ? (
              <div className="space-y-2">
                <div className="h-2 w-full animate-pulse rounded bg-blue-200/50" />
                <div className="h-2 w-2/3 animate-pulse rounded bg-blue-200/50" />
              </div>
            ) : reason.status === 'error' ? (
              <p className="text-sm text-slate-500">
                {reason.error}{' '}
                <button onClick={onRetry} className="font-semibold text-blue-600 hover:underline">
                  다시 시도
                </button>
              </p>
            ) : (
              <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                {reason.text}
              </p>
            )}
          </div>
        </div>

        {/* 태그 영역 (역할, 경험, 스킬) */}
        <div className="mt-5 flex flex-wrap gap-2">
          {roles.map((role) => (
            <span key={role} className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white shadow-sm">
              {ROLE_LABEL[role.toUpperCase()] ?? role}
            </span>
          ))}
          {user.experienceLevel && (
            <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm">
              {EXPERIENCE_LABEL[user.experienceLevel.toLowerCase()] ?? user.experienceLevel}
            </span>
          )}
          {user.activityStyle && (
            <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm">
              {user.activityStyle}
            </span>
          )}
          {/* 구분선 */}
          {(roles.length > 0 || user.experienceLevel) && skills.length > 0 && (
            <div className="mx-1 h-6 w-px bg-slate-200" />
          )}
          {visibleSkills.map((skill) => (
            <span key={skill} className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              {skill}
            </span>
          ))}
          {hiddenSkillCount > 0 && (
            <span className="rounded-md bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-400">
              +{hiddenSkillCount}
            </span>
          )}
        </div>
      </div>

      {/* 하단 영역 (온도 & 버튼) */}
      <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-5">
        <div className="flex w-1/2 items-center gap-3">
          <span className="shrink-0 text-xs font-medium text-slate-500">협업 온도</span>
          {temperature !== null ? (
            <div className="flex-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500"
                  style={{ width: `${Math.min(Math.max(temperature, 0), 100)}%` }}
                />
              </div>
            </div>
          ) : (
            <span className="text-xs text-slate-400">-</span>
          )}
          {temperature !== null && (
            <span className="shrink-0 text-xs font-bold text-slate-700">{temperature.toFixed(1)}°C</span>
          )}
        </div>

        <button
          type="button"
          onClick={() => onPropose(user)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-700 hover:shadow active:scale-95"
        >
          제안하기
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </button>
      </div>
    </li>
  )
}

function ProposalModal({
  teamId,
  user,
  onClose,
  onSent,
}: {
  teamId: number
  user: UserRecommendation
  onClose: () => void
  onSent: (userId: number) => void
}) {
  const [message, setMessage] = useState('')
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const requestSeq = useRef(0)

  const generateDraft = useCallback(async () => {
    const seq = ++requestSeq.current
    setDraftLoading(true)
    setDraftError(null)
    setSendError(null)
    try {
      const draft = await draftProposalForUser({ teamId, userId: user.userId })
      if (seq !== requestSeq.current) return
      setMessage(draft.message)
    } catch (e) {
      if (seq !== requestSeq.current) return
      setDraftError(toErrorMessage(e))
    } finally {
      if (seq === requestSeq.current) setDraftLoading(false)
    }
  }, [teamId, user.userId])

  useEffect(() => {
    generateDraft()
    return () => {
      requestSeq.current++
    }
  }, [generateDraft])

  const handleSend = useCallback(async () => {
    if (sending) return
    setSending(true)
    setSendError(null)
    try {
      await createTeamOffer({
        teamId,
        userId: user.userId,
        message: message.trim() || undefined,
      })
      onSent(user.userId)
      onClose()
    } catch (e) {
      setSendError(toErrorMessage(e))
    } finally {
      setSending(false)
    }
  }, [sending, teamId, user.userId, message, onSent, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        {/* 헤더 */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              ✨ 팀 합류 제안
            </h3>

            <p className="mt-1 text-sm text-slate-500">
              {user.name}님께 보낼 제안 메시지를 확인해 주세요.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="text-xl text-slate-400 hover:text-slate-600 disabled:opacity-50"
          >
            ×
          </button>
        </div>

        {/* 안내 */}
        <div className="mt-5 rounded-xl bg-blue-50 p-4">
          <p className="text-xs font-semibold text-blue-600">
            ✨ AI가 작성한 제안 초안
          </p>

          <p className="mt-1 text-xs leading-5 text-blue-500">
            내용을 확인하고 자유롭게 수정한 후 제안을 보내세요.
          </p>
        </div>

        {/* 메시지 */}
        {draftLoading ? (
          <div className="mt-4 space-y-2 rounded-xl border border-slate-200 p-4">
            <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
          </div>
        ) : draftError ? (
          <div className="mt-4 rounded-xl border border-slate-200 p-4 text-center">
            <p className="text-sm text-slate-500">{draftError}</p>
            <button
              type="button"
              onClick={generateDraft}
              className="mt-2 text-sm font-semibold text-blue-600 hover:underline"
            >
              다시 시도
            </button>
          </div>
        ) : (
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={sending}
            rows={9}
            className="mt-4 w-full resize-none rounded-xl border border-slate-200 p-4 text-sm leading-6 text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
          />
        )}

        {/* 전송 에러 */}
        {sendError && <p className="mt-3 text-sm text-red-500">{sendError}</p>}

        {/* 버튼 */}
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={generateDraft}
            disabled={draftLoading || sending}
            className="text-sm font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >
            다시 생성
          </button>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50"
            >
              취소
            </button>

            <button
              type="button"
              disabled={draftLoading || sending || !!draftError || !message}
              onClick={handleSend}
              className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {sending ? '보내는 중...' : '제안 보내기'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}