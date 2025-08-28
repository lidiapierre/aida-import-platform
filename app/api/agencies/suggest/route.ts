import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { parseCsvSample } from '../../ingest/shared'

export const runtime = 'nodejs'

function extractJsonObject(text: string): any {
  try { return JSON.parse(text) } catch {}
  const trimmed = (text || '').trim()
  const fence = trimmed.match(/```(?:json)?\n([\s\S]*?)\n```/i)
  if (fence) {
    try { return JSON.parse(fence[1]) } catch {}
  }
  let start = -1
  let depth = 0
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '{') { if (start === -1) start = i; depth++ }
    else if (ch === '}') {
      if (depth > 0) depth--
      if (depth === 0 && start !== -1) {
        const candidate = trimmed.slice(start, i + 1)
        try { return JSON.parse(candidate) } catch {}
        start = -1
      }
    }
  }
  throw new Error('No valid JSON object found in text')
}

function normalizeName(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const GENERIC_TOKENS = new Set([
  'agency','agencies','management','models','model','group','the','official','inc','ltd','llc','company','co','studio'
])

function tokenizeName(input: string): Set<string> {
  const norm = normalizeName(input)
  const parts = norm.split(' ').filter(Boolean)
  const filtered = parts.map(p => p.trim()).filter(p => p && !GENERIC_TOKENS.has(p))
  return new Set(filtered)
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  Array.from(a).forEach((t) => { if (b.has(t)) inter++ })
  const union = a.size + b.size - inter
  return union ? inter / union : 0
}

function domainFromUrl(url?: string | null): string | null {
  if (!url) return null
  let u = String(url).trim()
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  try { return new URL(u).hostname.replace(/^www\./, '') } catch { return null }
}

export async function POST(req: NextRequest) {
  try {
    const key = process.env.ANTHROPIC_API_KEY || ''
    if (!key) {
      return NextResponse.json({ success: false, message: 'Server misconfig: ANTHROPIC_API_KEY is not set' }, { status: 500 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ success: false, message: 'Supabase environment variables are not set' }, { status: 500 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as unknown as File
    const dataSourceName = (file as any)?.name || 'upload.csv'
    const originalBaseName = dataSourceName.replace(/\.[a-z0-9]+$/i, '')
    let sanitizedName = originalBaseName.replace(/aida/gi, '')
    sanitizedName = sanitizedName.replace(/[_\-\s]+/g, ' ').trim()
    if (!sanitizedName) sanitizedName = originalBaseName

    if (!file) {
      return NextResponse.json({ success: false, message: 'Missing file' }, { status: 400 })
    }

    const sample = await parseCsvSample(file, 20)

    const anthropic = new Anthropic({ apiKey: key })

    const system = `You are an assistant helping extract the likely modelling agency associated with a CSV export.
Use only the provided filename, headers, and sample rows. Do not browse the web.
Infer the best candidate agency details if present (e.g., from filename, headers like agency, source, website, copyright, about, footer, etc.).
Output a single JSON object with keys: proposedAgency { name, country, city, continent, website }, confidence (0-1), evidence (string).
If you cannot infer a value, set it to null. Do not invent facts.`

    const userPayload = {
      filename: sanitizedName,
      headers: sample.headers,
      sampleRows: sample.rows.slice(0, 10),
    }

    let proposedAgency: any = { name: null, country: null, city: null, continent: null, website: null }
    try {
      const msg = await anthropic.messages.create({
        model: 'claude-3-7-sonnet-latest',
        max_tokens: 800,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(userPayload) }]}]
      })
      const content = msg.content?.[0]
      if (!content || content.type !== 'text') throw new Error('Invalid response from Claude')
      const obj = extractJsonObject(content.text || '{}')
      if (obj && obj.proposedAgency) {
        proposedAgency = obj.proposedAgency
        if (proposedAgency && typeof proposedAgency.name === 'string') {
          let n = proposedAgency.name.replace(/aida/gi, '')
          n = n.replace(/[_\-\s]+/g, ' ').trim()
          proposedAgency.name = n || proposedAgency.name
        }
      }
    } catch (e: any) {
      // Fall back to very naive proposal: try sanitized filename segments
      const base = sanitizedName
      proposedAgency.name = base || null
    }

    const supabase = createClient(supabaseUrl, supabaseKey)
    const { data: agencies, error } = await supabase
      .from('agencies')
      .select('id,name,country,city,continent,website')
    if (error) {
      return NextResponse.json({ success: false, message: `Failed to fetch agencies: ${error.message}` }, { status: 500 })
    }

    const candidateName = String(proposedAgency?.name || '').trim()
    const candTokens = tokenizeName(candidateName)
    const candDomain = domainFromUrl(proposedAgency?.website)

    const scored = (agencies || []).map((a: any) => {
      const nameSim = jaccard(candTokens, tokenizeName(a.name || ''))
      const aDomain = domainFromUrl(a.website)
      const domainBonus = aDomain && candDomain && aDomain === candDomain ? 0.3 : 0
      const score = Math.min(1, nameSim * 0.9 + domainBonus)
      return { ...a, score }
    })
      .filter(a => a.score > 0.2)
      .sort((x, y) => y.score - x.score)
      .slice(0, 5)

    return NextResponse.json({ success: true, data: { suggestions: scored, proposedAgency, totalAgencies: agencies?.length || 0 } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || 'Internal error' }, { status: 500 })
  }
} 