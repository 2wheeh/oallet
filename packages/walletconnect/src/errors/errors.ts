import { Errors } from '@oallet/core'

export class ProjectIdRequiredError extends Errors.BaseError {
  override readonly code = 'OALLET_WC_PROJECT_ID_REQUIRED'
  override name = 'WalletConnect.ProjectIdRequiredError'
}

export class InvalidUriError extends Errors.BaseError {
  override readonly code = 'OALLET_WC_URI_INVALID'
  override name = 'WalletConnect.InvalidUriError'
}

export class PairingInProgressError extends Errors.BaseError {
  override readonly code = 'OALLET_WC_PAIRING_IN_PROGRESS'
  override name = 'WalletConnect.PairingInProgressError'
}

export class PairingTimeoutError extends Errors.BaseError {
  override readonly code = 'OALLET_WC_PAIRING_TIMEOUT'
  override name = 'WalletConnect.PairingTimeoutError'
}

export class PairingResetError extends Errors.BaseError {
  override readonly code = 'OALLET_WC_PAIRING_RESET'
  override name = 'WalletConnect.PairingResetError'
}

export class ProposalSettledError extends Errors.BaseError {
  override readonly code = 'OALLET_WC_PROPOSAL_SETTLED'
  override name = 'WalletConnect.ProposalSettledError'
}

export class UnsupportedNamespacesError extends Errors.BaseError {
  override readonly code = 'OALLET_WC_NAMESPACES_UNSUPPORTED'
  override name = 'WalletConnect.UnsupportedNamespacesError'
}

export class ClientDisposedError extends Errors.BaseError {
  override readonly code = 'OALLET_WC_CLIENT_DISPOSED'
  override name = 'WalletConnect.ClientDisposedError'
}
