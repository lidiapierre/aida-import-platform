import { NextRequest, NextResponse } from 'next/server'
import { MappingSchema, parseCsvAll, applyMappingToRow, MODELS_FIELDS } from '../shared'
import { inferGenderFromFilename, inferModelBoardFromFilename } from '../shared'
import { dataSourceExists } from '../shared'
import { ingestConfig } from '../config'

function normalizeKey(key: string): string {
  return key.toLowerCase().trim().replace(/\s+/g, '_').replace(/[-]+/g, '_')
}

function ensureShoeMapping(mapping: any, headers: string[]) {
  if (!mapping) return mapping
  const shoeCandidates: string[] = []
  const normalizedHeaders = headers.map((h) => normalizeKey(String(h || '')))
  const possibleKeys = ['shoe', 'shoes', 'shoe_size', 'shoe_size_uk', 'shoe_size_eu', 'shoe_size_us', 'shoe size']
  for (let i = 0; i < normalizedHeaders.length; i++) {
    const norm = normalizedHeaders[i]
    if (possibleKeys.includes(norm)) {
      shoeCandidates.push(headers[i])
    }
  }

  if (!shoeCandidates.length) return mapping

  mapping.fieldMappings = mapping.fieldMappings || {}
  const existing = mapping.fieldMappings['models.shoe_size'] || {}
  const existingFrom = (existing as any).from
  const mergedFrom = Array.from(
    new Set(
      [
        ...(Array.isArray(existingFrom) ? existingFrom : existingFrom ? [existingFrom] : []),
        ...shoeCandidates,
      ].filter(Boolean)
    )
  )
  mapping.fieldMappings['models.shoe_size'] = { from: mergedFrom, transform: 'parseNumber' }
  if (Array.isArray(mapping.targetTables) && !mapping.targetTables.includes('models')) {
    mapping.targetTables.push('models')
  }
  return mapping
}

