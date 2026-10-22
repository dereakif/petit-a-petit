export type LearningLanguage = 'tr' | 'en'
export type Mode = 'speaking' | 'listening' | 'reading'
export type Rating = 'again' | 'hard' | 'good' | 'easy'

export interface Expression {
  id: string
  french: string
  english: string
  turkish: string
  pronunciationEn: string
  pronunciationTr: string
  situationEn: string
  situationTr: string
  category: string
  tags: string[]
  lesson: number
  createdAt: string
  updatedAt: string
  pronunciationNoteEn?: string
  pronunciationNoteTr?: string
  audioUrl?: string
  femaleAudioUrl?: string
  maleAudioUrl?: string
}

export interface Preferences {
  voiceURI: string
  rate: number
  dailyNewLimit: number
}

export interface Review {
  expressionId: string
  mode: Mode
  dueAt: string
  intervalDays: number
  history: Array<{ at: string; rating: Rating }>
}

export interface AppData {
  expressions: Expression[]
  reviews: Review[]
  preferences: Preferences
  initialized: true
  sharedLibrary?: SharedLibraryState
}

export interface SharedLibrary {
  kind: 'petit-shared-library'
  version: 1
  libraryId: string
  name: string
  revision: number
  publishedAt: string
  expressions: Expression[]
}

export interface SharedLibraryState {
  libraryId: string
  name: string
  revision: number
  publishedAt: string
  expressions: Expression[]
  deletedIds: string[]
}

export interface SharedLibraryPreview {
  additions: Expression[]
  updates: Expression[]
  unchanged: Expression[]
  conflicts: Array<{ incoming: Expression; local: Expression }>
  duplicates: Array<{ incoming: Expression; local: Expression }>
  deleted: Expression[]
  removed: Expression[]
  token: string
  isCurrent: boolean
}

export type SharedLibraryChoice = 'keep' | 'shared' | 'skip' | 'add' | 'restore'

export interface LessonImport {
  kind: 'petit-lesson'
  version: 1
  expressions: Expression[]
}

export type Lesson = LessonImport

export interface Backup {
  kind: 'petit-backup'
  version: 1
  exportedAt: string
  data: AppData
}

export interface LessonPreview {
  additions: Expression[]
  updates: Expression[]
  duplicates: Array<{ incoming: Expression; existing: Expression }>
}

export interface Repository {
  load(): Promise<AppData>
  saveExpression(expression: Expression): Promise<AppData>
  deleteExpression(id: string): Promise<AppData>
  savePreferences(preferences: Preferences): Promise<AppData>
  rate(id: string, mode: Mode, rating: Rating, now?: Date): Promise<AppData>
  applyLesson(
    lesson: LessonImport,
    policy: 'skip' | 'update',
    allowDuplicates: boolean,
  ): Promise<AppData>
  applySharedLibrary(
    library: SharedLibrary,
    choices: Record<string, SharedLibraryChoice>,
    token: string,
  ): Promise<AppData>
  restore(backup: Backup): Promise<AppData>
  close(): void
}

export const defaultPreferences: Preferences = Object.freeze({
  voiceURI: '',
  rate: 0.85,
  dailyNewLimit: 3,
})

/** Comparison only: never use this to rewrite stored/displayed user text. */
export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/ı/gu, 'i')
    .replace(/[’‘ʼ`]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim()
}
