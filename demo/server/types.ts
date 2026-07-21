export interface DemoDoc {
  index: number;
  filename: string;
  title: string;
  body: string;
  excerpt: string;
}

export interface ScenarioStep {
  n: number;
  title: string;
  sub: string;
  role: string;
  insight: string;
  docs?: number[];
}

export interface ScenarioMeta {
  id: string;
  name: string;
  tagline: string;
  description: string;
  icon: string;
  color: string;
  docCount: number;
  steps: ScenarioStep[];
}
