<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { PlusIcon, RefreshCwIcon, SendIcon } from '@lucide/vue'
import type { Agent, AgentTeam, Conversation, ConversationMessage } from '@ateam/shared'
import { AgentApi, ConversationApi, TeamApi } from '../api'
import EmptyState from '../components/EmptyState.vue'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Loader } from '../components/ai-elements/loader'

const { t } = useI18n()

const teams = ref<AgentTeam[]>([])
const agents = ref<Agent[]>([])
const selectedTeamId = ref('')
const team = ref<AgentTeam | null>(null)
const conversations = ref<Conversation[]>([])
const selectedConversationId = ref('')
const messages = ref<ConversationMessage[]>([])
const loading = ref(true)
const teamLoading = ref(false)
const messagesLoading = ref(false)
const error = ref('')
const newTeamOpen = ref(false)
const newTeamName = ref('')
const newTeamDescription = ref('')
const newTeamMembers = ref<string[]>([])
const newConversationTitle = ref('')
const addMemberId = ref('')
const mentionId = ref('')
const composer = ref('')
const sending = ref(false)
const converting = ref('')

let pollTimer: number | undefined

const selectedTeam = computed(() => team.value)
const selectedConversation = computed(
  () => conversations.value.find((item) => item.id === selectedConversationId.value) ?? null,
)
const availableAgents = computed(() =>
  agents.value.filter((agent) => !team.value?.members.some((member) => member.agentId === agent.id)),
)

function memberName(agentId?: string): string {
  if (!agentId) {
    return ''
  }
  return team.value?.members.find((member) => member.agentId === agentId)?.name ?? agentId
}

