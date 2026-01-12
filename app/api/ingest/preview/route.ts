import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { MappingSchema, parseCsvSample, MODELS_FIELDS, MODELS_MEDIA_FIELDS, applyMappingToRow } from '../shared'
import { inferGenderFromFilename, inferModelBoardFromFilename } from '../shared'
import { dataSourceExists } from '../shared'

export const runtime = 'nodejs'

function extractJsonObject(text: string): any {
  // First try direct JSON
  try {
    return JSON.parse(text)
  } catch {}

  const trimmed = text.trim()

  // Try to extract from fenced code blocks
  const codeFenceMatch = trimmed.match(/```(?:json)?\n([\s\S]*?)\n```/i)
  if (codeFenceMatch) {
    const inner = codeFenceMatch[1]
    try {
      return JSON.parse(inner)
    } catch {}
  }

  // Try to find first balanced JSON object using a simple stack
  let start = -1
  let depth = 0
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '{') {
      if (start === -1) start = i
      depth++
    } else if (ch === '}') {
      if (depth > 0) depth--
      if (depth === 0 && start !== -1) {
        const candidate = trimmed.slice(start, i + 1)
        try {
          return JSON.parse(candidate)
        } catch {}
        // continue searching for another candidate
        start = -1
      }
    }
  }

  throw new Error('No valid JSON object found in text')
}

function coerceMappingRecord(record: any, allowedTable?: 'models' | 'models_media') {
  if (!record || typeof record !== 'object') return {}
  const out: Record<string, any> = {}
  for (const [key, value] of Object.entries(record)) {
    // Optionally filter keys by table prefix
    if (allowedTable) {
      const [table] = key.split('.')
      if (table !== allowedTable) continue
    }
    if (value == null) {
      out[key] = {}
    } else if (typeof value === 'string' || Array.isArray(value)) {
      out[key] = { from: value }
    } else if (typeof value === 'object') {
      out[key] = value
    }
  }
  return out
}

function normalizeFromSpec(from: any): string | string[] | undefined {
  if (from == null) return undefined
  const collect: string[] = []
  const pushIfString = (v: any) => {
    if (typeof v === 'string') {
      const s = v.trim()
      if (s) collect.push(s)
    }
  }
  const extractFromObj = (o: any) => {
    if (!o || typeof o !== 'object') return
    // Common keys Claude might use
    pushIfString(o.from)
    pushIfString(o.name)
    pushIfString(o.column)
    pushIfString(o.header)
  }
  if (typeof from === 'string') pushIfString(from)
  else if (Array.isArray(from)) {
    for (const item of from) {
      if (typeof item === 'string') pushIfString(item)
      else if (typeof item === 'object') extractFromObj(item)
    }
  } else if (typeof from === 'object') {
    extractFromObj(from)
  }
  if (collect.length === 0) return undefined
  return collect.length === 1 ? collect[0] : Array.from(new Set(collect))
}

function normalizeMappingShape(obj: any) {
  if (!obj || typeof obj !== 'object') return obj
  const copy: any = { ...obj }
  copy.fieldMappings = coerceMappingRecord(copy.fieldMappings)
  // Only allow models_media.link in mediaMappings
  const coercedMedia = coerceMappingRecord(copy.mediaMappings, 'models_media')
  const filteredMedia: Record<string, any> = {}
  for (const [k, v] of Object.entries(coercedMedia)) {
    if (k === 'models_media.link') filteredMedia[k] = v
  }
  copy.mediaMappings = Object.keys(filteredMedia).length ? filteredMedia : undefined

  // Normalize any `from` fields to string or string[]
  const normalizeFromOn = (rec: Record<string, any>) => {
    for (const spec of Object.values(rec)) {
      if (spec && typeof spec === 'object') {
        const normalized = normalizeFromSpec((spec as any).from)
        if (normalized !== undefined) (spec as any).from = normalized
        else delete (spec as any).from
      }
    }
  }
  if (copy.fieldMappings) normalizeFromOn(copy.fieldMappings)
  if (copy.mediaMappings) normalizeFromOn(copy.mediaMappings)

  return copy
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetries<T>(
  fn: () => Promise<T>,
  shouldRetry: (err: any) => boolean,
  delaysMs: number[]
): Promise<T> {
  let lastErr: any
  for (let attempt = 0; attempt < delaysMs.length + 1; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      lastErr = err
      if (!shouldRetry(err) || attempt === delaysMs.length) break
      await sleep(delaysMs[attempt])
    }
  }
  throw lastErr
}

