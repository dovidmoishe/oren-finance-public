import type { EnvironmentCapabilities } from '../types/environment';

export const financialExecutionEnabled = process.env.NEXT_PUBLIC_DEPLOYMENT_ENV !== 'preview';
export type { EnvironmentCapabilities };
