import { FillItemContent } from '@Models/functions';
import { PayloadField } from './fields';
import { PayloadSource } from '@Payloads/sources';
import { ContentType } from '@Models/content_types';
import { ProtocolVersion } from '@Protocol/versions';
import { isString, isObject, deepFreeze, isNullOrUndefined } from '@Lib/utils';
import { RawPayload, PayloadContent } from '@Payloads/generator';
import { PayloadFormat } from '@Payloads/formats';

/**
 * A payload is a vehicle in which item data is transported or persisted.
 * This class represents an abstract PurePayload which does not have any fields. Instead,
 * subclasses must override the `fields` static method to return which fields this particular
 * class of payload contains. For example, a ServerItemPayload is a transmission vehicle for 
 * transporting an item to the server, and does not contain fields like PayloadFields.Dirty.
 * However, a StorageItemPayload is a persistence vehicle for saving payloads to disk, and does contain
 * PayloadsFields.Dirty.
 * 
 * Payloads are completely immutable and may not be modified after creation. Payloads should
 * not be created directly using the constructor, but instead created using the generators avaiable
 * in generator.js.
 * 
 * Payloads also have a content format. Formats can either be 
 * DecryptedBase64String, EncryptedString, or DecryptedBareObject.
 */
export class PurePayload {
  /** When constructed, the payload takes in an array of fields that the input raw payload
   * contains. These fields allow consumers to determine whether a given payload has an actual
   * undefined value for payload.content, for example, or whether the payload was constructed
   * to omit that field altogether (as in the case of server saved payloads) */
  readonly fields: PayloadField[]
  readonly source: PayloadSource
  readonly uuid: string
  readonly content_type: ContentType
  readonly content?: PayloadContent | string
  readonly deleted?: boolean
  readonly items_key_id?: string
  readonly enc_item_key?: string
  readonly created_at?: Date
  readonly updated_at?: Date
  readonly dirtiedDate?: Date
  readonly dirty?: boolean
  readonly errorDecrypting?: boolean
  readonly waitingForKey?: boolean
  readonly errorDecryptingValueChanged?: boolean
  readonly lastSyncBegan?: Date
  readonly lastSyncEnd?: Date

  /** @deprecated */
  readonly auth_hash?: string
  /** @deprecated */
  readonly auth_params?: any

  readonly format: PayloadFormat
  readonly version?: ProtocolVersion

  constructor(
    rawPayload: RawPayload,
    fields: PayloadField[],
    source: PayloadSource
  ) {
    if (fields) {
      this.fields = fields;
    } else {
      this.fields = Object.keys(rawPayload) as PayloadField[];
    }
    if (source) {
      this.source = source;
    } else {
      this.source = PayloadSource.Constructor;
    }
    this.uuid = rawPayload.uuid!;
    if (!this.uuid && this.fields.includes(PayloadField.Uuid)) {
      throw Error('uuid is null, yet this payloads fields indicate it shouldnt be.');
    }
    this.content_type = rawPayload.content_type!;
    if (rawPayload.content) {
      if (isObject(rawPayload.content)) {
        this.content = FillItemContent(rawPayload.content as PayloadContent);
      } else {
        this.content = rawPayload.content;
      }
    }
    this.deleted = rawPayload.deleted;
    this.items_key_id = rawPayload.items_key_id;
    this.enc_item_key = rawPayload.enc_item_key;
    /** Fallback to initializing with now date */
    this.created_at = new Date(rawPayload.created_at || new Date());
    /** Fallback to initializing with 0 epoch date */
    this.updated_at = new Date(rawPayload.updated_at || new Date(0));
    this.dirtiedDate = new Date(rawPayload.dirtiedDate!);
    this.dirty = rawPayload.dirty;
    this.errorDecrypting = rawPayload.errorDecrypting;
    this.waitingForKey = rawPayload.waitingForKey;
    this.errorDecryptingValueChanged = rawPayload.errorDecryptingValueChanged;
    this.lastSyncBegan = rawPayload.lastSyncBegan ? new Date(rawPayload.lastSyncBegan) : undefined;
    this.lastSyncEnd = rawPayload.lastSyncEnd ? new Date(rawPayload.lastSyncEnd) : undefined;
    this.auth_hash = rawPayload.auth_hash;
    this.auth_params = rawPayload.auth_params;

    if (isString(this.content)) {
      if ((this.content as string).startsWith(ProtocolVersion.V000Base64Decrypted)) {
        this.format = PayloadFormat.DecryptedBase64String;
      } else {
        this.format = PayloadFormat.EncryptedString;
      }
    } else if (isObject(this.content)) {
      this.format = PayloadFormat.DecryptedBareObject;
    } else {
      this.format = PayloadFormat.Deleted;
    }

    if (isString(this.content)) {
      this.version = (this.content as string).substring(
        0,
        ProtocolVersion.VersionLength
      ) as ProtocolVersion;
    } else if (this.content) {
      this.version = (this.content as PayloadContent).version;
    }

    deepFreeze(this);
  }

  /** 
   * Returns a generic object with all payload fields except any that are meta-data
   * related (such as `fields`, `dirtiedDate`, etc). "Ejected" means a payload for 
   * generic, non-contextual consumption, such as saving to a backup file or syncing 
   * with a server.
   */
  ejected() {
    const optionalFields = [
      PayloadField.Legacy003AuthHash,
      PayloadField.Deleted
    ];
    const nonRequiredFields = [
      PayloadField.DirtiedDate,
      PayloadField.ErrorDecrypting,
      PayloadField.ErrorDecryptingChanged,
      PayloadField.WaitingForKey,
      PayloadField.LastSyncBegan,
      PayloadField.LastSyncEnd
    ];
    const result = {} as RawPayload;
    for (const field of this.fields) {
      if(nonRequiredFields.includes(field)) {
        continue;
      }
      const value = this[field];
      if (isNullOrUndefined(value) && optionalFields.includes(field)) {
        continue;
      }
      result[field] = value;
    }
    return result;
  }

  get safeContent() {
    if (this.format === PayloadFormat.DecryptedBareObject) {
      return this.content as PayloadContent;
    } else {
      return {} as PayloadContent;
    }
  }

  /** Defined to allow singular API with Payloadable type (PurePayload | SNItem) */
  get references() {
    return this.safeReferences;
  }

  get safeReferences() {
    return this.safeContent.references || [];
  }

  get contentObject() {
    if (this.format !== PayloadFormat.DecryptedBareObject) {
      throw Error('Attempting to access non-object content as object');
    }
    return this.content as PayloadContent;
  }

  get contentString() {
    if (this.format === PayloadFormat.DecryptedBareObject) {
      throw Error('Attempting to access non-string content as string');
    }
    return this.content as string;
  }

  /**
   * Whether a payload can be discarded and removed from storage.
   * This value is true if a payload is marked as deleted and not dirty.
   */
  get discardable() {
    return this.deleted && !this.dirty;
  }
}
