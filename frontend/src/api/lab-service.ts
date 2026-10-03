import { LAB_ROLE_LABELS, TEST_GROUPS, groupOfStaff, type LabStaff } from '@/data/lab-directory'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 水质检测报告走独立的实验室流转服务：岗位权限、组归属、复核结论与预警核查清单都收口在这里，
// 页面只负责渲染和收集输入。报告状态链沿用原有链路：
// 已采样 → 检测中 → 已出报告/超标 → 已复核；复核人退回回到检测中。
const REPORT_KEY = 'waterquality'
const CHECK_KEY = 'warningcheck'

const STATUS_SAMPLED = '已采样'
const STATUS_TESTING = '检测中'
const STATUS_REPORTED = '已出报告'
const STATUS_EXCEEDED = '超标'
const STATUS_REVIEWED = '已复核'

// 复核人退回时清空的「中间结论」字段；原始读数（检测值）不在其中，复核人不能改原始读数。
const INTERMEDIATE_FIELDS = ['检测结论', '退回原因']

// 归属历史是追加式日志：跨组转派只加不覆盖，历史归属随报告一起保存。
export type OwnershipRecord = {
  时间: string
  操作人: string
  原检测组: string
  新检测组: string
  备注: string
}

function now(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

export function parseOwnershipHistory(row: EntryRow): OwnershipRecord[] {
  try {
    const parsed = JSON.parse(String(row['归属历史'] ?? '[]')) as OwnershipRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// 旧报告兼容：缺检测组时按采样人归属兜底，缺采样组同理；归属历史缺省为空日志。
// 规范化在读取时完成并顺手落库，旧数据打开一次就迁移好。
function normalizeReport(row: EntryRow): { row: EntryRow; changed: boolean } {
  let changed = false
  const next = { ...row }
  if (!next['检测组']) {
    next['检测组'] = groupOfStaff(String(next['采样人'] ?? '')) || '未分组'
    changed = true
  }
  if (!next['采样组']) {
    next['采样组'] = groupOfStaff(String(next['采样人'] ?? '')) || '未分组'
    changed = true
  }
  if (!next['归属历史']) {
    next['归属历史'] = '[]'
    changed = true
  }
  return { row: next, changed }
}

function loadReports(): EntryRow[] {
  const rows = listRows(REPORT_KEY)
  let dirty = false
  const normalized = rows.map((row) => {
    const result = normalizeReport(row)
    dirty = dirty || result.changed
    return result.row
  })
  if (dirty) {
    saveRows(REPORT_KEY, normalized)
  }
  return normalized
}

export function listLabReports(filters: Record<string, string> = {}): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  const rows = loadReports()
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

function findReport(id: number): { rows: EntryRow[]; index: number } | undefined {
  const rows = loadReports()
  const index = rows.findIndex((row) => Number(row.id) === id)
  return index < 0 ? undefined : { rows, index }
}

function fail(message: string): ActionResult {
  return { ok: false, message }
}

function commit(rows: EntryRow[], index: number, updated: EntryRow): void {
  const next = [...rows]
  next[index] = updated
  saveRows(REPORT_KEY, next)
}

function roleLabel(staff: LabStaff): string {
  return LAB_ROLE_LABELS[staff.role]
}

// 页面按岗位 + 状态决定行内动作；服务里每个动作仍会再校验一次，页面不算权限依据。
export function availableActions(row: EntryRow, staff: LabStaff): string[] {
  const status = String(row.status)
  const actions: string[] = []
  if (staff.role === 'sampler' && status === STATUS_SAMPLED && row['采样组'] === staff.group) {
    actions.push('补录样本')
  }
  if (staff.role === 'tester' && row['检测组'] === staff.group) {
    if (status === STATUS_SAMPLED) actions.push('开始检测')
    if (status === STATUS_TESTING) actions.push('出具结果')
  }
  if (staff.role === 'reviewer') {
    if (status === STATUS_REPORTED || status === STATUS_EXCEEDED) {
      actions.push('复核通过', '退回检测')
    }
    if (status !== STATUS_REVIEWED) actions.push('跨组转派')
  }
  return actions
}

// 采样站点人员只能补录本组样本，且只能补采样链路字段（采样时间、检测项目、标准上限）。
export function supplementSample(
  id: number,
  patch: { 采样时间?: string; 检测项目?: string; 标准上限?: string },
  staff: LabStaff,
): ActionResult {
  if (staff.role !== 'sampler') {
    return fail(`「${staff.name}」是${roleLabel(staff)}，只有采样员可以补录样本`)
  }
  const found = findReport(id)
  if (!found) {
    return fail(`没有找到编号为 ${id} 的水质检测报告`)
  }
  const report = found.rows[found.index]
  if (report['采样组'] !== staff.group) {
    return fail(`报告归属「${String(report['采样组'])}」，采样员只能补录本组（${staff.group}）样本`)
  }
  if (String(report.status) !== STATUS_SAMPLED) {
    return fail(`报告当前状态「${String(report.status)}」，只有「${STATUS_SAMPLED}」可以补录`)
  }
  const updated = { ...report }
  for (const field of ['采样时间', '检测项目', '标准上限'] as const) {
    const value = patch[field]?.trim()
    if (value) {
      updated[field] = value
    }
  }
  commit(found.rows, found.index, updated)
  return { ok: true, message: `样本已补录，归属「${staff.group}」` }
}

export function startTesting(id: number, staff: LabStaff): ActionResult {
  if (staff.role !== 'tester') {
    return fail(`「${staff.name}」是${roleLabel(staff)}，只有检测员可以开始检测`)
  }
  const found = findReport(id)
  if (!found) {
    return fail(`没有找到编号为 ${id} 的水质检测报告`)
  }
  const report = found.rows[found.index]
  if (report['检测组'] !== staff.group) {
    return fail(`报告检测归属「${String(report['检测组'])}」，不在本组（${staff.group}）`)
  }
  if (String(report.status) !== STATUS_SAMPLED) {
    return fail(`报告当前状态「${String(report.status)}」，只有「${STATUS_SAMPLED}」可以开始检测`)
  }
  commit(found.rows, found.index, { ...report, status: STATUS_TESTING, 检测人: staff.name })
  return { ok: true, message: `报告已进入「${STATUS_TESTING}」，检测人 ${staff.name}` }
}

// 检测项目人员仅能出具结果：写入原始读数与检测结论，超标自动判定。
export function issueResult(
  id: number,
  payload: { 检测值: string; 检测结论: string },
  staff: LabStaff,
): ActionResult {
  if (staff.role !== 'tester') {
    return fail(`「${staff.name}」是${roleLabel(staff)}，只有检测员可以出具结果`)
  }
  const found = findReport(id)
  if (!found) {
    return fail(`没有找到编号为 ${id} 的水质检测报告`)
  }
  const report = found.rows[found.index]
  if (report['检测组'] !== staff.group) {
    return fail(`报告检测归属「${String(report['检测组'])}」，不在本组（${staff.group}）`)
  }
  if (String(report.status) !== STATUS_TESTING) {
    return fail(`报告当前状态「${String(report.status)}」，只有「${STATUS_TESTING}」可以出具结果`)
  }
  const reading = payload.检测值.trim()
  if (!reading) {
    return fail('原始读数（检测值）不能为空')
  }
  const exceeded = isExceeded(reading, String(report['标准上限'] ?? ''))
  const status = exceeded ? STATUS_EXCEEDED : STATUS_REPORTED
  commit(found.rows, found.index, {
    ...report,
    status,
    pending: true,
    abnormal: exceeded,
    检测值: reading,
    检测结论: payload.检测结论.trim(),
    检测人: staff.name,
    退回原因: '',
  })
  return { ok: true, message: `结果已出具，当前状态「${status}」` }
}

function isExceeded(reading: string, limit: string): boolean {
  const value = Number(reading)
  const ceiling = Number(limit)
  if (Number.isNaN(value) || Number.isNaN(ceiling)) {
    return false
  }
  return value > ceiling
}

// 跨组转派：只改当前检测组，历史归属追加进归属历史，永不覆盖。
export function reassignGroup(id: number, targetGroup: string, staff: LabStaff): ActionResult {
  if (staff.role !== 'reviewer') {
    return fail(`「${staff.name}」是${roleLabel(staff)}，只有复核人可以跨组转派`)
  }
  const found = findReport(id)
  if (!found) {
    return fail(`没有找到编号为 ${id} 的水质检测报告`)
  }
  const report = found.rows[found.index]
  if (String(report.status) === STATUS_REVIEWED) {
    return fail(`报告已复核归档，不能再转派`)
  }
  if (!TEST_GROUPS.includes(targetGroup)) {
    return fail(`「${targetGroup}」不是登记的检测组`)
  }
  const from = String(report['检测组'] ?? '未分组')
  if (from === targetGroup) {
    return fail(`报告已经在「${targetGroup}」，不用重复转派`)
  }
  const history = parseOwnershipHistory(report)
  history.push({ 时间: now(), 操作人: staff.name, 原检测组: from, 新检测组: targetGroup, 备注: '跨组转派' })
  commit(found.rows, found.index, {
    ...report,
    检测组: targetGroup,
    归属历史: JSON.stringify(history),
  })
  return { ok: true, message: `报告已从「${from}」转派到「${targetGroup}」，历史归属已留痕` }
}

// 复核结论提交：行内按钮和详情抽屉两个入口都走这里。
// 已落过结论的重复提交直接挡回，同一份报告只保留第一份复核结论。
export function submitReview(id: number, conclusion: string, staff: LabStaff): ActionResult {
  if (staff.role !== 'reviewer') {
    return fail(`「${staff.name}」是${roleLabel(staff)}，只有复核人可以提交复核结论`)
  }
  const found = findReport(id)
  if (!found) {
    return fail(`没有找到编号为 ${id} 的水质检测报告`)
  }
  const report = found.rows[found.index]
  if (String(report['复核结论'] ?? '') || String(report.status) === STATUS_REVIEWED) {
    return fail('该报告已有复核结论，重复提交未落库')
  }
  const status = String(report.status)
  if (status !== STATUS_REPORTED && status !== STATUS_EXCEEDED) {
    return fail(`报告当前状态「${status}」，只有「${STATUS_REPORTED}」或「${STATUS_EXCEEDED}」可以复核`)
  }
  const exceeded = status === STATUS_EXCEEDED
  const updated: EntryRow = {
    ...report,
    status: STATUS_REVIEWED,
    pending: false,
    复核人: staff.name,
    复核结论: conclusion.trim() || '复核通过',
  }
  commit(found.rows, found.index, updated)
  createWarningCheck(updated, exceeded)
  return { ok: true, message: '复核结论已落库，预警页已生成待核查项' }
}

// 复核人退回：清空中间结论，状态回到检测中；原始读数（检测值）保持不动。
export function returnReport(id: number, reason: string, staff: LabStaff): ActionResult {
  if (staff.role !== 'reviewer') {
    return fail(`「${staff.name}」是${roleLabel(staff)}，只有复核人可以退回报告`)
  }
  const found = findReport(id)
  if (!found) {
    return fail(`没有找到编号为 ${id} 的水质检测报告`)
  }
  const report = found.rows[found.index]
  const status = String(report.status)
  if (status !== STATUS_REPORTED && status !== STATUS_EXCEEDED) {
    return fail(`报告当前状态「${status}」，只有「${STATUS_REPORTED}」或「${STATUS_EXCEEDED}」可以退回`)
  }
  const updated: EntryRow = { ...report, status: STATUS_TESTING, pending: true, abnormal: false }
  for (const field of INTERMEDIATE_FIELDS) {
    updated[field] = ''
  }
  updated['退回原因'] = reason.trim() || '复核退回，请重新检测'
  commit(found.rows, found.index, updated)
  return { ok: true, message: '报告已退回检测中，中间结论已清空，原始读数保留' }
}

// 复核完成后挂到预警页的待核查项：同一份报告只生成一条待核查，重复复核不会重复生成。
function createWarningCheck(report: EntryRow, exceeded: boolean): void {
  const checks = listRows(CHECK_KEY)
  const exists = checks.some(
    (item) => item['报告编号'] === report['报告编号'] && item.status === '待核查',
  )
  if (exists) {
    return
  }
  const id = checks.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1
  const item: EntryRow = {
    id,
    status: '待核查',
    pending: true,
    abnormal: exceeded,
    核查编号: `CHECK-${String(id).padStart(4, '0')}`,
    报告编号: String(report['报告编号'] ?? ''),
    报告id: Number(report.id),
    采样站点: String(report['采样站点'] ?? ''),
    检测项目: String(report['检测项目'] ?? ''),
    检测值: String(report['检测值'] ?? ''),
    标准上限: String(report['标准上限'] ?? ''),
    复核人: String(report['复核人'] ?? ''),
    复核结论: String(report['复核结论'] ?? ''),
    生成时间: now(),
    办结人: '',
  }
  saveRows(CHECK_KEY, [...checks, item])
}

export function listWarningChecks(): EntryRow[] {
  return listRows(CHECK_KEY)
}

export function closeWarningCheck(id: number, operator: string): ActionResult {
  const checks = listRows(CHECK_KEY)
  const index = checks.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return fail(`没有找到编号为 ${id} 的核查项`)
  }
  if (checks[index].status !== '待核查') {
    return fail('该核查项已办结，不用重复操作')
  }
  const next = [...checks]
  next[index] = { ...checks[index], status: '已办结', pending: false, 办结人: operator }
  saveRows(CHECK_KEY, next)
  return { ok: true, message: '核查项已办结' }
}
