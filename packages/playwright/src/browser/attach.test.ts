import { Environment, Profile, type Wallet } from '@oallet/core'
import { chromium, type Page } from '@playwright/test'
import type { EIP6963ProviderDetail } from 'mipd'
import { expect, test, vi } from 'vitest'

import { DeliveryError } from '../errors/errors.js'
import * as Browser from './exports.js'
import { bindingName } from './protocol.js'

const solanaAccount = {
  address: '11111111111111111111111111111111',
  chains: ['solana:localnet'],
  features: ['solana:signMessage', 'solana:signTransaction'],
  publicKey: Array<number>(32).fill(0),
}

function solanaEnvironment(prepare: Wallet.Adapter['prepare'], canSend = false) {
  const features = [
    ...solanaAccount.features,
    ...(canSend ? ['solana:signAndSendTransaction'] : []),
  ]
  const adapter: Wallet.Adapter = {
    prepare,
    profile: Profile.define({
      data: { chains: ['solana:localnet'] },
      id: 'solana-wallet',
      kind: 'solana:keypair',
      name: 'Solana Wallet',
    }),
    reset() {},
    restore() {},
    snapshot: () => null,
    state: () => ({ accounts: [{ ...solanaAccount, features }], features }),
    validateSnapshot() {},
  }
  return Environment.create({ wallets: [adapter] })
}

test('bridges Wallet Standard transaction signing with and without a chain', async () => {
  const requests: Wallet.Input[] = []
  const environment = solanaEnvironment((input) => {
    requests.push(input)
    if (input.method === 'standard:connect') {
      return { type: 'return', value: [solanaAccount] }
    }
    return { type: 'return', value: [{ signedTransaction: [4, 5, 6] }] }
  })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  try {
    await context.route('https://app.example/**', (route) =>
      route.fulfill({
        body: '<!doctype html><title>Fixture</title>',
        contentType: 'text/html',
      }),
    )
    await Browser.attach({ context, environment })
    const page = await context.newPage()
    await page.goto('https://app.example/')
    const signed = await page.evaluate(async () => {
      type Account = { readonly address: string }
      type StandardWallet = {
        readonly features: {
          readonly 'standard:connect': { connect(): Promise<{ accounts: Account[] }> }
          readonly 'solana:signTransaction': {
            signTransaction(input: {
              account: Account
              chain?: string
              transaction: Uint8Array
            }): Promise<{ signedTransaction: Uint8Array }[]>
          }
        }
      }
      let wallet: StandardWallet | undefined
      window.dispatchEvent(
        new CustomEvent('wallet-standard:app-ready', {
          detail: {
            register(value: StandardWallet) {
              wallet = value
            },
          },
        }),
      )
      if (!wallet) throw new Error('Wallet was not discovered')
      if ('solana:signAndSendTransaction' in wallet.features)
        throw new Error('Signing-only wallet advertised sending')
      const { accounts } = await wallet.features['standard:connect'].connect()
      const account = accounts[0]
      if (!account) throw new Error('Wallet returned no accounts')
      const outputs: number[][] = []
      for (const chain of [undefined, 'solana:localnet']) {
        const [output] = await wallet.features['solana:signTransaction'].signTransaction({
          account,
          ...(chain === undefined ? {} : { chain }),
          transaction: new Uint8Array([1, 2, 3]),
        })
        if (!output) throw new Error('Wallet returned no transaction')
        outputs.push([...output.signedTransaction])
      }
      return outputs
    })

    expect(signed).toEqual([
      [4, 5, 6],
      [4, 5, 6],
    ])
    expect(
      requests
        .filter(({ method }) => method === 'solana:signTransaction')
        .map(({ params }) => params),
    ).toEqual([
      [{ address: solanaAccount.address, transaction: [1, 2, 3] }],
      [
        {
          address: solanaAccount.address,
          chain: 'solana:localnet',
          transaction: [1, 2, 3],
        },
      ],
    ])
  } finally {
    await context.close()
    await browser.close()
    await environment.dispose()
  }
}, 30_000)

