/**
 * AI 换姿势：预设动作 + 身体朝向 + 保留项 + Prompt 合成器。
 *
 * 配套 `@/components/PoseChangeDialog.vue`：用户在弹窗里以三 tab 切换
 * 「预设动作 / 文字描述 / 参考姿势图」+ 身体朝向选择 + 高级折叠里的保留项开关，
 * 由 `composePoseChangePrompt()` 合成 prompt 跳 `/image-gen`。
 *
 * 与 AI 换装的差异：
 *  - 换装强约束「只换衣服」，换姿势强约束「只换姿势」
 *  - 换装 preserve 包含 pose（保留姿势）；换姿势 preserve 包含 outfit（保留服装）
 *  - 换装无朝向概念；换姿势的「身体朝向」是核心维度
 */

export type PoseSource = 'preset' | 'text' | 'ref-image'

export type PoseCategoryId = 'standing' | 'sitting' | 'interactive' | 'dynamic' | 'photo'

export interface PoseCategory {
  id: PoseCategoryId
  label: string
}

export interface PosePreset {
  id: string
  label: string
  category: PoseCategoryId
  /** 详细的中文姿势描述，直接拼入 prompt 让模型更准确理解 */
  prompt: string
}

export const POSE_CATEGORIES: PoseCategory[] = [
  { id: 'standing', label: '站姿' },
  { id: 'sitting', label: '坐姿' },
  { id: 'interactive', label: '互动' },
  { id: 'dynamic', label: '动态' },
  { id: 'photo', label: '拍照' }
]

export const POSE_PRESETS: PosePreset[] = [
  // 站姿
  { id: 'natural-stand', label: '自然站立', category: 'standing', prompt: '自然站立，双臂自然下垂，重心稳定' },
  { id: 'hands-on-hips', label: '双手叉腰', category: 'standing', prompt: '双手叉腰，身体正立，自信姿态' },
  { id: 'arms-crossed', label: '抱臂胸前', category: 'standing', prompt: '双臂在胸前交叉抱起，姿态稳重' },
  { id: 'hand-in-pocket', label: '单手插袋', category: 'standing', prompt: '一手插裤袋，另一手自然下垂，轻松随性' },
  { id: 'leaning', label: '侧身倚靠', category: 'standing', prompt: '侧身倚靠，重心移向一侧，姿态放松' },
  // 坐姿
  { id: 'sit-upright', label: '端坐', category: 'sitting', prompt: '端正坐姿，背部挺直，双手放在膝盖上' },
  { id: 'sit-thinking', label: '托腮思考', category: 'sitting', prompt: '坐姿托腮思考，单手撑下巴，目光下垂' },
  { id: 'sit-cross-legged', label: '跷二郎腿', category: 'sitting', prompt: '坐姿翘二郎腿，姿态轻松' },
  { id: 'sit-ground', label: '盘腿地坐', category: 'sitting', prompt: '盘腿坐于地上，背部挺直' },
  { id: 'sit-relax', label: '沙发瘫坐', category: 'sitting', prompt: '半躺式坐姿，姿态放松，身体后仰' },
  // 互动
  { id: 'waving', label: '挥手招呼', category: 'interactive', prompt: '抬手向前挥手打招呼，手掌张开' },
  { id: 'pointing', label: '伸手指向', category: 'interactive', prompt: '伸手指向前方，食指伸直' },
  { id: 'peace-sign', label: '比剪刀手', category: 'interactive', prompt: '比剪刀手 V 字手势，靠近脸颊' },
  { id: 'thumbs-up', label: '点赞', category: 'interactive', prompt: '竖起大拇指点赞，握拳举起' },
  { id: 'heart-hands', label: '比心', category: 'interactive', prompt: '双手在胸前比心，十指相扣' },
  // 动态
  { id: 'walking', label: '行走', category: 'dynamic', prompt: '行走中，迈步前行，双臂自然摆动' },
  { id: 'running', label: '奔跑', category: 'dynamic', prompt: '奔跑中，动态向前，双脚一前一后' },
  { id: 'jumping', label: '跳跃', category: 'dynamic', prompt: '跳跃中，双脚离地，双臂张开' },
  { id: 'turning-back', label: '回头转身', category: 'dynamic', prompt: '回头转身，半侧脸朝向镜头，身体侧立' },
  { id: 'squatting', label: '蹲下', category: 'dynamic', prompt: '蹲下，双膝弯曲，重心降低' },
  // 拍照
  { id: 'self-portrait', label: '半身自拍', category: 'photo', prompt: '半身自拍角度，单手举至胸前，自然微笑' },
  { id: 'looking-far', label: '侧身远眺', category: 'photo', prompt: '侧身远眺，视线望向远方，姿态优雅' },
  { id: 'chin-on-hand', label: '托腮看镜头', category: 'photo', prompt: '托腮看镜头，单手轻放下颌' },
  { id: 'arms-open', label: '双臂张开', category: 'photo', prompt: '双臂向两侧张开，迎接拥抱姿态' },
  { id: 'side-glance', label: '回眸侧望', category: 'photo', prompt: '回眸侧望，肩膀微转，姿态优雅' }
]

