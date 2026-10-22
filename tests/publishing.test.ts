import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { spawn } from 'bun'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execPath } from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  createBackup,
  createLesson,
  createSharedLibrary,
  parseSharedLibrary,
  scheduleReview,
  seedExpressions,
  SHARED_LIBRARY_ID,
  SHARED_LIBRARY_NAME,
} from '../src/data/index'
import type { AppData, Expression } from '../src/data/index'
import { publishLibrary } from '../scripts/publish-library'
import { defaultTargetPath } from '../scripts/shared-library'
import { validatePublishedLibrary } from '../scripts/validate-shared-library'

const expression: Expression = {
  ...seedExpressions[0]!,
  id: 'publishing-bilingual',
  situationTr: 'Bir arkadaşını selamlarken.',
  situationEn: 'Greeting a friend.',
  pronunciationNoteTr: 'Türkçe okuma yardımı.',
  pronunciationNoteEn: 'English reading aid.',
  audioUrl: 'https://recordings.example/default.mp3',
  femaleAudioUrl: 'https://recordings.example/female.mp3',
  maleAudioUrl: 'http://recordings.example/male.mp3',
}
const publishedBefore = new Date('2026-01-01T12:00:00.000Z')

function data(): AppData {
  return {
    expressions: [structuredClone(expression)],
    reviews: [
      scheduleReview(
        undefined,
        expression.id,
        'reading',
        'good',
        publishedBefore,
      ),
    ],
    preferences: {
      voiceURI: 'private-voice-preference',
      rate: 1.5,
      dailyNewLimit: 17,
    },
    initialized: true,
    sharedLibrary: {
      libraryId: SHARED_LIBRARY_ID,
      name: SHARED_LIBRARY_NAME,
      revision: 400,
      publishedAt: publishedBefore.toISOString(),
      expressions: [{ ...expression, id: 'private-baseline-only' }],
      deletedIds: ['private-tombstone'],
    },
  }
}

function backup() {
  return createBackup(data())
}

function forbidFetch() {
  // Bun types fetch as a callable with an additional preconnect property.
  return spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      () => {
        throw new Error('Publishing and validation must not access the network')
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
}

let directory: string
let inputPath: string
let targetPath: string

beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'petit-publishing-'))
  inputPath = join(directory, 'input.json')
  targetPath = join(directory, 'shared-library.json')
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

async function writeInput(value: unknown) {
  await fs.writeFile(inputPath, JSON.stringify(value))
}

async function existing(revision = 7) {
  const library = createSharedLibrary(data(), revision, publishedBefore)
  const bytes = `${JSON.stringify(library, null, 2)}\n`
  await fs.writeFile(targetPath, bytes)
  return bytes
}

async function expectOnlyOriginalFiles() {
  expect((await fs.readdir(directory)).sort()).toEqual([
    'input.json',
    'shared-library.json',
  ])
}

