import { defineStore } from 'pinia'

import { ROLE_LABEL, STAFF_DIRECTORY } from '@/data/water-quality/staff'
import type { RoleKey, Staff } from '@/data/water-quality/types'

// 纯前端演示：以人员目录里的某个人作为当前登录身份，水质检测页按其角色与组做权限控制。
const DEFAULT_STAFF = STAFF_DIRECTORY[0]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: DEFAULT_STAFF.name,
    role: DEFAULT_STAFF.role as RoleKey,
    group: DEFAULT_STAFF.group,
    station: DEFAULT_STAFF.station ?? '',
    shiftLabel: '白班 08:00-20:00',
    scope: '水文监测站网管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    roleLabel: (state) => ROLE_LABEL[state.role],
    isSampler: (state) => state.role === 'sampler',
    isAnalyst: (state) => state.role === 'analyst',
    isReviewer: (state) => state.role === 'reviewer',
  },
  actions: {
    switchIdentity(staff: Staff) {
      this.operator = staff.name
      this.role = staff.role
      this.group = staff.group
      this.station = staff.station ?? ''
    },
    setShift(label: string) {
      this.shiftLabel = label
    },
  },
})
