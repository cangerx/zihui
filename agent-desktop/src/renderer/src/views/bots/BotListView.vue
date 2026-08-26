<template>
  <div class="h-full flex flex-col">
    <div class="page-body" ref="pageBodyRef" @scroll="onPageScroll" :style="pageBgStyle">
      <div class="max-w-7xl mx-auto">
      <!-- Hero：本页同时是桌面端首页门面（文案不含品牌名，OEM 中性） -->
      <section class="rounded-2xl border border-surface-3 bg-gradient-to-br from-primary-50/80 via-surface-0 to-surface-0 px-8 py-7 mb-5 flex items-center gap-6">
        <div class="flex-1 min-w-0">
          <h1 class="text-2xl font-bold text-text-primary">你的数字员工</h1>
          <p class="text-xs text-text-tertiary mt-2">为岗位配置知识、技能和工作环境，在实际使用中持续完善</p>
        </div>
        <button v-if="activeTab === 'mine'" class="btn-primary shrink-0" @click="openCreate">+ 新建数字员工</button>
      </section>

      <!-- 工具行：tab（分段控件）+ 统一搜索框（我的=即时过滤；市场=回车/点图标检索） -->
      <div class="flex items-center justify-between gap-3 mb-4">
        <div class="flex gap-0.5 p-0.5 rounded-lg bg-surface-2">
          <button
            :class="['px-3 py-1.5 text-sm font-medium rounded-md transition-colors', activeTab === 'mine' ? 'bg-surface-0 text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary']"
            @click="activeTab = 'mine'"
          >我的数字员工</button>
          <button
            :class="['px-3 py-1.5 text-sm font-medium rounded-md transition-colors', activeTab === 'market' ? 'bg-surface-0 text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary']"
            @click="switchToMarket"
          >数字员工市场</button>
        </div>
        <div class="relative w-72 shrink-0">
          <input
            v-model="heroSearch"
            class="input-field !py-1.5 !pr-8 text-xs"
            :placeholder="activeTab === 'mine' ? '搜索我的数字员工' : '搜索市场数字员工，回车确认'"
            @keyup.enter="onHeroSearchEnter"
          />
          <button type="button" tabindex="-1" class="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary transition-colors" @click="onHeroSearchEnter">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
          </button>
        </div>
      </div>
      <!-- ============ 我的专家 ============ -->
      <template v-if="activeTab === 'mine'">
        <!-- Form：三步向导（创建 / 编辑共用） -->
        <div v-if="showForm" class="max-w-xl mb-6 form-card">
          <div class="flex items-center gap-1 mb-5">
            <button
              v-for="s in wizardSteps"
              :key="s.n"
              type="button"
              class="flex items-center gap-1.5 min-w-0"
              :class="s.n < 3 ? 'flex-1' : ''"
              @click="goWizardStep(s.n)"
            >
              <span
                :class="[
                  'w-5 h-5 rounded-full text-[11px] font-medium flex items-center justify-center flex-shrink-0',
                  wizardStep === s.n ? 'bg-primary-600 text-white' : (s.n <= wizardMaxReached ? 'bg-primary-50 text-primary-700' : 'bg-surface-2 text-text-disabled')
                ]"
              >{{ s.n }}</span>
              <span
                :class="['text-xs truncate', wizardStep === s.n ? 'text-text-primary font-medium' : 'text-text-tertiary']"
              >{{ s.label }}</span>
              <span v-if="s.n < 3" class="flex-1 h-px bg-surface-3 mx-1.5" />
            </button>
          </div>

          <!-- 第 1 步：名字 -->
          <div v-show="wizardStep === 1" class="space-y-4">
            <div v-if="editingId && employeeMetrics.total" class="grid grid-cols-4 gap-2 rounded-xl border border-surface-2 bg-surface-1 p-3">
              <div><div class="text-[10px] text-text-tertiary">任务</div><div class="text-sm font-semibold text-text-primary">{{ employeeMetrics.total }}</div></div>
              <div><div class="text-[10px] text-text-tertiary">完成</div><div class="text-sm font-semibold text-emerald-600">{{ employeeMetrics.completed }}</div></div>
              <div><div class="text-[10px] text-text-tertiary">失败/取消</div><div class="text-sm font-semibold text-text-primary">{{ employeeMetrics.failed + employeeMetrics.canceled }}</div></div>
              <div><div class="text-[10px] text-text-tertiary">平均耗时</div><div class="text-sm font-semibold text-text-primary">{{ formatDuration(employeeMetrics.average_duration_ms) }}</div></div>
            </div>
            <div>
              <label class="form-label">名称</label>
              <input v-model="form.name" class="input-field" placeholder="例如：电商视觉设计师" @keyup.enter="nextWizardStep" />
              <p v-if="wizardNameError" class="text-[11px] text-red-500 mt-1">{{ wizardNameError }}</p>
            </div>
            <div>
              <label class="form-label">一句话职责</label>
              <input v-model="form.role_summary" class="input-field" placeholder="例如：负责商品主图、详情页和活动海报" />
            </div>
            <div>
              <label class="form-label">默认工作区（可选）</label>
              <select v-model="form.default_workspace_id" class="select-field">
                <option value="">使用任务发起时的工作区</option>
                <option v-for="ws in workspaceStore.items" :key="ws.id" :value="ws.id">{{ ws.name }}</option>
              </select>
              <p class="text-[11px] text-text-tertiary mt-1">只是新任务的默认环境，不会扩大文件访问权限；每次任务仍可切换。</p>
            </div>
            <div>
              <label class="form-label">补充描述</label>
              <input v-model="form.description" class="input-field" placeholder="可选：适用业务、服务对象等" />
            </div>
            <div>
              <label class="form-label">形象（2:3 竖图，可选）</label>
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl overflow-hidden bg-surface-2 flex items-center justify-center flex-shrink-0">
                  <img v-if="form.avatar" :src="localFileUrl(form.avatar)" class="w-full h-full object-cover" />
                  <span v-else class="text-text-tertiary text-sm font-semibold">{{ (form.name || '?').charAt(0) }}</span>
                </div>
                <div class="flex flex-col gap-2">
                  <div class="flex gap-2">
                    <button type="button" class="btn-secondary" :disabled="avatarUploading" @click="avatarInput?.click()">
                      {{ avatarUploading ? '处理中...' : (form.avatar ? '更换形象' : '上传形象') }}
                    </button>
                    <button type="button" class="btn-secondary" :disabled="avatarUploading" @click="showGalleryPicker = true">从图库选择</button>
                  </div>
                  <button v-if="form.avatar" type="button" class="btn-ghost text-xs self-start" @click="form.avatar = ''">移除</button>
                </div>
                <input ref="avatarInput" type="file" accept="image/png,image/jpeg,image/webp" class="hidden" @change="onPickAvatar" />
              </div>
              <p class="text-[11px] text-text-tertiary mt-1">建议 2:3 比例（如 600x900），发布到市场必须设置形象图。</p>
            </div>
          </div>

          <!-- 第 2 步：人设 -->
          <div v-show="wizardStep === 2" class="space-y-3">
            <div v-if="editingId && employeeCandidates.length" class="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2">
              <div class="text-xs font-medium text-text-primary">待确认的岗位建议</div>
              <div v-for="candidate in employeeCandidates" :key="candidate.id" class="rounded-lg border border-surface-2 bg-surface-0 p-2.5">
                <div class="flex items-start gap-2">
                  <div class="min-w-0 flex-1">
                    <div class="text-xs font-medium text-text-primary truncate">{{ candidate.title }}</div>
                    <div class="mt-0.5 text-[11px] text-text-tertiary">{{ candidateTypeLabel(candidate.candidate_type) }} · {{ candidate.scope === 'workspace' ? '当前工作区' : '数字员工通用' }}</div>
                    <div class="mt-1 text-[11px] text-text-secondary line-clamp-3">{{ candidateBodyText(candidate) }}</div>
                  </div>
                  <div class="flex gap-1 shrink-0">
                    <button type="button" class="btn-secondary !px-2 !py-1 text-[11px]" @click="decideEmployeeCandidate(candidate.id, true)">接受</button>
                    <button type="button" class="btn-ghost !px-2 !py-1 text-[11px]" @click="decideEmployeeCandidate(candidate.id, false)">拒绝</button>
                  </div>
                </div>
              </div>
              <p class="text-[11px] text-text-tertiary">只有接受后才会进入岗位档案、流程、知识或 Skill。</p>
            </div>
            <div v-if="editingId && employeeAssets.length" class="rounded-xl border border-surface-2 bg-surface-1 p-3 space-y-2">
              <div class="text-xs font-medium text-text-primary">岗位流程与验收</div>
              <div v-for="asset in employeeAssets" :key="asset.id" class="flex items-center gap-2 rounded-lg bg-surface-0 border border-surface-2 px-2.5 py-2">
                <div class="min-w-0 flex-1">
                  <div class="text-xs font-medium text-text-primary truncate">{{ asset.title }}</div>
                  <div class="text-[10px] text-text-tertiary">{{ candidateTypeLabel(asset.asset_type) }} · 当前 v{{ asset.current_version?.version || 1 }} · {{ asset.status === 'active' ? '使用中' : '已归档' }}</div>
                </div>
                <button v-if="previousAssetVersion(asset)" type="button" class="btn-ghost !px-2 !py-1 text-[11px]" @click="restoreAsset(asset)">恢复上一版</button>
                <button v-if="asset.status === 'active'" type="button" class="btn-ghost !px-2 !py-1 text-[11px]" @click="archiveAsset(asset.id)">归档</button>
              </div>
              <p class="text-[11px] text-text-tertiary">恢复会创建一个新版本，历史内容不会被覆盖。</p>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="form-label">负责事项</label>
                <textarea v-model="form.responsibilities_text" rows="4" class="textarea-field text-xs" placeholder="每行一项，例如：&#10;制作商品主图&#10;维护品牌视觉一致性" />
              </div>
              <div>
                <label class="form-label">职责边界</label>
                <textarea v-model="form.boundaries_text" rows="4" class="textarea-field text-xs" placeholder="每行一项，例如：&#10;不得覆盖原始素材&#10;发布前必须由用户确认" />
              </div>
              <div>
                <label class="form-label">标准输入</label>
                <textarea v-model="form.standard_inputs_text" rows="3" class="textarea-field text-xs" placeholder="每行一项，例如：产品图、品牌规范、目标平台" />
              </div>
              <div>
                <label class="form-label">标准交付物</label>
                <textarea v-model="form.deliverables_text" rows="3" class="textarea-field text-xs" placeholder="每行一项，例如：可发布图片、源文件、修改说明" />
              </div>
            </div>
            <div class="flex items-center justify-between">
              <label class="form-label mb-0">高级补充指令</label>
              <button type="button" class="text-xs text-primary-600 hover:text-primary-700 font-medium" @click="showPresetModal = true">选择预设</button>
            </div>
            <textarea
              v-model="form.persona_prompt"
              rows="7"
              class="textarea-field text-xs leading-relaxed"
              placeholder="补充表达方式和特殊规则。结构化职责与边界优先于这里的自由文本。"
            />
            <div v-if="personaStore.personas.length">
              <button
                type="button"
                class="text-[11px] text-text-tertiary hover:text-text-primary"
                @click="showPersonaPicker = !showPersonaPicker"
              >{{ showPersonaPicker ? '收起已有人设' : '从已有人设填入' }}</button>
              <div v-if="showPersonaPicker" class="mt-1.5 max-h-32 overflow-y-auto border border-surface-3 rounded-lg">
                <button
                  v-for="p in personaStore.personas"
                  :key="p.id"
                  type="button"
                  class="w-full text-left px-3 py-2 text-xs hover:bg-surface-2 border-b border-surface-2 last:border-0"
                  @click="applyExistingPersona(p)"
                >
                  <div class="font-medium text-text-primary truncate">{{ p.name }}</div>
                  <div class="text-[10px] text-text-tertiary line-clamp-1 mt-0.5">{{ p.system_prompt }}</div>
                </button>
              </div>
            </div>
          </div>

          <!-- 第 3 步：能力 -->
          <div v-show="wizardStep === 3" class="space-y-4">
            <div>
              <label class="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" v-model="form.enable_image_gen" :true-value="1" :false-value="0" class="rounded" />
                <span class="text-xs font-medium text-text-primary">调用生图能力</span>
              </label>
              <p class="text-[11px] text-text-tertiary mt-1 ml-5 leading-snug">开启后，该数字员工的对话中会出现「生图：」模型切换条，AI 可调用生图工具。</p>
              <label class="flex items-center gap-2 cursor-pointer select-none mt-3">
                <input type="checkbox" v-model="form.enable_deck" :true-value="1" :false-value="0" class="rounded" />
                <span class="text-xs font-medium text-text-primary">AI PPT 能力</span>
              </label>
              <p class="text-[11px] text-text-tertiary mt-1 ml-5 leading-snug">开启后，该数字员工可在对话中规划大纲、逐页生成、配图表/图标、设计评审并导出 PPT。</p>
            </div>
            <div class="flex gap-3 flex-wrap">
              <div class="relative">
                <label class="form-label">会用哪些技能</label>
                <button type="button" @click="botDropdown = botDropdown === 'prompt' ? '' : 'prompt'" class="bot-select-btn">
                  {{ form.prompt_skill_dirs.length ? `已选 ${form.prompt_skill_dirs.length} 项` : '选择技能' }}
                  <svg class="w-3.5 h-3.5 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
                </button>
                <div v-if="botDropdown === 'prompt'" class="bot-dropdown">
                  <label v-for="ps in promptSkillStore.skills" :key="ps.dirName" class="bot-dropdown-item">
                    <input type="checkbox" :value="ps.dirName" v-model="form.prompt_skill_dirs" class="rounded w-3.5 h-3.5" />
                    <span class="truncate">{{ ps.name }}</span>
                    <span class="ml-auto text-[10px] text-text-tertiary">{{ ps.origin === 'cloud' || ps.reviewed ? '已审核' : '未审核' }}</span>
                  </label>
                  <div v-if="!promptSkillStore.skills.length" class="text-xs text-text-tertiary px-3 py-2">暂无 Skills</div>
                </div>
              </div>
              <div class="relative">
                <label class="form-label">连接器（MCP）</label>
                <button type="button" @click="botDropdown = botDropdown === 'mcp' ? '' : 'mcp'" class="bot-select-btn">
                  {{ form.mcp_ids.length ? `已选 ${form.mcp_ids.length} 项` : '选择 MCP' }}
                  <svg class="w-3.5 h-3.5 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
                </button>
                <div v-if="botDropdown === 'mcp'" class="bot-dropdown">
                  <label v-for="m in mcpStore.servers" :key="m.id" class="bot-dropdown-item">
                    <input type="checkbox" :value="m.id" v-model="form.mcp_ids" class="rounded w-3.5 h-3.5" />
                    <span class="truncate">{{ m.name }}</span>
                  </label>
                  <div v-if="!mcpStore.servers.length" class="text-xs text-text-tertiary px-3 py-2">暂无服务器</div>
                </div>
              </div>
            </div>
            <div>
              <button
                type="button"
                class="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1"
                @click="showBotAdvanced = !showBotAdvanced"
              >
                <svg class="w-3 h-3 transition-transform" :class="showBotAdvanced ? 'rotate-90' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                高级
              </button>
              <div v-if="showBotAdvanced" class="mt-3 space-y-3 p-3 bg-surface-1 rounded-xl border border-surface-2">
                <div class="relative">
                  <label class="form-label">自定义函数工具（开发者）</label>
                  <p class="text-[11px] text-text-tertiary mb-1.5">自己写的 JavaScript 函数工具。普通对话用不到。</p>
                  <button type="button" @click="botDropdown = botDropdown === 'skill' ? '' : 'skill'" class="bot-select-btn">
                    {{ form.skill_ids.length ? `已选 ${form.skill_ids.length} 项` : '选择工具' }}
                    <svg class="w-3.5 h-3.5 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
                  </button>
                  <div v-if="botDropdown === 'skill'" class="bot-dropdown">
                    <label v-for="s in userSkills" :key="s.id" class="bot-dropdown-item">
                      <input type="checkbox" :value="s.id" v-model="form.skill_ids" class="rounded w-3.5 h-3.5" />
                      <span class="truncate">{{ s.name }}</span>
                    </label>
                    <div v-if="!userSkills.length" class="text-xs text-text-tertiary px-3 py-2">暂无自定义工具</div>
                  </div>
                </div>
                <div>
                  <label class="form-label">工具调用确认</label>
                  <div class="flex gap-2">
                    <label v-for="opt in approvalOptions" :key="opt.value" :class="['flex-1 cursor-pointer rounded-lg border px-3 py-2 text-xs transition-colors', form.tool_approval === opt.value ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-3 hover:bg-surface-2 text-text-secondary']">
                      <input type="radio" :value="opt.value" v-model="form.tool_approval" class="hidden" />
                      <div class="font-medium mb-0.5">{{ opt.label }}</div>
                      <div class="text-[11px] leading-snug opacity-80">{{ opt.desc }}</div>
                    </label>
                  </div>
                </div>
                <div>
                  <label class="form-label">单轮最大工具步数</label>
                  <input type="number" v-model.number="form.max_tool_rounds" min="0" max="200" placeholder="0 = 默认（40）" class="w-full px-3 py-2 text-xs rounded-lg border border-surface-3 bg-surface-0 text-text-primary" />
                  <p class="text-[11px] text-text-tertiary mt-1 leading-snug">单次回复内允许的最大工具调用步数。0 表示默认 40；多页 PPT 等长任务可调高（如 80）。</p>
                </div>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-3 pt-5">
            <button type="button" class="btn-secondary" @click="closeForm">取消</button>
            <button v-if="wizardStep > 1" type="button" class="btn-secondary" @click="prevWizardStep">上一步</button>
            <button
              v-if="wizardStep < 3"
              type="button"
              class="btn-primary ml-auto"
              @click="nextWizardStep"
            >下一步</button>
            <button
              v-else
              type="button"
              class="btn-primary ml-auto"
              @click="saveBot"
            >{{ editingId ? '更新' : '创建' }}</button>
          </div>
        </div>

        <!-- 人设预设弹层 -->
        <div v-if="showPresetModal" class="fixed inset-0 z-[110] flex items-center justify-center bg-black/25" @click.self="showPresetModal = false">
          <div class="bg-surface-0 rounded-2xl shadow-[0_0_30px_rgba(0,0,0,0.12)] w-[560px] max-h-[80vh] flex flex-col">
            <div class="p-5 border-b border-surface-3">
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-semibold text-text-primary">选择预设人设</h3>
                <button type="button" class="text-text-tertiary hover:text-text-primary" @click="showPresetModal = false">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <input v-model="presetSearch" placeholder="搜索预设..." class="w-full px-3 py-2 text-xs border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-2 focus:ring-primary-500" />
              <div class="flex flex-wrap gap-1.5 mt-3">
                <button
                  v-for="cat in presetCategories"
                  :key="cat"
                  type="button"
                  @click="presetCategory = presetCategory === cat ? '' : cat"
                  :class="['px-2.5 py-1 text-xs rounded-md transition-colors', presetCategory === cat ? 'bg-primary-600 text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-3']"
                >{{ cat }}</button>
              </div>
            </div>
            <div class="flex-1 overflow-y-auto p-3 space-y-1">
              <div
                v-for="preset in filteredPresets"
                :key="preset.name + preset.category"
                class="px-4 py-3 rounded-xl cursor-pointer hover:bg-surface-2 transition-colors group"
                @click="applyPersonaPreset(preset)"
              >
                <div class="flex items-center justify-between">
                  <span class="text-sm font-medium text-text-primary group-hover:text-primary-700">{{ preset.name }}</span>
                  <span class="text-xs text-text-tertiary bg-surface-2 px-2 py-0.5 rounded">{{ preset.category }}</span>
                </div>
                <p class="text-xs text-text-tertiary mt-1 line-clamp-2">{{ preset.prompt }}</p>
              </div>
              <div v-if="!filteredPresets.length" class="text-center py-8 text-xs text-text-tertiary">无匹配预设</div>
            </div>
          </div>
        </div>

        <!-- Empty -->
        <div v-if="botStore.bots.length === 0 && !showForm" class="empty-state">
          <div class="w-16 h-16 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
            <svg class="w-8 h-8 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" /></svg>
          </div>
          <p class="text-sm font-medium text-text-secondary mb-1">暂无数字员工</p>
          <p class="text-xs">创建你的第一个数字员工，或前往「数字员工市场」保存</p>
        </div>

        <!-- 搜索无结果 -->
        <div v-else-if="!filteredBots.length && !showForm" class="empty-state">
          <p class="text-sm font-medium text-text-secondary mb-1">没有匹配「{{ mineSearch.trim() }}」的数字员工</p>
          <p class="text-xs">换个关键词试试</p>
        </div>

        <!-- Cards -->
        <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <div
            v-for="bot in filteredBots"
            :key="bot.id"
            class="card group p-5 flex flex-col min-h-[188px] hover:bg-surface-1"
          >
            <div class="flex items-start gap-3">
              <div class="w-11 h-11 rounded-full overflow-hidden bg-surface-2 flex-shrink-0 flex items-center justify-center">
                <img v-if="bot.avatar" :src="localFileUrl(bot.avatar)" class="w-full h-full object-cover" />
                <span v-else class="text-sm font-semibold text-text-secondary">{{ bot.name.charAt(0) }}</span>
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-start gap-2">
                  <div class="min-w-0 flex-1">
                    <h3 class="text-[15px] font-semibold text-text-primary leading-snug truncate">{{ bot.name }}</h3>
                    <p class="text-xs text-text-tertiary mt-0.5 truncate">{{ botSubtitle(bot) }}</p>
                  </div>
                  <button
                    type="button"
                    class="shrink-0 h-7 px-3 text-xs font-medium rounded-full bg-text-primary text-surface-0 hover:opacity-90 transition-opacity"
                    @click="$router.push({ path: '/chat', query: { botId: bot.id } })"
                  >召唤</button>
                </div>
              </div>
            </div>
            <p class="text-[13px] text-text-secondary mt-3 line-clamp-3 leading-relaxed min-h-[3.9em]">{{ bot.description || '暂无简介' }}</p>
            <p v-if="bot.submission_status === 'rejected' && bot.submission_reject_reason" class="text-[11px] text-red-500 mt-1 line-clamp-1">驳回原因：{{ bot.submission_reject_reason }}</p>
            <div class="mt-auto pt-3 flex flex-wrap gap-1.5">
              <span
                v-for="t in botTags(bot)"
                :key="t"
                class="px-2 py-0.5 rounded-full bg-surface-2 text-[11px] text-text-secondary"
              >{{ t }}</span>
            </div>
            <div class="flex items-center gap-2.5 mt-3 text-[11px] text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity">
              <button type="button" class="hover:text-text-primary" @click="editBot(bot)">编辑</button>
              <span class="text-surface-3">·</span>
              <button type="button" class="hover:text-red-500" @click="deleteTarget = bot">删除</button>
              <template v-if="canPublish(bot)">
                <span class="text-surface-3">·</span>
                <button type="button" class="hover:text-primary-700 disabled:opacity-50" :disabled="publishingId === bot.id" @click="publish(bot)">{{ publishingId === bot.id ? '发布中...' : '发布' }}</button>
              </template>
              <template v-else-if="bot.submission_status === 'pending' || bot.submission_status === 'approved'">
                <span class="text-surface-3">·</span>
                <button type="button" class="hover:text-text-primary" @click="withdraw(bot)">撤回发布</button>
              </template>
            </div>
          </div>
        </div>
      </template>

      <!-- ============ 专家市场 ============ -->
      <template v-else>
        <!-- 分类筛选（云控端可见分类；无分类时不显示本行）。搜索框已并入页首工具行 -->
        <div v-if="botStore.marketCategories.length" class="flex items-center gap-1.5 mb-4 overflow-x-auto pb-0.5">
          <button
            v-for="cat in [{ id: null, name: '全部' }, ...botStore.marketCategories]"
            :key="cat.id === null ? '__all__' : cat.id"
            @click="selectCategory(cat.id)"
            :class="[
              'px-3 py-1 text-[11px] rounded-full border whitespace-nowrap transition-colors',
              activeCategory === cat.id
                ? 'border-primary-400 text-primary-600 bg-primary-50 dark:bg-primary-900/20'
                : 'border-surface-3 text-text-tertiary hover:bg-surface-2 hover:text-text-secondary'
            ]"
          >{{ cat.name }}</button>
        </div>

        <div v-if="botStore.marketLoading" class="text-center text-sm text-text-tertiary py-12">加载中...</div>
        <div v-else-if="!botStore.marketAgents.length" class="empty-state">
          <p class="text-sm font-medium text-text-secondary mb-1">{{ activeCategory || marketSearch ? '该筛选条件下暂无数字员工' : '市场暂无数字员工' }}</p>
          <p class="text-xs">{{ activeCategory || marketSearch ? '换个分类或关键词试试' : '云控端发布并上架后，这里会显示可添加的数字员工' }}</p>
        </div>
        <template v-else>
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <div
              v-for="a in botStore.marketAgents"
              :key="a.id"
              class="card group p-5 flex flex-col min-h-[188px] hover:bg-surface-1"
            >
              <div class="flex items-start gap-3">
                <div class="w-11 h-11 rounded-full overflow-hidden bg-surface-2 flex-shrink-0 flex items-center justify-center">
                  <img v-if="a.avatar" :src="a.avatar_thumb || a.avatar" loading="lazy" class="w-full h-full object-cover" />
                  <span v-else class="text-sm font-semibold text-text-secondary">{{ a.name.charAt(0) }}</span>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-start gap-2">
                    <div class="min-w-0 flex-1">
                      <h3 class="text-[15px] font-semibold text-text-primary leading-snug truncate">{{ a.name }}</h3>
                      <p class="text-xs text-text-tertiary mt-0.5 truncate">{{ marketSubtitle(a) }}</p>
                    </div>
                    <button
                      type="button"
                      class="shrink-0 h-7 px-3 text-xs font-medium rounded-full bg-text-primary text-surface-0 hover:opacity-90 transition-opacity disabled:opacity-50"
                      :disabled="savingId === a.id"
                      @click="summonMarket(a)"
                    >{{ savingId === a.id ? '添加中...' : '召唤' }}</button>
                  </div>
                </div>
              </div>
              <p class="text-[13px] text-text-secondary mt-3 line-clamp-3 leading-relaxed min-h-[3.9em]">{{ a.description || '暂无简介' }}</p>
              <div class="mt-auto pt-3 flex flex-wrap gap-1.5">
                <span
                  v-for="t in marketTags(a)"
                  :key="t"
                  class="px-2 py-0.5 rounded-full bg-surface-2 text-[11px] text-text-secondary"
                >{{ t }}</span>
              </div>
              <div class="flex items-center gap-2.5 mt-3 text-[11px] text-text-tertiary">
                <span v-if="a.price > 0 && !a.is_owned">{{ a.price }} {{ labelOf(a.price_balance_type) }}</span>
                <span v-else-if="a.price > 0 && a.is_owned">已拥有</span>
                <span v-else>免费</span>
                <span class="text-surface-3">·</span>
                <span>{{ a.rating_count ? a.rating_avg.toFixed(1) + ' 分' : '暂无评分' }}</span>
                <span class="text-surface-3">·</span>
                <span>下载 {{ formatCount(a.download_count) }}</span>
                <span class="flex-1" />
                <button type="button" class="hover:text-text-primary" @click="openRate(a)">评分</button>
              </div>
            </div>
          </div>
          <!-- 无限滚动：到底自动加载下一页（与灵感广场/云端模板一致） -->
          <div v-if="marketLoadingMore" class="text-center text-xs text-text-tertiary py-4">加载中…</div>
          <div v-else-if="!marketHasMore" class="text-center text-[11px] text-text-disabled py-4">已加载全部 {{ botStore.marketTotal }} 个数字员工</div>
        </template>
      </template>
      </div>
    </div>

    <!-- 评分弹窗（仅阴影，无遮罩） -->
    <div v-if="rateTarget" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="rateTarget = null">
      <div class="w-80 bg-surface-0 rounded-xl shadow-2xl border border-surface-3 p-5">
        <div class="font-semibold text-sm text-text-primary mb-1">给「{{ rateTarget.name }}」评分</div>
        <p class="text-[11px] text-text-tertiary mb-3">需登录云账号，每人一评（可改分）</p>
        <div class="flex gap-1 mb-3">
          <button v-for="i in 5" :key="i" type="button" @click="rateScore = i" class="p-0.5">
            <svg class="w-7 h-7" :class="i <= rateScore ? 'text-amber-400' : 'text-surface-3'" viewBox="0 0 24 24" fill="currentColor"><path d="M11.48 3.5a.56.56 0 0 1 1.04 0l2.12 5.11a.56.56 0 0 0 .48.35l5.52.44c.5.04.7.66.32.99l-4.2 3.6a.56.56 0 0 0-.18.56l1.28 5.39a.56.56 0 0 1-.84.6l-4.72-2.88a.56.56 0 0 0-.59 0l-4.72 2.88a.56.56 0 0 1-.84-.6l1.28-5.39a.56.56 0 0 0-.18-.56l-4.2-3.6a.56.56 0 0 1 .32-.99l5.52-.44a.56.56 0 0 0 .48-.35L11.48 3.5Z" /></svg>
          </button>
        </div>
        <textarea v-model="rateComment" rows="2" maxlength="500" class="input-field w-full mb-3" placeholder="说点什么（可选）"></textarea>
        <div class="flex gap-2">
          <button @click="submitRate" :disabled="!rateScore || rating" class="btn-primary flex-1 disabled:opacity-50">{{ rating ? '提交中...' : '提交评分' }}</button>
          <button @click="rateTarget = null" class="btn-secondary">取消</button>
        </div>
      </div>
    </div>

    <GalleryPicker v-model:visible="showGalleryPicker" :multiple="false" @select="onGallerySelect" />

    <LowBalanceModal
      v-model:visible="lowBalance.visible"
      :balance-type="lowBalance.balanceType"
      :required="lowBalance.required"
      :available="lowBalance.available"
    />

    <ConfirmDialog
      :visible="!!deleteTarget"
      title="删除数字员工"
      :message="deleteTarget ? `确定删除数字员工「${deleteTarget.name}」吗？删除后不可恢复。` : ''"
      confirm-text="删除"
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useBotStore, type Bot, type MarketAgent } from '@/stores/bots'
import { usePersonaStore } from '@/stores/personas'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useSkillStore } from '@/stores/skills'
import { useMcpStore } from '@/stores/mcps'
import { usePromptSkillStore } from '@/stores/prompt-skills'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useSiteConfigStore } from '@/stores/site-config'
import { usePromptPresetStore } from '@/stores/prompt-presets'
import { useAgentWorkspaceStore } from '@/stores/agent-workspaces'
import builtinPresets from '@/data/persona-presets.json'
import GalleryPicker from '@/components/GalleryPicker.vue'
import LowBalanceModal from '@/components/LowBalanceModal.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { loadAsDataUri } from '@/utils/image-source'

