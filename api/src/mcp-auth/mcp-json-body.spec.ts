import express from 'express';
import request from 'supertest';
import { registerMcpJsonBodyParser } from './mcp-json-body';

describe('custom MCP JSON body parser', () => {
  it('parses early MCP grant requests without consuming OAuth bodies', async () => {
    const app = express();
    registerMcpJsonBodyParser(app);
    app.post('/mcp/delegation/prepare', (req, res) => {
      const payload: unknown = req.body;
      res.json({ body: payload });
    });
    app.post('/oauth/reg', (req, res) =>
      res.json({ alreadyParsed: req.body !== undefined }),
    );

    await request(app)
      .post('/mcp/delegation/prepare')
      .send({ perTradeUsd: 1, dailyUsd: 2 })
      .expect(200, { body: { perTradeUsd: 1, dailyUsd: 2 } });
    await request(app)
      .post('/oauth/reg')
      .send({ client_name: 'test' })
      .expect(200, { alreadyParsed: false });
  });

  it("does not use the jsonParser name that suppresses Nest's global parser", () => {
    const app = express();
    registerMcpJsonBodyParser(app);
    const names = app.router.stack.map((layer) => layer.handle?.name);
    expect(names).not.toContain('jsonParser');
  });
});
