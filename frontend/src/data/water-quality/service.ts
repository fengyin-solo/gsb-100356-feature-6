import { listChecklist, listReports, saveChecklist, saveReports } from './store'
import { groupOfSampler } from './staff'
import { CONCLUSION, STATUS } from './types'
import type {
  ReviewDecision,
  ServiceResult,
  Staff,
  WarningChecklistItem,
  WaterQualityReport,
} from './types'

function now(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function today(): string {
  return now().slice(0, 10)
}

function nextReportNo(): string {
  const max = listReports().reduce((acc, row) => {
    const tail = Number(row.报告编号.split('-').pop())
    return Number.isFinite(tail) ? Math.max(acc, tail) : acc
  }, 0)
  const stamp = today().replace(/-/g, '')
  return `WQ-${stamp}-${String(max + 1).padStart(3, '0')}`
}

function nextChecklistId(): number {
  return listChecklist().reduce((acc, item) => Math.max(acc, item.id), 0) + 1
}

function persist(rows: WaterQualityReport[]): void {
  saveReports(rows)
}

/** 有效检测组：旧报告缺检测组时按采样人归属兼容。 */
export function effectiveLabGroup(report: WaterQualityReport): string {
  return report.检测组?.trim() || groupOfSampler(report.采样人)
}

export function listReportRows(filters: Record<string, string> = {}): WaterQualityReport[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  const rows = listReports()
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field as keyof WaterQualityReport] ?? '').includes(value.trim())),
  )
}

function findReport(id: number): WaterQualityReport | undefined {
  return listReports().find((row) => row.id === id)
}

function updateReport(id: number, patch: Partial<WaterQualityReport>, trace?: {
  action: string
  fromStatus: string
  toStatus: string
  operator: string
  note?: string
}): WaterQualityReport[] {
  const rows = listReports().map((row) => {
    if (row.id !== id) {
      return row
    }
    const next = { ...row, ...patch }
    if (trace) {
      next.flow = [...row.flow, { ...trace, time: now() }]
    }
    return next

  })
  persist(rows)
  return rows
}

// ───────────────────────── 权限判定 ─────────────────────────

function denied(message: string): ServiceResult<never> {
  return { ok: false, message }
}

/** 采样站点人员只能操作本组样本。 */
function checkSamplerScope(staff: Staff, report: WaterQualityReport): ServiceResult {
  if (staff.role !== 'sampler') {
    return denied('只有采样站点人员可以执行该操作')
  }
  if (staff.group !== report.采样组) {
    return denied(`跨组操作被拒绝：该样本归属「${report.采样组}」，你属于「${staff.group}」`)
  }
  return { ok: true, message: '' }
}

/** 检测项目人员仅能在自己检测组的样本上出具结果。 */
function checkAnalystScope(staff: Staff, report: WaterQualityReport): ServiceResult {
  if (staff.role !== 'analyst') {
    return denied('只有检测项目人员可以出具检测结果')
  }
  if (staff.group !== effectiveLabGroup(report)) {
    return denied(`只能为本检测组的样本出具结果：当前归属「${effectiveLabGroup(report)}」，你属于「${staff.group}」`)
  }
  return { ok: true, message: '' }
}

// ───────────────────────── 采样：补录本组样本 ─────────────────────────

export type SampleDraft = {
  采样站点: string
  采样时间: string
  检测项目: string
  原始读数: number
  标准上限: number
}

export function createSample(staff: Staff, draft: SampleDraft): ServiceResult<WaterQualityReport> {
  if (staff.role !== 'sampler') {
    return denied('只有采样站点人员可以补录本组样本')
  }
  if (!draft.采样站点.trim() || !draft.检测项目.trim()) {
    return denied('采样站点与检测项目不能为空')
  }
  if (!Number.isFinite(draft.原始读数) || draft.原始读数 < 0) {
    return denied('原始读数必须是不小于 0 的数值')
  }
  if (!Number.isFinite(draft.标准上限) || draft.标准上限 <= 0) {
    return denied('标准上限必须是大于 0 的数值')
  }
  const rows = listReports()
  const id = rows.reduce((acc, row) => Math.max(acc, row.id), 0) + 1
  const time = now()
  const report: WaterQualityReport = {
    id,
    报告编号: nextReportNo(),
    采样站点: draft.采样站点.trim(),
    采样时间: draft.采样时间 || time,
    检测项目: draft.检测项目.trim(),
    原始读数: draft.原始读数,
    标准上限: draft.标准上限,
    采样人: staff.name,
    采样组: staff.group,
    status: STATUS.sampled,
    复核轮次: 0,
    ownershipHistory: [],
    flow: [
      { action: '补录样本', fromStatus: '—', toStatus: STATUS.sampled, operator: staff.name, time },
    ],
  }
  persist([report, ...rows])
  return { ok: true, message: `样本 ${report.报告编号} 已补录到「${staff.group}」`, data: report }
}

