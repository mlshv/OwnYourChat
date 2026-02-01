/**
 * WebAuthn Handler for Main Process
 *
 * Handles WebAuthn requests from provider WebContentsViews using
 * the electron-webauthn library which provides native macOS passkey support.
 */

import { ipcMain } from 'electron'
import {
  createCredential,
  getCredential,
  type CreateCredentialSuccessData,
  type GetCredentialSuccessData
} from 'electron-webauthn'
import { IPC_CHANNELS } from '@shared/types'
import { getMainWindow } from '../index'

// Helper to convert base64 to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = Buffer.from(base64, 'base64')
  return new Uint8Array(binary)
}

// Type definitions for WebAuthn options (since we're in Node.js context)
type SerializedPublicKeyCredentialCreationOptions = {
  challenge: string // base64
  rp: { id?: string; name: string }
  user: { id: string; name: string; displayName: string } // id is base64
  pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>
  timeout?: number
  excludeCredentials?: Array<{
    type: 'public-key'
    id: string // base64
    transports?: string[]
  }>
  authenticatorSelection?: {
    authenticatorAttachment?: string
    residentKey?: string
    requireResidentKey?: boolean
    userVerification?: string
  }
  attestation?: string
  extensions?: Record<string, unknown>
}

type SerializedPublicKeyCredentialRequestOptions = {
  challenge: string // base64
  timeout?: number
  rpId?: string
  allowCredentials?: Array<{
    type: 'public-key'
    id: string // base64
    transports?: string[]
  }>
  userVerification?: string
  extensions?: Record<string, unknown>
}

// Deserialize options from preload script (base64 strings to Uint8Arrays)
function deserializeCreationOptions(serialized: SerializedPublicKeyCredentialCreationOptions): unknown {
  return {
    challenge: base64ToUint8Array(serialized.challenge),
    rp: serialized.rp,
    user: {
      id: base64ToUint8Array(serialized.user.id),
      name: serialized.user.name,
      displayName: serialized.user.displayName
    },
    pubKeyCredParams: serialized.pubKeyCredParams,
    timeout: serialized.timeout,
    excludeCredentials: serialized.excludeCredentials?.map((cred) => ({
      type: cred.type,
      id: base64ToUint8Array(cred.id),
      transports: cred.transports
    })),
    authenticatorSelection: serialized.authenticatorSelection,
    attestation: serialized.attestation,
    extensions: serialized.extensions
  }
}

function deserializeRequestOptions(serialized: SerializedPublicKeyCredentialRequestOptions): unknown {
  return {
    challenge: base64ToUint8Array(serialized.challenge),
    timeout: serialized.timeout,
    rpId: serialized.rpId,
    allowCredentials: serialized.allowCredentials?.map((cred) => ({
      type: cred.type,
      id: base64ToUint8Array(cred.id),
      transports: cred.transports
    })),
    userVerification: serialized.userVerification,
    extensions: serialized.extensions
  }
}

// Serialize create credential response for IPC
function serializeCreateResponse(data: CreateCredentialSuccessData): Record<string, unknown> {
  return {
    id: data.credentialId,
    rawId: data.credentialId,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: data.clientDataJSON,
      attestationObject: data.attestationObject,
      authenticatorData: data.authData,
      publicKey: data.publicKey,
      publicKeyAlgorithm: data.publicKeyAlgorithm,
      transports: data.transports
    },
    clientExtensionResults: data.extensions || {}
  }
}

// Serialize get credential response for IPC
function serializeGetResponse(data: GetCredentialSuccessData): Record<string, unknown> {
  return {
    id: data.credentialId,
    rawId: data.credentialId,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: data.clientDataJSON,
      authenticatorData: data.authenticatorData,
      signature: data.signature,
      userHandle: data.userHandle
    },
    clientExtensionResults: data.extensions || {}
  }
}

export function setupWebAuthnHandlers(): void {
  console.log('[WebAuthn] Setting up IPC handlers')

  // Handle credential creation (registration)
  ipcMain.handle(
    IPC_CHANNELS.WEBAUTHN_CREATE,
    async (
      _event,
      data: { options: SerializedPublicKeyCredentialCreationOptions; origin: string }
    ): Promise<{
      success: boolean
      data?: Record<string, unknown>
      error?: { name: string; message: string }
    }> => {
      console.log('[WebAuthn] Create credential request from:', data.origin)

      try {
        // Get the main window for the native handle
        const mainWindow = getMainWindow()

        if (!mainWindow) {
          return {
            success: false,
            error: { name: 'NotAllowedError', message: 'No window available for WebAuthn' }
          }
        }

        const options = deserializeCreationOptions(data.options)

        // Call electron-webauthn to create credential
        // Use type assertion since electron-webauthn expects browser types
        const result = await createCredential(
          options as Parameters<typeof createCredential>[0],
          {
            currentOrigin: data.origin,
            topFrameOrigin: data.origin,
            nativeWindowHandle: mainWindow.getNativeWindowHandle()
          }
        )

        if (!result.success) {
          console.error('[WebAuthn] Create credential failed:', result.error)
          return {
            success: false,
            error: {
              name: result.error,
              message: result.errorObject?.message || `WebAuthn error: ${result.error}`
            }
          }
        }

        console.log('[WebAuthn] Credential created successfully')
        return {
          success: true,
          data: serializeCreateResponse(result.data)
        }
      } catch (error) {
        console.error('[WebAuthn] Create credential error:', error)
        return {
          success: false,
          error: {
            name: 'NotAllowedError',
            message: error instanceof Error ? error.message : 'Unknown error'
          }
        }
      }
    }
  )

  // Handle credential retrieval (authentication)
  ipcMain.handle(
    IPC_CHANNELS.WEBAUTHN_GET,
    async (
      _event,
      data: { options: SerializedPublicKeyCredentialRequestOptions; origin: string }
    ): Promise<{
      success: boolean
      data?: Record<string, unknown>
      error?: { name: string; message: string }
    }> => {
      console.log('[WebAuthn] Get credential request from:', data.origin)

      try {
        // Get the main window for the native handle
        const mainWindow = getMainWindow()

        if (!mainWindow) {
          return {
            success: false,
            error: { name: 'NotAllowedError', message: 'No window available for WebAuthn' }
          }
        }

        const options = deserializeRequestOptions(data.options)

        // Call electron-webauthn to get credential
        // Use type assertion since electron-webauthn expects browser types
        const result = await getCredential(
          options as Parameters<typeof getCredential>[0],
          {
            currentOrigin: data.origin,
            topFrameOrigin: data.origin,
            nativeWindowHandle: mainWindow.getNativeWindowHandle()
          }
        )

        if (!result.success) {
          console.error('[WebAuthn] Get credential failed:', result.error)
          return {
            success: false,
            error: {
              name: result.error,
              message: result.errorObject?.message || `WebAuthn error: ${result.error}`
            }
          }
        }

        console.log('[WebAuthn] Credential retrieved successfully')
        return {
          success: true,
          data: serializeGetResponse(result.data)
        }
      } catch (error) {
        console.error('[WebAuthn] Get credential error:', error)
        return {
          success: false,
          error: {
            name: 'NotAllowedError',
            message: error instanceof Error ? error.message : 'Unknown error'
          }
        }
      }
    }
  )
}
