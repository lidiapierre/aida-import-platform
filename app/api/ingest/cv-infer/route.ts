import { NextRequest, NextResponse } from 'next/server'
import { ingestConfig } from '../config'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const singleId = body?.model_id || body?.modelId
    const manyIds = Array.isArray(body?.model_ids) ? body.model_ids : Array.isArray(body?.modelIds) ? body.modelIds : null

    const ids: any[] = manyIds && manyIds.length ? manyIds : singleId ? [singleId] : []
    if (!ids.length) {
      return NextResponse.json({ success: false, message: 'Missing model_id or model_ids' }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ success: false, message: 'Supabase environment variables are not set' }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseKey)

    const baseUrl = ingestConfig.baseUrl
    const params = ingestConfig.updateModelParams
    const query = new URLSearchParams({
      use_claude_basic: String(params.use_claude_basic),
      use_claude_job_types: String(params.use_claude_job_types),
    })

    const processOne = async (modelId: any) => {
      try {
        const { data: modelRow, error: modelErr } = await supabase
          .from('models')
          .select('id, cv_infer, model_name, instagram_account')
          .eq('id', modelId)
          .maybeSingle()
        if (modelErr) return { model_id: modelId, success: false, message: `Failed to fetch model: ${modelErr.message}` }
        if (!modelRow) return { model_id: modelId, success: false, message: 'Model not found' }

        // Skip if both identity fields are missing/empty
        const nameEmpty = !modelRow?.model_name || String(modelRow.model_name).trim() === ''
        const igEmpty = !modelRow?.instagram_account || String(modelRow.instagram_account).trim() === ''
        if (nameEmpty && igEmpty) {
          return { model_id: modelId, success: true, skipped: true, reason: 'no model_name and no instagram_account', didUpdateModel: false, didUpdatePhotos: false }
        }

        const { count: mediaCount, error: mediaErr } = await supabase
          .from('models_media')
          .select('id', { count: 'exact', head: true })
          .eq('model_id', modelId)
        if (mediaErr) return { model_id: modelId, success: false, message: `Failed to check medias: ${mediaErr.message}` }
        if ((mediaCount || 0) === 0) return { model_id: modelId, success: true, skipped: true, reason: 'no medias for model', didUpdateModel: false, didUpdatePhotos: false }

        let didUpdateModel = false
        if (modelRow.cv_infer !== true) {
          const url = `${baseUrl}/data_ingestion/update_model/${encodeURIComponent(modelId)}?${query.toString()}`
          try {
            const resp = await fetch(url, { method: 'POST' })
            didUpdateModel = resp.ok
          } catch {}
        }

        let didUpdatePhotos = false
        try {
          const photosUrl = `${baseUrl}/data_ingestion/update_model_photos`
          const photosResp = await fetch(photosUrl, { 
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ model_id: modelId, claude: true })
          })
          didUpdatePhotos = photosResp.ok
        } catch {}

        return { model_id: modelId, success: true, skipped: false, didUpdateModel, didUpdatePhotos }
      } catch (err: any) {
        return { model_id: modelId, success: false, message: err?.message || 'Unexpected error' }
      }
    }

    const results = [] as any[]
    for (const id of ids) {
      results.push(await processOne(id))
    }

    if (ids.length === 1) {
      return NextResponse.json({ success: results[0].success, data: results[0] })
    } else {
      return NextResponse.json({ success: true, data: results })
    }
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || 'Internal error' }, { status: 500 })
  }
} 