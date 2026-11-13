/** Public deployment metadata; never include credentials here. */
export interface EnvironmentCapabilities {
  environment: 'production' | 'development' | 'preview';
  prNumber: number | null;
  commitSha: string | null;
  financialExecution: boolean;
  backgroundWorkers: boolean;
}