// ───────────────────────── 送检：开始检测 ─────────────────────────

export function startTesting(staff: Staff, id: number): ServiceResult {
  const report = findReport(id)
  if (!report) {
    return denied(`没有找到编号为 ${id} 的水质检测报告`)
  }
  const scope = checkSamplerScope(staff, report)
  if (!scope.ok) {
    return scope
  }
  if (report.status !== STATUS.sampled && report.status !== STATUS.testing) {
    return denied(`当前状态为「${report.status}」，不能开始检测`)
  }
  if (report.status === STATUS.testing) {
    return denied('该样本已在检测中，不用重复送检')
  }
  // 送检时按目标检测组落定归属；默认送与检测项目匹配的检测组，由本组采样人发起。
  // 纯前端演示：开始检测即按采样组送对应检测组，跨组调整走「跨组转派」。
  const labGroup = resolveLabGroup(report.检测项目)
  updateReport(id, { status: STATUS.testing, 检测组: labGroup }, {
    action: '开始检测',
    fromStatus: STATUS.sampled,
    toStatus: STATUS.testing,
    operator: staff.name,
    note: `送${labGroup}`,
  })
  return { ok: true, message: `样本已送检至「${labGroup}」` }
}

const HEAVY_METAL_ITEMS = ['镉', '铅', '铬', '六价铬', '汞', '砷', '铜', '锌', '重金属']

function resolveLabGroup(item: string): string {
  return HEAVY_METAL_ITEMS.some((word) => item.includes(word)) ? '重金属检测组' : '理化检测组'
}

// ───────────────────────── 出具结果：检测项目人员唯一的写入口 ─────────────────────────

export type ResultDraft = {
  检测值: number
}

export function issueResult(staff: Staff, id: number, draft: ResultDraft): ServiceResult {
  const report = findReport(id)
  if (!report) {
    return denied(`没有找到编号为 ${id} 的水质检测报告`)
  }
  const scope = checkAnalystScope(staff, report)
  if (!scope.ok) {
    return scope
  }
  if (report.status !== STATUS.testing) {
    return denied(`当前状态为「${report.status}」，只有检测中的样本可以出具结果`)
  }
  if (!Number.isFinite(draft.检测值) || draft.检测值 < 0) {
    return denied('检测值必须是不小于 0 的数值')
  }
  const conclusion = draft.检测值 > report.标准上限 ? CONCLUSION.overproof : CONCLUSION.qualified
  const time = now()
  updateReport(id, {
    status: STATUS.reported,
    检测值: draft.检测值,
    检测结论: conclusion,
    检测人: staff.name,
    出具时间: time,
  }, {
    action: '出具报告',
    fromStatus: STATUS.testing,
    toStatus: STATUS.reported,
    operator: staff.name,
    note: `检测值 ${draft.检测值}，判定${conclusion}`,
  })
  return { ok: true, message: `结果已出具：${conclusion}，等待采样站点人员发起复核` }
}

// ───────────────────────── 跨组转派：归属历史只追加 ─────────────────────────

export function transferLabGroup(
  staff: Staff,
  id: number,
  targetGroup: string,
  reason: string,
): ServiceResult {
  const report = findReport(id)
  if (!report) {
    return denied(`没有找到编号为 ${id} 的水质检测报告`)
  }
  // 转派由本组采样站点人员发起：样本归属在采样链路侧始终可追溯。
  const scope = checkSamplerScope(staff, report)
  if (!scope.ok) {
    return scope
  }
  if (report.status !== STATUS.testing && report.status !== STATUS.sampled) {
    return denied(`当前状态为「${report.status}」，检测任务已出报告，不能再转派`)
  }
  const fromGroup = effectiveLabGroup(report)
  if (targetGroup === fromGroup) {
    return denied(`样本本就归属「${fromGroup}」，无需转派`)
  }
  if (!reason.trim()) {
    return denied('跨组转派必须填写原因，便于归属留痕')
  }
  const time = now()
  const rows = listReports().map((row) => {
    if (row.id !== id) {
      return row
    }
    return {
      ...row,
      检测组: targetGroup,
      ownershipHistory: [
        ...row.ownershipHistory,
        { fromGroup, toGroup: targetGroup, operator: staff.name, time, reason: reason.trim() },
      ],
      flow: [
        ...row.flow,
        {
          action: '跨组转派',
          fromStatus: row.status,
          toStatus: row.status,
          operator: staff.name,
          time,
          note: `${fromGroup} → ${targetGroup}，历史归属保留`,
        },
      ],
    }
  })
  persist(rows)
  return { ok: true, message: `已转派至「${targetGroup}」，原归属「${fromGroup}」已在历史中保留` }
}