const botStore = useBotStore()
const personaStore = usePersonaStore()
const kbStore = useKnowledgeStore()
const skillStore = useSkillStore()
const CORE_TOOL_NAMES = ['file_ops', 'run_command', 'image_gen', 'browser']
const userSkills = computed(() =>
  skillStore.skills.filter((s) => !CORE_TOOL_NAMES.includes(s.function_def?.name))
)
const mcpStore = useMcpStore()
const promptSkillStore = usePromptSkillStore()
const presetStore = usePromptPresetStore()
const router = useRouter()
const cloudAuth = useCloudAuthStore()
const siteConfig = useSiteConfigStore()
const workspaceStore = useAgentWorkspaceStore()

const activeTab = ref<'mine' | 'market'>('mine')
// 页首统一搜索框：我的=本地即时过滤（名称/描述）；市场=回车或点图标走云端检索
const mineSearch = ref('')
const filteredBots = computed(() => {
  const kw = mineSearch.value.trim().toLowerCase()
  if (!kw) return botStore.bots
  return botStore.bots.filter((b) =>
    b.name.toLowerCase().includes(kw) || (b.description || '').toLowerCase().includes(kw)
  )
})

function botSubtitle(bot: Bot): string {
  const persona = bot.persona_id
    ? personaStore.personas.find((p) => p.id === bot.persona_id)?.name
    : ''
  if (persona) return persona
  return bot.source === 'market' ? '来自市场' : '本地创建'
}

