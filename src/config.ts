import { z } from 'zod';
import type { PluginConfig } from './contracts.js';
export const configSchema = z.strictObject({
  polishBudgetMs: z.number().int().min(5000).max(60000),
  generalBudgetMs: z.number().int().min(5000).max(60000),
  maxTurns: z.union([z.literal(1), z.literal(2)]),
  chineseRatioThreshold: z.number().min(0).max(1),
});
export const defaultConfig: PluginConfig = {
  polishBudgetMs: 30000,
  generalBudgetMs: 60000,
  maxTurns: 2,
  chineseRatioThreshold: 0.5,
};
export function readConfig(env: NodeJS.ProcessEnv = process.env): PluginConfig {
  return configSchema.parse({
    polishBudgetMs: Number(env.AGY_POLISH_BUDGET_MS ?? defaultConfig.polishBudgetMs),
    generalBudgetMs: Number(env.AGY_GENERAL_BUDGET_MS ?? defaultConfig.generalBudgetMs),
    maxTurns: Number(env.AGY_MAX_TURNS ?? defaultConfig.maxTurns),
    chineseRatioThreshold: Number(env.AGY_CHINESE_RATIO ?? defaultConfig.chineseRatioThreshold),
  });
}
