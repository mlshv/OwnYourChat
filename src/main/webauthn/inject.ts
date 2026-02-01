/**
 * WebAuthn injection script for provider WebContentsViews
 *
 * This script is injected into the page after it loads to override
 * navigator.credentials with a bridge to the native macOS WebAuthn APIs.
 */

import { join } from 'path'

// Get the path to the provider-webauthn preload script
export function getWebAuthnPreloadPath(): string {
  return join(__dirname, '../preload/provider-webauthn.js')
}

// JavaScript code to inject into the page that overrides navigator.credentials
export const WEBAUTHN_INJECTION_SCRIPT = `
(function() {
  'use strict';

  // Check if the bridge is available
  if (!window.__webauthnBridge) {
    console.warn('[WebAuthn] Bridge not available, passkeys may not work');
    return;
  }

  const bridge = window.__webauthnBridge;

  // Helper to convert ArrayBuffer to base64
  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // Helper to convert base64 to ArrayBuffer
  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Store original methods
  const originalCreate = navigator.credentials.create.bind(navigator.credentials);
  const originalGet = navigator.credentials.get.bind(navigator.credentials);
  const originalStore = navigator.credentials.store.bind(navigator.credentials);
  const originalPreventSilentAccess = navigator.credentials.preventSilentAccess.bind(navigator.credentials);

  // Serialize options for IPC (convert ArrayBuffers to base64)
  function serializeForIpc(obj) {
    if (obj === null || obj === undefined) return obj;
    if (obj instanceof ArrayBuffer) return arrayBufferToBase64(obj);
    if (ArrayBuffer.isView(obj)) return arrayBufferToBase64(obj.buffer);
    if (Array.isArray(obj)) return obj.map(serializeForIpc);
    if (typeof obj === 'object') {
      const result = {};
      for (const key of Object.keys(obj)) {
        result[key] = serializeForIpc(obj[key]);
      }
      return result;
    }
    return obj;
  }

  // Deserialize response from IPC (convert base64 back to ArrayBuffers)
  function deserializeCredential(data) {
    const response = {};

    // Always present
    response.clientDataJSON = base64ToArrayBuffer(data.response.clientDataJSON);

    // Registration response
    if (data.response.attestationObject) {
      response.attestationObject = base64ToArrayBuffer(data.response.attestationObject);
      response.getTransports = () => data.response.transports || [];
      response.getPublicKey = () => data.response.publicKey ? base64ToArrayBuffer(data.response.publicKey) : null;
      response.getPublicKeyAlgorithm = () => data.response.publicKeyAlgorithm || -7;
      response.getAuthenticatorData = () => data.response.authenticatorData ? base64ToArrayBuffer(data.response.authenticatorData) : new ArrayBuffer(0);
    }

    // Authentication response
    if (data.response.authenticatorData && data.response.signature) {
      response.authenticatorData = base64ToArrayBuffer(data.response.authenticatorData);
      response.signature = base64ToArrayBuffer(data.response.signature);
      response.userHandle = data.response.userHandle ? base64ToArrayBuffer(data.response.userHandle) : null;
    }

    return {
      id: data.id,
      rawId: base64ToArrayBuffer(data.rawId),
      type: data.type,
      authenticatorAttachment: data.authenticatorAttachment,
      response: response,
      getClientExtensionResults: () => data.clientExtensionResults || {}
    };
  }

  // Override navigator.credentials.create
  const patchedCreate = async function(options) {
    // Only intercept publicKey (WebAuthn) requests
    if (!options || !options.publicKey) {
      return originalCreate(options);
    }

    console.log('[WebAuthn] Intercepting navigator.credentials.create()');

    try {
      const serialized = serializeForIpc(options);
      const resultJson = await bridge.create(JSON.stringify(serialized));
      const result = JSON.parse(resultJson);
      return deserializeCredential(result);
    } catch (error) {
      console.error('[WebAuthn] create() error:', error);
      throw error;
    }
  };

  // Override navigator.credentials.get
  const patchedGet = async function(options) {
    // Only intercept publicKey (WebAuthn) requests
    if (!options || !options.publicKey) {
      return originalGet(options);
    }

    console.log('[WebAuthn] Intercepting navigator.credentials.get()');

    try {
      const serialized = serializeForIpc(options);
      const resultJson = await bridge.get(JSON.stringify(serialized));
      const result = JSON.parse(resultJson);
      return deserializeCredential(result);
    } catch (error) {
      console.error('[WebAuthn] get() error:', error);
      throw error;
    }
  };

  // Create a new credentials object with our overrides
  const patchedCredentials = {
    create: patchedCreate,
    get: patchedGet,
    store: originalStore,
    preventSilentAccess: originalPreventSilentAccess
  };

  // Replace navigator.credentials
  try {
    Object.defineProperty(navigator, 'credentials', {
      value: patchedCredentials,
      writable: false,
      configurable: false
    });
    console.log('[WebAuthn] navigator.credentials has been bridged to native macOS APIs');
  } catch (e) {
    console.error('[WebAuthn] Failed to override navigator.credentials:', e);
  }
})();
`