function botTags(bot: Bot): string[] {
  const tags: string[] = []
  for (const dir of bot.prompt_skill_dirs || []) {
    const s = promptSkillStore.skills.find((x) => x.dirName === dir)
    tags.push(s?.name || dir)
  }
  for (const id of bot.skill_ids) {
    const s = userSkills.value.find((x) => x.id === id)
    if (s?.name) tags.push(s.name)
  }
  for (const id of bot.mcp_ids) {
    const m = mcpStore.servers.find((x) => x.id === id)
    if (m?.name) tags.push(m.name)
  }
  if (bot.enable_image_gen) tags.push('AI 生图')
  if (bot.enable_deck) tags.push('AI PPT')
  if (bot.submission_status === 'pending') tags.push('审核中')
  if (bot.submission_status === 'rejected') tags.push('已驳回')
  return tags.slice(0, 4)
}

function marketSubtitle(a: MarketAgent): string {
  return a.author_nickname || '数字员工市场'
}

function marketTags(a: MarketAgent): string[] {
  const tags: string[] = []
  if (a.category_name) tags.push(a.category_name)
  for (const t of a.tags || []) {
    if (t && t !== a.category_name) tags.push(t)
  }
  return tags.slice(0, 4)
}
// 双 tab 共用一个输入框：按当前 tab 代理到对应的搜索状态
const heroSearch = computed({
  get: () => (activeTab.value === 'mine' ? mineSearch.value : marketSearch.value),
  set: (v: string) => {
    if (activeTab.value === 'mine') mineSearch.value = v
    else marketSearch.value = v
  }
})
function onHeroSearchEnter(): void {
  if (activeTab.value === 'market') void loadMarket()
}