export const TRANSFER_TARGETS = ['理化检测组', '重金属检测组']

// ───────────────────────── 发起复核：仍由采样链路侧发起 ─────────────────────────

export function submitForReview(staff: Staff, id: number): ServiceResult {
  const report = findReport(id)
  if (!report) {
    return denied(`没有找到编号为 ${id} 的水质检测报告`)
  }
  const scope = checkSamplerScope(staff, report)
  if (!scope.ok) {
    return scope
  }
  if (report.status !== STATUS.reported) {
    return denied(`当前状态为「${report.status}」，只有已出报告的样本可以发起复核`)
  }
  updateReport(id, {
    status: STATUS.pendingReview,
    复核轮次: report.复核轮次 + 1,
    复核人: undefined,
    复核结论: undefined,
    复核意见: undefined,
    复核时间: undefined,
  }, {
    action: '发起复核',
    fromStatus: STATUS.reported,
    toStatus: STATUS.pendingReview,
    operator: staff.name,
  })
  return { ok: true, message: '已发起复核，等待复核人处理' }
}

// ───────────────────────── 复核结论：两个入口共用，并发只落一份 ─────────────────────────

// 同报告的复核进行中合并：两个入口同时点下时，复用同一次落库结果。
const inflight = new Map<number, Promise<ServiceResult>>()

export function submitReview(
  staff: Staff,
  id: number,
  decision: ReviewDecision,
  comment: string,
): Promise<ServiceResult> {
  const pending = inflight.get(id)
  if (pending) {
    return pending.then((result) => ({
      ...result,
      message: result.ok ? `${result.message}（另一入口同时提交，已合并为同一份结论）` : result.message,
    }))
  }
  const task = Promise.resolve().then(() => doSubmitReview(staff, id, decision, comment))
  inflight.set(id, task)
  void task.finally(() => inflight.delete(id))
  return task
}

function doSubmitReview(
  staff: Staff,
  id: number,
  decision: ReviewDecision,
  comment: string,
): ServiceResult {
  const report = findReport(id)
  if (!report) {
    return denied(`没有找到编号为 ${id} 的水质检测报告`)
  }
  if (staff.role !== 'reviewer') {
    return denied('只有复核人可以出具复核结论')
  }
  if (report.status !== STATUS.pendingReview) {
    // 两个入口先后提交：第一份已经落库，后续提交只回显既有结论，不再覆盖。
    if (report.status === STATUS.reviewed && report.复核结论) {
      return {
        ok: true,
        message: `该报告第 ${report.复核轮次} 轮复核已有结论「${report.复核结论}」，无需重复提交`,
      }
    }
    return denied(`当前状态为「${report.status}」，不能提交复核结论`)
  }
  if (!comment.trim()) {
    return denied(decision === '退回' ? '退回必须填写复核意见，说明退回原因' : '请填写复核意见后再提交')
  }

  if (decision === '通过') {
    const time = now()
    updateReport(id, {
      status: STATUS.reviewed,
      复核人: staff.name,
      复核结论: '通过',
      复核意见: comment.trim(),
      复核时间: time,
    }, {
      action: '复核通过',
      fromStatus: STATUS.pendingReview,
      toStatus: STATUS.reviewed,
      operator: staff.name,
      note: comment.trim(),
    })
    appendChecklist(findReport(id) as WaterQualityReport, staff, time)
    return { ok: true, message: '复核通过，预警核查清单已生成待核查项' }
  }

  // 退回：状态回到检测中，中间结论必须清空；原始读数、采样归属、转派历史一律保留。
  // 退回结论只进流转历史留痕，报告正文不保留任何中间结论字段。
  updateReport(id, {
    status: STATUS.testing,
    检测值: undefined,
    检测结论: undefined,
    检测人: undefined,
    出具时间: undefined,
    复核人: undefined,
    复核结论: undefined,
    复核意见: undefined,
    复核时间: undefined,
  }, {
    action: '复核退回',
    fromStatus: STATUS.pendingReview,
    toStatus: STATUS.testing,
    operator: staff.name,
    note: comment.trim(),
  })
  return { ok: true, message: '已退回检测组，检测结果与复核结论等中间结论已清空，原始读数保持不变' }
}

// ───────────────────────── 预警核查清单挂接 ─────────────────────────

function warningLevel(value: number | string, limit: number, conclusion: string): string {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (conclusion === CONCLUSION.overproof || (Number.isFinite(numeric) && numeric > limit)) {
    return '橙色'
  }
  return '蓝色'
}

