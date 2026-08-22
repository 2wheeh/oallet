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
}

export class UnauthorizedError extends Errors.BaseError {
  override readonly code = 'OALLET_EVM_UNAUTHORIZED'
  override name = 'Evm.UnauthorizedError'
}

export class InvalidParamsError extends Errors.BaseError {
  override readonly code = 'OALLET_EVM_INVALID_PARAMS'
  override name = 'Evm.InvalidParamsError'
}

export class UnsupportedMethodError extends Errors.BaseError {
  override readonly code = 'OALLET_EVM_UNSUPPORTED_METHOD'
  override name = 'Evm.UnsupportedMethodError'
}