export async function POST(req: NextRequest) {
  try {
    const key = process.env.ANTHROPIC_API_KEY || ''
    if (!key) {
      return NextResponse.json({ success: false, message: 'Server misconfig: ANTHROPIC_API_KEY is not set' }, { status: 500 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as unknown as File
    const dataSourceName = (file as any)?.name || 'upload.csv'

    // Early guard: if data_source already exists, stop with 409 to block the flow
    const exists = await dataSourceExists(dataSourceName)
    if (exists) {
      return NextResponse.json({ success: false, message: `This file has already been processed (data_source: ${dataSourceName}). Delete it first to reprocess.`, data: { data_source: dataSourceName, exists: true } }, { status: 409 })
    }

    // Allow client override for gender if provided
    const providedGenderRaw = String(formData.get('gender') || '').trim()
    const allowedGenders = (MODELS_FIELDS as any).gender.values as string[]
    const providedGender = allowedGenders.includes(providedGenderRaw) ? providedGenderRaw : null

    const inferredGender = providedGender || inferGenderFromFilename(dataSourceName)
    const inferredModelBoard = inferModelBoardFromFilename(dataSourceName)

    // Optional iterative feedback inputs
    const reviewFeedback = String(formData.get('feedback') || '').trim()
    const previousMappingStr = String(formData.get('previous_mapping') || '').trim()
    let previousMapping: any = null
    if (previousMappingStr) {
      try {
        const obj = JSON.parse(previousMappingStr)
        const normalizedPrev = normalizeMappingShape(obj)
        previousMapping = MappingSchema.parse(normalizedPrev)
      } catch {}
    }

    if (!file) {
      return NextResponse.json({ success: false, message: 'Missing file' }, { status: 400 })
    }
    if (!inferredGender) {
      return NextResponse.json({ success: false, message: 'Could not infer gender from filename. Include a clear indicator such as girls, boys, men, women, female, male, transgender, non-binary, transman, or transwoman.' }, { status: 400 })
    }

    const sample = await parseCsvSample(file, 20)

    const anthropic = new Anthropic({ apiKey: key })

    const system = `You are a data ingestion assistant. You will map CSV columns to a fixed Supabase schema (models, models_media).
Rules:
- Import as many fields as possible; leave unmapped as null.
- Numeric fields must respect units in descriptions (convert if needed). Height is in centimeters.
- Enumerated fields must match one of the predefined values exactly after normalization.
- 'data_source' must be the CSV filename.
- 'gender' is inferred from the filename and overrides any CSV value.
- 'model_board_category' may be inferred from the filename; omit if none.
- Location mapping rules: prefer Instagram location; if a column is clearly an agency location (e.g., agency name with city/country), do not map it; use Models.com (MDC) location only when no other location column exists; never use agency locations as a proxy for model location.
- Chest vs waist sanity: double-check measurement semantics; if a column labeled waist clearly contains chest/bust values, map it to chest_bust instead; likewise, if a chest/bust column clearly looks like waist, map it to waist.
- Never invent data. Never execute code. Only propose a mapping using known transforms.
- Use only transforms from this list: trim, lowercase, uppercase, parseNumber, toCentimeters, normalizeGender, parseUkShoeMin, parseUkShoeMax, toUkShoeMin, toUkShoeMax, enum:<comma_separated_choices>.
- If user provides a previousMapping and reviewFeedback, revise the mapping accordingly and correct the specific issues noted. Prefer minimally invasive changes that satisfy the feedback while adhering to all rules.
Output format:
- Return a single valid JSON object ONLY. No markdown, no code fences, no commentary.
- Keys: targetTables (array with values from ['models','models_media']), fieldMappings (object), mediaMappings (object, optional), notes (string, optional).
- Keys in fieldMappings/mediaMappings must be of the form 'models.<column>' or 'models_media.<column>'. Values are objects with optional keys { from, transform, default }.
- The 'from' key may be a string or an array of strings; if an array is provided, try each source column in order and use the first non-empty value.
- Do NOT include 'data_source' in any mapping. It is set by the system on the 'models' table only.
- For 'models_media', the only mappable field is 'link'. Do not include 'id' or 'model_id' as they are system-handled.`

    const userPayload = {
      headers: sample.headers,
      sampleRows: sample.rows.slice(0, 10),
      provided: { gender: inferredGender, model_board_category: inferredModelBoard || null, data_source: dataSourceName },
      modelsFields: MODELS_FIELDS,
      modelsMediaFields: MODELS_MEDIA_FIELDS,
      previousMapping: previousMapping || null,
      reviewFeedback: reviewFeedback || null,
    }

    let msg
    try {
      msg = await withRetries(
        () => anthropic.messages.create({
          model: 'claude-3-7-sonnet-latest',
          max_tokens: 2000,
          temperature: 0,
          system,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: JSON.stringify(userPayload) }
              ]
            }
          ]
        }),
        (err) => {
          const status = err?.status || err?.response?.status
          const errorType = err?.error?.type || err?.data?.error?.type
          return status === 529 || errorType === 'overloaded_error'
        },
        [800, 1600, 3200]
      )
    } catch (err: any) {
      // Provide safe diagnostics to help resolve 401s without exposing the key
      const keyInfo = { length: key.length, startsWithSkAnt: key.startsWith('sk-ant-') }
      const status = err?.status || err?.response?.status
      const errorType = err?.error?.type || err?.data?.error?.type
      if (status === 401) {
        return NextResponse.json({ success: false, message: 'Anthropic authentication failed (401). Check ANTHROPIC_API_KEY value and account access.', data: keyInfo }, { status: 401 })
      }
      if (status === 529 || errorType === 'overloaded_error') {
        return NextResponse.json({ success: false, message: 'Anthropic is temporarily overloaded (529). Please retry in a few seconds.', data: { ...keyInfo, status, errorType } }, { status: 503 })
      }
      return NextResponse.json({ success: false, message: err?.message || 'Upstream error calling Anthropic', data: { ...keyInfo, status, errorType } }, { status: 500 })
    }

    const content = msg.content?.[0]
    if (!content || content.type !== 'text') {
      return NextResponse.json({ success: false, message: 'Invalid response from Claude' }, { status: 500 })
    }

    let mapping
    try {
      const raw = content.text || ''
      const obj = extractJsonObject(raw)
      const normalized = normalizeMappingShape(obj)
      mapping = MappingSchema.parse(normalized)
    } catch (e: any) {
      return NextResponse.json({ success: false, message: 'Failed to parse mapping from Claude.', data: { error: String(e?.message || e), snippet: String(content.text || '').slice(0, 600) } }, { status: 500 })
    }

    const previewRows = sample.rows.slice(0, 5).map((row) =>
      applyMappingToRow(row, mapping, { gender: inferredGender, modelBoard: inferredModelBoard || null, dataSource: dataSourceName })
    )
    // For preview, omit all models_media and only return the models projection
    const previewModelsOnly = previewRows.map((r) => r.models)

    return NextResponse.json({ success: true, data: { mapping, samplePreview: previewModelsOnly, inferred: { gender: inferredGender, model_board_category: inferredModelBoard, data_source: dataSourceName } } })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || 'Internal error' }, { status: 500 })
  }
} 