test('notifies discovered wallets when authorized accounts arrive after registration and reload', async () => {
  const environment = solanaEnvironment(() => ({ type: 'return', value: null }))
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  let releaseRegistration = () => {}
  let registration = Promise.resolve()
  const exposeBinding = context.exposeBinding.bind(context)
  const spy = vi.spyOn(context, 'exposeBinding').mockImplementation((name, callback) =>
    exposeBinding(name, async (source, payload) => {
      const result = await callback(source, payload)
      if (payload.type === 'register') await registration
      return result
    }),
  )
  try {
    await context.route('https://app.example/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><script>
        window.observed = { initial: [], changes: [] };
        window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', {
          detail: { register(wallet) {
            window.observed.initial = wallet.accounts.map(account => account.address);
            wallet.features['standard:events'].on('change', ({ accounts }) => {
              window.observed.changes.push(accounts.map(account => account.address));
            });
          } }
        }));
      </script>`,
      }),
    )
    await Browser.attach({ context, environment })
    const page = await context.newPage()
    for (const reload of [false, true]) {
      registration = new Promise<void>((resolve) => {
        releaseRegistration = resolve
      })
      if (reload) await page.reload()
      else await page.goto('https://app.example/')
      const observed = () =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                observed: { initial: string[]; changes: string[][] }
              }
            ).observed,
        )
      expect(await observed()).toEqual({ initial: [], changes: [] })
      releaseRegistration()
      await expect.poll(observed).toEqual({
        initial: [],
        changes: [[solanaAccount.address]],
      })
    }
  } finally {
    releaseRegistration()
    spy.mockRestore()
    await context.close()
    await browser.close()
    await environment.dispose()
  }
}, 30_000)

test.each([false, true])(
  'announces the restored connection state (%s) only after registration',
  async (restoredConnected) => {
    let connected = restoredConnected
    const adapter: Wallet.Adapter = {
      profile: Profile.define({
        data: {},
        id: 'wallet',
        kind: 'eip155:eoa',
        name: 'Oallet Test Wallet',
      }),
      prepare: () => ({ type: 'return', value: '0x1' }),
      reset() {
        connected = !restoredConnected
      },
      restore(snapshot) {
        connected = snapshot === true
      },
      snapshot: () => connected,
      state: () => ({ chainId: '0x1', connected }),
      validateSnapshot() {},
    }
    const environment = Environment.create({ wallets: [adapter] })
    const snapshot = await environment.snapshot()
    await environment.reset()
    await environment.restore(snapshot)
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    let releaseRegistration = () => {}
    const registration = new Promise<void>((resolve) => {
      releaseRegistration = resolve
    })
    const exposeBinding = context.exposeBinding.bind(context)
    vi.spyOn(context, 'exposeBinding').mockImplementation((name, callback) =>
      exposeBinding(name, async (source, ...args) => {
        if (name === bindingName && args[0]?.type === 'register') await registration
        return callback(source, ...args)
      }),
    )
    await context.route('https://app.example/**', (route) =>
      route.fulfill({
        body: `<!doctype html><script>
          window.states = [];
          window.connections = [];
          window.firstChainId = new Promise((resolve) => {
            window.addEventListener('eip6963:announceProvider', ({ detail }) => {
              window.states.push(detail.provider.isConnected());
              if (window.states.length === 1) {
                Promise.resolve().then(() => {
                  detail.provider.on('connect', (info) => window.connections.push(info));
                });
              }
              resolve(detail.provider.request({ method: 'eth_chainId' }));
            });
          });
          window.dispatchEvent(new Event('eip6963:requestProvider'));
        </script>`,
        contentType: 'text/html',
      }),
    )

    try {
      await Browser.attach({ context, environment })
      const page = await context.newPage()
      await page.goto('https://app.example/')
      const states = () =>
        page.evaluate(() => (window as typeof window & { states: boolean[] }).states)
      expect(await states()).toEqual([])

      releaseRegistration()
      await expect.poll(states).toEqual([restoredConnected])
      await expect(
        page.evaluate(
          () =>
            (window as typeof window & { firstChainId: Promise<string> }).firstChainId,
        ),
      ).resolves.toBe('0x1')
      await page.evaluate(() =>
        window.dispatchEvent(new Event('eip6963:requestProvider')),
      )
      expect(await states()).toEqual([restoredConnected, restoredConnected])
      expect(
        await page.evaluate(
          () =>
            (window as typeof window & { connections: { chainId: string }[] })
              .connections,
        ),
      ).toEqual(restoredConnected ? [{ chainId: '0x1' }] : [])
    } finally {
      releaseRegistration()
      await context.close()
      await browser.close()
      await environment.dispose()
    }
  },
  30_000,
)

test.each(['https', 'http'])(
  'discovers providers from app startup with unique UUIDs on %s pages',
  async (protocol) => {
    const profiles = ['wallet-a', 'wallet-b'].map((id) =>
      Profile.define({
        data: {},
        id,
        kind: 'eip155:eoa',
        name: `Oallet "${id}" \n </script>`,
        rdns: `app.example.${id}`,
      }),
    )
    const wallets: Wallet.Adapter[] = profiles.map((profile) => ({
      profile,
      prepare: () => ({ type: 'return', value: '0x1' }),
      reset() {},
      restore() {},
      snapshot: () => null,
      validateSnapshot() {},
    }))
    const environment = Environment.create({ wallets })
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    const pageErrors: Error[] = []
    context.on('page', (page) => {
      page.on('pageerror', (error) => pageErrors.push(error))
    })
    const url = `${protocol}://app.example/`
    await context.route(`${url}**`, (route) =>
      route.fulfill({
        body: `<!doctype html><script>
          window.providers = [];
          window.initialProviders = new Promise((resolve) => {
            window.addEventListener('eip6963:announceProvider', (event) => {
              window.providers.push(event.detail);
              if (window.providers.length === 2) resolve([...window.providers]);
            });
          });
          window.dispatchEvent(new Event('eip6963:requestProvider'));
          window.chainIds = window.initialProviders.then((providers) =>
            Promise.all(providers.map(({ provider }) =>
              provider.request({ method: 'eth_chainId' })
            ))
          );
        </script>`,
        contentType: 'text/html',
      }),
    )
    await Browser.attach({ context, environment })

    try {
      const page = await context.newPage()
      await page.goto(url)
      const initial = await readDiscovery(page)
      expect(initial.secure).toBe(protocol === 'https')
      expect(initial.nativeUuid).toBe(protocol === 'https' ? 'function' : 'undefined')
      expect(initial.names).toEqual(profiles.map(({ name }) => name))
      expect(initial.rdns).toEqual(profiles.map(({ rdns }) => rdns))
      expect(initial.chainIds).toEqual(['0x1', '0x1'])
      expect(initial.sameProviders).toBe(true)
      expect(initial.frozen).toBe(true)
      expect(initial.runtimeGlobal).toBe(false)
      expect(initial.legacyProvider).toBe(false)

      const secondPage = await context.newPage()
      await secondPage.goto(url)
      const second = await readDiscovery(secondPage)
      await page.reload()
      const reloaded = await readDiscovery(page)
      const uuids = [...initial.uuids, ...second.uuids, ...reloaded.uuids]
      expect(uuids).toHaveLength(6)
      expect(new Set(uuids).size).toBe(6)
      for (const uuid of uuids) {
        expect(uuid).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        )
      }
      const requests = environment.trace.events.filter(
        (event) => event.type === 'request.received',
      )
      expect(requests).toHaveLength(6)
      expect(new Set(requests.map(({ requestId }) => requestId)).size).toBe(6)
      expect(pageErrors).toEqual([])
    } finally {
      await context.close()
      await browser.close()
      await environment.dispose()
    }
  },
  30_000,
)

