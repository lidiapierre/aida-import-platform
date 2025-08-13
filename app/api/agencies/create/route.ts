import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function normalizeUrl(url?: string | null): string | null {
  if (!url) return null
  let u = String(url).trim()
  if (!u) return null
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  try {
    const parsed = new URL(u)
    parsed.hostname = parsed.hostname.replace(/^www\./, '')
    return parsed.toString()
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ success: false, message: 'Supabase environment variables are not set' }, { status: 500 })
    }

    const body = await req.json().catch(() => ({}))
    const name = String(body?.name || '').trim()
    const country = body?.country ? String(body.country).trim() : null
    const city = body?.city ? String(body.city).trim() : null
    const continent = body?.continent ? String(body.continent).trim() : null
    const website = normalizeUrl(body?.website)

    if (!name) {
      return NextResponse.json({ success: false, message: 'Agency name is required' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Optional: prevent obvious duplicates by name + website
    const { data: existing, error: fetchErr } = await supabase
      .from('agencies')
      .select('id,name,website')
      .ilike('name', name)
      .limit(1)
    if (fetchErr) {
      return NextResponse.json({ success: false, message: `Failed to check existing: ${fetchErr.message}` }, { status: 500 })
    }

    if (existing && existing.length) {
      return NextResponse.json({ success: false, message: 'An agency with a similar name already exists', data: existing[0] }, { status: 409 })
    }

    const insert = { name, country, city, continent, website }
    const { data, error } = await supabase
      .from('agencies')
      .insert(insert)
      .select('id,name,country,city,continent,website')
      .single()

    if (error) {
      return NextResponse.json({ success: false, message: `Failed to create agency: ${error.message}` }, { status: 500 })
    }

    return NextResponse.json({ success: true, data })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || 'Internal error' }, { status: 500 })
  }
} 