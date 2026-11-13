/** Raw Jupiter Trigger V1 request/response shapes. */

export interface JupiterTriggerCreateOrderRequest {
  inputMint: string;
  outputMint: string;
  maker: string;
  payer: string;
  params: {
    makingAmount: string;
    takingAmount: string;
    expiredAt?: string;
    slippageBps?: string;
  };
  computeUnitPrice?: string;
  wrapAndUnwrapSol?: boolean;
}

export interface JupiterTriggerCreateOrderResponse {
  requestId: string;
  transaction: string;
  order?: string;
  error?: string;
  cause?: string;
  code?: number;
}

export interface JupiterTriggerExecuteRequest {
  requestId: string;
  signedTransaction: string;
}

export interface JupiterTriggerExecuteResponse {
  signature?: string;
  status?: 'Success' | 'Failed';
  error?: string;
  code?: number;
  cause?: string;
}

export interface JupiterTriggerCancelOrderRequest {
  maker: string;
  order: string;
  computeUnitPrice?: string;
}

export interface JupiterTriggerCancelOrderResponse {
  requestId: string;
  transaction: string;
  error?: string;
  cause?: string;
  code?: number;
}

export interface JupiterTriggerOrderRaw {
  userPubkey: string;
  orderKey: string;
  inputMint: string;
  outputMint: string;
  makingAmount: string;
  takingAmount: string;
  remainingMakingAmount: string;
  remainingTakingAmount: string;
  rawMakingAmount: string;
  rawTakingAmount: string;
  rawRemainingMakingAmount: string;
  rawRemainingTakingAmount: string;
  slippageBps: string;
  expiredAt: string | null;
  createdAt: string;
  updatedAt: string;
  status: string;
  openTx: string;
  closeTx: string | null;
  programVersion: string;
  trades: unknown[];
}

export interface JupiterTriggerOrdersResponse {
  user: string;
  orderStatus: 'active' | 'history';
  orders: JupiterTriggerOrderRaw[];
  totalPages: number;
  page: number;
}
