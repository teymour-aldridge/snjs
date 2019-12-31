import { SNWebCrypto, isWebCryptoAvailable } from 'sncrypto';
import { SFItem } from '@Models/core/item';
import { SNProtocolOperator001 } from '@Protocol/versions/001/operator_001';
import { SNProtocolOperator002 } from '@Protocol/versions/002/operator_002';
import { SNProtocolOperator003 } from '@Protocol/versions/003/operator_003';
import { SNProtocolOperator004 } from '@Protocol/versions/004/operator_004';
import { SNRootKeyParams001 } from '@Protocol/versions/001/key_params_001';
import { SNRootKeyParams002 } from '@Protocol/versions/002/key_params_002';
import { SNRootKeyParams003 } from '@Protocol/versions/003/key_params_003';
import { SNRootKeyParams004 } from '@Protocol/versions/004/key_params_004';
import { CreateEncryptionParameters } from '@Protocol/payloads/generator';
import * as fields from '@Protocol/payloads/fields';
import * as versions from '@Protocol/versions';
import * as intents from '@Protocol/intents';
import {
  isWebEnvironment,
  isString,
  isNullOrUndefined
} from '@Lib/utils';
import {
  PAYLOAD_CONTENT_FORMAT_ENCRYPTED_STRING,
  PAYLOAD_CONTENT_FORMAT_DECRYPTED_BARE_OBJECT,
  PAYLOAD_CONTENT_FORMAT_DECRYPTED_BASE_64_STRING,
} from '@Protocol/payloads/formats';
import {
  isDecryptedIntent,
  intentRequiresEncryption
} from '@Protocol/intents';

export class SNProtocolManager {

  constructor({modelManager, crypto}) {
    if(!modelManager) {
      throw 'Invalid ProtocolManager construction.';
    }
    this.operators = [];
    this.modelManager = modelManager;
    this.loadCryptoInstance(crypto);
  }

  /**
   * To avoid circular dependencies in constructor, consumers must create a key manager separately
   * and feed it into the protocolManager here.
   * @param keyManager  A fully constructed keyManager
   */
  setKeyManager(keyManager) {
    this.keyManager = keyManager;
    this.keyManager.addItemsKeyChangeObserver({
      name: 'protocol-manager',
      callback: (itemsKeys) => {
        this.decryptItemsWaitingForKeys();
      }
    });
  }

  loadCryptoInstance(crypto) {
    if(!crypto && isWebEnvironment()) {
      // IE and Edge do not support pbkdf2 in WebCrypto.
      if(isWebCryptoAvailable()) {
        this.crypto = new SNWebCrypto();
      } else {
        console.error("WebCrypto is not available.");
      }
    } else {
      this.crypto = crypto;
    }

    SFItem.SetUuidGenerators({
      syncImpl: this.crypto.generateUUIDSync,
      asyncImpl: this.crypto.generateUUIDSync
    })
  }

  latestVersion() {
    return versions.PROTOCOL_VERSION_004;
  }

  async getUserVersion() {
    const keyParams = this.keyManager.getRootKeyParams();
    return keyParams && keyParams.version;
  }

  supportsPasswordDerivationCost(cost) {
    // Some passwords are created on platforms with stronger pbkdf2 capabilities, like iOS or WebCrypto,
    // if user has high password cost and is using browser that doesn't support WebCrypto,
    // we want to tell them that they can't login with this browser.
    if(cost > 5000) {
      return this.crypto instanceof SNWebCrypto;
    } else {
      return true;
    }
  }

  /**
   * @returns  The versions that this library supports.
  */
  supportedVersions() {
    return [
      versions.PROTOCOL_VERSION_001,
      versions.PROTOCOL_VERSION_002,
      versions.PROTOCOL_VERSION_003,
      versions.PROTOCOL_VERSION_004,
    ];
  }

  isVersionNewerThanLibraryVersion(version) {
    const libraryVersion = this.latestVersion();
    return parseInt(version) > parseInt(libraryVersion);
  }

  isProtocolVersionOutdated(version) {
    // YYYY-MM-DD
    const expirationDates = {}
    expirationDates[versions.PROTOCOL_VERSION_001] = Date.parse('2018-01-01');
    expirationDates[versions.PROTOCOL_VERSION_002] = Date.parse('2020-01-01');

    const date = expirationDates[version];
    if(!date) {
      // No expiration date, is active version
      return false;
    }
    const expired = new Date() > date;
    return expired;
  }

