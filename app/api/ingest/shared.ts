import Papa from 'papaparse'
import { z } from 'zod'

export const MODELS_FIELDS = {
  model_name: { type: 'text' },
  min_estimated_age: { type: 'numeric', description: "The model's minimum estimated age in years" },
  max_estimated_age: { type: 'numeric', description: "The model's maximum estimated age in years" },
  min_height: { type: 'numeric', description: "The model's minimum height in centimeters (cm)" },
  max_height: { type: 'numeric', description: "The model's maximum height in centimeters (cm)" },
  min_dress_size: { type: 'numeric', description: "The model's minimum dress size in UK size scale" },
  max_dress_size: { type: 'numeric', description: "The model's maximum dress size in UK size scale" },
  min_bra_size: { type: 'numeric', description: "The model's minimum bra size in UK size scale" },
  max_bra_size: { type: 'numeric', description: "The model's maximum bra size in UK size scale" },
  min_bikini_bottom_size: { type: 'numeric', description: "The model's minimum bikini bottom size in UK size scale" },
  max_bikini_bottom_size: { type: 'numeric', description: "The model's maximum bikini bottom size in UK size scale" },
  min_chest_bust: { type: 'numeric', description: "The model's minimum chest or bust measurement in centimeters (cm)" },
  max_chest_bust: { type: 'numeric', description: "The model's maximum chest or bust measurement in centimeters (cm)" },
  min_waist: { type: 'numeric', description: "The model's minimum waist measurement in centimeters (cm)" },
  max_waist: { type: 'numeric', description: "The model's maximum waist measurement in centimeters (cm)" },
  min_hips: { type: 'numeric', description: "The model's minimum hips measurement in centimeters (cm)" },
  max_hips: { type: 'numeric', description: "The model's maximum hips measurement in centimeters (cm)" },
  min_jeans_size: { type: 'numeric', description: "The model's minimum jeans size in UK size scale" },
  max_jeans_size: { type: 'numeric', description: "The model's maximum jeans size in UK size scale" },
  min_shoe_size: { type: 'numeric', description: "The model's minimum shoe size in UK size scale" },
  max_shoe_size: { type: 'numeric', description: "The model's maximum shoe size in UK size scale" },
  instagram_account: { type: 'url', description: "The model's Instagram account URL" },
  model_board_category: { type: 'enum', description: "The category of the model's board", values: [
    'image','mainboard','a_new_face','development','non_binary_aka_x_division','direct','youth','classic','timeless','curve','teen','commercial','preview','verve','big_and_tall','a_family','couples','petite','lifestyle','fit','runway','streetcast','elite','premier'
  ] },
  hair_colour: { type: 'enum', description: "The model's hair colour", values: [
    'platinum_blonde','ash_blonde','sandy_blonde','strawberry_blonde','honey_blonde','black','grey','yellow','green','blue','purple','lavender','emerald_green','rose_gold','dark_brown','medium_brown','light_brown','chestnut_brown','golden_brown','ash_brown','reddish_brown','mahogany_brown','blonde','dirty_blonde','light_blonde','medium_blonde','dark_blonde','red','copper_red','ginger_red','auburn','deep_red','strawberry_red','white','silver_gray','salt_and_pepper','steel_gray','orange','purple','lavender','lilac','magenta','electric_blue','turquoise','teal','aqua','sky_blue','mint_green','neon_green','pastel_pink','flamingo_pink','hot_pink','burgundy','wine_red','blood_red','platinum_silver','gunmetal_gray','chestnut'
  ] },
  eye_colour: { type: 'enum', description: "The model's eye colour", values: [
    'brown','blue','green','hazel','gray','gray_green','blue_green','green_hazel','dark_brown','light_brown','blue_grey','black','grey_green'
  ] },
  sexuality: { type: 'enum', description: "The model's sexual orientation", values: ['gay','bisexual','pansexual','asexual'] },
  gender: { type: 'enum', description: "The model's gender orientation", values: ['male','female','transgender','non-binary','transman','transwoman'] },
  pronouns: { type: 'enum', description: "The model's preferred pronouns", values: ['they_them','he_him_his','she_her_hers','she_they','she_he'] },
  body_type: { type: 'array', description: 'List of text values representing attributes of the model\'s body type', values: ['petite','curve','plus_size','athletic','muscular'] },
  hobby_interest_talent: { type: 'text', description: "The model's hobbies, interests, or talents" },
  location: { type: 'text', description: "The model's country, for example 'UK', 'USA', 'France' .." },
  data_source: { type: 'text', description: 'The source of the data, for example the name of the .csv file used to ingest the data' },
} as const

