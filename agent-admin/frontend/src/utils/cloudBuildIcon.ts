export const CLOUD_BUILD_ICON_MIN = 512;
export const CLOUD_BUILD_ICON_MAX = 1024;
export const CLOUD_BUILD_ICON_MAX_BYTES = 2 * 1024 * 1024;
export const CLOUD_BUILD_ICON_RULE_TEXT = `PNG 格式，1:1 正方形，尺寸 ${CLOUD_BUILD_ICON_MIN}×${CLOUD_BUILD_ICON_MIN} 至 ${CLOUD_BUILD_ICON_MAX}×${CLOUD_BUILD_ICON_MAX}，不超过 ${(CLOUD_BUILD_ICON_MAX_BYTES / 1024 / 1024).toFixed(0)} MB`;

export async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image_load_failed'));
    };
    img.src = url;
  });
}

export async function validateCloudBuildIcon(file: File): Promise<true | string> {
  if (file.type !== 'image/png') {
    return '仅支持 PNG 格式';
  }
  if (file.size > CLOUD_BUILD_ICON_MAX_BYTES) {
    return `图标体积不能超过 ${(CLOUD_BUILD_ICON_MAX_BYTES / 1024 / 1024).toFixed(0)} MB`;
  }
  try {
    const { width, height } = await readImageDimensions(file);
    if (width !== height) {
      return `图标必须是 1:1 正方形（当前 ${width} x ${height}）`;
    }
    if (width < CLOUD_BUILD_ICON_MIN || width > CLOUD_BUILD_ICON_MAX) {
      return `图标边长必须在 ${CLOUD_BUILD_ICON_MIN} 到 ${CLOUD_BUILD_ICON_MAX} 之间（当前 ${width}）`;
    }
  } catch {
    return '图标解析失败，请确认是有效的 PNG 文件';
  }
  return true;
}

export function getCloudBuildIconUploadErrorMessage(err: any): string {
  const detail = err?.response?.data;
  const serverErr = detail?.error;
  if (serverErr === 'aspect_ratio_must_be_1_1') {
    return `服务端校验：图标必须 1:1 正方形（当前 ${detail.width} x ${detail.height}）`;
  }
  if (serverErr === 'size_out_of_range') {
    return `服务端校验：图标边长必须在 ${detail.min} 到 ${detail.max} 之间（当前 ${detail.actual}）`;
  }
  if (serverErr === 'not_a_real_png') {
    return '服务端校验：文件不是有效的 PNG 图片';
  }
  if (serverErr === 'validation_failed') {
    return '上传失败：请上传 PNG 格式、1:1 正方形、512 至 1024 边长且不超过 2 MB 的图标';
  }
  if (serverErr === 'storage_unavailable') {
    return '上传失败：文件存储暂不可用，请检查存储配置后重试';
  }
  return serverErr || detail?.message || '图标上传失败';
}
