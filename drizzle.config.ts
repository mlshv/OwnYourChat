import { defineConfig } from 'drizzle-kit'
import { homedir } from 'os'
import { join } from 'path'

// Electron userData path on macOS
const dbPath = join(homedir(), 'Library/Application Support/ownyourchat/ownyourchat.db')

export default defineConfig({
  schema: './src/main/db/schema.ts',
  out: './src/main/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    // This is for local dev only (drizzle-kit needs it to generate migrations)
    // It doesn't affect where the app puts the DB in production
    url: dbPath
  }
})
