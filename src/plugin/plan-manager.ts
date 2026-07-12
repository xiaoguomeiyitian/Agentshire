/**
 * PlanManager — server-side plan state for multi-agent project workflows.
 *
 * The steward calls `create_plan` to register a structured plan, then
 * `next_step` after each batch completes. Sub-agent completions are
 * auto-matched to plan steps via label/displayName.
 */
import { isLabelBusy } from './subagent-tracker.js'
import { getActiveTownSessionId } from './ws-server.js'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface CitizenRosterEntry {
  specialty: string
  role: string
  bio: string
  soulFilePath: string
}

export interface PlanAgent {
  name: string
  task: string
  files?: string[]
  status: 'pending' | 'running' | 'completed' | 'failed'
}

export interface PlanStep {
  id: string
  description: string
  agents: PlanAgent[]
  /** Batch number (1-based). Steps with the same batch run concurrently. */
  batch: number
}

export interface ProjectPlan {
  name: string
  type: string
  projectDir: string
  citizenRoster: Map<string, CitizenRosterEntry>
  steps: PlanStep[]
  currentStepIndex: number
  createdAt: number
  townSessionId: string
}

const activePlans = new Map<string, ProjectPlan>()
let lastPlanName: string | null = null

interface ActiveTask {
  name: string
  taskDir: string
  status: 'pending' | 'completed'
  createdAt: number
}

const activeTasks = new Map<string, ActiveTask>()

export function registerTask(name: string, taskDir: string): void {
  activeTasks.set(name, { name, taskDir, status: 'pending', createdAt: Date.now() })
  console.log(`[PlanManager] Task registered: "${name}" → ${taskDir}`)
}

export function completeTask(name: string): void {
  const task = activeTasks.get(name)
  if (task) {
    task.status = 'completed'
    console.log(`[PlanManager] Task completed: "${name}"`)
  }
}

export function hasActiveTasks(): boolean {
  for (const task of activeTasks.values()) {
    if (task.status === 'pending') return true
  }
  return false
}

export function clearTasks(): void {
  activeTasks.clear()
}

export function createPlan(
  name: string,
  type: string,
  projectDir: string,
  citizenRoster: Map<string, CitizenRosterEntry>,
  steps: Array<{ id: string; description: string; agents: Array<{ name: string; task: string; files?: string[] }>; batch?: number }>,
): string {
  if (steps.length === 0) {
    return 'Error: plan must have at least one step.'
  }

  for (const s of steps) {
    if (s.agents.length > 1) {
      const agentsWithFiles = s.agents.filter(a => a.files && a.files.length > 0)
      if (agentsWithFiles.length > 0) {
        const allFiles = agentsWithFiles.flatMap(a => a.files ?? [])
        const seen = new Set<string>()
        for (const f of allFiles) {
          if (seen.has(f)) {
            const conflicting = agentsWithFiles.filter(a => (a.files ?? []).includes(f)).map(a => a.name).join(' 和 ')
            return `Error: step "${s.id}" — "${f}" is claimed by both ${conflicting}. ` +
              `Split into non-overlapping subdirectories.`
          }
          seen.add(f)
        }
      }
    }
  }

  const plan: ProjectPlan = {
    name,
    type,
    projectDir,
    citizenRoster,
    steps: [
      ...steps.map((s, i) => ({
        id: s.id,
        description: s.description,
        batch: Number(s.batch) || (i + 1),
        agents: s.agents.map(a => ({ name: a.name ?? '', task: a.task ?? '', files: a.files, status: 'pending' as const })),
      })),
      {
        id: COMPLETE_STEP_ID,
        description: '宣布完成 — 调用 mission_complete',
        agents: [],
        batch: steps.length + 1,
      },
    ],
    currentStepIndex: 0,
    createdAt: Date.now(),
    townSessionId: getActiveTownSessionId() ?? 'unknown',
  }

  activePlans.set(name, plan)
  lastPlanName = name

  console.log(`[PlanManager] Plan created: "${name}" (${type}), ${steps.length} steps + mission_complete, projectDir: ${projectDir}, total plans: ${activePlans.size}`)
  return formatPlanCreated(plan)
}

