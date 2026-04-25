"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { supabase } from "../../../lib/supabase/client"
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Flame,
  Loader2,
  Plus,
  RotateCcw,
  Scan,
  Sparkles,
  Upload,
  UtensilsCrossed,
  Wand2,
  X,
  Mic,
  MicOff,
} from "lucide-react"

type MealType = "breakfast" | "lunch" | "dinner" | "snacks"

type MacroTotals = {
  calories: number
  protein: number
  carbs: number
  fat: number
}

type FoodItem = MacroTotals & {
  id: string
  food: string
  quantity: string
  mealType: MealType
  source: "manual" | "ai-text" | "ai-image" | "assigned" | "db"
  notes?: string | null
}

type AssignedMealItem = {
  food?: string
  name?: string
  quantity?: string
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  notes?: string
}

type AssignedMeal = {
  name: string
  meal_type?: MealType
  items: AssignedMealItem[]
  target_calories?: number
  target_protein?: number
  target_carbs?: number
  target_fat?: number
}

type MealLogRow = {
  id: string
  user_id: string
  date: string
  meal_type: MealType
  total_calories: number | null
  total_protein: number | null
  total_carbs: number | null
  total_fat: number | null
  is_completed: boolean | null
}

type MealItemRow = {
  id: string
  meal_log_id: string
  food_name: string
  quantity: string | null
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
}

type NutritionAnalysisResponse = {
  food?: string
  quantity?: string
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  confidence?: number
  notes?: string
}

type BarcodeDetectorResult = {
  rawValue: string
}

type BarcodeDetectorConstructor = new (options?: {
  formats?: string[]
}) => {
  detect(source: CanvasImageSource): Promise<BarcodeDetectorResult[]>
}

const MEAL_OPTIONS: MealType[] = ["breakfast", "lunch", "dinner", "snacks"]

const mealLabel: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snacks: "Snacks",
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function asNumber(value: unknown, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return dateStr
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date)
}

function normalizeMealType(value: any, index?: number): MealType {
  const v = String(value ?? "").toLowerCase().trim()

  if (["breakfast", "lunch", "dinner", "snacks"].includes(v)) {
    return v as MealType
  }

  // fallback mapping if missing
  if (index !== undefined) {
    return MEAL_OPTIONS[index % MEAL_OPTIONS.length]
  }

  return "breakfast"
}

function normalizeAssignedDiet(raw: unknown): AssignedMeal[] {
  if (!raw) return []

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
    const meals = parsed?.diet_plan?.meals ?? parsed?.meals ?? []
    if (!Array.isArray(meals)) return []

    return meals.map((meal: any, index: number) => ({
      name: String(meal?.name ?? meal?.meal_name ?? `Meal ${index + 1}`),
      meal_type: normalizeMealType(meal?.meal_type ?? meal?.mealType, index),
      target_calories: asNumber(meal?.target_calories, 0),
      target_protein: asNumber(meal?.target_protein, 0),
      target_carbs: asNumber(meal?.target_carbs, 0),
      target_fat: asNumber(meal?.target_fat, 0),
      items: Array.isArray(meal?.items) ? meal.items : [],
    }))
  } catch {
    return []
  }
}

