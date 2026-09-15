import { readFile } from 'node:fs/promises'
import { Environment, Json, type Profile } from '@oallet/core'
import type { BrowserContext, Frame, Page } from '@playwright/test'

import {
  AlreadyAttachedError,
  DeliveryError,
  ExistingPageError,
  InvalidRequestError,
  UnsupportedFrameError,
} from '../errors/errors.js'

import {
  type BridgeMessage,
  type BrowserGlobals,
  type BrowserProfile,
  bindingName,
  type RequestResponse,
} from './protocol.js'

const attachedContexts = new WeakSet<BrowserContext>()

type ProviderSession = {
  readonly frame: Frame
  readonly origin: string
  readonly pending: Map<string, AbortController>
  readonly walletId: string
}

type EnvironmentPort = {
  readonly [Environment.controller]: Environment.Controller
  readonly profiles: readonly Profile.Definition[]
  dispatch(input: Environment.DispatchInput): Promise<Json.Value>
}

export type Handle = {
  readonly environment: EnvironmentPort
  readonly profiles: readonly Profile.Definition[]
  dispose(): Promise<void>
}

export async function attach(options: attach.Options): Promise<Handle> {
  const { context, environment } = options
  if (attachedContexts.has(context)) {
    throw new AlreadyAttachedError('This browser context already has an Oallet bridge')
  }
  if (context.pages().length > 0) {
    throw new ExistingPageError(
      'Attach Oallet before creating a page so the browser bootstrap runs before app code',
    )
  }
  attachedContexts.add(context)
  const sessions = new Map<string, ProviderSession>()
  const endSession = (providerSessionId: string) => {
    const session = sessions.get(providerSessionId)
    if (!session) return
    sessions.delete(providerSessionId)
    for (const controller of session.pending.values()) controller.abort()
    session.pending.clear()
  }
  const endFrame = (frame: Frame) => {
    for (const [providerSessionId, session] of sessions) {
      if (session.frame === frame) endSession(providerSessionId)
    }
  }
  const observePage = (page: Page) => {
    page.on('close', () => endFrame(page.mainFrame()))
  }
  context.on('page', observePage)
  let unsubscribe: () => void = () => undefined
  try {
    await context.exposeBinding(bindingName, async (source, payload: unknown) => {
      if (source.frame !== source.page.mainFrame()) {
        throw new UnsupportedFrameError(
          'Oallet only accepts requests from top-level frames',
        )
      }
      const message = parseMessage(payload)
      const origin = frameOrigin(source.frame)
      if (message.type === 'register') {
        for (const [id, session] of sessions) {
          if (session.frame === source.frame && session.walletId === message.walletId) {
            endSession(id)
          }
        }
        sessions.set(message.providerSessionId, {
          frame: source.frame,
          origin,
          pending: new Map(),
          walletId: message.walletId,
        })
        return environment[Environment.controller].state(message.walletId, origin)
      }
      const session = sessions.get(message.providerSessionId)
      if (
        !session ||
        session.frame !== source.frame ||
        session.origin !== origin ||
        session.walletId !== message.walletId
      ) {
        throw new InvalidRequestError('Browser request provider session is not active')
      }
      const abort = new AbortController()
      session.pending.set(message.requestId, abort)
      try {
        const result = await environment.dispatch({
          method: message.method,
          origin,
          ...(message.params === undefined ? {} : { params: message.params }),
          providerSessionId: message.providerSessionId,
          requestId: message.requestId,
          signal: abort.signal,
          walletId: message.walletId,
        })
        return {
          protocolVersion: 1,
          requestId: message.requestId,
          result,
        } satisfies RequestResponse
      } catch (error) {
        return {
          error: providerError(error),
          protocolVersion: 1,
          requestId: message.requestId,
        } satisfies RequestResponse
      } finally {
        session.pending.delete(message.requestId)
      }
    })
    unsubscribe = environment[Environment.controller].subscribe(async (event) => {
      const targets = [...sessions].filter(
        ([, session]) =>
          session.walletId === event.walletId && session.origin === event.origin,
      )
      await Promise.all(
        targets.map(async ([providerSessionId, session]) => {
          if (session.frame.isDetached() || session.frame.page().isClosed()) {
            endSession(providerSessionId)
            return
          }
          let delivered: boolean
          try {
            delivered = await session.frame.evaluate(
              ({ name, providerSessionId, serializedData }) => {
                const deliver = (globalThis as BrowserGlobals).__oallet_emit_v1__
                return (
                  deliver?.(
                    providerSessionId,
                    name,
                    serializedData === undefined ? undefined : JSON.parse(serializedData),
                  ) ?? false
                )
              },
              {
                name: event.name,
                providerSessionId,
                ...(event.data === undefined
                  ? {}
                  : { serializedData: JSON.stringify(event.data) }),
              },
            )
          } catch (error) {
            if (
              !sessions.has(providerSessionId) ||
              session.frame.isDetached() ||
              session.frame.page().isClosed()
            ) {
              endSession(providerSessionId)
              return
            }
            environment[Environment.controller].delivery({
              data: {
                message: error instanceof Error ? error.message : String(error),
              },
              delivered: false,
              name: event.name,
              origin: event.origin,
              providerSessionId,
              walletId: event.walletId,
            })
            throw new DeliveryError(
              `Failed to deliver ${event.name} to provider session ${providerSessionId}`,
              { cause: error },
            )
          }
          if (!delivered) {
            environment[Environment.controller].delivery({
              data: { message: 'The provider did not acknowledge the event' },
              delivered: false,
              name: event.name,
              origin: event.origin,
              providerSessionId,
              walletId: event.walletId,
            })
            endSession(providerSessionId)
            throw new DeliveryError(
              `Provider session ${providerSessionId} did not acknowledge ${event.name}`,
            )
          }
          environment[Environment.controller].delivery({
            ...(event.data === undefined ? {} : { data: event.data }),
            delivered: true,
            name: event.name,
            origin: event.origin,
            providerSessionId,
            walletId: event.walletId,
          })
        }),
      )
    })
    const profiles: BrowserProfile[] = environment.profiles.map(
      ({ icon, id, kind, name, rdns }) => ({
        ...(icon === undefined ? {} : { icon }),
        id,
        kind,
        name,
        ...(rdns === undefined ? {} : { rdns }),
      }),
    )
    // Both src/browser and the unbundled dist/browser resolve this packaged asset.
    const runtime = await readFile(
      new URL('../../dist/browser/runtime.iife.js', import.meta.url),
      'utf8',
    )
    await context.addInitScript({
      content: `(() => {
${runtime}
oalletRuntime.bootstrap(${JSON.stringify(profiles)});
})()`,
    })
  } catch (error) {
    unsubscribe()
    attachedContexts.delete(context)
    throw error
  }
  let active = true
  return {
    async dispose() {
      if (!active) return
      active = false
      context.off('page', observePage)
      unsubscribe()
      for (const providerSessionId of [...sessions.keys()]) {
        endSession(providerSessionId)
      }
    },
    environment,
    profiles: environment.profiles,
  }
}

