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

export class ProposalTimeoutError extends Errors.BaseError {
  override readonly code = 'OALLET_WC_PROPOSAL_TIMEOUT'
  override name = 'WalletConnect.ProposalTimeoutError'
}

export class UnsupportedNamespacesError extends Errors.BaseError {
  override readonly code = 'OALLET_WC_NAMESPACES_UNSUPPORTED'
  override name = 'WalletConnect.UnsupportedNamespacesError'
}

export class SessionNotFoundError extends Errors.BaseError {
  override readonly code = 'OALLET_WC_SESSION_NOT_FOUND'
  override name = 'WalletConnect.SessionNotFoundError'
}
