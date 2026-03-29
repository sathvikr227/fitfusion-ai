import { NextResponse } from "next/server"

let accessToken: string | null = null
let tokenExpiry = 0

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken
  }

  const res = await fetch("https://oauth.fatsecret.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(
          `${process.env.FATSECRET_CLIENT_ID}:${process.env.FATSECRET_CLIENT_SECRET}`
        ).toString("base64"),
    },
    body: "grant_type=client_credentials",
  })

  const data = await res.json()

  accessToken = data.access_token
  tokenExpiry = Date.now() + data.expires_in * 1000

  return accessToken
}

// ✅ NORMALIZE INDIAN FOOD SEARCH
function normalizeQuery(food: string) {
  const map: Record<string, string> = {
    dosa: "masala dosa",
    idli: "idli",
    roti: "chapati",
    chapati: "chapati",
    paneer: "paneer curry",
    biryani: "chicken biryani",
    rice: "white rice",
    dal: "dal curry",
  }

  const lower = food.toLowerCase()

  for (const key in map) {
    if (lower.includes(key)) {
      return map[key]
    }
  }

  return food
}

// ✅ SMART MATCHING
function scoreFoodMatch(name: string, query: string) {
  const n = name.toLowerCase()
  const q = query.toLowerCase()

  if (n === q) return 100
  if (n.includes(q)) return 80
  if (q.split(" ").every((w) => n.includes(w))) return 60
  return 10
}

export async function POST(req: Request) {
  try {
    const { food } = await req.json()

    if (!food) {
      return NextResponse.json({ error: "Food required" }, { status: 400 })
    }

    const token = await getAccessToken()

    // ✅ USE NORMALIZED QUERY
    const query = normalizeQuery(food)

    // 🔍 SEARCH TOP RESULTS
    const searchRes = await fetch(
      `https://platform.fatsecret.com/rest/foods/search/v1?search_expression=${encodeURIComponent(
        query
      )}&max_results=10&format=json`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    )

    const searchData = await searchRes.json()
    const foods = searchData.foods?.food || []

    if (!foods.length) {
      return NextResponse.json({ error: "Food not found" }, { status: 404 })
    }

    // ✅ PICK BEST MATCH (NOT RANDOM)
    const bestFood = foods.sort(
      (a: any, b: any) =>
        scoreFoodMatch(b.food_name, query) -
        scoreFoodMatch(a.food_name, query)
    )[0]

    // 📊 GET DETAILS
    const detailsRes = await fetch(
      `https://platform.fatsecret.com/rest/food/v5?food_id=${bestFood.food_id}&format=json`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    )

    const detailsData = await detailsRes.json()
    const serving = detailsData.food?.servings?.serving?.[0]

    return NextResponse.json({
      food: bestFood.food_name,
      quantity: serving?.serving_description || "1 serving",
      calories: Number(serving?.calories) || 0,
      protein: Number(serving?.protein) || 0,
      carbs: Number(serving?.carbohydrate) || 0,
      fat: Number(serving?.fat) || 0,
      source: "database",
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}