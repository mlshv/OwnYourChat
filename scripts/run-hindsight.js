#!/usr/bin/env node

const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

// Load environment variables from .env file
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env')

  if (!fs.existsSync(envPath)) {
    console.error('Error: .env file not found')
    console.error('Please create a .env file in the project root with:')
    console.error('OPENAI_API_KEY=your-api-key-here')
    console.error('HINDSIGHT_API_LLM_MODEL=o3-mini (optional)')
    process.exit(1)
  }

  const envContent = fs.readFileSync(envPath, 'utf-8')
  const envVars = {}

  envContent.split('\n').forEach(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return

    const [key, ...valueParts] = trimmed.split('=')
    const value = valueParts.join('=').trim()

    if (key && value) {
      envVars[key.trim()] = value.replace(/^["']|["']$/g, '')
    }
  })

  return envVars
}

function runHindsight() {
  const envVars = loadEnv()

  const apiKey = envVars.OPENAI_API_KEY || process.env.OPENAI_API_KEY
  const model = envVars.HINDSIGHT_API_LLM_MODEL || process.env.HINDSIGHT_API_LLM_MODEL || 'o3-mini'

  if (!apiKey) {
    console.error('Error: OPENAI_API_KEY not found in .env file or environment')
    process.exit(1)
  }

  const homeDir = process.env.HOME || process.env.USERPROFILE
  const volumePath = `${homeDir}/.hindsight-docker:/home/hindsight/.pg0`

  const args = [
    'run',
    '--rm',
    '-it',
    '--pull', 'always',
    '-p', '8888:8888',
    '-p', '9999:9999',
    '-e', `HINDSIGHT_API_LLM_API_KEY=${apiKey}`,
    '-e', `HINDSIGHT_API_LLM_MODEL=${model}`,
    '-v', volumePath,
    'ghcr.io/vectorize-io/hindsight:latest'
  ]

  console.log('Starting Hindsight server...')
  console.log(`Model: ${model}`)
  console.log(`Volume: ${volumePath}`)
  console.log('')

  // Use podman instead of docker
  const containerRuntime = 'podman'
  const container = spawn(containerRuntime, args, {
    stdio: 'inherit',
    shell: true
  })

  container.on('error', (error) => {
    console.error(`Failed to start ${containerRuntime}:`, error.message)
    console.error(`Make sure ${containerRuntime} is installed and running`)
    process.exit(1)
  })

  container.on('close', (code) => {
    if (code !== 0) {
      console.error(`${containerRuntime} process exited with code ${code}`)
    }
    process.exit(code)
  })

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    console.log('\nStopping Hindsight server...')
    container.kill('SIGTERM')
  })

  process.on('SIGTERM', () => {
    container.kill('SIGTERM')
  })
}

runHindsight()
