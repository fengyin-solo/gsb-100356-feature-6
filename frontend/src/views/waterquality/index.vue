<template>
  <section class="page" data-module="waterquality">
    <header class="page-head">
      <div>
        <h2>水质检测管理</h2>
        <p class="page-desc">
          采样站点人员补录本组样本并送检、发起复核；检测项目人员仅出具结果；复核人可退回但不能改原始读数。
        </p>
      </div>
      <div class="page-actions">
        <button v-if="store.isSampler" class="btn primary" type="button" @click="openCreate">补录本组样本</button>
        <button class="btn" type="button" @click="exportRows">导出水质检测清单</button>
      </div>
    </header>

    <div class="identity-bar">
      <span class="identity-label">当前身份</span>
      <select :value="store.operator" @change="switchIdentity">
        <option v-for="staff in staffDirectory" :key="staff.name" :value="staff.name">
          {{ staff.name }} · {{ roleLabelOf(staff.role) }} · {{ staff.group }}{{ staff.station ? `（${staff.station}）` : '' }}
        </option>
      </select>
      <span class="identity-hint">
        角色：{{ store.roleLabel }} ｜ 所属：{{ store.group }}
        <template v-if="store.isSampler">｜仅能操作「{{ store.group }}」样本</template>
        <template v-else-if="store.isAnalyst">｜仅能为「{{ store.group }}」样本出具结果</template>
        <template v-else>｜可复核任意组报告，原始读数只读</template>
      </span>
    </div>

    <div class="stat-row">
      <article v-for="item in metrics" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>报告编号</span>
        <input v-model="filters['报告编号']" placeholder="按报告编号检索" />
      </label>
      <label class="filter-item">
        <span>采样站点</span>
        <input v-model="filters['采样站点']" placeholder="按采样站点检索" />
      </label>
      <label class="filter-item">
        <span>检测项目</span>
        <input v-model="filters['检测项目']" placeholder="按检测项目检索" />
      </label>
      <label class="filter-item">
        <span>状态</span>
        <select v-model="statusFilter">
          <option value="">全部状态</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <label class="filter-check" v-if="!store.isReviewer">
        <input v-model="scopeOnly" type="checkbox" />
        <span>只看{{ store.isSampler ? '本组' : '本检测组' }}报告</span>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in visibleRows" :key="row.id">
          <td>{{ row.报告编号 }}</td>
          <td>{{ row.采样站点 }}</td>
          <td>{{ row.检测项目 }}</td>
          <td><span :title="`原始读数由采样人${row.采样人}补录，全程不可修改`">{{ row.原始读数 }}</span></td>
          <td>{{ row.标准上限 }}</td>
          <td>
            <span :class="{ 'conclusion-bad': row.检测结论 === '超标' }">{{ row.检测值 ?? '—' }}</span>
          </td>
          <td>{{ row.采样人 }}/{{ row.采样组 }}</td>
          <td>
            {{ effectiveLabGroup(row) }}
            <span v-if="!row.检测组" class="compat-tag" title="旧报告缺检测组，按采样人归属兼容">兼容归属</span>
            <span v-if="row.ownershipHistory.length" class="transfer-tag" title="存在跨组转派历史">转派{{ row.ownershipHistory.length }}次</span>
          </td>
          <td>
            <span v-if="row.复核结论" :class="{ 'conclusion-bad': false }">{{ row.复核结论 }}</span>
            <span v-else>—</span>
          </td>
          <td>{{ row.status }}<span v-if="row.复核轮次" class="round-tag">第{{ row.复核轮次 }}轮</span></td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <template v-for="action in actionsFor(row)" :key="action">
              <button class="link" type="button" @click="runAction(action, row)">{{ action }}</button>
            </template>
          </td>
        </tr>
        <tr v-if="!visibleRows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无符合条件的水质检测报告</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ visibleRows.length }} 条报告 ｜ 原始读数一经补录不可修改；跨组转派历史归属永久保留</span>
      <span v-if="message" class="ok-text">{{ message }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 补录样本 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <div class="modal">
        <h3>补录本组样本</h3>
        <p class="modal-tip">补录即归属「{{ store.group }}」，采样人记为 {{ store.operator }}。原始读数录入后任何环节都不能修改。</p>
        <label class="form-line"><span>采样站点</span><input v-model="createForm.采样站点" :placeholder="store.station || '请输入采样站点'" /></label>
        <label class="form-line"><span>采样时间</span><input v-model="createForm.采样时间" placeholder="留空取当前时间" /></label>
        <label class="form-line"><span>检测项目</span><input v-model="createForm.检测项目" placeholder="如：氨氮 / 镉" /></label>
        <label class="form-line"><span>原始读数</span><input v-model.number="createForm.原始读数" type="number" step="0.001" /></label>
        <label class="form-line"><span>标准上限</span><input v-model.number="createForm.标准上限" type="number" step="0.001" /></label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="createOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">确认补录</button>
        </div>
      </div>
    </div>

    <!-- 出具结果 -->
    <div v-if="resultTarget" class="modal-mask" @click.self="resultTarget = null">
      <div class="modal">
        <h3>出具检测结果 · {{ resultTarget.报告编号 }}</h3>
        <p class="modal-tip">
          {{ resultTarget.检测项目 }}，原始读数 <strong>{{ resultTarget.原始读数 }}</strong>（只读），标准上限 {{ resultTarget.标准上限 }}。
          检测项目人员仅能出具结果，不能修改原始读数。
        </p>
        <label class="form-line"><span>检测值</span><input v-model.number="resultValue" type="number" step="0.001" /></label>
        <p class="modal-tip">系统将按标准上限自动判定「合格 / 超标」。</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="resultTarget = null">取消</button>
          <button class="btn primary" type="button" @click="submitResult">出具报告</button>
        </div>
      </div>
    </div>

    <!-- 跨组转派 -->
    <div v-if="transferTarget" class="modal-mask" @click.self="transferTarget = null">
      <div class="modal">
        <h3>跨组转派 · {{ transferTarget.报告编号 }}</h3>
        <p class="modal-tip">
          当前检测归属「{{ effectiveLabGroup(transferTarget) }}」。转派后只改当前检测组，原归属会追加保留在归属历史中，不覆盖。
        </p>
        <label class="form-line">
          <span>转入检测组</span>
          <select v-model="transferGroup">
            <option v-for="group in transferTargets" :key="group" :value="group">{{ group }}</option>
          </select>
        </label>
        <label class="form-line"><span>转派原因</span><textarea v-model="transferReason" rows="3" placeholder="必填，写明转派原因用于留痕"></textarea></label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="transferTarget = null">取消</button>
          <button class="btn primary" type="button" @click="submitTransfer">确认转派</button>
        </div>
      </div>
    </div>

    <!-- 详情 + 复核入口一：详情弹窗内提交 -->
    <div v-if="detail" class="modal-mask wide" @click.self="detail = null">
      <div class="modal wide-modal">
        <h3>报告详情 · {{ detail.报告编号 }}</h3>
        <div class="detail-grid">
          <span>采样站点</span><b>{{ detail.采样站点 }}</b>
          <span>采样时间</span><b>{{ detail.采样时间 }}</b>
          <span>检测项目</span><b>{{ detail.检测项目 }}</b>
          <span>原始读数</span><b>{{ detail.原始读数 }} <em class="readonly-tag">不可修改</em></b>
          <span>标准上限</span><b>{{ detail.标准上限 }}</b>
          <span>采样人 / 采样组</span><b>{{ detail.采样人 }} / {{ detail.采样组 }}</b>
          <span>当前检测组</span><b>{{ effectiveLabGroup(detail) }}<template v-if="!detail.检测组">（旧报告按采样人兼容）</template></b>
          <span>检测值 / 结论</span><b>{{ detail.检测值 ?? '—' }} / {{ detail.检测结论 ?? '—' }}</b>
          <span>检测人 / 出具时间</span><b>{{ detail.检测人 ?? '—' }} / {{ detail.出具时间 ?? '—' }}</b>
          <span>复核轮次</span><b>第 {{ detail.复核轮次 }} 轮</b>
          <span>复核人 / 结论</span><b>{{ detail.复核人 ?? '—' }} / {{ detail.复核结论 ?? '—' }}</b>
          <span>复核意见</span><b>{{ detail.复核意见 ?? '—' }}</b>
        </div>

        <div v-if="detail.ownershipHistory.length" class="trace-block">
          <h4>归属历史（跨组转派只追加，不覆盖）</h4>
          <ul>
            <li v-for="(item, idx) in detail.ownershipHistory" :key="idx">
              {{ item.time }} ｜ {{ item.fromGroup }} → {{ item.toGroup }} ｜ {{ item.operator }} ｜ {{ item.reason }}
            </li>
          </ul>
        </div>

        <div class="trace-block">
          <h4>流转记录</h4>
          <ul>
            <li v-for="(item, idx) in detail.flow" :key="idx">
              {{ item.time }} ｜ {{ item.action }}：{{ item.fromStatus }} → {{ item.toStatus }} ｜ {{ item.operator }}<template v-if="item.note"> ｜ {{ item.note }}</template>
            </li>
          </ul>
        </div>

        <!-- 复核入口一：详情弹窗里的通过 / 退回 -->
        <div v-if="store.isReviewer && detail.status === '待复核'" class="review-box">
          <h4>复核处理（入口一：详情）</h4>
          <textarea v-model="reviewComment" rows="2" placeholder="填写复核意见，通过/退回都必填"></textarea>
          <div class="modal-actions">
            <button class="btn" type="button" @click="submitReviewFromDetail('退回')">复核退回（清空中间结论）</button>
            <button class="btn primary" type="button" @click="submitReviewFromDetail('通过')">复核通过（生成预警待核查项）</button>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="detail = null">关闭</button>
        </div>
      </div>
    </div>

    <!-- 复核入口二：快捷复核弹窗（列表行内「复核通过 / 复核退回」打开） -->
    <div v-if="quickReviewTarget" class="modal-mask" @click.self="quickReviewTarget = null">
      <div class="modal">
        <h3>快捷复核 · {{ quickReviewTarget.报告编号 }}</h3>
        <p class="modal-tip">
          入口二：列表快捷复核。原始读数 {{ quickReviewTarget.原始读数 }} 只读，复核人不能改动；
          与详情入口同时提交只会落一份结论。
        </p>
        <textarea v-model="quickReviewComment" rows="2" placeholder="填写复核意见，通过/退回都必填"></textarea>
        <div class="modal-actions">
          <button class="btn" type="button" @click="submitQuickReview('退回')">复核退回</button>
          <button class="btn primary" type="button" @click="submitQuickReview('通过')">复核通过</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { useSessionStore } from '@/stores/session'
import { ROLE_LABEL, STAFF_DIRECTORY } from '@/data/water-quality/staff'
import {
  TRANSFER_TARGETS,
  createSample,
  effectiveLabGroup,
  exportReportCsv,
  issueResult,
  listReportRows,
  startTesting,
  submitForReview,
  submitReview,
  transferLabGroup,
  waterQualityMetrics,
} from '@/data/water-quality/service'
import type { ReviewDecision, Staff, WaterQualityReport } from '@/data/water-quality/types'

const store = useSessionStore()
const router = useRouter()

/** 把会话状态整理成领域服务需要的人员身份。 */
function currentStaff(): Staff {
  return { name: store.operator, role: store.role, group: store.group, station: store.station }
}

const staffDirectory = STAFF_DIRECTORY
const transferTargets = TRANSFER_TARGETS
const columns = ['报告编号', '采样站点', '检测项目', '原始读数', '标准上限', '检测值', '采样人/采样组', '检测归属', '复核结论']
const statuses = ['已采样', '检测中', '已出报告', '待复核', '已复核']

const rows = ref<WaterQualityReport[]>([])
const metrics = ref(waterQualityMetrics())
const errorMessage = ref('')
const message = ref('')
const filters = ref<Record<string, string>>({ 报告编号: '', 采样站点: '', 检测项目: '' })
const statusFilter = ref('')
const scopeOnly = ref(true)
const detail = ref<WaterQualityReport | null>(null)
const reviewComment = ref('')
const quickReviewTarget = ref<WaterQualityReport | null>(null)
const quickReviewComment = ref('')

// 定位预警页跳转过来的报告
const focusId = ref<number | null>(router.currentRoute.value.query.report ? Number(router.currentRoute.value.query.report) : null)

const createOpen = ref(false)
const createForm = ref({ 采样站点: '', 采样时间: '', 检测项目: '', 原始读数: Number.NaN, 标准上限: Number.NaN })

const resultTarget = ref<WaterQualityReport | null>(null)
const resultValue = ref<number>(Number.NaN)

const transferTarget = ref<WaterQualityReport | null>(null)
const transferGroup = ref(TRANSFER_TARGETS[0])
const transferReason = ref('')

const statusSummary = computed(() =>
  statuses.map((status) => ({ status, count: rows.value.filter((row) => row.status === status).length })),
)

function roleLabelOf(role: Staff['role']) {
  return ROLE_LABEL[role]
}

function switchIdentity(event: Event) {
  const name = (event.target as HTMLSelectElement).value
  const staff = staffDirectory.find((item) => item.name === name)
  if (staff) {
    store.switchIdentity(staff)
    flash(`已切换身份：${staff.name}（${ROLE_LABEL[staff.role]}）`)
  }
}

const visibleRows = computed(() => {
  let list = rows.value
  for (const [field, value] of Object.entries(filters.value)) {
    const keyword = value.trim()
    if (keyword) {
      list = list.filter((row) => String(row[field as keyof WaterQualityReport] ?? '').includes(keyword))
    }
  }
  if (statusFilter.value) {
    list = list.filter((row) => row.status === statusFilter.value)
  }
  if (scopeOnly.value && store.isSampler) {
    list = list.filter((row) => row.采样组 === store.group)
  }
  if (scopeOnly.value && store.isAnalyst) {
    list = list.filter((row) => effectiveLabGroup(row) === store.group)
  }
  return list
})

/** 按角色、状态、归属计算该行可执行的动作；跨组动作根本不渲染，权限在服务层还会再拦一遍。 */
function actionsFor(row: WaterQualityReport): string[] {
  if (store.isSampler) {
    if (row.采样组 !== store.group) {
      return []
    }
    if (row.status === '已采样') {
      return ['开始检测']
    }
    if (row.status === '检测中') {
      return ['跨组转派']
    }
    if (row.status === '已出报告') {
      return ['发起复核']
    }
    return []
  }
  if (store.isAnalyst) {
    if (effectiveLabGroup(row) !== store.group) {
      return []
    }
    if (row.status === '检测中') {
      return ['出具结果']
    }
    return []
  }
  // 复核人：列表行打开快捷复核（入口二），详情里另有入口一。
  if (row.status === '待复核') {
    return ['复核通过', '复核退回']
  }
  return []
}

function flash(text: string) {
  message.value = text
  window.setTimeout(() => {
    if (message.value === text) {
      message.value = ''
    }
  }, 4000)
}

function fail(text: string) {
  errorMessage.value = text
  window.setTimeout(() => {
    if (errorMessage.value === text) {
      errorMessage.value = ''
    }
  }, 5000)
}

function handle<T>(result: { ok: boolean; message: string; data?: T }) {
  if (!result.ok) {
    fail(result.message)
    return false
  }
  flash(result.message)
  return true
}

function resetFilters() {
  filters.value = { 报告编号: '', 采样站点: '', 检测项目: '' }
  statusFilter.value = ''
}

function exportRows() {
  const { filename, content } = exportReportCsv()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function openCreate() {
  createForm.value = {
    采样站点: store.station,
    采样时间: '',
    检测项目: '',
    原始读数: Number.NaN,
    标准上限: Number.NaN,
  }
  createOpen.value = true
}

function submitCreate() {
  const result = createSample(currentStaff(), {
    采样站点: createForm.value.采样站点,
    采样时间: createForm.value.采样时间,
    检测项目: createForm.value.检测项目,
    原始读数: createForm.value.原始读数,
    标准上限: createForm.value.标准上限,
  })
  if (handle(result)) {
    createOpen.value = false
    reload()
  }
}

function openDetail(row: WaterQualityReport) {
  // 始终取最新数据
  detail.value = rows.value.find((item) => item.id === row.id) ?? row
  reviewComment.value = ''
  if (focusId.value === row.id) {
    focusId.value = null
  }
}

function runAction(action: string, row: WaterQualityReport) {
  errorMessage.value = ''
  message.value = ''
  const staff = currentStaff()
  if (action === '开始检测') {
    handle(startTesting(staff, row.id)) && reload()
  } else if (action === '跨组转派') {
    transferTarget.value = row
    transferGroup.value = TRANSFER_TARGETS.find((group) => group !== effectiveLabGroup(row)) ?? TRANSFER_TARGETS[0]
    transferReason.value = ''
  } else if (action === '出具结果') {
    resultTarget.value = row
    resultValue.value = typeof row.原始读数 === 'number' ? row.原始读数 : Number.NaN
  } else if (action === '发起复核') {
    handle(submitForReview(staff, row.id)) && reload()
  } else if (action === '复核通过' || action === '复核退回') {
    quickReviewTarget.value = row
    quickReviewComment.value = ''
  }
}

function submitResult() {
  if (!resultTarget.value) {
    return
  }
  const result = issueResult(currentStaff(), resultTarget.value.id, { 检测值: resultValue.value })
  if (handle(result)) {
    resultTarget.value = null
    reload()
  }
}

function submitTransfer() {
  if (!transferTarget.value) {
    return
  }
  const result = transferLabGroup(
    currentStaff(),
    transferTarget.value.id,
    transferGroup.value,
    transferReason.value,
  )
  if (handle(result)) {
    transferTarget.value = null
    reload()
  }
}

function refreshDetail(id: number) {
  if (detail.value?.id === id) {
    detail.value = rows.value.find((item) => item.id === id) ?? null
  }
}

async function callReview(id: number, decision: ReviewDecision, comment: string) {
  // 两个入口（详情 / 列表快捷）都汇聚到这个唯一提交口：进行中并发合并 + 已落结论幂等。
  const result = await submitReview(currentStaff(), id, decision, comment)
  handle(result)
  reload()
  refreshDetail(id)
  return result.ok
}

async function submitReviewFromDetail(decision: ReviewDecision) {
  if (!detail.value) {
    return
  }
  const id = detail.value.id
  if (await callReview(id, decision, reviewComment.value)) {
    reviewComment.value = ''
  }
}

async function submitQuickReview(decision: ReviewDecision) {
  if (!quickReviewTarget.value) {
    return
  }
  const id = quickReviewTarget.value.id
  if (await callReview(id, decision, quickReviewComment.value)) {
    quickReviewTarget.value = null
    quickReviewComment.value = ''
  }
}

function reload() {
  rows.value = [...listReportRows({})]
  metrics.value = waterQualityMetrics()
  if (focusId.value !== null) {
    const target = rows.value.find((row) => row.id === focusId.value)
    if (target) {
      openDetail(target)
    }
  }
}

// 从预警页「查看报告」跳回：?report=id 定位并自动打开详情。
watch(
  () => router.currentRoute.value.query.report,
  (value) => {
    if (!value) {
      return
    }
    focusId.value = Number(value)
    reload()
  },
)

onMounted(reload)
</script>

<style scoped>
.identity-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 13px;
}
.identity-bar select {
  padding: 4px 8px;
  min-width: 320px;
}
.identity-label { color: var(--muted); }
.identity-hint { color: var(--muted); font-size: 12px; }
.filter-check { display: flex; align-items: center; gap: 4px; font-size: 13px; }
.ok-text { color: #067647; }
.conclusion-bad { color: #b42318; font-weight: 600; }
.compat-tag, .transfer-tag, .round-tag {
  display: inline-block;
  margin-left: 4px;
  font-size: 11px;
  border-radius: 4px;
  padding: 0 6px;
  background: #eef2f7;
  color: var(--muted);
}
.transfer-tag { background: #fff4e5; color: #b54708; }
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  width: 460px;
  max-height: 86vh;
  overflow: auto;
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
}
.modal h3 { margin: 0 0 8px; font-size: 16px; }
.modal-tip { color: var(--muted); font-size: 12px; margin: 6px 0; }
.form-line { display: block; margin: 10px 0; font-size: 13px; }
.form-line span { display: block; color: var(--muted); margin-bottom: 4px; }
.form-line input, .form-line select, .form-line textarea, .review-box textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font: inherit;
}
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.wide-modal { width: 720px; }
.detail-grid {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 6px 12px;
  font-size: 13px;
  margin: 10px 0;
}
.detail-grid span { color: var(--muted); }
.readonly-tag { color: #b42318; font-style: normal; font-size: 11px; margin-left: 6px; }
.trace-block { margin-top: 12px; }
.trace-block h4, .review-box h4 { margin: 0 0 6px; font-size: 13px; }
.trace-block ul { margin: 0; padding-left: 18px; font-size: 12px; color: #334155; }
.trace-block li { margin: 3px 0; }
.review-box { border-top: 1px dashed var(--border); padding-top: 10px; margin-top: 10px; }
</style>
