import { NextResponse } from "next/server";

type Workout = {
  title: string;
  muscles: string[];
  steps: string[];
  tips?: string[];
  videoUrl: string;
};

const WORKOUTS: Record<string, Workout> = {
  "bench press": {
    title: "Bench Press",
    muscles: ["Chest", "Triceps", "Front Shoulders"],
    steps: [
      "Lie flat on the bench with your eyes under the bar.",
      "Keep your feet planted firmly on the floor.",
      "Grip the bar slightly wider than shoulder width.",
      "Lower the bar slowly to the middle of your chest.",
      "Push the bar upward until your arms are straight.",
      "Repeat with controlled movement.",
    ],
    tips: [
      "Keep your shoulder blades squeezed together.",
      "Do not bounce the bar off your chest.",
    ],
    videoUrl:
      "https://www.youtube.com/results?search_query=bench+press+proper+form",
  },
  squats: {
    title: "Squats",
    muscles: ["Quads", "Glutes", "Hamstrings", "Core"],
    steps: [
      "Stand with feet shoulder-width apart.",
      "Keep your chest up and core tight.",
      "Push hips back and bend knees slowly.",
      "Lower until thighs are parallel or comfortable depth.",
      "Drive through heels to stand back up.",
      "Repeat with control.",
    ],
    tips: [
      "Keep knees aligned with your toes.",
      "Do not round your back.",
    ],
    videoUrl:
      "https://www.youtube.com/results?search_query=proper+squat+form",
  },
  deadlift: {
    title: "Deadlift",
    muscles: ["Glutes", "Hamstrings", "Back", "Core"],
    steps: [
      "Stand close to the bar with feet hip-width apart.",
      "Hinge at the hips and grip the bar.",
      "Keep your back neutral and chest up.",
      "Push through the floor and lift the bar.",
      "Stand tall at the top.",
      "Lower the bar with control.",
    ],
    tips: [
      "Keep the bar close to your body.",
      "Brace your core before lifting.",
    ],
    videoUrl:
      "https://www.youtube.com/results?search_query=deadlift+proper+form",
  },
  "push up": {
    title: "Push Up",
    muscles: ["Chest", "Triceps", "Shoulders", "Core"],
    steps: [
      "Place hands slightly wider than shoulder width.",
      "Keep your body in a straight line.",
      "Lower your chest toward the floor.",
      "Push back up to the starting position.",
      "Repeat for the required reps.",
    ],
    tips: [
      "Keep your hips from sagging.",
      "Modify by doing knee push-ups if needed.",
    ],
    videoUrl:
      "https://www.youtube.com/results?search_query=push+up+proper+form",
  },
  pullup: {
    title: "Pull Up",
    muscles: ["Back", "Biceps", "Shoulders"],
    steps: [
      "Grab the bar with an overhand grip.",
      "Hang with arms fully extended.",
      "Pull your chest toward the bar.",
      "Lower yourself slowly.",
      "Repeat with control.",
    ],
    tips: [
      "Use assisted pull-ups if you are a beginner.",
      "Avoid swinging your body.",
    ],
    videoUrl:
      "https://www.youtube.com/results?search_query=pull+up+proper+form",
  },
  "shoulder press": {
    title: "Shoulder Press",
    muscles: ["Shoulders", "Triceps", "Upper Chest"],
    steps: [
      "Hold dumbbells or a bar at shoulder height.",
      "Keep your core braced.",
      "Press the weight overhead.",
      "Lock out at the top without overextending.",
      "Lower slowly and repeat.",
    ],
    tips: [
      "Do not arch your lower back too much.",
      "Keep movement controlled.",
    ],
    videoUrl:
      "https://www.youtube.com/results?search_query=shoulder+press+proper+form",
  },
  plank: {
    title: "Plank",
    muscles: ["Core", "Shoulders", "Glutes"],
    steps: [
      "Place forearms on the floor.",
      "Keep elbows under shoulders.",
      "Hold your body in a straight line.",
      "Keep your core tight and breathe normally.",
      "Hold for the target duration.",
    ],
    tips: [
      "Do not let your hips drop.",
      "Start with short holds and increase over time.",
    ],
    videoUrl: "https://www.youtube.com/results?search_query=plank+exercise+form",
  },
  "bicep curl": {
    title: "Bicep Curl",
    muscles: ["Biceps", "Forearms"],
    steps: [
      "Stand upright holding dumbbells.",
      "Keep elbows close to your body.",
      "Curl the weights up slowly.",
      "Squeeze at the top.",
      "Lower with control.",
    ],
    tips: [
      "Avoid swinging your body.",
      "Use a weight you can control well.",
    ],
    videoUrl:
      "https://www.youtube.com/results?search_query=bicep+curl+proper+form",
  },
};

function normalize(text: string) {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

function findWorkout(query: string): Workout | null {
  const q = normalize(query);

  if (WORKOUTS[q]) return WORKOUTS[q];

  const exactContains = Object.entries(WORKOUTS).find(([key]) => q.includes(key));
  if (exactContains) return exactContains[1];

  const partialMatch = Object.entries(WORKOUTS).find(([key]) => key.includes(q));
  if (partialMatch) return partialMatch[1];

  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const query = String(body?.query || "").trim();

    if (!query) {
      return NextResponse.json(
        { error: "Query is required" },
        { status: 400 }
      );
    }

    const workout = findWorkout(query);

    if (workout) {
      return NextResponse.json({
        found: true,
        category: "workout",
        query,
        ...workout,
      });
    }

    return NextResponse.json({
      found: false,
      category: "workout",
      query,
      title: query,
      muscles: [],
      steps: [
        "No exact workout found in the local dataset.",
        "Try a more specific exercise name like 'bench press' or 'squats'.",
      ],
      tips: ["You can still watch a YouTube demo using the link below."],
      videoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(
        query + " proper form"
      )}`,
    });
  } catch (error) {
    console.error("Workout help error:", error);
    return NextResponse.json(
      { error: "Failed to process workout request" },
      { status: 500 }
    );
  }
}