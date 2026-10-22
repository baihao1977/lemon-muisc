<template>
  <div class="file-manager-page" :class="{ 'fm-embed-tag': activeTab === 'tag' }">
    <div class="fm-head">
      <h2>文件管理</h2>
      <p class="fm-desc">管理本地音乐文件：编辑标签、清理重复/小文件、检测伪 FLAC、按歌手整理，或升级曲库音质</p>
    </div>

    <div class="fm-shell">
    <div class="fm-tabs">
      <button
        type="button"
        class="fm-tab"
        :class="{ active: activeTab === 'tag' }"
        @click="setTab('tag')"
      >
        标签编辑
      </button>
      <button
        type="button"
        class="fm-tab"
        :class="{ active: activeTab === 'clean' }"
        @click="setTab('clean')"
      >
        清理
      </button>
      <button
        type="button"
        class="fm-tab"
        :class="{ active: activeTab === 'fake-flac' }"
        @click="setTab('fake-flac')"
      >
        伪 FLAC
      </button>
      <button
        type="button"
        class="fm-tab"
        :class="{ active: activeTab === 'organize' }"
        @click="setTab('organize')"
      >
        整理
      </button>
      <button
        type="button"
        class="fm-tab"
        :class="{ active: activeTab === 'upgrade' }"
        @click="setTab('upgrade')"
      >
        音质升级
      </button>
    </div>

    <div class="fm-shell-body">
    <div v-show="activeTab === 'tag'" class="fm-tag-host">
      <p v-if="tagEmbedError" class="fm-empty">标签编辑加载失败：{{ tagEmbedError }}</p>
      <TagEditor v-else-if="tagVisited" embedded />
    </div>

    <!-- ============ 清理（重复曲目 / 小文件） ============ -->
    <section v-if="activeTab === 'clean'" class="fm-panel">
      <div class="clean-subtabs" role="tablist" aria-label="清理类型">
        <button
          type="button"
          class="clean-subtab"
          role="tab"
          :class="{ active: cleanMode === 'dup' }"
          :aria-selected="cleanMode === 'dup'"
          @click="cleanMode = 'dup'"
        >重复曲目</button>
        <button
          type="button"
          class="clean-subtab"
          role="tab"
          :class="{ active: cleanMode === 'small' }"
          :aria-selected="cleanMode === 'small'"
          @click="cleanMode = 'small'"
        >小文件</button>
      </div>

      <template v-if="cleanMode === 'dup'">
        <div class="fm-panel-toolbar">
          <button
            type="button"
            class="btn-primary btn-sm"
            :disabled="dupScanning"
            @click="scanDuplicates"
          >
            {{ dupScanning ? '扫描中…' : '扫描重复曲目' }}
          </button>
          <template v-if="dupResult.groups.length">
            <span class="fm-summary">
              共 {{ dupResult.groupCount }} 组、{{ dupResult.fileCount }} 个文件
            </span>
            <div class="fm-batch-actions">
              <button
                type="button"
                class="btn-ghost btn-sm"
                :disabled="!selectedPaths.size || batchDeleting"
                @click="deleteSelected"
              >
                删除选中（{{ selectedPaths.size }}）
              </button>
              <button
                type="button"
                class="btn-ghost btn-sm"
                :disabled="batchDeleting"
                @click="keepBestDeleteRest"
              >
                每组保留最佳，删除其余
              </button>
              <button
                type="button"
                class="btn-ghost btn-sm"
                :disabled="!selectedPaths.size"
                @click="clearSelection"
              >
                取消选择
              </button>
            </div>
          </template>
        </div>

        <div v-if="!dupResult.groups.length" class="fm-empty">
          <p>{{ dupScanned ? '未发现重复曲目' : '点击「扫描重复曲目」查找同歌名+歌手的重复文件（含 Live / Remix 等版本变体，是否删除由你决定）' }}</p>
        </div>

        <div v-else class="dup-list">
          <div v-for="(g, gi) in dupResult.groups" :key="gi" class="dup-group">
            <div class="dup-group-title">
              <strong>{{ g.title || '未知标题' }}</strong>
              <span>{{ g.artist || '未知歌手' }}</span>
              <span class="dup-count">{{ g.count }} 份</span>
            </div>
            <ul class="dup-files">
              <li v-for="(f, fi) in g.files" :key="fi" class="dup-file-row">
                <label class="dup-check">
                  <input
                    type="checkbox"
                    :checked="selectedPaths.has(f.filePath)"
                    @change="toggleSelect(f.filePath)"
                  />
                </label>
                <span class="dup-file-label">
                  <span class="dup-file-primary">
                    <code class="dup-name">{{ f.fileName || f.filePath }}</code>
                    <span v-if="f.size" class="dup-size">{{ formatFakeSize(f.size) }}</span>
                    <span v-if="f.bitrate" class="dup-meta">{{ Math.round(f.bitrate / 1000) }}kbps</span>
                  </span>
                  <code v-if="f.filePath" class="dup-filepath" :title="f.filePath">{{ f.filePath }}</code>
                </span>
                <span class="dup-file-actions">
                  <button
                    type="button"
                    class="btn-ghost btn-sm"
                    :disabled="dupDeletingPath === f.filePath"
                    :title="'保留该文件，勾选同组其余文件'"
                    @click="declareKeepBest(f)"
                  >
                    保留此项
                  </button>
                  <button
                    type="button"
                    class="btn-ghost btn-sm"
                    :disabled="dupDeletingPath === f.filePath || g.files.length <= 1"
                    :title="g.files.length <= 1 ? '至少保留一份' : '从磁盘永久删除'"
                    @click="deleteDupFile(g, f)"
                  >
                    {{ dupDeletingPath === f.filePath ? '删除中…' : '删除文件' }}
                  </button>
                </span>
              </li>
            </ul>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="fm-panel-toolbar small-toolbar">
          <label class="small-threshold">
            <span>小于</span>
            <input
              v-model.number="smallMaxValue"
              type="number"
              class="small-threshold-input"
              min="1"
              step="1"
              :disabled="smallScanning"
            />
            <AppSelect
              v-model="smallMaxUnit"
              class="small-threshold-unit"
              :options="smallUnitOptions"
              size="sm"
              min-width="4.5rem"
              title="大小单位"
              :disabled="smallScanning"
            />
            <span>的音频文件</span>
          </label>
          <button
            type="button"
            class="btn-primary btn-sm"
            :disabled="smallScanning || !smallMaxBytes"
            @click="scanSmallFiles"
          >
            {{ smallScanning ? '扫描中…' : '扫描小文件' }}
          </button>
          <template v-if="smallResult.files.length">
            <span class="fm-summary">
              共 {{ smallResult.count }} 个
              <span v-if="smallResult.truncated">（已截断至 1000）</span>
              · 阈值 {{ formatFakeSize(smallResult.maxBytes) }}
            </span>
            <div class="fm-batch-actions">
              <button
                type="button"
                class="btn-ghost btn-sm"
                :disabled="!smallSelected.size || smallBusy"
                @click="deleteSmallSelected"
              >
                删除选中（{{ smallSelected.size }}）
              </button>
              <button
                type="button"
                class="btn-ghost btn-sm"
                :disabled="!smallResult.files.length || smallBusy"
                @click="selectAllSmall"
              >
                全选
              </button>
              <button
                type="button"
                class="btn-ghost btn-sm"
                :disabled="!smallSelected.size"
                @click="smallSelected = new Set()"
              >
                取消选择
              </button>
            </div>
          </template>
        </div>

        <p class="fm-hint">
          用于清理体积过小的试听片段或不完整下载。阈值可按需调整（建议先从 1MB 试扫）；删除不可恢复。
        </p>

        <div v-if="!smallResult.files.length" class="fm-empty">
          <p>{{ smallScanned ? '未发现符合条件的小文件' : '设定大小阈值后点击「扫描小文件」' }}</p>
        </div>

        <ul v-else class="fake-list">
          <li v-for="f in smallResult.files" :key="f.filePath" class="fake-row">
            <label class="dup-check">
              <input
                type="checkbox"
                :checked="smallSelected.has(f.filePath)"
                @change="toggleSmallSelect(f.filePath)"
              />
            </label>
            <div class="fake-main">
              <code class="dup-name">{{ f.fileName || f.filePath }}</code>
              <code v-if="f.filePath" class="dup-filepath" :title="f.filePath">{{ f.filePath }}</code>
              <div class="fake-meta">
                <span>{{ formatFakeSize(f.size) }}</span>
                <span v-if="f.title || f.artist">{{ [f.artist, f.title].filter(Boolean).join(' · ') }}</span>
                <span v-if="f.duration">{{ formatDurationSec(f.duration) }}</span>
              </div>
            </div>
            <button
              type="button"
              class="btn-ghost btn-sm"
              :disabled="smallBusy"
              @click="deleteSmallOne(f)"
            >
              删除
            </button>
          </li>
        </ul>
      </template>
    </section>

    <!-- ============ 伪 FLAC ============ -->
    <section v-if="activeTab === 'fake-flac'" class="fm-panel">
      <div class="fm-panel-toolbar">
        <button
          type="button"
          class="btn-primary btn-sm"
          :disabled="fakeScanning"
          @click="scanFakeFlac"
        >
          {{ fakeScanning ? '扫描中…' : '扫描伪 FLAC' }}
        </button>
        <template v-if="fakeResult.files.length">
          <span class="fm-summary">
            扫描 {{ fakeResult.scanned }} 个 .flac，可疑 {{ fakeResult.fakeCount }} 个
            <span v-if="fakeResult.truncated">（已截断至 500）</span>
          </span>
          <div class="fm-batch-actions">
            <button
              type="button"
              class="btn-ghost btn-sm"
              :disabled="!fakeSelected.size || fakeBusy"
              @click="fixFakeExtSelected"
            >
              按检测结果改扩展名（{{ fakeSelected.size }}）
            </button>
            <button
              type="button"
              class="btn-ghost btn-sm"
              :disabled="!fakeSelected.size || fakeBusy"
              @click="deleteFakeSelected"
            >
              删除选中（{{ fakeSelected.size }}）
            </button>
            <button
              type="button"
              class="btn-ghost btn-sm"
              :disabled="!fakeSelected.size"
              @click="fakeSelected = new Set()"
            >
              取消选择
            </button>
          </div>
        </template>
      </div>

      <p class="fm-hint">
        读取文件头判断真实容器。扩展名是 .flac 但实际为 MP3/M4A 等，或文件过小的，会列在下方。
        「改扩展名」只改后缀，不重新编码。
      </p>

      <div v-if="!fakeResult.files.length" class="fm-empty">
        <p>{{ fakeScanned ? '未发现伪 FLAC' : '点击「扫描伪 FLAC」检查音乐库与下载目录' }}</p>
      </div>

      <ul v-else class="fake-list">
        <li v-for="f in fakeResult.files" :key="f.filePath" class="fake-row">
          <label class="dup-check">
            <input
              type="checkbox"
              :checked="fakeSelected.has(f.filePath)"
              @change="toggleFakeSelect(f.filePath)"
            />
          </label>
          <div class="fake-meta">
            <code class="dup-path" :title="f.filePath">{{ f.fileName || f.filePath }}</code>
            <span class="fake-reason">{{ f.reason }}</span>
          </div>
          <span v-if="f.kind" class="dup-meta">实测 {{ String(f.kind).toUpperCase() }}</span>
          <span v-if="f.size" class="dup-meta">{{ formatFakeSize(f.size) }}</span>
          <span class="dup-file-actions">
            <button
              type="button"
              class="btn-ghost btn-sm"
              :disabled="fakeBusy || !f.suggestedExt || f.suggestedExt === '.flac'"
              :title="f.suggestedExt ? `重命名为 *${f.suggestedExt}` : '无建议扩展名'"
              @click="fixFakeExt(f)"
            >
              改扩展名
            </button>
            <button
              type="button"
              class="btn-ghost btn-sm"
              :disabled="fakeBusy"
              @click="renameFakeFile(f)"
            >
              改文件名
            </button>
            <button
              type="button"
              class="btn-ghost btn-sm"
              :disabled="fakeBusy"
              @click="deleteFakeFile(f)"
            >
              删除
            </button>
          </span>
        </li>
      </ul>
    </section>

    <!-- ============ 整理 ============ -->
    <section v-if="activeTab === 'organize'" class="fm-panel">
      <!-- 左右分栏：左侧目录树，右侧文件勾选 -->
      <div class="org-layout">
        <!-- 左：目录树 -->
        <div class="org-dir-panel card">
          <div class="org-panel-head">
            <span class="org-panel-title">文件夹</span>
            <button
              class="btn-ghost btn-sm"
              :disabled="orgLoadingDirs"
              @click="loadOrgDirs"
            >
              {{ orgLoadingDirs ? '加载中…' : '刷新' }}
            </button>
          </div>
          <p v-if="!orgRootDirs.length" class="org-picker-empty">
            暂无已配置的音乐库目录。请先在「设置 → 文件路径」添加；Docker 请把歌曲挂到 /music 后刷新。
          </p>
          <div v-else-if="orgLoadingDirs" class="org-picker-loading">正在加载目录…</div>
          <div v-else class="org-tree">
            <template v-for="row in orgVisibleTree" :key="row.path">
              <div
                class="org-tree-row"
                :class="{ active: orgActiveDir === row.path }"
                :style="{ paddingLeft: `${row.depth * 16 + 10}px` }"
              >
                <button
                  type="button"
                  class="org-tree-toggle"
                  :class="{ open: row.expanded }"
                  :disabled="row.loading"
                  @click.stop="toggleOrgNode(row.path)"
                >
                  <svg v-if="row.loading" class="spin" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg>
                  <svg v-else viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
                <svg class="org-tree-folder" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/></svg>
                <span
                  class="org-tree-label"
                  :title="row.path"
                  @click="selectOrgFolder(row.path)"
                >{{ row.name }}</span>
              </div>
            </template>
          </div>
        </div>

        <!-- 右：当前文件夹文件勾选区 -->
        <div class="org-file-panel card">
          <div class="org-panel-head">
            <span class="org-panel-title">文件列表</span>
            <span class="org-count">
              {{ orgFiles.length }} 个文件 · 已选 {{ orgPickedFiles.size }}
            </span>
          </div>
          <div v-if="orgActiveDir" class="org-current-dir" :title="orgActiveDir">{{ orgActiveDir }}</div>

          <template v-if="orgFiles.length">
            <div class="org-files-toolbar">
              <label class="org-check-all">
                <input
                  type="checkbox"
                  :checked="orgFiles.length > 0 && orgFiles.every((f) => orgPickedFiles.has(f.filePath))"
                  @change="toggleAllOrgFiles"
                />
                全选列表
              </label>
              <button
                type="button"
                class="btn-ghost btn-sm"
                :disabled="!orgPickedFiles.size"
                @click="orgPickedFiles = new Set()"
              >
                清空选择
              </button>
            </div>
            <ul class="org-file-list">
              <li v-for="f in orgFiles" :key="f.filePath">
                <label class="org-file-label" :title="f.filePath">
                  <input
                    type="checkbox"
                    :checked="orgPickedFiles.has(f.filePath)"
                    @change="toggleOrgFile(f.filePath)"
                  />
                  <span class="org-file-name">{{ f.fileName || f.filePath }}</span>
                </label>
              </li>
            </ul>
          </template>
          <div v-else class="org-picker-empty">
            {{ orgActiveDir ? '该目录及子目录中没有音频文件' : '点击左侧文件夹，递归加载其中的音频文件' }}
          </div>

          <!-- 已选文件汇总（跨文件夹累计） -->
          <div v-if="orgPickedFiles.size" class="org-picked-summary">
            <div class="org-picked-head">
              <strong>已选 {{ orgPickedFiles.size }} 个文件</strong>
            </div>
            <ul class="org-picked-list">
              <li v-for="p in [...orgPickedFiles].slice(0, 100)" :key="p">
                <code :title="p">{{ p }}</code>
              </li>
            </ul>
            <p v-if="orgPickedFiles.size > 100" class="org-picked-more">等 {{ orgPickedFiles.size }} 个文件</p>
          </div>
        </div>
      </div>

      <div class="org-form">
        <h3>迁移目标</h3>
        <p class="org-desc">
          按「目标目录 / 专辑艺术家 / 专辑 / 歌曲文件」整理。无专辑艺术家时用歌手。
          迁移后目标目录会自动加入音乐库扫描。
        </p>
        <div class="org-field">
          <label for="org-artist-mode">多歌手归属</label>
          <select
            id="org-artist-mode"
            v-model="organizeArtistMode"
            class="input"
            :disabled="organizing"
          >
            <option value="primary">取第一位歌手（合唱归主唱专辑，推荐）</option>
            <option value="various">多歌手归档到「群星 (Various Artists)」</option>
          </select>
          <p class="org-hint">例如「A和B」合唱且专辑属于 A：选「取第一位」会进 A/专辑/，而不会单独建「A和B」或进群星。</p>
        </div>
        <div class="org-field">
          <label for="org-target">目标目录</label>
          <input
            id="org-target"
            v-model="organizeTarget"
            type="text"
            class="input"
            placeholder="例如 /vol1/1000/MusicOrganized 或 D:/Music/Organized"
            :disabled="organizing"
          />
          <p class="org-hint">上次填写的目标目录会自动记住（本机浏览器缓存）。</p>
        </div>
        <div class="org-actions">
          <button
            type="button"
            class="btn-primary"
            :disabled="!canStartOrganize || organizing"
            @click="startOrganize"
          >
            {{ organizing ? '整理中…' : '开始整理' }}
          </button>
          <button
            type="button"
            class="btn-ghost"
            :disabled="!organizeResult"
            @click="organizeResult = null"
          >
            清除结果
          </button>
        </div>
      </div>

      <div v-if="organizeResult" class="org-result">
        <h3>整理完成</h3>
        <p class="org-summary">
          <span>迁移 <strong>{{ organizeResult.moved }}</strong> 首</span>
          <span v-if="organizeResult.skipped">跳过 <strong>{{ organizeResult.skipped }}</strong> 首</span>
          <span v-if="organizeResult.failed">
            <strong class="text-danger">{{ organizeResult.failed }}</strong> 首失败
          </span>
          <span>共 <strong>{{ organizeResult.artists }}</strong> 位艺术家</span>
          <span v-if="organizeResult.albums"> · <strong>{{ organizeResult.albums }}</strong> 张专辑</span>
          <span v-if="organizeResult.cleanedDirs"> · 清理空目录 <strong>{{ organizeResult.cleanedDirs }}</strong> 个</span>
        </p>
        <p class="org-target-done">目标目录：<code>{{ organizeResult.targetDir }}</code></p>

        <div v-if="organizeResult.failedList?.length" class="org-failed">
          <h4>失败列表</h4>
          <ul>
            <li v-for="(item, i) in organizeResult.failedList" :key="i">
              <code>{{ item.filePath }}</code> — {{ item.error }}
            </li>
          </ul>
        </div>
        <div v-if="organizeResult.movedList?.length" class="org-moved">
          <h4>迁移明细</h4>
          <div class="org-moved-count">已显示前 50 条，共 {{ organizeResult.movedList.length }} 条</div>
          <ul>
            <li v-for="(item, i) in organizeResult.movedList.slice(0, 50)" :key="i">
              <code class="org-from">{{ item.from }}</code>
              <span class="org-arrow">→</span>
              <code class="org-to">{{ item.to }}</code>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- ============ 音质升级 ============ -->
    <section v-if="activeTab === 'upgrade'" class="fm-panel">
      <div class="fm-panel-toolbar">
        <button type="button" class="btn-primary btn-sm" @click="upgradeDialogOpen = true">
          扫描并升级
        </button>
      </div>
      <p class="fm-tip">扫描音乐库里可换成更高音质的曲目，下载后覆盖原文件。入队进度在本页查看，具体下载任务仍在「下载」页。</p>
      <PlaylistPacedJobPanel
        v-if="upgradeJob"
        kind="upgrade"
        :job="upgradeJob"
        @updated="onUpgradeJobUpdated"
        @cancelled="upgradeJob = null"
        @toast="onUpgradeToast"
      />
      <div v-else class="fm-empty">
        <p>{{ upgradeJobLoaded ? '当前没有进行中的音质升级任务' : '正在读取任务…' }}</p>
      </div>
    </section>
    </div>
    </div>

    <QualityUpgradeDialog
      :open="upgradeDialogOpen"
      :default-batch-size="upgradeDefaults.batchSize"
      :default-interval-hours="upgradeDefaults.intervalHours"
      @cancel="upgradeDialogOpen = false"
      @done="onUpgradeDone"
    />
    <div v-if="fmToast" class="fm-toast" :class="fmToast.type">{{ fmToast.text }}</div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, onActivated, onErrorCaptured } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api.js'
