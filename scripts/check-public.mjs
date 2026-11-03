import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { validatePublicModel } from './lib/public-model.mjs'
import { publicFiles } from './lib/public-files.mjs'

const root = process.cwd()
await assert.rejects(fs.access(path.join(root, 'EXPORT_FAILED')))
validatePublicModel(JSON.parse(await fs.readFile('content/home.json', 'utf8')))
assert.deepEqual((await fs.readdir('content')).sort(), ['design.md', 'home.json'])
assert.deepEqual((await fs.readdir('public')).sort(), ['artwork'])
assert.deepEqual((await fs.readdir('public/artwork')).sort(), [
  'home-miniature-2026-10-19.webp',
  'study-miniature-2026-10-19.webp',
])
const forbidden =
  /(?:BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.|docs\.qq\.com\/smartsheet|data-missing-d[o]c|资料\/|研究报告\/|收件箱\/)/
async function scan(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    assert(!entry.isSymbolicLink(), `Symbolic link forbidden: ${file}`)
    if (entry.isDirectory()) await scan(file)
    else if (/\.(?:tsx?|m?js|json|md|html|txt|xml|css)$/.test(entry.name))
      assert(!forbidden.test(await fs.readFile(file, 'utf8')), `Private material in ${file}`)
  }
}
const allowedFiles = new Set(publicFiles)
const generated = new Set([
  'node_modules',
  '.next',
  'out',
  '.git',
  'next-env.d.ts',
  'tsconfig.tsbuildinfo',
])
async function checkSource(directory, prefix = '') {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`
    if (!prefix && generated.has(entry.name)) continue
    const file = path.join(directory, entry.name)
    assert(!entry.isSymbolicLink(), `Symbolic link forbidden: ${relative}`)
    if (entry.isDirectory()) await checkSource(file, `${relative}/`)
    else {
      assert(allowedFiles.has(relative), `Unreviewed source file: ${relative}`)
      if (!/\.webp$/.test(relative))
        assert(!forbidden.test(await fs.readFile(file, 'utf8')), `Private material in ${relative}`)
    }
  }
}
await checkSource(root)
for (const file of publicFiles) await fs.access(file)
if (process.argv.includes('--built')) {
  const expected = new Set([
    'index.html',
    'index.txt',
    '404.html',
    '404/index.html',
    'about/index.html',
    'about/index.txt',
    'design/index.html',
    'design/index.txt',
    'home-3d/index.html',
    'home-3d/index.txt',
    'robots.txt',
    'sitemap.xml',
    'artwork/home-miniature-2026-10-19.webp',
    'artwork/study-miniature-2026-10-19.webp',
  ])
  async function checkOutput(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`
      assert(!entry.isSymbolicLink(), `Symbolic link forbidden: ${relative}`)
      if (entry.isDirectory()) await checkOutput(path.join(directory, entry.name), `${relative}/`)
      else
        assert(
          expected.has(relative) ||
            /^_next\/static\/[a-zA-Z0-9_./-]+\.(?:js|css|woff2?)$/.test(relative),
          `Unreviewed output file: ${relative}`,
        )
    }
  }
  await checkOutput('out')
  for (const route of [
    'index.html',
    'home-3d/index.html',
    'design/index.html',
    'about/index.html',
    '404.html',
    'robots.txt',
    'sitemap.xml',
  ])
    await fs.access(`out/${route}`)
  await scan('out')
}
console.log('Public boundary checked: geometry, prose, assets, routes and text payloads')
