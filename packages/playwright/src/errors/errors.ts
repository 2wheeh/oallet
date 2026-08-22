import { Errors } from '@oallet/core'

export class AlreadyAttachedError extends Errors.BaseError {
  override readonly code = 'OALLET_PLAYWRIGHT_ALREADY_ATTACHED'
  override name = 'Playwright.AlreadyAttachedError'
}

export class ExistingPageError extends Errors.BaseError {
  override readonly code = 'OALLET_PLAYWRIGHT_EXISTING_PAGE'
  override name = 'Playwright.ExistingPageError'
}

export class InvalidRequestError extends Errors.BaseError {
  override readonly code = 'OALLET_PLAYWRIGHT_REQUEST_INVALID'
  override name = 'Playwright.InvalidRequestError'
}

export class UnsupportedFrameError extends Errors.BaseError {
  override readonly code = 'OALLET_PLAYWRIGHT_FRAME_UNSUPPORTED'
  override name = 'Playwright.UnsupportedFrameError'
}

export class QrNotFoundError extends Errors.BaseError {
  override readonly code = 'OALLET_PLAYWRIGHT_QR_NOT_FOUND'
  override name = 'Playwright.QrNotFoundError'
}