async function readDiscovery(page: Page) {
  return page.evaluate(async () => {
    const globals = window as typeof window & {
      chainIds: Promise<string[]>
      initialProviders: Promise<EIP6963ProviderDetail[]>
      providers: EIP6963ProviderDetail[]
    }
    const initial = await globals.initialProviders
    const count = globals.providers.length
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    const repeated = globals.providers.slice(count)
    return {
      chainIds: await globals.chainIds,
      frozen: initial.every(
        (detail) => Object.isFrozen(detail) && Object.isFrozen(detail.info),
      ),
      legacyProvider: 'ethereum' in window,
      names: initial.map(({ info }) => info.name),
      nativeUuid: typeof crypto.randomUUID,
      rdns: initial.map(({ info }) => info.rdns),
      runtimeGlobal: 'oalletRuntime' in window,
      sameProviders:
        repeated.length === initial.length &&
        repeated.every((detail, index) => detail === initial[index]),
      secure: isSecureContext,
      uuids: initial.map(({ info }) => info.uuid),
    }
  })
}

test('announces an EIP-6963 provider and bridges requests to the controller', async () => {
  const origins: string[] = []
  const profile = Profile.define({
    data: {},
    id: 'wallet',
    kind: 'eip155:eoa',
    name: 'Oallet Test Wallet',
    rdns: 'app.example.wallet',
  })
  const adapter: Wallet.Adapter = {
    profile,
    prepare(input) {
      origins.push(input.origin)
      if (input.method === 'eth_chainId') return { type: 'return', value: '0x7a69' }
      return {
        type: 'interactive',
        approve: () => ['0x0000000000000000000000000000000000000001'],
        data: { type: 'connect' },
      }
    },
    reset() {},
    restore() {},
    snapshot: () => null,
    validateSnapshot() {},
  }
  const environment = Environment.create({ wallets: [adapter] })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  await context.route('https://app.example/**', (route) =>
    route.fulfill({
      body: '<!doctype html><title>Fixture</title>',
      contentType: 'text/html',
    }),
  )
  await Browser.attach({ context, environment })
  const page = await context.newPage()

  try {
    await page.goto('https://app.example/')
    const result = page.evaluate(async () => {
      const detail = await new Promise<{
        info: { name: string; rdns: string }
        provider: { request(input: { method: string }): Promise<unknown> }
      }>((resolve) => {
        window.addEventListener('eip6963:announceProvider', ((event: CustomEvent) => {
          resolve(event.detail)
        }) as EventListener)
        window.dispatchEvent(new Event('eip6963:requestProvider'))
      })
      Object.assign(window, { __oalletTestProvider: detail.provider })
      return {
        accounts: await detail.provider.request({ method: 'eth_requestAccounts' }),
        name: detail.info.name,
        rdns: detail.info.rdns,
      }
    })
    const request = await environment
      .wallet('wallet')
      .requests.next('eth_requestAccounts')
    await request.approve()

    await expect(result).resolves.toEqual({
      accounts: ['0x0000000000000000000000000000000000000001'],
      name: 'Oallet Test Wallet',
      rdns: 'app.example.wallet',
    })
    expect(origins).toEqual(['https://app.example'])

    for (const code of [4001, -32042]) {
      const rejected = page.evaluate(async () => {
        const provider = (
          window as typeof window & {
            __oalletTestProvider: {
              request(input: { method: string }): Promise<unknown>
            }
          }
        ).__oalletTestProvider
        try {
          await provider.request({ method: 'personal_sign' })
          return null
        } catch (error) {
          const rejection = error as Error & { code?: number; data?: unknown }
          return {
            code: rejection.code,
            data: rejection.data,
            message: rejection.message,
          }
        }
      })
      const signRequest = await environment
        .wallet('wallet')
        .requests.next('personal_sign')
      signRequest.reject({
        code,
        data: { reason: 'Signing was declined' },
        message: 'User rejected signing',
      })

      await expect(rejected).resolves.toEqual({
        code,
        data: { reason: 'Signing was declined' },
        message: 'User rejected signing',
      })
    }

    const abandoned = page
      .evaluate(() => {
        const provider = (
          window as typeof window & {
            __oalletTestProvider: {
              request(input: { method: string }): Promise<unknown>
            }
          }
        ).__oalletTestProvider
        return provider.request({ method: 'personal_sign' })
      })
      .catch((error: unknown) => error)
    const abandonedRequest = await environment
      .wallet('wallet')
      .requests.next('personal_sign')

    await page.reload()

    expect(abandonedRequest.status).toBe('cancelled')
    await expect(abandonedRequest.approve()).rejects.toBeInstanceOf(
      Environment.RequestExpiredError,
    )
    await expect(abandoned).resolves.toBeInstanceOf(Error)
  } finally {
    await context.close()
    await browser.close()
  }
}, 30_000)

