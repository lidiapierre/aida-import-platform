import Papa from 'papaparse'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'

export const MODELS_FIELDS = {
  model_name: { type: 'text' },
  profile_url: { type: 'url', description: "The model's profile URL" },
  min_estimated_age: { type: 'numeric', description: "The model's minimum estimated age in years" },
  max_estimated_age: { type: 'numeric', description: "The model's maximum estimated age in years" },
  height: { type: 'numeric', description: "The model's height in centimeters (cm)" },
  dress_size: { type: 'numeric', description: "The model's dress size in UK size scale" },
  bra_size: { type: 'numeric', description: "The model's bra size in UK size scale" },
  bikini_bottom_size: { type: 'numeric', description: "The model's bikini bottom size in UK size scale" },
  chest_bust: { type: 'numeric', description: "The model's chest or bust measurement in centimeters (cm)" },
  waist: { type: 'numeric', description: "The model's waist measurement in centimeters (cm)" },
  hips: { type: 'numeric', description: "The model's hips measurement in centimeters (cm)" },
  jeans_size: { type: 'numeric', description: "The model's jeans size in UK size scale" },
  shoe_size: { type: 'numeric', description: "The model's shoe size in UK size scale" },
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
  location: { type: 'text', description: "Model location priority: use Instagram location if present; never use agency/office locations (e.g., 'Fabbrica Milano Management (Milan) Italy'); use Models.com (MDC) location only if no other location column exists. Example values: 'UK', 'USA', 'France'." },
  models_dot_com_profile: { type: 'text', description: 'Direct link to the model’s Models.com profile' },
  mdc_achievements: { type: 'text', description: 'Achievements listed on the ModelsDotCom profile, e.g., Legends, Top 50, Hot List' },
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

function parseUkShoeBounds(input: any): { min: number; max: number } | null {
  if (input == null) return null
  const normalizeFractions = (str: string) =>
    String(str)
      .replace(/½/g, '.5')
      .replace(/¼/g, '.25')
      .replace(/¾/g, '.75')
  const raw = normalizeFractions(String(input)).toLowerCase().trim()
  if (!raw) return null
  const ukIndex = raw.indexOf('uk')
  if (ukIndex === -1) return null
  const tail = raw.slice(ukIndex)
  const matches = tail.match(/(\d+(?:\.[\d]+)?)/g)
  if (!matches || matches.length === 0) return null
  const nums = matches
    .map((m) => Number(m))
    .filter((n) => Number.isFinite(n))
  if (!nums.length) return null
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  return { min, max }
}

function normalizeFractionsGeneric(s: string): string {
  return s
    .replace(/½/g, '.5')
    .replace(/¼/g, '.25')
    .replace(/¾/g, '.75')
}

function parseShoeToUkBounds(value: any, gender: string | null | undefined, unitHint?: 'uk' | 'eu' | 'us' | ''): { min: number; max: number } | null {
  if (value == null) return null
  const raw = normalizeFractionsGeneric(String(value).toLowerCase().trim())
  if (!raw) return null

  const push = (arr: number[], n: any) => {
    const num = Number(n)
    if (Number.isFinite(num)) arr.push(num)
  }

  const collectUnitValues = (unitPattern: string) => {
    const vals: number[] = []
    const u = unitPattern // e.g., '(?:uk)' or '(?:eu|eur)'
    // Range: unit first
    const re1 = new RegExp(`${u}\\s*([0-9]+(?:\\.[0-9]+)?)\\s*[-/–]\\s*([0-9]+(?:\\.[0-9]+)?)`, 'g')
    // Range: number first then unit
    const re2 = new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s*[-/–]\\s*([0-9]+(?:\\.[0-9]+)?)\\s*${u}`, 'g')
    // Single: unit then number
    const re3 = new RegExp(`${u}\\s*([0-9]+(?:\\.[0-9]+)?)`, 'g')
    // Single: number then unit
    const re4 = new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s*${u}`, 'g')

    let m: RegExpExecArray | null
    while ((m = re1.exec(raw))) { push(vals, m[1]); push(vals, m[2]) }
    while ((m = re2.exec(raw))) { push(vals, m[1]); push(vals, m[2]) }
    while ((m = re3.exec(raw))) { push(vals, m[1]) }
    while ((m = re4.exec(raw))) { push(vals, m[1]) }
    return vals
  }

  const ukVals = collectUnitValues('(?:uk)')
  const euVals = collectUnitValues('(?:eu|eur)')
  const usVals = collectUnitValues('(?:us|usa)')

  const toUk = (n: number, unit: 'uk' | 'eu' | 'us'): number => {
    const g = (gender || '').toLowerCase()
    if (unit === 'uk') return n
    if (unit === 'eu') {
      // Approximate: women UK = EU - 33; men UK = EU - 34; otherwise average
      if (g === 'female' || g === 'woman') return n - 33
      if (g === 'male' || g === 'man') return n - 34
      return n - 33.5
    }
    // unit === 'us'
    // Approximate: women UK = US - 2; men UK = US - 1; otherwise average
    if (g === 'female' || g === 'woman') return n - 2
    if (g === 'male' || g === 'man') return n - 1
    return n - 1.5
  }

  const convertedUk: number[] = []
  if (ukVals.length) {
    convertedUk.push(...ukVals)
  } else if (euVals.length) {
    convertedUk.push(...euVals.map((n) => toUk(n, 'eu')))
  } else if (usVals.length) {
    convertedUk.push(...usVals.map((n) => toUk(n, 'us')))
  } else {
    // Bare numbers; assume hinted unit, otherwise UK
    const bare = Array.from(raw.matchAll(/([0-9]+(?:\.[0-9]+)?)/g)).map((m) => Number(m[1])).filter((n) => Number.isFinite(n))
    if (bare.length) {
      const unit = (unitHint || '') as 'uk' | 'eu' | 'us' | ''
      if (unit === 'eu') convertedUk.push(...bare.map((n) => toUk(n, 'eu')))
      else if (unit === 'us') convertedUk.push(...bare.map((n) => toUk(n, 'us')))
      else convertedUk.push(...bare)
    }
  }

  if (!convertedUk.length) return null
  const min = Math.min(...convertedUk)
  const max = Math.max(...convertedUk)
  return { min, max }
}

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
        // normalize ASCII double tick inches like 32'' to a single double-quote
        .replace(/''/g, '"')
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

    const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    const stripUnderscore = (s: string) => s.replace(/_/g, '')

    const normalizedInput = normalize(String(v))
    const normalizedInputNoUnderscore = stripUnderscore(normalizedInput)

    // Build an index of acceptable variants for each choice
    const variantToCanonical = new Map<string, string>()
    for (const choice of choices) {
      const c = normalize(choice)
      const cNoUnderscore = stripUnderscore(c)

      // direct forms
      variantToCanonical.set(c, c)
      variantToCanonical.set(cNoUnderscore, c)

      // common spelling variants: blonde/blond
      if (c.includes('blonde')) {
        const blondVariant = c.replace(/blonde/g, 'blond')
        variantToCanonical.set(blondVariant, c)
        variantToCanonical.set(stripUnderscore(blondVariant), c)
      }
      if (c.includes('blond')) {
        const blondeVariant = c.replace(/blond/g, 'blonde')
        variantToCanonical.set(blondeVariant, c)
        variantToCanonical.set(stripUnderscore(blondeVariant), c)
      }

      // common spelling variants: gray/grey
      if (c.includes('gray')) {
        const greyVariant = c.replace(/gray/g, 'grey')
        variantToCanonical.set(greyVariant, c)
        variantToCanonical.set(stripUnderscore(greyVariant), c)
      }
      if (c.includes('grey')) {
        const grayVariant = c.replace(/grey/g, 'gray')
        variantToCanonical.set(grayVariant, c)
        variantToCanonical.set(stripUnderscore(grayVariant), c)
      }
    }

    const resolved = variantToCanonical.get(normalizedInput)
      || variantToCanonical.get(normalizedInputNoUnderscore)

    return resolved || null
  },
  // Back-compat transforms that only extract explicit UK values
  parseUkShoeMin: (v) => {
    const r = parseUkShoeBounds(v)
    return r ? r.min : null
  },
  parseUkShoeMax: (v) => {
    const r = parseUkShoeBounds(v)
    return r ? r.max : null
  },
}

