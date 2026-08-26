import { Errors } from '@oallet/core'

export class InvalidProfileError extends Errors.BaseError {
  override readonly code = 'OALLET_EVM_PROFILE_INVALID'
  override name = 'Evm.InvalidProfileError'
}

export class DuplicateChainError extends Errors.BaseError {
  override readonly code = 'OALLET_EVM_CHAIN_DUPLICATE'
  override name = 'Evm.DuplicateChainError'
}

export class ChainNotConfiguredError extends Errors.BaseError {
  override readonly code = 'OALLET_EVM_CHAIN_NOT_CONFIGURED'
  override name = 'Evm.ChainNotConfiguredError'
  readonly providerCode = 4902
}

export class UnauthorizedError extends Errors.BaseError {
  override readonly code = 'OALLET_EVM_UNAUTHORIZED'
  override name = 'Evm.UnauthorizedError'
  readonly providerCode = 4100
}

export class InvalidParamsError extends Errors.BaseError {
  override readonly code = 'OALLET_EVM_INVALID_PARAMS'
  override name = 'Evm.InvalidParamsError'
  readonly providerCode = -32602
}

export class UnsupportedMethodError extends Errors.BaseError {
  override readonly code = 'OALLET_EVM_UNSUPPORTED_METHOD'
  override name = 'Evm.UnsupportedMethodError'
  readonly providerCode = 4200
}

export class ConnectionNotFoundError extends Errors.BaseError {
  override readonly code = 'OALLET_EVM_CONNECTION_NOT_FOUND'
  override name = 'Evm.ConnectionNotFoundError'
}

export class StaleConnectionError extends Errors.BaseError {
  override readonly code = 'OALLET_EVM_CONNECTION_STALE'
  override name = 'Evm.StaleConnectionError'
}

export class ConnectionDisposedError extends Errors.BaseError {
  override readonly code = 'OALLET_EVM_CONNECTION_DISPOSED'
  override name = 'Evm.ConnectionDisposedError'
}

export class ProviderDisconnectedError extends Errors.BaseError {
  override readonly code = 'OALLET_EVM_PROVIDER_DISCONNECTED'
  override name = 'Evm.ProviderDisconnectedError'
  readonly providerCode = 4900
}

export class RpcUnavailableError extends Errors.BaseError {
  override readonly code = 'OALLET_EVM_RPC_UNAVAILABLE'
  override name = 'Evm.RpcUnavailableError'
}
