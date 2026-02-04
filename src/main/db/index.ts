import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import * as schema from './schema'

let db: ReturnType<typeof drizzle<typeof schema>> | null = null
let sqlite: Database.Database | null = null
let encryptionKey: string | null = null

export function getDbPath(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'ownyourchat.db')
}

export function getEncryptionKey(): string | null {
  return encryptionKey
}

/**
 * Check if a database file exists at the default path.
 */
export function databaseFileExists(): boolean {
  return fs.existsSync(getDbPath())
}

/**
 * Apply SQLCipher encryption pragmas to a database connection.
 * Must be called immediately after opening the database, before any other operations.
 */
function applyEncryptionKey(sqliteDb: Database.Database, key: string): void {
  sqliteDb.pragma(`cipher='sqlcipher'`)
  sqliteDb.pragma(`legacy=4`)
  sqliteDb.pragma(`key='${key.replace(/'/g, "''")}'`)
}

/**
 * Verify that the database can be read with the current encryption key.
 * Throws if the key is wrong or the database is corrupted.
 */
function verifyDatabaseAccess(sqliteDb: Database.Database): void {
  // Attempt a simple read to verify the key is correct
  // This will throw "SQLITE_NOTADB" if the key is wrong
  sqliteDb.pragma('schema_version')
}

/**
 * Initialize the database with an encryption key.
 * For new databases, creates an encrypted database.
 * For existing databases, unlocks with the provided key.
 */
export async function initDatabase(key: string): Promise<void> {
  if (db) return

  const dbPath = getDbPath()
  const dbDir = path.dirname(dbPath)

  // Ensure directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  sqlite = new Database(dbPath)

  // Apply encryption key
  applyEncryptionKey(sqlite, key)

  // Verify the key works (throws if wrong key)
  verifyDatabaseAccess(sqlite)

  // Store the key for use by worker threads
  encryptionKey = key

  // Register custom function for Unicode-aware lowercase (SQLite's built-in lower() only handles ASCII)
  sqlite.function('unicode_lower', (str: string | null) => str?.toLowerCase() ?? null)

  db = drizzle(sqlite, { schema })

  // Run migrations (create tables if they don't exist)
  const migrationsFolder = app.isPackaged
    ? path.join(process.resourcesPath, 'migrations')
    : path.join(__dirname, '../../src/main/db/migrations')

  try {
    migrate(db, { migrationsFolder })
    console.log('Database initialized and migrated')
  } catch (error) {
    console.error('Migration failed:', error)
    console.error('Migrations folder is:', migrationsFolder)
  }

  console.log('[DB] Database initialized at', dbPath)
}

export function getDatabase(): ReturnType<typeof drizzle<typeof schema>> {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export function closeDatabase(): void {
  if (sqlite) {
    sqlite.close()
    sqlite = null
    db = null
    encryptionKey = null
  }
}
