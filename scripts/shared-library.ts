import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseSharedLibrary, SHARED_LIBRARY_ID } from '../src/data/index'
import type { SharedLibrary } from '../src/data/index'

export const defaultTargetPath = fileURLToPath(
  new URL('../public/shared-library.json', import.meta.url),
)

export function requireConfiguredLibrary(library: { libraryId: string }): void {
  if (library.libraryId !== SHARED_LIBRARY_ID)
    throw new Error(
      `Unsupported shared library source; expected libraryId "${SHARED_LIBRARY_ID}".`,
    )
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export function parsePublishedLibrary(text: string): SharedLibrary {
  const library = parseSharedLibrary(text)
  requireConfiguredLibrary(library)
  return library
}

export async function readPublishedLibrary(
  targetPath: string,
): Promise<SharedLibrary> {
  // Keep read errors distinguishable: only a missing file may start at revision 1.
  const text = await readFile(targetPath, 'utf8')
  try {
    return parsePublishedLibrary(text)
  } catch (error) {
    throw new Error(
      `Invalid published library at ${targetPath}: ${errorMessage(error)}`,
      { cause: error },
    )
  }
}
