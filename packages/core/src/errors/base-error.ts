export class BaseError extends Error {
  readonly code: string = 'OALLET_ERROR'

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'OalletError'
  }
}
