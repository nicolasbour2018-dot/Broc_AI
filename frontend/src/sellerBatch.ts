import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchSellerListings, followSellerJob, getSessionId, publishListing, submitSellerPhoto } from './api'
import type { AiJobProgress, Listing, ListingDraft, SellerAnalysis } from './types'

export const MAX_SELLER_PHOTOS = 10

const STORAGE_KEY = 'brocai-seller-batch'

export type SellerBatchStatus =
  | 'selected'
  | 'uploading'
  | 'queued'
  | 'running'
  | 'tracking_error'
  | 'analysis_error'
  | 'ready'
  | 'reviewed'
  | 'publishing'
  | 'publish_error'
  | 'published'

export type SellerBatchItem = {
  id: string
  status: SellerBatchStatus
  file?: File
  previewUrl?: string
  jobId?: string
  progress?: AiJobProgress
  analysis?: SellerAnalysis
  draft?: ListingDraft
  published?: Listing
  error?: string
}

export type SellerBatch = {
  stand: string
  alias: string
  sessionId: string
  started: boolean
  items: SellerBatchItem[]
}

function emptyBatch(stand = '', alias = ''): SellerBatch {
  return { stand, alias, sessionId: getSessionId(), started: false, items: [] }
}

function readBatch(): SellerBatch {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyBatch()
    const parsed = JSON.parse(raw) as SellerBatch
    if (parsed.sessionId !== getSessionId() || !parsed.stand || !parsed.started || !Array.isArray(parsed.items)) return emptyBatch()
    return {
      ...parsed,
      items: parsed.items.map(item => {
        const status = item.status === 'uploading' || item.status === 'selected'
          ? 'analysis_error'
          : item.status === 'publishing' ? 'publish_error' : item.status
        return {
          ...item,
          file: undefined,
          previewUrl: item.analysis ? `/media/${item.analysis.image_key}` : undefined,
          status,
          error: status === 'analysis_error' && !item.jobId
            ? 'Sélectionnez à nouveau cette photo pour relancer l’analyse.'
            : status === 'publish_error'
              ? 'Vérifiez puis réessayez la publication.'
              : item.error,
        }
      }),
    }
  } catch {
    return emptyBatch()
  }
}

