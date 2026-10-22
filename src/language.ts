import type { Expression, LearningLanguage } from './data'

export function learningText(
  expression: Expression,
  language: LearningLanguage,
) {
  const turkish = language === 'tr'
  return {
    label: turkish ? 'Turkish' : 'English',
    meaning: turkish ? expression.turkish : expression.english,
    pronunciation: turkish
      ? expression.pronunciationTr
      : expression.pronunciationEn,
    situation: turkish ? expression.situationTr : expression.situationEn,
    note: turkish
      ? expression.pronunciationNoteTr
      : expression.pronunciationNoteEn,
  }
}
