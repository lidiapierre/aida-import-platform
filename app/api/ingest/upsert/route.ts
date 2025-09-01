import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { MappingSchema, parseCsvAll, applyMappingToRow, MODELS_FIELDS } from '../shared'
import { inferGenderFromFilename, inferModelBoardFromFilename } from '../shared'
import { ingestConfig } from '../config'

function isLikelyValidMediaLink(link: string): boolean {
  try {
    const u = new URL(link)
    // Heuristic: require at least 4 consecutive digits somewhere in the path or query
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

    const mapping = MappingSchema.parse(JSON.parse(mappingStr))

    const { rows } = await parseCsvAll(file)

    const dataSource = (file as any).name || 'upload.csv'
    const providedGenderRaw = String(formData.get('gender') || '').trim()
    const allowedGenders = (MODELS_FIELDS as any).gender.values as string[]
    const providedGender = allowedGenders.includes(providedGenderRaw) ? providedGenderRaw : null
    const inferredGender = providedGender || inferGenderFromFilename(dataSource)
    if (!inferredGender) {
      return NextResponse.json({ success: false, message: 'Could not infer gender from filename. Include a clear indicator such as girls, boys, men, women, female, male, transgender, non-binary, transman, or transwoman.' }, { status: 400 })
    }
    const inferredModelBoard = inferModelBoardFromFilename(dataSource)

    const transformed = rows.map((row) => applyMappingToRow(row, mapping, { gender: inferredGender, modelBoard: inferredModelBoard || null, dataSource }))

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ success: false, message: 'Supabase environment variables are not set' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    const modelRows = transformed.map((t) => t.models)

    const BATCH_SIZE = 500
    let insertedTotal = 0
    const insertedIds: Array<string> = []

    // Preload existing models for this data_source to avoid duplicate inserts based on (data_source, model_name, instagram_account)
    const { data: existingModels, error: existingFetchErr } = await supabase
      .from('models')
      .select('id,model_name,data_source,instagram_account')
      .eq('data_source', dataSource)

    if (existingFetchErr) {
      return NextResponse.json({ success: false, message: `Failed to fetch existing models: ${existingFetchErr.message}` }, { status: 500 })
    }

    const normalizeInsta = (v: any) => {
      const s = (v ?? '').toString().trim()
      return s === '' ? null : s
    }

    const existingKeyToId = new Map<string, any>((existingModels || []).map((m: any) => {
      const key = `${m.data_source}||${m.model_name}||${normalizeInsta(m.instagram_account)}`
      return [key, m.id]
    }))

    // Partition rows into new vs existing by the unique triplet
    const rowsToInsert: any[] = []
    const keyToId = new Map<string, any>()

    for (const m of modelRows) {
      const key = `${m.data_source}||${m.model_name}||${normalizeInsta(m.instagram_account)}`
      const existingId = existingKeyToId.get(key)
      if (existingId) {
        keyToId.set(key, existingId)
        continue
      }
      rowsToInsert.push(m)
    }

    // Insert only new models
    for (let i = 0; i < rowsToInsert.length; i += BATCH_SIZE) {
      const batch = rowsToInsert.slice(i, i + BATCH_SIZE)
      const { data, error } = await supabase
        .from('models')
        .insert(batch)
        .select('id,model_name,data_source,instagram_account')
      if (error) {
        return NextResponse.json({ success: false, message: `Models insert failed: ${error.message}` }, { status: 500 })
      }
      insertedTotal += data?.length || 0
      for (const row of data || []) {
        if (row?.id != null) {
          insertedIds.push(String(row.id))
          const k = `${row.data_source}||${row.model_name}||${normalizeInsta(row.instagram_account)}`
          keyToId.set(k, row.id)
        }
      }
    }

    // Fetch ids for all models of this data_source to link media and agencies (ensure coverage for rows that already existed)
    for (const m of modelRows) {
      const k = `${m.data_source}||${m.model_name}||${normalizeInsta(m.instagram_account)}`
      if (!keyToId.has(k)) {
        const maybeId = existingKeyToId.get(k)
        if (maybeId) keyToId.set(k, maybeId)
      }
    }

    // Prepare media rows
    const mediaRows: { model_id: any; link: string }[] = []
    for (const t of transformed) {
      const links = t.models_media || []
      if (!links.length) continue
      const k = `${t.models.data_source}||${t.models.model_name}||${normalizeInsta(t.models.instagram_account)}`
      const id = keyToId.get(k)
      if (!id) continue
      for (const media of links) {
        const link = (media as any).link || (media as any).url
        if (!link) continue
        if (!isLikelyValidMediaLink(link)) continue
        mediaRows.push({ model_id: id, link })
      }
    }

    // Deduplicate media rows in-memory by (model_id, link)
    const seenMediaKeys = new Set<string>()
    const dedupedMediaRows: { model_id: any; link: string }[] = []
    for (const r of mediaRows) {
      const k = `${r.model_id}||${r.link}`
      if (seenMediaKeys.has(k)) continue
      seenMediaKeys.add(k)
      dedupedMediaRows.push(r)
    }

    // Insert media rows using upsert to avoid unique constraint violations on (model_id, link)
    let mediaInserted = 0
    for (let i = 0; i < dedupedMediaRows.length; i += BATCH_SIZE) {
      const batch = dedupedMediaRows.slice(i, i + BATCH_SIZE)
      const { data, error } = await supabase
        .from('models_media')
        .upsert(batch, { onConflict: 'model_id,link', ignoreDuplicates: true })
        .select('model_id,link')
      if (error) {
        return NextResponse.json({ success: false, message: `Media insert failed: ${error.message}`, data: { code: (error as any).code, details: (error as any).details, hint: (error as any).hint } }, { status: 500 })
      }
      mediaInserted += data?.length || 0
    }

    // Compute summary counts
    const processedModels = modelRows.length
    const insertedModels = insertedTotal
    const existingModelsMatched = Math.max(processedModels - insertedModels, 0)

    const processedMedias = dedupedMediaRows.length
    const insertedMedias = mediaInserted
    const existingMediasMatched = Math.max(processedMedias - insertedMedias, 0)

    // CV infer step for all models from the spreadsheet (skip update_model if cv_infer TRUE; always run photos if medias exist)
    const allModelIds: any[] = []
    for (const t of transformed) {
      const k = `${t.models.data_source}||${t.models.model_name}||${normalizeInsta(t.models.instagram_account)}`
      const id = keyToId.get(k)
      if (id) allModelIds.push(id)
    }
    const uniqueModelIds = Array.from(new Set(allModelIds))

    if (uniqueModelIds.length > 0) {
      const { data: statusRows, error: statusErr } = await supabase
        .from('models')
        .select('id, cv_infer')
        .in('id', uniqueModelIds as any)
      if (statusErr) {
        return NextResponse.json({ success: false, message: `Failed to precheck cv_infer: ${statusErr.message}` }, { status: 500 })
      }
      const idToCvInfer = new Map<any, boolean>((statusRows || []).map((r: any) => [r.id, !!r.cv_infer]))

      const baseUrl = ingestConfig.baseUrl
      const params = ingestConfig.updateModelParams
      const query = new URLSearchParams({
        use_claude_basic: String(params.use_claude_basic),
        use_claude_job_types: String(params.use_claude_job_types),
      })

      for (const id of uniqueModelIds) {
        try {
          const { count: mediaCount, error: mediaErr2 } = await supabase
            .from('models_media')
            .select('id', { count: 'exact', head: true })
            .eq('model_id', id)
          if (mediaErr2) continue
          if ((mediaCount || 0) === 0) continue

          const cvAlready = idToCvInfer.get(id) === true
          if (!cvAlready) {
            const url = `${baseUrl}/data_ingestion/update_model/${encodeURIComponent(id)}?${query.toString()}`
            await fetch(url, { method: 'POST' })
          }
          try {
            const photosUrl = `${baseUrl}/data_ingestion/update_model_photos`
            await fetch(photosUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model_id: id, claude: true })
            })
          } catch {}
        } catch {}
      }
    }

    // Optionally insert model-agency relationships
    let agenciesLinked = 0
    const agencyId = agencyIdStr ? (agencyIdStr as any) : null
    if (agencyId) {
      const relRows: { model_id: any; agency_id: any }[] = []
      for (const t of transformed) {
        const k = `${t.models.data_source}||${t.models.model_name}||${normalizeInsta(t.models.instagram_account)}`
        const id = keyToId.get(k)
        if (!id) continue
        relRows.push({ model_id: id as any, agency_id: agencyId })
      }

      // Deduplicate by model_id to avoid redundant inserts
      const modelIds = Array.from(new Set(relRows.map((r) => r.model_id))).filter(Boolean)

      // Fetch existing links for this agency to skip duplicates without relying on DB constraints
      const { data: existingLinks, error: existingErr } = await supabase
        .from('models_agencies')
        .select('model_id')
        .eq('agency_id', agencyId)
        .in('model_id', modelIds)

      if (existingErr) {
        return NextResponse.json(
          { success: false, message: `Model-agency precheck failed: ${existingErr.message || 'unknown error'}`, data: { code: (existingErr as any).code, details: (existingErr as any).details, hint: (existingErr as any).hint } },
          { status: 500 }
        )
      }

      const existingSet = new Set((existingLinks || []).map((e: any) => e.model_id))
      const toInsert = relRows.filter((r) => !existingSet.has(r.model_id))
      const agenciesPlanned = relRows.length
      const agenciesAlreadyLinked = relRows.length - toInsert.length

      // Insert only new links
      for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
        const batch = toInsert.slice(i, i + BATCH_SIZE)
        const { data, error } = await supabase
          .from('models_agencies')
          .insert(batch)
          .select('model_id,agency_id')
        if (error) {
          return NextResponse.json(
            { success: false, message: `Model-agency insert failed: ${error.message || 'unknown error'}`, data: { code: (error as any).code, details: (error as any).details, hint: (error as any).hint } },
            { status: 500 }
          )
        }
        agenciesLinked += data?.length || 0
      }

      return NextResponse.json({
        success: true,
        message: `Processed ${processedModels} models (inserted ${insertedModels}, existing ${existingModelsMatched}); processed ${processedMedias} medias (inserted ${insertedMedias}, existing ${existingMediasMatched}). Agency linking succeeded.`,
        data: { modelIds: insertedIds }
      })
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${processedModels} models (inserted ${insertedModels}, existing ${existingModelsMatched}); processed ${processedMedias} medias (inserted ${insertedMedias}, existing ${existingMediasMatched}).`,
      data: { modelIds: insertedIds }
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || 'Internal error' }, { status: 500 })
  }
} 