/** 复核完成产生待核查项；同报告同轮次只保留一条。 */
function appendChecklist(report: WaterQualityReport, reviewer: Staff, time: string): void {
  const rows = listChecklist()
  const key = `${report.id}#${report.复核轮次}`
  if (rows.some((item) => item.key === key)) {
    return
  }
  const value = report.检测值 ?? ''
  const item: WarningChecklistItem = {
    id: nextChecklistId(),
    key,
    报告编号: report.报告编号,
    报告Id: report.id,
    采样站点: report.采样站点,
    检测项目: report.检测项目,
    检测值: value,
    标准上限: report.标准上限,
    检测结论: report.检测结论 ?? '',
    复核人: reviewer.name,
    复核轮次: report.复核轮次,
    level: warningLevel(value, report.标准上限, report.检测结论 ?? ''),
    状态: '待核查',
    产生时间: time,
  }
  saveChecklist([item, ...rows])
}

/** 兜底对账：任何已复核但清单里缺项的报告（如旧数据）都补挂一条待核查项。 */
export function reconcileChecklist(): WarningChecklistItem[] {
  const rows = listChecklist()
  const additions: WarningChecklistItem[] = []
  for (const report of listReports()) {
    if (report.status !== STATUS.reviewed) {
      continue
    }
    const key = `${report.id}#${report.复核轮次}`
    if (rows.some((item) => item.key === key)) {
      continue
    }
    const value = report.检测值 ?? ''
    additions.push({
      id: nextChecklistId() + additions.length,
      key,
      报告编号: report.报告编号,
      报告Id: report.id,
      采样站点: report.采样站点,
      检测项目: report.检测项目,
      检测值: value,
      标准上限: report.标准上限,
      检测结论: report.检测结论 ?? '',
      复核人: report.复核人 ?? '未知复核人',
      复核轮次: report.复核轮次,
      level: warningLevel(value, report.标准上限, report.检测结论 ?? ''),
      状态: '待核查',
      产生时间: report.复核时间 ?? now(),
    })
  }
  if (additions.length > 0) {
    saveChecklist([...additions, ...rows])
  }
  return listChecklist()
}

export function listWarningChecklist(includeClosed = false): WarningChecklistItem[] {
  const rows = reconcileChecklist()
  return includeClosed ? rows : rows.filter((item) => item.状态 === '待核查')
}

export function verifyChecklistItem(
  staff: Staff,
  id: number,
  note: string,
): ServiceResult<WarningChecklistItem> {
  if (staff.role !== 'reviewer') {
    return denied('只有复核人可以在预警页核查水质待办')
  }
  if (!note.trim()) {
    return denied('请填写核查说明')
  }
  const rows = listChecklist()
  const target = rows.find((item) => item.id === id)
  if (!target) {
    return denied(`没有找到编号为 ${id} 的待核查项`)
  }
  if (target.状态 === '已核查') {
    return { ok: true, message: '该待核查项已核查，无需重复操作', data: target }
  }
  const next = rows.map((item) =>
    item.id === id
      ? { ...item, 状态: '已核查' as const, 核查时间: now(), 核查人: staff.name, 核查说明: note.trim() }
      : item,
  )
  saveChecklist(next)
  return { ok: true, message: `报告 ${target.报告编号} 的预警项已核查关闭`, data: next.find((item) => item.id === id) }
}

// ───────────────────────── 看板指标 ─────────────────────────

export function waterQualityMetrics() {
  const rows = listReports()
  return [
    { label: '报告总数', value: rows.length },
    { label: '超标报告数', value: rows.filter((row) => row.检测结论 === CONCLUSION.overproof).length },
    { label: '待复核报告', value: rows.filter((row) => row.status === STATUS.pendingReview).length },
  ]
}

export function exportReportCsv(): { filename: string; content: string } {
  const header = ['报告编号', '采样站点', '采样时间', '检测项目', '原始读数', '标准上限', '采样人', '采样组', '检测组', '检测值', '检测结论', '检测人', '复核轮次', '复核人', '复核结论', '当前状态']
  const lines = [header.join(',')]
  for (const row of listReports()) {
    lines.push([
      row.报告编号, row.采样站点, row.采样时间, row.检测项目, row.原始读数, row.标准上限,
      row.采样人, row.采样组, effectiveLabGroup(row), row.检测值 ?? '', row.检测结论 ?? '',
      row.检测人 ?? '', row.复核轮次, row.复核人 ?? '', row.复核结论 ?? '', row.status,
    ].join(','))
  }
  return { filename: '水质检测报告-清单.csv', content: `﻿${lines.join('\n')}` }
}
