<template>
  <section class="page" data-module="waterquality">
    <header class="page-head">
      <div>
        <h2>水质检测管理</h2>
        <p class="page-desc">
          水质检测报告按采样组、检测组划分实验室归属：采样员只能补录本组样本，检测员仅能出具结果，复核人可退回但不能改原始读数。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出水质检测清单</button>
      </div>
    </header>

    <div class="identity-bar">
      <span>
        当前岗位：<strong>{{ staff.name }}</strong>
        （{{ roleLabels[staff.role] }} · {{ staff.group }}）
      </span>
      <span class="identity-hint">{{ roleHints[staff.role] }}</span>
      <label class="identity-switch">
        切换岗位
        <select :value="session.staffName" @change="onSwitchStaff">
          <option v-for="person in staffDirectory" :key="person.name" :value="person.name">
            {{ person.name }} · {{ roleLabels[person.role] }} · {{ person.group }}
          </option>
        </select>
      </label>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
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
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
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
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in rowActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openDrawer(row)">详情</button>
            <span v-if="!rowActions(row).length" class="muted">本岗位无可用动作</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无水质检测数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条水质检测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="activeReport" class="drawer-mask" @click.self="closeDrawer">
      <aside class="drawer">
        <header class="drawer-head">
          <h3>报告 {{ activeReport['报告编号'] }}</h3>
          <button class="link" type="button" @click="closeDrawer">关闭</button>
        </header>

        <dl class="detail-grid">
          <template v-for="item in detailItems" :key="item.label">
            <dt>{{ item.label }}</dt>
            <dd>{{ item.value || '—' }}</dd>
          </template>
        </dl>

        <section class="drawer-section">
          <h4>归属历史（跨组转派只增不改）</h4>
          <ul v-if="ownershipHistory.length" class="history-list">
            <li v-for="(record, index) in ownershipHistory" :key="index">
              {{ record.时间 }} · {{ record.操作人 }}：{{ record.原检测组 }} → {{ record.新检测组 }}
              （{{ record.备注 }}）
            </li>
          </ul>
          <p v-else class="muted">暂无转派记录，报告仍归属初始检测组。</p>
        </section>

        <form v-if="can('补录样本')" class="drawer-section" @submit.prevent="submitSupplement">
          <h4>补录样本（采样员 · 本组）</h4>
          <label>采样时间 <input v-model="supplementForm.采样时间" placeholder="2026-10-03" /></label>
          <label>检测项目 <input v-model="supplementForm.检测项目" /></label>
          <label>标准上限 <input v-model="supplementForm.标准上限" /></label>
          <button class="btn primary" type="submit">保存补录</button>
        </form>

        <form v-if="can('出具结果')" class="drawer-section" @submit.prevent="submitIssue">
          <h4>出具检测结果（检测员 · 本组）</h4>
          <label>原始读数（检测值）<input v-model="issueForm.检测值" required /></label>
          <label>检测结论 <input v-model="issueForm.检测结论" /></label>
          <button class="btn primary" type="submit">出具结果</button>
        </form>

        <template v-if="isReviewer">
          <section v-if="can('复核通过')" class="drawer-section">
            <h4>复核结论（复核入口二）</h4>
            <p class="muted">原始读数：{{ activeReport['检测值'] || '—' }}（复核人不可修改）</p>
            <textarea v-model="reviewConclusion" rows="2" placeholder="填写复核结论，默认「复核通过」"></textarea>
            <button class="btn primary" type="button" @click="submitReviewFromDrawer">
              提交复核结论
            </button>
          </section>

          <form v-if="can('退回检测')" class="drawer-section" @submit.prevent="submitReturn">
            <h4>退回检测</h4>
            <p class="muted">退回后中间结论清空、状态回到检测中，原始读数保留。</p>
            <label>退回原因 <input v-model="returnReason" required /></label>
            <button class="btn" type="submit">退回</button>
          </form>

          <form v-if="can('跨组转派')" class="drawer-section" @submit.prevent="submitReassign">
            <h4>跨组转派</h4>
            <label>
              目标检测组
              <select v-model="reassignTarget">
                <option v-for="group in testGroups" :key="group" :value="group">{{ group }}</option>
              </select>
            </label>
            <button class="btn" type="submit">转派</button>
          </form>
        </template>

        <p v-if="drawerMessage" class="error-text">{{ drawerMessage }}</p>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'

import {
  availableActions,
  issueResult,
  listLabReports,
  parseOwnershipHistory,
  reassignGroup,
  returnReport,
  startTesting,
  submitReview,
  supplementSample,
} from '@/api/lab-service'
import { downloadEntries } from '@/api/local-service'
import { LAB_ROLE_HINTS, LAB_ROLE_LABELS, LAB_STAFF, TEST_GROUPS } from '@/data/lab-directory'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const columns = ['报告编号', '采样站点', '采样时间', '检测项目', '检测值', '标准上限', '采样组', '检测组', '检测人']
const statuses = ['已采样', '检测中', '已出报告', '超标', '已复核']
const filterFields = columns.slice(0, 3)