describe('publishing validated local exports', () => {
  for (const kind of [
    'shared library',
    'vocabulary lesson',
    'full backup',
  ] as const) {
    test(`${kind} preserves bilingual text, stable IDs, timestamps and every audio field without fetching`, async () => {
      const source =
        kind === 'shared library'
          ? createSharedLibrary(data(), 900, publishedBefore)
          : kind === 'vocabulary lesson'
            ? createLesson(data())
            : backup()
      await writeInput(source)
      const sourceBytes = await fs.readFile(inputPath, 'utf8')
      const fetch = forbidFetch()
      try {
        const before = Date.now()
        const result = await publishLibrary(inputPath, targetPath)
        expect(result).toEqual({
          kind: 'petit-shared-library',
          version: 1,
          libraryId: SHARED_LIBRARY_ID,
          name: SHARED_LIBRARY_NAME,
          revision: 1,
          publishedAt: expect.any(String),
          expressions: [expression],
        })
        expect(Date.parse(result.publishedAt)).toBeGreaterThanOrEqual(before)
        expect(Date.parse(result.publishedAt)).toBeLessThanOrEqual(Date.now())
        const bytes = await fs.readFile(targetPath, 'utf8')
        expect(parseSharedLibrary(bytes)).toEqual(result)
        expect(bytes.endsWith('\n')).toBe(true)
        expect(await fs.readFile(inputPath, 'utf8')).toBe(sourceBytes)
        expect(fetch).not.toHaveBeenCalled()
        await expectOnlyOriginalFiles()
      } finally {
        fetch.mockRestore()
      }
    })
  }

  test('backup reviews, preferences, initialization, baseline and tombstones never enter the feed', async () => {
    await writeInput(backup())
    await publishLibrary(inputPath, targetPath)
    const text = await fs.readFile(targetPath, 'utf8')
    expect(Object.keys(JSON.parse(text) as object).sort()).toEqual(
      [
        'kind',
        'version',
        'libraryId',
        'name',
        'revision',
        'publishedAt',
        'expressions',
      ].sort(),
    )
    for (const privateKey of [
      'reviews',
      'history',
      'dueAt',
      'preferences',
      'voiceURI',
      'dailyNewLimit',
      'initialized',
      'sharedLibrary',
      'deletedIds',
      'private-voice-preference',
      'private-baseline-only',
      'private-tombstone',
    ])
      expect(text).not.toContain(privateKey)
  })

  for (const incomingRevision of [1, 7, 999]) {
    test(`revision comes only from the published file, not incoming revision ${incomingRevision}`, async () => {
      await writeInput({
        ...createSharedLibrary(data(), incomingRevision, publishedBefore),
        name: 'An incoming name is not publishing authority',
      })
      await existing(7)
      const result = await publishLibrary(inputPath, targetPath)
      expect(result.revision).toBe(8)
      expect(result.name).toBe(SHARED_LIBRARY_NAME)
      expect((await publishLibrary(inputPath, targetPath)).revision).toBe(9)
    })
  }

  test('empty vocabulary is a valid explicit publication', async () => {
    await writeInput({ kind: 'petit-lesson', version: 1, expressions: [] })
    await existing()
    expect((await publishLibrary(inputPath, targetPath)).expressions).toEqual(
      [],
    )
  })

  test('legacy bilingual-compatible input is canonicalized by current parsers', async () => {
    const item: Record<string, unknown> = {
      ...expression,
      situation: expression.situationEn,
      pronunciationNote: expression.pronunciationNoteEn,
    }
    delete item.situationEn
    delete item.pronunciationNoteEn
    await writeInput({ kind: 'petit-lesson', version: 1, expressions: [item] })
    expect((await publishLibrary(inputPath, targetPath)).expressions).toEqual([
      expression,
    ])
  })

  test('target is anchored to the project, not the caller working directory', () => {
    expect(defaultTargetPath).toBe(
      fileURLToPath(new URL('../public/shared-library.json', import.meta.url)),
    )
  })

  test('an explicit source is required and input cannot be its own target', async () => {
    await expect(publishLibrary('', targetPath)).rejects.toThrow(
      'explicit input path',
    )
    const bytes = await existing()
    await expect(publishLibrary(targetPath, targetPath)).rejects.toThrow(
      'different files',
    )
    expect(await fs.readFile(targetPath, 'utf8')).toBe(bytes)
  })
})

