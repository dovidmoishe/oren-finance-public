import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  AgentArtifact,
  AgentChatRequest,
  AgentChatResponse,
  AgentDisplayMessage,
  AgentMessage,
  AgentStreamEvent,
  AgentThreadMessagesResponse,
  AgentToolActivity,
} from '../../types/agent';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { AgentUnavailableError } from '../common/errors/provider.errors';
import { toolFailurePayload } from '../execution/simulation-reason';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import { isSameReply, previousAssistantContent } from './agent-followup';
import { buildInstructions, portfolioToContext } from './agent-context';
import {
  linkCompanyCitations,
  priorDripToolNote,
  stripEmptyDetailsFences,
  stripUnsolicitedTradeOffer,
} from './agent-reply';
import { AgentRepository } from './agent.repository';
import { OPENAI_CLIENT, type OpenAIClient } from './openai.provider';
import { PortfolioService } from '../portfolio/portfolio.service';
import {
  AgentToolRegistry,
  type AgentToolContext,
  type AgentToolResult,
} from './tools/agent-tool.registry';

const MAX_TOOL_ROUNDS = 5;
const HISTORY_LIMIT = 100;

type ResponseInput = unknown[];
type ResponseOutputItem = Record<string, unknown>;
type ResponseStreamEvent = Record<string, unknown> & { type: string };

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly repository: AgentRepository,
    private readonly tools: AgentToolRegistry,
    private readonly portfolioService: PortfolioService,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(OPENAI_CLIENT) private readonly openai: OpenAIClient,
    @Optional() private readonly auth?: PrivyWalletAuth,
  ) {}

  async message(
    body: AgentChatRequest,
    authorization?: string,
  ): Promise<AgentChatResponse> {
    const events: AgentStreamEvent[] = [];
    let completed: Extract<
      AgentStreamEvent,
      { type: 'turn_completed' }
    > | null = null;
    let failed: Extract<AgentStreamEvent, { type: 'turn_failed' }> | null =
      null;

    for await (const event of this.streamMessage(
      body,
      undefined,
      authorization,
    )) {
      if (event.type !== 'assistant_delta') events.push(event);
      if (event.type === 'turn_completed') completed = event;
      if (event.type === 'turn_failed') failed = event;
    }

    if (!completed) {
      throw new AgentUnavailableError(
        failed?.error.message ?? 'Oren could not complete the response',
      );
    }

    return {
      threadId: completed.threadId,
      message: completed.message,
      artifacts: completed.artifacts,
      events,
    };
  }

  async *streamMessage(
    body: AgentChatRequest,
    signal?: AbortSignal,
    authorization?: string,
  ): AsyncGenerator<AgentStreamEvent> {
    const turnId = randomUUID();
    let sequence = 0;
    const timestamp = () => new Date();

    try {
      const walletAddress = assertNonEmpty(body.walletAddress, 'walletAddress');
      const content = assertNonEmpty(body.message, 'message');
      const thread = body.threadId
        ? await this.loadThread(body.threadId, walletAddress)
        : await this.repository.createThread(walletAddress);
      const existingHistory = body.threadId
        ? await this.repository.listMessages(thread.id, HISTORY_LIMIT)
        : [];
      const unansweredUser = findUnansweredUser(existingHistory, content);
      const userMessage =
        unansweredUser ??
        (await this.repository.insertMessage({
          threadId: thread.id,
          role: 'user',
          content,
        }));

      yield {
        type: 'turn_started',
        turnId,
        sequence: sequence++,
        timestamp: timestamp(),
        threadId: thread.id,
        message: toDisplayMessage(userMessage),
      };

      if (!this.openai) {
        throw new AgentUnavailableError('OPENAI_API_KEY is required for Agent');
      }

      const history = unansweredUser
        ? existingHistory
        : await this.repository.listMessages(thread.id, HISTORY_LIMIT);
      let input: ResponseInput = messagesToInput(history);
      const artifacts: AgentArtifact[] = [];
      const activities: AgentToolActivity[] = [];
      const companySources: NonNullable<AgentToolResult['companySources']> = [];
      let assistantContent = '';
      const portfolioContext = await this.loadPortfolioContext(walletAddress);
      const caller = await this.callerFor(walletAddress, authorization);
      if (signal) caller.signal = signal;
      const schemas = this.tools.getSchemas(caller);
      let instructions = buildInstructions(
        walletAddress,
        body.context,
        portfolioContext,
        { includeDrip: this.tools.dripEnabledFor(caller) },
      );
      const priorDrip = priorDripToolNote(history);
      if (priorDrip) instructions += `\n\n${priorDrip}`;
      let echoRetries = 0;
      let toolsRan = false;

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        throwIfAborted(signal);
        const stream = (await this.openai.responses.create(
          {
            model: this.env.OPENAI_MODEL,
            instructions,
            input,
            tools: schemas as never,
            tool_choice: 'auto',
            stream: true,
          } as never,
          { signal },
        )) as unknown as AsyncIterable<ResponseStreamEvent>;

        let completedResponse: Record<string, unknown> | undefined;
        let roundStreamedText = '';
        const contentBeforeRound = assistantContent;

        for await (const event of stream) {
          throwIfAborted(signal);
          if (
            event.type === 'response.output_text.delta' &&
            typeof event.delta === 'string'
          ) {
            roundStreamedText += event.delta;
            assistantContent += event.delta;
            yield {
              type: 'assistant_delta',
              turnId,
              sequence: sequence++,
              timestamp: timestamp(),
              delta: event.delta,
            };
          } else if (
            event.type === 'response.completed' &&
            isRecord(event.response)
          ) {
            completedResponse = event.response;
          } else if (
            event.type === 'response.failed' ||
            event.type === 'error'
          ) {
            throw new AgentUnavailableError(extractStreamError(event));
          }
        }

        if (!completedResponse) {
          throw new AgentUnavailableError(
            'The model stream ended unexpectedly',
          );
        }

        const output = Array.isArray(completedResponse.output)
          ? (completedResponse.output as ResponseOutputItem[])
          : [];
        const roundText = extractAssistantText(
          typeof completedResponse.output_text === 'string'
            ? completedResponse.output_text
            : undefined,
          output,
        );
        const missingText = missingStreamedSuffix(roundText, roundStreamedText);
        if (missingText) {
          roundStreamedText += missingText;
          assistantContent += missingText;
          yield {
            type: 'assistant_delta',
            turnId,
            sequence: sequence++,
            timestamp: timestamp(),
            delta: missingText,
          };
        }

        const functionCalls = output.filter(isFunctionCall);
        if (functionCalls.length > 0) {
          if (roundStreamedText) {
            assistantContent = contentBeforeRound;
            yield {
              type: 'assistant_reset',
              turnId,
              sequence: sequence++,
              timestamp: timestamp(),
            };
          }
          input = [...input, ...output];
          toolsRan = true;
        } else {
          const previous = previousAssistantContent(history);
          if (
            echoRetries < 1 &&
            previous &&
            isSameReply(assistantContent, previous)
          ) {
            echoRetries += 1;
            const streamedEcho = assistantContent !== contentBeforeRound;
            assistantContent = contentBeforeRound;
            if (streamedEcho) {
              yield {
                type: 'assistant_reset',
                turnId,
                sequence: sequence++,
                timestamp: timestamp(),
              };
            }
            input = [
              ...input,
              ...output,
              {
                role: 'developer',
                content: toolsRan
                  ? 'You repeated your previous message verbatim. Write a new answer from the tool results already in this turn. Do not repeat that message.'
                  : 'You repeated your previous message verbatim. Call a read-only tool if the question still needs data, then write a new answer. Do not repeat that message.',
              },
            ];
            continue;
          }

          if (!assistantContent.trim()) {
            assistantContent = 'I could not produce a response.';
            yield {
              type: 'assistant_delta',
              turnId,
              sequence: sequence++,
              timestamp: timestamp(),
              delta: assistantContent,
            };
          }
          const withoutOffer = stripUnsolicitedTradeOffer(
            assistantContent,
            activities,
          );
          const withCitations = linkCompanyCitations(
            withoutOffer,
            companySources,
          );
          if (withCitations !== assistantContent) {
            assistantContent = withCitations;
            yield {
              type: 'assistant_reset',
              turnId,
              sequence: sequence++,
              timestamp: timestamp(),
            };
            yield {
              type: 'assistant_delta',
              turnId,
              sequence: sequence++,
              timestamp: timestamp(),
              delta: withCitations,
            };
          }
          const finalText =
            stripEmptyDetailsFences(assistantContent) ||
            'I could not produce a response.';
          const assistant = await this.saveAssistantMessage(
            thread.id,
            finalText,
          );
          yield {
            type: 'turn_completed',
            turnId,
            sequence: sequence++,
            timestamp: timestamp(),
            threadId: thread.id,
            message: toDisplayMessage(assistant, activities, artifacts),
            artifacts: artifacts.length > 0 ? artifacts : undefined,
          };
          return;
        }

        for (const call of functionCalls) {
          throwIfAborted(signal);
          const toolName = String(call.name);
          const callId = String(call.call_id);
          activities.push({ callId, toolName, status: 'running' });
          yield {
            type: 'tool_started',
            turnId,
            sequence: sequence++,
            timestamp: timestamp(),
            callId,
            toolName,
          };

          try {
            const args = parseArguments(call.arguments);
            const result = await this.tools.dispatch(toolName, args, caller);
            await this.repository.insertMessage({
              threadId: thread.id,
              role: 'tool',
              content: JSON.stringify(result.output),
              toolName,
              toolPayload: args,
            });
            if (result.artifact) artifacts.push(result.artifact);
            if (result.companySources)
              companySources.push(...result.companySources);
            const activity = activities.find((item) => item.callId === callId);
            if (activity) activity.status = 'completed';
            yield {
              type: 'tool_completed',
              turnId,
              sequence: sequence++,
              timestamp: timestamp(),
              callId,
              toolName,
              artifact: result.artifact,
            };
            input.push(
              functionOutput(call, result.modelOutput ?? result.output),
            );
          } catch (error) {
            const payload = toolFailurePayload(error);
            await this.repository.insertMessage({
              threadId: thread.id,
              role: 'tool',
              content: JSON.stringify(payload),
              toolName,
              toolPayload: { failed: true },
            });
            const activity = activities.find((item) => item.callId === callId);
            if (activity) {
              activity.status = 'failed';
              activity.error = payload.error;
            }
            yield {
              type: 'tool_failed',
              turnId,
              sequence: sequence++,
              timestamp: timestamp(),
              callId,
              toolName,
              error: payload.error,
            };
            input.push(functionOutput(call, payload));
          }
        }
      }

      const limitMessage =
        'I hit my tool limit before I could complete that. Try narrowing the request.';
      const separator = assistantContent.trim() ? '\n\n' : '';
      assistantContent += `${separator}${limitMessage}`;
      yield {
        type: 'assistant_delta',
        turnId,
        sequence: sequence++,
        timestamp: timestamp(),
        delta: `${separator}${limitMessage}`,
      };
      const assistant = await this.saveAssistantMessage(
        thread.id,
        stripEmptyDetailsFences(assistantContent),
      );
      yield {
        type: 'turn_completed',
        turnId,
        sequence: sequence++,
        timestamp: timestamp(),
        threadId: thread.id,
        message: toDisplayMessage(assistant, activities, artifacts),
        artifacts: artifacts.length > 0 ? artifacts : undefined,
      };
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      yield {
        type: 'turn_failed',
        turnId,
        sequence: sequence++,
        timestamp: timestamp(),
        error: {
          code:
            error instanceof BadRequestException
              ? 'bad_request'
              : 'agent_error',
          message,
          retryable: !(error instanceof BadRequestException),
        },
      };
    }
  }

  async getThreadMessages(
    threadId: string,
    walletAddress: string,
  ): Promise<AgentThreadMessagesResponse> {
    const wallet = assertNonEmpty(walletAddress, 'walletAddress');
    const thread = await this.loadThread(threadId, wallet);
    const messages = await this.repository.listMessages(
      thread.id,
      HISTORY_LIMIT,
    );
    return { thread, messages: toDisplayHistory(messages) };
  }

  private async loadThread(id: string, walletAddress: string) {
    const thread = await this.repository.getThread(id);
    if (!thread) throw new BadRequestException('threadId not found');
    if (thread.walletAddress !== walletAddress) {
      throw new BadRequestException(
        'threadId does not belong to walletAddress',
      );
    }
    return thread;
  }

  private saveAssistantMessage(
    threadId: string,
    content: string,
  ): Promise<AgentMessage> {
    return this.repository.insertMessage({
      threadId,
      role: 'assistant',
      content,
    });
  }

  private async callerFor(
    walletAddress: string,
    authorization?: string,
  ): Promise<AgentToolContext> {
    const caller: AgentToolContext = { walletAddress };
    if (authorization && this.auth) {
      const identity = await this.auth.requireResearchIdentity(
        authorization,
        walletAddress,
      );
      caller.userId = identity.userId;
      if (identity.email) caller.email = identity.email;
    }
    return caller;
  }

  private async loadPortfolioContext(walletAddress: string) {
    try {
      return portfolioToContext(
        await this.portfolioService.getPortfolio(walletAddress),
      );
    } catch (error) {
      this.logger.warn(
        `Portfolio context unavailable for ${walletAddress}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }
}

function findUnansweredUser(
  messages: AgentMessage[],
  content: string,
): AgentMessage | undefined {
  const lastAssistantIndex = messages.findLastIndex(
    (message) => message.role === 'assistant',
  );
  return messages
    .slice(lastAssistantIndex + 1)
    .findLast(
      (message) => message.role === 'user' && message.content === content,
    );
}

function messagesToInput(messages: AgentMessage[]): ResponseInput {
  return messages
    .filter(
      (message) => message.role === 'user' || message.role === 'assistant',
    )
    .map((message) => ({ role: message.role, content: message.content }));
}

function isFunctionCall(
  item: ResponseOutputItem,
): item is ResponseOutputItem & {
  name: string;
  call_id: string;
  arguments?: string;
} {
  return (
    item.type === 'function_call' &&
    typeof item.name === 'string' &&
    typeof item.call_id === 'string'
  );
}

function parseArguments(args: unknown): unknown {
  if (typeof args !== 'string' || !args.trim()) return {};
  return JSON.parse(args);
}

function functionOutput(
  call: ResponseOutputItem & { call_id: string },
  output: unknown,
) {
  return {
    type: 'function_call_output',
    call_id: call.call_id,
    output: JSON.stringify(output),
  };
}

function extractAssistantText(
  outputText: string | undefined,
  output: ResponseOutputItem[],
): string {
  if (outputText?.trim()) return outputText;
  const chunks: string[] = [];
  for (const item of output) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content as Record<string, unknown>[]) {
      if (typeof part.text === 'string') chunks.push(part.text);
    }
  }
  return chunks.join('\n');
}

function missingStreamedSuffix(fullText: string, streamedText: string): string {
  if (!fullText || fullText === streamedText) return '';
  if (fullText.startsWith(streamedText))
    return fullText.slice(streamedText.length);
  return streamedText ? '' : fullText;
}

function toDisplayMessage(
  message: AgentMessage,
  activities?: AgentToolActivity[],
  artifacts?: AgentArtifact[],
): AgentDisplayMessage {
  return {
    id: message.id,
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: message.content,
    createdAt: message.createdAt,
    activities: activities?.length
      ? activities.map((item) => ({ ...item }))
      : undefined,
    artifacts: artifacts?.length ? artifacts : undefined,
  };
}

function toDisplayHistory(messages: AgentMessage[]): AgentDisplayMessage[] {
  const display: AgentDisplayMessage[] = [];
  let activities: AgentToolActivity[] = [];
  let artifacts: AgentArtifact[] = [];

  for (const message of messages) {
    if (message.role === 'tool' && message.toolName) {
      const output = parseToolOutput(message.content);
      const error =
        isRecord(output) && typeof output.error === 'string'
          ? output.error
          : undefined;
      activities.push({
        callId: message.id,
        toolName: message.toolName,
        status: error ? 'failed' : 'completed',
        error,
      });
      const artifact = error
        ? undefined
        : artifactFromToolOutput(message.toolName, output);
      if (artifact) artifacts.push(artifact);
      continue;
    }

    if (message.role === 'assistant') {
      display.push(toDisplayMessage(message, activities, artifacts));
      activities = [];
      artifacts = [];
    } else if (message.role === 'user') {
      display.push(toDisplayMessage(message));
    }
  }

  const last = display.at(-1);
  if (last?.role === 'user') last.interrupted = true;
  return display;
}

function artifactFromToolOutput(
  toolName: string,
  data: unknown,
): AgentArtifact | undefined {
  switch (toolName) {
    case 'getStockResearch':
      return { type: 'research', data: data as never };
    case 'getPortfolio':
      return { type: 'portfolio', data: data as never };
    case 'getTradingCalendar':
      return { type: 'trading_calendar', data: data as never };
    case 'getTradingCalendarDay':
      return { type: 'trading_calendar_day', data: data as never };
    case 'getStock':
      return { type: 'stock', data: data as never };
    case 'getBitgetMarketContext':
      return { type: 'bitget_market', data: data as never };
    case 'analyzeStock':
      return { type: 'analysis', data: data as never };
    case 'findOpportunities':
      return { type: 'opportunities', data: data as never };
    case 'getSwapQuote':
      return { type: 'quote', data: data as never };
    case 'proposeLimitOrder':
      return { type: 'limit_order', data: data as never };
    case 'getLimitOrders':
      return { type: 'limit_orders', data: data as never };
    case 'createBasket':
      return { type: 'basket', data: data as never };
    case 'prepareSwap':
      return { type: 'prepared_swap', data: data as never };
    case 'prepareBasketPurchase':
      return { type: 'prepared_basket', data: data as never };
    case 'prepareLock':
      return { type: 'prepared_lock', data: data as never };
    case 'prepareUnlock':
      return { type: 'prepared_unlock', data: data as never };
    case 'getVaults':
      return { type: 'vaults', data: data as never };
    default:
      return undefined;
  }
}

function parseToolOutput(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

function extractStreamError(event: ResponseStreamEvent): string {
  if (isRecord(event.error) && typeof event.error.message === 'string') {
    return event.error.message;
  }
  if (
    isRecord(event.response) &&
    isRecord(event.response.error) &&
    typeof event.response.error.message === 'string'
  ) {
    return event.response.error.message;
  }
  return 'The model could not complete the response';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${field} is required`);
  }
  return value.trim();
}
