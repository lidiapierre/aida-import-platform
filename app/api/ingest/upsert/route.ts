import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { MappingSchema, parseCsvAll, applyMappingToRow, MODELS_FIELDS } from '../shared'
import { inferGenderFromFilename, inferModelBoardFromFilename } from '../shared'

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

    // Simply insert all model rows; no conflict handling
    for (let i = 0; i < modelRows.length; i += BATCH_SIZE) {
      const batch = modelRows.slice(i, i + BATCH_SIZE)
      const { data, error } = await supabase
        .from('models')
        .insert(batch)
        .select('id,model_name,data_source')
      if (error) {
        return NextResponse.json({ success: false, message: `Models insert failed: ${error.message}` }, { status: 500 })
      }
      insertedTotal += data?.length || 0
    }

    // Fetch ids for all models of this data_source to link media and agencies
    const { data: modelsForSource, error: fetchErr } = await supabase
      .from('models')
      .select('id,model_name,data_source')
      .eq('data_source', dataSource)
    if (fetchErr) {
      return NextResponse.json({ success: false, message: `Failed to fetch models for linking: ${fetchErr.message}` }, { status: 500 })
    }
    const keyToId = new Map<string, number>(
      (modelsForSource || []).map((m: any) => [`${m.model_name}||${m.data_source}`, m.id])
    )

    // Prepare media rows
    const mediaRows: { model_id: number; link: string }[] = []
    for (const t of transformed) {
      const links = t.models_media || []
      if (!links.length) continue
      const key = `${t.models.model_name}||${t.models.data_source}`
      const id = keyToId.get(key)
      if (!id) continue
      for (const media of links) {
        const link = (media as any).link || (media as any).url
        if (!link) continue
        mediaRows.push({ model_id: id, link })
      }
    }

    // Insert media rows
    let mediaInserted = 0
    for (let i = 0; i < mediaRows.length; i += BATCH_SIZE) {
      const batch = mediaRows.slice(i, i + BATCH_SIZE)
      const { data, error } = await supabase.from('models_media').insert(batch).select('model_id,link')
      if (error) {
        return NextResponse.json({ success: false, message: `Media insert failed: ${error.message}` }, { status: 500 })
      }
      mediaInserted += data?.length || 0
    }

    // Optionally insert model-agency relationships
    let agenciesLinked = 0
    const agencyId = agencyIdStr ? (agencyIdStr as any) : null
    if (agencyId) {
      const relRows: { model_id: any; agency_id: any }[] = []
      for (const t of transformed) {
        const key = `${t.models.model_name}||${t.models.data_source}`
        const id = keyToId.get(key)
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
        message: `Upsert complete: models ${insertedTotal}/${modelRows.length}, media ${mediaInserted}, agency linking ${agenciesLinked > 0 ? 'succeeded' : agenciesPlanned > 0 ? 'skipped/duplicate' : 'skipped'} (${agenciesLinked} inserted, ${agenciesAlreadyLinked} already linked)`,
        data: { modelsProcessed: modelRows.length, modelsInserted: insertedTotal, mediaInserted, agenciesLinked, agenciesPlanned, agenciesAlreadyLinked, agencyJoinTableUsed: 'models_agencies', agencyIdReceived: agencyIdStr },
      })
    }

    return NextResponse.json({
      success: true,
      message: `Upsert complete: models ${insertedTotal}/${modelRows.length}, media ${mediaInserted}, agency linking skipped (0)`,
      data: { modelsProcessed: modelRows.length, modelsInserted: insertedTotal, mediaInserted, agenciesLinked },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || 'Internal error' }, { status: 500 })
  }
} 