// 整页背景图（云控端「桌面端外观」下发；空=默认纯色。走 localStorage 缓存，首屏不闪）
const pageBgStyle = computed(() => {
  const url = siteConfig.botListBackground?.url || ''
  if (!url) return {}
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  }
})
const showForm = ref(false)
const showPersonaPicker = ref(false)
const showBotAdvanced = ref(false)
const editingId = ref<string | null>(null)
const botDropdown = ref('')
const wizardStep = ref(1)
const wizardMaxReached = ref(1)
const wizardNameError = ref('')
const wizardSteps = [
  { n: 1, label: '名字' },
  { n: 2, label: '人设' },
  { n: 3, label: '能力' }
]
const showPresetModal = ref(false)
const presetSearch = ref('')
const presetCategory = ref('')
const allPresets = computed(() => {
  const systemList = (builtinPresets as { name: string; prompt: string; category: string }[]).map((p) => ({
    name: p.name,
    prompt: p.prompt,
    category: p.category
  }))
  const userList = presetStore.visibleGrouped('persona').flatMap((g) =>
    g.items.map((item) => ({
      name: item.label,
      prompt: item.content,
      category: g.name
    }))
  )
  return [...userList, ...systemList]
})
const presetCategories = computed(() => Array.from(new Set(allPresets.value.map((p) => p.category))))
const filteredPresets = computed(() => {
  let list = allPresets.value
  if (presetCategory.value) list = list.filter((p) => p.category === presetCategory.value)
  if (presetSearch.value) {
    const q = presetSearch.value.toLowerCase()
    list = list.filter((p) => p.name.toLowerCase().includes(q) || p.prompt.toLowerCase().includes(q))
  }
  return list
})