describe('publication failures leave the target byte-for-byte unchanged', () => {
  test('invalid JSON is useful but never echoes private JSON content', async () => {
    const bytes = await existing()
    await fs.writeFile(inputPath, '{"private-secret":broken}')
    await expect(publishLibrary(inputPath, targetPath)).rejects.toThrow(
      'Invalid JSON',
    )
    try {
      await publishLibrary(inputPath, targetPath)
    } catch (error) {
      expect(String(error)).not.toContain('private-secret')
    }
    expect(await fs.readFile(targetPath, 'utf8')).toBe(bytes)
    await expectOnlyOriginalFiles()
  })

  const invalidInputs: Array<[string, () => unknown, RegExp]> = [
    [
      'unsupported kind',
      () => ({ kind: 'old-library', expressions: [expression] }),
      /Expected a petit-shared-library/,
    ],
    [
      'wrong shared source',
      () => ({ ...createSharedLibrary(data(), 1), libraryId: 'someone-else' }),
      /expected libraryId/,
    ],
    [
      'old source key',
      () => ({ ...createSharedLibrary(data(), 1), source: SHARED_LIBRARY_ID }),
      /unknown field/,
    ],
    [
      'invalid incoming revision',
      () => ({ ...createSharedLibrary(data(), 1), revision: 0 }),
      /revision/,
    ],
    [
      'unsupported version',
      () => ({ ...createLesson(data()), version: 2 }),
      /version/,
    ],
    [
      'duplicate IDs',
      () => ({
        ...createLesson(data()),
        expressions: [expression, expression],
      }),
      /duplicate expression id/,
    ],
    [
      'invalid bilingual text',
      () => ({
        ...createLesson(data()),
        expressions: [{ ...expression, situationTr: '', situationEn: '' }],
      }),
      /nonblank situation/,
    ],
    [
      'invalid review reference in otherwise valid backup',
      () => {
        const value = backup()
        value.data.reviews[0]!.expressionId = 'missing'
        return value
      },
      /references missing/,
    ],
    [
      'invalid backup preferences',
      () => {
        const value = backup()
        value.data.preferences.rate = -1
        return value
      },
      /preferences.rate/,
    ],
    [
      'invalid backup baseline',
      () => {
        const value = backup()
        value.data.sharedLibrary!.revision = 0
        return value
      },
      /revision/,
    ],
    [
      'unconfigured backup source',
      () => {
        const value = backup()
        value.data.sharedLibrary!.libraryId = 'someone-else'
        return value
      },
      /expected libraryId/,
    ],
  ]
  for (const field of ['audioUrl', 'femaleAudioUrl', 'maleAudioUrl']) {
    for (const url of [
      'javascript:alert(1)',
      '/relative.mp3',
      'https://user:password@example.com/a.mp3',
    ]) {
      invalidInputs.push([
        `unsafe ${field}: ${url}`,
        () => ({
          ...createLesson(data()),
          expressions: [{ ...expression, [field]: url }],
        }),
        /absolute http/,
      ])
    }
  }
  for (const [name, input, error] of invalidInputs) {
    test(name, async () => {
      const bytes = await existing()
      await writeInput(input())
      await expect(publishLibrary(inputPath, targetPath)).rejects.toThrow(error)
      expect(await fs.readFile(targetPath, 'utf8')).toBe(bytes)
      await expectOnlyOriginalFiles()
    })
  }

  for (const [name, text] of [
    ['invalid JSON', '{broken'],
    [
      'wrong source',
      JSON.stringify({
        ...createSharedLibrary(data(), 7),
        libraryId: 'someone-else',
      }),
    ],
    [
      'old source key',
      JSON.stringify({
        ...createSharedLibrary(data(), 7),
        source: SHARED_LIBRARY_ID,
      }),
    ],
    ['wrong kind', JSON.stringify(createLesson(data()))],
    [
      'bad audio URL',
      JSON.stringify({
        ...createSharedLibrary(data(), 7),
        expressions: [{ ...expression, audioUrl: 'file:///private/audio.mp3' }],
      }),
    ],
    [
      'revision overflow',
      JSON.stringify(createSharedLibrary(data(), Number.MAX_SAFE_INTEGER)),
    ],
  ]) {
    test(`invalid existing feed: ${name}`, async () => {
      await writeInput(createLesson(data()))
      await fs.writeFile(targetPath, text!)
      await expect(publishLibrary(inputPath, targetPath)).rejects.toThrow()
      expect(await fs.readFile(targetPath, 'utf8')).toBe(text!)
      await expectOnlyOriginalFiles()
    })
  }

  test('missing input leaves the target unchanged', async () => {
    const bytes = await existing()
    await expect(publishLibrary(inputPath, targetPath)).rejects.toThrow(
      'Cannot publish input',
    )
    expect(await fs.readFile(targetPath, 'utf8')).toBe(bytes)
  })

  test('invalid input never creates a missing target', async () => {
    await fs.writeFile(inputPath, 'null')
    await expect(publishLibrary(inputPath, targetPath)).rejects.toThrow()
    expect(await fs.readdir(directory)).toEqual(['input.json'])
  })

  test('partial temp-write failure preserves the target and cleans up', async () => {
    const bytes = await existing()
    await writeInput(createLesson(data()))
    const originalOpen = fs.open
    const write = spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args)
      const originalWriteFile = handle.writeFile.bind(handle)
      spyOn(handle, 'writeFile').mockImplementation(async () => {
        await originalWriteFile('partial')
        throw new Error('simulated disk full')
      })
      return handle
    })
    try {
      await expect(publishLibrary(inputPath, targetPath)).rejects.toThrow(
        'simulated disk full',
      )
      expect(await fs.readFile(targetPath, 'utf8')).toBe(bytes)
      await expectOnlyOriginalFiles()
    } finally {
      write.mockRestore()
    }
  })

  test('rename failure preserves the target and cleans up a complete same-directory temp file', async () => {
    const bytes = await existing()
    await writeInput(createLesson(data()))
    let tempFile = ''
    const rename = spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      tempFile = String(from)
      expect(to).toBe(targetPath)
      expect(
        tempFile.startsWith(join(directory, '.shared-library.json.')),
      ).toBe(true)
      expect(parseSharedLibrary(await fs.readFile(from, 'utf8')).revision).toBe(
        8,
      )
      throw new Error('simulated rename failure')
    })
    try {
      await expect(publishLibrary(inputPath, targetPath)).rejects.toThrow(
        'simulated rename failure',
      )
      expect(tempFile).not.toBe('')
      expect(await fs.readFile(targetPath, 'utf8')).toBe(bytes)
      await expectOnlyOriginalFiles()
    } finally {
      rename.mockRestore()
    }
  })

  test('temp-file creation failure preserves the target', async () => {
    const bytes = await existing()
    await writeInput(createLesson(data()))
    const originalOpen = fs.open
    const open = spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (args[1] === 'wx') throw new Error('simulated permission denied')
      return originalOpen(...args)
    })
    try {
      await expect(publishLibrary(inputPath, targetPath)).rejects.toThrow(
        'simulated permission denied',
      )
      expect(await fs.readFile(targetPath, 'utf8')).toBe(bytes)
      await expectOnlyOriginalFiles()
    } finally {
      open.mockRestore()
    }
  })
})

