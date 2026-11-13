import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import type { Express, Request, Response } from 'express';
import request from 'supertest';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { registerMcpJsonBodyParser } from '../mcp-auth/mcp-json-body';
import { AgentController } from './agent.controller';
import { AgentUsageLimit } from '../common/rate-limit';
import { AgentService } from './agent.service';

jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));

const chat = {
  walletAddress: 'So11111111111111111111111111111111111111112',
  message: 'What is Apple stock doing today?',
  context: { page: 'dashboard' },
};

describe('agent JSON bodies behind the MCP parser', () => {
  it('parses a chat payload on both agent routes and still parses MCP JSON', async () => {
    const auth = {
      requireWallet: jest.fn().mockResolvedValue('did:privy:user'),
    };
    const agent = {
      message: jest.fn((body: { message: string }) => ({
        threadId: 'thread-1',
        message: {
          id: 'msg-1',
          threadId: 'thread-1',
          role: 'assistant',
          content: `echo:${body.message}`,
          createdAt: new Date('2026-11-02T00:00:00.000Z'),
        },
        artifacts: [],
        events: [],
      })),
      streamMessage: jest.fn(function* (body: { message: string }) {
        yield { type: 'assistant_delta', delta: body.message };
      }),
    };
    const module = await Test.createTestingModule({
      controllers: [AgentController],
      providers: [
        { provide: AgentService, useValue: agent },
        { provide: PrivyWalletAuth, useValue: auth },
        AgentUsageLimit,
      ],
    }).compile();
    const app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    // Same order as bootstrap(): MCP parser and early routes, then listen()/init()
    // where Nest decides whether to install the global JSON parser.
    const expressApp = app.getHttpAdapter().getInstance() as Express;
    registerMcpJsonBodyParser(expressApp);
    expressApp.post(
      '/mcp/delegation/prepare',
      (req: Request, res: Response) => {
        const payload: unknown = req.body;
        res.json({ body: payload });
      },
    );
    expressApp.post('/oauth/reg', (req: Request, res: Response) => {
      res.json({ alreadyParsed: req.body !== undefined });
    });
    await app.init();

    try {
      const message = await request(app.getHttpServer() as Server)
        .post('/api/agent/message')
        .set('Authorization', 'Bearer session')
        .send(chat)
        .expect(201);
      expect(message.body).toMatchObject({
        message: { content: `echo:${chat.message}` },
      });
      expect(agent.message).toHaveBeenCalledWith(
        expect.objectContaining({
          walletAddress: chat.walletAddress,
          message: chat.message,
        }),
        'Bearer session',
      );

      const stream = await request(app.getHttpServer() as Server)
        .post('/api/agent/message/stream')
        .set('Authorization', 'Bearer session')
        .send(chat)
        .expect(200);
      expect(stream.headers['content-type']).toContain('text/event-stream');
      expect(stream.text).toContain(chat.message);
      expect(agent.streamMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          walletAddress: chat.walletAddress,
          message: chat.message,
        }),
        expect.any(AbortSignal),
        'Bearer session',
      );
      expect(auth.requireWallet).toHaveBeenCalledWith(
        'Bearer session',
        chat.walletAddress,
      );

      await request(app.getHttpServer() as Server)
        .post('/mcp/delegation/prepare')
        .send({ perTradeUsd: 1, dailyUsd: 2 })
        .expect(200, { body: { perTradeUsd: 1, dailyUsd: 2 } });
      await request(app.getHttpServer() as Server)
        .post('/oauth/reg')
        .send({ client_name: 'test' })
        .expect(200, { alreadyParsed: false });
    } finally {
      await app.close();
    }
  });
});
