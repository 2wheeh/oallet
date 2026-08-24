import { BaseError } from '../errors/base-error.js'

export class DuplicateWalletError extends BaseError {
  override readonly code = 'OALLET_ENVIRONMENT_DUPLICATE_WALLET'
  override name = 'Environment.DuplicateWalletError'
}

export class WalletNotFoundError extends BaseError {
  override readonly code = 'OALLET_ENVIRONMENT_WALLET_NOT_FOUND'
  override name = 'Environment.WalletNotFoundError'
}

export class RequestRejectedError extends BaseError {
  override readonly code = 'OALLET_ENVIRONMENT_REQUEST_REJECTED'
  override name = 'Environment.RequestRejectedError'
  readonly providerCode = 4001
}

export class ProviderRpcError extends Error {
  override name = 'Environment.ProviderRpcError'

  constructor(
    readonly providerCode: number,
    message: string,
    readonly data?: import('../json/json.js').Value | undefined,
  ) {
    super(message)
  }
}

export class RequestSettledError extends BaseError {
  override readonly code = 'OALLET_ENVIRONMENT_REQUEST_SETTLED'
  override name = 'Environment.RequestSettledError'
}

export class RequestExpiredError extends BaseError {
  override readonly code = 'OALLET_ENVIRONMENT_REQUEST_EXPIRED'
  override name = 'Environment.RequestExpiredError'
}

export class UnexpectedRequestError extends BaseError {
  override readonly code = 'OALLET_ENVIRONMENT_UNEXPECTED_REQUEST'
  override name = 'Environment.UnexpectedRequestError'
}

export class ResetError extends BaseError {
  override readonly code = 'OALLET_ENVIRONMENT_RESET'
  override name = 'Environment.ResetError'
}

export class InvalidSnapshotError extends BaseError {
  override readonly code = 'OALLET_ENVIRONMENT_INVALID_SNAPSHOT'
  override name = 'Environment.InvalidSnapshotError'
}

export class PendingRequestError extends BaseError {
  override readonly code = 'OALLET_ENVIRONMENT_PENDING_REQUEST'
  override name = 'Environment.PendingRequestError'
}

export class EnvironmentDisposedError extends BaseError {
  override readonly code = 'OALLET_ENVIRONMENT_DISPOSED'
  override name = 'Environment.EnvironmentDisposedError'
}
