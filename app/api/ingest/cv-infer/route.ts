import { NextRequest, NextResponse } from 'next/server'
import { ingestConfig } from '../config'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const modelId = body?.model_id || body?.modelId
    if (!modelId) {
      return NextResponse.json({ success: false, message: 'Missing model_id' }, { status: 400 })
    }

    const baseUrl = ingestConfig.baseUrl
    const params = ingestConfig.updateModelParams
    const query = new URLSearchParams({
      use_claude_basic: String(params.use_claude_basic),
      use_claude_job_types: String(params.use_claude_job_types),
    })
    const url = `${baseUrl}/data_ingestion/update_model/${encodeURIComponent(modelId)}?${query.toString()}`

    const resp = await fetch(url, { method: 'POST' })
    const text = await resp.text()

    let parsed: any
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { raw: text }
    }

    // Appel à update_model_photos APRÈS que update_model ait fini
    try {
      const photosUrl = `${baseUrl}/data_ingestion/update_model_photos`
      const photosResp = await fetch(photosUrl, { 
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model_id: modelId, claude: true })
      })
      
      if (photosResp.ok) {
        console.log('update_model_photos successful for model:', modelId)
      } else {
        console.warn('update_model_photos failed for model:', modelId, 'status:', photosResp.status)
      }
    } catch (photosError) {
      console.error('Error calling update_model_photos:', photosError)
    }

    return NextResponse.json({ success: resp.ok, status: resp.status, data: parsed })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || 'Internal error' }, { status: 500 })
  }
} 