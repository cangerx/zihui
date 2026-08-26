import { ref } from 'vue'

/**
 * Composable that provides a unified image source picker.
 * Callers can choose between local file dialog or gallery picker.
 * Returns file paths; callers handle base64 conversion.
 */
export function usePickImageSource() {
  const showGalleryPicker = ref(false)
  const galleryMultiple = ref(false)

  let resolveCallback: ((paths: string[]) => void) | null = null

  /**
   * Open a menu/choice to pick image source.
   * Returns 'local' | 'gallery' | null (cancelled).
   */
  function pickFromGallery(multiple = false): Promise<string[]> {
    galleryMultiple.value = multiple
    showGalleryPicker.value = true
    return new Promise((resolve) => {
      resolveCallback = resolve
    })
  }

  function onGallerySelect(paths: string[]) {
    if (resolveCallback) {
      resolveCallback(paths)
      resolveCallback = null
    }
  }

  function onGalleryClose() {
    if (resolveCallback) {
      resolveCallback([])
      resolveCallback = null
    }
  }

  async function pickFromLocal(options?: {
    multiple?: boolean
    title?: string
  }): Promise<string[]> {
    const result = await window.api.dialog.openFile({
      title: options?.title || '选择图片',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'] }],
      properties: options?.multiple ? ['openFile', 'multiSelections'] : ['openFile']
    }) as { canceled: boolean; filePaths: string[] }
    if (result.canceled || !result.filePaths?.length) return []
    return result.filePaths
  }

  return {
    showGalleryPicker,
    galleryMultiple,
    pickFromGallery,
    pickFromLocal,
    onGallerySelect,
    onGalleryClose
  }
}