async function runCli(script: string, args: string[] = []) {
  const child = spawn({
    cmd: [
      execPath,
      fileURLToPath(new URL(`../scripts/${script}.ts`, import.meta.url)),
      ...args,
    ],
    cwd: directory,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

describe('CLI entry points without a shell', () => {
  test('publisher requires exactly one explicit input and exits nonzero', async () => {
    for (const args of [[], ['one.json', 'two.json']]) {
      const result = await runCli('publish-library', args)
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain(
        'Usage: bun scripts/publish-library.ts INPUT',
      )
      expect(result.stdout).toBe('')
    }
  })

  test('publisher reports invalid JSON without private contents and leaves the public feed unchanged', async () => {
    const bytes = await fs.readFile(defaultTargetPath, 'utf8')
    await fs.writeFile(inputPath, '{"private-secret":broken}')
    const result = await runCli('publish-library', [inputPath])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('Invalid JSON')
    expect(result.stderr).not.toContain('private-secret')
    expect(result.stdout).toBe('')
    expect(await fs.readFile(defaultTargetPath, 'utf8')).toBe(bytes)
    expect(await fs.readdir(directory)).toEqual(['input.json'])
  })

  test('validator resolves the project feed from another working directory and logs counts/revision', async () => {
    const library = await validatePublishedLibrary()
    const result = await runCli('validate-shared-library')
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(
      `${library.expressions.length} expressions, revision ${library.revision}`,
    )
    expect(result.stderr).toBe('')
    expect(await fs.readdir(directory)).toEqual([])
  })

  test('validator rejects unexpected arguments with a nonzero exit', async () => {
    const result = await runCli('validate-shared-library', ['unexpected.json'])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain(
      'Usage: bun scripts/validate-shared-library.ts',
    )
  })
})

describe('published feed validation', () => {
  test('returns the validated revision and expressions without fetching recording URLs', async () => {
    await existing(12)
    const fetch = forbidFetch()
    try {
      const result = await validatePublishedLibrary(targetPath)
      expect(result.revision).toBe(12)
      expect(result.expressions).toEqual([expression])
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
    }
  })

  test('missing public feed is an error, not an empty library', async () => {
    await expect(validatePublishedLibrary(targetPath)).rejects.toThrow()
  })

  test('rejects an otherwise valid feed with an unconfigured libraryId', async () => {
    await fs.writeFile(
      targetPath,
      JSON.stringify({ ...createSharedLibrary(data(), 1), libraryId: 'other' }),
    )
    await expect(validatePublishedLibrary(targetPath)).rejects.toThrow(
      'expected libraryId',
    )
  })

  test('validates the whole published envelope and expressions', async () => {
    await fs.writeFile(
      targetPath,
      JSON.stringify({ ...createSharedLibrary(data(), 1), reviews: [] }),
    )
    await expect(validatePublishedLibrary(targetPath)).rejects.toThrow(
      'unknown field',
    )
    await fs.writeFile(
      targetPath,
      JSON.stringify({
        ...createSharedLibrary(data(), 1),
        expressions: [
          { ...expression, maleAudioUrl: 'data:audio/mp3;base64,no' },
        ],
      }),
    )
    await expect(validatePublishedLibrary(targetPath)).rejects.toThrow(
      'maleAudioUrl',
    )
  })
})
