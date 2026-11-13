import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import {
  assertFinancialExecutionEnabled,
  deploymentCapabilities,
} from '../config/deployment';

/** New mutating endpoints are blocked by default until reviewed for preview use. */
@Injectable()
export class PreviewGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (deploymentCapabilities().financialExecution) return true;
    const request = context
      .switchToHttp()
      .getRequest<{ method: string; path: string }>();
    const path = request.path.replace(/\/+$/, '');
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (/\/execution\/approvals\//.test(path))
        assertFinancialExecutionEnabled();
      return true;
    }
    if (request.method === 'OPTIONS') return true;
    if (
      request.method === 'POST' &&
      [
        '/api/agent/message',
        '/api/agent/message/stream',
        '/api/execution/quote',
        '/api/execution/basket',
        '/api/execution/limit-order',
        '/api/feedback',
      ].includes(path)
    )
      return true;
    assertFinancialExecutionEnabled();
    return false;
  }
}
