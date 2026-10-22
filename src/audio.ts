import { useCallback, useEffect, useRef, useState } from 'react'
import { validateAudioUrl } from './data'
import type { Expression, Preferences } from './data'

type AudioExpression = Pick<
  Expression,
  'french' | 'audioUrl' | 'femaleAudioUrl' | 'maleAudioUrl'
>
export type RecordingVoice = 'general' | 'female' | 'male'

export function getRecordings(expression: AudioExpression) {
  const recordings: { voice: RecordingVoice; label: string; url: string }[] = []
  if (expression.audioUrl)
    recordings.push({
      voice: 'general',
      label: 'General recording',
      url: expression.audioUrl,
    })
  if (expression.femaleAudioUrl)
    recordings.push({
      voice: 'female',
      label: 'Female voice',
      url: expression.femaleAudioUrl,
    })
  if (expression.maleAudioUrl)
    recordings.push({
      voice: 'male',
      label: 'Male voice',
      url: expression.maleAudioUrl,
    })
  return recordings
}

export function useAudio(preferences: Preferences) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const recording = useRef<HTMLAudioElement | null>(null)
  const utterance = useRef<SpeechSynthesisUtterance | null>(null)
  const generation = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

  const stop = useCallback(() => {
    generation.current++
    clearTimeout(timer.current)
    if (recording.current) {
      recording.current.pause()
      recording.current.removeAttribute('src')
      recording.current.load()
      recording.current = null
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    utterance.current = null
    setPlaying(false)
  }, [])

  useEffect(() => {
    if (!supported) return
    const refresh = () =>
      setVoices(
        window.speechSynthesis
          .getVoices()
          .filter((v) => /^fr(?:[-_]|$)/i.test(v.lang)),
      )
    queueMicrotask(refresh)
    window.speechSynthesis.addEventListener('voiceschanged', refresh)
    return () =>
      window.speechSynthesis.removeEventListener('voiceschanged', refresh)
  }, [supported])
  useEffect(
    () => () => {
      stop()
    },
    [stop],
  )

  const selected =
    voices.find((v) => v.voiceURI === preferences.voiceURI) ??
    voices.find((v) => /^fr[-_]FR$/i.test(v.lang)) ??
    voices[0]
  const voiceWarning =
    preferences.voiceURI &&
    !voices.some((v) => v.voiceURI === preferences.voiceURI)
      ? `Your saved voice is unavailable on this device. ${selected ? 'Using the best available French voice; choose a new one in Manage.' : 'No French fallback is available. Enable a French voice in your device settings.'}`
      : ''

  const play = useCallback(
    (
      expression: AudioExpression,
      slow = false,
      synthesized = false,
      recordingVoice?: RecordingVoice,
    ) => {
      stop()
      setError('')
      const token = generation.current
      const fail = (message: string) => {
        if (token !== generation.current) return
        stop()
        setError(message)
      }
      const finish = () => {
        if (token !== generation.current) return
        clearTimeout(timer.current)
        setPlaying(false)
      }
      const recordings = getRecordings(expression)
      const chosenRecording = recordingVoice
        ? recordings.find((item) => item.voice === recordingVoice)
        : recordings[0]
      if (recordingVoice && !chosenRecording && !synthesized) {
        fail(
          'The selected recording is no longer available. Choose another recording or explicitly use French speech instead.',
        )
        return
      }
      if (chosenRecording && !synthesized) {
        if (!validateAudioUrl(chosenRecording.url)) {
          fail(
            'This recording URL is unsafe. Only HTTP or HTTPS recordings are allowed. Try French speech instead.',
          )
          return
        }
        const audio = new Audio()
        recording.current = audio
        audio.preload = 'none'
        audio.src = chosenRecording.url
        audio.playbackRate = slow ? 0.75 : 1
        audio.onended = finish
        audio.onerror = () =>
          fail(
            'The recording could not play. Check your connection or explicitly try French speech instead.',
          )
        audio.onplaying = () => {
          if (token === generation.current) clearTimeout(timer.current)
        }
        setPlaying(true)
        timer.current = setTimeout(
          () =>
            fail(
              'The recording took too long to start. Try again or use French speech instead.',
            ),
          15000,
        )
        void audio
          .play()
          .catch(() =>
            fail(
              'The recording was blocked or unavailable. Tap again, or try French speech instead.',
            ),
          )
        return
      }
      if (!supported || !selected) {
        fail(
          'No French voice is available. Enable or download a French voice in your device settings, then try again. English voices are never substituted.',
        )
        return
      }
      try {
        const speech = new SpeechSynthesisUtterance(expression.french)
        utterance.current = speech
        speech.voice = selected
        speech.lang = selected.lang
        speech.rate = preferences.rate * (slow ? 0.72 : 1)
        speech.onend = finish
        speech.onerror = (event) =>
          fail(
            `French playback failed (${event.error}). Tap play to retry, or check your device’s speech settings.`,
          )
        speech.onstart = () => {
          if (token === generation.current) clearTimeout(timer.current)
        }
        setPlaying(true)
        timer.current = setTimeout(
          () =>
            fail(
              'French speech did not start. Tap play to retry or select another French voice in Manage.',
            ),
          15000,
        )
        window.speechSynthesis.speak(speech)
      } catch {
        fail(
          'French speech could not start. Check your device’s speech settings and try again.',
        )
      }
    },
    [stop, supported, selected, preferences.rate],
  )

  return {
    voices,
    error,
    playing,
    play,
    stop,
    selected,
    supported,
    voiceWarning,
  }
}
export type AudioController = ReturnType<typeof useAudio>
