import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import OpenAI from "openai"

export const runtime = "nodejs"

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Supabase environment variables are missing")
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey)
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing")
  return new OpenAI({ apiKey })
}

const FITNESS_KNOWLEDGE: { content: string; category: string }[] = [
  {
    content:
      "Progressive overload is the gradual increase of stress placed on the body during exercise. To build strength and muscle, you must consistently increase the weight, volume, or intensity of your workouts over time. Without progressive overload, your body has no reason to adapt or grow stronger.",
    category: "strength_training",
  },
  {
    content:
      "Protein intake is critical for muscle repair and growth. Most fitness experts recommend 1.6–2.2 grams of protein per kilogram of bodyweight per day for individuals engaged in regular resistance training. Spreading protein intake across 3–5 meals helps maximize muscle protein synthesis.",
    category: "nutrition",
  },
  {
    content:
      "A caloric deficit is required for fat loss. Consuming 300–500 fewer calories than your TDEE (total daily energy expenditure) per day leads to approximately 0.3–0.5 kg of fat loss per week, which is a sustainable and healthy rate. Deficits larger than 1000 kcal/day risk muscle loss and metabolic adaptation.",
    category: "nutrition",
  },
  {
    content:
      "A caloric surplus is needed to gain muscle mass. Eating 200–400 calories above maintenance supports muscle growth (lean bulk) while minimizing fat gain. Excessive surpluses (dirty bulking) lead to unnecessary fat accumulation that must be dieted off later.",
    category: "nutrition",
  },
  {
    content:
      "Sleep is the most important recovery tool available. During deep sleep, the body releases growth hormone, repairs muscle tissue, and consolidates motor patterns learned during training. Adults need 7–9 hours of quality sleep for optimal athletic performance and body composition changes.",
    category: "recovery",
  },
  {
    content:
      "Cardiovascular exercise improves heart health, endurance, and calorie expenditure. Aim for at least 150 minutes of moderate-intensity or 75 minutes of vigorous-intensity cardio per week. Combining cardio with resistance training produces the best overall health and body composition outcomes.",
    category: "cardio",
  },
  {
    content:
      "Compound exercises recruit multiple muscle groups simultaneously and provide the greatest hormonal and strength response. The foundational compound lifts are the squat, deadlift, bench press, overhead press, and row. Building a program around these movements maximizes efficiency and overall athleticism.",
    category: "strength_training",
  },
  {
    content:
      "Rest days are not optional — they are when adaptation occurs. Muscles grow during recovery, not during training. Taking 1–2 rest days per week prevents overtraining, reduces injury risk, and allows the nervous system to recover. Active recovery (light walking, yoga, stretching) on rest days can accelerate healing.",
    category: "recovery",
  },
  {
    content:
      "Hydration significantly affects performance and recovery. Dehydration of even 1–2% of body weight can impair strength, endurance, and cognitive function. Aim for at least 35 ml of water per kg of bodyweight daily, more during intense exercise or hot conditions.",
    category: "nutrition",
  },
  {
    content:
      "Macronutrient ratios should be tailored to your goal. For fat loss, a common ratio is 40% protein, 30% carbohydrates, 30% fat. For muscle building, 30% protein, 45% carbohydrates, 25% fat works well. Carbohydrates are the primary fuel source for high-intensity exercise and should not be excessively restricted.",
    category: "nutrition",
  },
  {
    content:
      "Training frequency refers to how often you train a muscle group per week. Research shows that training each muscle group 2 times per week is superior to once-weekly training for hypertrophy. Full-body routines or upper/lower splits achieve this frequency naturally.",
    category: "strength_training",
  },
  {
    content:
      "Deload weeks involve reducing training volume and/or intensity by 40–50% for one week every 4–8 weeks of hard training. Deloads prevent accumulated fatigue, reduce injury risk, and often result in strength gains the following week due to supercompensation.",
    category: "recovery",
  },
  {
    content:
      "Injury prevention requires a combination of proper warm-up, correct technique, progressive loading, adequate sleep, and listening to your body. Overuse injuries are the most common training injuries and occur from doing too much too soon. Pain is a signal to stop and assess, not push through.",
    category: "injury_prevention",
  },
  {
    content:
      "Delayed onset muscle soreness (DOMS) is the pain and stiffness felt 12–72 hours after unfamiliar or intense exercise. DOMS is caused by microscopic muscle damage and is a normal part of adaptation. Soreness does not necessarily indicate an effective workout, and you can still train while experiencing mild DOMS.",
    category: "recovery",
  },
  {
    content:
      "BMI (Body Mass Index) is calculated as weight in kilograms divided by height in meters squared. While useful as a population-level screening tool, BMI does not account for muscle mass, bone density, or fat distribution. Body fat percentage is a more accurate indicator of health and fitness.",
    category: "health_metrics",
  },
  {
    content:
      "Metabolism is the total of all chemical processes in the body. Resting metabolic rate (RMR) accounts for 60–70% of total daily energy expenditure. Muscle tissue is more metabolically active than fat tissue, so increasing muscle mass over time raises your baseline calorie burn.",
    category: "metabolism",
  },
  {
    content:
      "Consistency is the single most important factor in achieving fitness results. A moderate program followed consistently for months outperforms an optimal program followed sporadically. Building sustainable habits, managing recovery, and staying injury-free are more valuable than any specific training method.",
    category: "mindset",
  },
  {
    content:
      "Weight loss plateaus occur when the body adapts to a reduced calorie intake by lowering metabolic rate and non-exercise activity. Breaking a plateau requires either further reducing calories, increasing activity, or taking a diet break at maintenance calories for 1–2 weeks to reset metabolic adaptation.",
    category: "fat_loss",
  },
  {
    content:
      "Muscle memory allows previously trained muscles to regain lost size and strength much faster than initial gains. This occurs because the nuclei added to muscle cells during training persist even after detraining. Someone returning from a break of several months can regain their previous level in a fraction of the original time.",
    category: "strength_training",
  },
  {
    content:
      "Warming up before exercise increases muscle temperature, blood flow, and joint lubrication. A proper warm-up includes 5–10 minutes of low-intensity cardio and dynamic stretches specific to the movements you will perform. This reduces injury risk and improves initial performance.",
    category: "injury_prevention",
  },
  {
    content:
      "Cooling down after exercise helps transition the body from high to low intensity, reduces blood pooling in the extremities, and begins the recovery process. 5–10 minutes of light walking followed by static stretching of the worked muscles is an effective cool-down protocol.",
    category: "recovery",
  },
  {
    content:
      "Creatine monohydrate is the most researched and effective legal performance supplement. It increases phosphocreatine stores in muscle, allowing for greater energy output in short, high-intensity efforts. A daily dose of 3–5 grams is effective for most people with no loading phase required.",
    category: "supplements",
  },
  {
    content:
      "Body recomposition — simultaneously losing fat and gaining muscle — is possible, especially for beginners, detrained individuals, and those with higher body fat percentages. It requires eating near maintenance calories with high protein intake and following a consistent resistance training program.",
    category: "body_composition",
  },
  {
    content:
      "The mind-muscle connection refers to consciously focusing on the muscle being worked during an exercise. Research shows this focus increases muscle activation, particularly in isolation exercises. Slowing down the eccentric (lowering) phase and using lighter loads with full range of motion can enhance this connection.",
    category: "strength_training",
  },
  {
    content:
      "High-protein foods include chicken breast (31g per 100g), tuna (30g per 100g), Greek yogurt (10g per 100g), eggs (13g per 100g), cottage cheese (11g per 100g), lentils (9g per 100g cooked), and tofu (8g per 100g). Prioritizing whole food protein sources ensures you get additional micronutrients alongside the protein.",
    category: "nutrition",
  },
  {
    content:
      "Meal timing has a modest impact on performance and recovery. Consuming 20–40g of protein within 2 hours after training supports muscle protein synthesis. Pre-workout carbohydrates (1–2 hours before) can improve performance in high-intensity sessions. Overall daily intake matters more than precise timing.",
    category: "nutrition",
  },
  {
    content:
      "Intermittent fasting (IF) is an eating pattern that cycles between fasting and eating windows, such as 16:8 (16 hours fasting, 8 hours eating). IF can be an effective strategy for caloric restriction and fat loss. However, it does not have metabolic advantages over regular caloric restriction when total calories are equated.",
    category: "nutrition",
  },
  {
    content:
      "HIIT (High-Intensity Interval Training) alternates short bursts of maximum effort with recovery periods. HIIT burns more calories per minute and creates a greater metabolic disturbance (afterburn effect) than steady-state cardio. However, HIIT is more taxing on the nervous system and should be performed at most 2–3 times per week.",
    category: "cardio",
  },
  {
    content:
      "LISS (Low-Intensity Steady-State) cardio, such as walking, cycling at moderate pace, or swimming at low intensity for 30–60 minutes, is excellent for active recovery and additional calorie expenditure without stressing the nervous system. It can be performed daily and does not interfere with strength training recovery.",
    category: "cardio",
  },
  {
    content:
      "Strength training accelerates fat loss by preserving and building metabolically active muscle tissue while in a caloric deficit. Lifting weights while dieting prevents the muscle loss that typically accompanies caloric restriction, resulting in a higher percentage of weight lost coming from fat.",
    category: "fat_loss",
  },
  {
    content:
      "Volume (total sets × reps × weight) is the primary driver of muscle hypertrophy. Optimal hypertrophy volume is typically 10–20 sets per muscle group per week. Starting at the lower end (10 sets) and gradually adding sets as you adapt is a safe and effective progression strategy.",
    category: "strength_training",
  },
  {
    content:
      "Stretching improves flexibility, reduces post-workout stiffness, and may reduce injury risk. Dynamic stretching (moving through a range of motion) is best before exercise. Static stretching (holding a position for 20–60 seconds) is most effective after exercise when muscles are warm.",
    category: "recovery",
  },
  {
    content:
      "Protein synthesis is maximized when protein is spread evenly across 3–5 meals per day, each containing 20–40g of high-quality protein. This is because muscles can only utilize a certain amount of amino acids at once for synthesis, though any excess is not wasted and still contributes to overall daily protein goals.",
    category: "nutrition",
  },
  {
    content:
      "Overtraining syndrome occurs when the volume and intensity of training exceeds the body's capacity to recover. Symptoms include persistent fatigue, declining performance, mood disturbances, increased injury frequency, and sleep disruption. Recovery from overtraining can take weeks to months and requires significant rest.",
    category: "recovery",
  },
  {
    content:
      "A structured warm-up for strength training should include 5 minutes of light cardio, 2–3 warm-up sets of the main lift at 50–70% of working weight, and dynamic movements targeting the joints involved. This primes the nervous system and reduces injury risk without causing fatigue.",
    category: "injury_prevention",
  },
  {
    content:
      "Fiber intake supports gut health, satiety, and stable blood sugar levels. Adults should consume 25–35 grams of dietary fiber per day. High-fiber foods include vegetables, fruits, legumes, and whole grains. Adequate fiber helps manage hunger during a caloric deficit, making fat loss more sustainable.",
    category: "nutrition",
  },
  {
    content:
      "Sleep quality is as important as quantity. Factors that improve sleep quality include keeping a consistent sleep schedule, making your bedroom dark and cool (around 18°C), avoiding screens and caffeine within 2 hours of bed, and limiting alcohol. Even small improvements in sleep quality can significantly enhance recovery.",
    category: "recovery",
  },
  {
    content:
      "Leg day should not be skipped. The legs contain the largest muscle groups in the body including the quadriceps, hamstrings, and glutes. Training legs releases more anabolic hormones like testosterone and growth hormone than upper body training, which benefits overall muscle growth throughout the body.",
    category: "strength_training",
  },
  {
    content:
      "Caffeine is one of the most effective ergogenic aids. 3–6 mg per kg of bodyweight, taken 45–60 minutes before exercise, improves endurance, power output, and focus. Tolerance builds quickly with regular use, so cycling off caffeine every few weeks maintains its effectiveness.",
    category: "supplements",
  },
  {
    content:
      "Vitamin D deficiency is common and linked to reduced muscle strength, impaired recovery, and lower testosterone levels. Getting 15–20 minutes of sun exposure daily or supplementing with 1000–2000 IU of vitamin D3 per day can support muscle function and overall health, especially in winter months.",
    category: "supplements",
  },
  {
    content:
      "The rate of natural muscle gain is limited. Men can expect to gain 0.5–1 kg of muscle per month in their first year of training, slowing to 0.25–0.5 kg per month after that. Women gain muscle at approximately half this rate. These limits are genetic and cannot be exceeded without anabolic drugs.",
    category: "body_composition",
  },
  {
    content:
      "Tracking food intake, even briefly, dramatically improves dietary adherence and awareness. Research shows people consistently underestimate calorie intake by 20–50%. Using a food tracking app for a few weeks helps calibrate portion sizes and identify hidden calorie sources, even if you do not track permanently.",
    category: "nutrition",
  },
  {
    content:
      "Rest periods between sets affect training outcome. For maximum strength, rest 3–5 minutes between heavy compound sets. For hypertrophy, 60–120 seconds is sufficient. Shorter rest periods increase metabolic stress and cardiovascular demand but reduce the weight you can lift in subsequent sets.",
    category: "strength_training",
  },
  {
    content:
      "Fat is an essential macronutrient needed for hormone production, vitamin absorption, and joint health. Dietary fat should not drop below 0.5–1g per kg of bodyweight, as very low fat intake disrupts testosterone production in men and hormonal regulation in women. Prioritize unsaturated fats from olive oil, nuts, and avocado.",
    category: "nutrition",
  },
  {
    content:
      "Range of motion (ROM) during exercise is a key determinant of muscle growth. Full ROM training leads to greater hypertrophy than partial ROM because it stretches the muscle under load, which is a potent growth stimulus. Squatting to depth and performing full-range curls are more effective than partial repetitions.",
    category: "strength_training",
  },
  {
    content:
      "Stress and cortisol levels directly affect body composition. Chronic high stress elevates cortisol, which increases fat storage (particularly abdominal fat), impairs muscle recovery, and suppresses testosterone. Managing stress through mindfulness, adequate sleep, and balanced training load is a genuine fat loss strategy.",
    category: "health_metrics",
  },
  {
    content:
      "Periodization is the systematic planning of athletic training over time. Linear periodization increases intensity while decreasing volume over weeks. Undulating periodization varies intensity and volume more frequently. Both approaches outperform constant-intensity training over longer time periods.",
    category: "strength_training",
  },
  {
    content:
      "Glute training requires both hip-hinge movements (deadlifts, hip thrusts) and squat pattern movements (squats, lunges). The glutes are the largest and most powerful muscle in the body. Strong glutes improve athletic performance, reduce lower back pain, and are a key driver of metabolic rate.",
    category: "strength_training",
  },
  {
    content:
      "Eating enough carbohydrates before training maintains performance. If you train early in the morning or in a fasted state, you may notice reduced strength and endurance. A small carbohydrate snack (banana, oatmeal) 30–60 minutes before training can significantly improve workout quality.",
    category: "nutrition",
  },
  {
    content:
      "Foam rolling and myofascial release techniques can reduce muscle soreness and improve range of motion before training. Spending 5–10 minutes rolling out tight muscles before a workout is a practical addition to a warm-up routine, particularly for the IT band, lats, and thoracic spine.",
    category: "recovery",
  },
  {
    content:
      "High-intensity training creates oxidative stress in muscle tissue. Antioxidants from colorful vegetables and fruits help neutralize this damage and support recovery. Consuming a diet rich in berries, leafy greens, and cruciferous vegetables provides the antioxidants needed to support athletic recovery.",
    category: "nutrition",
  },
  {
    content:
      "The scale does not tell the whole story. Weight fluctuates by 1–3 kg daily due to water retention, food volume, hormonal changes, and glycogen stores. Weigh yourself at the same time each morning and track weekly averages rather than daily numbers for a true picture of fat loss or muscle gain progress.",
    category: "fat_loss",
  },
  {
    content:
      "Tendon and joint health requires specific attention for long-term fitness. Tendons respond to load but adapt more slowly than muscle. Increasing workout intensity too quickly often leads to tendinopathy. Collagen synthesis is supported by vitamin C intake and loading tendons through their full range of motion.",
    category: "injury_prevention",
  },
  {
    content:
      "The training principle of specificity states that your body adapts specifically to the demands placed on it. To run faster, run faster. To lift heavier, lift heavier. To build a specific muscle, train it with targeted exercises. Generic fitness activities improve general health but won't produce specific athletic results.",
    category: "mindset",
  },
  {
    content:
      "Setting SMART fitness goals — Specific, Measurable, Achievable, Relevant, and Time-bound — dramatically increases the likelihood of success. Instead of 'I want to get fit', a SMART goal is 'I want to do 10 pull-ups by June 1st by training 3x per week'. Clear goals drive consistent action and measurable progress.",
    category: "mindset",
  },
  {
    content:
      "Core strength goes beyond visible abs. The core includes the deep stabilizing muscles of the spine, pelvis, and hips. Exercises like planks, dead bugs, pallof presses, and heavy compound lifts with bracing develop functional core strength that protects the spine and improves performance in all movements.",
    category: "strength_training",
  },
  {
    content:
      "Omega-3 fatty acids, found in fatty fish, flaxseeds, and fish oil supplements, reduce inflammation, support joint health, and may enhance muscle protein synthesis. 1–3 grams of EPA + DHA per day from fish oil is a well-supported dose for athletes and those in heavy training.",
    category: "supplements",
  },
  {
    content:
      "Training to failure on every set is counterproductive for long-term progress. Leaving 1–3 reps in reserve (RIR) on most working sets maintains high stimulus while managing fatigue. Reserve true failure training for the last set of isolation exercises. Heavy compound sets to failure dramatically increase injury risk.",
    category: "strength_training",
  },
  {
    content:
      "Cardiovascular fitness (VO2 max) is a strong predictor of long-term health and longevity — arguably more so than body weight. Even modest improvements in cardiorespiratory fitness through regular aerobic exercise reduce all-cause mortality risk significantly. Zone 2 cardio training (conversational pace) is highly effective for building aerobic base.",
    category: "cardio",
  },
  {
    content:
      "Resistance bands provide constant tension throughout a movement, which differs from free weights. Bands are excellent for warm-up activation, finishing sets, rehabilitation, and training where heavy equipment is unavailable. They offer the advantage of loading the strongest part of a movement's range of motion.",
    category: "strength_training",
  },
]