export function getNextStepInstruction(planName?: string): string {
  const key = planName ?? lastPlanName
  if (!key) return 'No active plan. Call create_plan first for complex multi-agent projects.'
  const plan = activePlans.get(key)
  if (!plan) return `No plan found with name "${key}".`
  reconcileRunningAgents(plan)
  return formatNextStep(plan)
}

function reconcileRunningAgents(plan: ProjectPlan): void {
  for (const step of plan.steps) {
    for (const agent of step.agents) {
      if (agent.status === 'running' && !isLabelBusy(agent.name ?? '')) {
        console.warn(`[PlanManager] ⚠️ "${agent.name}" is running in plan "${plan.name}" step "${step.id}" but not tracked by subagent-tracker — keeping status as running (tracker may not have registered yet)`)
      }
    }
  }
}

export function onAgentCompleted(label: string, success: boolean): void {
  if (activePlans.size === 0) return

  const currentSession = getActiveTownSessionId()
  const normalizedLabel = label.trim().toLowerCase()

  for (const plan of activePlans.values()) {
    if (currentSession && plan.townSessionId !== currentSession) continue
    for (const step of plan.steps) {
      for (const agent of step.agents) {
        if ((agent.name ?? '').trim().toLowerCase() === normalizedLabel && (agent.status === 'pending' || agent.status === 'running')) {
          agent.status = success ? 'completed' : 'failed'
          console.log(`[PlanManager] Agent "${label}" marked ${agent.status} in plan "${plan.name}" step "${step.id}" (session: ${plan.townSessionId})`)
          return
        }
      }
    }
  }
}

export function onAgentStarted(label: string): void {
  if (activePlans.size === 0) return

  const currentSession = getActiveTownSessionId()
  const normalizedLabel = label.trim().toLowerCase()

  for (const plan of activePlans.values()) {
    if (currentSession && plan.townSessionId !== currentSession) continue
    for (const step of plan.steps) {
      for (const agent of step.agents) {
        if ((agent.name ?? '').trim().toLowerCase() === normalizedLabel && agent.status === 'pending') {
          agent.status = 'running'
          return
        }
      }
    }
  }
}

export function clearPlan(): void {
  activePlans.clear()
  lastPlanName = null
  activeTasks.clear()
}

export function cleanupStaleSessionPlans(currentSessionId: string): void {
  let cleaned = 0
  for (const [name, plan] of activePlans) {
    if (plan.townSessionId !== currentSessionId) {
      activePlans.delete(name)
      cleaned++
    }
  }
  for (const [name, task] of activeTasks) {
    if ((task as any).townSessionId && (task as any).townSessionId !== currentSessionId) {
      activeTasks.delete(name)
      cleaned++
    }
  }
  if (cleaned > 0) {
    console.log(`[PlanManager] Cleaned up ${cleaned} stale plan/task entries from previous sessions`)
  }
}

export function hasActivePlan(): boolean {
  return activePlans.size > 0
}

export function completePlan(planName?: string): void {
  const key = planName ?? lastPlanName
  if (!key) return
  if (activePlans.has(key)) {
    activePlans.delete(key)
    console.log(`[PlanManager] Plan "${key}" completed and removed`)
  }
  if (lastPlanName === key) {
    lastPlanName = activePlans.size > 0 ? Array.from(activePlans.keys()).pop()! : null
  }
}

export function isCurrentBatchDone(): boolean {
  if (activePlans.size === 0) return false
  for (const plan of activePlans.values()) {
    if (isPlanBatchDone(plan)) return true
  }
  return false
}

export function getActivePlan(): ProjectPlan | null {
  if (!lastPlanName) return null
  return activePlans.get(lastPlanName) ?? null
}

export function getAllActivePlans(): ProjectPlan[] {
  return Array.from(activePlans.values())
}

export interface WhiteboardPlanSnapshot {
  name: string
  type: string
  steps: Array<{
    id: string
    description: string
    agents: Array<{ name: string; status: string }>
  }>
}

export function snapshotPlansForDisplay(sessionId?: string): WhiteboardPlanSnapshot[] {
  const result: WhiteboardPlanSnapshot[] = []
  for (const plan of activePlans.values()) {
    if (sessionId && plan.townSessionId !== sessionId) continue
    result.push({
      name: plan.name,
      type: plan.type,
      steps: plan.steps
        .filter(s => s.id !== COMPLETE_STEP_ID)
        .map(s => ({
          id: s.id,
          description: s.description,
          agents: s.agents.map(a => ({ name: a.name, status: a.status })),
        })),
    })
  }
  return result
}

