import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteSellerDraft, fetchSellerListings, followSellerJob, getSessionId, publishListing, submitSellerPhoto, trackEvent } from './api'
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

// `reviewed` only survives in batches stored before drafts became publishable as soon as they are ready.
export const PUBLISHABLE_STATUSES: SellerBatchStatus[] = ['ready', 'reviewed', 'publish_error']
export const BUSY_STATUSES: SellerBatchStatus[] = ['uploading', 'queued', 'running', 'publishing']

export type RemovedItem = { item: SellerBatchItem; index: number }

export type SellerBatch = {
  stand: string
  alias: string
  sessionId: string
  started: boolean
  // Fixed when the series is first analysed, so removing its first photo keeps analytics consistent.
  id?: string
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
      // Photos never sent for analysis only existed on the phone: their files are gone after a reload.
      items: parsed.items.filter(item => item.status !== 'selected').map(item => {
        const status = item.status === 'uploading'
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

function batchId(batch: SellerBatch): string {
  return batch.id ?? batch.items[0]?.id ?? ''
}

function batchCounts(batch: SellerBatch) {
  return {
    batch_id: batchId(batch),
    batch_size: batch.items.length,
    analyzed_count: batch.items.filter(item => ['ready', 'reviewed', 'publishing', 'publish_error', 'published'].includes(item.status)).length,
    published_count: batch.items.filter(item => item.status === 'published').length,
    failed_count: batch.items.filter(item => ['analysis_error', 'tracking_error', 'publish_error'].includes(item.status)).length,
    entry_source: 'seller_create',
  }
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
  const completedBatches = useRef(new Set<string>())

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

  // Takes an item out of the series; the caller either restores it (undo) or discards it for good.
  const removeItem = useCallback((id: string): RemovedItem | null => {
    const index = batchRef.current!.items.findIndex(candidate => candidate.id === id)
    const item = batchRef.current!.items[index]
    if (!item || BUSY_STATUSES.includes(item.status)) return null
    commit(current => ({ ...current, items: current.items.filter(candidate => candidate.id !== id) }))
    if (batchRef.current!.started) void trackEvent('feature_clicked', { feature: 'seller_draft', action: 'deleted', status: item.status })
    return { item, index }
  }, [commit])

  const restoreItem = useCallback((removed: RemovedItem) => {
    commit(current => {
      if (current.items.some(candidate => candidate.id === removed.item.id)) return current
      const items = [...current.items]
      items.splice(Math.min(removed.index, items.length), 0, removed.item)
      return { ...current, items }
    })
    void trackEvent('feature_clicked', { feature: 'seller_draft', action: 'undone' })
  }, [commit])

  // Final step of a removal: free the preview and the uploaded photo, which no listing uses.
  const discardRemoved = useCallback((removed: RemovedItem) => {
    if (removed.item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(removed.item.previewUrl)
    const imageKey = removed.item.analysis?.image_key ?? removed.item.draft?.image_key
    if (imageKey && removed.item.status !== 'published') void deleteSellerDraft(imageKey)
  }, [])

  const replacePhoto = useCallback((id: string, file: File) => {
    const item = batchRef.current!.items.find(candidate => candidate.id === id)
    if (!item || item.status !== 'selected') return
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
    const ids = current.items.filter(item => item.status === 'selected').map(item => item.id)
    if (ids.length === 0) return
    const firstStart = !current.started
    commit(batch => ({ ...batch, started: true, id: batch.id ?? batch.items[0]?.id }))
    if (firstStart) void trackEvent('batch_started', batchCounts(current))
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
    if (!batch.started || batch.items.length === 0) return
    const settled = batch.items.every(item => ['ready', 'reviewed', 'analysis_error', 'tracking_error', 'publishing', 'publish_error', 'published'].includes(item.status))
    if (!settled) return
    const id = batchId(batch)
    if (completedBatches.current.has(id)) return
    const marker = `brocai-batch-completed:${id}`
    try {
      if (sessionStorage.getItem(marker)) return
      sessionStorage.setItem(marker, '1')
    } catch {
      completedBatches.current.add(id)
    }
    completedBatches.current.add(id)
    void trackEvent('batch_completed', batchCounts(batch))
  }, [batch])

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

  const trackPublication = useCallback(() => {
    const current = batchRef.current!
    if (!current.started || current.items.some(item => ['selected', 'uploading', 'queued', 'running', 'ready', 'reviewed', 'publishing'].includes(item.status))) return
    void trackEvent('batch_published', batchCounts(current))
  }, [])

  const publishOne = useCallback(async (id: string) => {
    const item = batchRef.current!.items.find(candidate => candidate.id === id)
    if (!item?.draft || !PUBLISHABLE_STATUSES.includes(item.status)) return
    updateItem(id, current => ({ ...current, status: 'publishing', error: undefined }))
    try {
      const listings = item.status === 'publish_error' ? await fetchSellerListings(batchRef.current!.stand) : []
      const existing = listings.find(listing => listing.image_url === `/media/${item.draft!.image_key}`)
      const published = existing || await publishListing({ ...item.draft, stand_number: batchRef.current!.stand })
      updateItem(id, current => ({ ...current, status: 'published', published, error: undefined }))
    } catch (error) {
      updateItem(id, current => ({ ...current, status: 'publish_error', error: errorMessage(error, 'Publication impossible.') }))
    }
    if (!publishing.current) trackPublication()
  }, [updateItem, trackPublication])

  // Publishes the drafts that are ready (or those given), even while other photos are still analysed.
  const publishAll = useCallback(async (onlyIds?: string[]) => {
    if (publishing.current) return
    const ids = batchRef.current!.items
      .filter(item => PUBLISHABLE_STATUSES.includes(item.status) && (!onlyIds || onlyIds.includes(item.id)))
      .map(item => item.id)
    if (ids.length === 0) return
    publishing.current = true
    try {
      for (const id of ids) await publishOne(id)
    } finally {
      publishing.current = false
      trackPublication()
    }
  }, [publishOne, trackPublication])

  return {
    batch,
    ensureStand,
    reset,
    addPhotos,
    removeItem,
    restoreItem,
    discardRemoved,
    replacePhoto,
    startAnalysis,
    submitItem,
    retryTracking,
    updateDraft,
    publishOne,
    publishAll,
  }
}

export type SellerBatchController = ReturnType<typeof useSellerBatch>