export async function POST(_req: Request) {
  const secret = _req.headers.get("x-seed-secret")
  if (!secret || secret !== process.env.SEED_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const supabase = getSupabase()
    const openai = getOpenAIClient()

    // ── Check if already seeded ───────────────────────────────────────────────
    const { count, error: countError } = await supabase
      .from("fitness_knowledge")
      .select("*", { count: "exact", head: true })

    if (countError) {
      throw new Error(`Failed to count rows: ${countError.message}`)
    }

    if ((count ?? 0) > 10) {
      return NextResponse.json({
        message: "Already seeded",
        count,
      })
    }

    // ── Embed all chunks in one API call ──────────────────────────────────────
    const embedRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: FITNESS_KNOWLEDGE.map((c) => c.content),
    })

    // ── Build rows ────────────────────────────────────────────────────────────
    const rows = FITNESS_KNOWLEDGE.map((chunk, i) => ({
      content: chunk.content,
      category: chunk.category,
      embedding: embedRes.data[i].embedding,
    }))

    // ── Insert into Supabase ──────────────────────────────────────────────────
    const { error: insertError } = await supabase
      .from("fitness_knowledge")
      .insert(rows)

    if (insertError) {
      throw new Error(`Failed to insert knowledge: ${insertError.message}`)
    }

    return NextResponse.json({
      success: true,
      seeded: rows.length,
    })
  } catch (error: any) {
    console.error("SEED KNOWLEDGE ERROR:", error)
    return NextResponse.json(
      { error: error.message || "Failed to seed knowledge" },
      { status: 500 }
    )
  }
}