export function applyTransform(value: any, transform?: string) {
  if (!transform) return value
  if (transform.startsWith('enum:')) {
    return SAFE_TRANSFORMS.enumSanitize(transform.replace('enum:', ''))(value)
  }
  if (transform.startsWith('toUkShoeMin')) {
    const parts = transform.split(':')
    const gender = parts[1] || ''
    const hint = (parts[2] || '') as 'uk' | 'eu' | 'us' | ''
    const r = parseShoeToUkBounds(value, gender, hint)
    return r ? r.min : null
  }
  if (transform.startsWith('toUkShoeMax')) {
    const parts = transform.split(':')
    const gender = parts[1] || ''
    const hint = (parts[2] || '') as 'uk' | 'eu' | 'us' | ''
    const r = parseShoeToUkBounds(value, gender, hint)
    return r ? r.max : null
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

function getSourceValueWithKey(row: Record<string, any>, fromSpec?: string | string[]): { value: any, keyUsed: string | null } {
  if (!fromSpec) return { value: undefined, keyUsed: null }
  const candidates = Array.isArray(fromSpec) ? fromSpec : [fromSpec]
  const rowKeys = Object.keys(row)
  const normalizedMap = new Map<string, string>()
  for (const k of rowKeys) normalizedMap.set(normalizeKey(k), k)

  for (const cand of candidates) {
    if (cand in row) {
      const v = row[cand]
      if (v !== undefined && v !== null && String(v).trim() !== '') return { value: v, keyUsed: cand }
    }
    const norm = normalizeKey(cand)
    const actual = normalizedMap.get(norm)
    if (actual) {
      const v = row[actual]
      if (v !== undefined && v !== null && String(v).trim() !== '') return { value: v, keyUsed: actual }
    }
  }
  return { value: undefined, keyUsed: null }
}

const CM_COLUMNS = new Set<string>([
  'height',
  'chest_bust',
  'waist',
  'hips',
])

const SHOE_TRANSFORM_BY_COLUMN: Record<string, string> = {
  shoe_size: 'toUkShoeMin',
}

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

  // Single-token hint: treat 'main' as mainboard
  if (has('main') || bounded('main')) return 'mainboard'

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
    const { value: sourceVal, keyUsed: sourceKey } = getSourceValueWithKey(row, fromSpec)

    // Enforce cm conversion for specific columns
    const transformRequested = (spec as any).transform as string | undefined
    let transformToApply = CM_COLUMNS.has(column) ? 'toCentimeters' : transformRequested

    // Default shoe size parsing for UK sizes (gender-aware) if not explicitly set, or if a generic parseNumber was requested
    if (table === 'models') {
      const shoeBase = (SHOE_TRANSFORM_BY_COLUMN as any)[column]
      if (shoeBase && (!transformRequested || transformRequested === 'parseNumber')) {
        const genderParam = (opts.gender || '').toLowerCase()
        // Infer unit hint from source column name if possible
        let unitHint = ''
        if (sourceKey) {
          const k = normalizeKey(sourceKey)
          if (/\beu\b|\beur\b|european/.test(k)) unitHint = 'eu'
          else if (/\bus\b|\busa\b|american/.test(k)) unitHint = 'us'
          else if (/\buk\b|british|\buk_sizes?\b/.test(k)) unitHint = 'uk'
        }
        transformToApply = genderParam || unitHint ? `${shoeBase}:${genderParam}:${unitHint}` : shoeBase
      }
    }

    // For enum fields on models, default to enum sanitizer if not explicitly set
    if (!CM_COLUMNS.has(column) && table === 'models') {
      const fieldMeta: any = (MODELS_FIELDS as any)[column]
      if (fieldMeta && fieldMeta.type === 'enum') {
        const enumChoices = Array.isArray(fieldMeta.values) ? fieldMeta.values.join(',') : ''
        if (!transformRequested || !transformRequested.startsWith('enum:')) {
          transformToApply = `enum:${enumChoices}`
        }
      }
    }

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

export async function dataSourceExists(dataSource: string): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string
  if (!supabaseUrl || !supabaseKey) return false
  const supabase = createClient(supabaseUrl, supabaseKey)
  const { count, error } = await supabase
    .from('models')
    .select('id', { count: 'exact', head: true })
    .eq('data_source', dataSource)
  if (error) return false
  return (count || 0) > 0
} 