function applyPersonaPreset(preset: { name: string; prompt: string }) {
  form.value.persona_prompt = preset.prompt
  form.value.persona_id = ''
  showPresetModal.value = false
}

function canEnterWizardStep(n: number) {
  if (n < 1 || n > 3) return false
  if (n === 1) return true
  if (!form.value.name.trim()) return false
  return n <= wizardMaxReached.value
}

function goWizardStep(n: number) {
  if (!canEnterWizardStep(n)) {
    if (n > 1 && !form.value.name.trim()) wizardNameError.value = '请先填写名称'
    return
  }
  wizardNameError.value = ''
  wizardStep.value = n
  botDropdown.value = ''
}

function nextWizardStep() {
  if (wizardStep.value === 1 && !form.value.name.trim()) {
    wizardNameError.value = '请先填写名称'
    return
  }
  wizardNameError.value = ''
  if (wizardStep.value >= 3) return
  const next = wizardStep.value + 1
  if (next > wizardMaxReached.value) wizardMaxReached.value = next
  wizardStep.value = next
  botDropdown.value = ''
}

function prevWizardStep() {
  if (wizardStep.value <= 1) return
  wizardNameError.value = ''
  wizardStep.value -= 1
  botDropdown.value = ''
}

function closeForm() {
  showForm.value = false
  showPresetModal.value = false
  resetForm()
}