import { onWS } from '../ws.js'
import { appConfirm, appPrompt } from '../stores/appDialog.js'
import { reloadLibraryTracksFromServer } from '../stores/library.js'
import AppSelect from '../components/AppSelect.vue'
import TagEditor from './TagEditor.vue'
import QualityUpgradeDialog from '../components/QualityUpgradeDialog.vue'
import PlaylistPacedJobPanel from '../components/PlaylistPacedJobPanel.vue'

defineOptions({ name: 'FileManager' })

const route = useRoute()
const router = useRouter()

const TAB_IDS = ['tag', 'clean', 'fake-flac', 'organize', 'upgrade']

function normalizeTab(raw) {
  const t = String(raw || '').trim()
  // 兼容旧链接 ?tab=dedup
  if (t === 'dedup') return 'clean'
  return TAB_IDS.includes(t) ? t : 'tag'
}

const activeTab = ref(normalizeTab(route.query.tab))
const tagVisited = ref(activeTab.value === 'tag')
const tagEmbedError = ref('')

onErrorCaptured((err) => {
  tagEmbedError.value = err?.message || String(err)
  console.error('[FileManager] child error:', err)
  return false
})

function setTab(tab) {
  const next = normalizeTab(tab)
  if (next === 'tag') tagVisited.value = true
  if (activeTab.value === next) return
  activeTab.value = next
}

