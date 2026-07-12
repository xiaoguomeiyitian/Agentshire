import catalog from './character-catalog.json'

export type CharacterModel = {
  id: string
  gender: 'male' | 'female'
  tags: string[]
  description: string
}

const MODEL_LIST: CharacterModel[] = (catalog.models ?? []) as CharacterModel[]

export function getCharacterKeyForNpc(
  _npcId: string,
  explicitCharacterKey?: string,
): string {
  if (explicitCharacterKey) return explicitCharacterKey
  return 'char-male-a'
}

export function pickUnusedCharacterKey(usedKeys: Set<string> | Map<string, string>): string {
  const usedValues = usedKeys instanceof Map
    ? new Set(usedKeys.values())
    : usedKeys

  for (const model of MODEL_LIST) {
    if (!usedValues.has(model.id)) return model.id
  }
  return 'char-male-a'
}

export function listCharacterModels(): CharacterModel[] {
  return MODEL_LIST.map((model) => ({
    ...model,
    tags: [...model.tags],
  }))
}
