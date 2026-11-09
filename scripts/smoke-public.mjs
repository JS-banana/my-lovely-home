import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const pages = ['/', '/home-3d/', '/design/', '/design/smart-home/', '/design/network/', '/about/']
const mutableFiles = [
  ...pages.map((page) => `${page}index.txt`),
  '/artwork/home-miniature-2026-10-19.webp',
  '/artwork/study-miniature-2026-10-19.webp',
]
const missingRoutes = [
  '/__public-smoke-missing-route__/',
  '/design/__public-smoke-missing-topic__/',
  '/household/',
  '/library/',
  '/search/',
  '/tasks/',
  '/d/smoke-private/',
  '/_content/search.json',
  '/_content/graph.json',
  '/_content/media.json',
]
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function cacheDirectives(response) {
  return new Map(
    (response.headers.get('cache-control') ?? '')
      .toLowerCase()
      .split(',')
      .map((entry) => entry.trim().split('='))
      .filter(([name]) => name),
  )
}

function checkMutableCache(response, route) {
  const cache = cacheDirectives(response)
  assert(!cache.has('immutable'), `${route}: mutable content must not be immutable`)
  assert(
    cache.has('no-cache') ||
      cache.has('no-store') ||
      (cache.get('max-age') === '0' &&
        cache.has('must-revalidate') &&
        (!cache.has('s-maxage') || cache.get('s-maxage') === '0')),
    `${route}: mutable content must revalidate or use no-store`,
  )
}

/** Real HTTP checks; no browser, local build or network mocking is assumed. */
export async function smokePublic(origin, { artifactDirectory, timeoutMs = 10000 } = {}) {
  const base = new URL(origin)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
  assert(
    base.protocol === 'https:' || (base.protocol === 'http:' && loopback),
    'Use HTTPS for a deployed site (HTTP is allowed only for local smoke tests)',
  )
  assert.equal(base.pathname, '/', 'Pass a site origin without a path')
  assert(!base.username && !base.password && !base.search && !base.hash, 'Pass a plain site origin')
  const assets = new Set()

  async function request(route, status) {
    const response = await fetch(new URL(route, base), {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'my-lovely-home-deploy-smoke/1' },
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.equal(
      response.status,
      status,
      `${route}: expected HTTP ${status}, got ${response.status}`,
    )
    if (status === 200 && artifactDirectory) {
      const relative = route.endsWith('/') ? `${route}index.html` : route
      const expected = await fs.readFile(path.join(artifactDirectory, relative.slice(1)))
      assert.equal(sha256(bytes), sha256(expected), `${route}: served bytes differ from this build`)
    }
    return { response, bytes }
  }

  for (const route of pages) {
    const { response, bytes } = await request(route, 200)
    assert.match(
      response.headers.get('content-type') ?? '',
      /^text\/html\b/i,
      `${route}: expected HTML`,
    )
    checkMutableCache(response, route)
    const html = bytes.toString('utf8')
    assert(/<html(?:\s|>)/i.test(html) && /<body(?:\s|>)/i.test(html), `${route}: incomplete HTML`)
    for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
      const asset = new URL(match[1].replaceAll('&amp;', '&'), base)
      if (
        asset.origin === base.origin &&
        /^\/_next\/static\/.+\.(?:js|css)$/.test(asset.pathname)
      ) {
        assert(!asset.search && !asset.hash, 'Hashed static assets must use their canonical paths')
        assets.add(asset.pathname)
      }
    }
  }
  assert(
    [...assets].some((asset) => asset.endsWith('.js')),
    'No Next JavaScript referenced by public pages',
  )
  assert(
    [...assets].some((asset) => asset.endsWith('.css')),
    'No Next stylesheet referenced by public pages',
  )
  for (const route of mutableFiles) {
    const { response } = await request(route, 200)
    checkMutableCache(response, route)
    if (route.endsWith('.txt'))
      assert.match(
        response.headers.get('content-type') ?? '',
        /^text\/plain\b/i,
        `${route}: expected RSC text`,
      )
    else
      assert.match(
        response.headers.get('content-type') ?? '',
        /^image\/webp\b/i,
        `${route}: expected artwork`,
      )
  }
  for (const route of missingRoutes) {
    const { response } = await request(route, 404)
    assert(cacheDirectives(response).has('no-store'), `${route}: 404 responses must use no-store`)
  }
  for (const route of assets) {
    const { response } = await request(route, 200)
    const cache = cacheDirectives(response)
    assert(
      cache.has('public') &&
        cache.has('immutable') &&
        Number(cache.get('max-age')) >= 31536000 &&
        !cache.has('private') &&
        !cache.has('no-store') &&
        !cache.has('no-cache'),
      `${route}: hashed static assets need a public immutable cache of at least one year`,
    )
    assert.match(
      response.headers.get('content-type') ?? '',
      route.endsWith('.js') ? /^(?:application|text)\/javascript\b/i : /^text\/css\b/i,
      `${route}: incorrect static asset MIME type`,
    )
  }
  return {
    pages: pages.length,
    mutableFiles: mutableFiles.length,
    missingRoutes: missingRoutes.length,
    staticAssets: assets.size,
    matchesBuild: Boolean(artifactDirectory),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [origin, artifactDirectory, ...extra] = process.argv.slice(2)
  assert(
    origin && extra.length === 0,
    'Usage: node scripts/smoke-public.mjs https://example.com [build-out-directory]',
  )
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await smokePublic(origin, { artifactDirectory })
      console.log(`Public HTTP smoke passed: ${JSON.stringify(result)}`)
      break
    } catch (error) {
      if (attempt === 3) throw error
      console.error(`Public HTTP smoke attempt ${attempt} failed: ${error.message}; retrying`)
      await delay(2000)
    }
  }
}