function syncTabToRoute(tab) {
  const next = normalizeTab(tab)
  if (normalizeTab(route.query.tab) === next) return
  router.replace({
    path: '/file-manager',
    query: { ...route.query, tab: next },
  }).catch(() => {})
}

watch(activeTab, (tab) => {
  if (tab === 'tag') tagVisited.value = true
  syncTabToRoute(tab)
  if (tab === 'organize' && !orgRootDirs.value.length) {
    loadOrgDirs()
  }
  if (tab === 'upgrade') refreshUpgradeJob()
})

watch(
  () => route.query.tab,
  (tab) => {
    const next = normalizeTab(tab)
    if (next === 'tag') tagVisited.value = true
    if (next !== activeTab.value) activeTab.value = next
  },
)

onMounted(() => {
  if (activeTab.value === 'tag') tagVisited.value = true
  if (!route.query.tab) syncTabToRoute(activeTab.value)
  loadUpgradeDefaults()
  refreshUpgradeJob()
})
onActivated(() => {
  if (activeTab.value === 'upgrade') refreshUpgradeJob()
})

const upgradeDialogOpen = ref(false)
const upgradeJob = ref(null)
const upgradeJobLoaded = ref(false)
const upgradeDefaults = ref({ batchSize: 50, intervalHours: 24 })
const fmToast = ref(null)
const upgradeUnsubs = []

