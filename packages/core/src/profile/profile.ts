import * as Schema from 'valibot'

import { BaseError } from '../errors/base-error.js'
import * as Json from '../json/json.js'

export type Definition<Data extends Json.Value = Json.Value> = {
  readonly data: Data
  readonly fingerprint: string
  readonly icon?: string | undefined
  readonly id: string
  readonly kind: string
  readonly name: string
}

export type Input<Data extends Json.Value = Json.Value> = Omit<
  Definition<Data>,
  'fingerprint'
>

export class InvalidError extends BaseError {
  override readonly code = 'OALLET_PROFILE_INVALID'
  override name = 'Profile.InvalidError'
}

const inputSchema = Schema.strictObject({
  data: Schema.unknown(),
  icon: Schema.optional(Schema.string()),
  id: Schema.pipe(Schema.string(), Schema.trim(), Schema.minLength(1)),
  kind: Schema.pipe(Schema.string(), Schema.trim(), Schema.minLength(1)),
  name: Schema.pipe(Schema.string(), Schema.trim(), Schema.minLength(1)),
})

export function define<const Data extends Json.Value>(
  input: Input<Data>,
): Definition<Data> {
  const result = Schema.safeParse(inputSchema, input)
  if (!result.success) throw new InvalidError('Profile fields must be non-empty strings')
  try {
    Json.assert(result.output.data)
  } catch (cause) {
    throw new InvalidError('Profile data must be serializable JSON', { cause })
  }
  const normalized: Json.Value = {
    data: result.output.data,
    ...(result.output.icon === undefined ? {} : { icon: result.output.icon }),
    id: result.output.id,
    kind: result.output.kind,
    name: result.output.name,
  }
  const profile = {
    ...normalized,
    fingerprint: fingerprint(normalized),
  }
  return Json.freeze(profile) as Definition<Data>
}

export declare namespace define {
  type Options<Data extends Json.Value = Json.Value> = Input<Data>
  type ReturnType<Data extends Json.Value = Json.Value> = Definition<Data>
}

function fingerprint(profile: Json.Value): string {
  const bytes = new TextEncoder().encode(Json.stringify(profile))
  let hash = 0xcbf29ce484222325n
  for (const byte of bytes) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `oallet_${hash.toString(16).padStart(16, '0')}`
}