function saveBatch(batch: SellerBatch): void {
  try {
    if (batch.started) {
      const items = batch.items.map(({ file: _file, previewUrl: _previewUrl, ...item }) => item)
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...batch, items }))
    } else {
      sessionStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // The batch remains usable in memory if browser storage is unavailable.
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function draftFromAnalysis(analysis: SellerAnalysis, stand: string, alias: string): ListingDraft {
  return {
    image_key: analysis.image_key,
    title: analysis.title,
    description: analysis.description,
    fun_line: analysis.fun_line || '',
    category: analysis.category,
    price_eur: String(analysis.suggested_price_eur),
    stand_number: stand,
    seller_alias: alias,
  }
}

export function useSellerBatch() {
  const batchRef = useRef<SellerBatch | null>(null)
  if (batchRef.current === null) batchRef.current = readBatch()
  const [batch, setBatch] = useState<SellerBatch>(batchRef.current)
  const polling = useRef(new Set<string>())
  const publishing = useRef(false)

  const commit = useCallback((change: (current: SellerBatch) => SellerBatch) => {
    const next = change(batchRef.current!)
    batchRef.current = next
    saveBatch(next)
    setBatch(next)
  }, [])

  const updateItem = useCallback((id: string, change: (item: SellerBatchItem) => SellerBatchItem) => {
    commit(current => ({
      ...current,
      items: current.items.map(item => item.id === id ? change(item) : item),
    }))
  }, [commit])

  const reset = useCallback((stand = '', alias = '') => {
    for (const item of batchRef.current!.items) {
      if (item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl)
    }
    commit(() => emptyBatch(stand, alias))
  }, [commit])

  const ensureStand = useCallback((stand: string, alias: string) => {
    if (batchRef.current!.stand !== stand) reset(stand, alias)
    else if (batchRef.current!.alias !== alias) commit(current => ({ ...current, alias }))
  }, [reset, commit])

  const addPhotos = useCallback((files: File[]) => {
    let added = 0
    commit(current => {
      if (current.started) return current
      const available = MAX_SELLER_PHOTOS - current.items.length
      const additions = files.slice(0, available).map(file => ({
        id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        status: 'selected' as const,
        file,
        previewUrl: URL.createObjectURL(file),
      }))
      added = additions.length
      return { ...current, items: [...current.items, ...additions] }
    })
    return added
  }, [commit])

  const removePhoto = useCallback((id: string) => {
    const item = batchRef.current!.items.find(candidate => candidate.id === id)
    if (batchRef.current!.started || !item) return
    if (item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl)
    commit(current => ({ ...current, items: current.items.filter(candidate => candidate.id !== id) }))
  }, [commit])

  const replacePhoto = useCallback((id: string, file: File) => {
    const item = batchRef.current!.items.find(candidate => candidate.id === id)
    if (!item || batchRef.current!.started) return
    if (item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl)
    updateItem(id, current => ({ ...current, file, previewUrl: URL.createObjectURL(file) }))
  }, [updateItem])

  const submitItem = useCallback(async (id: string, replacement?: File) => {
    const item = batchRef.current!.items.find(candidate => candidate.id === id)
    const file = replacement || item?.file
    if (!item || !file) {
      updateItem(id, current => ({ ...current, status: 'analysis_error', error: 'Sélectionnez à nouveau cette photo.' }))
      return
    }
    const previewUrl = replacement ? URL.createObjectURL(replacement) : item.previewUrl
    if (replacement && item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl)
    updateItem(id, current => ({ ...current, file, previewUrl, jobId: undefined, progress: undefined, status: 'uploading', error: undefined }))
    try {
      const job = await submitSellerPhoto(file)
      updateItem(id, current => ({ ...current, jobId: job.id, progress: job, status: job.status === 'running' ? 'running' : 'queued' }))
    } catch (error) {
      updateItem(id, current => ({ ...current, status: 'analysis_error', error: errorMessage(error, 'Analyse impossible.') }))
    }
  }, [updateItem])

  const startAnalysis = useCallback(async () => {
    const current = batchRef.current!
    if (current.started || current.items.length === 0) return
    const ids = current.items.map(item => item.id)
    commit(batch => ({ ...batch, started: true }))
    let next = 0
    async function uploadNext(): Promise<void> {
      while (next < ids.length) {
        const id = ids[next++]
        await submitItem(id)
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, ids.length) }, () => uploadNext()))
  }, [commit, submitItem])

  useEffect(() => {
    for (const item of batch.items) {
      if (!item.jobId || !['queued', 'running'].includes(item.status) || polling.current.has(item.id)) continue
      const id = item.id
      const jobId = item.jobId
      polling.current.add(id)
      void followSellerJob(jobId, progress => {
        updateItem(id, current => current.jobId === jobId
          ? { ...current, progress, status: progress.status === 'running' ? 'running' : 'queued' }
          : current)
      }).then(job => {
        if (job.status === 'success' && job.result) {
          const previous = batchRef.current!.items.find(candidate => candidate.id === id)
          if (previous?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previous.previewUrl)
          updateItem(id, current => current.jobId === jobId ? {
            ...current,
            status: 'ready',
            analysis: job.result!,
            draft: draftFromAnalysis(job.result!, batchRef.current!.stand, batchRef.current!.alias),
            previewUrl: `/media/${job.result!.image_key}`,
            error: undefined,
          } : current)
        } else {
          updateItem(id, current => current.jobId === jobId ? {
            ...current,
            jobId: undefined,
            status: 'analysis_error',
            error: job.error_message || 'L’analyse n’est pas disponible pour le moment.',
          } : current)
        }
      }).catch(error => {
        updateItem(id, current => current.jobId === jobId
          ? { ...current, status: 'tracking_error', error: errorMessage(error, 'Suivi de l’analyse impossible.') }
          : current)
      }).finally(() => polling.current.delete(id))
    }
  }, [batch, updateItem])

  const retryTracking = useCallback((id: string) => {
    updateItem(id, item => item.jobId ? { ...item, status: 'queued', error: undefined } : item)
  }, [updateItem])

  const updateDraft = useCallback((id: string, draft: ListingDraft) => {
    updateItem(id, item => ({ ...item, draft, status: 'ready', error: undefined }))
  }, [updateItem])

  const markReviewed = useCallback((id: string) => {
    updateItem(id, item => item.draft ? { ...item, status: 'reviewed', error: undefined } : item)
  }, [updateItem])

  const publishOne = useCallback(async (id: string) => {
    const item = batchRef.current!.items.find(candidate => candidate.id === id)
    if (!item?.draft || !['reviewed', 'publish_error'].includes(item.status)) return
    updateItem(id, current => ({ ...current, status: 'publishing', error: undefined }))
    try {
      const listings = item.status === 'publish_error' ? await fetchSellerListings(batchRef.current!.stand) : []
      const existing = listings.find(listing => listing.image_url === `/media/${item.draft!.image_key}`)
      const published = existing || await publishListing({ ...item.draft, stand_number: batchRef.current!.stand })
      updateItem(id, current => ({ ...current, status: 'published', published, error: undefined }))
    } catch (error) {
      updateItem(id, current => ({ ...current, status: 'publish_error', error: errorMessage(error, 'Publication impossible.') }))
    }
  }, [updateItem])

  const publishAll = useCallback(async () => {
    if (publishing.current) return
    const current = batchRef.current!
    if (current.items.some(item => ['uploading', 'queued', 'running', 'ready', 'publishing'].includes(item.status))) return
    const ids = current.items.filter(item => ['reviewed', 'publish_error'].includes(item.status)).map(item => item.id)
    if (ids.length === 0) return
    publishing.current = true
    try {
      for (const id of ids) await publishOne(id)
    } finally {
      publishing.current = false
    }
  }, [publishOne])

  return {
    batch,
    ensureStand,
    reset,
    addPhotos,
    removePhoto,
    replacePhoto,
    startAnalysis,
    submitItem,
    retryTracking,
    updateDraft,
    markReviewed,
    publishOne,
    publishAll,
  }
}

export type SellerBatchController = ReturnType<typeof useSellerBatch>
