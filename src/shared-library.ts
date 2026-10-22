import { useCallback, useEffect, useRef, useState } from 'react'
import { parseSharedLibrary, SHARED_LIBRARY_ID } from './data'
import type { SharedLibrary } from './data'

const MAX_BYTES = 10 * 1024 * 1024

async function readFeed(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length')) > MAX_BYTES)
    throw new Error('The published library exceeds the 10 MB limit.')
  if (!response.body)
    throw new Error('The published library response was empty.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BYTES)
        throw new Error('The published library exceeds the 10 MB limit.')
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export function usePublishedLibrary(ready: boolean) {
  const [library, setLibrary] = useState<SharedLibrary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const request = useRef<AbortController | null>(null)
  const mounted = useRef(false)

  const check = useCallback(async (): Promise<SharedLibrary | null> => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    let timedOut = false
    if (!mounted.current) return null
    setLoading(true)
    setLibrary(null)
    setError('')
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 15000)
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}shared-library.json`,
        {
          signal: controller.signal,
          cache: 'no-store',
          credentials: 'omit',
          mode: 'same-origin',
          redirect: 'error',
        },
      )
      if (!response.ok)
        throw new Error(
          `The shared library could not be downloaded (HTTP ${response.status}).`,
        )
      const incoming = parseSharedLibrary(await readFeed(response))
      if (incoming.libraryId !== SHARED_LIBRARY_ID)
        throw new Error(
          `The published file has an unsupported library source; expected ${SHARED_LIBRARY_ID}.`,
        )
      if (!mounted.current || request.current !== controller) return null
      setLibrary(incoming)
      setCheckedAt(new Date())
      return incoming
    } catch (failure) {
      if (
        mounted.current &&
        request.current === controller &&
        (!controller.signal.aborted || timedOut)
      ) {
        setError(
          timedOut
            ? 'Checking the shared library timed out. Try again when your connection is available.'
            : failure instanceof Error
              ? failure.message
              : 'The shared library could not be checked. Try again when your connection is available.',
        )
      }
      return null
    } finally {
      clearTimeout(timeout)
      if (mounted.current && request.current === controller) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    mounted.current = true
    let active = true
    queueMicrotask(() => {
      if (active) void check()
    })
    return () => {
      active = false
      mounted.current = false
      request.current?.abort()
    }
  }, [ready, check])

  return { library, loading, error, checkedAt, check }
}
export type PublishedLibrary = ReturnType<typeof usePublishedLibrary>