type ToolApproval = 'off' | 'destructive' | 'all'
const approvalOptions: { value: ToolApproval; label: string; desc: string }[] = [
  { value: 'off', label: '关闭', desc: '所有工具自动执行' },
  { value: 'destructive', label: '仅破坏性', desc: '写文件 / 命令前确认' },
  { value: 'all', label: '全部', desc: '每个工具调用都确认' }
]

const form = ref({
  name: '',
  description: '',
  role_summary: '',
  responsibilities_text: '',
  boundaries_text: '',
  standard_inputs_text: '',
  deliverables_text: '',
  default_workspace_id: '',
  persona_id: '',
  persona_prompt: '',
  kb_only: 0 as number,
  kb_category_ids: [] as string[],
  skill_ids: [] as string[],
  mcp_ids: [] as string[],
  prompt_skill_dirs: [] as string[],
  tool_approval: 'destructive' as ToolApproval,
  enable_image_gen: 0 as number,
  enable_deck: 0 as number,
  max_tool_rounds: 0 as number,
  avatar: ''
})
const employeeCandidates = ref<any[]>([])
const employeeAssets = ref<any[]>([])
const employeeAssetVersions = ref<Record<string, any[]>>({})
const employeeMetrics = ref({ total: 0, completed: 0, failed: 0, canceled: 0, average_duration_ms: 0 })

function resetForm() {
  form.value = { name: '', description: '', role_summary: '', responsibilities_text: '', boundaries_text: '', standard_inputs_text: '', deliverables_text: '', default_workspace_id: '', persona_id: '', persona_prompt: '', kb_only: 0, kb_category_ids: [], skill_ids: [], mcp_ids: [], prompt_skill_dirs: [], tool_approval: 'destructive', enable_image_gen: 0, enable_deck: 0, max_tool_rounds: 0, avatar: '' }
  showPersonaPicker.value = false
  showBotAdvanced.value = false
  showPresetModal.value = false
  presetSearch.value = ''
  presetCategory.value = ''
  wizardStep.value = 1
  wizardMaxReached.value = 1
  wizardNameError.value = ''
  botDropdown.value = ''
  employeeCandidates.value = []
  employeeAssets.value = []
  employeeAssetVersions.value = {}
  employeeMetrics.value = { total: 0, completed: 0, failed: 0, canceled: 0, average_duration_ms: 0 }
}

function applyExistingPersona(p: { id: string; system_prompt: string }) {
  form.value.persona_id = p.id
  form.value.persona_prompt = p.system_prompt
  showPersonaPicker.value = false
}

function openCreate() {
  resetForm()
  editingId.value = null
  wizardStep.value = 1
  wizardMaxReached.value = 1
  showForm.value = true
}

async function editBot(bot: Bot) {
  let roleSummary = ''
  let employeeProfile: any = null
  employeeCandidates.value = []
  try {
    const overview = await window.api.bot.invoke('getEmployeeOverview', bot.id, bot.default_workspace_id || '') as any
    employeeProfile = overview?.profile || null
    employeeCandidates.value = Array.isArray(overview?.candidates) ? overview.candidates : []
    employeeAssets.value = Array.isArray(overview?.assets) ? overview.assets : []
    employeeAssetVersions.value = overview?.asset_versions || {}
    employeeMetrics.value = { ...employeeMetrics.value, ...(overview?.metrics || {}) }
    roleSummary = String(employeeProfile?.role_summary || '')
  } catch { /* 旧库兼容：岗位档案为空 */ }
  editingId.value = bot.id
  form.value = {
    name: bot.name,
    description: bot.description,
    role_summary: roleSummary,
    responsibilities_text: (employeeProfile?.responsibilities || []).join('\n'),
    boundaries_text: (employeeProfile?.boundaries || []).join('\n'),
    standard_inputs_text: (employeeProfile?.standard_inputs || []).join('\n'),
    deliverables_text: (employeeProfile?.deliverables || []).join('\n'),
    default_workspace_id: bot.default_workspace_id || '',
    persona_id: bot.persona_id || '',
    kb_only: bot.kb_only || 0,
    kb_category_ids: [...bot.kb_category_ids],
    skill_ids: bot.skill_ids.filter(id => userSkills.value.some(s => s.id === id)),
    mcp_ids: [...bot.mcp_ids],
    prompt_skill_dirs: [...(bot.prompt_skill_dirs || [])],
    tool_approval: bot.tool_approval || 'destructive',
    enable_image_gen: bot.enable_image_gen || 0,
    enable_deck: bot.enable_deck || 0,
    max_tool_rounds: bot.max_tool_rounds || 0,
    avatar: bot.avatar || '',
    persona_prompt: personaStore.personas.find((p) => p.id === bot.persona_id)?.system_prompt || ''
  }
  showPersonaPicker.value = false
  showBotAdvanced.value = form.value.skill_ids.length > 0
    || form.value.tool_approval !== 'destructive'
    || form.value.max_tool_rounds > 0
  wizardStep.value = 1
  wizardMaxReached.value = 3
  wizardNameError.value = ''
  showForm.value = true
}

function splitProfileLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function candidateTypeLabel(type: string): string {
  return ({ knowledge: '知识', skill: 'Skill', workflow: '工作流程', responsibility: '负责事项', boundary: '职责边界', acceptance: '验收标准' } as Record<string, string>)[type] || type
}

function formatDuration(milliseconds: number): string {
  if (!milliseconds) return '—'
  if (milliseconds < 60000) return `${Math.max(1, Math.round(milliseconds / 1000))}秒`
  return `${Math.round(milliseconds / 60000)}分`
}

function candidateBodyText(candidate: any): string {
  return String(candidate?.body?.content || candidate?.body?.text || candidate?.body?.description || '')
}

