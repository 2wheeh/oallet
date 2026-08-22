import { BaseError } from '../errors/base-error.js'

export type Primitive = boolean | null | number | string
export type Value = Primitive | readonly Value[] | { readonly [key: string]: Value }

export class InvalidError extends BaseError {
  override readonly code = 'OALLET_JSON_INVALID'
  override name = 'Json.InvalidError'
}

export function isValue(value: unknown, seen = new Set<object>()): value is Value {
  if (value === null) return true
  if (typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  const valid = Array.isArray(value)
    ? value.every((item) => isValue(item, seen))
    : Object.getPrototypeOf(value) === Object.prototype &&
      Object.values(value).every((item) => isValue(item, seen))
  seen.delete(value)
  return valid
}

export function assert(value: unknown): asserts value is Value {
  if (!isValue(value)) throw new InvalidError('Value must be finite, acyclic JSON data')
}

export function freeze<ValueType extends Value>(value: ValueType): ValueType {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) freeze(nested)
    Object.freeze(value)
  }
  return value
}

export function stringify(value: Value): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stringify(item)).join(',')}]`
  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  )
  return `{${entries
    .map(([key, nested]) => `${JSON.stringify(key)}:${stringify(nested)}`)
    .join(',')}}`
}