const session = useSessionStore()
const route = useRoute()
const staffDirectory = LAB_STAFF
const testGroups = TEST_GROUPS
const roleLabels = LAB_ROLE_LABELS
const roleHints = LAB_ROLE_HINTS

const staff = computed(() => session.labStaff)
const isReviewer = computed(() => staff.value.role === 'reviewer')

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const activeReport = ref<EntryRow | null>(null)
const drawerMessage = ref('')
const supplementForm = reactive({ 采样时间: '', 检测项目: '', 标准上限: '' })
const issueForm = reactive({ 检测值: '', 检测结论: '' })
const reviewConclusion = ref('')
const returnReason = ref('')
const reassignTarget = ref(TEST_GROUPS[0])

const stats = computed(() => [
  { label: '报告总数', value: rows.value.length },
  { label: '超标报告数', value: rows.value.filter((row) => row.status === '超标').length },
  {
    label: '待复核报告',
    value: rows.value.filter((row) => row.status === '已出报告' || row.status === '超标').length,
  },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const detailItems = computed(() => {
  const row = activeReport.value
  if (!row) {
    return []
  }
  return [
    { label: '报告编号', value: row['报告编号'] },
    { label: '采样站点', value: row['采样站点'] },
    { label: '采样时间', value: row['采样时间'] },
    { label: '检测项目', value: row['检测项目'] },
    { label: '原始读数（检测值）', value: row['检测值'] },
    { label: '标准上限', value: row['标准上限'] },
    { label: '采样人 / 采样组', value: `${row['采样人'] || '—'} / ${row['采样组']}` },
    { label: '检测组', value: row['检测组'] },
    { label: '检测人', value: row['检测人'] },
    { label: '检测结论', value: row['检测结论'] },
    { label: '复核人', value: row['复核人'] },
    { label: '复核结论', value: row['复核结论'] },
    { label: '退回原因', value: row['退回原因'] },
    { label: '当前状态', value: row.status },
  ]
})

const ownershipHistory = computed(() =>
  activeReport.value ? parseOwnershipHistory(activeReport.value) : [],
)

function rowActions(row: EntryRow): string[] {
  return availableActions(row, staff.value)
}

function can(action: string): boolean {
  return activeReport.value ? availableActions(activeReport.value, staff.value).includes(action) : false
}

function onSwitchStaff(event: Event) {
  session.switchStaff((event.target as HTMLSelectElement).value)
  closeDrawer()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '开始检测') {
    const result = startTesting(Number(row.id), staff.value)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    reload()
    return
  }
  if (action === '复核通过') {
    // 复核入口一：行内直接落结论；与抽屉里的入口二共用同一个幂等提交。
    const result = submitReview(Number(row.id), '复核通过', staff.value)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    reload()
    return
  }
  openDrawer(row)
}

function openDrawer(row: EntryRow) {
  activeReport.value = row
  drawerMessage.value = ''
  reviewConclusion.value = ''
  returnReason.value = ''
  reassignTarget.value = TEST_GROUPS.find((group) => group !== row['检测组']) ?? TEST_GROUPS[0]
  supplementForm.采样时间 = String(row['采样时间'] ?? '')
  supplementForm.检测项目 = String(row['检测项目'] ?? '')
  supplementForm.标准上限 = String(row['标准上限'] ?? '')
  issueForm.检测值 = String(row['检测值'] ?? '')
  issueForm.检测结论 = ''
}

function closeDrawer() {
  activeReport.value = null
  drawerMessage.value = ''
}

function handleResult(result: { ok: boolean; message: string }) {
  if (!result.ok) {
    drawerMessage.value = result.message
    return
  }
  closeDrawer()
  reload()
}

function submitSupplement() {
  if (!activeReport.value) return
  handleResult(supplementSample(Number(activeReport.value.id), { ...supplementForm }, staff.value))
}

function submitIssue() {
  if (!activeReport.value) return
  handleResult(issueResult(Number(activeReport.value.id), { ...issueForm }, staff.value))
}

function submitReviewFromDrawer() {
  if (!activeReport.value) return
  handleResult(submitReview(Number(activeReport.value.id), reviewConclusion.value, staff.value))
}

function submitReturn() {
  if (!activeReport.value) return
  handleResult(returnReport(Number(activeReport.value.id), returnReason.value, staff.value))
}

function submitReassign() {
  if (!activeReport.value) return
  handleResult(reassignGroup(Number(activeReport.value.id), reassignTarget.value, staff.value))
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries('waterquality')
}

function reload() {
  errorMessage.value = ''
  try {
    const items = listLabReports(filters.value)
    rows.value = items
    total.value = items.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '水质检测列表读取失败'
  }
}

onMounted(() => {
  // 预警页核查清单带报告编号跳过来时，直接按编号过滤出那份报告。
  const code = route.query['报告编号']
  if (typeof code === 'string' && code) {
    filters.value = { 报告编号: code }
  }
  reload()
})
</script>