function ProgressBar({ value, target }: { value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0
  const barClass =
    pct >= 100 ? "bg-emerald-500" : pct >= 75 ? "bg-blue-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500"

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{pct}%</span>
        <span>
          {Math.round(value)} / {Math.round(target)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-200">
        <div className={`h-2 rounded-full ${barClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function MacroCard({ label, value, unit = "g" }: { label: string; value: number; unit?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
        {Math.round(value)}
        {unit}
      </div>
    </div>
  )
}

function StatCard({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string
  value: string
  subtitle?: string
  icon: ReactNode
}) {
  return (
    <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
          {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        <div className="rounded-2xl bg-slate-100 dark:bg-slate-700 p-3 text-slate-700 dark:text-slate-300">{icon}</div>
      </div>
    </div>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 dark:bg-slate-700 p-6 text-center">
      <p className="text-base font-semibold text-slate-900 dark:text-white">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">{description}</p>
    </div>
  )
}

export default function DietTab() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [analyzingText, setAnalyzingText] = useState(false)
  const [analyzingImage, setAnalyzingImage] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const [selectedDate, setSelectedDate] = useState(todayISO())
  const [mealType, setMealType] = useState<MealType>("breakfast")
  const [food, setFood] = useState("")
  const [quantity, setQuantity] = useState("")
  const [notes, setNotes] = useState("")
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showBarcodeModal, setShowBarcodeModal] = useState(false)
  const [barcodeInput, setBarcodeInput] = useState("")
  const [barcodeLoading, setBarcodeLoading] = useState(false)
  const [barcodeError, setBarcodeError] = useState("")
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const barcodeStreamRef = useRef<MediaStream | null>(null)
  const barcodeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [selectedFileName, setSelectedFileName] = useState("")

  const [mealItems, setMealItems] = useState<FoodItem[]>([])
  const [historyRows, setHistoryRows] = useState<MealLogRow[]>([])
  const [assignedDiet, setAssignedDiet] = useState<AssignedMeal[]>([])
  const [completedMealTypes, setCompletedMealTypes] = useState<Set<MealType>>(new Set())
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [analysisPreview, setAnalysisPreview] = useState<NutritionAnalysisResponse | null>(null)

  // Voice food logging state
  const [voiceListening, setVoiceListening] = useState(false)
  const [voiceTranscript, setVoiceTranscript] = useState("")
  const [voiceLogging, setVoiceLogging] = useState(false)
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true)
        const { data: auth } = await supabase.auth.getUser()
        const uid = auth?.user?.id
        if (!uid) {
          setError("Please sign in to use Diet tracking.")
          return
        }

        setUserId(uid)
        await Promise.all([loadAssignedDiet(uid), loadTodayDiet(uid, selectedDate)])
      } catch (e: any) {
        setError(e?.message ?? "Failed to load diet tab.")
      } finally {
        setLoading(false)
      }
    }

    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!userId) return
    void loadTodayDiet(userId, selectedDate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate])

  const totals = useMemo(() => {
    return mealItems.reduce<MacroTotals>(
      (acc, item) => {
        acc.calories += asNumber(item.calories)
        acc.protein += asNumber(item.protein)
        acc.carbs += asNumber(item.carbs)
        acc.fat += asNumber(item.fat)
        return acc
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    )
  }, [mealItems])

  const assignedTotals = useMemo(() => {
    return assignedDiet.reduce<MacroTotals>(
      (acc, meal) => {
        meal.items.forEach((item) => {
          acc.calories += asNumber(item.calories)
          acc.protein += asNumber(item.protein)
          acc.carbs += asNumber(item.carbs)
          acc.fat += asNumber(item.fat)
        })
        return acc
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    )
  }, [assignedDiet])

  const targetTotals = useMemo(() => {
    return {
      calories: Math.max(assignedTotals.calories, 2000),
      protein: Math.max(assignedTotals.protein, 120),
      carbs: Math.max(assignedTotals.carbs, 180),
      fat: Math.max(assignedTotals.fat, 50),
    }
  }, [assignedTotals])

  const completionPct = useMemo(() => {
    if (!targetTotals.calories) return 0
    return Math.min(100, Math.round((totals.calories / targetTotals.calories) * 100))
  }, [targetTotals.calories, totals.calories])

  const plannedOrLoggedCalories =
    assignedTotals.calories > 0 && totals.calories === 0 ? assignedTotals.calories : totals.calories
  const plannedOrLoggedProtein =
    assignedTotals.protein > 0 && totals.protein === 0 ? assignedTotals.protein : totals.protein
  const plannedOrLoggedCarbs = assignedTotals.carbs > 0 && totals.carbs === 0 ? assignedTotals.carbs : totals.carbs
  const plannedOrLoggedFat = assignedTotals.fat > 0 && totals.fat === 0 ? assignedTotals.fat : totals.fat

  const recentItems = [...mealItems].slice(0, 6)

  async function loadAssignedDiet(uid: string) {
    const { data, error } = await supabase
      .from("workout_plans")
      .select("plan")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      setError(error.message)
      return
    }

    setAssignedDiet(normalizeAssignedDiet(data?.plan))
  }

  async function loadTodayDiet(uid: string, date: string) {
    setSyncing(true)
    try {
      const { data: logs, error: logsError } = await supabase
        .from("meal_logs")
        .select("id,user_id,date,meal_type,total_calories,total_protein,total_carbs,total_fat,is_completed")
        .eq("user_id", uid)
        .eq("date", date)
        .order("created_at", { ascending: true })

      if (logsError) throw logsError

      const rows = (logs ?? []) as MealLogRow[]
      setHistoryRows(rows)
      setCompletedMealTypes(new Set(rows.filter((row) => Boolean(row.is_completed)).map((row) => row.meal_type)))

      if (rows.length === 0) {
        setMealItems([])
        return
      }

      const logIds = rows.map((row) => row.id)
      const { data: items, error: itemsError } = await supabase
        .from("meal_items")
        .select("id,meal_log_id,food_name,quantity,calories,protein,carbs,fat")
        .in("meal_log_id", logIds)

      if (itemsError) throw itemsError

      const itemRows = (items ?? []) as MealItemRow[]
      const rowMap = new Map(rows.map((row) => [row.id, row]))

      const mapped: FoodItem[] = itemRows.map((item, index) => {
        const parent = rowMap.get(item.meal_log_id)
        return {
          id: item.id ?? `${item.meal_log_id}-${index}`,
          food: item.food_name,
          quantity: item.quantity ?? "1 serving",
          mealType: parent?.meal_type ?? "breakfast",
          source: "db",
          calories: asNumber(item.calories),
          protein: asNumber(item.protein),
          carbs: asNumber(item.carbs),
          fat: asNumber(item.fat),
          notes: parent?.is_completed ? "Saved and completed" : "Saved",
        }
      })

      setMealItems(mapped)
    } catch (e: any) {
      setError(e?.message ?? "Failed to load today's diet.")
    } finally {
      setSyncing(false)
    }
  }

  function resetComposer() {
    setFood("")
    setQuantity("")
    setNotes("")
    setAnalysisPreview(null)
    setSelectedFileName("")
  }

  function addItem(item: Omit<FoodItem, "id">) {
    setMealItems((prev) => [{ ...item, id: uid() }, ...prev])
    setMessage(`${item.food} added to ${mealLabel[item.mealType]}.`)
    setError("")
    resetComposer()
  }

  async function lookupBarcode(code: string) {
    if (!code.trim()) {
      setBarcodeError("Enter a barcode number.")
      return
    }
    setBarcodeLoading(true)
    setBarcodeError("")
    try {
      const res = await fetch("/api/food-db/barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode: code.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setBarcodeError(data.error ?? "Product not found.")
        return
      }
      closeBarcodeModal()
      addItem({
        food: data.food,
        quantity: data.quantity,
        mealType,
        source: "db",
        calories: asNumber(data.calories),
        protein: asNumber(data.protein),
        carbs: asNumber(data.carbs),
        fat: asNumber(data.fat),
        notes: "From barcode scan",
      })
    } catch {
      setBarcodeError("Network error. Try again.")
    } finally {
      setBarcodeLoading(false)
    }
  }

  function closeBarcodeModal() {
    setShowBarcodeModal(false)
    setBarcodeInput("")
    setBarcodeError("")
    setBarcodeLoading(false)
    if (barcodeIntervalRef.current) {
      clearInterval(barcodeIntervalRef.current)
      barcodeIntervalRef.current = null
    }
    if (barcodeStreamRef.current) {
      barcodeStreamRef.current.getTracks().forEach((t) => t.stop())
      barcodeStreamRef.current = null
    }
  }

  async function startCameraScanner() {
    setBarcodeError("")
    try {
      const BarcodeDetectorCtor = (window as Window & {
        BarcodeDetector?: BarcodeDetectorConstructor
      }).BarcodeDetector

      if (!BarcodeDetectorCtor) {
        setBarcodeError("Camera scanning not supported in this browser. Enter the barcode number manually below.")
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
      barcodeStreamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
      }
      const detector = new BarcodeDetectorCtor({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"] })
      barcodeIntervalRef.current = setInterval(async () => {
        if (!videoRef.current) return
        try {
          const results = await detector.detect(videoRef.current)
          if (results.length > 0) {
            const code = results[0].rawValue
            clearInterval(barcodeIntervalRef.current!)
            barcodeIntervalRef.current = null
            if (barcodeStreamRef.current) {
              barcodeStreamRef.current.getTracks().forEach((t) => t.stop())
              barcodeStreamRef.current = null
            }
            setBarcodeInput(code)
            lookupBarcode(code)
          }
        } catch {
          // frame not ready yet
        }
      }, 400)
    } catch {
      setBarcodeError("Camera access denied. Enter the barcode number manually below.")
    }
  }

  async function analyzeFoodText() {
    if (!food.trim()) {
      setError("Enter a food name first.")
      return
    }

    try {
      setAnalyzingText(true)
      setError("")
      setMessage("")

      const dbRes = await fetch("/api/food-db", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          food: food.trim(),
        }),
      })

      if (dbRes.ok) {
        const dbData = await dbRes.json()
        setAnalysisPreview(dbData)

        addItem({
          food: dbData.food ?? food.trim(),
          quantity: quantity.trim() || dbData.quantity || "1 serving",
          mealType,
          source: "db",
          calories: asNumber(dbData.calories),
          protein: asNumber(dbData.protein),
          carbs: asNumber(dbData.carbs),
          fat: asNumber(dbData.fat),
          notes: "From food database",
        })

        return
      }

      const aiRes = await fetch("/api/analyze-food-text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          food: food.trim(),
          quantity: quantity.trim(),
          mealType,
        }),
      })

      if (!aiRes.ok) {
        throw new Error("Both DB and AI failed.")
      }

      const aiData = await aiRes.json()
      setAnalysisPreview(aiData)

      addItem({
        food: aiData.food ?? food.trim(),
        quantity: aiData.quantity ?? (quantity.trim() || "1 serving"),
        mealType,
        source: "ai-text",
        calories: asNumber(aiData.calories),
        protein: asNumber(aiData.protein),
        carbs: asNumber(aiData.carbs),
        fat: asNumber(aiData.fat),
        notes: aiData.notes ?? "AI estimated",
      })
    } catch (e: any) {
      setError(e?.message ?? "Failed to analyze food.")
    } finally {
      setAnalyzingText(false)
    }
  }

  async function handleImageUpload(file: File) {
    try {
      setAnalyzingImage(true)
      setError("")
      setMessage("")
      setSelectedFileName(file.name)

      const reader = new FileReader()
      reader.onloadend = async () => {
        try {
          const image = String(reader.result ?? "")
          if (!image) {
            throw new Error("Could not read image file.")
          }

          const res = await fetch("/api/analyze-food", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              image,
              mealType,
            }),
          })

          if (!res.ok) throw new Error(`Image analysis failed (${res.status}).`)

          const data = (await res.json()) as NutritionAnalysisResponse
          setAnalysisPreview(data)

          addItem({
            food: data.food ?? file.name.replace(/\.[^.]+$/, ""),
            quantity: data.quantity ?? "1 image serving",
            mealType,
            source: "ai-image",
            calories: asNumber(data.calories),
            protein: asNumber(data.protein),
            carbs: asNumber(data.carbs),
            fat: asNumber(data.fat),
            notes: data.notes ?? "Detected from image",
          })
        } catch (e: any) {
          setError(e?.message ?? "Failed to analyze image.")
        } finally {
          setAnalyzingImage(false)
        }
      }

      reader.readAsDataURL(file)
    } catch (e: any) {
      setAnalyzingImage(false)
      setError(e?.message ?? "Failed to read image.")
    }
  }

  function startVoiceLog() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError("Voice recognition not supported in this browser.")
      return
    }
    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = "en-US"
    recognitionRef.current = recognition

    recognition.onstart = () => setVoiceListening(true)
    recognition.onend = () => setVoiceListening(false)
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript
      setVoiceTranscript(transcript)
      submitVoiceLog(transcript)
    }
    recognition.onerror = () => {
      setVoiceListening(false)
      setError("Voice recognition error. Try again.")
    }
    recognition.start()
  }

  async function submitVoiceLog(transcript: string) {
    if (!transcript || !userId) return
    setVoiceLogging(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch("/api/voice-food-log", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ transcript, date: selectedDate, mealType }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed")
      setMessage(`✓ Logged via voice: ${data.description} (${data.calories} kcal)`)
      // Refresh history
      const today = selectedDate
      const histRes = await supabase
        .from("meal_logs")
        .select("*")
        .eq("user_id", userId)
        .eq("date", today)
        .order("created_at", { ascending: false })
      if (histRes.data) setHistoryRows(histRes.data as any)
    } catch (err: any) {
      setError(err.message || "Voice log failed")
    } finally {
      setVoiceLogging(false)
    }
  }

  function addManualItem() {
    if (!food.trim()) {
      setError("Food name is required.")
      return
    }

    addItem({
      food: food.trim(),
      quantity: quantity.trim() || "1 serving",
      mealType,
      source: "manual",
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      notes: notes.trim() || null,
    })
  }

  async function saveDiet() {
    if (!userId) return
    if (mealItems.length === 0) {
      setError("Add at least one food item before saving.")
      return
    }

    try {
      setSaving(true)
      setError("")
      setMessage("")

      const grouped = MEAL_OPTIONS.map((type) => ({
        mealType: type,
        items: mealItems.filter((item) => item.mealType === type),
      })).filter((g) => g.items.length > 0)

      for (const group of grouped) {
        const totals = group.items.reduce<MacroTotals>(
          (acc, item) => {
            acc.calories += asNumber(item.calories)
            acc.protein += asNumber(item.protein)
            acc.carbs += asNumber(item.carbs)
            acc.fat += asNumber(item.fat)
            return acc
          },
          { calories: 0, protein: 0, carbs: 0, fat: 0 }
        )

        const { data: existingLog, error: existingError } = await supabase
          .from("meal_logs")
          .select("id")
          .eq("user_id", userId)
          .eq("date", selectedDate)
          .eq("meal_type", group.mealType)
          .maybeSingle()

        if (existingError) throw existingError

        let mealLogId = existingLog?.id

        if (!mealLogId) {
          const { data, error } = await supabase
            .from("meal_logs")
            .insert({
              user_id: userId,
              date: selectedDate,
              meal_type: group.mealType,
              total_calories: Math.round(totals.calories),
              total_protein: Math.round(totals.protein),
              total_carbs: Math.round(totals.carbs),
              total_fat: Math.round(totals.fat),
              is_completed: true,
            })
            .select("id")
            .single()

          if (error) throw error
          mealLogId = data.id
        } else {
          const { error: updateError } = await supabase
            .from("meal_logs")
            .update({
              total_calories: Math.round(totals.calories),
              total_protein: Math.round(totals.protein),
              total_carbs: Math.round(totals.carbs),
              total_fat: Math.round(totals.fat),
              is_completed: true,
            })
            .eq("id", mealLogId)

          if (updateError) throw updateError

          const { error: deleteError } = await supabase.from("meal_items").delete().eq("meal_log_id", mealLogId)

          if (deleteError) throw deleteError
        }

        const { error: itemError } = await supabase.from("meal_items").insert(
          group.items.map((item) => ({
            meal_log_id: mealLogId,
            food_name: item.food,
            quantity: item.quantity,
            calories: Math.round(asNumber(item.calories)),
            protein: Math.round(asNumber(item.protein)),
            carbs: Math.round(asNumber(item.carbs)),
            fat: Math.round(asNumber(item.fat)),
          }))
        )

        if (itemError) throw itemError
      }

      await loadTodayDiet(userId, selectedDate)
      setMessage("Diet saved successfully ✅")
      resetComposer()
    } catch (e: any) {
      setError(e?.message ?? "Failed to save diet.")
    } finally {
      setSaving(false)
    }
  }

  async function markAssignedMealCompleted(mealTypeToMark: MealType) {
    if (!userId) return

    try {
      setSyncing(true)
      setError("")
      setMessage("")

      if (completedMealTypes.has(mealTypeToMark)) {
        setMessage(`${mealLabel[mealTypeToMark]} is already completed.`)
        return
      }

      const assignedMeal = assignedDiet.find((m) => normalizeMealType(m.meal_type) === mealTypeToMark)
      const items = assignedMeal?.items ?? []
      if (items.length === 0) {
        setError(`No assigned meal found for ${mealLabel[mealTypeToMark]}.`)
        return
      }

      const existingLog = historyRows.find((row) => row.meal_type === mealTypeToMark)

      let mealLogId = existingLog?.id ?? ""

      if (!existingLog) {
        const totals = items.reduce<MacroTotals>(
          (acc, item) => {
            acc.calories += asNumber(item.calories)
            acc.protein += asNumber(item.protein)
            acc.carbs += asNumber(item.carbs)
            acc.fat += asNumber(item.fat)
            return acc
          },
          { calories: 0, protein: 0, carbs: 0, fat: 0 }
        )

        const { data: logRow, error: logError } = await supabase
          .from("meal_logs")
          .insert({
            user_id: userId,
            date: selectedDate,
            meal_type: mealTypeToMark,
            total_calories: Math.round(totals.calories),
            total_protein: Math.round(totals.protein),
            total_carbs: Math.round(totals.carbs),
            total_fat: Math.round(totals.fat),
            is_completed: true,
          })
          .select("id")
          .single()

        if (logError) throw logError
        mealLogId = logRow?.id ?? ""

        if (mealLogId) {
          const { error: itemError } = await supabase.from("meal_items").insert(
            items.map((item) => ({
              meal_log_id: mealLogId,
              food_name: item.food ?? item.name ?? "Assigned food",
              quantity: item.quantity ?? "1 serving",
              calories: Math.round(asNumber(item.calories)),
              protein: Math.round(asNumber(item.protein)),
              carbs: Math.round(asNumber(item.carbs)),
              fat: Math.round(asNumber(item.fat)),
            }))
          )

          if (itemError) throw itemError
        }
      } else {
        const { error: updateError } = await supabase
          .from("meal_logs")
          .update({ is_completed: true })
          .eq("id", existingLog.id)

        if (updateError) throw updateError
      }

      await loadTodayDiet(userId, selectedDate)
      setMessage(`${mealLabel[mealTypeToMark]} marked completed.`)
    } catch (e: any) {
      setError(e?.message ?? "Failed to mark meal completed.")
    } finally {
      setSyncing(false)
    }
  }

  async function refreshData() {
    if (!userId) return
    try {
      setSyncing(true)
      await Promise.all([loadAssignedDiet(userId), loadTodayDiet(userId, selectedDate)])
      setMessage("Diet data refreshed.")
    } catch (e: any) {
      setError(e?.message ?? "Failed to refresh data.")
    } finally {
      setSyncing(false)
    }
  }

  function isMealCompleted(mealTypeToCheck: MealType) {
    return completedMealTypes.has(mealTypeToCheck)
  }

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
        <div className="flex items-center gap-3 text-slate-700 dark:text-slate-300">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading Diet tab...
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-24">
      <div className="overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-700 bg-gradient-to-br from-purple-50 via-white to-cyan-50 dark:from-slate-800 dark:via-slate-800 dark:to-slate-800 p-6 text-slate-900 dark:text-white shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-purple-100 px-3 py-1 text-xs font-medium text-purple-700">
              <Sparkles className="h-3.5 w-3.5" />
              Smart diet tracking
            </div>
            <h2 className="text-3xl font-bold tracking-tight">Today&apos;s Diet</h2>
            <p className="max-w-xl text-sm leading-6 text-slate-600">
              Add foods by name and quantity, analyze nutrition automatically, upload a food image, load assigned diet from your plan, and save everything to Supabase.
            </p>
            <div className="flex flex-wrap gap-2 pt-1 text-xs text-slate-600">
              <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-1">Assigned Diet</span>
              <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-1">Auto macros</span>
              <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-1">Daily logs</span>
              <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-1">Image upload</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[420px] lg:grid-cols-2">
            <StatCard
              title="Logged"
              value={`${Math.round(plannedOrLoggedCalories)} kcal`}
              subtitle={`Target ${Math.round(targetTotals.calories)} kcal`}
              icon={<Flame className="h-5 w-5" />}
            />
            <StatCard
              title="Protein"
              value={`${Math.round(plannedOrLoggedProtein)} g`}
              subtitle={`Target ${Math.round(targetTotals.protein)} g`}
              icon={<ClipboardList className="h-5 w-5" />}
            />
          </div>
        </div>
      </div>

      {voiceListening && (
        <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 flex items-center gap-3 text-sm text-red-700 dark:text-red-300">
          <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          Listening... Speak what you ate (e.g. "2 scrambled eggs and toast with butter")
        </div>
      )}
      {voiceTranscript && !voiceLogging && (
        <div className="rounded-2xl border border-purple-200 bg-purple-50 dark:bg-purple-900/20 dark:border-purple-800 px-4 py-3 text-sm text-purple-700 dark:text-purple-300">
          <span className="font-medium">You said:</span> "{voiceTranscript}"
        </div>
      )}

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {message ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Date" value={selectedDate} subtitle={formatDate(selectedDate)} icon={<ClipboardList className="h-5 w-5" />} />
        <StatCard
          title="Completion"
          value={`${completionPct}%`}
          subtitle={completedMealTypes.size > 0 ? `${completedMealTypes.size} meal(s) completed` : "In progress"}
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
        <StatCard
          title="Assigned meals"
          value={`${assignedDiet.length}`}
          subtitle="Loaded from workout plan"
          icon={<UtensilsCrossed className="h-5 w-5" />}
        />
        <StatCard
          title="Logged items"
          value={`${mealItems.length}`}
          subtitle="Saved to DB or added locally"
          icon={<Camera className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Build today&apos;s meal</h3>
                <p className="mt-1 text-sm text-slate-500">Use text, quantity, or image to get calories and macros.</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 dark:bg-slate-700 px-3 py-2">
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="bg-transparent text-sm outline-none"
                  />
                </div>

                <button
                  onClick={refreshData}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 shadow-sm transition hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  Refresh
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Meal type</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {MEAL_OPTIONS.map((type) => (
                    <button
                      key={type}
                      onClick={() => setMealType(type)}
                      className={`rounded-2xl border px-3 py-3 text-sm font-medium transition ${
                        mealType === type ? "border-slate-900 bg-slate-900 text-white dark:border-indigo-500 dark:bg-indigo-600" : "border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                      }`}
                    >
                      {mealLabel[type]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Food name</label>
                <input
                  value={food}
                  onChange={(e) => setFood(e.target.value)}
                  placeholder="Chicken rice, dosa, paneer, oats..."
                  className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white px-4 py-3 text-sm outline-none transition focus:border-slate-900"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Quantity</label>
                <input
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="200g, 2 pieces, 1 bowl, 1 plate"
                  className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white px-4 py-3 text-sm outline-none transition focus:border-slate-900"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Notes</label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional meal notes"
                  className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white px-4 py-3 text-sm outline-none transition focus:border-slate-900"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={analyzeFoodText}
                disabled={analyzingText || !food.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {analyzingText ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Auto calculate
              </button>

              <button
                onClick={addManualItem}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 shadow-sm transition hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <Plus className="h-4 w-4" />
                Manual add
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={analyzingImage}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 dark:bg-slate-700 px-5 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {analyzingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Upload photo
              </button>

              <button
                onClick={() => { setShowBarcodeModal(true); setBarcodeError("") }}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 px-5 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400 transition hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
              >
                <Scan className="h-4 w-4" />
                Scan barcode
              </button>

              <button
                onClick={voiceListening ? () => recognitionRef.current?.stop() : startVoiceLog}
                disabled={voiceLogging}
                className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition ${
                  voiceListening
                    ? "bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 animate-pulse"
                    : voiceLogging
                      ? "bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 text-purple-600 dark:text-purple-400"
                      : "border border-purple-200 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/40"
                }`}
                title="Voice food log"
              >
                {voiceLogging ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</>
                ) : voiceListening ? (
                  <><MicOff className="h-4 w-4" /> Stop</>
                ) : (
                  <><Mic className="h-4 w-4" /> Voice log</>
                )}
              </button>

              <button
                onClick={() => setShowAdvanced((v) => !v)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 transition hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <ChevronDown className={`h-4 w-4 transition ${showAdvanced ? "rotate-180" : ""}`} />
                Advanced
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleImageUpload(file)
                  e.currentTarget.value = ""
                }}
              />
            </div>

            {selectedFileName ? <p className="mt-3 text-xs text-slate-500">Selected image: {selectedFileName}</p> : null}

            {showAdvanced ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 dark:bg-slate-700 p-4 text-sm text-slate-600">
                <p className="font-medium text-slate-900 dark:text-white">Production notes</p>
                <p className="mt-1 leading-6">
                  This component matches your current tables. It reads from meal_logs and meal_items, and it does not write unsupported columns into meal_items.
                </p>
              </div>
            ) : null}

            {analysisPreview ? (
              <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-emerald-900">AI nutrition preview</p>
                    <p className="mt-1 text-sm text-emerald-800">
                      {analysisPreview.food ?? "Food"}
                      {analysisPreview.quantity ? ` • ${analysisPreview.quantity}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => setAnalysisPreview(null)}
                    className="rounded-full p-1 text-emerald-700 transition hover:bg-emerald-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-4">
                  <MacroCard label="Calories" value={asNumber(analysisPreview.calories)} unit=" kcal" />
                  <MacroCard label="Protein" value={asNumber(analysisPreview.protein)} />
                  <MacroCard label="Carbs" value={asNumber(analysisPreview.carbs)} />
                  <MacroCard label="Fat" value={asNumber(analysisPreview.fat)} />
                </div>
                {analysisPreview.notes ? <p className="mt-3 text-sm text-emerald-800">{analysisPreview.notes}</p> : null}
              </div>
            ) : null}
          </div>

          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Meal in progress</h3>
                <p className="mt-1 text-sm text-slate-500">Items added for {mealLabel[mealType]}.</p>
              </div>
              <div className="rounded-2xl bg-slate-100 dark:bg-slate-700 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                {mealItems.filter((i) => i.mealType === mealType).length} item
                {mealItems.filter((i) => i.mealType === mealType).length === 1 ? "" : "s"}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MacroCard label="Calories" value={totals.calories} unit=" kcal" />
              <MacroCard label="Protein" value={totals.protein} />
              <MacroCard label="Carbs" value={totals.carbs} />
              <MacroCard label="Fat" value={totals.fat} />
            </div>

            <div className="mt-4 space-y-4">
              <ProgressBar value={totals.calories} target={targetTotals.calories} />
              <ProgressBar value={totals.protein} target={targetTotals.protein} />
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                onClick={saveDiet}
                disabled={saving || mealItems.length === 0}
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Save and track today
              </button>

              <button
                onClick={() => {
                  setMealItems([])
                  resetComposer()
                  setMessage("Composer cleared.")
                }}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 transition hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <RotateCcw className="h-4 w-4" />
                Clear
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Recent items</h3>
                <p className="mt-1 text-sm text-slate-500">The latest foods logged in this tab.</p>
              </div>
            </div>

            {recentItems.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  title="Nothing logged yet"
                  description="Start by adding food, uploading a picture, or completing an assigned meal."
                />
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {recentItems.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 dark:bg-slate-700 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-900 dark:text-white">{item.food}</p>
                          <span className="rounded-full bg-white dark:bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                            {mealLabel[item.mealType]}
                          </span>
                          <span className="rounded-full bg-white dark:bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                            {item.source}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">
                          {item.quantity}
                          {item.notes ? ` • ${item.notes}` : ""}
                        </p>
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="text-lg font-bold text-slate-900 dark:text-white">{Math.round(item.calories)} kcal</p>
                        <p className="text-xs text-slate-500">
                          P {Math.round(item.protein)} g • C {Math.round(item.carbs)} g • F {Math.round(item.fat)} g
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Assigned Diet</h3>
                <p className="mt-1 text-sm text-slate-500">Pulled from your active workout plan.</p>
              </div>
              <div className="rounded-2xl bg-slate-100 dark:bg-slate-700 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                {assignedDiet.length} meals
              </div>
            </div>

            {assignedDiet.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  title="No assigned diet found"
                  description="Add diet_plan.meals inside your workout plan JSON to show assigned meals here."
                />
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {assignedDiet.map((meal, idx) => {
                  const linkedMealType = normalizeMealType(meal.meal_type, idx)
                  const mealTotals = meal.items.reduce<MacroTotals>(
                    (acc, item) => {
                      acc.calories += asNumber(item.calories)
                      acc.protein += asNumber(item.protein)
                      acc.carbs += asNumber(item.carbs)
                      acc.fat += asNumber(item.fat)
                      return acc
                    },
                    { calories: 0, protein: 0, carbs: 0, fat: 0 }
                  )
                  const completed = isMealCompleted(linkedMealType)

                  return (
                    <div key={`${meal.name}-${idx}`} className="rounded-3xl border border-slate-200 bg-slate-50 dark:bg-slate-700 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white">{meal.name}</p>
                          <p className="mt-1 text-xs text-slate-500">{mealLabel[linkedMealType]}</p>
                        </div>
                        <button
                          onClick={() => markAssignedMealCompleted(linkedMealType)}
                          disabled={syncing || completed}
                          className={`inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold transition ${
                            completed ? "bg-emerald-600 text-white" : "bg-slate-900 text-white hover:bg-slate-800"
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                          {completed ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : syncing ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                          {completed ? "Completed" : "Mark Completed"}
                        </button>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-700 dark:text-slate-300 sm:grid-cols-4">
                        <div className="rounded-2xl bg-white dark:bg-slate-700 px-3 py-2">{Math.round(mealTotals.calories)} kcal</div>
                        <div className="rounded-2xl bg-white dark:bg-slate-700 px-3 py-2">P {Math.round(mealTotals.protein)} g</div>
                        <div className="rounded-2xl bg-white dark:bg-slate-700 px-3 py-2">C {Math.round(mealTotals.carbs)} g</div>
                        <div className="rounded-2xl bg-white dark:bg-slate-700 px-3 py-2">F {Math.round(mealTotals.fat)} g</div>
                      </div>

                      <div className="mt-4 space-y-2">
                        {meal.items.length === 0 ? (
                          <div className="rounded-2xl bg-white dark:bg-slate-700 px-3 py-3 text-sm text-slate-500 dark:text-slate-400">No foods listed</div>
                        ) : (
                          meal.items.map((item, i) => (
                            <div
                              key={`${item.food ?? item.name ?? "item"}-${i}`}
                              className="flex items-center justify-between gap-4 rounded-2xl bg-white dark:bg-slate-700 px-3 py-3 text-sm"
                            >
                              <div>
                                <p className="font-medium text-slate-900 dark:text-white">{item.food ?? item.name ?? "Food item"}</p>
                                <p className="text-xs text-slate-500">{item.quantity ?? "1 serving"}</p>
                              </div>
                              <div className="text-right text-slate-600">{Math.round(asNumber(item.calories))} kcal</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Today&apos;s record</h3>
                <p className="mt-1 text-sm text-slate-500">Loaded from meal_logs and meal_items.</p>
              </div>
              <div
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  completedMealTypes.size > 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                }`}
              >
                {completedMealTypes.size > 0 ? "Progress saved" : "In progress"}
              </div>
            </div>

            {historyRows.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  title="No record for this date"
                  description="Once you save or complete meals, the logs will appear here and the 0 kcal bug disappears because the values are loaded from the database."
                />
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {historyRows.map((row) => (
                  <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 dark:bg-slate-700 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">{mealLabel[row.meal_type]}</p>
                        <p className="mt-1 text-xs text-slate-500">{formatDate(row.date)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-slate-900 dark:text-white">{Math.round(asNumber(row.total_calories))} kcal</p>
                        <p className="text-xs text-slate-500">
                          P {Math.round(asNumber(row.total_protein))} • C {Math.round(asNumber(row.total_carbs))} • F{" "}
                          {Math.round(asNumber(row.total_fat))}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Barcode Modal */}
      {showBarcodeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-800 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <Scan className="h-5 w-5 text-emerald-500" />
                <h3 className="font-semibold text-slate-900 dark:text-white">Barcode Scanner</h3>
              </div>
              <button
                onClick={closeBarcodeModal}
                className="rounded-full p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
              >
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Camera view */}
              <div className="relative overflow-hidden rounded-2xl bg-slate-900 aspect-video flex items-center justify-center">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                />
                {!barcodeStreamRef.current && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
                    <Camera className="h-10 w-10 opacity-40" />
                    <button
                      onClick={startCameraScanner}
                      className="rounded-xl bg-emerald-500 hover:bg-emerald-600 px-5 py-2 text-sm font-semibold transition"
                    >
                      Start Camera
                    </button>
                  </div>
                )}
                {/* Scanning overlay */}
                {barcodeStreamRef.current && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-48 h-24 border-2 border-emerald-400 rounded-lg opacity-70">
                      <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-emerald-400 rounded-tl" />
                      <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-emerald-400 rounded-tr" />
                      <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-emerald-400 rounded-bl" />
                      <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-emerald-400 rounded-br" />
                    </div>
                    <p className="absolute bottom-3 text-xs text-white/70">Align barcode within frame</p>
                  </div>
                )}
              </div>

              {/* Manual input */}
              <div>
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Or enter barcode manually
                </label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && lookupBarcode(barcodeInput)}
                    placeholder="e.g. 8901063052492"
                    className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-sm outline-none focus:border-emerald-400 dark:text-white"
                  />
                  <button
                    onClick={() => lookupBarcode(barcodeInput)}
                    disabled={barcodeLoading || !barcodeInput.trim()}
                    className="rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition"
                  >
                    {barcodeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Look up"}
                  </button>
                </div>
              </div>

              {barcodeError && (
                <p className="text-sm text-rose-500">{barcodeError}</p>
              )}

              <p className="text-xs text-slate-400 text-center">
                Powered by Open Food Facts — works with packaged food barcodes worldwide
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
