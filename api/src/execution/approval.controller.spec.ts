import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { ApprovalController } from './approval.controller';
import { ApprovalService } from './approval.service';
jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));
describe('approval endpoint contract', () => {
  it('rejects transaction bytes, missing confirmation and malformed references', async () => {
    const approvals = {
      prepare: jest.fn().mockResolvedValue({ id: 'review' }),
      approve: jest.fn().mockResolvedValue({ status: 'submitted' }),
    };
    const module = await Test.createTestingModule({
      controllers: [ApprovalController],
      providers: [{ provide: ApprovalService, useValue: approvals }],
    }).compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    try {
      await request(app.getHttpServer() as Server)
        .post('/execution/approvals')
        .send({
          kind: 'swap',
          referenceId: 'quote',
          wallet: '11111111111111111111111111111111',
          transaction: 'client-transaction',
        })
        .expect(400);
      await request(app.getHttpServer() as Server)
        .post(
          '/execution/approvals/00000000-0000-4000-8000-000000000000/approve',
        )
        .send({})
        .expect(400);
      await request(app.getHttpServer() as Server)
        .post(
          '/execution/approvals/00000000-0000-4000-8000-000000000000/approve',
        )
        .send({ approved: 'true' })
        .expect(400);
      expect(approvals.prepare).not.toHaveBeenCalled();
      expect(approvals.approve).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
