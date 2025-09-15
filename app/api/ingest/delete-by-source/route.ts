import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ success: false, message: 'Supabase environment variables are not set' }, { status: 500 })
    }

    const contentType = req.headers.get('content-type') || ''
    let dataSource = ''
    if (contentType.includes('application/json')) {
      const body = await req.json().catch(() => ({}))
      dataSource = String(body?.data_source || body?.filename || '').trim()
    } else if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const file = formData.get('file') as unknown as File
      dataSource = (file as any)?.name || ''
    }

    if (!dataSource) {
      return NextResponse.json({ success: false, message: 'Missing data_source' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Fetch model ids for this data_source first
    const { data: models, error: modelsErr } = await supabase
      .from('models')
      .select('id')
      .eq('data_source', dataSource)
    if (modelsErr) {
      return NextResponse.json({ success: false, message: `Failed to list models: ${modelsErr.message}` }, { status: 500 })
    }

    const modelIds = (models || []).map((m: any) => m.id)

    // Delete dependents first: models_media, models_agencies
    if (modelIds.length) {
      const BATCH = 1000
      for (let i = 0; i < modelIds.length; i += BATCH) {
        const slice = modelIds.slice(i, i + BATCH)
        const { error: mediaErr } = await supabase
          .from('models_media')
          .delete()
          .in('model_id', slice)
        if (mediaErr) {
          return NextResponse.json({ success: false, message: `Failed to delete medias: ${mediaErr.message}` }, { status: 500 })
        }
        const { error: linkErr } = await supabase
          .from('models_agencies')
          .delete()
          .in('model_id', slice)
        if (linkErr) {
          return NextResponse.json({ success: false, message: `Failed to delete model-agency links: ${linkErr.message}` }, { status: 500 })
        }
      }
    }

    // Delete models by data_source
    const { error: delModelsErr, count } = await supabase
      .from('models')
      .delete({ count: 'exact' })
      .eq('data_source', dataSource)
    if (delModelsErr) {
      return NextResponse.json({ success: false, message: `Failed to delete models: ${delModelsErr.message}` }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: `Deleted ${count || 0} models and related records for data_source ${dataSource}` })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || 'Internal error' }, { status: 500 })
  }
} 