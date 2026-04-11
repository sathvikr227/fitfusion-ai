# FitFusion AI

**Your AI-powered personal fitness coach — plans, tracks, and adapts with you.**

FitFusion AI is a full-stack fitness web application that uses large language models to generate personalized workout and diet plans, coach you in real time, and adapt your program based on your progress and recovery data.

---

## Features

### AI Planning
- **Workout plan generation** — personalized to your goal, weight, activity level, and injury history (Groq LLaMA-3.3-70b-versatile)
- **Diet plan generation** — daily macro targets (calories, protein, carbs, fat) tailored to your profile
- **Adaptive replanning** — AI automatically adjusts your plan based on completion rate and sleep data
- **Recipe suggestions** — AI-generated meal ideas aligned with your macro targets

### Daily Hub — Today's Focus
- Exercise checklist with completion tracking
- Meal logging with voice input (Web Speech API → Groq NLP)
- Water intake tracker
- Mood check-in
- Streak counter

### AI Coach
- Chat assistant with RAG (pgvector on Supabase) for personalized fitness knowledge
- Context-aware responses grounded in your plan and history

### Dream Body Analyzer
- Upload an inspiration photo → OpenAI GPT-4o vision analyzes it → generates a transformation roadmap

### Analytics & Progress
- Analytics dashboard: calorie trends, mood charts, anomaly alerts
- Weekly AI performance report
- Weight logs, sleep logs, injury tracking
- Macro rings — SVG circular progress for calories, protein, carbs, and fat

### Extras
- Exercise database browser (ExerciseDB API) with tips
- Grocery list generator from your meal plan
- Share / accountability partner links
- Dark mode (next-themes)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Database | Supabase (PostgreSQL + pgvector) |
| Auth | Supabase Auth + RLS |
| Primary LLM | Groq — LLaMA-3.3-70b-versatile |
| Vision / Embeddings | OpenAI GPT-4o + text-embedding-3-small |
| Nutrition Data | FatSecret API |
| Exercise Data | ExerciseDB API |
| Styling | Tailwind CSS |
| Icons | Lucide React |
| Theming | next-themes |
| Deployment | Vercel |

---

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project with pgvector enabled
- API keys for Groq, OpenAI, FatSecret, and ExerciseDB

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-username/fitfusion-ai.git
cd fitfusion-ai/web

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env.local
# Fill in the values — see the Environment Variables section below

# 4. Apply database migrations
# Run the SQL files in supabase/migrations/ against your Supabase project
# (via the Supabase dashboard SQL editor or the Supabase CLI)

# 5. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Environment Variables

Create a `.env.local` file in the `web/` directory with the following variables:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) |
| `GROQ_API_KEY` | Groq API key for LLaMA inference |
| `OPENAI_API_KEY` | OpenAI API key for vision and embeddings |
| `FATSECRET_CLIENT_ID` | FatSecret API client ID |
| `FATSECRET_CLIENT_SECRET` | FatSecret API client secret |
| `SEED_SECRET` | Secret for the database seed endpoint |

---

## Project Structure

```
web/
├── src/
│   ├── app/
│   │   ├── dashboard/          # All dashboard pages
│   │   │   ├── home/           # Today's Focus hub
│   │   │   ├── plan/           # Workout & diet plans
│   │   │   ├── today/          # Daily checklist & tracking
│   │   │   ├── analytics/      # Charts and performance reports
│   │   │   ├── progress/       # Weight, sleep, and injury logs
│   │   │   ├── profile/        # User profile and settings
│   │   │   ├── dream-body/     # Vision-based transformation analyzer
│   │   │   └── coach/          # AI coach chat
│   │   └── api/                # All API route handlers
│   ├── lib/
│   │   └── supabase/
│   │       └── client.ts       # Supabase client setup
│   └── middleware.ts            # Rate limiting and auth guard
├── supabase/
│   └── migrations/             # Database schema migrations
└── vercel.json                 # Function timeout configuration
```

---

## Deployment

FitFusion AI is designed to deploy on [Vercel](https://vercel.com).

1. Push your repository to GitHub.
2. Import the project in the Vercel dashboard and set the root directory to `web/`.
3. Add all environment variables from the table above in the Vercel project settings.
4. Deploy — Vercel will handle builds automatically on every push.

Function timeouts are configured in `vercel.json` to accommodate long-running AI inference calls.

---

## License

MIT
