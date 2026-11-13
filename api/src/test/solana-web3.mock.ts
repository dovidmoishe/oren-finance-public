import { createHash } from 'node:crypto';

export class PublicKey {
  constructor(private readonly value: string) {}

  toBase58(): string {
    return this.value;
  }

  toBuffer(): Buffer {
    return createHash('sha256').update(this.value).digest();
  }

  static findProgramAddressSync(
    seeds: Buffer[],
    programId: PublicKey,
  ): [PublicKey, number] {
    const hash = createHash('sha256')
      .update(Buffer.concat([...seeds, programId.toBuffer()]))
      .digest('hex')
      .slice(0, 32);
    return [new PublicKey(`pda-${hash}`), 255];
  }
}

export const SystemProgram = {
  programId: new PublicKey('11111111111111111111111111111111'),
};

export class TransactionInstruction {
  constructor(readonly input: unknown) {}
}

export class Transaction {
  private instructions: unknown[] = [];

  constructor(readonly input: unknown) {}

  add(...instructions: unknown[]): this {
    this.instructions.push(...instructions);
    return this;
  }

  serialize(): Buffer {
    return Buffer.from(JSON.stringify({ input: this.input, instructions: this.instructions }));
  }
}

export class Connection {
  constructor(readonly endpoint: string) {}

  async getLatestBlockhash() {
    return { blockhash: 'mock-blockhash' };
  }

  async getAccountInfo() {
    return { owner: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') };
  }
}