async function decideEmployeeCandidate(id: string, accept: boolean) {
  try {
    await window.api.bot.invoke(accept ? 'acceptEmployeeCandidate' : 'rejectEmployeeCandidate', id)
    employeeCandidates.value = employeeCandidates.value.filter((candidate) => candidate.id !== id)
    if (accept && editingId.value) {
      const overview = await window.api.bot.invoke('getEmployeeOverview', editingId.value, form.value.default_workspace_id || '') as any
      employeeAssets.value = Array.isArray(overview?.assets) ? overview.assets : []
      employeeAssetVersions.value = overview?.asset_versions || {}
    }
  } catch (error: any) {
    alert((accept ? '接受' : '拒绝') + '失败: ' + (error?.message || error))
  }
}

function previousAssetVersion(asset: any): any | null {
  const versions = employeeAssetVersions.value[asset.id] || []
  return versions.find((version: any) => version.id !== asset.current_version_id) || null
}

async function restoreAsset(asset: any) {
  const version = previousAssetVersion(asset)
  if (!version || !confirm(`恢复「${asset.title}」到 v${version.version}？系统会创建一个新版本。`)) return
  try {
    const updated = await window.api.bot.invoke('restoreEmployeeAssetVersion', asset.id, version.id) as any
    const index = employeeAssets.value.findIndex((item) => item.id === asset.id)
    if (index >= 0) employeeAssets.value[index] = updated
    employeeAssetVersions.value[asset.id] = await window.api.bot.invoke('listEmployeeAssetVersions', asset.id) as any[]
  } catch (error: any) { alert('恢复失败: ' + (error?.message || error)) }
}

async function archiveAsset(id: string) {
  if (!confirm('归档后该岗位资产将不再参与后续任务，是否继续？')) return
  try {
    await window.api.bot.invoke('archiveEmployeeAsset', id)
    const asset = employeeAssets.value.find((item) => item.id === id)
    if (asset) asset.status = 'archived'
  } catch (error: any) { alert('归档失败: ' + (error?.message || error)) }
}

async function saveBot() {
  if (!form.value.name.trim()) {
    wizardStep.value = 1
    wizardNameError.value = '请先填写名称'
    return
  }
  try {
    const prompt = form.value.persona_prompt.trim()
    let personaId: string | null = form.value.persona_id || null
    if (prompt) {
      if (personaId) {
        await personaStore.updatePersona(personaId, { system_prompt: prompt })
      } else {
        const created = await personaStore.createPersona({
          name: form.value.name.trim() || '未命名人设',
          system_prompt: prompt
        })
        personaId = created.id
      }
    } else {
      personaId = null
    }
    const data: any = {
      name: form.value.name,
      description: form.value.description,
      persona_id: personaId,
      kb_only: form.value.kb_only,
      kb_category_ids: form.value.kb_category_ids,
      skill_ids: form.value.skill_ids,
      mcp_ids: form.value.mcp_ids,
      prompt_skill_dirs: form.value.prompt_skill_dirs,
      skill_bindings: form.value.prompt_skill_dirs.map((dir) => {
        const skill = promptSkillStore.skills.find((s) => s.dirName === dir)
        return skill?.origin === 'cloud'
          ? { source: 'cloud', skill_id: skill.skillId, version_id: skill.versionId, dir_name: dir }
          : { source: 'local', dir_name: dir }
      }),
      skill_selection_mode: 'selected',
      default_workspace_id: form.value.default_workspace_id,
      tool_approval: form.value.tool_approval,
      enable_image_gen: form.value.enable_image_gen,
      enable_deck: form.value.enable_deck,
      max_tool_rounds: form.value.max_tool_rounds,
      avatar: form.value.avatar
    }
    let savedBot: Bot
    if (editingId.value) {
      savedBot = await botStore.updateBot(editingId.value, data)
    } else {
      savedBot = await botStore.createBot(data)
    }
    await window.api.bot.invoke('saveEmployeeProfile', savedBot.id, {
      role_summary: form.value.role_summary,
      responsibilities: splitProfileLines(form.value.responsibilities_text),
      boundaries: splitProfileLines(form.value.boundaries_text),
      standard_inputs: splitProfileLines(form.value.standard_inputs_text),
      deliverables: splitProfileLines(form.value.deliverables_text)
    })
    showForm.value = false
    resetForm()
  } catch (e: any) {
    console.error('saveBot error:', e)
    alert('保存失败: ' + (e?.message || e))
  }
}

// ===== 删除（带确认弹窗）=====
const deleteTarget = ref<Bot | null>(null)
async function confirmDelete() {
  const bot = deleteTarget.value
  if (!bot) return
  deleteTarget.value = null
  try {
    await botStore.deleteBot(bot.id)
  } catch (e: any) {
    alert('删除失败：' + (e?.message || e))
  }
}

// ===== 形象图 =====
const avatarInput = ref<HTMLInputElement | null>(null)
const avatarUploading = ref(false)
const showGalleryPicker = ref(false)

function localFileUrl(p: string): string {
  if (!p) return ''
  if (/^(https?:|data:|file:|local-file:)/i.test(p)) return p
  return 'local-file://img?p=' + encodeURIComponent(p.replace(/\\/g, '/'))
}

function checkAspect(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(Math.abs(img.height / img.width - 1.5) <= 0.1) }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(false) }
    img.src = url
  })
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = reject
    fr.readAsDataURL(file)
  })
}

async function onPickAvatar(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  avatarUploading.value = true
  try {
    if (!(await checkAspect(file))) {
      alert('形象图需为 2:3 竖图（如 600x900），请重新选择')
      return
    }
    const dataUrl = await fileToDataUrl(file)
    form.value.avatar = await botStore.saveAvatar(dataUrl)
  } catch (err: any) {
    alert('形象图处理失败：' + (err?.message || err))
  } finally {
    avatarUploading.value = false
    input.value = ''
  }
}

// 从图库选择形象图：取所选图片 → 读为 dataUri（带宽高）→ 2:3 校验 → 落盘
async function onGallerySelect(paths: string[]) {
  if (!paths.length) return
  avatarUploading.value = true
  try {
    const [img] = await loadAsDataUri(paths.slice(0, 1), { maxSize: 1024, quality: 0.85 })
    if (!img) { alert('读取图库图片失败'); return }
    if (Math.abs(img.height / img.width - 1.5) > 0.1) {
      alert(`形象图需为 2:3 竖图（当前 ${img.width}x${img.height}），请选择 2:3 比例的图片`)
      return
    }
    form.value.avatar = await botStore.saveAvatar(img.dataUri)
  } catch (err: any) {
    alert('形象图处理失败：' + (err?.message || err))
  } finally {
    avatarUploading.value = false
  }
}

// ===== 投稿 / 发布 =====
const publishingId = ref<string | null>(null)
function submissionLabel(s: string): string {
  return ({ pending: '审核中', approved: '已上架市场', rejected: '已驳回', withdrawn: '已撤回' } as Record<string, string>)[s] || s
}
function submissionBadgeClass(s: string): string {
  return ({
    pending: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    approved: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    rejected: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    withdrawn: 'bg-surface-2 text-text-tertiary'
  } as Record<string, string>)[s] || 'bg-surface-2 text-text-tertiary'
}
function canPublish(bot: Bot): boolean {
  return !bot.submission_status || bot.submission_status === 'rejected' || bot.submission_status === 'withdrawn'
}
async function publish(bot: Bot) {
  if (!bot.avatar) { alert('请先在「编辑」里为该数字员工设置 2:3 形象图，再发布到市场'); return }
  publishingId.value = bot.id
  try {
    const res = await botStore.submitToMarket(bot.id)
    await botStore.fetchBots()
    alert(res.ok ? '已提交，等待管理员审核' : ('发布失败：' + (res.error || '')))
  } finally {
    publishingId.value = null
  }
}
async function withdraw(bot: Bot) {
  const res = await botStore.withdrawSubmission(bot.id)
  await botStore.fetchBots()
  if (!res.ok) alert('撤回失败：' + (res.error || ''))
}

