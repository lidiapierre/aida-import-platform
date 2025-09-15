import { NextRequest, NextResponse } from 'next/server'
import { dataSourceExists } from '../shared'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    let filename = ''
    const contentType = req.headers.get('content-type') || ''

    if (contentType.includes('application/json')) {
      const body = await req.json().catch(() => ({}))
      filename = String(body?.filename || body?.data_source || '').trim()
    } else if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const file = formData.get('file') as unknown as File
      filename = (file as any)?.name || ''
    }

    if (!filename) {
      return NextResponse.json({ success: false, message: 'Missing filename' }, { status: 400 })
    }

    const exists = await dataSourceExists(filename)
    return NextResponse.json({ success: true, data: { exists, data_source: filename } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || 'Internal error' }, { status: 500 })
  }
} 