export const MODELS_MEDIA_FIELDS = {
  link: { type: 'url', description: 'Direct URL to an image or media resource for the model' },
  // id and model_id are generated/linked by the system and must not be mapped
} as const

export const MappingSchema = z.object({
  targetTables: z.array(z.enum(['models', 'models_media'])).min(1),
  fieldMappings: z.record(
    z.string(),
    z.object({
      from: z.union([z.string(), z.array(z.string())]).optional(),
      transform: z.string().optional(),
      default: z.any().optional(),
    })
  ),
  mediaMappings: z.record(
    z.string(),
    z.object({
      from: z.union([z.string(), z.array(z.string())]).optional(),
      transform: z.string().optional(),
      default: z.any().optional(),
    })
  ).optional(),
  notes: z.string().optional(),
})

export type Mapping = z.infer<typeof MappingSchema>

export const SAFE_TRANSFORMS: Record<string, (value: any) => any> = {
  trim: (v) => (typeof v === 'string' ? v.trim() : v),
  lowercase: (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  uppercase: (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
  parseNumber: (v) => {
    if (v == null || v === '') return null
    const num = Number(String(v).replace(/[^0-9.-]/g, ''))
    return Number.isFinite(num) ? num : null
  },
  toCentimeters: (v) => {
    if (v == null || v === '') return null
    const raw = String(v).toLowerCase().trim()

    // Normalize common unicode fraction characters to decimals
    const normalizeFractions = (str: string) =>
      str
        .replace(/½/g, '.5')
        .replace(/¼/g, '.25')
        .replace(/¾/g, '.75')
        .replace(/⅓/g, '.3333')
        .replace(/⅔/g, '.6667')
        .replace(/⅛/g, '.125')
        .replace(/⅜/g, '.375')
        .replace(/⅝/g, '.625')
        .replace(/⅞/g, '.875')
        // normalize prime symbols for inches
        .replace(/″/g, '"')
        .replace(/′/g, "'")

    const s = normalizeFractions(raw)

    // Prefer an explicit cm value if present anywhere
    const cmMatch = s.match(/(\d+(?:\.\d+)?)\s*cm/)
    if (cmMatch) {
      const n = Number(cmMatch[1])
      return Number.isFinite(n) ? Math.round(n) : null
    }

    // Patterns for feet and inches
    // Examples: 5' 7.5" | 5ft 7.5in | 5 ft 7 in | 5'7"
    const ftInMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:ft|')\s*(\d*(?:\.\d+)?)?\s*(?:in|inch|inches|\"|)?/)
    if (ftInMatch) {
      const ft = Number(ftInMatch[1])
      const inch = ftInMatch[2] ? Number(ftInMatch[2]) : 0
      if (Number.isFinite(ft) && Number.isFinite(inch)) {
        return Math.round((ft * 12 + inch) * 2.54)
      }
    }

    // Just inches: 67.5 in | 67.5" | 67 inches
    const inMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:in|inch|inches|\")/)
    if (inMatch) {
      const inch = Number(inMatch[1])
      return Number.isFinite(inch) ? Math.round(inch * 2.54) : null
    }

    // Fallback: treat bare number as centimeters
    const plain = Number(s.replace(/[^0-9.-]/g, ''))
    return Number.isFinite(plain) ? Math.round(plain) : null
  },
  normalizeGender: (v) => {
    const s = String(v || '').toLowerCase().trim()
    const map: Record<string, string> = {
      male: 'male', m: 'male', man: 'male',
      female: 'female', f: 'female', woman: 'female',
      transgender: 'transgender', trans: 'transgender',
      'non-binary': 'non-binary', nonbinary: 'non-binary', nb: 'non-binary',
      transman: 'transman', transwoman: 'transwoman'
    }
    return map[s] || null
  },
  enumSanitize: (choicesCsv: string) => (v: any) => {
    if (v == null) return null
    const choices = choicesCsv.split(',').map((s) => s.trim())
    const normalized = String(v).toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    const found = choices.find((c) => c === normalized)
    return found || null
  },
}

export function applyTransform(value: any, transform?: string) {
  if (!transform) return value
  if (transform.startsWith('enum:')) {
    return SAFE_TRANSFORMS.enumSanitize(transform.replace('enum:', ''))(value)
  }
  const fn = SAFE_TRANSFORMS[transform]
  return fn ? fn(value) : value
}

function normalizeKey(key: string): string {
  return key.toLowerCase().trim().replace(/\s+/g, '_').replace(/[-]+/g, '_')
}

function getSourceValue(row: Record<string, any>, fromSpec?: string | string[]): any {
  if (!fromSpec) return undefined
  const candidates = Array.isArray(fromSpec) ? fromSpec : [fromSpec]
  const rowKeys = Object.keys(row)
  const normalizedMap = new Map<string, string>()
  for (const k of rowKeys) normalizedMap.set(normalizeKey(k), k)

  for (const cand of candidates) {
    // 1) Exact
    if (cand in row) {
      const v = row[cand]
      if (v !== undefined && v !== null && String(v).trim() !== '') return v
    }
    // 2) Case-insensitive/normalized
    const norm = normalizeKey(cand)
    const actual = normalizedMap.get(norm)
    if (actual) {
      const v = row[actual]
      if (v !== undefined && v !== null && String(v).trim() !== '') return v
    }
  }
  return undefined
}

const CM_COLUMNS = new Set<string>([
  'min_height', 'max_height',
  'min_chest_bust', 'max_chest_bust',
  'min_waist', 'max_waist',
  'min_hips', 'max_hips',
])

function extractUrls(input: any): string[] {
  if (input == null) return []
  const text = String(input)
  // Split on common delimiters and whitespace/newlines
  const parts = text
    .split(/[\s,;\n\r\t]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const urls: string[] = []
  for (const p of parts) {
    // Basic URL heuristic
    if (/^https?:\/\//i.test(p)) {
      urls.push(p)
    }
  }
  // Deduplicate
  return Array.from(new Set(urls))
}

function toTitleCaseName(input: any): string | null {
  if (input == null) return null
  const s = String(input).trim()
  if (!s) return null

  // Lowercase everything first to normalize
  const lower = s.toLowerCase()

  // Title-case words and preserve common name delimiters (space, hyphen, apostrophes)
  const delimiters = /([\s\-\'\u2019]+)/
  const parts = lower.split(delimiters)

  const cap = (word: string) => {
    if (!word) return word
    // Handle segments split by apostrophes or hyphens within a token
    return word
      .split(/([\-\'\u2019])/)
      .map((seg) => {
        if (seg === '-' || seg === "'" || seg === '’') return seg
        return seg.charAt(0).toUpperCase() + seg.slice(1)
      })
      .join('')
  }

  const titled = parts
    .map((p, idx) => {
      // Keep delimiters as-is
      if (delimiters.test(p)) return p
      return cap(p)
    })
    .join('')

  // Collapse any excessive whitespace to single spaces and trim
  return titled.replace(/\s+/g, ' ').trim()
}

export async function parseCsvSample(file: File, sampleSize: number): Promise<{ headers: string[]; rows: any[] }> {
  const text = await file.text()
  return new Promise((resolve, reject) => {
    Papa.parse<any>(text, {
      header: true,
      worker: false,
      preview: sampleSize,
      skipEmptyLines: true,
      complete: (results: Papa.ParseResult<any>) => {
        const rows = results.data as any[]
        const headers = results.meta.fields || (rows.length ? Object.keys(rows[0]) : [])
        resolve({ headers, rows })
      },
      error: (err: any) => reject(err),
    })
  })
}

export async function parseCsvAll(file: File): Promise<{ headers: string[]; rows: any[] }> {
  const text = await file.text()
  return new Promise((resolve, reject) => {
    Papa.parse<any>(text, {
      header: true,
      worker: false,
      skipEmptyLines: true,
      complete: (results: Papa.ParseResult<any>) => {
        const rows = results.data as any[]
        const headers = results.meta.fields || (rows.length ? Object.keys(rows[0]) : [])
        resolve({ headers, rows })
      },
      error: (err: any) => reject(err),
    })
  })
}

// Infer gender and model board values from the CSV filename
function normalizeFilenameForSearch(name: string): { underscored: string; tokens: Set<string> } {
  const lower = String(name || '').toLowerCase()
  const underscored = lower.replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_')
  const tokens = new Set(underscored.split('_').filter(Boolean))
  return { underscored, tokens }
}

export function inferGenderFromFilename(fileName: string): string | null {
  const { underscored, tokens } = normalizeFilenameForSearch(fileName)

  const hasToken = (t: string) => tokens.has(t)
  const hasBounded = (t: string) => new RegExp(`(^|_)${t}(_|$)`).test(underscored)

  // Most specific first
  if (hasToken('transman') || hasBounded('trans_man')) return 'transman'
  if (hasToken('transwoman') || hasBounded('trans_woman')) return 'transwoman'
  if (hasToken('transgender') || hasBounded('trans')) return 'transgender'
  if (hasToken('nonbinary') || hasBounded('non_binary') || hasToken('nb') || hasBounded('x_division') || hasToken('enby')) return 'non-binary'

  const femaleHints = [
    'female', 'females',
    'women', 'womens', 'woman', 'womxn',
    'girls', 'girl',
    'ladies', 'lady'
  ]
  for (const h of femaleHints) {
    if (hasToken(h) || hasBounded(h)) return 'female'
  }

  const maleHints = [
    'male', 'males',
    'men', 'mens', 'man',
    'boys', 'boy',
    'guys', 'gentlemen', 'gentleman', 'gents'
  ]
  for (const h of maleHints) {
    if (hasToken(h) || hasBounded(h)) return 'male'
  }

  return null
}

export function inferModelBoardFromFilename(fileName: string): string | null {
  const { underscored, tokens } = normalizeFilenameForSearch(fileName)
  const bounded = (t: string) => new RegExp(`(^|_)${t}(_|$)`).test(underscored)
  const has = (t: string) => tokens.has(t)
  const hasAll = (...ts: string[]) => ts.every((x) => tokens.has(x))

  // Composite phrase handling (split words found anywhere)
  if (hasAll('new', 'face') || hasAll('new', 'faces')) return 'a_new_face'
  if (hasAll('main', 'board')) return 'mainboard'
  if (hasAll('big', 'and', 'tall')) return 'big_and_tall'
  if (hasAll('x', 'division')) return 'non_binary_aka_x_division'
  if (hasAll('non', 'binary')) return 'non_binary_aka_x_division'

  const expandVariants = (t: string): string[] => {
    const variants = new Set<string>()
    const u = t.replace(/-/g, '_')
    variants.add(u)
    // plural forms
    if (!u.endsWith('s')) variants.add(u + 's')
    if (u.endsWith('y')) variants.add(u.slice(0, -1) + 'ies')
    if (/^(?:.*(?:s|x|ch|sh))$/.test(u)) variants.add(u + 'es')
    // collapsed (no separators) for filenames that concatenate
    variants.add(u.replace(/_/g, ''))
    return Array.from(variants)
  }

  const candidates: Array<{ value: string; tokens: string[] }> = [
    { value: 'image', tokens: ['image'] },
    { value: 'mainboard', tokens: ['mainboard', 'main_board'] },
    { value: 'a_new_face', tokens: ['a_new_face', 'new_face', 'new_faces', 'newface', 'newfaces'] },
    { value: 'development', tokens: ['development'] },
    { value: 'non_binary_aka_x_division', tokens: ['non_binary_aka_x_division', 'x_division', 'non_binary', 'non-binary', 'nonbinary', 'nb'] },
    { value: 'direct', tokens: ['direct'] },
    { value: 'youth', tokens: ['youth'] },
    { value: 'classic', tokens: ['classic'] },
    { value: 'timeless', tokens: ['timeless'] },
    { value: 'curve', tokens: ['curve'] },
    { value: 'teen', tokens: ['teen'] },
    { value: 'commercial', tokens: ['commercial'] },
    { value: 'preview', tokens: ['preview'] },
    { value: 'verve', tokens: ['verve'] },
    { value: 'big_and_tall', tokens: ['big_and_tall', 'bigandtall', 'big_tall', 'big-tall'] },
    { value: 'a_family', tokens: ['a_family', 'family'] },
    { value: 'couples', tokens: ['couples'] },
    { value: 'petite', tokens: ['petite'] },
    { value: 'lifestyle', tokens: ['lifestyle'] },
    { value: 'fit', tokens: ['fit'] },
    { value: 'runway', tokens: ['runway'] },
    { value: 'streetcast', tokens: ['streetcast'] },
    { value: 'elite', tokens: ['elite'] },
    { value: 'premier', tokens: ['premier'] },
  ]

  for (const c of candidates) {
    for (const t of c.tokens.flatMap(expandVariants)) {
      if (bounded(t) || has(t) || bounded(t.replace(/_/g, ''))) return c.value
    }
  }
  return null
}

export function applyMappingToRow(
  row: Record<string, any>,
  mapping: Mapping,
  opts: { gender: string; modelBoard?: string | null; dataSource: string }
): { models: Record<string, any>; models_media: Array<Record<string, any>> } {
  const models: Record<string, any> = {}
  const mediaRows: Array<Record<string, any>> = []

  for (const [target, spec] of Object.entries(mapping.fieldMappings || {} as Mapping['fieldMappings'])) {
    const [table, column] = target.split('.')

    // Protect reserved field: data_source is system-set on models only
    if (column === 'data_source') continue

    const fromSpec = (spec as any).from as string | string[] | undefined
    let sourceVal: any = getSourceValue(row, fromSpec)

    // Enforce cm conversion for specific columns
    const transformRequested = (spec as any).transform as string | undefined
    const transformToApply = CM_COLUMNS.has(column) ? 'toCentimeters' : transformRequested

    const transformed = applyTransform(sourceVal, transformToApply)
    const finalVal = transformed ?? (spec as any).default ?? null

    if (table === 'models') models[column] = finalVal
    if (table === 'models_media') {
      if (column === 'id' || column === 'model_id') continue
      // For models_media at fieldMappings scope, ignore except link which is handled below via mediaMappings
      // Kept for future extensibility
    }
  }

  // Build media rows from mediaMappings (supports multiple links per row)
  if (mapping.mediaMappings) {
    const linkSpec = (mapping.mediaMappings as Record<string, any>)['models_media.link']
    if (linkSpec) {
      const fromSpec = (linkSpec as any).from as string | string[] | undefined
      const candidates = Array.isArray(fromSpec) ? fromSpec : fromSpec ? [fromSpec] : []
      const foundLinks: string[] = []
      for (const cand of candidates) {
        const val = getSourceValue(row, cand)
        foundLinks.push(...extractUrls(val))
      }
      // If no candidates specified but a single from exists, also consider it
      if (candidates.length === 0) {
        const val = (linkSpec as any).from
        foundLinks.push(...extractUrls(val))
      }
      const uniqueLinks = Array.from(new Set(foundLinks)).filter(Boolean)
      for (const link of uniqueLinks) {
        mediaRows.push({ link })
      }
    }
  }

  // Force reserved/system fields
  models.gender = opts.gender || null
  if (opts.modelBoard) models.model_board_category = opts.modelBoard
  models.data_source = opts.dataSource

  // Post-processing: ensure model_name is title-cased
  if (models.model_name != null) {
    models.model_name = toTitleCaseName(models.model_name) as any
  }

  return { models, models_media: mediaRows }
} 