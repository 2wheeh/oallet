import {
  assertIsFullySignedTransaction,
  type Commitment,
  type GetSignatureStatusesApi,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type Rpc,
  type RpcSubscriptions,
  type SendTransactionApi,
  type Signature,
  type SignatureNotificationsApi,
  signature,
  type Transaction,
} from '@solana/kit'
import { createRecentSignatureConfirmationPromiseFactory } from '@solana/transaction-confirmation'

import { ConfirmationError, SubmissionError } from '../errors/errors.js'
import type * as Profile from '../profile/keypair.js'

export type ChainBinding = {
  readonly chain: Profile.Chain
  readonly rpc: Rpc<SendTransactionApi & GetSignatureStatusesApi>
  readonly rpcSubscriptions: RpcSubscriptions<SignatureNotificationsApi>
}

export type SendOptions = {
  /** When omitted, return after RPC submission without waiting for confirmation. */
  readonly commitment?: Commitment
  readonly preflightCommitment?: Commitment
  readonly minContextSlot?: number
  readonly maxRetries?: number
  readonly skipPreflight?: boolean
}

export async function sendTransaction({
  binding,
  options,
  signal,
  timeoutMs,
  transaction,
}: {
  binding: ChainBinding
  options: SendOptions
  signal: AbortSignal
  timeoutMs: number
  transaction: Transaction
}): Promise<{ signature: number[] }> {
  const abortSignal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
  abortSignal.throwIfAborted()
  let rejectOnAbort = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    rejectOnAbort = () => reject(abortSignal.reason)
    abortSignal.addEventListener('abort', rejectOnAbort, { once: true })
  })
  try {
    return await Promise.race([submit(), cancelled])
  } finally {
    abortSignal.removeEventListener('abort', rejectOnAbort)
  }

  async function submit() {
    let transactionSignature: Signature
    try {
      assertIsFullySignedTransaction(transaction)
      const expected = getSignatureFromTransaction(transaction)
      const preflightCommitment = options.preflightCommitment ?? options.commitment
      transactionSignature = signature(
        await binding.rpc
          .sendTransaction(getBase64EncodedWireTransaction(transaction), {
            encoding: 'base64',
            ...(preflightCommitment ? { preflightCommitment } : {}),
            ...(options.skipPreflight === undefined
              ? {}
              : { skipPreflight: options.skipPreflight }),
            ...(options.maxRetries === undefined
              ? {}
              : { maxRetries: BigInt(options.maxRetries) }),
            ...(options.minContextSlot === undefined
              ? {}
              : { minContextSlot: BigInt(options.minContextSlot) }),
          })
          .send({ abortSignal }),
      )
      abortSignal.throwIfAborted()
      if (transactionSignature !== expected) {
        throw new Error('RPC returned a different transaction signature')
      }
    } catch (cause) {
      abortSignal.throwIfAborted()
      throw new SubmissionError('Failed to submit Solana transaction', { cause })
    }
    if (options.commitment !== undefined) {
      try {
        // Wire transactions contain no lastValidBlockHeight. Confirm the original
        // signature without attaching the lifetime of a newly fetched blockhash.
        await createRecentSignatureConfirmationPromiseFactory(binding)({
          abortSignal,
          commitment: options.commitment,
          signature: transactionSignature,
        })
        // Kit 7.1.1 may resolve its subscription iterator on abort.
        abortSignal.throwIfAborted()
      } catch (cause) {
        abortSignal.throwIfAborted()
        throw new ConfirmationError('Failed to confirm Solana transaction', { cause })
      }
    }
    return { signature: [...getBase58Encoder().encode(transactionSignature)] }
  }
}