export declare namespace attach {
  type Options = {
    readonly context: BrowserContext
    readonly environment: EnvironmentPort
  }
  type ReturnType = Handle
}

function frameOrigin(frame: Frame) {
  const origin = new URL(frame.url()).origin
  if (origin === 'null') {
    throw new InvalidRequestError('Wallet requests require an http or https origin')
  }
  return origin
}

function parseMessage(value: unknown): BridgeMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidRequestError('Browser bridge message must be an object')
  }
  const message = value as Record<string, unknown>
  if (message.protocolVersion !== 1) {
    throw new InvalidRequestError('Unsupported browser bridge protocol version')
  }
  if (
    typeof message.providerSessionId !== 'string' ||
    typeof message.walletId !== 'string'
  ) {
    throw new InvalidRequestError(
      'Browser bridge message requires providerSessionId and walletId',
    )
  }
  if (message.type === 'register') {
    return {
      protocolVersion: 1,
      providerSessionId: message.providerSessionId,
      type: 'register',
      walletId: message.walletId,
    }
  }
  if (
    message.type !== 'request' ||
    typeof message.requestId !== 'string' ||
    typeof message.method !== 'string'
  ) {
    throw new InvalidRequestError(
      'Browser request requires requestId, walletId, and method',
    )
  }
  if (message.params !== undefined) {
    try {
      Json.assert(message.params)
    } catch (cause) {
      throw new InvalidRequestError('Browser request params must be JSON data', { cause })
    }
  }
  return {
    method: message.method,
    ...(message.params === undefined ? {} : { params: message.params as Json.Value }),
    protocolVersion: 1,
    providerSessionId: message.providerSessionId,
    requestId: message.requestId,
    type: 'request',
    walletId: message.walletId,
  }
}

function providerError(error: unknown): NonNullable<RequestResponse['error']> {
  const candidate = error as {
    readonly code?: unknown
    readonly data?: unknown
    readonly message?: unknown
    readonly providerCode?: unknown
  }
  const code =
    typeof candidate.providerCode === 'number'
      ? candidate.providerCode
      : typeof candidate.code === 'number'
        ? candidate.code
        : -32603
  return {
    code,
    ...(Json.isValue(candidate.data) ? { data: candidate.data } : {}),
    message:
      typeof candidate.message === 'string'
        ? candidate.message
        : 'The wallet request failed',
  }
}