export function isPlanFullyComplete(): boolean {
  if (hasActiveTasks()) return false
  if (activePlans.size === 0) return true
  for (const plan of activePlans.values()) {
    const allDone = plan.steps
      .filter(s => s.id !== COMPLETE_STEP_ID)
      .every(s => s.agents.every(a => a.status === 'completed' || a.status === 'failed'))
    if (!allDone) return false
  }
  return true
}

function isPlanBatchDone(plan: ProjectPlan): boolean {
  const startedBatches = new Set(
    plan.steps
      .filter(s => !isCompleteStep(s) && isStepStarted(s))
      .map(s => s.batch),
  )
  for (const b of startedBatches) {
    const batchSteps = plan.steps.filter(s => s.batch === b && !isCompleteStep(s))
    if (batchSteps.every(s => isStepDone(s))) return true
  }
  return false
}

const COMPLETE_STEP_ID = '_complete'

function isCompleteStep(step: PlanStep): boolean {
  return step.id === COMPLETE_STEP_ID
}

function isStepDone(step: PlanStep): boolean {
  if (isCompleteStep(step)) return false
  return step.agents.every(a => a.status === 'completed' || a.status === 'failed')
}


function isStepStarted(step: PlanStep): boolean {
  return step.agents.some(a => a.status !== 'pending')
}

function readUpstreamDocs(projectDir: string): string {
  try {
    if (!existsSync(projectDir)) return ''
    const docNames = ['MODULES.md', 'SPEC.md', 'visual.md', 'DESIGN.md', 'STYLE.md']
    const parts: string[] = []
    for (const name of docNames) {
      const p = join(projectDir, name)
      if (existsSync(p)) {
        try {
          const content = readFileSync(p, 'utf-8').trim()
          if (content) parts.push(`### ${name}\n${content}`)
        } catch {}
      }
    }
    return parts.join('\n\n')
  } catch {
    return ''
  }
}

function isLaterBatch(plan: ProjectPlan, stepIndex: number): boolean {
  const step = plan.steps[stepIndex]
  if (!step || isCompleteStep(step)) return false
  const businessSteps = plan.steps.filter(s => !isCompleteStep(s))
  if (businessSteps.length <= 2) return false
  const minBatch = Math.min(...businessSteps.map(s => s.batch))
  return step.batch > minBatch + 1
}

function isLastBusinessBatch(plan: ProjectPlan, stepIndex: number): boolean {
  const step = plan.steps[stepIndex]
  if (!step || isCompleteStep(step)) return false
  const businessBatches = new Set(plan.steps.filter(s => !isCompleteStep(s)).map(s => s.batch))
  return step.batch === Math.max(...businessBatches)
}