  costMinimumForVersion(version) {
    switch (version) {
      case versions.PROTOCOL_VERSION_001:
        return SNProtocolOperator001.pwCost();
      case versions.PROTOCOL_VERSION_002:
        return SNProtocolOperator002.pwCost();
      case versions.PROTOCOL_VERSION_003:
        return SNProtocolOperator003.pwCost();
      case versions.PROTOCOL_VERSION_004:
        return SNProtocolOperator004.kdfIterations();
      default:
        throw `Unable to find cost minimum for version ${version}`;
    }
  }

  versionForPayload(payload) {
    return payload.content.substring(0, versions.PROTOCOL_VERSION_LENGTH);
  }

  createOperatorForLatestVersion() {
    return this.createOperatorForVersion(this.latestVersion());
  }

  createOperatorForVersion(version) {
    if(version === versions.PROTOCOL_VERSION_001) {
      return new SNProtocolOperator001(this.crypto);
    } else if(version === versions.PROTOCOL_VERSION_002) {
      return new SNProtocolOperator002(this.crypto);
    } else if(version === versions.PROTOCOL_VERSION_003) {
      return new SNProtocolOperator003(this.crypto);
    } else if(version === versions.PROTOCOL_VERSION_004) {
      return new SNProtocolOperator004(this.crypto);
    } else if(version === versions.PROTOCOL_VERSION_BASE_64_DECRYPTED) {
      return this.createOperatorForLatestVersion();
    } else {
      throw `Unable to find operator for version ${version}`
    }
  }

  operatorForVersion(version) {
    const operatorKey = version;
    let operator = this.operators[operatorKey];
    if(!operator) {
      operator = this.createOperatorForVersion(version);
      this.operators[operatorKey] = operator;
    }
    return operator;
  }

  defaultOperator() {
    return this.operatorForVersion(this.latestVersion());
  }

  async computeRootKey({password, keyParams}) {
    const version = keyParams.version;
    const operator = this.operatorForVersion(version);
    return operator.computeRootKey({password, keyParams});
  }

  async createRootKey({identifier, password}) {
    const operator = this.defaultOperator();
    return operator.createRootKey({identifier, password});
  }

  async getRootKeyParams() {
    return this.keyManager.getRootKeyParams();
  }

  payloadContentFormatForIntent({key, intent}) {
    if(!key) {
      /** Decrypted */
      if((
        intent === intents.ENCRYPTION_INTENT_LOCAL_STORAGE_DECRYPTED ||
        intent === intents.ENCRYPTION_INTENT_LOCAL_STORAGE_PREFER_ENCRYPTED ||
        intent === intents.ENCRYPTION_INTENT_FILE_DECRYPTED
      )) {
        return PAYLOAD_CONTENT_FORMAT_DECRYPTED_BARE_OBJECT;
      } else if((
        intent === intents.ENCRYPTION_INTENT_SYNC
      )) {
        return PAYLOAD_CONTENT_FORMAT_DECRYPTED_BASE_64_STRING;
      }
    } else {
      /** Encrypted */
      if((
        intent === intents.ENCRYPTION_INTENT_SYNC ||
        intent === intents.ENCRYPTION_INTENT_LOCAL_STORAGE_ENCRYPTED ||
        intent === intents.ENCRYPTION_INTENT_FILE_ENCRYPTED ||
        intent === intents.ENCRYPTION_INTENT_LOCAL_STORAGE_PREFER_ENCRYPTED
      )) {
        return PAYLOAD_CONTENT_FORMAT_ENCRYPTED_STRING;
      } else  {
        throw `Unhandled case in protocolManager.payloadContentFormat.`;
      }
    }
  }

  /**
   * Generates parameters for a payload that are typically encrypted, and used for syncing or saving locally.
   * Parameters are non-typed objects that can later by converted to objects.
   * @param key Optional. The key to use to encrypt the payload. Will be looked up if not supplied.
   * @returns A plain key/value object.
   */
  async payloadByEncryptingPayload({payload, key, intent}) {
    if(!key && !isDecryptedIntent(intent)) {
      key = await this.keyManager.keyToUseForEncryptionOfPayload({payload, intent});
    }
    if(!key && intentRequiresEncryption(intent)) {
      throw 'Attempting to generate encrypted payload with no key.';
    }

    const version = key ? key.version : this.latestVersion();
    const format = this.payloadContentFormatForIntent({key, intent});
    const operator = this.operatorForVersion(version);
    const encryptionParameters = await operator.generateEncryptionParameters({payload, key, format});
    if(!encryptionParameters) {
      throw 'Unable to generate encryption parameters';
    }
    return CreatePayloadFromAnyObject({
      object: payload,
      override: encryptionParameters
    });
  }