test('keeps the provider session active across same-document history navigation', async () => {
  const profile = Profile.define({
    data: {},
    id: 'wallet',
    kind: 'eip155:eoa',
    name: 'Oallet Test Wallet',
  })
  const adapter: Wallet.Adapter = {
    profile,
    prepare(input) {
      if (input.method === 'eth_chainId') return { type: 'return', value: '0x1' }
      return { type: 'return', value: null }
    },
    reset() {},
    restore() {},
    snapshot: () => null,
    validateSnapshot() {},
  }
  const environment = Environment.create({ wallets: [adapter] })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  await context.route('https://app.example/**', (route) =>
    route.fulfill({
      body: '<!doctype html><title>Fixture</title>',
      contentType: 'text/html',
    }),
  )
  await Browser.attach({ context, environment })
  const page = await context.newPage()

  try {
    await page.goto('https://app.example/')
    await page.evaluate(async () => {
      const detail = await new Promise<{
        provider: { request(input: { method: string }): Promise<unknown> }
      }>((resolve) => {
        window.addEventListener('eip6963:announceProvider', ((event: CustomEvent) => {
          resolve(event.detail)
        }) as EventListener)
        window.dispatchEvent(new Event('eip6963:requestProvider'))
      })
      Object.assign(window, { __oalletTestProvider: detail.provider })
      history.pushState(null, '', '/settings')
    })
    await page.waitForURL('https://app.example/settings')

    await expect(
      page.evaluate(() =>
        (
          window as typeof window & {
            __oalletTestProvider: {
              request(input: { method: string }): Promise<unknown>
            }
          }
        ).__oalletTestProvider.request({ method: 'eth_chainId' }),
      ),
    ).resolves.toBe('0x1')
  } finally {
    await context.close()
    await browser.close()
  }
}, 30_000)

