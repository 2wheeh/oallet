import { Errors } from '@oallet/core'

export class InvalidProfileError extends Errors.BaseError {
  override readonly code = 'OALLET_SOLANA_PROFILE_INVALID'
  override name = 'Solana.InvalidProfileError'
}

export class UnauthorizedError extends Errors.BaseError {
  override readonly code = 'OALLET_SOLANA_UNAUTHORIZED'
  override name = 'Solana.UnauthorizedError'
  readonly providerCode = 4100
}

export class InvalidParamsError extends Errors.BaseError {
  override readonly code = 'OALLET_SOLANA_INVALID_PARAMS'
  override name = 'Solana.InvalidParamsError'
  readonly providerCode = -32602
}

export class UnsupportedMethodError extends Errors.BaseError {
  override readonly code = 'OALLET_SOLANA_UNSUPPORTED_METHOD'
  override name = 'Solana.UnsupportedMethodError'
  readonly providerCode = 4200
}

export class ConnectionNotFoundError extends Errors.BaseError {
  override readonly code = 'OALLET_SOLANA_CONNECTION_NOT_FOUND'
  override name = 'Solana.ConnectionNotFoundError'
}

export class StaleConnectionError extends Errors.BaseError {
  override readonly code = 'OALLET_SOLANA_CONNECTION_STALE'
  override name = 'Solana.StaleConnectionError'
}

export class ConnectionDisposedError extends Errors.BaseError {
  override readonly code = 'OALLET_SOLANA_CONNECTION_DISPOSED'
  override name = 'Solana.ConnectionDisposedError'
}

export class WalletDisconnectedError extends Errors.BaseError {
  override readonly code = 'OALLET_SOLANA_DISCONNECTED'
  override name = 'Solana.WalletDisconnectedError'
  readonly providerCode = 4900
}
