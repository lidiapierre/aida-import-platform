import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { MappingSchema, parseCsvAll, applyMappingToRow } from '../shared'
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
    const inferredGender = inferGenderFromFilename(dataSource)
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
    const agencyId = agencyIdStr ? Number(agencyIdStr) : null
    if (agencyId && Number.isFinite(agencyId)) {
      const relRows: { model_id: number; agency_id: number }[] = []
      for (const t of transformed) {
        const key = `${t.models.model_name}||${t.models.data_source}`
        const id = keyToId.get(key)
        if (!id) continue
        relRows.push({ model_id: id, agency_id: agencyId })
      }
      for (let i = 0; i < relRows.length; i += BATCH_SIZE) {
        const batch = relRows.slice(i, i + BATCH_SIZE)
        const { data, error } = await supabase
          .from('model_agencies')
          .insert(batch)
          .select('model_id,agency_id')
        if (error) {
          return NextResponse.json({ success: false, message: `Model-agency insert failed: ${error.message}` }, { status: 500 })
        }
        agenciesLinked += data?.length || 0
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Upsert complete',
      data: { modelsProcessed: modelRows.length, modelsInserted: insertedTotal, mediaInserted, agenciesLinked },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || 'Internal error' }, { status: 500 })
  }
} 