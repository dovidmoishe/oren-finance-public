import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  PriceMovedError,
  type PriceMovedDetails,
  ProviderError,
} from '../errors/provider.errors';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'InternalServerError';
    let approvalFailure: { code: string; submissionState: string } | undefined;
    let priceMoved: PriceMovedDetails | undefined;
    let previewExecutionDisabled = false;

    if (exception instanceof ProviderError) {
      status = exception.statusCode;
      message = exception.message;
      error = exception.code;
      if (exception instanceof PriceMovedError) priceMoved = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;
        previewExecutionDisabled = record.code === 'PREVIEW_EXECUTION_DISABLED';
        message = Array.isArray(record.message)
          ? record.message
              .filter((item): item is string => typeof item === 'string')
              .join(', ')
          : typeof record.message === 'string'
            ? record.message
            : exception.message;
        error =
          typeof record.error === 'string' ? record.error : exception.name;
        if (
          record.code === 'PRIVY_SIGNING_FAILED' &&
          record.submissionState === 'not_submitted'
        ) {
          approvalFailure = {
            code: 'PRIVY_SIGNING_FAILED',
            submissionState: 'not_submitted',
          };
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(exception.message, exception.stack);
    }

    if (
      !(exception instanceof HttpException) &&
      !(exception instanceof ProviderError)
    ) {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      ...approvalFailure,
      ...(previewExecutionDisabled ? { code: 'PREVIEW_EXECUTION_DISABLED' } : {}),
      ...(priceMoved ? { priceMoved } : {}),
      statusCode: status,
      message,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
