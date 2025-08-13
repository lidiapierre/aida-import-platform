import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const modelId = body?.model_id || body?.modelId
    if (!modelId) {
      return NextResponse.json({ success: false, message: 'Missing model_id' }, { status: 400 })
    }

    const baseUrl = 'https://modelrecommendation-d8fdaa3e6179.herokuapp.com'
    const url = `${baseUrl}/data_ingestion/update_model/${encodeURIComponent(modelId)}`

    const resp = await fetch(url, { method: 'POST' })
    const text = await resp.text()

    let parsed: any
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { raw: text }
    }

    return NextResponse.json({ success: resp.ok, status: resp.status, data: parsed })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || 'Internal error' }, { status: 500 })
  }
} 