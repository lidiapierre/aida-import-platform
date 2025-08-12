'use client'

import { useState, useCallback } from 'react'
import { Upload, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

interface UploadResponse {
  success: boolean
  message: string
  data?: any
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null)
  const [gender, setGender] = useState('')
  const [modelBoard, setModelBoard] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [preview, setPreview] = useState<any | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)

  const handleFileSelect = useCallback((selectedFile: File) => {
    if (selectedFile.type === 'text/csv' || selectedFile.name.endsWith('.csv')) {
      setFile(selectedFile)
      setUploadResult(null)
      setPreview(null)
    } else {
      setUploadResult({
        success: false,
        message: 'Please select a valid CSV file'
      })
    }
  }, [])

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!file || !gender) {
      setUploadResult({
        success: false,
        message: 'Please select a CSV file and choose a gender'
      })
      return
    }

    setIsUploading(true)
    setUploadResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('gender', gender)
      if (modelBoard) {
        formData.append('model_board', modelBoard)
      }

      // Step 1: ask server to parse a sample and get agent-proposed mapping preview
      const previewResp = await fetch('/api/ingest/preview', {
        method: 'POST',
        body: formData,
      })

      const previewJson = await previewResp.json()

      if (!previewResp.ok || !previewJson?.success) {
        setUploadResult({
          success: false,
          message: previewJson?.message || 'Failed to prepare preview mapping.',
          data: previewJson?.data
        })
        return
      }

      setPreview(previewJson.data)
      setUploadResult({ success: true, message: 'Preview ready. Review and confirm to upsert.' })
    } catch (error) {
      setUploadResult({
        success: false,
        message: 'Network error. Please check your connection and try again.'
      })
    } finally {
      setIsUploading(false)
    }
  }

  const handleConfirm = async () => {
    if (!file || !gender || !preview) return
    setIsConfirming(true)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('gender', gender)
      if (modelBoard) {
        formData.append('model_board', modelBoard)
      }
      formData.append('mapping', JSON.stringify(preview.mapping))

      const resp = await fetch('/api/ingest/upsert', {
        method: 'POST',
        body: formData,
      })
      const json = await resp.json()

      setUploadResult({
        success: json?.success ?? false,
        message: json?.message || (json?.success ? 'Upsert complete.' : 'Upsert failed.'),
        data: json?.data
      })
    } catch (e) {
      setUploadResult({ success: false, message: 'Upsert failed due to network or server error.' })
    } finally {
      setIsConfirming(false)
    }
  }

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

            {/* Gender Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Gender
              </label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              >
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="transgender">Transgender</option>
                <option value="non-binary">Non-binary</option>
                <option value="transman">Transman</option>
                <option value="transwoman">Transwoman</option>
              </select>
            </div>

            {/* Model Board Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Model Board
              </label>
              <select
                value={modelBoard}
                onChange={(e) => setModelBoard(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select model board (optional)</option>
                <option value="image">Image</option>
                <option value="mainboard">Mainboard</option>
                <option value="a_new_face">A New Face</option>
                <option value="development">Development</option>
                <option value="non_binary_aka_x_division">Non Binary AKA X Division</option>
                <option value="direct">Direct</option>
                <option value="youth">Youth</option>
                <option value="classic">Classic</option>
                <option value="timeless">Timeless</option>
                <option value="curve">Curve</option>
                <option value="teen">Teen</option>
                <option value="commercial">Commercial</option>
                <option value="preview">Preview</option>
                <option value="verve">Verve</option>
                <option value="big_and_tall">Big and Tall</option>
                <option value="a_family">A Family</option>
                <option value="couples">Couples</option>
                <option value="petite">Petite</option>
                <option value="lifestyle">Lifestyle</option>
                <option value="fit">Fit</option>
                <option value="runway">Runway</option>
                <option value="streetcast">Streetcast</option>
                <option value="elite">Elite</option>
                <option value="premier">Premier</option>
              </select>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isUploading || !file || !gender}
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
                <pre className="whitespace-pre-wrap">
                  {JSON.stringify(preview.samplePreview, null, 2)}
                </pre>
              </div>
              <button
                onClick={handleConfirm}
                disabled={isConfirming}
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
              {!uploadResult.success && uploadResult.data && (
                <div className="mt-3 text-xs">
                  <pre className="whitespace-pre-wrap">
                    {JSON.stringify(uploadResult.data, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
} 