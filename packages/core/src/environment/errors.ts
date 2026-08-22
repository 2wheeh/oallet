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
}

export class RequestSettledError extends BaseError {
  override readonly code = 'OALLET_ENVIRONMENT_REQUEST_SETTLED'
  override name = 'Environment.RequestSettledError'
}

export class ResetError extends BaseError {
  override readonly code = 'OALLET_ENVIRONMENT_RESET'
  override name = 'Environment.ResetError'
}

export class InvalidSnapshotError extends BaseError {
  override readonly code = 'OALLET_ENVIRONMENT_INVALID_SNAPSHOT'
  override name = 'Environment.InvalidSnapshotError'
}
