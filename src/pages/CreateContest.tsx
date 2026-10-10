import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createEvent,
  EVENT_FIELD_LABELS,
  extractEventImage,
  type EventCategory,
  type EventField,
} from '../api/event'

const EVENT_FIELDS = Object.keys(EVENT_FIELD_LABELS) as EventField[]

function normalizeWebUrl(value: string): string | undefined {
  const trimmedValue = value.trim()
  if (!trimmedValue) return undefined

  const normalizedValue = /^https?:\/\//i.test(trimmedValue)
    ? trimmedValue
    : `https://${trimmedValue}`
  const url = new URL(normalizedValue)

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('http 또는 https 주소를 입력해주세요.')
  }

  return url.toString()
}

type CreateContestProps = {
  category: EventCategory
}

export default function CreateContest({ category }: CreateContestProps) {
  const navigate = useNavigate()
  const eventName = category === 'CONTEST' ? '공모전' : '대외활동'
  const listPath = category === 'CONTEST' ? '/contest' : '/external'
  const [title, setTitle] = useState('')
  const [field, setField] = useState<EventField | ''>('')
  const [organizer, setOrganizer] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [detailUrl, setDetailUrl] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [isExtracting, setIsExtracting] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || isExtracting) return

    setError(null)
    setIsExtracting(true)
    try {
      const draft = await extractEventImage(file)
      setTitle(draft.title)
      setField(draft.field)
      setOrganizer(draft.organizer ?? '')
      setStartDate(draft.startDate ?? '')
      setEndDate(draft.endDate ?? '')
      setDetailUrl(draft.detailUrl ?? '')
      setDescription(draft.description ?? '')
      setImageUrl(draft.imageUrl ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : '이미지 정보를 추출하지 못했어요.')
    } finally {
      setIsExtracting(false)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting || isExtracting) return
    if (!title.trim() || !field) {
      setError(`${eventName} 이름과 분야를 입력해주세요.`)
      return
    }
    if (!startDate || !endDate) {
      setError(`${eventName} 시작일과 마감일을 입력해주세요.`)
      return
    }

    let normalizedDetailUrl: string | undefined
    try {
      normalizedDetailUrl = normalizeWebUrl(detailUrl)
    } catch {
      setError('올바른 공모전 URL을 입력해주세요.')
      return
    }

    setError(null)
    setIsSubmitting(true)
    try {
      await createEvent({
        category,
        title: title.trim(),
        field,
        organizer: organizer.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        detailUrl: normalizedDetailUrl,
        description: description.trim() || undefined,
        imageUrl: imageUrl.trim() || undefined,
      })
      navigate(listPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : '공모전을 등록하지 못했어요.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const inputClassName =
    'mt-2 h-12 w-full rounded-xl border border-[#D8E1FD] bg-white px-4 text-sm text-brand-900 placeholder:text-brand-400 focus:border-[#4D4DF1] focus:outline-none'

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-[#1B1B33]">{eventName} 등록</h1>
        <p className="mt-2 text-sm text-[#6F7095]">
          포스터 이미지에서 정보를 가져오거나 직접 입력할 수 있어요.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <section className="rounded-2xl border border-dashed border-[#2554F0]/50 bg-brand-50/40 p-5">
          <label className="block text-sm font-semibold text-brand-900">
            포스터 이미지에서 정보 가져오기
            <input
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              disabled={isExtracting || isSubmitting}
              className="mt-3 block w-full text-sm text-brand-700 file:mr-4 file:rounded-lg file:border-0 file:bg-[#4D4DF1] file:px-4 file:py-2 file:font-semibold file:text-white hover:file:bg-[#3D3DD9]"
            />
          </label>
          <p className="mt-2 text-xs text-brand-400">
            {isExtracting ? '이미지에서 정보를 가져오는 중...' : '이미지 파일을 선택하면 입력란을 자동으로 채워요.'}
          </p>
        </section>

        <div>
          <label htmlFor="contest-title" className="text-sm font-semibold text-brand-900">
            {eventName} 이름
          </label>
          <input
            id="contest-title"
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={`${eventName} 이름을 입력해주세요`}
            className={inputClassName}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="contest-field" className="text-sm font-semibold text-brand-900">
              분야
            </label>
            <select
              id="contest-field"
              required
              value={field}
              onChange={(event) => setField(event.target.value as EventField | '')}
              className={inputClassName}
            >
              <option value="" disabled>
                분야를 선택해주세요
              </option>
              {EVENT_FIELDS.map((eventField) => (
                <option key={eventField} value={eventField}>
                  {EVENT_FIELD_LABELS[eventField]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="contest-organizer" className="text-sm font-semibold text-brand-900">
              주최 기관
            </label>
            <input
              id="contest-organizer"
              value={organizer}
              onChange={(event) => setOrganizer(event.target.value)}
              placeholder="주최 기관을 입력해주세요"
              className={inputClassName}
            />
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="contest-start-date" className="text-sm font-semibold text-brand-900">
              시작일
            </label>
            <input
              id="contest-start-date"
              type="date"
              required
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div>
            <label htmlFor="contest-end-date" className="text-sm font-semibold text-brand-900">
              마감일
            </label>
            <input
              id="contest-end-date"
              type="date"
              required
              min={startDate || undefined}
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className={inputClassName}
            />
          </div>
        </div>

        <div>
          <label htmlFor="contest-url" className="text-sm font-semibold text-brand-900">
            {eventName} 상세 링크
          </label>
          <input
            id="contest-url"
            type="text"
            inputMode="url"
            value={detailUrl}
            onChange={(event) => setDetailUrl(event.target.value)}
            placeholder="https://"
            className={inputClassName}
          />
        </div>

        <div>
          <label htmlFor="contest-description" className="text-sm font-semibold text-brand-900">
            공모전 설명
          </label>
          <textarea
            id="contest-description"
            rows={5}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={`${eventName} 내용을 입력해주세요`}
            className="mt-2 w-full rounded-xl border border-[#D8E1FD] px-4 py-3 text-sm text-brand-900 placeholder:text-brand-400 focus:border-[#4D4DF1] focus:outline-none"
          />
        </div>

        {imageUrl && <p className="text-xs text-brand-400">포스터 이미지 정보가 추출되었습니다.</p>}
        {error && <p role="alert" className="text-sm font-medium text-rose-500">{error}</p>}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate(listPath)}
            className="h-12 rounded-xl border border-[#D8E1FD] px-5 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={isSubmitting || isExtracting}
            className="h-12 rounded-xl bg-[#4D4DF1] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#3D3DD9] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? '등록 중...' : `${eventName} 등록`}
          </button>
        </div>
      </form>
    </main>
  )
}
