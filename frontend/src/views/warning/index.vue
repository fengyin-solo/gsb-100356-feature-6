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
      <span>共 {{ total }} 条预警阈值记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section class="check-section">
      <header class="page-head">
        <div>
          <h3>预警核查清单</h3>
          <p class="page-desc">
            水质检测报告复核完成后自动生成待核查项，核查办结后销号；点击报告编号可跳回水质检测页查看原报告。
          </p>
        </div>
        <span class="legend-item">待核查：{{ pendingCheckCount }}</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in checkColumns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in checks" :key="String(item.id)">
            <td v-for="column in checkColumns" :key="column">
              <router-link
                v-if="column === '报告编号'"
                :to="{ path: '/waterquality', query: { 报告编号: String(item['报告编号']) } }"
              >
                {{ item['报告编号'] }}
              </router-link>
              <template v-else>{{ item[column] || '—' }}</template>
            </td>
            <td>{{ item.status }}</td>
            <td class="row-actions">
              <button
                v-if="item.status === '待核查'"
                class="link"
                type="button"
                @click="closeCheck(item)"
              >
                核查办结
              </button>
              <span v-else class="muted">已办结</span>
            </td>
          </tr>
          <tr v-if="!checks.length">
            <td :colspan="checkColumns.length + 2" class="empty-state">
              暂无待核查项，水质报告复核完成后会自动出现在这里
            </td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span v-if="checkMessage" class="error-text">{{ checkMessage }}</span>
      </footer>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { closeWarningCheck, listWarningChecks } from '@/api/lab-service'
import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('warning')
const columns = ["配置编号", "站点编号", "监测类型", "蓝色阈值", "黄色阈值", "橙色阈值", "红色阈值", "生效状态"]
const actions = ["发布生效", "调整阈值", "停用配置"]
const statuses = ["草稿", "已生效", "已调整", "已停用"]
const stats = [{"label": "配置总数", "value": 0}, {"label": "已生效数", "value": 0}, {"label": "本月调整数", "value": 0}]
const checkColumns = ["核查编号", "报告编号", "采样站点", "检测项目", "检测值", "标准上限", "复核结论", "生成时间"]

const session = useSessionStore()
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const checks = ref<EntryRow[]>([])
const checkMessage = ref('')
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const pendingCheckCount = computed(
  () => checks.value.filter((item) => item.status === '待核查').length,
)

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

function closeCheck(item: EntryRow) {
  checkMessage.value = ''
  const result = closeWarningCheck(Number(item.id), session.operator)
  if (!result.ok) {
    checkMessage.value = result.message
    return
  }
  reloadChecks()
}

function reloadChecks() {
  checks.value = listWarningChecks()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '预警阈值列表读取失败'
  }
  reloadChecks()
}

onMounted(reload)
</script>
