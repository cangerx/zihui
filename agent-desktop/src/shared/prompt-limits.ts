export const IMAGE_PROMPT_MAX_LENGTH = 8000

export function assertImagePromptLength(prompt: string, label = '提示词'): void {
  const length = String(prompt || '').length
  if (length > IMAGE_PROMPT_MAX_LENGTH) {
    throw new Error(`${label}不能超过 ${IMAGE_PROMPT_MAX_LENGTH} 字，当前 ${length} 字`)
  }
}
