'use client'

import { useState, useCallback, useRef } from 'react'
import { Upload, FileText, CheckCircle, AlertCircle, Loader2, Plus, Globe } from 'lucide-react'

interface UploadResponse {
  success: boolean
  message: string
  data?: any
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [preview, setPreview] = useState<any | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)
  const [agencySuggestions, setAgencySuggestions] = useState<any[] | null>(null)
  const [proposedAgency, setProposedAgency] = useState<any | null>(null)
  const [selectedAgencyId, setSelectedAgencyId] = useState<number | null>(null)
  const [selectedGender, setSelectedGender] = useState<string | null>(null)
  const [showGenderPicker, setShowGenderPicker] = useState<boolean>(false)
  const [isSuggestingAgency, setIsSuggestingAgency] = useState(false)
  const [creatingAgency, setCreatingAgency] = useState<boolean>(false)
  const [createAgencyError, setCreateAgencyError] = useState<string | null>(null)
  const [showAgencyCreateForm, setShowAgencyCreateForm] = useState<boolean>(false)
  const [feedback, setFeedback] = useState<string>('')
  const [isRegenerating, setIsRegenerating] = useState<boolean>(false)
  // CV inference state
  const [pendingModelIds, setPendingModelIds] = useState<Array<string | number>>([])
  const [showCvPrompt, setShowCvPrompt] = useState<boolean>(false)
  const [isInferring, setIsInferring] = useState<boolean>(false)
  const [inferenceLogs, setInferenceLogs] = useState<Array<{ modelId: string | number; success: boolean; status: number; data: any }>>([])
  const cancelCvRef = useRef<boolean>(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  // New: data_source conflict handling
  const [dataSourceConflict, setDataSourceConflict] = useState<{ exists: boolean; data_source: string } | null>(null)
  const [isDeletingSource, setIsDeletingSource] = useState<boolean>(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const checkDataSource = useCallback(async (csv: File) => {
    try {
      const form = new FormData()
      form.append('file', csv)
      const resp = await fetch('/api/ingest/check', { method: 'POST', body: form })
      const json = await resp.json()
      if (resp.ok && json?.success) {
        if (json.data?.exists) {
          setDataSourceConflict({ exists: true, data_source: json.data?.data_source })
        } else {
          setDataSourceConflict(null)
        }
      } else {
        setDataSourceConflict(null)
      }
    } catch {
      setDataSourceConflict(null)
    }
  }, [])

  const handleFileSelect = useCallback((selectedFile: File) => {
    if (selectedFile.type === 'text/csv' || selectedFile.name.endsWith('.csv')) {
      setFile(selectedFile)
      setUploadResult(null)
      setPreview(null)
      setSelectedAgencyId(null)
      setAgencySuggestions(null)
      setProposedAgency(null)
      setShowAgencyCreateForm(false)
      // naive client-side gender inference from filename for UX
      const lower = selectedFile.name.toLowerCase()
      const guess = /transman|trans_man/.test(lower)
        ? 'transman'
        : /transwoman|trans_woman/.test(lower)
        ? 'transwoman'
        : /transgender|\btrans\b/.test(lower)
        ? 'transgender'
        : /(non[-_\s]?binary|\bnb\b|x[-_\s]?division|enby)/.test(lower)
        ? 'non-binary'
        : /(female|women|womens|woman|womxn|girls|girl|ladies|lady)/.test(lower)
        ? 'female'
        : /(male|men|mens|man|boys|boy|guys|gentlemen|gentleman|gents)/.test(lower)
        ? 'male'
        : null
      setSelectedGender(guess)
      setShowGenderPicker(!guess)
      setFeedback('')
      // New: check data_source existence early
      checkDataSource(selectedFile)
    } else {
      setUploadResult({ success: false, message: 'Please select a valid CSV file' })
    }
  }, [checkDataSource])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) {
      handleFileSelect(droppedFile)
    }
  }, [handleFileSelect])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      handleFileSelect(selectedFile)
    }
  }, [handleFileSelect])

  const fetchAgencySuggestions = useCallback(async (csv: File) => {
    setIsSuggestingAgency(true)
    setCreateAgencyError(null)
    try {
      const formData = new FormData()
      formData.append('file', csv)
      const resp = await fetch('/api/agencies/suggest', { method: 'POST', body: formData })
      const json = await resp.json()
      if (!resp.ok || !json?.success) {
        setAgencySuggestions([])
        setProposedAgency(null)
        return
      }
      setAgencySuggestions(json.data?.suggestions || [])
      setProposedAgency(json.data?.proposedAgency || null)
    } catch (e) {
      setAgencySuggestions([])
      setProposedAgency(null)
    } finally {
      setIsSuggestingAgency(false)
    }
  }, [])

  const handleSuggestAgencies = async () => {
    if (!file) return
    await fetchAgencySuggestions(file)
  }

  const handleCreateAgency = async () => {
    setCreatingAgency(true)
    setCreateAgencyError(null)
    try {
      const body = {
        name: proposedAgency?.name || '',
        country: proposedAgency?.country || null,
        city: proposedAgency?.city || null,
        continent: proposedAgency?.continent || null,
        website: proposedAgency?.website || null,
      }
      const resp = await fetch('/api/agencies/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await resp.json()
      if (!resp.ok || !json?.success) {
        setCreateAgencyError(json?.message || 'Failed to create agency')
        return
      }
      setSelectedAgencyId(json.data?.id || null)
      setShowAgencyCreateForm(false)
    } catch (e) {
      setCreateAgencyError('Network error while creating agency')
    } finally {
      setCreatingAgency(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!file) {
      setUploadResult({ success: false, message: 'Please select a CSV file' })
      return
    }

    if (dataSourceConflict?.exists) {
      setUploadResult({ success: false, message: `This file has already been processed (${dataSourceConflict.data_source}). Delete it first to reprocess.` })
      return
    }

    if (selectedAgencyId == null) {
      setUploadResult({ success: false, message: 'Please select or create an agency before continuing.' })
      return
    }
    if (!selectedGender) {
      setUploadResult({ success: false, message: 'Please select a gender before continuing.' })
      return
    }

    setIsUploading(true)
    setUploadResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      if (selectedGender) formData.append('gender', selectedGender)

      // Step 1: ask server to parse a sample and get agent-proposed mapping preview
      const previewResp = await fetch('/api/ingest/preview', { method: 'POST', body: formData })

      const previewJson = await previewResp.json()

      if (!previewResp.ok || !previewJson?.success) {
        // Capture 409 conflict
        if (previewResp.status === 409) {
          setDataSourceConflict({ exists: true, data_source: (previewJson?.data?.data_source || file.name) })
        }
        setUploadResult({ success: false, message: previewJson?.message || 'Failed to prepare preview mapping.', data: previewJson?.data })
        return
      }

      setPreview(previewJson.data)
      setUploadResult({ success: true, message: 'Preview ready. Review and confirm to upsert.' })
    } catch (error) {
      setUploadResult({ success: false, message: 'Network error. Please check your connection and try again.' })
    } finally {
      setIsUploading(false)
    }
  }

  const handleConfirm = async () => {
    if (!file || !preview) return
    if (dataSourceConflict?.exists) {
      setUploadResult({ success: false, message: `This file has already been processed (${dataSourceConflict.data_source}). Delete it first to reprocess.` })
      return
    }
    if (!selectedGender) {
      setUploadResult({ success: false, message: 'Please select a gender before upserting.' })
      return
    }
    setIsConfirming(true)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('mapping', JSON.stringify(preview.mapping))
      if (selectedGender) formData.append('gender', selectedGender)
      if (selectedAgencyId != null) formData.append('agency_id', String(selectedAgencyId))

      const resp = await fetch('/api/ingest/upsert', {
        method: 'POST',
        body: formData,
      })
      const json = await resp.json()
      if (resp.status === 409) {
        setDataSourceConflict({ exists: true, data_source: (json?.data?.data_source || file.name) })
      }
      setUploadResult({
        success: json?.success ?? false,
        message: json?.message || (json?.success ? 'Upsert complete.' : 'Upsert failed.'),
        data: json?.data
      })

      const idsAll = Array.isArray(json?.data?.allModelIds)
        ? json.data.allModelIds
        : Array.isArray(json?.data?.modelIds)
        ? json.data.modelIds
        : []
      if (json?.success && idsAll.length) {
        setPendingModelIds(idsAll)
        setShowCvPrompt(true)
      }
    } catch (e) {
      setUploadResult({ success: false, message: 'Upsert failed due to network or server error.' })
    } finally {
      setIsConfirming(false)
    }
  }

  const runCvInference = useCallback(async () => {
    if (!pendingModelIds.length) return
    setIsInferring(true)
    setInferenceLogs([])
    cancelCvRef.current = false

    console.log('[cv-infer] starting batch for', pendingModelIds.length, 'models')

    for (const id of pendingModelIds) {
      if (cancelCvRef.current) break
      try {
        const controller = new AbortController()
        abortControllerRef.current = controller
        console.log('[cv-infer] requesting for model', id)
        const resp = await fetch('/api/ingest/cv-infer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model_id: id }),
          signal: controller.signal,
        })
        const json = await resp.json()
        console.log('[cv-infer] response for model', id, 'status', resp.status, 'payload', json)
        setInferenceLogs((prev) => [
          ...prev,
          {
            modelId: id,
            success: json?.success ?? resp.ok,
            status: json?.status ?? resp.status,
            data: json?.data ?? null,
          },
        ])
      } catch (e: any) {
        const aborted = e?.name === 'AbortError'
        console.error('[cv-infer] error for model', id, aborted ? '(aborted)' : e)
        setInferenceLogs((prev) => [
          ...prev,
          { modelId: id, success: false, status: 0, data: { error: aborted ? 'aborted' : (e?.message || 'network error') } },
        ])
        if (cancelCvRef.current) break
      } finally {
        abortControllerRef.current = null
      }
    }

    console.log('[cv-infer] finished batch')
    setIsInferring(false)
  }, [pendingModelIds])

  const cancelCvInference = useCallback(() => {
    cancelCvRef.current = true
    try {
      abortControllerRef.current?.abort()
    } catch {}
  }, [])

  const handleRegenerate = async () => {
    if (!file) return
    setIsRegenerating(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      if (selectedGender) formData.append('gender', selectedGender)
      if (feedback) formData.append('feedback', feedback)
      if (preview?.mapping) formData.append('previous_mapping', JSON.stringify(preview.mapping))

      const resp = await fetch('/api/ingest/preview', { method: 'POST', body: formData })
      const json = await resp.json()
      if (!resp.ok || !json?.success) {
        setUploadResult({ success: false, message: json?.message || 'Failed to regenerate mapping', data: json?.data })
        return
      }
      setPreview(json.data)
      setUploadResult({ success: true, message: 'Mapping regenerated using your feedback.' })
    } catch (e) {
      setUploadResult({ success: false, message: 'Network error during regeneration.' })
    } finally {
      setIsRegenerating(false)
    }
  }

  const handlePurgeDataSource = useCallback(async () => {
    if (!file && !dataSourceConflict?.data_source) return
    const name = (file?.name || dataSourceConflict?.data_source) as string
    if (!name) return
    setIsDeletingSource(true)
    setDeleteError(null)
    try {
      const resp = await fetch('/api/ingest/delete-by-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_source: name })
      })
      const json = await resp.json()
      if (!resp.ok || !json?.success) {
        setDeleteError(json?.message || 'Failed to delete records for this data source.')
        return
      }
      // After delete, clear conflict and recheck
      setDataSourceConflict(null)
      if (file) await checkDataSource(file)
      setUploadResult({ success: true, message: json?.message || `Deleted records for ${name}. You may proceed.` })
    } catch (e) {
      setDeleteError('Network error while deleting data.')
    } finally {
      setIsDeletingSource(false)
    }
  }, [file, dataSourceConflict, checkDataSource])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            AIDA Ingest Console
          </h1>
          <p className="text-gray-600">
            Upload your CSV file for AI model processing
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-xl p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* File Upload Section */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                CSV File
              </label>
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                  isDragOver
                    ? 'border-blue-400 bg-blue-50'
                    : file
                    ? 'border-green-400 bg-green-50'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileInput}
                  className="hidden"
                  id="file-upload"
                />
                <label htmlFor="file-upload" className="cursor-pointer">
                  {file ? (
                    <div className="flex items-center justify-center space-x-2">
                      <CheckCircle className="h-8 w-8 text-green-500" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {file.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {(file.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center space-y-2">
                      <Upload className="h-8 w-8 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          Drop your CSV file here
                        </p>
                        <p className="text-xs text-gray-500">
                          or click to browse
                        </p>
                      </div>
                    </div>
                  )}
                </label>
              </div>
            </div>

            {/* New: Data source conflict warning */}
            {dataSourceConflict?.exists && (
              <div className="p-4 rounded-md border border-red-300 bg-red-50">
                <div className="text-sm text-red-800 font-semibold">This file was already processed.</div>
                <div className="text-xs text-red-700 mt-1">
                  Data for <span className="font-mono">{dataSourceConflict.data_source}</span> already exists in the database. To reprocess, you must delete all existing records for this data source. This action is destructive and cannot be undone.
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={handlePurgeDataSource}
                    disabled={isDeletingSource}
                    className="w-full py-2 px-4 rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                  >
                    {isDeletingSource ? 'Deleting…' : 'Delete all data for this file'}
                  </button>
                  {deleteError && (
                    <div className="text-xs text-red-700">{deleteError}</div>
                  )}
                </div>
              </div>
            )}

            {/* Agency selection step */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">Select Agency</label>
                <button
                  type="button"
                  onClick={handleSuggestAgencies}
                  disabled={!file || isSuggestingAgency}
                  className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
                >
                  {isSuggestingAgency ? 'Finding suggestions…' : 'Suggest from CSV'}
                </button>
              </div>

              {agencySuggestions && (
                <div className="space-y-2">
                  {agencySuggestions.length === 0 && (
                    <div className="text-xs text-gray-500">No close matches found.</div>
                  )}
                  {agencySuggestions.map((a) => (
                    <label key={a.id} className="flex items-start space-x-3 p-3 border rounded-md hover:bg-gray-50">
                      <input
                        type="radio"
                        name="agency"
                        value={a.id}
                        checked={selectedAgencyId === a.id}
                        onChange={() => setSelectedAgencyId(a.id)}
                      />
                      <div className="text-sm">
                        <div className="font-medium text-gray-900">{a.name}</div>
                        <div className="text-gray-600 text-xs">
                          {[a.city, a.country, a.continent].filter(Boolean).join(' • ')}
                        </div>
                        {a.website && (
                          <div className="text-xs text-blue-600 flex items-center space-x-1">
                            <Globe className="w-3 h-3" />
                            <span>{a.website}</span>
                          </div>
                        )}
                        <div className="text-[10px] text-gray-500">match score {(a.score ?? 0).toFixed(2)}</div>
                      </div>
                    </label>
                  ))}
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!proposedAgency) setProposedAgency({ name: '', country: '', city: '', continent: '', website: '' })
                        setShowAgencyCreateForm(true)
                      }}
                      className="inline-flex items-center text-xs text-green-700 hover:text-green-900"
                    >
                      <Plus className="w-4 h-4 mr-1" /> Create New Agency
                    </button>
                  </div>
                </div>
              )}

              {/* Proposed new agency (hidden until explicitly requested) */}
              {showAgencyCreateForm && proposedAgency && (
                <div className="mt-2 p-3 border rounded-md">
                  <div className="text-xs text-gray-500 mb-1">Proposed from CSV</div>
                  <div className="grid grid-cols-1 gap-2 text-sm">
                    <div>
                      <div className="text-gray-700">Name</div>
                      <input
                        className="mt-1 w-full border rounded px-2 py-1 text-sm"
                        value={proposedAgency.name || ''}
                        onChange={(e) => setProposedAgency({ ...proposedAgency, name: e.target.value })}
                        placeholder="Agency name"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-gray-700">Country</div>
                        <input
                          className="mt-1 w-full border rounded px-2 py-1 text-sm"
                          value={proposedAgency.country || ''}
                          onChange={(e) => setProposedAgency({ ...proposedAgency, country: e.target.value })}
                          placeholder="Country"
                        />
                      </div>
                      <div>
                        <div className="text-gray-700">City</div>
                        <input
                          className="mt-1 w-full border rounded px-2 py-1 text-sm"
                          value={proposedAgency.city || ''}
                          onChange={(e) => setProposedAgency({ ...proposedAgency, city: e.target.value })}
                          placeholder="City"
                        />
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-700">Continent</div>
                      <input
                        className="mt-1 w-full border rounded px-2 py-1 text-sm"
                        value={proposedAgency.continent || ''}
                        onChange={(e) => setProposedAgency({ ...proposedAgency, continent: e.target.value })}
                        placeholder="Continent"
                      />
                    </div>
                    <div>
                      <div className="text-gray-700">Website</div>
                      <input
                        className="mt-1 w-full border rounded px-2 py-1 text-sm"
                        value={proposedAgency.website || ''}
                        onChange={(e) => setProposedAgency({ ...proposedAgency, website: e.target.value })}
                        placeholder="https://example.com"
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={handleCreateAgency}
                      disabled={creatingAgency || !proposedAgency.name}
                      className="inline-flex items-center text-xs text-green-700 hover:text-green-900"
                    >
                      <Plus className="w-4 h-4 mr-1" /> Create & Select Agency
                    </button>
                    {createAgencyError && (
                      <div className="text-xs text-red-600">{createAgencyError}</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Gender selection */}
            {selectedGender && !showGenderPicker ? (
              <div className="space-y-2 mt-4">
                <div className="text-sm text-gray-700">
                  Gender: <span className="font-medium">{selectedGender}</span>
                  <button
                    type="button"
                    onClick={() => setShowGenderPicker(true)}
                    className="ml-2 text-xs text-blue-600 hover:text-blue-800"
                  >
                    Change
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 mt-4">
                <label className="block text-sm font-medium text-gray-700">Gender</label>
                <select
                  className="w-full border rounded px-2 py-2 text-sm"
                  value={selectedGender || ''}
                  onChange={(e) => {
                    const v = e.target.value || null
                    setSelectedGender(v)
                    if (v) setShowGenderPicker(false)
                  }}
                >
                  <option value="">Select gender…</option>
                  <option value="female">female</option>
                  <option value="male">male</option>
                  <option value="transgender">transgender</option>
                  <option value="non-binary">non-binary</option>
                  <option value="transman">transman</option>
                  <option value="transwoman">transwoman</option>
                </select>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isUploading || !file}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploading ? (
                <>
                  <Loader2 className="animate-spin -ml-1 mr-3 h-5 w-5" />
                  Processing...
                </>
              ) : (
                <>
                  <FileText className="-ml-1 mr-3 h-5 w-5" />
                  Upload & Prepare Preview
                </>
              )}
            </button>
          </form>

          {/* Preview and Confirm */}
          {preview && (
            <div className="mt-6 p-4 rounded-md bg-blue-50 border border-blue-200">
              <div className="flex items-center">
                <CheckCircle className="h-5 w-5 text-blue-400" />
                <p className="ml-3 text-sm font-medium text-blue-800">
                  Mapping proposed. Review a few transformed rows below and confirm to upsert.
                </p>
              </div>
              <div className="mt-3 text-xs text-blue-900">
                {preview.inferred && (
                  <div className="mb-2">
                    <div>Inferred gender: <span className="font-semibold">{preview.inferred.gender}</span></div>
                    <div>Inferred model board: <span className="font-semibold">{preview.inferred.model_board_category || 'none'}</span></div>
                  </div>
                )}
                <pre className="whitespace-pre-wrap">
                  {JSON.stringify(preview.samplePreview, null, 2)}
                </pre>
              </div>

              {/* Feedback box and regenerate */}
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Feedback to improve the mapping</label>
                <textarea
                  className="w-full border rounded px-2 py-2 text-sm"
                  rows={4}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Example: Height mapped from 'height' is inches not cm; use toCentimeters. Also map 'instagram' to models_media.link."
                />
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={isRegenerating || !file}
                  className="mt-2 w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isRegenerating ? 'Regenerating…' : 'Regenerate mapping'}
                </button>
              </div>

              <button
                onClick={handleConfirm}
                disabled={isConfirming || selectedAgencyId == null}
                className="mt-4 w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
              >
                {isConfirming ? 'Upserting...' : 'Confirm and Upsert'}
              </button>
            </div>
          )}

          {/* Result Display */}
          {uploadResult && (
            <div className={`mt-6 p-4 rounded-md ${
              uploadResult.success
                ? 'bg-green-50 border border-green-200'
                : 'bg-red-50 border border-red-200'
            }`}>
              <div className="flex items-center">
                {uploadResult.success ? (
                  <CheckCircle className="h-5 w-5 text-green-400" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-red-400" />
                )}
                <p className={`ml-3 text-sm font-medium ${
                  uploadResult.success ? 'text-green-800' : 'text-red-800'
                }`}>
                  {uploadResult.message}
                </p>
              </div>
              {(() => {
                if (!uploadResult.data) return null
                // Hide modelIds on success
                const dataToShow = uploadResult.success
                  ? (() => {
                      const { modelIds, ...rest } = uploadResult.data || {}
                      return Object.keys(rest || {}).length ? rest : null
                    })()
                  : uploadResult.data
                if (!dataToShow) return null
                return (
                  <div className="mt-3 text-xs">
                    <pre className="whitespace-pre-wrap">
                      {JSON.stringify(dataToShow, null, 2)}
                    </pre>
                  </div>
                )
              })()}
              {(() => {
                const twins = Array.isArray(uploadResult.data?.potentialTwins) ? uploadResult.data.potentialTwins : []
                if (!twins.length) return null
                return (
                  <div className="mt-4 text-xs">
                    <div className="font-semibold text-gray-800">Potential twins</div>
                    <div className="mt-2 space-y-2">
                      {twins.map((t: any, idx: number) => {
                        const candidates = Array.isArray(t?.potential_twins?.candidate_model_ids) ? t.potential_twins.candidate_model_ids : []
                        return (
                          <div key={`${t?.modelId ?? idx}`} className="p-2 rounded border border-blue-200 bg-blue-50">
                            <div className="font-medium text-blue-900">
                              model_id {String(t?.modelId ?? 'unknown')} • group {String(t?.potential_twins?.group_id ?? 'n/a')}
                            </div>
                            <div className="text-blue-800">
                              Candidates: {candidates.length ? candidates.join(', ') : 'none'}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* CV inference prompt */}
          {showCvPrompt && pendingModelIds.length > 0 && !isInferring && (
            <div className="mt-6 p-4 rounded-md bg-yellow-50 border border-yellow-200">
              <div className="text-sm text-yellow-800">
                Upsert completed. Proceed to CV inference for {pendingModelIds.length} models?
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCvPrompt(false)
                    runCvInference()
                  }}
                  className="w-full py-2 px-4 rounded-md text-sm font-medium text-white bg-yellow-600 hover:bg-yellow-700"
                >
                  Yes, start CV inference
                </button>
                <button
                  type="button"
                  onClick={() => setShowCvPrompt(false)}
                  className="w-full py-2 px-4 rounded-md text-sm font-medium text-yellow-700 bg-yellow-100 hover:bg-yellow-200"
                >
                  No, not now
                </button>
              </div>
            </div>
          )}

          {/* CV inference progress and logs */}
          {isInferring && (
            <div className="mt-6 p-4 rounded-md bg-indigo-50 border border-indigo-200">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-indigo-800">
                  Running CV inference ({inferenceLogs.length}/{pendingModelIds.length})
                </div>
                <button
                  type="button"
                  onClick={cancelCvInference}
                  className="text-xs text-indigo-700 hover:text-indigo-900"
                >
                  Cancel
                </button>
              </div>
              <div className="mt-2 flex items-center text-xs text-indigo-700">
                <Loader2 className="animate-spin h-4 w-4 mr-2" /> Processing...
              </div>
              <div className="mt-3 max-h-64 overflow-auto text-xs">
                {inferenceLogs.map((log) => (
                  <div key={`${log.modelId}`} className={`mb-2 p-2 rounded border ${log.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                    <div className="font-semibold">model_id {String(log.modelId)} • status {log.status} • {log.success ? 'success' : 'failed'}</div>
                    <pre className="whitespace-pre-wrap mt-1">
                      {JSON.stringify(log.data, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
} 