test('delivers controller account changes to the active provider', async () => {
  type Controls = {
    readonly connection: {
      setAccounts(accounts: readonly string[]): Promise<void>
    }
  }
  let emit: (event: {
    readonly data: readonly string[]
    readonly name: 'accountsChanged'
    readonly origin: string
  }) => Promise<void>
  const profile = Profile.define({
    data: {},
    id: 'wallet',
    kind: 'eip155:eoa',
    name: 'Oallet Test Wallet',
  })
  const controls: Controls = {
    connection: {
      setAccounts(accounts) {
        return emit({
          data: accounts,
          name: 'accountsChanged',
          origin: 'https://app.example',
        })
      },
    },
  }
  const adapter: Wallet.Adapter<Controls> = {
    controls,
    bind(context) {
      emit = context.emit
    },
    profile,
    prepare(input) {
      if (input.method === 'eth_chainId') return { type: 'return', value: '0x1' }
      return {
        type: 'interactive',
        approve: () => ['0x0000000000000000000000000000000000000001'],
        data: { type: 'connect' },
      }
    },
    reset() {},
    restore() {},
    snapshot: () => null,
    state: () => ({ accounts: [], chainId: '0x1', connected: true }),
    validateSnapshot() {},
  }
  const environment = Environment.create({ wallets: [adapter] })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  await context.route('https://app.example/**', (route) =>
    route.fulfill({
      body: '<!doctype html><title>Fixture</title>',
      contentType: 'text/html',
    }),
  )
  await Browser.attach({ context, environment })
  const page = await context.newPage()

  try {
    await page.goto('https://app.example/')
    const connect = page.evaluate(async () => {
      const detail = await new Promise<{
        provider: {
          on(event: string, listener: (value: unknown) => void): unknown
          removeListener(event: string, listener: (value: unknown) => void): unknown
          request(input: { method: string }): Promise<unknown>
        }
      }>((resolve) => {
        window.addEventListener('eip6963:announceProvider', ((event: CustomEvent) => {
          resolve(event.detail)
        }) as EventListener)
        window.dispatchEvent(new Event('eip6963:requestProvider'))
      })
      const events: unknown[] = []
      const listener = (accounts: unknown) => events.push(accounts)
      const removedListener = () => events.push('removed listener was called')
      if (detail.provider.on('accountsChanged', listener) !== detail.provider) {
        throw new Error('Provider.on must return the provider')
      }
      detail.provider.on('accountsChanged', listener)
      detail.provider.on('accountsChanged', removedListener)
      if (
        detail.provider.removeListener('accountsChanged', removedListener) !==
        detail.provider
      ) {
        throw new Error('Provider.removeListener must return the provider')
      }
      Object.assign(window, { __oalletTestEvents: events })
      return detail.provider.request({ method: 'eth_requestAccounts' })
    })
    await (
      await environment.wallet('wallet').requests.next('eth_requestAccounts')
    ).approve()
    await connect

    await environment
      .wallet('wallet')
      .connection.setAccounts(['0x0000000000000000000000000000000000000002'])

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __oalletTestEvents: readonly unknown[] })
              .__oalletTestEvents,
        ),
      )
      .toEqual([
        ['0x0000000000000000000000000000000000000002'],
        ['0x0000000000000000000000000000000000000002'],
      ])
    expect(environment.trace.events.map((event) => event.type)).toContain(
      'provider.eventDelivered',
    )

    await page.evaluate(() => {
      delete (
        globalThis as typeof globalThis & {
          __oallet_emit_v1__?: unknown
        }
      ).__oallet_emit_v1__
    })

    await expect(
      environment
        .wallet('wallet')
        .connection.setAccounts(['0x0000000000000000000000000000000000000003']),
    ).rejects.toBeInstanceOf(DeliveryError)
    expect(environment.trace.events.at(-1)?.type).toBe('provider.deliveryFailed')
  } finally {
    await context.close()
    await browser.close()
  }
}, 30_000)

