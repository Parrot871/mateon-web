import { getAccessToken } from './tokenStorage'
import { safeFetch, parseApiResponse, isApiErrorPayload } from '../lib/apiErrorHandler'
import {
  ForbiddenAccessError,
  MatchingIntentRequiredError,
  ResourceNotFoundError,
  RecommendationNotFoundError,
} from '../lib/error'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

// ── 공통 응답 스키마 (ProposalDraftResponseDTO) ──
export interface ProposalDraftResponse {
  direction: 'USER_TO_TEAM' | 'TEAM_TO_USER'
  message: string
  summary: string
  synergyScore: number
  teamId: number
  userId: number
}

// ── 팀 → 유저 (역제안 초안) ──

export interface UserProposalRequest {
  teamId: number
  userId: number
}

function mapTeamToUserProposalError(status: number, message: string): Error | null {
  if (status === 400) {
    if (message.includes('팀장만')) return new ForbiddenAccessError(message)
    if (message.includes('매칭 의도')) return new MatchingIntentRequiredError(message)
    if (message.includes('찾을 수 없습니다')) return new ResourceNotFoundError(message)
  }
  if (status === 404) {
    // RECOMMENDATION_NOT_FOUND — 먼저 GET .../team-to-user 를 호출해야 함
    return new RecommendationNotFoundError(message)
  }
  return null
}

// 추천받은 유저에게 보낼 제안 문구 초안(팀장 전용)
export async function draftProposalForUser(
  payload: UserProposalRequest
): Promise<ProposalDraftResponse> {
  const token = getAccessToken()

  const response = await safeFetch(`${API_BASE_URL}/api/matching/proposals/team-to-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  })

  try {
    return await parseApiResponse<ProposalDraftResponse>(
      response,
      '제안 문구 초안 생성에 실패했습니다'
    )
  } catch (e) {
    if (isApiErrorPayload<ProposalDraftResponse>(e)) {
      const domainError = mapTeamToUserProposalError(e.status, e.message)
      if (domainError) throw domainError
    }
    throw e
  }
}

export interface ProposalAssemblyRequest {
  teamId: number
}

function mapUserToTeamProposalError(status: number, message: string): Error | null {
  if (status === 400) {
    if (message.includes('매칭 의도')) return new MatchingIntentRequiredError(message)
    if (message.includes('찾을 수 없습니다')) return new ResourceNotFoundError(message)
  }
  if (status === 404) {
    // RECOMMENDATION_NOT_FOUND — 추천에 뜬 적 없는 팀. 추천 없이 바로 지원하려면 이 초안 API 자체를 스킵
    return new RecommendationNotFoundError(message)
  }
  return null
}

// 추천받은 팀에 보낼 지원 문구 초안
export async function draftProposalForTeam(
  payload: ProposalAssemblyRequest
): Promise<ProposalDraftResponse> {
  const token = getAccessToken()

  const response = await safeFetch(`${API_BASE_URL}/api/matching/proposals/user-to-team`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  })

  try {
    return await parseApiResponse<ProposalDraftResponse>(
      response,
      '지원 문구 초안 생성에 실패했습니다'
    )
  } catch (e) {
    if (isApiErrorPayload<ProposalDraftResponse>(e)) {
      const domainError = mapUserToTeamProposalError(e.status, e.message)
      if (domainError) throw domainError
    }
    throw e
  }
}