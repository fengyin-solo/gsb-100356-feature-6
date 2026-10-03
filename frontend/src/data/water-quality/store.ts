import { WARNING_CHECKLIST_SEED, WATER_QUALITY_SEED } from './seed'
import type { WarningChecklistItem, WaterQualityReport } from './types'

// 水质报告与预警核查清单独立持久化，不和通用示例数据共用键。
const REPORT_STORAGE_KEY = 'hydrology-monitor-station:water-quality-reports'
const CHECKLIST_STORAGE_KEY = 'hydrology-monitor-station:water-quality-checklist'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(fallback)
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
}

let reportCache: WaterQualityReport[] | null = null
let checklistCache: WarningChecklistItem[] | null = null

export function listReports(): WaterQualityReport[] {
  if (reportCache === null) {
    reportCache = read(REPORT_STORAGE_KEY, WATER_QUALITY_SEED)
  }
  return reportCache
}

export function saveReports(rows: WaterQualityReport[]): void {
  reportCache = rows
  write(REPORT_STORAGE_KEY, rows)
}

export function listChecklist(): WarningChecklistItem[] {
  if (checklistCache === null) {
    checklistCache = read(CHECKLIST_STORAGE_KEY, WARNING_CHECKLIST_SEED)
  }
  return checklistCache
}

export function saveChecklist(rows: WarningChecklistItem[]): void {
  checklistCache = rows
  write(CHECKLIST_STORAGE_KEY, rows)
}

export function resetWaterQuality(): { reports: WaterQualityReport[]; checklist: WarningChecklistItem[] } {
  const reports = clone(WATER_QUALITY_SEED)
  const checklist = clone(WARNING_CHECKLIST_SEED)
  saveReports(reports)
  saveChecklist(checklist)
  return { reports, checklist }
}
