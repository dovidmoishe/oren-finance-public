import type {
  AgentMessage,
  AgentStreamEvent,
  AgentThread,
} from '../../types/agent';
import { tooManyRequests } from '../common/rate-limit';
import { AgentService } from './agent.service';
import { CompanyBriefService } from './company-brief.service';
import { AgentToolRegistry } from './tools/agent-tool.registry';

jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));

function responseStream(
  response: Record<string, unknown>,
  deltas: string[] = [],
) {
  return (function* () {
    for (const delta of deltas) {
      yield { type: 'response.output_text.delta', delta };
    }
    yield { type: 'response.completed', response };
  })();
}

describe('AgentService', () => {
  const thread: AgentThread = {
    id: 'thread-1',
    walletAddress: 'wallet-1',
    createdAt: new Date('2026-09-13T10:00:00Z'),
    updatedAt: new Date('2026-09-13T10:00:00Z'),
  };

  const repository = {
    createThread: jest.fn(),
    getThread: jest.fn(),
    insertMessage: jest.fn(),
    listMessages: jest.fn(),
  };
  const tools = {
    getSchemas: jest.fn(),
    dispatch: jest.fn(),
    dripEnabledFor: jest.fn(),
  };
  const portfolioService = {
    getPortfolio: jest.fn(),
  };
  const openai = {
    responses: {
      create: jest.fn(),
    },
  };

  let service: AgentService;
  let nextMessage = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    nextMessage = 0;
    repository.createThread.mockResolvedValue(thread);
    repository.getThread.mockResolvedValue(thread);
    repository.insertMessage.mockImplementation((input) =>
      Promise.resolve({
        id: `msg-${++nextMessage}`,
        createdAt: new Date('2026-09-13T10:00:00Z'),
        ...input,
      } satisfies AgentMessage),
    );
    repository.listMessages.mockResolvedValue([
      {
        id: 'msg-1',
        threadId: 'thread-1',
        role: 'user',
        content: 'Analyze NVDA',
        createdAt: new Date('2026-09-13T10:00:00Z'),
      },
    ]);
    tools.getSchemas.mockReturnValue([]);
    tools.dripEnabledFor.mockReturnValue(false);
    portfolioService.getPortfolio.mockResolvedValue({
      walletAddress: 'wallet-1',
      totalValueUsd: 10_000,
      absoluteChangeUsd: 120,
      percentChange: 1.2,
      availableValueUsd: 8_000,
      lockedValueUsd: 500,
      cashValueUsd: 1_500,
      positions: [
        {
          assetId: 'nvda',
          ticker: 'NVDA',
          name: 'NVIDIA',
          quantity: 10,
          valueUsd: 2_000,
          allocationPercent: 20,
        },
      ],
      updatedAt: new Date('2026-09-13T10:00:00Z'),
    });
    service = new AgentService(
      repository as never,
      tools as never,
      portfolioService as never,
      { OPENAI_MODEL: 'gpt-5-mini' } as never,
      openai as never,
    );
  });

  it('streams text, executes a tool, persists the answer, and extracts artifacts', async () => {
    openai.responses.create
      .mockResolvedValueOnce(
        responseStream({
          output: [
            {
              type: 'function_call',
              name: 'analyzeStock',
              call_id: 'call-1',
              arguments: '{"assetIdOrTicker":"NVDA"}',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        responseStream(
          {
            output_text: 'NVDA has a strong Oren Score.',
            output: [],
          },
          ['NVDA has ', 'a strong Oren Score.'],
        ),
      );
    tools.dispatch.mockResolvedValue({
      output: { assetId: 'nvda', ticker: 'NVDA', opportunityScore: 90 },
      artifact: {
        type: 'analysis',
        data: { assetId: 'nvda', ticker: 'NVDA', opportunityScore: 90 },
      },
    });

    const streamed: AgentStreamEvent[] = [];
    for await (const event of service.streamMessage({
      walletAddress: 'wallet-1',
      message: 'Analyze NVDA',
      context: { page: 'stock', assetId: 'nvda' },
    })) {
      streamed.push(event);
    }

    expect(repository.createThread).toHaveBeenCalledWith('wallet-1');
    expect(portfolioService.getPortfolio).toHaveBeenCalledWith('wallet-1');
    expect(openai.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining(
          'Top holdings: NVDA 20.0%',
        ) as string,
      }),
      expect.any(Object),
    );
    expect(tools.dispatch).toHaveBeenCalledWith(
      'analyzeStock',
      { assetIdOrTicker: 'NVDA' },
      { walletAddress: 'wallet-1' },
    );
    expect(tools.dripEnabledFor).toHaveBeenCalledWith({
      walletAddress: 'wallet-1',
    });
    expect(streamed.map((event) => event.type)).toEqual([
      'turn_started',
      'tool_started',
      'tool_completed',
      'assistant_delta',
      'assistant_delta',
      'turn_completed',
    ]);
    expect(streamed.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(repository.insertMessage).toHaveBeenLastCalledWith({
      threadId: 'thread-1',
      role: 'assistant',
      content: 'NVDA has a strong Oren Score.',
    });
  });

  it('sends the concise tool view to the model and persists the full output', async () => {
    openai.responses.create
      .mockResolvedValueOnce(
        responseStream({
          output: [
            {
              type: 'function_call',
              name: 'analyzeStock',
              call_id: 'call-1',
              arguments: '{"assetIdOrTicker":"NVDA"}',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        responseStream({
          output_text: 'NVIDIA has been climbing.',
          output: [],
        }),
      );
    tools.dispatch.mockResolvedValue({
      output: {
        ticker: 'NVDA',
        opportunityScore: 90,
        technicalBrief: { regime: 'uptrend' },
      },
      modelOutput: {
        speak: {
          lead: 'NVIDIA has been climbing.',
          bullets: ['The trend is up.'],
        },
      },
      artifact: {
        type: 'analysis',
        data: { ticker: 'NVDA', opportunityScore: 90 },
      },
    });

    const events: AgentStreamEvent[] = [];
    for await (const event of service.streamMessage({
      walletAddress: 'wallet-1',
      message: 'Analyze NVDA',
    })) {
      events.push(event);
    }
    expect(events.at(-1)?.type).toBe('turn_completed');

    const inserts = repository.insertMessage.mock.calls as unknown as Array<
      [{ role: string; content: string }]
    >;
    const toolSave = inserts
      .map((call) => call[0])
      .find((message) => message.role === 'tool');
    expect(JSON.parse(toolSave?.content ?? '{}')).toMatchObject({
      opportunityScore: 90,
    });
    const creates = openai.responses.create.mock
      .calls as unknown as unknown[][];
    const modelInput = JSON.stringify(creates[1]?.[0]);
    expect(modelInput).toContain('NVIDIA has been climbing.');
    expect(modelInput).not.toContain('opportunityScore');
  });

  it('keeps the JSON endpoint in parity with the streaming runner', async () => {
    openai.responses.create.mockResolvedValue(
      responseStream({ output_text: 'Hello', output: [] }, ['Hel', 'lo']),
    );

    const result = await service.message({
      walletAddress: 'wallet-1',
      threadId: 'thread-1',
      message: 'Hi',
    });

    expect(repository.getThread).toHaveBeenCalledWith('thread-1');
    expect(repository.createThread).not.toHaveBeenCalled();
    expect(result.message.content).toBe('Hello');
    expect(result.events?.map((event) => event.type)).toEqual([
      'turn_started',
      'turn_completed',
    ]);
  });

  it('reuses an unanswered trailing user message on retry', async () => {
    const unanswered = {
      id: 'user-existing',
      threadId: 'thread-1',
      role: 'user' as const,
      content: 'Analyze NVDA',
      createdAt: new Date('2026-09-13T10:00:00Z'),
    };
    repository.listMessages.mockResolvedValue([unanswered]);
    openai.responses.create.mockResolvedValue(
      responseStream({ output_text: 'MU is ready.', output: [] }),
    );

    const events: AgentStreamEvent[] = [];
    for await (const event of service.streamMessage({
      walletAddress: 'wallet-1',
      threadId: 'thread-1',
      message: 'Analyze NVDA',
    })) {
      events.push(event);
    }

    expect(repository.insertMessage).toHaveBeenCalledTimes(1);
    expect(repository.insertMessage).toHaveBeenCalledWith({
      threadId: 'thread-1',
      role: 'assistant',
      content: 'MU is ready.',
    });
    expect(events[0]).toMatchObject({
      type: 'turn_started',
      message: { id: 'user-existing' },
    });
  });

  it('continues after a tool failure and reports the real failure state', async () => {
    openai.responses.create
      .mockResolvedValueOnce(
        responseStream({
          output: [
            {
              type: 'function_call',
              name: 'getStock',
              call_id: 'call-1',
              arguments: '{"assetIdOrTicker":"NOPE"}',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        responseStream({
          output_text: 'I could not load that stock.',
          output: [],
        }),
      );
    tools.dispatch.mockRejectedValue(new Error('Unknown stock'));

    const events: AgentStreamEvent[] = [];
    for await (const event of service.streamMessage({
      walletAddress: 'wallet-1',
      message: 'Analyze NOPE',
    })) {
      events.push(event);
    }

    expect(events.some((event) => event.type === 'tool_failed')).toBe(true);
    expect(events.at(-1)?.type).toBe('turn_completed');
  });

  it('surfaces a paid-tool limit as a tool failure and still finishes the turn', async () => {
    openai.responses.create
      .mockResolvedValueOnce(
        responseStream({
          output: [
            {
              type: 'function_call',
              name: 'getStockNews',
              call_id: 'call-1',
              arguments: '{"assetIdOrTicker":"NVDA"}',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        responseStream({
          output_text: 'I could not fetch more headlines.',
          output: [],
        }),
      );
    tools.dispatch.mockRejectedValue(tooManyRequests(1));

    const events: AgentStreamEvent[] = [];
    for await (const event of service.streamMessage({
      walletAddress: 'wallet-1',
      message: 'News on NVDA',
    })) {
      events.push(event);
    }

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool_failed',
        toolName: 'getStockNews',
        error: 'Too many requests. Try again shortly.',
      }),
    );
    expect(events.at(-1)?.type).toBe('turn_completed');
  });

  it('reconstructs display history and marks a trailing user turn interrupted', async () => {
    repository.listMessages.mockResolvedValue([
      {
        id: 'user-1',
        threadId: 'thread-1',
        role: 'user',
        content: 'Analyze NVDA',
        createdAt: new Date('2026-09-13T10:00:00Z'),
      },
      {
        id: 'tool-1',
        threadId: 'thread-1',
        role: 'tool',
        toolName: 'analyzeStock',
        content: '{"ticker":"NVDA","opportunityScore":90}',
        createdAt: new Date('2026-09-13T10:00:01Z'),
      },
      {
        id: 'tool-2',
        threadId: 'thread-1',
        role: 'tool',
        toolName: 'getBitgetMarketContext',
        content:
          '{"available":true,"ticker":"NVDA","symbol":"RNVDAUSDT","candles":[],"source":{"provider":"Bitget","product":"Reality","observedAt":"2026-09-13T10:00:01Z","stale":false}}',
        createdAt: new Date('2026-09-13T10:00:01Z'),
      },
      {
        id: 'assistant-1',
        threadId: 'thread-1',
        role: 'assistant',
        content: 'NVDA looks strong.',
        createdAt: new Date('2026-09-13T10:00:02Z'),
      },
      {
        id: 'user-2',
        threadId: 'thread-1',
        role: 'user',
        content: 'And the news?',
        createdAt: new Date('2026-09-13T10:00:03Z'),
      },
    ]);

    const result = await service.getThreadMessages('thread-1', 'wallet-1');

    expect(result.messages[1]).toMatchObject({
      role: 'assistant',
      activities: [
        { toolName: 'analyzeStock', status: 'completed' },
        { toolName: 'getBitgetMarketContext', status: 'completed' },
      ],
      artifacts: [{ type: 'analysis' }, { type: 'bitget_market' }],
    });
    expect(result.messages.at(-1)).toMatchObject({ interrupted: true });
  });

  it('stops after max tool rounds', async () => {
    openai.responses.create.mockImplementation(() =>
      Promise.resolve(
        responseStream({
          output: [
            {
              type: 'function_call',
              name: 'getStock',
              call_id: 'call-1',
              arguments: '{"assetIdOrTicker":"NVDA"}',
            },
          ],
        }),
      ),
    );
    tools.dispatch.mockResolvedValue({ output: { id: 'nvda' } });

    const result = await service.message({
      walletAddress: 'wallet-1',
      message: 'Keep looking',
    });

    expect(openai.responses.create).toHaveBeenCalledTimes(5);
    expect(result.message.content).toContain('tool limit');
  });

  it('leaves tool choice on auto when the user sends a short agreement', async () => {
    const prior = [
      {
        id: 'user-1',
        threadId: 'thread-1',
        role: 'user' as const,
        content: 'What are people saying about SPCX?',
        createdAt: new Date('2026-09-13T10:00:00Z'),
      },
      {
        id: 'assistant-1',
        threadId: 'thread-1',
        role: 'assistant' as const,
        content:
          'I can pull the negative posts with quotes and links if you want them.',
        createdAt: new Date('2026-09-13T10:00:01Z'),
      },
    ];
    repository.listMessages.mockResolvedValueOnce(prior).mockResolvedValueOnce([
      ...prior,
      {
        id: 'user-2',
        threadId: 'thread-1',
        role: 'user',
        content: 'yh',
        createdAt: new Date('2026-09-13T10:00:02Z'),
      },
    ]);
    openai.responses.create.mockResolvedValue(
      responseStream({
        output_text: 'Here are the negative posts, with the points they made.',
        output: [],
      }),
    );

    for await (const event of service.streamMessage({
      walletAddress: 'wallet-1',
      threadId: 'thread-1',
      message: 'yh',
    })) {
      void event;
    }

    const creates = openai.responses.create.mock.calls as unknown as Array<
      [{ tool_choice: unknown; instructions: string }]
    >;
    expect(creates[0]?.[0].tool_choice).toBe('auto');
    expect(creates[0]?.[0].instructions).toContain('Any short agreement');
    expect(tools.dispatch).not.toHaveBeenCalled();
  });

  it('drops a repeated reply and answers again instead of sending it twice', async () => {
    const repeated =
      "I'll fetch and paste the nine negative SPCX posts with short quotes and direct links. Ready for me to pull?";
    const prior = [
      {
        id: 'user-1',
        threadId: 'thread-1',
        role: 'user' as const,
        content: 'List the negative SPCX posts',
        createdAt: new Date('2026-09-13T10:00:00Z'),
      },
      {
        id: 'assistant-1',
        threadId: 'thread-1',
        role: 'assistant' as const,
        content: repeated,
        createdAt: new Date('2026-09-13T10:00:01Z'),
      },
    ];
    repository.listMessages.mockResolvedValueOnce(prior).mockResolvedValueOnce([
      ...prior,
      {
        id: 'user-2',
        threadId: 'thread-1',
        role: 'user',
        content: "so what's the inference",
        createdAt: new Date('2026-09-13T10:00:02Z'),
      },
    ]);
    openai.responses.create
      .mockResolvedValueOnce(
        responseStream({ output_text: repeated, output: [] }, [repeated]),
      )
      .mockResolvedValueOnce(
        responseStream({
          output_text:
            'The bear case is dilution, and Za is the one saying it.',
          output: [],
        }),
      );

    const events: AgentStreamEvent[] = [];
    for await (const event of service.streamMessage({
      walletAddress: 'wallet-1',
      threadId: 'thread-1',
      message: "so what's the inference",
    })) {
      events.push(event);
    }

    expect(events.some((event) => event.type === 'assistant_reset')).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: 'turn_completed',
      message: {
        content: 'The bear case is dilution, and Za is the one saying it.',
      },
    });
    const second = openai.responses.create.mock.calls[1] as
      [{ input: unknown }] | undefined;
    expect(JSON.stringify(second?.[0].input)).toContain(
      'repeated your previous message',
    );
  });

  it('discards a tool-round preamble so the saved answer is the post-tool text', async () => {
    openai.responses.create
      .mockResolvedValueOnce(
        responseStream(
          {
            output: [
              {
                type: 'function_call',
                name: 'getStock',
                call_id: 'call-1',
                arguments: '{"assetIdOrTicker":"NVDA"}',
              },
            ],
          },
          ["I'll fetch that."],
        ),
      )
      .mockResolvedValueOnce(
        responseStream({ output_text: 'NVDA is up today.', output: [] }, [
          'NVDA is up today.',
        ]),
      );
    tools.dispatch.mockResolvedValue({ output: { ticker: 'NVDA' } });

    const events: AgentStreamEvent[] = [];
    for await (const event of service.streamMessage({
      walletAddress: 'wallet-1',
      message: 'Analyze NVDA',
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      'turn_started',
      'assistant_delta',
      'assistant_reset',
      'tool_started',
      'tool_completed',
      'assistant_delta',
      'turn_completed',
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'turn_completed',
      message: { content: 'NVDA is up today.' },
    });
  });

  it('puts an earlier Drip quote back into the next turn', async () => {
    const prior = [
      {
        id: 'user-1',
        threadId: 'thread-1',
        role: 'user' as const,
        content: 'What are people saying about SPCX?',
        createdAt: new Date('2026-09-13T10:00:00Z'),
      },
      {
        id: 'tool-1',
        threadId: 'thread-1',
        role: 'tool' as const,
        toolName: 'getDripOpinions',
        content: JSON.stringify({
          available: true,
          source: 'drip',
          queried: 'SPCX',
          ticker: 'SPCX',
          truncated: false,
          windowComplete: true,
          summary: {
            calls: 1,
            analysts: 1,
            bullish: 0,
            bearish: 1,
            neutral: 0,
            byAction: { OPINION: 1 },
          },
          opinions: [
            {
              author: 'Za',
              sourceLabel: 'Newsletter',
              stance: 'BEARISH',
              quote: 'Dilution is the real risk.',
              url: 'https://zastocks.com/spcx',
              date: '2026-10-30T00:00:00.000Z',
            },
          ],
          disclaimer: 'Opinions, not facts, and not financial advice.',
        }),
        createdAt: new Date('2026-09-13T10:00:01Z'),
      },
      {
        id: 'assistant-1',
        threadId: 'thread-1',
        role: 'assistant' as const,
        content: 'Mostly bullish: 31 of 40 recent opinions are positive.',
        createdAt: new Date('2026-09-13T10:00:02Z'),
      },
    ];
    repository.listMessages.mockResolvedValueOnce(prior).mockResolvedValueOnce([
      ...prior,
      {
        id: 'user-2',
        threadId: 'thread-1',
        role: 'user',
        content: "so what's the inference",
        createdAt: new Date('2026-09-13T10:00:03Z'),
      },
    ]);
    openai.responses.create.mockResolvedValue(
      responseStream({
        output_text: 'The bear case is dilution.',
        output: [],
      }),
    );

    for await (const event of service.streamMessage({
      walletAddress: 'wallet-1',
      threadId: 'thread-1',
      message: "so what's the inference",
    })) {
      void event;
    }

    const creates = openai.responses.create.mock.calls as unknown as Array<
      [{ instructions: string }]
    >;
    expect(creates[0]?.[0].instructions).toContain(
      'Dilution is the real risk.',
    );
    expect(creates[0]?.[0].instructions).not.toContain('not financial advice');
  });

  it('streams sourced company research for "research NVIDIA"', async () => {
    const message = 'research NVIDIA';
    const stock = { id: 'nvda', ticker: 'NVDA', name: 'NVIDIA' };
    const env = { OPENAI_MODEL: 'gpt-5-mini' } as never;
    const market = { getStock: jest.fn().mockResolvedValue(stock) };
    const research = { getStock: jest.fn() };
    const companyBrief = new CompanyBriefService(openai as never, env);
    const registry = new AgentToolRegistry(
      {} as never,
      {} as never,
      market as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      research as never,
      undefined,
      companyBrief,
    );
    service = new AgentService(
      repository as never,
      registry,
      portfolioService as never,
      env,
      openai as never,
    );
    repository.listMessages.mockResolvedValue([
      {
        id: 'user-research',
        threadId: 'thread-1',
        role: 'user',
        content: message,
        createdAt: thread.createdAt,
      },
    ]);

    const sections = [
      {
        title: 'NVIDIA Form 10-Q',
        url: 'https://investor.nvidia.com/files/doc_financials/2027/NVDA-2027-Q2-10Q-Final-including-exhibits.pdf',
        text: 'NVIDIA sells GPUs, networking and software to cloud providers and other buyers.',
      },
      {
        title: 'NVIDIA Q2 FY2027 results',
        url: 'https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2027/',
        text: 'In Q2 FY2027, reported August 26, revenue was $96.2 billion, up 106% year over year.',
      },
      {
        title: 'NVIDIA Q3 earnings date',
        url: 'https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Sets-Conference-Call-for-Third-Quarter-Financial-Results/',
        text: 'The November 17 results are the next checkpoint for demand after rapid data-center growth.',
      },
    ];
    const modelAnswer = sections
      .map(({ text, title }) => `${text} [${title}]`)
      .join('\n\n');
    const answer = sections
      .map(({ text, title, url }) => `${text} [${title}](<${url}>)`)
      .join('\n\n');
    openai.responses.create
      .mockResolvedValueOnce(
        responseStream({
          output: [
            {
              type: 'function_call',
              name: 'getCompanyBrief',
              call_id: 'public-research',
              arguments: '{"assetIdOrTicker":"NVDA"}',
            },
          ],
        }),
      )
      .mockResolvedValueOnce({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: sections.map(({ text, title, url }) => ({
              type: 'output_text',
              text,
              annotations: [{ type: 'url_citation', title, url }],
            })),
          },
        ],
      })
      .mockResolvedValueOnce(
        responseStream({ output_text: modelAnswer, output: [] }, [modelAnswer]),
      );

    const events: AgentStreamEvent[] = [];
    for await (const event of service.streamMessage({
      walletAddress: 'wallet-1',
      message,
    })) {
      events.push(event);
    }

    const [initial, publicLookup, synthesis] =
      openai.responses.create.mock.calls;
    expect(initial?.[0]).toMatchObject({
      input: [{ role: 'user', content: message }],
      tools: expect.arrayContaining([
        expect.objectContaining({ name: 'getCompanyBrief' }),
      ]),
    });
    expect(publicLookup?.[0]).toMatchObject({
      tool_choice: 'required',
      tools: [expect.objectContaining({ type: 'web_search' })],
    });
    expect(JSON.parse(publicLookup?.[0].input)).toEqual({
      company: 'NVIDIA',
      ticker: 'NVDA',
      asOf: expect.any(String),
    });
    const evidence = JSON.parse(
      synthesis?.[0].input.find(
        (item: { type?: string }) => item.type === 'function_call_output',
      ).output,
    );
    expect(evidence.evidence).toEqual(
      sections.map(({ text, title, url }) => ({
        text,
        sources: [{ title, url }],
      })),
    );
    expect(research.getStock).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: 'turn_completed',
      message: { content: answer },
    });
  });

  it('tells a sentiment mix not to relabel opportunity scores', async () => {
    openai.responses.create.mockResolvedValue(
      responseStream({
        output_text:
          'Writer opinions are not available on this turn, so this cannot be ranked by sentiment.',
        output: [],
      }),
    );

    for await (const event of service.streamMessage({
      walletAddress: 'wallet-1',
      message:
        'i want a stock mix for 100 on tech and ai companies that have the best sentiment in the market',
    })) {
      void event;
    }

    const instructions = (
      openai.responses.create.mock.calls as unknown as Array<
        [{ instructions: string }]
      >
    )[0]?.[0].instructions;
    expect(instructions).toMatch(/an opportunity score is momentum/i);
    expect(instructions).toContain('do not substitute a ranked list');
    expect(instructions).toContain('Do not offer to prepare a buy quote');
  });

  it('drops an unsolicited limit-order offer from the saved answer', async () => {
    const offered =
      'Mastercard has been climbing, with selling interest near ~$668. Recent trend up.\nWant me to propose a Jupiter Trigger limit buy around ~$605.84?';
    openai.responses.create.mockResolvedValue(
      responseStream({ output_text: offered, output: [] }, [offered]),
    );

    const events: AgentStreamEvent[] = [];
    for await (const event of service.streamMessage({
      walletAddress: 'wallet-1',
      message: 'can we go over the mastercard bro ?',
    })) {
      events.push(event);
    }

    expect(events.some((event) => event.type === 'assistant_reset')).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: 'turn_completed',
      message: {
        content:
          'Mastercard has been climbing, with selling interest near ~$668. Recent trend up.',
      },
    });
  });
});
