/** 水质检测领域类型：权限、归属、状态流转、复核与预警核查都围绕这份报告模型展开。 */

export type RoleKey = 'sampler' | 'analyst' | 'reviewer'

export type RoleLabel = '采样站点人员' | '检测项目人员' | '复核人'

export type Staff = {
  name: string
  role: RoleKey
  /** 所属组：采样人是站点采样组，检测项目人员是检测组，复核人归属质控组。 */
  group: string
  station?: string
}

export const ROLE_LABEL: Record<RoleKey, RoleLabel> = {
  sampler: '采样站点人员',
  analyst: '检测项目人员',
  reviewer: '复核人',
}

export const STATUS = {
  sampled: '已采样',
  testing: '检测中',
  reported: '已出报告',
  pendingReview: '待复核',
  reviewed: '已复核',
} as const

export const CONCLUSION = {
  qualified: '合格',
  overproof: '超标',
} as const

/** 归属留痕：跨组转派只追加，不改写历史归属。 */
export type OwnershipTrace = {
  fromGroup: string
  toGroup: string
  operator: string
  time: string
  reason: string
}

/** 流转留痕：每一次状态变化都追加一条，复核退回/通过都能追到操作人。 */
export type FlowTrace = {
  action: string
  fromStatus: string
  toStatus: string
  operator: string
  time: string
  note?: string
}

export type WaterQualityReport = {
  id: number
  报告编号: string
  采样站点: string
  采样时间: string
  检测项目: string
  /** 原始读数：采样站点人员补录样本时录入，此后任何环节都不允许修改。 */
  原始读数: number | string
  标准上限: number
  采样人: string
  采样组: string
  /** 检测组：开始检测时按检测项目人员所属组落定；旧报告可能缺失，回落到采样组。 */
  检测组?: string
  status: string
  /** 检测项目人员出具结果时落定的中间结论，复核退回时随检测结果一并清空。 */
  检测值?: number | string
  检测结论?: string
  检测人?: string
  出具时间?: string
  复核轮次: number
  复核人?: string
  复核结论?: string
  复核意见?: string
  复核时间?: string
  ownershipHistory: OwnershipTrace[]
  flow: FlowTrace[]
}

export type ReviewDecision = '通过' | '退回'

export type ServiceResult<T = undefined> = {
  ok: boolean
  message: string
  data?: T
}

/** 复核通过后挂到预警页的待核查项，同一报告同一复核轮次只产生一条。 */
export type WarningChecklistItem = {
  id: number
  key: string
  报告编号: string
  报告Id: number
  采样站点: string
  检测项目: string
  检测值: number | string
  标准上限: number
  检测结论: string
  复核人: string
  复核轮次: number
  level: string
  状态: '待核查' | '已核查'
  产生时间: string
  核查时间?: string
  核查人?: string
  核查说明?: string
}