function showFmToast(text, type = 'info') {
  fmToast.value = { text, type }
  setTimeout(() => { fmToast.value = null }, 3000)
}

function onUpgradeToast({ text, type } = {}) {
  if (text) showFmToast(text, type || 'info')
}

function onUpgradeJobUpdated(job) {
  if (job?.playlistId !== 'quality-upgrade') return
  upgradeJob.value = (job.status === 'active' || job.status === 'paused') ? job : null
}

async function loadUpgradeDefaults() {
  try {
    const s = await api.settings.get()
    const batch = Number(s?.['download.playlistBatchSize'])
    const hours = Number(s?.['download.playlistIntervalHours'])
    upgradeDefaults.value = {
      batchSize: [10, 20, 50, 100, 200, 300, 500, 1000].includes(batch) ? batch : 50,
      intervalHours: [1, 3, 6, 12, 24, 48].includes(hours) ? hours : 24,
    }
  } catch {}
}

async function refreshUpgradeJob() {
  try {
    const res = await api.library.qualityUpgradeActiveJob()
    upgradeJob.value = res?.job || null
  } catch {
    upgradeJob.value = null
  } finally {
    upgradeJobLoaded.value = true
  }
}

async function onUpgradeDone(payload) {
  upgradeDialogOpen.value = false
  upgradeJob.value = payload?.job || null
  const matched = payload?.matchedCount || 0
  const unmatched = payload?.unmatchedCount || 0
  const first = Math.min(payload?.batchSize || 50, matched)
  const unmatchedHint = unmatched ? `，未匹配 ${unmatched} 首` : ''
  showFmToast(
    `已开始音质升级：首批 ${first} 首已入队，共 ${matched} 首，每 ${payload?.intervalHours || 24} 小时一批${unmatchedHint}`,
    'success',
  )
  try {
    await api.settings.update({
      'download.playlistBatchSize': String(payload.batchSize),
      'download.playlistIntervalHours': String(payload.intervalHours),
    })
    upgradeDefaults.value = {
      batchSize: payload.batchSize,
      intervalHours: payload.intervalHours,
    }
  } catch {}
}

upgradeUnsubs.push(onWS('playlist-download:progress', (job) => {
  onUpgradeJobUpdated(job)
}))
upgradeUnsubs.push(onWS('playlist-download:done', (job) => {
  onUpgradeJobUpdated(job)
  if (job?.playlistId === 'quality-upgrade') showFmToast('音质升级循序任务已全部入队', 'success')
}))
upgradeUnsubs.push(onWS('playlist-download:cancelled', (job) => {
  if (job?.playlistId === 'quality-upgrade') upgradeJob.value = null
}))
onUnmounted(() => {
  upgradeUnsubs.forEach((fn) => fn())
})

/* ---------- 清理：重复曲目 / 小文件 ---------- */
const CLEAN_MODE_KEY = 'lemon.fileManager.cleanMode'
const SMALL_MAX_VALUE_KEY = 'lemon.fileManager.smallMaxValue'
const SMALL_MAX_UNIT_KEY = 'lemon.fileManager.smallMaxUnit'
const cleanMode = ref(localStorage.getItem(CLEAN_MODE_KEY) === 'small' ? 'small' : 'dup')
watch(cleanMode, (v) => {
  try { localStorage.setItem(CLEAN_MODE_KEY, v === 'small' ? 'small' : 'dup') } catch {}
})

const dupScanning = ref(false)
const dupScanned = ref(false)
const dupResult = ref({ groupCount: 0, fileCount: 0, groups: [] })
const dupDeletingPath = ref('')
const selectedPaths = ref(new Set())
const batchDeleting = ref(false)

function loadSmallMaxValue() {
  const n = Number(localStorage.getItem(SMALL_MAX_VALUE_KEY))
  return Number.isFinite(n) && n > 0 ? n : 1
}
function loadSmallMaxUnit() {
  const u = String(localStorage.getItem(SMALL_MAX_UNIT_KEY) || 'MB').toUpperCase()
  return u === 'KB' ? 'KB' : 'MB'
}
const smallMaxValue = ref(loadSmallMaxValue())
const smallMaxUnit = ref(loadSmallMaxUnit())
const smallUnitOptions = [
  { value: 'KB', label: 'KB' },
  { value: 'MB', label: 'MB' },
]
watch(smallMaxValue, (v) => {
  try { localStorage.setItem(SMALL_MAX_VALUE_KEY, String(Math.max(1, Number(v) || 1))) } catch {}
})
watch(smallMaxUnit, (v) => {
  try { localStorage.setItem(SMALL_MAX_UNIT_KEY, v === 'KB' ? 'KB' : 'MB') } catch {}
})
const smallMaxBytes = computed(() => {
  const n = Math.max(1, Number(smallMaxValue.value) || 1)
  return smallMaxUnit.value === 'KB' ? Math.floor(n * 1024) : Math.floor(n * 1024 * 1024)
})
const smallScanning = ref(false)
const smallScanned = ref(false)
const smallResult = ref({ maxBytes: 0, count: 0, truncated: false, files: [] })
const smallSelected = ref(new Set())
const smallBusy = ref(false)

function toggleSmallSelect(filePath) {
  const next = new Set(smallSelected.value)
  if (next.has(filePath)) next.delete(filePath)
  else next.add(filePath)
  smallSelected.value = next
}

function selectAllSmall() {
  smallSelected.value = new Set((smallResult.value.files || []).map((f) => f.filePath))
}

