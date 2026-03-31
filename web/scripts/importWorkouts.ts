import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

type ExerciseItem = {
  name?: string;
  bodyPart?: string;
  target?: string;
  equipment?: string;
  instructions?: string[];
  gifUrl?: string;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL in .env");
}

if (!SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in .env");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const datasetPath = path.join(process.cwd(), "datasets", "exercises.json");

function readDataset(): ExerciseItem[] {
  if (!fs.existsSync(datasetPath)) {
    throw new Error(`Dataset file not found: ${datasetPath}`);
  }

  const raw = fs.readFileSync(datasetPath, "utf-8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("exercises.json must contain an array of exercises");
  }

  return parsed;
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeInstructions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((step) => (typeof step === "string" ? step.trim() : ""))
    .filter(Boolean);
}

function toRow(item: ExerciseItem) {
  const name = normalizeText(item.name);
  const bodyPart = normalizeText(item.bodyPart);
  const target = normalizeText(item.target);
  const equipment = normalizeText(item.equipment);
  const instructions = normalizeInstructions(item.instructions);
  const gifUrl = normalizeText(item.gifUrl);

  return {
    name,
    body_part: bodyPart,
    target,
    equipment,
    instructions,
    gif_url: gifUrl,
  };
}

async function insertInBatches(rows: ReturnType<typeof toRow>[], batchSize = 100) {
  let inserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    const { error } = await supabase.from("workouts").insert(batch);

    if (error) {
      throw new Error(
        `Supabase insert failed at batch ${Math.floor(i / batchSize) + 1}: ${error.message}`
      );
    }

    inserted += batch.length;
    console.log(`Inserted ${inserted}/${rows.length}`);
  }
}

async function main() {
  console.log("Reading dataset...");
  const data = readDataset();

  const rows = data
    .map(toRow)
    .filter((row) => row.name && row.instructions.length > 0);

  if (rows.length === 0) {
    throw new Error("No valid workout rows found in dataset");
  }

  console.log(`Preparing to import ${rows.length} workouts...`);

  await insertInBatches(rows, 100);

  console.log("Done importing workouts.");
}

main().catch((error) => {
  console.error("Import failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});