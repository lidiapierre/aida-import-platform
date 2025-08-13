import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { MappingSchema, parseCsvAll, applyMappingToRow } from '../shared'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as unknown as File
    const gender = String(formData.get('gender') || '')
    const modelBoard = String(formData.get('model_board') || '')
    const mappingStr = String(formData.get('mapping') || '')

    if (!file || !gender || !mappingStr) {
      return NextResponse.json({ success: false, message: 'Missing file, gender, or mapping' }, { status: 400 })
    }

    const mapping = MappingSchema.parse(JSON.parse(mappingStr))

    const { rows } = await parseCsvAll(file)

    const dataSource = (file as any).name || 'upload.csv'

    const transformed = rows.map((row) => applyMappingToRow(row, mapping, { gender, modelBoard: modelBoard || null, dataSource }))

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

    // Fetch ids for all models of this data_source to link media
    const { data: modelsForSource, error: fetchErr } = await supabase
      .from('models')
      .select('id,model_name,data_source')
      .eq('data_source', dataSource)
    if (fetchErr) {
      return NextResponse.json({ success: false, message: `Failed to fetch models for media linking: ${fetchErr.message}` }, { status: 500 })
    }
    const keyToId = new Map<string, number>(
      (modelsForSource || []).map((m: any) => [`${m.model_name}||${m.data_source}`, m.id])
    )

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

    let mediaInserted = 0
    for (let i = 0; i < mediaRows.length; i += BATCH_SIZE) {
      const batch = mediaRows.slice(i, i + BATCH_SIZE)
      const { data, error } = await supabase.from('models_media').insert(batch).select('model_id,link')
      if (error) {
        return NextResponse.json({ success: false, message: `Media insert failed: ${error.message}` }, { status: 500 })
      }
      mediaInserted += data?.length || 0
    }

    return NextResponse.json({
      success: true,
      message: 'Upsert complete',
      data: { modelsProcessed: modelRows.length, modelsInserted: insertedTotal, mediaInserted },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || 'Internal error' }, { status: 500 })
  }
} 