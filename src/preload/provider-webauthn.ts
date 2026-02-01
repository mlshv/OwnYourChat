/**
 * Provider WebAuthn Preload Script
 *
 * This preload script is used for provider WebContentsViews (ChatGPT, Claude, Perplexity)
 * to enable WebAuthn/passkey support on macOS by intercepting navigator.credentials calls
 * and forwarding them to the main process which uses native macOS APIs.
 */

import { contextBridge, ipcRenderer } from 'electron'

// IPC channel names (must match IPC_CHANNELS in shared/types.ts)
const WEBAUTHN_CREATE = 'webauthn:create'
const WEBAUTHN_GET = 'webauthn:get'

// Helper to convert ArrayBuffer to base64
function arrayBufferToBase64(buffer: ArrayBuffer | ArrayBufferLike): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

// Helper to convert base64 to ArrayBuffer
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

// Type for serialized options
type SerializedOptions = Record<string, unknown>

// Serialize PublicKeyCredentialCreationOptions for IPC
function serializeCreationOptions(options: CredentialCreationOptions): SerializedOptions | null {
  if (!options.publicKey) return null

  const pk = options.publicKey

  return {
    challenge: arrayBufferToBase64(pk.challenge as ArrayBuffer),
    rp: pk.rp,
    user: pk.user
      ? {
          id: arrayBufferToBase64(pk.user.id as ArrayBuffer),
          name: pk.user.name,
          displayName: pk.user.displayName
        }
      : undefined,
    pubKeyCredParams: pk.pubKeyCredParams,
    timeout: pk.timeout,
    excludeCredentials: pk.excludeCredentials?.map((cred) => ({
      type: cred.type,
      id: arrayBufferToBase64(cred.id as ArrayBuffer),
      transports: cred.transports
    })),
    authenticatorSelection: pk.authenticatorSelection,
    attestation: pk.attestation,
    extensions: pk.extensions
  }
}

// Serialize PublicKeyCredentialRequestOptions for IPC
function serializeRequestOptions(options: CredentialRequestOptions): SerializedOptions | null {
  if (!options.publicKey) return null

  const pk = options.publicKey

  return {
    challenge: arrayBufferToBase64(pk.challenge as ArrayBuffer),
    timeout: pk.timeout,
    rpId: pk.rpId,
    allowCredentials: pk.allowCredentials?.map((cred) => ({
      type: cred.type,
      id: arrayBufferToBase64(cred.id as ArrayBuffer),
      transports: cred.transports
    })),
    userVerification: pk.userVerification,
    extensions: pk.extensions
  }
}

// Type for the IPC response
type WebAuthnResponse = {
  success: boolean
  data?: {
    id: string
    rawId: string
    type: string
    authenticatorAttachment: string
    response: {
      clientDataJSON: string
      attestationObject?: string
      authenticatorData?: string
      signature?: string
      userHandle?: string | null
      publicKey?: string
      publicKeyAlgorithm?: number
      transports?: string[]
    }
    clientExtensionResults: Record<string, unknown>
  }
  error?: { name: string; message: string }
}

// Deserialize credential response from IPC
function deserializeCredential(data: NonNullable<WebAuthnResponse['data']>): PublicKeyCredential {
  const responseData = data.response

  // Build the response object based on what fields are present
  const responseObj: Record<string, unknown> = {
    clientDataJSON: base64ToArrayBuffer(responseData.clientDataJSON)
  }

  // Registration response fields
  if (responseData.attestationObject) {
    responseObj.attestationObject = base64ToArrayBuffer(responseData.attestationObject)
    // Add methods for AuthenticatorAttestationResponse
    responseObj.getTransports = () => responseData.transports || []
    responseObj.getPublicKey = () =>
      responseData.publicKey ? base64ToArrayBuffer(responseData.publicKey) : null
    responseObj.getPublicKeyAlgorithm = () => responseData.publicKeyAlgorithm || -7
    responseObj.getAuthenticatorData = () =>
      responseData.authenticatorData
        ? base64ToArrayBuffer(responseData.authenticatorData)
        : new ArrayBuffer(0)
  }

  // Authentication response fields
  if (responseData.authenticatorData && responseData.signature) {
    responseObj.authenticatorData = base64ToArrayBuffer(responseData.authenticatorData)
    responseObj.signature = base64ToArrayBuffer(responseData.signature)
    responseObj.userHandle =
      responseData.userHandle != null ? base64ToArrayBuffer(responseData.userHandle) : null
  }

  // Create the credential object
  const credential = {
    id: data.id,
    rawId: base64ToArrayBuffer(data.rawId),
    type: data.type,
    authenticatorAttachment: data.authenticatorAttachment,
    response: responseObj,
    getClientExtensionResults: () => data.clientExtensionResults || {}
  }

  return credential as unknown as PublicKeyCredential
}