async function loadTeams() {
  loading.value = true
  error.value = ''
  try {
    teams.value = await TeamApi.list()
    if (!selectedTeamId.value && teams.value.length > 0) {
      await selectTeam(teams.value[0].id)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function loadAgents() {
  try {
    agents.value = await AgentApi.list()
  } catch {
    agents.value = []
  }
}

async function selectTeam(teamId: string) {
  stopPolling()
  selectedTeamId.value = teamId
  teamLoading.value = true
  try {
    team.value = await TeamApi.get(teamId)
    conversations.value = await ConversationApi.list(teamId)
    if (conversations.value.length > 0) {
      await selectConversation(conversations.value[0].id)
    } else {
      selectedConversationId.value = ''
      messages.value = []
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    teamLoading.value = false
  }
}

async function selectConversation(conversationId: string) {
  selectedConversationId.value = conversationId
  await loadMessages()
  startPolling()
}

async function loadMessages() {
  if (!selectedConversationId.value) {
    messages.value = []
    return
  }
  messagesLoading.value = true
  try {
    messages.value = await ConversationApi.messages(selectedConversationId.value)
    await nextTick()
    const scroller = document.getElementById('conversation-scroll')
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    messagesLoading.value = false
  }
}

function startPolling() {
  stopPolling()
  pollTimer = window.setInterval(() => {
    if (selectedConversationId.value) {
      void loadMessages()
    }
  }, 1500)
}

function stopPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer)
    pollTimer = undefined
  }
}

async function createTeam() {
  if (!newTeamName.value.trim()) {
    return
  }
  try {
    const created = await TeamApi.create({
      name: newTeamName.value.trim(),
      description: newTeamDescription.value.trim(),
      memberAgentIds: newTeamMembers.value,
    })
    newTeamOpen.value = false
    newTeamName.value = ''
    newTeamDescription.value = ''
    newTeamMembers.value = []
    await loadTeams()
    await selectTeam(created.id)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

async function archiveTeam() {
  if (!team.value) {
    return
  }
  try {
    await TeamApi.archive(team.value.id)
    await loadTeams()
    await selectTeam(team.value.id)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

async function createConversation() {
  if (!team.value) {
    return
  }
  try {
    const created = await ConversationApi.create(team.value.id, newConversationTitle.value.trim() || t('teams.defaultTitle'))
    newConversationTitle.value = ''
    conversations.value = await ConversationApi.list(team.value.id)
    await selectConversation(created.id)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

async function addMember() {
  if (!team.value || !addMemberId.value) {
    return
  }
  try {
    await TeamApi.addMember(team.value.id, { agentId: addMemberId.value })
    addMemberId.value = ''
    team.value = await TeamApi.get(team.value.id)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

async function removeMember(agentId: string) {
  if (!team.value) {
    return
  }
  try {
    await TeamApi.removeMember(team.value.id, agentId)
    team.value = await TeamApi.get(team.value.id)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

async function sendMessage() {
  if (!selectedConversation.value || !composer.value.trim() || sending.value) {
    return
  }
  sending.value = true
  try {
    let content = composer.value.trim()
    const mentions: string[] = []
    if (mentionId.value) {
      const name = memberName(mentionId.value)
      if (name && !content.toLowerCase().includes('@' + name.toLowerCase())) {
        content = `@${name} ${content}`
      }
      mentions.push(mentionId.value)
    }
    await ConversationApi.send(selectedConversation.value.id, content, mentions)
    composer.value = ''
    mentionId.value = ''
    await loadMessages()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
    await loadMessages()
  } finally {
    sending.value = false
  }
}

async function convertToTask(message: ConversationMessage) {
  if (converting.value) {
    return
  }
  converting.value = message.id
  try {
    const result = await ConversationApi.convertToTask(message.id)
    ElMessage.success(t('teams.converted'))
    await loadMessages()
    if (result.task?.id) {
      message.taskId = result.task.id
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  } finally {
    converting.value = ''
  }
}

watch(newTeamOpen, (open) => {
  if (open && agents.value.length === 0) {
    void loadAgents()
  }
})

onMounted(() => {
  void loadAgents()
  void loadTeams()
})

onUnmounted(stopPolling)
</script>

<template>
  <div class="flex h-full flex-col">
    <Teleport to="#titlebar-actions">
      <div class="flex items-center gap-2">
        <Button size="sm" variant="outline" :disabled="loading" @click="loadTeams">
          <RefreshCwIcon class="size-4" />
          {{ $t('common.refresh') }}
        </Button>
        <Button size="sm" @click="newTeamOpen = true">
          <PlusIcon class="size-4" />
          {{ $t('teams.newTeam') }}
        </Button>
      </div>
    </Teleport>

    <div class="flex-1 overflow-hidden px-6 pb-6 pt-4">
      <div class="mx-auto flex h-full max-w-[1200px] gap-4">
        <aside class="flex w-60 shrink-0 flex-col gap-2">
          <p class="text-caption text-fg-subtle">{{ $t('teams.subtitle') }}</p>
          <div v-if="loading" class="flex items-center gap-2 text-caption text-fg-subtle">
            <Loader :size="14" />
            {{ $t('teams.loading') }}
          </div>
          <EmptyState v-else-if="teams.length === 0" :title="$t('teams.empty')" :description="$t('teams.emptyDesc')" />
          <button
            v-for="item in teams"
            :key="item.id"
            type="button"
            class="rounded-md border px-3 py-2 text-left transition-colors"
            :class="item.id === selectedTeamId ? 'border-accent bg-surface-raised' : 'border-border-subtle hover:bg-surface-raised'"
            @click="selectTeam(item.id)"
          >
            <span class="block truncate text-label font-semibold">{{ item.name }}</span>
            <span class="mt-0.5 block truncate text-caption text-fg-subtle">
              {{ $t('teams.memberCount', { count: item.members?.length ?? 0 }) }}
            </span>
          </button>
        </aside>

        <section class="flex min-w-0 flex-1 flex-col gap-3">
          <p v-if="error" class="text-caption text-danger">{{ error }}</p>
          <EmptyState v-if="!team" :title="$t('teams.selectTeam')" :description="$t('teams.selectTeamDesc')" />
          <template v-else>
            <header class="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle pb-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h1 class="text-title font-semibold tracking-tight">{{ team.name }}</h1>
                  <Badge v-if="team.status === 'archived'" tone="warning">{{ $t('teams.archived') }}</Badge>
                </div>
                <p v-if="team.description" class="mt-1 text-caption text-fg-subtle">{{ team.description }}</p>
                <div class="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge v-for="member in team.members" :key="member.agentId" tone="neutral">
                    {{ member.name }}
                    <button
                      v-if="team.status === 'active'"
                      type="button"
                      class="ml-1 text-fg-subtle hover:text-danger"
                      :aria-label="$t('teams.removeMember')"
                      @click="removeMember(member.agentId)"
                    >×</button>
                  </Badge>
                  <span v-if="team.members.length === 0" class="text-caption text-fg-subtle">{{ $t('teams.noMembers') }}</span>
                </div>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <el-select
                  v-if="team.status === 'active' && availableAgents.length > 0"
                  v-model="addMemberId"
                  :placeholder="$t('teams.addMember')"
                  size="small"
                  style="width: 160px"
                >
                  <el-option v-for="agent in availableAgents" :key="agent.id" :label="agent.name" :value="agent.id" />
                </el-select>
                <Button v-if="addMemberId" size="sm" variant="ghost" @click="addMember">{{ $t('teams.add') }}</Button>
                <Button v-if="team.status === 'active'" size="sm" variant="ghost" @click="archiveTeam">
                  {{ $t('teams.archive') }}
                </Button>
              </div>
            </header>

            <div class="flex flex-wrap items-center gap-2">
              <button
                v-for="item in conversations"
                :key="item.id"
                type="button"
                class="rounded-full border px-3 py-1 text-caption"
                :class="item.id === selectedConversationId ? 'border-accent text-fg' : 'border-border-subtle text-fg-muted'"
                @click="selectConversation(item.id)"
              >
                {{ item.title || item.id.slice(0, 8) }}
              </button>
              <div v-if="team.status === 'active'" class="flex items-center gap-1">
                <Input v-model="newConversationTitle" :placeholder="$t('teams.conversationTitle')" class="h-8 w-44" />
                <Button size="sm" variant="ghost" @click="createConversation">
                  <PlusIcon class="size-3.5" />
                  {{ $t('teams.newConversation') }}
                </Button>
              </div>
            </div>

            <div
              v-if="selectedConversation"
              id="conversation-scroll"
              class="flex-1 space-y-3 overflow-y-auto rounded-md border border-border-subtle p-4"
            >
              <EmptyState v-if="messages.length === 0 && !messagesLoading" :title="$t('teams.noMessages')" :description="$t('teams.noMessagesDesc')" />
              <div
                v-for="message in messages"
                :key="message.id"
                class="flex"
                :class="message.role === 'user' ? 'justify-end' : message.role === 'system' ? 'justify-center' : 'justify-start'"
              >
                <div
                  class="max-w-[78%] rounded-lg px-3 py-2"
                  :class="message.role === 'user'
                    ? 'bg-accent text-accent-fg'
                    : message.role === 'system'
                      ? 'border border-border-subtle text-caption text-fg-subtle'
                      : 'bg-surface-raised'"
                >
                  <div v-if="message.role === 'agent'" class="mb-1 flex flex-wrap items-center gap-2">
                    <span class="text-caption font-semibold">{{ memberName(message.agentId) }}</span>
                    <Loader v-if="message.status === 'pending'" :size="12" />
                    <Badge v-else-if="message.status === 'failed'" tone="danger">{{ $t('teams.failed') }}</Badge>
                    <Badge v-else-if="message.status === 'cancelled'" tone="warning">{{ $t('teams.cancelled') }}</Badge>
                  </div>
                  <p class="whitespace-pre-wrap text-body">{{ message.content || (message.status === 'pending' ? $t('teams.thinking') : '') }}</p>
                  <p v-if="message.errorMessage" class="mt-1 text-caption text-danger">{{ message.errorMessage }}</p>
                  <div v-if="message.role === 'user' && message.routing?.selectedAgentId" class="mt-2 text-caption opacity-80">
                    {{ $t('teams.routedTo', { name: memberName(message.routing.selectedAgentId) }) }}
                    <span v-if="message.routing.rationale"> · {{ message.routing.rationale }}</span>
                  </div>
                  <div v-if="message.role !== 'system'" class="mt-2 flex items-center gap-2">
                    <Button
                      v-if="!message.taskId"
                      size="sm"
                      variant="ghost"
                      :disabled="converting === message.id"
                      @click="convertToTask(message)"
                    >
                      {{ $t('teams.convertToTask') }}
                    </Button>
                    <RouterLink v-else :to="`/tasks/${message.taskId}`" class="text-caption underline">
                      {{ $t('teams.openTask') }}
                    </RouterLink>
                  </div>
                </div>
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <el-select v-model="mentionId" clearable :placeholder="$t('teams.mention')" size="small" style="width: 150px">
                  <el-option v-for="member in team.members" :key="member.agentId" :label="member.name" :value="member.agentId" />
                </el-select>
                <span class="text-caption text-fg-subtle">{{ $t('teams.readOnlyHint') }}</span>
              </div>
              <div class="flex items-end gap-2">
                <Textarea
                  v-model="composer"
                  :placeholder="$t('teams.composerPlaceholder')"
                  :rows="2"
                  :disabled="sending || selectedConversation?.status === 'archived' || team.status !== 'active'"
                  @keydown.meta.enter.prevent="sendMessage"
                  @keydown.ctrl.enter.prevent="sendMessage"
                />
                <Button
                  :disabled="sending || !composer.trim() || selectedConversation?.status === 'archived' || team.status !== 'active'"
                  @click="sendMessage"
                >
                  <SendIcon class="size-4" />
                  {{ $t('teams.send') }}
                </Button>
              </div>
            </div>
          </template>
        </section>
      </div>
    </div>

    <el-dialog v-model="newTeamOpen" :title="$t('teams.newTeam')" width="520px">
      <div class="flex flex-col gap-3">
        <Input v-model="newTeamName" :placeholder="$t('teams.namePlaceholder')" />
        <Textarea v-model="newTeamDescription" :placeholder="$t('teams.descriptionPlaceholder')" :rows="2" />
        <div>
          <p class="mb-2 text-label font-semibold">{{ $t('teams.members') }}</p>
          <el-checkbox-group v-model="newTeamMembers" class="flex flex-col gap-1">
            <el-checkbox v-for="agent in agents" :key="agent.id" :value="agent.id">
              {{ agent.name }} · {{ agent.role }}
            </el-checkbox>
          </el-checkbox-group>
          <p v-if="agents.length === 0" class="text-caption text-fg-subtle">{{ $t('teams.noAgents') }}</p>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" @click="newTeamOpen = false">{{ $t('common.cancel') }}</Button>
          <Button :disabled="!newTeamName.trim()" @click="createTeam">{{ $t('teams.create') }}</Button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>
