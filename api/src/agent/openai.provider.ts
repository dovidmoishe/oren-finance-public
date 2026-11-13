import { Inject } from '@nestjs/common';
import OpenAI from 'openai';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';

export const OPENAI_CLIENT = Symbol('OPENAI_CLIENT');

export type OpenAIClient = OpenAI | null;

export const openAiClientProvider = {
  provide: OPENAI_CLIENT,
  useFactory: (env: AppEnv): OpenAIClient => {
    if (!env.OPENAI_API_KEY?.trim()) return null;
    return new OpenAI({ apiKey: env.OPENAI_API_KEY });
  },
  inject: [APP_ENV],
};

export const InjectOpenAIClient = () => Inject(OPENAI_CLIENT);
