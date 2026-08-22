export type Namespace = {
  readonly accounts: readonly string[]
  readonly chains?: readonly string[] | undefined
  readonly events: readonly string[]
  readonly methods: readonly string[]
}

export type Namespaces = Readonly<Record<string, Namespace>>

export type Instance = {
  readonly namespaces: Namespaces
  readonly topic: string
  disconnect(): Promise<void>
}
