import { createRouter, createWebHistory } from 'vue-router'

import AgentsView from './views/AgentsView.vue'
import AgentWorkView from './views/AgentWorkView.vue'
import BoardView from './views/BoardView.vue'
import RunDetailView from './views/RunDetailView.vue'
import RunsView from './views/RunsView.vue'
import SettingsView from './views/SettingsView.vue'
import TaskView from './views/TaskView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'board', component: BoardView },
    { path: '/tasks/:id', name: 'task', component: TaskView, props: true },
    { path: '/agents', name: 'agents', component: AgentsView },
    { path: '/agents/:id/work', name: 'agent-work', component: AgentWorkView, props: true },
    { path: '/runs', name: 'runs', component: RunsView },
    { path: '/runs/:id', name: 'run', component: RunDetailView, props: true },
    { path: '/settings', name: 'settings', component: SettingsView },
  ],
})
