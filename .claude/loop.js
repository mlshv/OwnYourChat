#!/usr/bin/env node
import { spawn } from 'child_process'
import fs from 'fs'

// --- Parse CLI args ---
const parseArgs = () => {
  const args = process.argv.slice(2)
  const result = { prompt: null, plan: null }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prompt' && args[i + 1]) result.prompt = args[++i]
    else if (args[i] === '--plan' && args[i + 1]) result.plan = args[++i]
  }

  return result
}

const showUsage = () => {
  console.log(`Usage: loop.js --prompt <prompt-file> --plan <plan-file>

Example:
  node .claude/loop.js --prompt prompt.md --plan plan.md
`)
  process.exit(1)
}

const { prompt: PROMPT_FILE, plan: PLAN_FILE } = parseArgs()

if (!PROMPT_FILE || !PLAN_FILE) showUsage()

// --- Configuration ---
const MAX_ITERATIONS = 30
const DONE_MARKER = 'STATUS: DONE'

// tools that run without prompting
const ALLOWED_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'LS',
  'Grep',
  'Bash(find:*)',
  'Bash(tree:*)',
  'Bash(git status:*)',
  'Bash(git log:*)',
  'Bash(git diff:*)',
  'Bash(pnpm add:*)',
  'Bash(pnpm install:*)',
  'Bash(pnpm remove:*)'
]

// tools completely blocked
const DISALLOWED_TOOLS = [
  'Bash(git push:*)',
  'Bash(git push --force:*)',
  'Bash(rm -rf:*)',
  'Bash(rm -r:*)'
]

// --- Utils ---
const orange = (text) => `\x1b[38;5;208m${text}\x1b[0m`
const log = (msg) => console.log(`${orange('✦')} ${msg}`)

async function runIteration(iteration) {
  log(`Iteration ${iteration}/${MAX_ITERATIONS}`)

  // 1. Check Exit Condition
  try {
    const planContent = fs.readFileSync(PLAN_FILE, 'utf8')
    if (planContent.includes(DONE_MARKER)) {
      log(`Found "${DONE_MARKER}" in ${PLAN_FILE}. Exiting.`)
      process.exit(0)
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    // If plan.md doesn't exist yet, we continue (Claude might create it)
  }

  // 2. Prepare Context
  // We read prompt.md dynamically each time so you can edit it mid-flight if needed
  if (!fs.existsSync(PROMPT_FILE)) {
    log(`Error: ${PROMPT_FILE} not found.`)
    process.exit(1)
  }

  // We just cat the file into the process, but we also need to append
  // the context about the plan so Claude knows what to do.
  // The user asked to "pass prompt.md directly", but for the loop to work
  // (Ralph style), we usually need to inject the Plan state too.
  // However, strict adherence to "pass prompt.md directly":
  const promptContent = fs.readFileSync(PROMPT_FILE, 'utf8')

  // NOTE: If prompt.md doesn't reference plan.md, Claude won't know to check it.
  // Ensure your prompt.md includes: "Check plan.md, do next step, update plan.md"

  // 3. Spawn Claude
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      promptContent,
      ...ALLOWED_TOOLS.flatMap((t) => ['--allowedTools', t]),
      ...DISALLOWED_TOOLS.flatMap((t) => ['--disallowedTools', t])
    ]

    const claude = spawn('claude', args, {
      stdio: ['inherit', 'inherit', 'inherit']
    })

    claude.on('close', (code) => {
      if (code !== 0) {
        log(`Claude exited with code ${code}`)
        // We generally continue unless it's a fatal error,
        // but a non-zero exit might just mean it failed a task.
      }
      resolve()
    })

    claude.on('error', (err) => {
      log(`Failed to start Claude: ${err.message}`)
      reject(err)
    })
  })
}

async function main() {
  log(`Starting Autonomous Loop`)
  log(`Target: ${PROMPT_FILE}`)

  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    await runIteration(i)

    // Safety pause to let you Ctrl+C if things go haywire
    await new Promise((r) => setTimeout(r, 2000))
  }

  log(`Max iterations (${MAX_ITERATIONS}) reached.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
