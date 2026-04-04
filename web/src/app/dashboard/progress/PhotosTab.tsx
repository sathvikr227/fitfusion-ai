"use client"

import { useEffect, useRef, useState } from "react"
import { Camera, Trash2, Upload, X } from "lucide-react"
import { supabase } from "../../../lib/supabase/client"

type Photo = {
  name: string
  url: string
}

export default function PhotosTab() {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)
      await loadPhotos(user.id)
    }
    load()
  }, [])

  const loadPhotos = async (uid: string) => {
    setLoading(true)
    const { data, error: listError } = await supabase.storage
      .from("progress-photos")
      .list(`${uid}/`, { sortBy: { column: "created_at", order: "desc" } })

    if (listError) {
      setError(
        "Could not load photos. Make sure the 'progress-photos' storage bucket exists in Supabase."
      )
      setLoading(false)
      return
    }

    const list = (data ?? [])
      .filter((f) => f.name !== ".emptyFolderPlaceholder")
      .map((f) => ({
        name: f.name,
        url: supabase.storage
          .from("progress-photos")
          .getPublicUrl(`${uid}/${f.name}`).data.publicUrl,
      }))

    setPhotos(list)
    setLoading(false)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setError("Only image files are supported.")
      return
    }
    setError(null)
    setSelectedFile(file)
    setPreview(URL.createObjectURL(file))
  }

  const handleUpload = async () => {
    if (!selectedFile || !userId) return
    setUploading(true)
    setError(null)

    const ext = selectedFile.name.split(".").pop() ?? "jpg"
    const path = `${userId}/${Date.now()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from("progress-photos")
      .upload(path, selectedFile)

    if (uploadError) {
      setError(uploadError.message)
      setUploading(false)
      return
    }

    setSelectedFile(null)
    setPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
    await loadPhotos(userId)
    setUploading(false)
  }

  const handleDelete = async (photoName: string) => {
    if (!userId) return
    await supabase.storage
      .from("progress-photos")
      .remove([`${userId}/${photoName}`])
    setPhotos((prev) => prev.filter((p) => p.name !== photoName))
  }

  const formatDate = (name: string) => {
    const ts = parseInt(name.split(".")[0])
    if (!isNaN(ts)) {
      return new Date(ts).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    }
    return name
  }

  return (
    <div className="space-y-6 pb-10">
      {/* Upload area */}
      <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-purple-50 via-white to-cyan-50 p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500">
            <Camera className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Progress Photos</h2>
            <p className="text-sm text-slate-500">
              Track your physical transformation over time
            </p>
          </div>
        </div>

        {preview ? (
          <div className="space-y-4">
            <div className="relative inline-block">
              <img
                src={preview}
                alt="Preview"
                className="max-h-64 rounded-2xl border border-slate-200 object-cover"
              />
              <button
                onClick={() => {
                  setPreview(null)
                  setSelectedFile(null)
                  if (fileInputRef.current) fileInputRef.current.value = ""
                }}
                className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-rose-500 text-white shadow"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-cyan-500 px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Upload className="h-4 w-4" />
              {uploading ? "Uploading..." : "Save Photo"}
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white/80 p-12 transition hover:border-purple-400 hover:bg-purple-50/30"
          >
            <Camera className="mb-3 h-8 w-8 text-slate-400" />
            <p className="text-sm font-medium text-slate-700">
              Click to upload a progress photo
            </p>
            <p className="mt-1 text-xs text-slate-400">JPG, PNG, WEBP supported</p>
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileSelect}
        />

        {error && (
          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}
      </div>

      {/* Photos grid */}
      <div>
        <p className="mb-4 text-base font-semibold text-slate-900">
          Your Photos{" "}
          {photos.length > 0 && (
            <span className="font-normal text-slate-400">({photos.length})</span>
          )}
        </p>

        {loading ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="aspect-square animate-pulse rounded-2xl bg-slate-100"
              />
            ))}
          </div>
        ) : photos.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center text-sm text-slate-500">
            No photos yet. Upload your first progress photo above.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {photos.map((photo) => (
              <div key={photo.name} className="group relative aspect-square">
                <img
                  src={photo.url}
                  alt={formatDate(photo.name)}
                  className="h-full w-full rounded-2xl border border-slate-200 object-cover"
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl bg-black/50 opacity-0 transition group-hover:opacity-100">
                  <p className="text-xs font-medium text-white">
                    {formatDate(photo.name)}
                  </p>
                  <button
                    onClick={() => handleDelete(photo.name)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-500 shadow"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-white" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