// The WebAuthn bridge API exposed to the page
const webauthnBridge = {
  async create(optionsJson: string): Promise<string> {
    const options = JSON.parse(optionsJson) as CredentialCreationOptions

    // Restore ArrayBuffers from base64
    if (options.publicKey) {
      options.publicKey.challenge = base64ToArrayBuffer(
        options.publicKey.challenge as unknown as string
      )
      if (options.publicKey.user) {
        options.publicKey.user.id = base64ToArrayBuffer(
          options.publicKey.user.id as unknown as string
        )
      }
      if (options.publicKey.excludeCredentials) {
        options.publicKey.excludeCredentials = options.publicKey.excludeCredentials.map((cred) => ({
          ...cred,
          id: base64ToArrayBuffer(cred.id as unknown as string)
        }))
      }
    }

    const serializedOptions = serializeCreationOptions(options)
    if (!serializedOptions) {
      throw new Error('Invalid options: missing publicKey')
    }

    const result = (await ipcRenderer.invoke(WEBAUTHN_CREATE, {
      options: serializedOptions,
      origin: window.location.origin
    })) as WebAuthnResponse

    if (!result.success) {
      const error = new DOMException(
        result.error?.message || 'WebAuthn operation failed',
        result.error?.name || 'NotAllowedError'
      )
      throw error
    }

    const credential = deserializeCredential(result.data!)

    // Return as JSON-serializable object
    return JSON.stringify({
      id: credential.id,
      rawId: arrayBufferToBase64((credential.rawId as ArrayBuffer)),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment,
      response: {
        clientDataJSON: arrayBufferToBase64(credential.response.clientDataJSON),
        attestationObject:
          'attestationObject' in credential.response
            ? arrayBufferToBase64(
                (credential.response as AuthenticatorAttestationResponse).attestationObject
              )
            : undefined,
        authenticatorData:
          'authenticatorData' in credential.response
            ? arrayBufferToBase64(
                (credential.response as AuthenticatorAssertionResponse).authenticatorData
              )
            : undefined,
        signature:
          'signature' in credential.response
            ? arrayBufferToBase64((credential.response as AuthenticatorAssertionResponse).signature)
            : undefined,
        userHandle:
          'userHandle' in credential.response &&
          (credential.response as AuthenticatorAssertionResponse).userHandle
            ? arrayBufferToBase64(
                (credential.response as AuthenticatorAssertionResponse).userHandle!
              )
            : null,
        transports:
          'getTransports' in credential.response
            ? (credential.response as AuthenticatorAttestationResponse).getTransports()
            : undefined,
        publicKey:
          'getPublicKey' in credential.response
            ? (() => {
                const pk = (credential.response as AuthenticatorAttestationResponse).getPublicKey()
                return pk ? arrayBufferToBase64(pk) : null
              })()
            : undefined,
        publicKeyAlgorithm:
          'getPublicKeyAlgorithm' in credential.response
            ? (credential.response as AuthenticatorAttestationResponse).getPublicKeyAlgorithm()
            : undefined
      },
      clientExtensionResults: credential.getClientExtensionResults()
    })
  },

  async get(optionsJson: string): Promise<string> {
    const options = JSON.parse(optionsJson) as CredentialRequestOptions

    // Restore ArrayBuffers from base64
    if (options.publicKey) {
      options.publicKey.challenge = base64ToArrayBuffer(
        options.publicKey.challenge as unknown as string
      )
      if (options.publicKey.allowCredentials) {
        options.publicKey.allowCredentials = options.publicKey.allowCredentials.map((cred) => ({
          ...cred,
          id: base64ToArrayBuffer(cred.id as unknown as string)
        }))
      }
    }

    const serializedOptions = serializeRequestOptions(options)
    if (!serializedOptions) {
      throw new Error('Invalid options: missing publicKey')
    }

    const result = (await ipcRenderer.invoke(WEBAUTHN_GET, {
      options: serializedOptions,
      origin: window.location.origin
    })) as WebAuthnResponse

    if (!result.success) {
      const error = new DOMException(
        result.error?.message || 'WebAuthn operation failed',
        result.error?.name || 'NotAllowedError'
      )
      throw error
    }

    const credential = deserializeCredential(result.data!)

    // Return as JSON-serializable object
    return JSON.stringify({
      id: credential.id,
      rawId: arrayBufferToBase64((credential.rawId as ArrayBuffer)),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment,
      response: {
        clientDataJSON: arrayBufferToBase64(credential.response.clientDataJSON),
        authenticatorData: arrayBufferToBase64(
          (credential.response as AuthenticatorAssertionResponse).authenticatorData
        ),
        signature: arrayBufferToBase64(
          (credential.response as AuthenticatorAssertionResponse).signature
        ),
        userHandle: (credential.response as AuthenticatorAssertionResponse).userHandle
          ? arrayBufferToBase64(
              (credential.response as AuthenticatorAssertionResponse).userHandle!
            )
          : null
      },
      clientExtensionResults: credential.getClientExtensionResults()
    })
  }
}

// Expose the bridge to the page
try {
  contextBridge.exposeInMainWorld('__webauthnBridge', webauthnBridge)
  console.log('[WebAuthn Preload] Bridge exposed to page')
} catch (error) {
  console.error('[WebAuthn Preload] Failed to expose bridge:', error)
}
