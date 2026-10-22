import process from 'node:process'
import {
  defaultTargetPath,
  errorMessage,
  readPublishedLibrary,
} from './shared-library'

export async function validatePublishedLibrary(targetPath = defaultTargetPath) {
  return readPublishedLibrary(targetPath)
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 2)
      throw new Error('Usage: bun scripts/validate-shared-library.ts')
    const library = await validatePublishedLibrary()
    console.log(
      `Valid shared library: ${library.expressions.length} expressions, revision ${library.revision} (${library.libraryId}).`,
    )
  } catch (error) {
    console.error(`Shared library validation failed: ${errorMessage(error)}`)
    process.exitCode = 1
  }
}