function buildEnrichedTask(agent: PlanAgent, plan: ProjectPlan, stepIndex: number): string {
  const citizen = plan.citizenRoster.get(agent.name ?? '')
  const sections: string[] = []

  if (citizen) {
    sections.push(
      `## 角色\n你是${agent.name}，${citizen.role}。\n` +
      `请先阅读你的角色人设文件了解自己的性格和专长:\n${citizen.soulFilePath}`,
    )
  }

  sections.push(
    `## 项目\n项目目录: ${plan.projectDir}\n` +
    `请先阅读项目说明文件了解项目背景和前序工作: ${plan.projectDir}/PROJECT.md`,
  )

  sections.push(`## 任务\n${agent.task}`)

  if (agent.files && agent.files.length > 0) {
    const fileList = agent.files
      .map(f => (f.startsWith('/') ? f : `${plan.projectDir}/${f}`))
      .map(f => `- ${f}`)
      .join('\n')
    sections.push(
      `## 文件边界（强制）\n` +
      `你只能创建或修改以下目录/文件中的内容：\n${fileList}\n\n` +
      `【红线】严禁修改上述范围以外的任何文件。如需与其他模块对接，在自己的目录内创建新文件。`,
    )
  }

  const upstreamDocs = readUpstreamDocs(plan.projectDir)

  if (isLastBusinessBatch(plan, stepIndex) && upstreamDocs) {
    sections.push(
      `## 上游产出（验收依据）\n${upstreamDocs}\n\n` +
      `## 验收清单（必须逐项完成）\n` +
      `1. 阅读设计文档（SPEC.md / DESIGN.md），逐条核对功能是否实现\n` +
      `2. 打开入口文件（index.html），确认页面能正常加载无报错\n` +
      `3. 操作核心功能，确认可交互、无白屏、无控制台报错\n` +
      `4. 若有视觉规范（visual.md / STYLE.md），核对配色、字体、布局是否符合\n` +
      `5. 检查各模块的 import/引用路径是否正确连通\n` +
      `6. 发现问题必须修复，不能只报告不动手——你是最后一道关`,
    )
  } else if (isLaterBatch(plan, stepIndex) && upstreamDocs) {
    sections.push(
      `## 上游产出（必须基于这些文档开发）\n${upstreamDocs}\n\n` +
      `- 必须在骨架已有的目录结构上开发，禁止创建模块定义中未定义的新目录\n` +
      `- 按模块定义中的分工建议，在对应目录下实现功能`,
    )
  }

  sections.push(
    `## 通用规则\n` +
    `- 所有产出必须用 write/edit 工具写入项目目录（${plan.projectDir}）中的文件，不要直接输出到对话中\n` +
    `- 开始前先查看项目目录结构和 PROJECT.md\n` +
    `- 新建文件、整文件重写、大段内容生成时优先使用 write；只有在小范围精确替换已有内容时才使用 edit\n` +
    `- 使用 edit 前必须先 read 目标文件；edit 时统一使用 old_string/new_string，不要混用 oldText/newText 或 oldString/newText 等参数名\n` +
    `- old_string 必须直接复制自刚刚 read 到的原文，必须与文件内容完全一致，包括空格、缩进和换行；如果做不到精确匹配，就改用 write 重写文件\n` +
    `- 完成修改后，如有必要再 read 一次确认结果，不要凭记忆假设编辑已经成功`,
  )

  return sections.join('\n\n')
}

function formatPlanCreated(plan: ProjectPlan): string {
  const lines: string[] = [
    `Plan created: "${plan.name}" (${plan.type}), ${plan.steps.length} steps.`,
    `Project directory: ${plan.projectDir}`,
    '',
  ]

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]
    const num = circledNumber(i + 1)
    if (isCompleteStep(step)) {
      lines.push(`${num} ${step.description}`)
    } else {
      const agentNames = step.agents.map(a => a.name).join(', ')
      lines.push(`${num} [batch ${step.batch}] ${step.description} — ${agentNames}`)
    }
  }

  const firstBatch = getFirstBatchIndices(plan)
  const batchDesc = firstBatch.map(i => circledNumber(i + 1)).join('')

  lines.push('')
  lines.push(`Start step ${batchDesc} now. After each batch completes, call next_step() for instructions.`)
  lines.push('')
  lines.push('IMPORTANT: When spawning agents, copy the enriched task from next_step() output as-is — it includes role persona, project path, and file boundaries.')

  return lines.join('\n')
}

