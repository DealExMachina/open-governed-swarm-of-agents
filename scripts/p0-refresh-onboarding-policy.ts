#!/usr/bin/env tsx
import { execSync } from "child_process";

function argInt(name: string, dflt: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return dflt;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
}

const steps = argInt("steps", 8);
const seeds = argInt("seeds", 6);
const minRoleSamples = argInt("min_role_samples", 60);
const minPassRateRaw = process.argv.find((a) => a.startsWith("--min_pass_rate="));
const minPassRate = minPassRateRaw ? Number(minPassRateRaw.split("=")[1]) : 0.9;

// Calibrated P0 accepted cohort for recurring policy refresh.
const modelSpecs = [
  "ollama|qwen2.5:0.5b|small-local",
  "ollama|qwen2.5:3b|small-local",
  "ollama|qwen3:0.6b|small-local|512|none",
  "ollama|qwen3:1.7b|small-local|512|none",
  "ollama|qwen3:4b|small-local|512|none",
  "ollama|llama3.2:1b|small-local",
  "ollama|llama3.2:3b|small-local",
  "ollama|gemma3:270m|small-local",
  "ollama|gemma3:1b|small-local",
  "ollama|mistral-large-3:675b-cloud|cloud-mistral",
  "ollama|gemma3:27b-cloud|cloud-gemma",
  "openai|gpt-4o-mini|cloud-openai",
].join(",");

const cmd = [
  `MODEL_EVAL_MODELS="${modelSpecs}"`,
  "pnpm run exp:model-evals --",
  `--steps=${steps}`,
  `--seeds=${seeds}`,
  `--min_role_samples=${minRoleSamples}`,
  `--min_pass_rate=${Number.isFinite(minPassRate) ? minPassRate : 0.9}`,
  "--max_consecutive_failures=8",
  "--allow_reasoning_fallback=1",
].join(" ");

execSync(cmd, { stdio: "inherit", shell: "/bin/zsh" });

