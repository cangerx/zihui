import type { RouteRecordRaw } from 'vue-router'
import { getHomePath } from '@/utils/home-path'

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login/LoginView.vue'),
    meta: { guest: true }
  },
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    meta: { requiresAuth: true },
    children: [
    // 首页 = 对话空态工作台（云控端隐藏对话菜单时 getHomePath 回退 /bots）
      { path: '', redirect: () => getHomePath() },
      { path: 'chat', name: 'chat', component: () => import('@/views/chat/ChatView.vue'), meta: { title: '对话' } },
      {
        path: 'daily-review',
        name: 'dailyReview',
        component: () => import('@/views/daily-review/DailyReviewView.vue'),
        meta: { title: '每日回顾' }
      },
      {
        // 自动化（定时任务）：暂时下线，旧链接回首页。恢复时改回 ScheduledTasksView
        path: 'scheduled-tasks',
        redirect: '/'
      },
      {
        path: 'browser',
        name: 'browser',
        component: () => import('@/views/browser/BrowserView.vue'),
        meta: { title: '浏览器' }
      },
      { path: 'bots', name: 'bots', component: () => import('@/views/bots/BotListView.vue'), meta: { title: '专家库' } },
      { path: 'knowledge', name: 'knowledge', component: () => import('@/views/knowledge/KnowledgeView.vue'), meta: { title: '知识库' } },
      { path: 'knowledge/vectors', name: 'knowledgeVectors', component: () => import('@/views/knowledge/VectorStatsView.vue'), meta: { title: '知识库索引' } },
      { path: 'knowledge/:categoryId', name: 'knowledgeCategory', component: () => import('@/views/knowledge/KnowledgeCategoryView.vue'), meta: { title: '知识库详情' } },
      {
        // 模型服务并入设置「模型」；保留 /models 兼容跳转
        path: 'models',
        name: 'models',
        redirect: { path: '/settings', query: { tab: 'models' } },
        meta: { title: '模型' }
      },
      {
        // 老链接 /video-models → 设置模型（视频 tab 已下线）
        path: 'video-models',
        redirect: { path: '/settings', query: { tab: 'models' } },
      },
      {
        // 快速抠图 / 精细抠图：暂时下线，旧链接回首页
        path: 'ai-matting',
        redirect: '/'
      },
      {
        path: 'fine-matting',
        redirect: '/'
      },
      {
        path: 'personas',
        name: 'personas',
        component: () => import('@/views/personas/PersonaView.vue'),
        meta: { title: '人设规则' }
      },
      {
        path: 'tools',
        name: 'tools',
        component: () => import('@/views/skills/SkillView.vue'),
        meta: { title: '小工具' }
      },
      {
        path: 'skills',
        name: 'skills',
        component: () => import('@/views/skills/SkillsView.vue'),
        meta: { title: '技能库' }
      },
      {
        path: 'mcps',
        name: 'mcps',
        component: () => import('@/views/mcps/McpView.vue'),
        meta: { title: 'MCP' }
      },
      {
        path: 'image-gen',
        name: 'imageGen',
        component: () => import('@/views/image-gen/ImageGenView.vue'),
        meta: { title: 'AI 生图' }
      },
      // AI PPT 暂时下线
      // {
      //   path: 'deck',
      //   name: 'deck',
      //   component: () => import('@/views/deck/DeckView.vue'),
      //   meta: { title: 'AI PPT' }
      // },
      {
        path: 'ecom/batch-sku',
        name: 'ecomBatchSku',
        component: () => import('@/views/ecom/BatchSkuView.vue'),
        meta: { title: 'AI 批量SKU生成' }
      },
      {
        path: 'ecom/clone',
        name: 'ecomClone',
        component: () => import('@/views/ecom/EcomCloneView.vue'),
        meta: { title: 'AI 一键电商图复刻' }
      },
      {
        path: 'ecom/main',
        name: 'ecomMain',
        component: () => import('@/views/ecom/EcomMainView.vue'),
        meta: { title: 'AI 一键生成主图' }
      },
      {
        path: 'ecom/detail',
        name: 'ecomDetail',
        component: () => import('@/views/ecom/EcomDetailView.vue'),
        meta: { title: 'AI 一键生成详情页' }
      },
      {
        path: 'ecom/poster',
        name: 'ecomPoster',
        component: () => import('@/views/ecom/PosterView.vue'),
        meta: { title: 'AI 海报生成' }
      },
      {
        // ewei 商城：连接器列表 + 登录 + 选门店
        path: 'ewei',
        name: 'eweiConnectors',
        component: () => import('@/views/ewei/EweiConnectorsView.vue'),
        meta: { title: '店铺商品图', requireAnyMall: true }
      },
      {
        // 某门店商品列表
        path: 'ewei/:connectorId/goods',
        name: 'eweiGoods',
        component: () => import('@/views/ewei/EweiGoodsListView.vue'),
        meta: { title: '门店商品', requireAnyMall: true }
      },
      {
        // 新增商品
        path: 'ewei/:connectorId/goods/new',
        name: 'eweiGoodsCreate',
        component: () => import('@/views/ewei/EweiGoodsCreateView.vue'),
        meta: { title: '新增商品', requireAnyMall: true }
      },
      {
        // 某商品的图片替换工作台
        path: 'ewei/:connectorId/goods/:goodsId/image',
        name: 'eweiGoodsImage',
        component: () => import('@/views/ewei/EweiGoodsImageView.vue'),
        meta: { title: '商品图替换', requireAnyMall: true }
      },
      {
        // 兼容旧入口：打开设置「微信 ClawBot」分类
        path: 'clawbot',
        name: 'clawbot',
        redirect: { path: '/settings', query: { tab: 'clawbot' } }
      },
      {
        path: 'batch-gen',
        name: 'batchGen',
        component: () => import('@/views/image-gen/BatchGenView.vue'),
        meta: { title: '批量生图' }
      },
      {
        path: 'image-to-prompt',
        name: 'imageToPrompt',
        component: () => import('@/views/image-gen/Image2PromptView.vue'),
        meta: { title: '图片反推' }
      },
      {
        path: 'image-toolkit',
        name: 'imageToolkit',
        component: () => import('@/views/image-toolkit/ImageToolkitView.vue'),
        meta: { title: '图像处理' }
      },
      {
        path: 'image-toolkit/collage',
        name: 'imageToolkitCollage',
        component: () => import('@/views/image-toolkit/CollageView.vue'),
        meta: { title: '拼图拼接' }
      },
      {
        path: 'image-toolkit/watermark',
        name: 'imageToolkitWatermark',
        component: () => import('@/views/image-toolkit/WatermarkView.vue'),
        meta: { title: '加水印' }
      },
      {
        path: 'image-toolkit/format-convert',
        name: 'imageToolkitFormatConvert',
        component: () => import('@/views/image-toolkit/FormatConvertView.vue'),
        meta: { title: '格式转换' }
      },
      {
        path: 'image-toolkit/compress',
        name: 'imageToolkitCompress',
        component: () => import('@/views/image-toolkit/CompressView.vue'),
        meta: { title: '图片压缩' }
      },
      {
        path: 'image-toolkit/slice',
        name: 'imageToolkitSlice',
        component: () => import('@/views/image-toolkit/SliceView.vue'),
        meta: { title: '切图' }
      },
      {
        path: 'image-toolkit/gif',
        name: 'imageToolkitGif',
        component: () => import('@/views/image-toolkit/GifView.vue'),
        meta: { title: 'GIF 制作' }
      },
      {
        path: 'image-toolkit/remove-ai-mark',
        name: 'imageToolkitRemoveAiMark',
        component: () => import('@/views/image-toolkit/RemoveAiMarkView.vue'),
        meta: { title: '去AI标记' }
      },
      {
        path: 'inspiration',
        name: 'inspiration',
        component: () => import('@/views/image-gen/InspirationView.vue'),
        meta: { title: '灵感广场' }
      },
      {
        path: 'my-creations',
        name: 'myCreations',
        component: () => import('@/views/image-gen/MyCreationsView.vue'),
        meta: { title: '我的创作' }
      },
      {
        path: 'ai-video',
        name: 'aiVideo',
        component: () => import('@/views/video/AiVideoView.vue'),
        meta: { title: 'AI 视频' }
      },
      {
        path: 'viral-clone',
        name: 'viralClone',
        component: () => import('@/views/video/ViralCloneView.vue'),
        meta: { title: '爆款复刻' }
      },
      {
        path: 'video-creations',
        name: 'videoCreations',
        component: () => import('@/views/video/VideoCreationsView.vue'),
        meta: { title: '视频创作' }
      },
      {
        // v0.7.7+ 创意模板：本地模板分类管理 + 云端模板浏览
        // 旧路径 /canvas-square 保留为「创意模板」入口（侧栏菜单已挂在此路径），无需迁移外链
        path: 'canvas-square',
        name: 'canvasSquare',
        component: () => import('@/views/creative-templates/CreativeTemplatesView.vue'),
        meta: { title: '创意模板' }
      },
      {
        path: 'image-edit/:id',
        name: 'imageEdit',
        component: () => import('@/views/image-gen/ImageEditView.vue'),
        meta: { title: '图片编辑' }
      },
      {
        path: 'canvas',
        name: 'canvas',
        component: () => import('@/views/canvas/CanvasListView.vue'),
        meta: { title: '流式画布' }
      },
      {
        path: 'brand-workspaces',
        name: 'brandWorkspaces',
        component: () => import('@/views/brand-workspace/BrandWorkspaceListView.vue'),
        meta: { title: '品牌工作区' }
      },
      {
        path: 'canvas/:id',
        name: 'canvasEditor',
        component: () => import('@/views/canvas/CanvasEditorView.vue'),
        meta: { title: '流式画布编辑' }
      },
      {
        path: 'gallery',
        name: 'gallery',
        component: () => import('@/views/gallery/GalleryView.vue'),
        meta: { title: '本地图库' }
      },
      {
        path: 'prompts',
        name: 'prompts',
        component: () => import('@/views/prompts/PromptManageView.vue'),
        meta: { title: '提示词' }
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('@/views/settings/OpenSettingsRoute.vue'),
        meta: { title: '设置' }
      },
      {
        path: 'user-center',
        name: 'userCenter',
        component: () => import('@/views/user-center/UserCenterView.vue'),
        meta: { title: '用户中心' }
      },
      {
        path: 'plans-store',
        name: 'plansStore',
        component: () => import('@/views/plans-store/PlansStoreView.vue'),
        meta: { title: '套餐商城' }
      },
      {
        path: 'recharge',
        name: 'recharge',
        component: () => import('@/views/recharge/RechargeView.vue'),
        meta: { title: '充值' }
      },
      {
        path: 'oem-channel',
        name: 'oemChannel',
        component: () => import('@/views/user-center/OemChannelCenterView.vue'),
        meta: { title: '渠道中心' }
      },
      {
        // 兜底：未匹配路径（如云控端自定义菜单配错的内部目标）回退首页，
        // 避免 Vue Router 无匹配时渲染空白、无任何提示的死胡同
        path: ':pathMatch(.*)*',
        redirect: () => getHomePath()
      }
    ]
  }
]
