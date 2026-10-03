import { ROLE_LABEL } from './types'
import type { Staff } from './types'

export { ROLE_LABEL }

/**
 * 人员目录：纯前端没有用户体系，用这份目录模拟登录态。
 * 采样站点人员按站点采样组划分，检测项目人员按检测组划分，复核人统一归属质控复核组。
 */
export const STAFF_DIRECTORY: Staff[] = [
  { name: '王芳', role: 'sampler', group: '城区采样组', station: '城区东门桥站' },
  { name: '李强', role: 'sampler', group: '城区采样组', station: '城区南关站' },
  { name: '赵磊', role: 'sampler', group: '上游采样组', station: '上游坝前站' },
  { name: '陈静', role: 'sampler', group: '下游采样组', station: '下游入河口站' },
  { name: '周敏', role: 'analyst', group: '理化检测组' },
  { name: '吴迪', role: 'analyst', group: '理化检测组' },
  { name: '郑凯', role: 'analyst', group: '重金属检测组' },
  { name: '孙丽', role: 'reviewer', group: '质控复核组' },
  { name: '钱进', role: 'reviewer', group: '质控复核组' },
]

export function staffByName(name: string): Staff | undefined {
  return STAFF_DIRECTORY.find((item) => item.name === name)
}

/** 旧报告缺检测组时按采样人归属兼容：从人员目录反查采样人所在组。 */
export function groupOfSampler(samplerName: string): string {
  return staffByName(samplerName)?.group ?? '未登记采样组'
}