// ===== 市场 =====
const marketSearch = ref('')
const marketLoaded = ref(false)
const savingId = ref<number | null>(null)
const lowBalance = reactive({ visible: false, balanceType: 'credit' as 'token' | 'credit', required: 0, available: 0 })

// 分类筛选 + 真分页无限滚动（与灵感广场/云端模板同一交互语言）
const activeCategory = ref<number | null>(null)
const marketPage = ref(1)
const MARKET_PAGE_SIZE = 24
const marketLoadingMore = ref(false)
const pageBodyRef = ref<HTMLElement | null>(null)
const marketHasMore = computed(() => botStore.marketAgents.length < botStore.marketTotal)

function labelOf(type: 'token' | 'credit'): string {
  return siteConfig.labelOf(type)
}

async function switchToMarket() {
  activeTab.value = 'market'
  if (!marketLoaded.value) {
    await Promise.all([
      loadMarket(),
      botStore.marketCategories.length ? Promise.resolve() : botStore.fetchMarketCategories(),
    ])
  }
}
// 搜索 / 切分类 / 首次进入：重置到第 1 页并整体替换列表
async function loadMarket() {
  marketLoaded.value = true
  marketPage.value = 1
  await botStore.fetchMarket({
    search: marketSearch.value,
    categoryId: activeCategory.value ?? undefined,
    page: 1,
    pageSize: MARKET_PAGE_SIZE,
  })
  pageBodyRef.value?.scrollTo({ top: 0 })
}
// 下拉到底：追加下一页
async function loadMoreMarket() {
  if (marketLoadingMore.value || botStore.marketLoading || !marketHasMore.value || activeTab.value !== 'market') return
  marketLoadingMore.value = true
  const next = marketPage.value + 1
  try {
    await botStore.fetchMarket({
      search: marketSearch.value,
      categoryId: activeCategory.value ?? undefined,
      page: next,
      pageSize: MARKET_PAGE_SIZE,
      append: true,
    })
    marketPage.value = next
  } catch { /* 加载更多失败保持当前页码，下次滚动可重试 */ }
  marketLoadingMore.value = false
}
function selectCategory(id: number | null): void {
  if (activeCategory.value === id) return
  activeCategory.value = id
  void loadMarket()
}
function onPageScroll(): void {
  if (activeTab.value !== 'market') return
  const el = pageBodyRef.value
  if (!el) return
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) void loadMoreMarket()
}
async function summonMarket(a: MarketAgent): Promise<void> {
  const existing = botStore.bots.find((b) => b.cloud_agent_id === a.id)
  if (existing) {
    router.push({ path: '/chat', query: { botId: existing.id } })
    return
  }
  await saveToLocal(a)
  const added = botStore.bots.find((b) => b.cloud_agent_id === a.id)
  if (added) router.push({ path: '/chat', query: { botId: added.id } })
}
function formatCount(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}
async function saveToLocal(a: MarketAgent) {
  // 未登录：收费 / 受限专家需登录才能获取，直接引导登录
  if (!cloudAuth.isLoggedIn) {
    if (confirm('保存数字员工需要先登录云账号，是否前往登录？')) router.push('/login')
    return
  }
  savingId.value = a.id
  try {
    const res = await botStore.importFromMarket(a)
    if (res.ok) {
      if (res.alreadyExists) {
        if (res.updateAvailable && confirm('该数字员工有新版岗位模板。是否生成更新建议？本地岗位资产不会被直接覆盖。')) {
          const upgraded = await botStore.importFromMarket(a, true)
          alert(upgraded.upgraded ? '已生成模板更新建议，请在数字员工编辑页逐项确认' : '模板更新失败，请稍后重试')
        } else if (!res.updateAvailable) {
          alert('该数字员工已添加过，当前模板已是最新')
        }
      } else {
        // 收费专家此时已扣费，刷新余额并标记已拥有
        cloudAuth.refreshBalancesThrottled(true).catch(() => {})
        a.is_owned = true
      }
    } else if (res.needLogin) {
      if (confirm('登录态已失效，请重新登录后再保存，是否前往登录？')) router.push('/login')
    } else if (res.forbidden) {
      alert(res.error || '你没有权限获取该数字员工')
    } else if (res.needRecharge) {
      lowBalance.balanceType = res.balanceType || a.price_balance_type
      lowBalance.required = res.needed || a.price
      lowBalance.available = res.current || 0
      lowBalance.visible = true
    } else {
      alert('添加失败：' + (res.error || ''))
    }
  } finally {
    savingId.value = null
  }
}

// ===== 评分 =====
const rateTarget = ref<MarketAgent | null>(null)
const rateScore = ref(0)
const rateComment = ref('')
const rating = ref(false)
function openRate(a: MarketAgent) {
  rateTarget.value = a
  rateScore.value = 0
  rateComment.value = ''
}
async function submitRate() {
  const target = rateTarget.value
  if (!target || !rateScore.value) return
  rating.value = true
  try {
    const res = await botStore.rateAgent(target.id, rateScore.value, rateComment.value)
    if (res.ok) {
      if (res.data) {
        target.rating_avg = Number(res.data.rating_avg ?? target.rating_avg)
        target.rating_count = Number(res.data.rating_count ?? target.rating_count)
      }
      rateTarget.value = null
    } else {
      alert('评分失败：' + (res.error || ''))
    }
  } finally {
    rating.value = false
  }
}

onMounted(async () => {
  await Promise.all([
    botStore.fetchBots(),
    personaStore.fetchPersonas(),
    presetStore.fetchAll('persona'),
    kbStore.fetchCategories(),
    skillStore.fetchSkills(),
    mcpStore.fetchServers(),
    promptSkillStore.fetchSkills(),
    workspaceStore.refresh(),
  ])
  // 静默刷新投稿过的 bot 的审核态
  const submittedIds = botStore.bots.filter((b) => b.submission_status && b.submission_status !== 'withdrawn').map((b) => b.id)
  if (submittedIds.length) {
    try {
      const res = await botStore.syncSubmissionStatus(submittedIds)
      if (res.ok) await botStore.fetchBots()
    } catch { /* ignore */ }
  }
})
</script>

<style scoped>
.bot-select-btn {
  @apply flex items-center gap-2 w-48 px-3 py-2 text-xs text-text-secondary bg-surface-0 border border-surface-3 rounded-lg hover:border-primary-400 transition-colors cursor-pointer;
}
.bot-dropdown {
  @apply absolute top-full left-0 mt-1 w-48 max-h-48 overflow-y-auto bg-surface-0 border border-surface-3 rounded-lg shadow-lg z-50 py-1;
}
.bot-dropdown-item {
  @apply flex items-center gap-2.5 px-3 py-1.5 text-xs cursor-pointer text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors;
}
</style>
