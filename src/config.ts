import { z } from 'zod';
import type { PluginConfig } from './contracts.js';
export const MAX_BUDGET_MS = 1_800_000;
export const budgetSchema = z.number().int().min(5000).max(MAX_BUDGET_MS);
// 0 disables the idle watchdog; otherwise it must leave room for a slow first event.
const idleSchema = z.union([z.literal(0), z.number().int().min(10000).max(MAX_BUDGET_MS)]);
export const configSchema = z.strictObject({
  polishBudgetMs: budgetSchema,
  generalBudgetMs: budgetSchema,
  idleTimeoutMs: idleSchema,
  maxTurns: z.union([z.literal(1), z.literal(2)]),
  chineseRatioThreshold: z.number().min(0).max(1),
});
export const defaultConfig: PluginConfig = {
  polishBudgetMs: 30000,
  generalBudgetMs: 60000,
  idleTimeoutMs: 120000,
  maxTurns: 2,
  chineseRatioThreshold: 0.5,
};
export function readConfig(env: NodeJS.ProcessEnv = process.env): PluginConfig {
  return configSchema.parse({
    polishBudgetMs: Number(env.AGY_POLISH_BUDGET_MS ?? defaultConfig.polishBudgetMs),
    generalBudgetMs: Number(env.AGY_GENERAL_BUDGET_MS ?? defaultConfig.generalBudgetMs),
    idleTimeoutMs: Number(env.AGY_IDLE_TIMEOUT_MS ?? defaultConfig.idleTimeoutMs),
    maxTurns: Number(env.AGY_MAX_TURNS ?? defaultConfig.maxTurns),
    chineseRatioThreshold: Number(env.AGY_CHINESE_RATIO ?? defaultConfig.chineseRatioThreshold),
  });
}
