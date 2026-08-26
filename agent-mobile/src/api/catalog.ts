import type { AppCategory } from './types'

export const AI_IMAGE_APP_ID = 'app-ai-image'

export const IMAGE_RATIO_OPTIONS = [
  { label: '1:1 方图', value: '1:1' },
  { label: '3:4 竖图', value: '3:4' },
  { label: '4:3 横图', value: '4:3' },
  { label: '9:16 长图', value: '9:16' },
  { label: '16:9 宽图', value: '16:9' },
]

export const productionAppCategories: AppCategory[] = [
  {
    name: 'AI 创作',
    apps: [
      {
        uuid: AI_IMAGE_APP_ID,
        name: 'AI 生图',
        poster: '/static/logo.png',
        icon: 'ai-image',
        description: '输入画面描述，选择模型和比例生成图片',
      },
    ],
  },
]
