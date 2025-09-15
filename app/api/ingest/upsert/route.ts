import { NextRequest, NextResponse } from 'next/server'
import { MappingSchema, parseCsvAll, applyMappingToRow, MODELS_FIELDS } from '../shared'
import { inferGenderFromFilename, inferModelBoardFromFilename } from '../shared'
import { dataSourceExists } from '../shared'
import { ingestConfig } from '../config'

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

    const providedGenderRaw = String(formData.get('gender') || '').trim()
    const allowedGenders = (MODELS_FIELDS as any).gender.values as string[]
    const providedGender = allowedGenders.includes(providedGenderRaw) ? providedGenderRaw : null
    const inferredGender = providedGender || inferGenderFromFilename(dataSource)
    if (!inferredGender) {
      return NextResponse.json({ success: false, message: 'Could not infer gender from filename. Include a clear indicator such as girls, boys, men, women, female, male, transgender, non-binary, transman, or transwoman.' }, { status: 400 })
    }
    const inferredModelBoard = inferModelBoardFromFilename(dataSource)

    const transformed = rows.map((row) => applyMappingToRow(row, mapping, { gender: inferredGender, modelBoard: inferredModelBoard || null, dataSource }))

    const baseUrl = ingestConfig.baseUrl.replace(/\/$/, '')

    const allModelIds: Array<string | number> = []
    const upsertedModelIds: Array<string | number> = []
    let processed = 0
    let succeeded = 0
    let failed = 0

    for (const t of transformed) {
      processed++
      const model = { ...(t.models as any) }

      // Build model_media list and apply validity heuristic
      const modelMedia = (t.models_media || [])
        .map((m: any) => m?.link || m?.url)
        .filter((x: any) => typeof x === 'string' && x.trim() !== '')
        .filter((link: string) => isLikelyValidMediaLink(link))

      // Prepare payload for external API per spec
      const payload: any = {
        record: model,
        agency_id: agencyIdStr,
      }
      if (modelMedia.length) payload.model_media = modelMedia

      try {
        const resp = await fetch(`${baseUrl}/data_ingestion/upsert_model`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const json = await resp.json().catch(() => ({}))
        if (!resp.ok || json?.success === false) {
          failed++
          continue
        }
        succeeded++
        const returnedId = json?.model_id ?? json?.data?.model_id ?? json?.id ?? json?.data?.id
        if (returnedId != null) {
          allModelIds.push(returnedId)
          upsertedModelIds.push(returnedId)
        }
      } catch {
        failed++
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${processed} models via external upsert (succeeded ${succeeded}, failed ${failed}).`,
      data: { insertedModelIds: upsertedModelIds, allModelIds, modelIds: upsertedModelIds }
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || 'Internal error' }, { status: 500 })
  }
} 