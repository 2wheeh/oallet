import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspace = dirname(dirname(fileURLToPath(import.meta.url)))
const temporary = await mkdtemp(join(tmpdir(), 'oallet-packed-consumer-'))
const tarballs = join(temporary, 'tarballs')
const consumer = join(temporary, 'consumer')
const packageDirectories = ['core', 'evm', 'playwright', 'walletconnect', 'oallet']

try {
  await mkdir(tarballs)
  await cp(join(workspace, 'tests/packed-consumer'), consumer, { recursive: true })

  for (const directory of packageDirectories) {
    run('pnpm', [
      '--dir',
      join(workspace, 'packages', directory),
      'pack',
      '--pack-destination',
      tarballs,
    ])
  }

  const manifestPath = join(consumer, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.pnpm = { overrides: {} }
  const packedFiles = await readdir(tarballs)
  for (const name of [
    '@oallet/core',
    '@oallet/evm',
    '@oallet/playwright',
    '@oallet/walletconnect',
    'oallet',
  ]) {
    const prefix = `${name.replace('@', '').replace('/', '-')}-`
    const file = packedFiles.find(
      (candidate) => candidate.startsWith(prefix) && candidate.endsWith('.tgz'),
    )
    if (!file) throw new Error(`Missing packed artifact for ${name}`)
    const specifier = `file:${join(tarballs, file)}`
    manifest.dependencies[name] = specifier
    manifest.pnpm.overrides[name] = specifier
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  run('pnpm', ['install', '--lockfile-only', '--no-frozen-lockfile'], {
    cwd: consumer,
  })
  run('pnpm', ['install', '--frozen-lockfile'], { cwd: consumer })
  run('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: consumer })
  run('node', ['runtime.mjs'], { cwd: consumer })
} finally {
  await rm(temporary, { force: true, recursive: true })
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: 'utf8',
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`)
  }
}
