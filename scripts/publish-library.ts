import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import {
  createSharedLibrary,
  defaultPreferences,
  parseBackup,
  parseLesson,
  parseSharedLibrary,
} from '../src/data/index'
import type { Expression, SharedLibrary } from '../src/data/index'
import {
  defaultTargetPath,
  errorMessage,
  isMissingFile,
  readPublishedLibrary,
  requireConfiguredLibrary,
} from './shared-library'

export function parsePublishingInput(text: string): Expression[] {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    // JSON engine errors can quote private backup content. Do not log it.
    throw new Error('Invalid JSON; select a complete JSON export from Manage.')
  }
  const kind =
    value !== null && typeof value === 'object' && 'kind' in value
      ? value.kind
      : undefined
  switch (kind) {
    case 'petit-shared-library': {
      const library = parseSharedLibrary(text)
      requireConfiguredLibrary(library)
      return library.expressions
    }
    case 'petit-lesson':
      return parseLesson(text).expressions
    case 'petit-backup': {
      const backup = parseBackup(text)
      if (backup.data.sharedLibrary)
        requireConfiguredLibrary(backup.data.sharedLibrary)
      return backup.data.expressions
    }
    default:
      throw new Error(
        'Expected a petit-shared-library, petit-lesson vocabulary export, or petit-backup full backup.',
      )
  }
}

async function atomicWrite(targetPath: string, text: string): Promise<void> {
  const temporaryPath = join(
    dirname(targetPath),
    `.${basename(targetPath)}.${randomUUID()}.tmp`,
  )
  const handle = await fs.open(temporaryPath, 'wx', 0o644)
  try {
    try {
      await handle.writeFile(text, 'utf8')
    } finally {
      await handle.close()
    }
    await fs.rename(temporaryPath, targetPath)
  } finally {
    await fs.unlink(temporaryPath).catch((error: unknown) => {
      if (!isMissingFile(error)) throw error
    })
  }
}

export async function publishLibrary(
  inputPath: string,
  targetPath = defaultTargetPath,
): Promise<SharedLibrary> {
  if (!inputPath.trim())
    throw new Error(
      'An explicit input path is required; download an export from Manage first.',
    )
  if (resolve(inputPath) === resolve(targetPath))
    throw new Error(
      'Input and published target must be different files; keep your source export unchanged.',
    )

  let expressions: Expression[]
  try {
    expressions = parsePublishingInput(await fs.readFile(inputPath, 'utf8'))
  } catch (error) {
    throw new Error(
      `Cannot publish input ${inputPath}: ${errorMessage(error)}`,
      { cause: error },
    )
  }

  let revision = 1
  try {
    revision = (await readPublishedLibrary(targetPath)).revision + 1
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }
  const library = createSharedLibrary(
    {
      expressions,
      reviews: [],
      preferences: defaultPreferences,
      initialized: true,
    },
    revision,
  )
  try {
    await atomicWrite(targetPath, `${JSON.stringify(library, null, 2)}\n`)
  } catch (error) {
    throw new Error(
      `Cannot replace published library at ${targetPath}: ${errorMessage(error)}`,
      { cause: error },
    )
  }
  return library
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 3 || !process.argv[2]?.trim())
      throw new Error('Usage: bun scripts/publish-library.ts INPUT')
    const library = await publishLibrary(process.argv[2])
    console.log(
      `Published ${library.expressions.length} expressions at revision ${library.revision} to ${defaultTargetPath}.`,
    )
  } catch (error) {
    console.error(`Publish failed: ${errorMessage(error)}`)
    process.exitCode = 1
  }
}
