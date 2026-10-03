<template>
  <section class="page" data-module="warning">
    <header class="page-head">
      <div>
        <h2>预警阈值管理</h2>
        <p class="page-desc">维护预警阈值配置，围绕配置编号、站点编号、监测类型、蓝色阈值做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记预警阈值配置</button>
        <button class="btn" type="button" @click="exportRows">导出预警阈值清单</button>
      </div>
    </header>

    <div class="identity-bar">
      <span class="identity-label">当前身份</span>
      <select :value="store.operator" @change="switchIdentity">
        <option v-for="staff in staffDirectory" :key="staff.name" :value="staff.name">
          {{ staff.name }} · {{ roleLabelOf(staff.role) }} · {{ staff.group }}
        </option>
      </select>
      <span class="identity-hint">水质复核产生的待核查项由复核人在此核查关闭。</span>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <!-- 挂接水质检测报告的预警核查清单 -->
    <div class="checklist-block">
      <div class="checklist-head">
        <h3>水质复核预警核查清单</h3>
        <span class="page-desc">复核完成的水质检测报告自动挂到这里，同一报告同一复核轮次只生成一条。</span>
      </div>
      <div class="checklist-filter">
        <label class="filter-check"><input v-model="showClosed" type="checkbox" @change="loadChecklist" /> 显示已核查</label>
        <button class="btn ghost" type="button" @click="loadChecklist">刷新清单</button>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>预警级别</th><th>报告编号</th><th>采样站点</th><th>检测项目</th>
            <th>检测值/上限</th><th>检测结论</th><th>复核人</th><th>复核轮次</th>
            <th>产生时间</th><th>核查状态</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in checklist" :key="item.id">
            <td><span :class="['level-tag', item.level === '橙色' ? 'level-orange' : 'level-blue']">{{ item.level }}</span></td>
            <td>
              <button class="link" type="button" @click="openReport(item)">{{ item.报告编号 }}</button>
            </td>
            <td>{{ item.采样站点 }}</td>
            <td>{{ item.检测项目 }}</td>
            <td>{{ item.检测值 }} / {{ item.标准上限 }}</td>
            <td><span :class="{ 'conclusion-bad': item.检测结论 === '超标' }">{{ item.检测结论 }}</span></td>
            <td>{{ item.复核人 }}</td>
            <td>第{{ item.复核轮次 }}轮</td>
            <td>{{ item.产生时间 }}</td>
            <td>
              {{ item.状态 }}
              <div v-if="item.核查时间" class="verify-meta">{{ item.核查时间 }} ｜ {{ item.核查人 }}</div>
              <div v-if="item.核查说明" class="verify-meta">{{ item.核查说明 }}</div>
            </td>
            <td class="row-actions">
              <button class="link" type="button" @click="openReport(item)">查看报告</button>
              <button v-if="item.状态 === '待核查'" class="link" type="button" @click="verifyItem(item)">
                {{ store.isReviewer ? '核查关闭' : '仅复核人可核查' }}
              </button>
            </td>
          </tr>
          <tr v-if="!checklist.length">
            <td colspan="11" class="empty-state">暂无待核查项；水质报告复核通过后会自动出现在这里</td>
          </tr>
        </tbody>
      </table>
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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无预警阈值数据，可先登记预警阈值配置</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条预警阈值记录 ｜ 待核查 {{ checklist.filter((item) => item.状态 === '待核查').length }} 项</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { useSessionStore } from '@/stores/session'
import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { ROLE_LABEL, STAFF_DIRECTORY } from '@/data/water-quality/staff'
import type { Staff, WarningChecklistItem } from '@/data/water-quality/types'
import { listWarningChecklist, verifyChecklistItem } from '@/data/water-quality/service'

const store = useSessionStore()
const router = useRouter()
const staffDirectory = STAFF_DIRECTORY

const meta = moduleMeta('warning')
const columns = ["配置编号", "站点编号", "监测类型", "蓝色阈值", "黄色阈值", "橙色阈值", "红色阈值", "生效状态"]
const actions = ["发布生效", "调整阈值", "停用配置"]
const statuses = ["草稿", "已生效", "已调整", "已停用"]
const stats = ref([{ label: "待核查水质预警", value: 0 }, { label: "橙色超标预警", value: 0 }, { label: "已核查", value: 0 }])

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const checklist = ref<WarningChecklistItem[]>([])
const showClosed = ref(false)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function roleLabelOf(role: Staff['role']) {
  return ROLE_LABEL[role]
}

function switchIdentity(event: Event) {
  const name = (event.target as HTMLSelectElement).value
  const staff = staffDirectory.find((item) => item.name === name)
  if (staff) {
    store.switchIdentity(staff)
  }
}

function loadChecklist() {
  checklist.value = listWarningChecklist(showClosed.value)
  stats.value = [
    { label: "待核查水质预警", value: checklist.value.filter((item) => item.状态 === '待核查').length },
    { label: "橙色超标预警", value: checklist.value.filter((item) => item.level === '橙色' && item.状态 === '待核查').length },
    { label: "已核查", value: listWarningChecklist(true).filter((item) => item.状态 === '已核查').length },
  ]
}

/** 挂接回水质检测报告页，并定位到对应报告打开详情。 */
function openReport(item: WarningChecklistItem) {
  router.push({ path: '/waterquality', query: { report: String(item.报告Id) } })
}

function verifyItem(item: WarningChecklistItem) {
  if (!store.isReviewer) {
    errorMessage.value = '只有复核人可以核查关闭水质预警项'
    return
  }
  const note = window.prompt(`请填写核查说明（报告 ${item.报告编号}）`)
  if (note === null) {
    return
  }
  const result = verifyChecklistItem(
    { name: store.operator, role: store.role, group: store.group },
    item.id,
    note,
  )
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = ''
  loadChecklist()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '预警阈值配置登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    loadChecklist()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '预警阈值列表读取失败'
  }
}

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
.identity-bar select { padding: 4px 8px; min-width: 300px; }
.identity-label { color: var(--muted); }
.identity-hint { color: var(--muted); font-size: 12px; }
.checklist-block {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
}
.checklist-head h3 { margin: 0 0 4px; font-size: 15px; }
.checklist-filter { display: flex; align-items: center; gap: 12px; margin: 8px 0; font-size: 13px; }
.filter-check { display: flex; align-items: center; gap: 4px; }
.level-tag { border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.level-blue { background: #e0edff; color: #1d4ed8; }
.level-orange { background: #ffedd5; color: #c2410c; }
.conclusion-bad { color: #b42318; font-weight: 600; }
.verify-meta { color: var(--muted); font-size: 11px; }
</style>