function isLikelyValidMediaLink(link: string): boolean {
  try {
    const u = new URL(link)
    return /\d{4,}/.test(u.pathname + u.search)
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as unknown as File
    const mappingStr = String(formData.get('mapping') || '')
    const agencyIdStr = formData.get('agency_id') as string | null

    if (!file || !mappingStr) {
      return NextResponse.json({ success: false, message: 'Missing file or mapping' }, { status: 400 })
    }

    // Require agency_id for external upsert_model API (UUID expected)
    if (!agencyIdStr) {
      return NextResponse.json({ success: false, message: 'agency_id is required' }, { status: 400 })
    }

    const dataSource = (file as any).name || 'upload.csv'

    // Early guard: if data_source already exists, stop with 409
    const exists = await dataSourceExists(dataSource)
    if (exists) {
      return NextResponse.json({ success: false, message: `This file has already been processed (data_source: ${dataSource}). Delete it first to reprocess.`, data: { data_source: dataSource, exists: true } }, { status: 409 })
    }

    const mapping = MappingSchema.parse(JSON.parse(mappingStr))

    const { rows } = await parseCsvAll(file)
    const headerKeys = rows.length ? Object.keys(rows[0]) : []
    const mappingWithFallbacks = ensureShoeMapping(mapping, headerKeys)

    const providedGenderRaw = String(formData.get('gender') || '').trim()
    const allowedGenders = (MODELS_FIELDS as any).gender.values as string[]
    const providedGender = allowedGenders.includes(providedGenderRaw) ? providedGenderRaw : null
    const inferredGender = providedGender || inferGenderFromFilename(dataSource)
    if (!inferredGender) {
      return NextResponse.json({ success: false, message: 'Could not infer gender from filename. Include a clear indicator such as girls, boys, men, women, female, male, transgender, non-binary, transman, or transwoman.' }, { status: 400 })
    }
    const inferredModelBoard = inferModelBoardFromFilename(dataSource)

    const transformed = rows.map((row) => applyMappingToRow(row, mappingWithFallbacks, { gender: inferredGender, modelBoard: inferredModelBoard || null, dataSource }))

    const baseUrl = ingestConfig.baseUrl.replace(/\/$/, '')

    const allModelIds: Array<string | number> = []
    const upsertedModelIds: Array<string | number> = []
    const potentialTwins: Array<{ modelId: string | number | null; potential_twins: any }> = []
    let processed = 0
    let succeeded = 0
    let failed = 0
    let skipped = 0
    const warnings: Array<{ rowIndex: number; reason: string }> = []
    const failures: Array<{ rowIndex: number; modelName: string; error: string }> = []

    // Prepare all models for batching
    const modelsToUpsert: Array<{ payload: any; rowIndex: number; modelName: string }> = []
    
    for (let i = 0; i < transformed.length; i++) {
      const t = transformed[i]
      processed++
      const model = { ...(t.models as any) }

      // Skip if both model_name and instagram_account are missing or empty
      const nameEmpty = !model?.model_name || String(model.model_name).trim() === ''
      const igEmpty = !model?.instagram_account || String(model.instagram_account).trim() === ''
      if (nameEmpty && igEmpty) {
        skipped++
        warnings.push({ rowIndex: i + 1, reason: 'no model_name and no instagram_account' })
        continue
      }

      // Build model_media list and apply validity heuristic
      const modelMedia = (t.models_media || [])
        .map((m: any) => m?.link || m?.url)
        .filter((x: any) => typeof x === 'string' && x.trim() !== '')
        .filter((link: string) => isLikelyValidMediaLink(link))

      // Prepare payload for batch API
      const payload: any = {
        record: model,
        agency_id: agencyIdStr,
      }
      if (modelMedia.length) payload.model_media = modelMedia

      const modelName = model?.model_name || model?.instagram_account || `Row ${i + 1}`
      modelsToUpsert.push({ payload, rowIndex: i + 1, modelName: String(modelName) })
    }

    // Process in batches of 50 (or less) to balance speed vs reliability
    const BATCH_SIZE = 50
    for (let batchStart = 0; batchStart < modelsToUpsert.length; batchStart += BATCH_SIZE) {
      const batch = modelsToUpsert.slice(batchStart, batchStart + BATCH_SIZE)
      const batchPayloads = batch.map((m) => m.payload)

      try {
        const resp = await fetch(`${baseUrl}/data_ingestion/batch_upsert_models`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ models: batchPayloads }),
        })
        const json = await resp.json().catch(() => ({}))
        
        if (!resp.ok) {
          // If batch fails, mark all as failed
          failed += batch.length
          continue
        }

        // Process batch results - backend returns { results: [{status, result?, error?}, ...], success: count, errors: count, ... }
        const batchResults = Array.isArray(json?.results) ? json.results : []

        for (let j = 0; j < batch.length; j++) {
          const resultItem = batchResults[j]
          const batchItem = batch[j]
          const rowIndex = batchItem.rowIndex
          const modelName = batchItem.modelName

          if (!resultItem) {
            failed++
            continue
          }

          // Check status - "success" means it worked, anything else is a failure
          if (resultItem.status === 'success' && resultItem.result) {
            const result = resultItem.result
            const returnedId = result?.model_id
            
            if (returnedId) {
              succeeded++
              allModelIds.push(returnedId)
              upsertedModelIds.push(returnedId)

              // Extract potential twins info if present
              const twinInfo = result?.potential_twins
              if (twinInfo && (twinInfo.group_id || (Array.isArray(twinInfo.candidate_model_ids) && twinInfo.candidate_model_ids.length > 0))) {
                potentialTwins.push({
                  modelId: returnedId,
                  potential_twins: {
                    group_id: twinInfo.group_id ?? null,
                    candidate_model_ids: Array.isArray(twinInfo.candidate_model_ids) ? twinInfo.candidate_model_ids : [],
                  },
                })
              }
            } else {
              failed++
            }
          } else if (resultItem.status === 'error') {
            // Capture error from batch response
            failed++
            failures.push({
              rowIndex,
              modelName,
              error: resultItem.error || 'Unknown error',
            })
          } else {
            // status is something else or missing result
            failed++
          }
        }
      } catch (e) {
        // If batch request fails, mark all in batch as failed
        failed += batch.length
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${processed} models via external upsert (succeeded ${succeeded}, failed ${failed}, skipped ${skipped}).`,
      data: { 
        insertedModelIds: upsertedModelIds, 
        allModelIds, 
        modelIds: upsertedModelIds, 
        potentialTwins, 
        warnings: { count: skipped, items: warnings },
        failures: { count: failed, items: failures }
      }
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || 'Internal error' }, { status: 500 })
  }
} 