/**
 * 证件照规格定义。
 *
 * 数据来源（公安部、外交部、各地驾管所公开规范）：
 *  - 一寸照（标准）25×35mm 5:7  简历 / 考试 / 入职
 *  - 小一寸（黑白大头）22×32mm 11:16  早期身份证、部分地方社保卡
 *  - 二代身份证 26×32mm 13:16 (350dpi, 白底)
 *  - 护照 / 港澳通行证 33×48mm 11:16
 *  - 二寸照（标准）35×49mm 5:7  资格证书、毕业证
 *  - 小二寸（申根签证）33×48mm 11:16
 *  - 美国签证 51×51mm 1:1（头部 25~35mm）
 *  - 日本签证 45×45mm 1:1
 *  - 驾驶证 22×32mm 11:16
 *
 * presetSize 直接透传给 ImageGenView 的 size 字段——支持 "A:B" 形式（A、B 均为 1~99 整数）。
 */

export interface IDPhotoStyle {
  id: string
  label: string
  mm: string
  ratio: string
  presetSize: string
}

export const ID_PHOTO_STYLES: IDPhotoStyle[] = [
  { id: '1inch-std', label: '一寸照（标准）', mm: '25×35 mm', ratio: '5:7', presetSize: '5:7' },
  { id: '1inch-small', label: '小一寸（大头照）', mm: '22×32 mm', ratio: '11:16', presetSize: '11:16' },
  { id: 'id-card-2nd', label: '二代身份证', mm: '26×32 mm', ratio: '13:16', presetSize: '13:16' },
  { id: 'passport', label: '护照/港澳通行证', mm: '33×48 mm', ratio: '11:16', presetSize: '11:16' },
  { id: '2inch-std', label: '二寸照（标准）', mm: '35×49 mm', ratio: '5:7', presetSize: '5:7' },
  { id: '2inch-small', label: '小二寸（申根签证）', mm: '33×48 mm', ratio: '11:16', presetSize: '11:16' },
  { id: 'visa-us', label: '美国签证', mm: '51×51 mm', ratio: '1:1', presetSize: '1:1' },
  { id: 'visa-jp', label: '日本签证', mm: '45×45 mm', ratio: '1:1', presetSize: '1:1' },
  { id: 'driver-license', label: '驾驶证', mm: '22×32 mm', ratio: '11:16', presetSize: '11:16' }
]

export interface IDPhotoBgPreset {
  label: string
  /** Hex 颜色码 */
  value: string
}

export const ID_PHOTO_BG_PRESETS: IDPhotoBgPreset[] = [
  { label: '白底', value: '#FFFFFF' },
  { label: '蓝底', value: '#438EDB' },
  { label: '红底', value: '#D9352F' },
  { label: '浅灰', value: '#EEEEEE' }
]

/**
 * 证件照常用服装预设。
 * label 直接拼进 prompt，模型可识别。用户也可在弹窗里输入自定义服装文字。
 */
export interface IDPhotoOutfitPreset {
  id: string
  label: string
}

export const ID_PHOTO_OUTFIT_PRESETS: IDPhotoOutfitPreset[] = [
  { id: 'suit', label: '深色西装配白衬衫' },
  { id: 'shirt', label: '白色衬衫' },
  { id: 'business', label: '职业装' },
  { id: 'student', label: '校服 / 学生装' },
  { id: 'uniform', label: '工作制服' },
  { id: 'casual', label: '简约深色上衣' },
  { id: 'sweater', label: '纯色针织衫' },
  { id: 'keep', label: '保留原图服装' }
]

/**
 * 用证件照样式 + 背景色 + 服装合成生图 prompt（中文）。
 * - outfit 可以是预设 label，也可以是用户自定义文字（trim 后非空即生效）
 * - 留空或 "保留原图服装" 走特殊分支：不强制换装，仅要求与场合得体
 */
export function composeIDPhotoPrompt(
  style: IDPhotoStyle,
  bgColor: string,
  bgLabel: string,
  outfit: string
): string {
  const outfitTxt = (outfit || '').trim()
  const isKeepOriginal = outfitTxt === '' || outfitTxt === '保留原图服装'
  const outfitPhrase = isKeepOriginal
    ? '保留原图服装（如不符合证件照场合则替换为得体的深色西装）'
    : `身穿${outfitTxt}`

  return `专业证件照（${style.label}，尺寸 ${style.mm}，比例 ${style.ratio}）：` +
    `纯色${bgLabel}背景（${bgColor}）、` +
    `${outfitPhrase}、表情自然、正面证件照构图、` +
    `干净均匀的棚拍光线、面部焦点清晰、背景无阴影、头肩居中。` +
    `保留原始面部特征与身份。`
}
