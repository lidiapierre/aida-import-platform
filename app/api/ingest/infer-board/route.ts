import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { MODELS_FIELDS } from '../shared'

export const runtime = 'nodejs'

function extractJsonObject(text: string): any {
  try {
    return JSON.parse(text)
  } catch {}

  const trimmed = text.trim()

  const codeFenceMatch = trimmed.match(/```(?:json)?\n([\s\S]*?)\n```/i)
  if (codeFenceMatch) {
    const inner = codeFenceMatch[1]
    try {
      return JSON.parse(inner)
    } catch {}
  }

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
        start = -1
      }
    }
  }

  throw new Error('No valid JSON object found in text')
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
      return NextResponse.json(
        { success: false, message: 'Server misconfig: ANTHROPIC_API_KEY is not set' },
        { status: 500 }
      )
    }

    const formData = await req.formData()
    const file = formData.get('file') as unknown as File | null
    const filenameOverride = String(formData.get('filename') || '').trim()

    const dataSourceName =
      filenameOverride || (file as any)?.name || 'upload.csv'

    if (!dataSourceName) {
      return NextResponse.json(
        { success: false, message: 'Missing filename for board inference' },
        { status: 400 }
      )
    }

    const allowedBoards = (MODELS_FIELDS as any).model_board_category
      .values as string[]

    const anthropic = new Anthropic({ apiKey: key })

    const system = `You are a data ingestion assistant.
Given a CSV filename and a fixed list of allowed model_board_category values, choose the single best category that matches the filename.

Rules:
- Only use one of the allowed values, or null if there is no reasonable match.
- Do not invent new categories.
- Prefer literal or near-literal matches in the filename (case-insensitive), including common variations (e.g., "main board" -> "mainboard", "new faces" -> "a_new_face").
- Treat "curve mainboard" and "curve new faces" as distinct categories when curve-specific boards are clearly indicated in the filename.
- If the filename is too generic or ambiguous, return null.

Output:
- Return a single valid JSON object only.
- Shape: { "model_board_category": <string or null> }`

    const userPayload = {
      filename: dataSourceName,
      allowedValues: allowedBoards,
    }

    let msg
    try {
      msg = await withRetries(
        () =>
          anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 256,
            temperature: 0,
            system,
            messages: [
              {
                role: 'user',
                content: [{ type: 'text', text: JSON.stringify(userPayload) }],
              },
            ],
          }),
        (err) => {
          const status = err?.status || err?.response?.status
          const errorType = err?.error?.type || err?.data?.error?.type
          return status === 529 || errorType === 'overloaded_error'
        },
        [800, 1600, 3200]
      )
    } catch (err: any) {
      const keyInfo = { length: key.length, startsWithSkAnt: key.startsWith('sk-ant-') }
      const status = err?.status || err?.response?.status
      const errorType = err?.error?.type || err?.data?.error?.type
      if (status === 401) {
        return NextResponse.json(
          {
            success: false,
            message: 'Anthropic authentication failed (401). Check ANTHROPIC_API_KEY value and account access.',
            data: keyInfo,
          },
          { status: 401 }
        )
      }
      if (status === 529 || errorType === 'overloaded_error') {
        return NextResponse.json(
          {
            success: false,
            message: 'Anthropic is temporarily overloaded (529). Please retry in a few seconds.',
            data: { ...keyInfo, status, errorType },
          },
          { status: 503 }
        )
      }
      return NextResponse.json(
        {
          success: false,
          message: err?.message || 'Upstream error calling Anthropic',
          data: { ...keyInfo, status, errorType },
        },
        { status: 500 }
      )
    }

    const content = (msg as any).content?.[0]
    if (!content || content.type !== 'text') {
      return NextResponse.json(
        { success: false, message: 'Invalid response from Claude' },
        { status: 500 }
      )
    }

    let inferred: string | null = null
    try {
      const raw = content.text || ''
      const obj = extractJsonObject(raw)
      const candidate = obj?.model_board_category
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim()
        inferred = allowedBoards.includes(trimmed) ? trimmed : null
      } else {
        inferred = null
      }
    } catch (e: any) {
      return NextResponse.json(
        {
          success: false,
          message: 'Failed to parse model_board_category from Claude.',
          data: { error: String(e?.message || e), snippet: String(content.text || '').slice(0, 400) },
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        filename: dataSourceName,
        inferred,
        allowed: allowedBoards,
      },
    })
  } catch (e: any) {
    return NextResponse.json(
      { success: false, message: e?.message || 'Internal error' },
      { status: 500 }
    )
  }
}

