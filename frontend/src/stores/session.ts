import { defineStore } from 'pinia'

import { LAB_STAFF, staffByName } from '@/data/lab-directory'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '水文监测站网管理系统',
    // 水质实验室当前岗位，水质检测页可切换，用来体验不同角色的权限边界。
    staffName: LAB_STAFF[2].name,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    labStaff: (state) => staffByName(state.staffName) ?? LAB_STAFF[0],
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchStaff(name: string) {
      if (staffByName(name)) {
        this.staffName = name
      }
    },
  },
})
