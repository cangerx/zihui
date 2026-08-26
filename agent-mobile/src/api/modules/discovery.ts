import { appV1Client, apiErrorCode } from '../v1-client'
import { USE_MOCK } from '../config'
import { productionAppCategories } from '../catalog'

export interface DiscoveryHomeCategory {
  key: string
  name: string
}

export interface DiscoveryHomeShowcase {
  id: string
  cover: string
  title: string
  video?: boolean
  prompt?: string
  refs?: string[]
}

export interface DiscoveryHomeEntry {
  key: string
  name: string
  icon: string
  badge?: 'NEW' | 'HOT'
  target: 'intro' | 'run' | 'canvas' | 'ai-image' | 'suite'
  appUuid?: string
}

export interface DiscoveryTemplateItem {
  id: string
  cover: string
  title: string
  ratio: number
  appUuid: string
}

export interface HomeDiscovery {
  categories: DiscoveryHomeCategory[]
  entries: DiscoveryHomeEntry[]
  recommendTabs: string[]
  showcases: Record<string, DiscoveryHomeShowcase[]>
  assetsEnabled: boolean
}

export interface TemplatePage {
  items: DiscoveryTemplateItem[]
  hasMore: boolean
}

const EMPTY_HOME: HomeDiscovery = {
  categories: [],
  entries: [],
  recommendTabs: [],
  showcases: {},
  assetsEnabled: false,
}

/**
 * 首页发现能力。Mock 数据通过动态 import 隔离，生产只返回已接通的图片工具。
 */
export async function getHomeDiscovery(): Promise<HomeDiscovery> {
  if (USE_MOCK) {
    const mock = await import('../mock/data')
    return {
      categories: mock.homeCategories,
      entries: mock.homeEntries,
      recommendTabs: mock.homeRecommendTabs,
      showcases: mock.homeShowcases,
      assetsEnabled: true,
    }
  }

  try {
    const bootstrap = await appV1Client.bootstrap()
    if (!bootstrap.features.image?.enabled) return EMPTY_HOME
    const imageApps = productionAppCategories.flatMap((category) => category.apps)
    return {
      categories: [{ key: 'image', name: 'AI 生图' }],
      entries: imageApps.map((app) => ({
        key: app.uuid,
        name: app.name,
        icon: app.icon || 'ai-image',
        target: 'run' as const,
        appUuid: app.uuid,
      })),
      recommendTabs: ['AI 生图'],
      showcases: {},
      assetsEnabled: Boolean(bootstrap.features.assets?.enabled),
    }
  } catch (error) {
    console.warn(`[discovery] bootstrap failed (${apiErrorCode(error)})`)
    return EMPTY_HOME
  }
}

/** 模板接口尚未纳入 App v1，生产态 fail closed。 */
export async function getTemplatePage(options: {
  page: number
  size?: number
  keyword?: string
  tab?: string
  filters?: Record<string, string>
  sort?: string
}): Promise<TemplatePage> {
  if (!USE_MOCK) return { items: [], hasMore: false }
  const mock = await import('../mock/data')
  const size = options.size || 20
  return {
    items: mock.makeTemplates(options.page, size, {
      keyword: options.keyword,
      tab: options.tab,
      filters: options.filters,
      sort: options.sort,
    }),
    hasMore: options.page < 5,
  }
}