function formatDurationSec(sec) {
  const n = Math.max(0, Math.round(Number(sec) || 0))
  if (!n) return ''
  const m = Math.floor(n / 60)
  const s = n % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

async function scanSmallFiles() {
  if (smallScanning.value || !smallMaxBytes.value) return
  smallScanning.value = true
  try {
    const res = await api.library.scanSmallFiles(smallMaxBytes.value)
    smallResult.value = res?.data || { maxBytes: smallMaxBytes.value, count: 0, truncated: false, files: [] }
    smallSelected.value = new Set()
    smallScanned.value = true
  } catch (e) {
    alert(e.message || '扫描小文件失败')
  } finally {
    smallScanning.value = false
  }
}

function pruneSmallResult(deletedSet) {
  const files = (smallResult.value.files || []).filter((f) => !deletedSet.has(f.filePath))
  smallResult.value = {
    ...smallResult.value,
    count: files.length,
    files,
  }
  smallSelected.value = new Set([...smallSelected.value].filter((p) => !deletedSet.has(p)))
}

async function deleteSmallOne(file) {
  const filePath = file?.filePath
  if (!filePath || smallBusy.value) return
  const ok = await appConfirm({
    title: '永久删除小文件',
    message: `确定从磁盘永久删除？\n\n${file.fileName || filePath}\n${formatFakeSize(file.size)}`,
    hint: '此操作不可恢复。',
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  smallBusy.value = true
  try {
    const res = await api.library.deleteFiles([filePath])
    const failed = res?.data?.failed || []
    if (failed.length) {
      alert(failed[0]?.error || '删除失败')
      return
    }
    pruneSmallResult(new Set([filePath]))
  } catch (e) {
    alert(e.message || '删除失败')
  } finally {
    smallBusy.value = false
  }
}

async function deleteSmallSelected() {
  const list = [...smallSelected.value]
  if (!list.length || smallBusy.value) return
  const ok = await appConfirm({
    title: '批量删除小文件',
    message: `确定从磁盘永久删除选中的 ${list.length} 个文件？此操作不可恢复。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  smallBusy.value = true
  try {
    const res = await api.library.deleteFiles(list)
    const data = res?.data || {}
    const failed = data.failed || []
    const deleted = new Set(data.deleted || [])
    pruneSmallResult(deleted)
    if (failed.length) {
      alert(`${deleted.size > 0 ? `已删除 ${deleted.size} 个，` : ''}${failed.length} 个删除失败：${failed[0]?.error || ''}`)
    }
  } catch (e) {
    alert(e.message || '批量删除失败')
  } finally {
    smallBusy.value = false
  }
}

function toggleSelect(filePath) {
  const next = new Set(selectedPaths.value)
  if (next.has(filePath)) next.delete(filePath)
  else next.add(filePath)
  selectedPaths.value = next
}

function clearSelection() {
  selectedPaths.value = new Set()
}

function pruneDupResult() {
  const groups = (dupResult.value.groups || [])
    .map((g) => ({
      ...g,
      files: (g.files || []).filter(Boolean),
      count: (g.files || []).length,
    }))
    .filter((g) => g.files.length > 1)
  const fileCount = groups.reduce((n, g) => n + g.files.length, 0)
  dupResult.value = { groupCount: groups.length, fileCount, groups }
  // 清除已不存在的选中项
  const exist = new Set(dupResult.value.groups.flatMap((g) => g.files.map((f) => f.filePath)))
  const next = new Set([...selectedPaths.value].filter((p) => exist.has(p)))
  selectedPaths.value = next
}

async function scanDuplicates() {
  if (dupScanning.value) return
  dupScanning.value = true
  try {
    const res = await api.library.duplicates()
    dupResult.value = res?.data || { groupCount: 0, fileCount: 0, groups: [] }
    dupScanned.value = true
  } catch (e) {
    alert(e.message || '查重失败')
  } finally {
    dupScanning.value = false
  }
}

async function deleteDupFile(group, file) {
  const filePath = file?.filePath
  if (!filePath || dupDeletingPath.value) return
  if ((group?.files || []).length <= 1) return
  const name = file.fileName || filePath
  const ok = await appConfirm({
    title: '永久删除文件',
    message: `确定从磁盘永久删除？\n\n${name}`,
    hint: '此操作不可恢复。',
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  dupDeletingPath.value = filePath
  try {
    const res = await api.library.deleteFiles([filePath])
    const failed = res?.data?.failed || []
    if (failed.length) {
      alert(failed[0]?.error || '删除失败')
      return
    }
    group.files = group.files.filter((f) => f.filePath !== filePath)
    pruneDupResult()
  } catch (e) {
    alert(e.message || '删除失败')
  } finally {
    dupDeletingPath.value = ''
  }
}

/** 用「保留最佳」策略挑选每组中应保留的那个文件：优先更高的音质和更完整的文件名 */
function pickBestFile(group) {
  const files = [...(group.files || [])]
  const rank = (f) => {
    let score = 0
    score += Math.round(Number(f.bitrate) || 0) // 音质
    const name = String(f.fileName || '')
    if (/flac|ape|wav/i.test(name)) score += 100000
    else if (/m4a|aac/i.test(name)) score += 50000
    else if (/mp3/i.test(name)) score += 10000
    // 文件名信息更完整（包含 - 或较长）说明更可能是规范命名的正式文件
    if (name.includes('-')) score += 5000
    score += Math.min(name.length, 200)
    return score
  }
  return files.sort((a, b) => rank(b) - rank(a))[0]
}

/** 点击某文件「保留最佳」：保留该文件，勾选同组内其余文件（用于批量删除） */
function declareKeepBest(file) {
  const group = dupResult.value.groups.find((g) => (g.files || []).some((f) => f.filePath === file.filePath))
  if (!group) return
  const next = new Set(selectedPaths.value)
  for (const f of group.files) {
    if (f.filePath === file.filePath) next.delete(f.filePath)
    else next.add(f.filePath)
  }
  selectedPaths.value = next
}

/** 一键：每组保留最佳文件，其余全部删除 */
async function keepBestDeleteRest() {
  const groups = dupResult.value.groups
  const toDelete = []
  for (const g of groups) {
    const best = pickBestFile(g)
    for (const f of g.files) {
      if (f.filePath !== best.filePath) toDelete.push(f.filePath)
    }
  }
  if (!toDelete.length) return
  const ok = await appConfirm({
    title: '批量删除重复文件',
    message: `将删除 ${toDelete.length} 个文件（每组保留音质/命名最佳的 1 份），此操作不可恢复。`,
    hint: '建议先核对选中列表。',
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  await runBatchDelete(toDelete)
}

async function deleteSelected() {
  const list = [...selectedPaths.value]
  if (!list.length) return
  const ok = await appConfirm({
    title: '批量删除选中文件',
    message: `确定从磁盘永久删除选中的 ${list.length} 个文件？此操作不可恢复。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  await runBatchDelete(list)
}

async function runBatchDelete(list) {
  if (batchDeleting.value) return
  batchDeleting.value = true
  try {
    const res = await api.library.deleteFiles(list)
    const data = res?.data || {}
    const failed = data.failed || []
    const deleted = new Set(data.deleted || [])
    for (const g of dupResult.value.groups) {
      g.files = (g.files || []).filter((f) => !deleted.has(f.filePath))
    }
    pruneDupResult()
    if (failed.length) {
      alert(`${deleted.size > 0 ? `已删除 ${deleted.size} 个，` : ''}${failed.length} 个删除失败：${failed[0]?.error || ''}`)
    }
  } catch (e) {
    alert(e.message || '批量删除失败')
  } finally {
    batchDeleting.value = false
  }
}

/* ---------- 伪 FLAC ---------- */
const fakeScanning = ref(false)
const fakeScanned = ref(false)
const fakeResult = ref({ scanned: 0, fakeCount: 0, truncated: false, files: [] })
const fakeSelected = ref(new Set())
const fakeBusy = ref(false)

function formatFakeSize(size) {
  const n = Number(size) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function toggleFakeSelect(filePath) {
  const next = new Set(fakeSelected.value)
  if (next.has(filePath)) next.delete(filePath)
  else next.add(filePath)
  fakeSelected.value = next
}

function pruneFakeResult(removedPaths) {
  const gone = new Set(removedPaths || [])
  if (!gone.size) return
  const files = (fakeResult.value.files || []).filter((f) => !gone.has(f.filePath))
  fakeResult.value = {
    ...fakeResult.value,
    files,
    fakeCount: files.length,
  }
  const next = new Set([...fakeSelected.value].filter((p) => !gone.has(p)))
  fakeSelected.value = next
}

function applyFakeRenameLocal(from, to, fileName) {
  const files = (fakeResult.value.files || []).map((f) => {
    if (f.filePath !== from) return f
    return { ...f, filePath: to, fileName: fileName || f.fileName }
  })
  fakeResult.value = { ...fakeResult.value, files, fakeCount: files.length }
  if (fakeSelected.value.has(from)) {
    const next = new Set(fakeSelected.value)
    next.delete(from)
    next.add(to)
    fakeSelected.value = next
  }
}

async function scanFakeFlac() {
  if (fakeScanning.value) return
  fakeScanning.value = true
  try {
    const res = await api.library.scanFakeFlac()
    fakeResult.value = res?.data || { scanned: 0, fakeCount: 0, truncated: false, files: [] }
    fakeScanned.value = true
    fakeSelected.value = new Set()
  } catch (e) {
    alert(e.message || '扫描失败')
  } finally {
    fakeScanning.value = false
  }
}

async function renameFakeFile(file) {
  if (!file?.filePath || fakeBusy.value) return
  const nextName = await appPrompt({
    title: '修改文件名',
    message: file.filePath,
    inputLabel: '新文件名（可含扩展名）',
    defaultValue: file.fileName || '',
    confirmText: '重命名',
  })
  if (nextName == null) return
  const trimmed = String(nextName).trim()
  if (!trimmed || trimmed === file.fileName) return
  fakeBusy.value = true
  try {
    const res = await api.library.renameFile(file.filePath, trimmed)
    const data = res?.data || {}
    if (data.unchanged) return
    applyFakeRenameLocal(file.filePath, data.to, data.fileName)
  } catch (e) {
    alert(e.message || '重命名失败')
  } finally {
    fakeBusy.value = false
  }
}

async function fixFakeExt(file) {
  if (!file?.filePath || !file.suggestedExt || file.suggestedExt === '.flac' || fakeBusy.value) return
  const base = String(file.fileName || '').replace(/\.[^.]+$/, '')
  const newName = `${base}${file.suggestedExt}`
  const ok = await appConfirm({
    title: '修正扩展名',
    message: `将\n${file.fileName}\n重命名为\n${newName}`,
    hint: '只改后缀，不重新编码。若同目录已有同名目标文件会失败。',
    confirmText: '改扩展名',
  })
  if (!ok) return
  fakeBusy.value = true
  try {
    const res = await api.library.renameFile(file.filePath, newName)
    const data = res?.data || {}
    if (data.unchanged) return
    // 扩展名已正确则不再视为伪 flac，从列表移除
    pruneFakeResult([file.filePath])
  } catch (e) {
    alert(e.message || '改扩展名失败')
  } finally {
    fakeBusy.value = false
  }
}

async function fixFakeExtSelected() {
  const list = (fakeResult.value.files || []).filter(
    (f) => fakeSelected.value.has(f.filePath) && f.suggestedExt && f.suggestedExt !== '.flac',
  )
  if (!list.length) {
    alert('选中项没有可改的扩展名（需识别出真实容器）')
    return
  }
  const ok = await appConfirm({
    title: '批量改扩展名',
    message: `将按检测结果修正 ${list.length} 个文件的扩展名（如 .flac → .mp3）。`,
    confirmText: '开始',
  })
  if (!ok) return
  fakeBusy.value = true
  const done = []
  const failed = []
  try {
    for (const f of list) {
      const base = String(f.fileName || '').replace(/\.[^.]+$/, '')
      const newName = `${base}${f.suggestedExt}`
      try {
        await api.library.renameFile(f.filePath, newName)
        done.push(f.filePath)
      } catch (e) {
        failed.push({ filePath: f.filePath, error: e.message || '失败' })
      }
    }
    pruneFakeResult(done)
    if (failed.length) {
      alert(`已修正 ${done.length} 个，${failed.length} 个失败：${failed[0]?.error || ''}`)
    }
  } finally {
    fakeBusy.value = false
  }
}

async function deleteFakeFile(file) {
  if (!file?.filePath || fakeBusy.value) return
  const ok = await appConfirm({
    title: '永久删除文件',
    message: `确定从磁盘永久删除？\n\n${file.fileName || file.filePath}`,
    hint: '此操作不可恢复。',
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  fakeBusy.value = true
  try {
    const res = await api.library.deleteFiles([file.filePath])
    const failed = res?.data?.failed || []
    if (failed.length) {
      alert(failed[0]?.error || '删除失败')
      return
    }
    pruneFakeResult([file.filePath])
  } catch (e) {
    alert(e.message || '删除失败')
  } finally {
    fakeBusy.value = false
  }
}

async function deleteFakeSelected() {
  const list = [...fakeSelected.value]
  if (!list.length || fakeBusy.value) return
  const ok = await appConfirm({
    title: '批量删除伪 FLAC',
    message: `确定从磁盘永久删除选中的 ${list.length} 个文件？此操作不可恢复。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  fakeBusy.value = true
  try {
    const res = await api.library.deleteFiles(list)
    const data = res?.data || {}
    const deleted = data.deleted || []
    const failed = data.failed || []
    pruneFakeResult(deleted)
    if (failed.length) {
      alert(`${deleted.length ? `已删除 ${deleted.length} 个，` : ''}${failed.length} 个失败：${failed[0]?.error || ''}`)
    }
  } catch (e) {
    alert(e.message || '批量删除失败')
  } finally {
    fakeBusy.value = false
  }
}

/* ---------- 整理 ---------- */
const ORG_TARGET_KEY = 'lemon.fileManager.organizeTarget'
const ORG_ARTIST_MODE_KEY = 'lemon.fileManager.organizeArtistMode'
function loadOrganizeTarget() {
  try {
    return String(localStorage.getItem(ORG_TARGET_KEY) || '').trim()
  } catch {
    return ''
  }
}
function persistOrganizeTarget(value) {
  try {
    const v = String(value || '').trim()
    if (v) localStorage.setItem(ORG_TARGET_KEY, v)
    else localStorage.removeItem(ORG_TARGET_KEY)
  } catch {}
}
function loadOrganizeArtistMode() {
  try {
    const v = String(localStorage.getItem(ORG_ARTIST_MODE_KEY) || '').trim()
    return v === 'various' ? 'various' : 'primary'
  } catch {
    return 'primary'
  }
}
function persistOrganizeArtistMode(value) {
  try {
    localStorage.setItem(ORG_ARTIST_MODE_KEY, value === 'various' ? 'various' : 'primary')
  } catch {}
}
const organizeTarget = ref(loadOrganizeTarget())
const organizeArtistMode = ref(loadOrganizeArtistMode())
const organizing = ref(false)
const organizeResult = ref(null)

watch(organizeTarget, (v) => persistOrganizeTarget(v))
watch(organizeArtistMode, (v) => persistOrganizeArtistMode(v))

// 仅文件模式：勾选文件整理

/* 目录树状态（复用标签编辑器交互） */
const orgRootDirs = ref([])
const orgExpanded = ref(new Set())
const orgTreeCache = ref({})
const orgActiveDir = ref('')
const orgLoadingDirs = ref(false)
/* 文件列表 + 跨文件夹累计勾选 */
const orgFiles = ref([])
const orgPickedFiles = ref(new Set())

const canStartOrganize = computed(() => {
  if (!organizeTarget.value.trim() || organizing.value) return false
  return orgPickedFiles.value.size > 0
})

function orgGetTreeEntry(dirPath) {
  return orgTreeCache.value[dirPath] || { dirs: [], loaded: false, loading: false }
}

function orgFolderName(dirPath, depth) {
  if (!dirPath) return ''
  const parts = String(dirPath).replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || dirPath
}

const orgVisibleTree = computed(() => {
  const rows = []
  const visit = (dirPath, depth) => {
    const cached = orgGetTreeEntry(dirPath)
    const expanded = orgExpanded.value.has(dirPath)
    rows.push({
      path: dirPath,
      name: orgFolderName(dirPath, depth),
      depth,
      expanded,
      loading: cached.loading,
      loaded: cached.loaded,
      hasChildren: !cached.loaded || cached.dirs.length > 0,
    })
    if (expanded && cached.loaded) {
      for (const child of cached.dirs) visit(child.path, depth + 1)
    }
  }
  for (const root of orgRootDirs.value) visit(root, 0)
  return rows
})

async function loadOrgDirs() {
  if (orgLoadingDirs.value) return
  orgLoadingDirs.value = true
  try {
    const res = await api.paths.list()
    orgRootDirs.value = res.musicPaths || res.data || []
    orgExpanded.value = new Set()
    orgTreeCache.value = {}
    if (orgRootDirs.value.length) {
      orgActiveDir.value = orgRootDirs.value[0]
      // 自动展开一级子目录，并加载第一个根下的音频
      for (const root of orgRootDirs.value.slice(0, 2)) {
        await ensureOrgChildren(root)
        if (orgGetTreeEntry(root).loaded) orgExpanded.value.add(root)
      }
      orgExpanded.value = new Set(orgExpanded.value)
      await loadOrgFiles(orgActiveDir.value)
    }
  } catch (e) {
    alert(e.message || '加载目录失败')
  } finally {
    orgLoadingDirs.value = false
  }
}

async function ensureOrgChildren(dirPath) {
  const cached = orgGetTreeEntry(dirPath)
  if (cached.loaded || cached.loading) return
  orgTreeCache.value = {
    ...orgTreeCache.value,
    [dirPath]: { ...cached, loading: true },
  }
  try {
    const res = await api.tag.listDir(dirPath)
    const data = res.data || {}
    orgTreeCache.value = {
      ...orgTreeCache.value,
      [dirPath]: { dirs: data.dirs || [], loaded: true, loading: false },
    }
  } catch (e) {
    orgTreeCache.value = {
      ...orgTreeCache.value,
      [dirPath]: { dirs: [], loaded: true, loading: false },
    }
  }
}

async function toggleOrgNode(dirPath) {
  if (orgExpanded.value.has(dirPath)) {
    const next = new Set(orgExpanded.value)
    next.delete(dirPath)
    orgExpanded.value = next
    return
  }
  await ensureOrgChildren(dirPath)
  const next = new Set(orgExpanded.value)
  next.add(dirPath)
  orgExpanded.value = next
}

/** 点击文件夹：递归加载该目录及所有子目录中的音频 */
async function selectOrgFolder(dirPath) {
  orgActiveDir.value = dirPath
  await ensureOrgChildren(dirPath)
  await loadOrgFiles(dirPath)
}

async function loadOrgFiles(dirPath) {
  try {
    const res = await api.tag.scan(dirPath, { recursive: true })
    orgFiles.value = (Array.isArray(res.data) ? res.data : []).filter((f) => f.filePath)
  } catch (e) {
    orgFiles.value = []
    alert(e.message || '加载文件失败')
  }
}

function toggleOrgFile(filePath) {
  const next = new Set(orgPickedFiles.value)
  if (next.has(filePath)) next.delete(filePath)
  else next.add(filePath)
  orgPickedFiles.value = next
}

function toggleAllOrgFiles() {
  const all = orgFiles.value.map((f) => f.filePath)
  const allPicked = all.length > 0 && all.every((p) => orgPickedFiles.value.has(p))
  const next = new Set(orgPickedFiles.value)
  for (const p of all) {
    if (allPicked) next.delete(p)
    else next.add(p)
  }
  orgPickedFiles.value = next
}

async function startOrganize() {
  const target = organizeTarget.value.trim()
  if (!target) {
    alert('请填写目标目录')
    return
  }
  if (!orgPickedFiles.value.size) {
    alert('请勾选要整理的音频文件')
    return
  }
  const filePaths = [...orgPickedFiles.value]
  const scopeLabel = `已选 ${filePaths.length} 个文件`

  const modeLabel = organizeArtistMode.value === 'various'
    ? '多歌手进「群星」'
    : '多歌手取第一位（合唱归主唱）'
  const ok = await appConfirm({
    title: '按歌手整理',
    message: `将 ${scopeLabel} 中的歌曲迁移到：\n${target}\n\n结构：目标目录/专辑艺术家/专辑/歌曲\n归属：${modeLabel}`,
    hint: '建议先备份重要文件。此操作会物理移动文件。',
    confirmText: '开始整理',
  })
  if (!ok) return
  organizing.value = true
  organizeResult.value = null
  try {
    const res = await api.library.organize(target, {
      scope: 'files',
      filePaths,
      artistMode: organizeArtistMode.value,
    })
    organizeResult.value = res?.data || {}
    alert(`整理完成：迁移 ${organizeResult.value.moved || 0} 首，跳过 ${organizeResult.value.skipped || 0} 首${organizeResult.value.failed ? `，失败 ${organizeResult.value.failed} 首` : ''}${organizeResult.value.cleanedDirs ? `，清理空目录 ${organizeResult.value.cleanedDirs} 个` : ''}`)
    if (organizeResult.value.moved) {
      selectedPaths.value = new Set()
      orgPickedFiles.value = new Set()
      dupScanned.value = false
      dupResult.value = { groupCount: 0, fileCount: 0, groups: [] }
      // 强制全量重载音乐库：确保新旧记录一致、歌手列表/清理列表同步
      try {
        await reloadLibraryTracksFromServer(api)
      } catch {}
    }
  } catch (e) {
    if (e.message) alert(e.message)
    else alert('整理失败')
  } finally {
    organizing.value = false
  }
}
</script>

<style scoped>
.file-manager-page {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  padding: 4px 0 32px;
}
.file-manager-page.fm-embed-tag {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding-bottom: 0;
  overflow: hidden;
}
.file-manager-page.fm-embed-tag > .fm-head {
  flex-shrink: 0;
}
.file-manager-page.fm-embed-tag > .fm-shell {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.file-manager-page.fm-embed-tag > .fm-shell > .fm-tabs {
  flex-shrink: 0;
}
.file-manager-page.fm-embed-tag .fm-shell-body {
  flex: 1 1 0;
  min-height: 0;
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.fm-tag-host {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.fm-tag-host :deep(.tag-page) {
  flex: 1 1 0;
  height: auto;
  max-height: 100%;
  min-height: 0;
}
.fm-tag-host :deep(.tag-layout) {
  min-width: 0;
}

/* 窄屏：取消固定高度嵌入，避免父级 height:auto 时 flex:1 塌成空白页 */
@media (max-width: 1100px) {
  .file-manager-page.fm-embed-tag {
    height: auto;
    min-height: 0;
    max-width: 100%;
    overflow-x: clip;
    overflow-y: visible;
    display: block;
    padding-bottom: 24px;
  }
  .file-manager-page.fm-embed-tag > .fm-shell {
    flex: none;
    height: auto;
    display: block;
    overflow: visible;
  }
  .file-manager-page.fm-embed-tag .fm-shell-body {
    flex: none;
    height: auto;
    overflow: visible;
    padding: 12px 14px 16px;
    display: block;
  }
  .fm-tag-host {
    flex: none;
    height: auto;
    min-height: 0;
    min-width: 0;
    max-width: 100%;
    overflow-x: clip;
    overflow-y: visible;
    display: block;
  }
  .fm-tag-host :deep(.tag-page) {
    flex: none;
    height: auto;
    max-height: none;
    min-height: 0;
    max-width: 100%;
    overflow-x: clip;
    overflow-y: visible;
  }
  .fm-tag-host :deep(.tag-layout) {
    grid-template-columns: minmax(0, 1fr);
    max-width: 100%;
    min-width: 0;
    overflow-x: clip;
    overflow-y: visible;
    min-height: auto;
  }
}

.fm-head {
  margin-bottom: 16px;
}
.fm-head h2 {
  margin: 0 0 6px;
  font-size: 20px;
}
.fm-desc {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}
.fm-shell {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-card);
  overflow: hidden;
  min-width: 0;
}
.fm-shell-body {
  padding: 16px 18px 20px;
  background: var(--bg-card);
  min-width: 0;
}
.fm-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
  margin: 0;
  padding: 8px 10px 0;
  max-width: 100%;
  min-width: 0;
  background: var(--bg-hover);
  border-bottom: 1px solid var(--border);
}
.fm-tab {
  border: none;
  background: transparent;
  padding: 8px 16px;
  font-size: 13px;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 10px 10px 0 0;
  flex: 0 1 auto;
  white-space: nowrap;
  line-height: 1.3;
}
.fm-tab:hover {
  color: var(--text);
  background: color-mix(in srgb, var(--bg-card) 55%, transparent);
}
.fm-tab.active {
  color: var(--text);
  background: var(--bg-card);
  font-weight: 600;
  margin-bottom: -1px;
  padding-bottom: 9px;
}
.clean-subtabs {
  display: inline-flex;
  gap: 4px;
  margin: 0 0 14px;
  padding: 3px;
  border-radius: 999px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
}
.clean-subtab {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  padding: 6px 14px;
  border-radius: 999px;
  cursor: pointer;
}
.clean-subtab.active {
  color: var(--text);
  background: var(--bg-card, var(--bg));
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  font-weight: 600;
}
.small-toolbar {
  align-items: center;
}
.small-threshold {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
}
.small-threshold-input {
  width: 72px;
  height: 34px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 13px;
}
.small-threshold-unit {
  flex: 0 0 auto;
}
.small-threshold-unit :deep(.app-select-trigger) {
  height: 34px;
  min-height: 34px;
  border-radius: 8px;
}
.fm-panel {
  min-width: 0;
}
.fm-panel-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}
.fm-summary {
  font-size: 13px;
  color: var(--text-muted);
}
.fm-batch-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}
.fm-tip {
  margin: 0 0 16px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.5;
}
.fm-toast {
  position: fixed;
  bottom: 80px;
  right: 24px;
  padding: 10px 20px;
  border-radius: var(--radius);
  font-size: 14px;
  z-index: 1000;
  box-shadow: var(--shadow);
}
.fm-toast.success { background: var(--success); color: #fff; }
.fm-toast.error { background: var(--error); color: #fff; }
.fm-toast.info { background: var(--bg-card); border: 1px solid var(--border); }
.fm-empty {
  padding: 32px 0;
  color: var(--text-muted);
  font-size: 14px;
  text-align: center;
  background: var(--bg-hover);
  border-radius: 10px;
}
.dup-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.dup-group {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-card);
}
.dup-group-title {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--bg-hover);
  font-size: 14px;
}
.dup-group-title strong {
  font-size: 14px;
}
.dup-group-title span {
  color: var(--text-muted);
  font-size: 13px;
}
.dup-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
  background: var(--bg);
  padding: 2px 8px;
  border-radius: 10px;
}
.dup-files {
  list-style: none;
  margin: 0;
  padding: 0;
}
.dup-file-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  font-size: 13px;
}
.dup-file-row:hover {
  background: var(--bg-hover);
}
.dup-check {
  display: inline-flex;
  align-items: center;
  margin-top: 2px;
}
.dup-check input {
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
  cursor: pointer;
}
.dup-file-label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dup-file-primary {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.dup-name,
.dup-path {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text);
}
.dup-filepath {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1.35;
  color: var(--text-muted);
}
.dup-size {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}
.fake-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dup-meta {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}
.dup-file-actions {
  display: flex;
  gap: 6px;
  margin-top: 1px;
  white-space: nowrap;
}
.fm-hint {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
}
.fake-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-card);
}
.fake-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border-top: 1px solid var(--border);
  font-size: 13px;
}
.fake-row:first-child {
  border-top: none;
}
.fake-row:hover {
  background: var(--bg-hover);
}
.fake-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.fake-reason {
  font-size: 12px;
  color: var(--text-muted);
}

/* 整理 */
/* 左右分栏：左目录树 + 右文件列表 */
.org-layout {
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
  gap: 16px;
  margin-bottom: 18px;
  min-width: 0;
  align-items: stretch;
}
.org-dir-panel,
.org-file-panel {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  max-height: 520px;
}
.org-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-shrink: 0;
}
.org-panel-title {
  font-size: 14px;
  font-weight: 600;
}
.org-picker-empty,
.org-picker-loading {
  padding: 24px 8px;
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.org-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 0;
}
.org-tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 5px 10px 5px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.org-tree-row:hover {
  background: var(--bg-hover);
}
.org-tree-row.active {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.org-tree-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: transform 0.15s ease;
}
.org-tree-toggle.open {
  transform: rotate(90deg);
}
.org-tree-folder {
  color: var(--accent);
  flex-shrink: 0;
}
.org-tree-label {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spin {
  animation: org-spin 0.8s linear infinite;
}
@keyframes org-spin {
  to { transform: rotate(360deg); }
}

/* 文件勾选区 */
.org-file-panel {
  min-width: 0;
}
.org-current-dir {
  padding: 6px 10px;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}
.org-files-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.org-check-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.org-check-all input {
  accent-color: var(--accent);
}
.org-count {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}
.org-file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.org-file-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  min-width: 0;
}
.org-file-label:hover {
  background: var(--bg-hover);
}
.org-file-label input {
  accent-color: var(--accent);
  flex-shrink: 0;
}
.org-file-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 已选文件汇总（跨文件夹累计） */
.org-picked-summary {
  margin-top: 12px;
  border: 1px solid var(--accent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 6%, var(--bg-card));
  overflow: hidden;
}
.org-picked-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-card));
  font-size: 13px;
}
.org-picked-list {
  list-style: none;
  margin: 0;
  padding: 6px 12px;
  max-height: 150px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
.org-picked-list code {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}
.org-picked-more {
  margin: 0;
  padding: 0 12px 8px;
  font-size: 11px;
  color: var(--text-muted);
}

.org-form {
  max-width: 640px;
}
.org-form h3 {
  margin: 0 0 8px;
  font-size: 16px;
}
.org-desc {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.6;
}
.org-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}
.org-field label {
  font-size: 13px;
  color: var(--text);
  font-weight: 500;
}
.org-field .input {
  width: 100%;
  padding: 10px 12px;
  font-size: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text);
}
.org-field .input:focus {
  outline: none;
  border-color: var(--accent);
}
.org-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
}
.org-actions {
  display: flex;
  gap: 10px;
}
.org-result {
  margin-top: 24px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  background: var(--bg-card);
}
.org-result h3 {
  margin: 0 0 10px;
  font-size: 16px;
}
.org-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin: 0 0 8px;
  font-size: 14px;
}
.org-summary strong {
  color: var(--text);
}
.org-summary strong.text-danger {
  color: var(--danger);
}
.org-target-done {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--text-muted);
}
.org-target-done code {
  word-break: break-all;
}
.org-failed,
.org-moved {
  margin-top: 14px;
}
.org-failed h4,
.org-moved h4 {
  margin: 0 0 8px;
  font-size: 14px;
}
.org-moved-count {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.org-failed ul,
.org-moved ul {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 260px;
  overflow: auto;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.org-failed li {
  color: var(--danger);
  word-break: break-all;
}
.org-moved li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  word-break: break-all;
}
.org-from {
  color: var(--text-muted);
  flex: 1;
  min-width: 0;
}
.org-arrow {
  color: var(--text-muted);
  flex-shrink: 0;
}
.org-to {
  flex: 1;
  min-width: 0;
  color: var(--text);
}

/* 窄屏：左右分栏改为上下堆叠；清理列表纵向排版 */
@media (max-width: 768px) {
  .org-layout {
    grid-template-columns: 1fr;
  }
  .org-dir-panel,
  .org-file-panel {
    max-height: none;
  }
  .org-tree {
    max-height: 220px;
  }
  .org-file-list {
    max-height: 260px;
  }

  .fm-panel-toolbar {
    align-items: stretch;
  }
  .fm-batch-actions {
    margin-left: 0;
    width: 100%;
  }
  .fm-batch-actions .btn-ghost {
    flex: 1 1 auto;
    min-width: 0;
  }
  .small-threshold {
    width: 100%;
  }
  .dup-group-title {
    flex-wrap: wrap;
    gap: 6px 10px;
  }
  .dup-count {
    margin-left: 0;
  }
  .dup-file-row {
    flex-wrap: wrap;
    gap: 8px 10px;
    padding: 10px 12px;
  }
  .dup-file-label {
    flex: 1 1 calc(100% - 28px);
  }
  .dup-file-primary {
    flex-wrap: wrap;
    gap: 4px 8px;
  }
  .dup-name {
    flex: 1 1 100%;
    white-space: normal;
    word-break: break-word;
  }
  .dup-filepath {
    white-space: normal;
    word-break: break-all;
    line-height: 1.4;
  }
  .dup-file-actions {
    flex: 1 1 100%;
    margin-top: 0;
    padding-left: 25px;
    box-sizing: border-box;
  }
  .dup-file-actions .btn-ghost {
    flex: 1;
    min-width: 0;
  }
  .fake-row {
    flex-wrap: wrap;
    gap: 8px 10px;
  }
  .fake-main {
    flex: 1 1 calc(100% - 28px);
  }
  .fake-row > .dup-meta {
    order: 3;
  }
  .fake-row > .btn-ghost,
  .fake-row > .dup-file-actions {
    flex: 1 1 100%;
    order: 4;
    margin-left: 25px;
    width: auto;
    box-sizing: border-box;
  }
  .fake-row > .dup-file-actions {
    padding: 0;
  }
  .fake-row > .dup-file-actions .btn-ghost {
    flex: 1;
    min-width: 0;
  }
}
</style>