import { z } from "zod";
import { GoalMatchItemSchema } from "../modelConfig.js";

export interface GoalMatch {
  node_id: string;
  status: "fully_resolved" | "partially_resolved" | "not_addressed";
  confidence: number;
}

export async function matchGoalsAgainstEvidenceWithLLM(
  evidenceText: string,
  goals: Array<{ node_id: string; content: string }>,
): Promise<GoalMatch[]> {
  const { getChatModelConfig } = await import("../modelConfig.js");
  const config = getChatModelConfig();
  if (!config || goals.length === 0)
    return matchGoalsDeterministic(evidenceText, goals);

  const goalsText = goals
    .map((g, i) => `${i + 1}. [${g.node_id}] ${g.content}`)
    .join("\n");
  const prompt = `Given these established facts (claims extracted from documents):

"""
${evidenceText.slice(0, 8000)}
"""

Here are the active goals:
${goalsText}

For each goal, decide if the available evidence addresses it. A goal is satisfied when the facts contain information relevant to its intent — it does not require an exact literal match.
Reply with ONLY a JSON array: [{"id":"<node_id>","status":"fully_resolved"|"partially_resolved"|"not_addressed","confidence":0.0-1.0}]

- "fully_resolved": the evidence meaningfully addresses this goal's intent (e.g. financial data present for a financial goal, risk factors identified for a risk goal)
- "partially_resolved": the evidence touches on the topic but key aspects are missing
- "not_addressed": the evidence is genuinely unrelated to this goal

Be pragmatic: if relevant facts exist for a goal's domain, mark it resolved. Only use not_addressed when there is truly no overlap. Reply with ONLY the JSON array, no other text.`;

  const url = `${config.url.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.id.replace(/^openai\//, ""),
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  const usage = data.usage;
  if (usage) {
    try {
      const { recordLLMTokens } = await import("../metrics.js");
      recordLLMTokens(
        "planner_goal_eval",
        "input",
        usage.prompt_tokens ?? 0,
        config?.id,
      );
      recordLLMTokens(
        "planner_goal_eval",
        "output",
        usage.completion_tokens ?? 0,
        config?.id,
      );
    } catch {
      /* no-op */
    }
  }

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("No JSON array in LLM response");

  const validated = z
    .array(GoalMatchItemSchema)
    .safeParse(JSON.parse(jsonMatch[0]));
  if (!validated.success)
    throw new Error(
      `Goal match schema validation failed: ${validated.error.message}`,
    );

  const goalIds = new Set(goals.map((g) => g.node_id));
  return validated.data
    .filter((p) => goalIds.has(p.id))
    .map((p) => ({
      node_id: p.id,
      status: p.status,
      confidence: p.confidence,
    }));
}

export async function matchGoalsWithLLM(
  decision: string,
  goals: Array<{ node_id: string; content: string }>,
): Promise<GoalMatch[]> {
  const { getChatModelConfig } = await import("../modelConfig.js");
  const config = getChatModelConfig();
  if (!config || goals.length === 0)
    return matchGoalsDeterministic(decision, goals);

  const goalsText = goals
    .map((g, i) => `${i + 1}. [${g.node_id}] ${g.content}`)
    .join("\n");
  const prompt = `A user submitted this resolution:\n"${decision.trim()}"\n\nHere are the active goals:\n${goalsText}\n\nFor each goal, decide if the resolution addresses it. Reply with ONLY a JSON array, one object per goal:\n[{"id":"<node_id>","status":"fully_resolved"|"partially_resolved"|"not_addressed","confidence":0.0-1.0}]\n\n- "fully_resolved": the resolution clearly answers or completes this goal\n- "partially_resolved": the resolution provides relevant information but doesn't fully close the goal\n- "not_addressed": the resolution is unrelated to this goal\n\nBe generous: if the resolution mentions a topic related to the goal, mark it at least partially_resolved. Reply with ONLY the JSON array, no other text.`;

  const url = `${config.url.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.id.replace(/^openai\//, ""),
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  const usage = data.usage;
  if (usage) {
    try {
      const { recordLLMTokens } = await import("../metrics.js");
      recordLLMTokens(
        "resolution",
        "input",
        usage.prompt_tokens ?? 0,
        config?.id,
      );
      recordLLMTokens(
        "resolution",
        "output",
        usage.completion_tokens ?? 0,
        config?.id,
      );
    } catch {
      /* no-op */
    }
  }

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("No JSON array in LLM response");

  const validated = z
    .array(GoalMatchItemSchema)
    .safeParse(JSON.parse(jsonMatch[0]));
  if (!validated.success)
    throw new Error(
      `Goal match schema validation failed: ${validated.error.message}`,
    );

  const goalIds = new Set(goals.map((g) => g.node_id));
  return validated.data
    .filter((p) => goalIds.has(p.id))
    .map((p) => ({
      node_id: p.id,
      status: p.status,
      confidence: p.confidence,
    }));
}

export function matchGoalsDeterministic(
  decision: string,
  goals: Array<{ node_id: string; content: string }>,
): GoalMatch[] {
  const MATCH_THRESHOLD = 0.1;
  const sentences = splitIntoSentences(decision);
  const fullTokens = expandSynonyms(tokenize(decision));
  const sentenceTokenSets = sentences.map((s) => expandSynonyms(tokenize(s)));
  const results: GoalMatch[] = [];

  for (const goal of goals) {
    const goalTokens = expandSynonyms(tokenize(goal.content));
    const score = bestMatchScore(fullTokens, sentenceTokenSets, goalTokens);
    if (score >= MATCH_THRESHOLD) {
      results.push({
        node_id: goal.node_id,
        status: score >= 0.2 ? "fully_resolved" : "partially_resolved",
        confidence: score,
      });
    }
  }
  return results;
}

const SYNONYMS: Record<string, string[]> = {
  ip: ["patents", "patent", "intellectual", "property"],
  patents: ["ip", "patent", "intellectual"],
  patent: ["ip", "patents", "intellectual"],
  cto: ["technical", "team", "chief", "officer"],
  technical: ["cto", "tech", "engineering"],
  retention: ["retain", "retaining", "departure", "departing"],
  arr: ["revenue", "recurring", "annual"],
  revenue: ["arr", "recurring", "financial"],
  compliance: ["regulatory", "regulation", "posture"],
  regulatory: ["compliance", "regulation"],
  ownership: ["own", "co-ownership", "ip"],
  valuation: ["value", "pricing", "worth"],
  due: ["diligence"],
  diligence: ["due"],
};

function expandSynonyms(tokens: Set<string>): Set<string> {
  const expanded = new Set(tokens);
  for (const t of tokens) {
    const syns = SYNONYMS[t];
    if (syns) for (const s of syns) expanded.add(s);
  }
  return expanded;
}

/**
 * Combined match score: max of Jaccard and coverage (fraction of goal tokens found in resolution).
 * Checks both the full text and individual sentences.
 */
function bestMatchScore(
  fullTokens: Set<string>,
  sentenceTokenSets: Set<string>[],
  goalTokens: Set<string>,
): number {
  const coverage = (src: Set<string>, goal: Set<string>) => {
    if (goal.size === 0) return 0;
    let hit = 0;
    for (const w of goal) if (src.has(w)) hit++;
    return hit / goal.size;
  };

  const fullJaccard = jaccardSimilarity(fullTokens, goalTokens);
  const fullCoverage = coverage(fullTokens, goalTokens);
  let best = Math.max(fullJaccard, fullCoverage);

  for (const st of sentenceTokenSets) {
    const j = jaccardSimilarity(st, goalTokens);
    const c = coverage(st, goalTokens);
    const s = Math.max(j, c);
    if (s > best) best = s;
  }
  return best;
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/[.!?;,]+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);
}

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "not",
  "no",
  "all",
  "any",
  "each",
  "every",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "than",
  "too",
  "very",
  "just",
  "about",
  "above",
  "after",
  "before",
  "between",
  "into",
  "through",
  "during",
  "until",
  "against",
  "among",
  "out",
  "up",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9àâäéèêëïîôùûüÿçæœ€%]+/gi, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) {
    if (b.has(w)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