test('bridges sign-and-send options, batches, signature bytes, and failures', async () => {
  const requests: Wallet.Input[] = []
  let output: import('@oallet/core').Json.Value = [
    { signature: Array<number>(64).fill(17) },
    { signature: Array<number>(64).fill(29) },
  ]
  let rpcFailure = false
  const environment = solanaEnvironment((input) => {
    if (input.method === 'standard:connect')
      return {
        type: 'return',
        value: [
          {
            ...solanaAccount,
            features: [...solanaAccount.features, 'solana:signAndSendTransaction'],
          },
        ],
      }
    requests.push(input)
    if (rpcFailure)
      throw Object.assign(new Error('RPC unavailable'), { providerCode: -32000 })
    return { type: 'return', value: output }
  }, true)
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  try {
    await context.route('https://app.example/**', (route) =>
      route.fulfill({ body: '<!doctype html>', contentType: 'text/html' }),
    )
    await Browser.attach({ context, environment })
    const page = await context.newPage()
    await page.goto('https://app.example/')
    const send = () =>
      page.evaluate(async () => {
        type Account = { address: string; features: string[] }
        type StandardWallet = {
          features: {
            'standard:connect': { connect(): Promise<{ accounts: Account[] }> }
            'solana:signAndSendTransaction': {
              version: string
              supportedTransactionVersions: ('legacy' | 0)[]
              signAndSendTransaction(
                ...inputs: {
                  account: Account
                  chain: string
                  transaction: Uint8Array
                  options?: {
                    commitment?: 'confirmed'
                    preflightCommitment?: 'processed'
                    minContextSlot?: number
                    maxRetries?: number
                    skipPreflight?: boolean
                  }
                }[]
              ): Promise<{ signature: Uint8Array }[]>
            }
          }
        }
        let wallet: StandardWallet | undefined
        window.dispatchEvent(
          new CustomEvent('wallet-standard:app-ready', {
            detail: {
              register(value: StandardWallet) {
                wallet = value
              },
            },
          }),
        )
        if (!wallet) throw new Error('Wallet was not discovered')
        const feature = wallet.features['solana:signAndSendTransaction']
        const { accounts } = await wallet.features['standard:connect'].connect()
        const account = accounts[0]
        if (!account) throw new Error('No account')
        try {
          const outputs = await feature.signAndSendTransaction(
            {
              account,
              chain: 'solana:localnet',
              transaction: new Uint8Array([1, 2, 3]),
              options: {
                commitment: 'confirmed',
                preflightCommitment: 'processed',
                minContextSlot: 9,
                maxRetries: 0,
                skipPreflight: false,
              },
            },
            { account, chain: 'solana:localnet', transaction: new Uint8Array([4, 5, 6]) },
          )
          return {
            version: feature.version,
            versions: feature.supportedTransactionVersions,
            accountFeatures: account.features,
            signatures: outputs.map(({ signature }) => ({
              bytes: [...signature],
              isBytes: signature instanceof Uint8Array,
            })),
          }
        } catch (error) {
          return {
            error: (error as Error).message,
            code: (error as { code?: number }).code,
          }
        }
      })
    expect(await send()).toEqual({
      version: '1.0.0',
      versions: ['legacy', 0],
      accountFeatures: [...solanaAccount.features, 'solana:signAndSendTransaction'],
      signatures: [
        { bytes: Array<number>(64).fill(17), isBytes: true },
        { bytes: Array<number>(64).fill(29), isBytes: true },
      ],
    })
    expect(requests[0]?.params).toEqual([
      {
        address: solanaAccount.address,
        chain: 'solana:localnet',
        transaction: [1, 2, 3],
        options: {
          commitment: 'confirmed',
          preflightCommitment: 'processed',
          minContextSlot: 9,
          maxRetries: 0,
          skipPreflight: false,
        },
      },
      {
        address: solanaAccount.address,
        chain: 'solana:localnet',
        transaction: [4, 5, 6],
      },
    ])
    for (const malformed of [
      [],
      [{ signature: [1] }, { signature: [2] }],
      [
        { signature: Array<number>(64).fill(256) },
        { signature: Array<number>(64).fill(0) },
      ],
    ]) {
      output = malformed
      expect(await send()).toMatchObject({
        error: expect.stringContaining('invalid Solana transaction signature'),
      })
    }
    rpcFailure = true
    expect(await send()).toMatchObject({ error: 'RPC unavailable', code: -32000 })
  } finally {
    await context.close()
    await browser.close()
    await environment.dispose()
  }
}, 30_000)
