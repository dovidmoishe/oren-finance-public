import { ForbiddenException } from '@nestjs/common';
import type { EnvironmentCapabilities } from '../../types/environment';

type Source = Record<string, unknown>;

export function deploymentCapabilities(
  env: Source = process.env,
): EnvironmentCapabilities {
  const environment =
    env.DEPLOYMENT_ENV ??
    (env.NODE_ENV === 'production' ? 'production' : 'development');
  if (
    typeof environment !== 'string' ||
    !['production', 'development', 'preview'].includes(environment)
  )
    throw new Error('Invalid DEPLOYMENT_ENV');
  const preview = environment === 'preview';
  const prNumber =
    typeof env.PREVIEW_PR_NUMBER === 'string' ||
    typeof env.PREVIEW_PR_NUMBER === 'number'
      ? Number(env.PREVIEW_PR_NUMBER)
      : null;
  const commitSha = typeof env.COMMIT_SHA === 'string' ? env.COMMIT_SHA : null;
  if (
    preview &&
    (!Number.isSafeInteger(prNumber) ||
      Number(prNumber) < 1 ||
      !/^[a-f0-9]{40}$/.test(commitSha ?? ''))
  ) {
    throw new Error(
      'Preview requires a positive PREVIEW_PR_NUMBER and full COMMIT_SHA',
    );
  }
  return {
    environment: environment as EnvironmentCapabilities['environment'],
    prNumber,
    commitSha,
    financialExecution: !preview,
    backgroundWorkers: !preview,
  };
}

export function assertFinancialExecutionEnabled(
  env: Source = process.env,
): void {
  if (!deploymentCapabilities(env).financialExecution) {
    throw new ForbiddenException({
      code: 'PREVIEW_EXECUTION_DISABLED',
      message: 'Financial execution is disabled in previews.',
    });
  }
}

export function backgroundWorkersEnabled(): boolean {
  return deploymentCapabilities().backgroundWorkers;
}