  /**
   * Generates a new payload by decrypting the input payload.
   * @param payload - The payload to decrypt.
   * @param key - Optional. The key to use to decrypt the payload. If none is supplied, it will be automatically looked up.
   */
  async payloadByDecryptingPayload({payload, key}) {
    if(!key) {
      key = await this.keyManager.keyToUseForDecryptionOfPayload({payload});
    }
    if(!key) {
      return CreatePayloadFromAnyObject({
        object: payload,
        override: {
          waitingForKey: true,
          errorDecrypting: true
        }
      })
    }
    const version = this.versionForPayload(payload);
    const operator = this.operatorForVersion(version);
    const encryptionParameters = CreateEncryptionParameters(payload);
    const decryptedParameters = await operator.generateDecryptedParameters({
      encryptedParameters: encryptionParameters,
      key: key
    });

    return CreatePayloadFromAnyObject({
      object: payload,
      override: decryptedParameters
    });
  }

  async payloadsByDecryptingPayloads({payloads, throws}) {
    const decryptedPayloads = [];

    for(const encryptedPayload of payloads) {
      if(!encryptedPayload) {
        /** Keep in counts similar to out counts */
        decryptedPayloads.push(encryptedPayload);
        continue;
      }

      if(!encryptedPayload.isPayload) {
        throw 'Attempting to decrypt non-payload object in payloadsByDecryptingPayloads.';
      }

      // We still want to decrypt deleted payloads if they have content in case they were marked as dirty but not yet synced.
      if(encryptedPayload.deleted === true && isNullOrUndefined(encryptedPayload.content)) {
        decryptedPayloads.push(encryptedPayload);
        continue;
      }

      const isDecryptable = isString(encryptedPayload.content);
      if(!isDecryptable)  {
        decryptedPayloads.push(encryptedPayload);
        continue;
      }

      try {
        const decryptedPayload = await this.payloadByDecryptingPayload({
          payload: encryptedPayload
        });
        decryptedPayloads.push(decryptedPayload);
      } catch (e) {
        decryptedPayloads.push(CreatePayloadFromAnyObject({
          object: encryptedPayload,
          override: {
            [fields.ITEM_PAYLOAD_ERROR_DECRYPTING]: true,
            [fields.ITEM_PAYLOAD_ERROR_DECRYPTING_CHANGED]: !encryptedPayload.errorDecrypting
          }
        }))
        if(throws) { throw e; }
        console.error("Error decrypting payload", encryptedPayload, e);
      }
    }

    return decryptedPayloads;
  }

  /**
   * If an item was attempting to decrypt, but the keys for that item have not downloaded yet,
   * it will be deferred with item.waitingForKey = true. Here we find such items, and attempt to decrypt them,
   * given new set of keys having potentially arrived.
   */
  async decryptItemsWaitingForKeys() {
    const itemsWaitingForKeys = this.modelManager.allItems.filter((item) => {
      return item.waitingForKey === true;
    });
    if(itemsWaitingForKeys.length === 0) {
      return;
    }
    const payloads = itemsWaitingForKeys.map((item) => {
      return CreatePayloadFromAnyObject({
        object: item
      })
    })
    const decrypted = await this.payloadsByDecryptingPayloads({payloads});
    this.modelManager.mapPayloadsToLocalItems({payloads: decrypted});
  }

  /**
   * Compares two keys for equality
   * @returns Boolean
  */
  async compareKeys(keyA, keyB) {
    return keyA.compare(keyB);
  }

  createVersionedKeyParams(keyParams) {
    // 002 doesn't have version automatically, newer versions do.
    const version = keyParams.version || versions.PROTOCOL_VERSION_002;

    switch (version) {
      case versions.PROTOCOL_VERSION_001:
        return new SNRootKeyParams001(keyParams);
      case versions.PROTOCOL_VERSION_002:
        return new SNRootKeyParams002(keyParams);
      case versions.PROTOCOL_VERSION_003:
        return new SNRootKeyParams003(keyParams);
      case versions.PROTOCOL_VERSION_004:
        return new SNRootKeyParams004(keyParams);
    }

    throw "No auth params version found.";
  }

  /**
   * Computes a hash of all items updated_at strings joined with a comma.
   * The server will also do the same, to determine whether the client values match server values.
   * @returns A SHA256 digest string (hex).
   */
  async computeDataIntegrityHash() {
    try {
      const items = this.modelManager.allNondummyItems.sort((a, b) => {
        return b.updated_at - a.updated_at;
      })
      const dates = items.map((item) => item.updatedAtTimestamp());
      const string = dates.join(',');
      const hash = await this.crypto.sha256(string);
      return hash;
    } catch (e) {
      console.error("Error computing data integrity hash", e);
      return null;
    }
  }
}