function formatNextStep(plan: ProjectPlan): string {
  const doneSteps: number[] = []
  const inProgressSteps: number[] = []
  const pendingSteps: number[] = []

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]
    if (isStepDone(step)) doneSteps.push(i)
    else if (isStepStarted(step)) inProgressSteps.push(i)
    else pendingSteps.push(i)
  }

  if (inProgressSteps.length > 0) {
    const lines: string[] = []
    for (const i of inProgressSteps) {
      const step = plan.steps[i]
      const done = step.agents.filter(a => a.status === 'completed' || a.status === 'failed').length
      const waiting = step.agents.filter(a => a.status === 'running' || a.status === 'pending').map(a => a.name)
      lines.push(`Step ${circledNumber(i + 1)} "${step.description}": ${done}/${step.agents.length} done. Waiting: ${waiting.join(', ')}`)
    }
    lines.push('')
    lines.push('Current batch still in progress. Wait for agents to finish, then call next_step() again.')
    return lines.join('\n')
  }

  if (pendingSteps.length === 0) {
    return formatAllDone(plan)
  }

  const nextBatch = getNextBatchIndices(plan)
  if (nextBatch.length === 0) {
    return formatAllDone(plan)
  }

  if (nextBatch.length === 1 && isCompleteStep(plan.steps[nextBatch[0]])) {
    return formatAllDone(plan)
  }

  const lines: string[] = []

  if (doneSteps.length > 0) {
    const doneLabels = doneSteps.map(i => `${circledNumber(i + 1)} ${plan.steps[i].description}`).join(', ')
    lines.push(`✅ Done: ${doneLabels}`)
    lines.push('')
    lines.push(
      `⚠️ 在 spawn 下一批之前，先更新 ${plan.projectDir}/PROJECT.md 的「变更记录」，` +
      `记录刚完成的步骤产出了哪些文件、做了什么。这样下一批居民才能了解前序工作。`,
    )
    lines.push('')
  }

  lines.push(`→ Next: step ${nextBatch.map(i => circledNumber(i + 1)).join('')}`)
  lines.push('')

  for (const i of nextBatch) {
    const step = plan.steps[i]
    if (isCompleteStep(step)) continue
    lines.push(`  Step ${circledNumber(i + 1)} "${step.description}":`)
    for (const agent of step.agents) {
      const enrichedTask = buildEnrichedTask(agent, plan, i)
      if (isLabelBusy(agent.name ?? '')) {
        lines.push(`    ⚠️ ${agent.name} is busy — spawn WITHOUT label (temp worker):`)
        lines.push(`    → sessions_spawn({ task: ${JSON.stringify(enrichedTask)} })`)
      } else {
        lines.push(`    → sessions_spawn({ label: "${agent.name}", task: ${JSON.stringify(enrichedTask)} })`)
      }
    }
    lines.push('')
  }

  const remainingWork = plan.steps.filter((s, i) => !isCompleteStep(s) && !doneSteps.includes(i) && !nextBatch.includes(i)).length
  if (remainingWork > 0) {
    lines.push(`After this batch: ${remainingWork} more step(s), then mission_complete.`)
  } else {
    lines.push('This is the last batch before mission_complete. After it completes, call next_step().')
  }

  return lines.join('\n')
}

function formatAllDone(plan: ProjectPlan): string {
  const hasFailures = plan.steps.some(s => !isCompleteStep(s) && s.agents.some(a => a.status === 'failed'))

  const lines: string[] = [
    '✅ All steps completed!',
    '',
  ]

  if (hasFailures) {
    lines.push('⚠️ Some agents failed. Review results before completing.')
    lines.push('')
  }

  if (['game', 'app', 'website'].includes(plan.type)) {
    lines.push(
      `Call mission_complete({ type: "${plan.type}", name: "${plan.name}", summary: "brief summary of what was built", files: ["${plan.projectDir}/index.html"] }) NOW.`,
    )
  } else if (plan.type === 'media' || plan.type === 'files') {
    lines.push(
      `Call mission_complete({ type: "${plan.type}", name: "${plan.name}", summary: "brief summary", files: ["path/to/output"] }) NOW.`,
    )
  } else {
    lines.push(
      `Call mission_complete({ type: "${plan.type}", name: "${plan.name}", summary: "brief summary" }) NOW.`,
    )
  }

  return lines.join('\n')
}

function getFirstBatchIndices(plan: ProjectPlan): number[] {
  const businessSteps = plan.steps.filter(s => !isCompleteStep(s))
  if (businessSteps.length === 0) return []
  const minBatch = Math.min(...businessSteps.map(s => s.batch))
  return plan.steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !isCompleteStep(s) && s.batch === minBatch)
    .map(({ i }) => i)
}

function getNextBatchIndices(plan: ProjectPlan): number[] {
  const pendingSteps = plan.steps.filter(s => !isCompleteStep(s) && !isStepDone(s))
  if (pendingSteps.length === 0) return []
  const minPendingBatch = Math.min(...pendingSteps.map(s => s.batch))
  const allLowerDone = plan.steps
    .filter(s => !isCompleteStep(s) && s.batch < minPendingBatch)
    .every(s => isStepDone(s))
  if (!allLowerDone) return []
  return plan.steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !isCompleteStep(s) && s.batch === minPendingBatch && !isStepDone(s))
    .map(({ i }) => i)
}

function circledNumber(n: number): string {
  const nums = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
  return nums[n - 1] ?? `(${n})`
}