export interface BodyOrientation {
  id: string
  label: string
  /** 拼进 prompt 的中文片段 */
  prompt: string
}

/** 身体朝向：与预设/文字 tab 配合；参考姿势图自带朝向，此字段忽略 */
export const BODY_ORIENTATIONS: BodyOrientation[] = [
  { id: 'front', label: '正面', prompt: '正对镜头' },
  { id: 'left-3q', label: '左 3/4', prompt: '左侧 3/4 角度' },
  { id: 'right-3q', label: '右 3/4', prompt: '右侧 3/4 角度' },
  { id: 'left-side', label: '左侧', prompt: '左侧侧面' },
  { id: 'right-side', label: '右侧', prompt: '右侧侧面' },
  { id: 'back', label: '背面', prompt: '背对镜头' }
]

/** 保留项开关：默认全开 */
export interface PosePreserveOptions {
  face: boolean        // 脸 / 五官 / 身份
  outfit: boolean      // 服装款式、颜色与材质
  background: boolean  // 背景 / 构图 / 光线
  hair: boolean        // 发型
  bodyShape: boolean   // 体型 / 身材比例
}

export const DEFAULT_PRESERVE_OPTIONS: PosePreserveOptions = {
  face: true,
  outfit: true,
  background: true,
  hair: true,
  bodyShape: true
}

export interface PoseChangePayload {
  /** 姿势来源 tab */
  source: PoseSource
  /** 姿势文字描述：预设的 prompt / 用户自定义文本；source = 'ref-image' 时可为空 */
  poseText: string
  /** 身体朝向中文（如「正面」「左 3/4」）；不指定时留空 */
  orientationLabel?: string
  /** 身体朝向 prompt 片段；与 orientationLabel 配套出现 */
  orientationPrompt?: string
  /** 是否提供了参考姿势图（人物姿势照） */
  hasPoseRefImage: boolean
  /** 保留项开关 */
  preserve: PosePreserveOptions
}

/**
 * 合成 AI 换姿势 prompt（中文）。
 *
 * 设计目标：
 *  - 强约束「只换姿势」，最大程度保留脸 / 服装 / 背景 / 发型 / 体型
 *  - 提供姿势参考图时主指令切到「参照第二张图中人物的姿势」
 *  - 朝向仅在文字/预设 tab 生效；参考图自带朝向不附加
 *  - preserve 项逐条展开——模型对显式约束响应更稳
 */
export function composePoseChangePrompt(p: PoseChangePayload): string {
  // 主指令
  let main: string
  if (p.hasPoseRefImage) {
    // 参考姿势图（人物照）
    main = '将第一张图中人物的姿势调整为第二张图中人物的姿势'
  } else {
    // 文字 / 预设
    const poseText = (p.poseText || '').trim() || '自然站立'
    main = `将照片中人物的姿势调整为「${poseText}」`
  }

  // 身体朝向：预设 / 文字 tab 可附加；参考姿势图自带朝向不需要
  if (p.orientationPrompt && !p.hasPoseRefImage) {
    main += `，身体朝向：${p.orientationPrompt}`
  }

  // 保留项约束
  const keep: string[] = []
  if (p.preserve.face) keep.push('严格保留人物的脸部五官、肤色与身份特征')
  if (p.preserve.outfit) keep.push('保留原有服装款式、颜色与材质')
  if (p.preserve.background) keep.push('保留原图背景、构图、光线方向与相机角度')
  if (p.preserve.hair) keep.push('保留原有发型')
  if (p.preserve.bodyShape) keep.push('保留原有体型与身材比例')

  const parts = [main + '。']
  if (keep.length > 0) parts.push('要求：' + keep.join('；') + '。')
  parts.push('新姿势需符合人体解剖结构，肢体比例自然，关节弯曲合理，服装贴合新姿势的褶皱与阴影。')
  parts.push('不要改变图片中除姿势以外的任何部分。')
  return parts.join(' ')
}
