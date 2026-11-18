import { defineStore } from 'pinia'
import { ref } from 'vue'

const STORAGE_KEY = 'ateam.sidebar.collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export const useUiStore = defineStore('ui', () => {
  const sidebarCollapsed = ref(readCollapsed())

  function setSidebarCollapsed(value: boolean): void {
    sidebarCollapsed.value = value
    try {
      localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  function toggleSidebar(): void {
    setSidebarCollapsed(!sidebarCollapsed.value)
  }

  return { sidebarCollapsed, setSidebarCollapsed, toggleSidebar }
})
