export const ingestConfig = {
  // Base URL for the model recommendation backend
  baseUrl: process.env.NEXT_PUBLIC_INGEST_BASE_URL || 'https://modelrecommendation-d8fdaa3e6179.herokuapp.com',

  // Default optional flags for update_model endpoint
  updateModelParams: {
    // new provider-based params replacing the old boolean flags
    // keep same behavior: basic=openai (was false for use_claude_basic), job_types=claude (was true for use_claude_job_types)
    provider_basic: 'openai',
    provider_job_types: 'claude',
  },
} as const

export type IngestConfig = typeof ingestConfig 