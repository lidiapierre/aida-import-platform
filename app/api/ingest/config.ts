export const ingestConfig = {
  // Base URL for the model recommendation backend
  baseUrl: 'https://modelrecommendation-d8fdaa3e6179.herokuapp.com',

  // Default optional flags for update_model endpoint
  updateModelParams: {
    use_claude_basic: false,
    use_claude_job_types: true,
  },
} as const

export type IngestConfig = typeof ingestConfig 