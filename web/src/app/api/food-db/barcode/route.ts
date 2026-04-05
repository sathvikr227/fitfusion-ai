import { NextResponse } from "next/server"

export async function POST(req: Request) {
  try {
    const { barcode } = await req.json()

    if (!barcode || typeof barcode !== "string") {
      return NextResponse.json({ error: "Barcode required" }, { status: 400 })
    }

    const cleaned = barcode.replace(/\D/g, "")
    if (!cleaned) {
      return NextResponse.json({ error: "Invalid barcode" }, { status: 400 })
    }

    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${cleaned}.json?fields=product_name,brands,serving_size,nutriments`,
      { headers: { "User-Agent": "FitFusionAI/1.0 (fitness-app)" } }
    )

    if (!res.ok) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 })
    }

    const data = await res.json()

    if (data.status !== 1 || !data.product) {
      return NextResponse.json({ error: "Product not found in Open Food Facts" }, { status: 404 })
    }

    const p = data.product
    const n = p.nutriments ?? {}

    // Parse serving size in grams (e.g. "40g", "28 g", "1 bar (45g)")
    const servingStr = String(p.serving_size ?? "")
    const gramsMatch = servingStr.match(/(\d+(?:\.\d+)?)\s*g\b/i)
    const servingGrams = gramsMatch ? parseFloat(gramsMatch[1]) : null
    // multiplier: if serving size is in grams, scale per-100g values accordingly
    const multiplier = servingGrams != null ? servingGrams / 100 : 1

    // Prefer per-serving values; fall back to per-100g × multiplier
    const calories =
      n["energy-kcal_serving"] != null
        ? n["energy-kcal_serving"]
        : n["energy-kcal_100g"] != null
        ? n["energy-kcal_100g"] * multiplier
        : null

    const protein =
      n["proteins_serving"] != null
        ? n["proteins_serving"]
        : n["proteins_100g"] != null
        ? n["proteins_100g"] * multiplier
        : null

    const carbs =
      n["carbohydrates_serving"] != null
        ? n["carbohydrates_serving"]
        : n["carbohydrates_100g"] != null
        ? n["carbohydrates_100g"] * multiplier
        : null

    const fat =
      n["fat_serving"] != null
        ? n["fat_serving"]
        : n["fat_100g"] != null
        ? n["fat_100g"] * multiplier
        : null

    const foodName = [p.product_name, p.brands]
      .filter(Boolean)
      .join(" — ")
      .trim() || "Scanned product"

    return NextResponse.json({
      food: foodName,
      quantity: p.serving_size || "1 serving",
      calories: calories != null ? Math.round(Number(calories)) : 0,
      protein: protein != null ? Math.round(Number(protein) * 10) / 10 : 0,
      carbs: carbs != null ? Math.round(Number(carbs) * 10) / 10 : 0,
      fat: fat != null ? Math.round(Number(fat) * 10) / 10 : 0,
      source: "barcode",
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
