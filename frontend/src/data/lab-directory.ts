// 水质实验室岗位目录：报告按「采样组 / 检测组」划分归属，按岗位限制可执行的操作。
// 采样员只能补录本组样本，检测员仅能出具结果，复核人可退回、可复核、可跨组转派。

export type LabRole = 'sampler' | 'tester' | 'reviewer'

export type LabStaff = {
  name: string
  role: LabRole
  group: string
}

export const LAB_ROLE_LABELS: Record<LabRole, string> = {
  sampler: '采样员',
  tester: '检测员',
  reviewer: '复核人',
}

export const LAB_ROLE_HINTS: Record<LabRole, string> = {
  sampler: '只能补录本组样本',
  tester: '仅能出具检测结果',
  reviewer: '可复核、可退回、可跨组转派，不能改原始读数',
}

// 检测任务在这些检测组之间转派；采样组不参与检测归属。
export const TEST_GROUPS = ['理化检测组', '生物检测组']

export const LAB_STAFF: LabStaff[] = [
  { name: '王采样', role: 'sampler', group: '采样一组' },
  { name: '李采样', role: 'sampler', group: '采样二组' },
  { name: '张检测', role: 'tester', group: '理化检测组' },
  { name: '刘检测', role: 'tester', group: '生物检测组' },
  { name: '陈复核', role: 'reviewer', group: '实验室复核岗' },
]

export function staffByName(name: string): LabStaff | undefined {
  return LAB_STAFF.find((staff) => staff.name === name)
}

// 旧报告没有检测组时按采样人归属兜底：报告先挂在采样人所在的组。
export function groupOfStaff(name: string): string {
  return staffByName(name)?.group ?? ''
}
