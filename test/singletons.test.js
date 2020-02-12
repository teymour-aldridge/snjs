/* eslint-disable no-unused-expressions */
/* eslint-disable no-undef */
import '../node_modules/regenerator-runtime/runtime.js';
import '../dist/snjs.js';
import '../node_modules/chai/chai.js';
import './vendor/chai-as-promised-built.js';
import Factory from './lib/factory.js';
chai.use(chaiAsPromised);
const expect = chai.expect;

describe("singletons", () => {

  const BASE_ITEM_COUNT = 1; /** Default items key */

  function createPrivsPayload() {
    const params = {
      uuid: Uuid.GenerateUuidSynchronously(),
      content_type: 'SN|Privileges',
      content: {
        foo: 'bar'
      }
    };
    return CreateMaxPayloadFromAnyObject({
      object: params
    });
  }

  before(async function() {
    localStorage.clear();
  });

  after(async function() {
    localStorage.clear();
  });

  beforeEach(async function() {
    this.expectedItemCount = BASE_ITEM_COUNT;
    this.application = await Factory.createInitAppWithRandNamespace();
    this.email = Uuid.GenerateUuidSynchronously();
    this.password = Uuid.GenerateUuidSynchronously();
    await Factory.registerUserToApplication({
      application: this.application,
      email: this.email,
      password: this.password
    });
  });

  afterEach(async function() {
    expect(this.application.syncManager.isOutOfSync()).to.equal(false);
    const rawPayloads = await this.application.storageManager.getAllRawPayloads();
    expect(rawPayloads.length).to.equal(this.expectedItemCount);
    await this.application.deinit();
  });

  it("only resolves to 1 item", async function() {
    /** Privileges are an item we know to always return true for isSingleton */
    const privs1 = createPrivsPayload();
    const privs2 = createPrivsPayload();
    const privs3 = createPrivsPayload();

    this.expectedItemCount++;
    const items = await this.application.modelManager.mapPayloadsToLocalItems({
      payloads: [privs1, privs2, privs3]
    });
    await this.application.modelManager.setItemsDirty(items);
    await this.application.syncManager.sync();
    expect(this.application.modelManager.allItems.length).to.equal(this.expectedItemCount);
  });

  it("signing into account and retrieving singleton shouldn't put us in deadlock", async function () {
   /** Create privs */
    const ogPrivs = await this.application.privilegesManager.getPrivileges();
    this.expectedItemCount++;
    await this.application.sync();
    await this.application.signOut();
    /** Create another instance while signed out */
    await this.application.privilegesManager.getPrivileges();
    await Factory.loginToApplication({
      application: this.application,
      email: this.email,
      password: this.password
    });
    /** After signing in, the instance retrieved from the server should be the one kept */
    const latestPrivs = await this.application.privilegesManager.getPrivileges();
    expect(latestPrivs.uuid).to.equal(ogPrivs.uuid);
    const allPrivs = this.application.modelManager.validItemsForContentType(ogPrivs.content_type);
    expect(allPrivs.length).to.equal(1);
  });

  it("if only result is errorDecrypting, create new item", async function() {
    const payload = createPrivsPayload();
    const item = await this.application.modelManager.mapPayloadToLocalItem({
      payload: payload
    });
    this.expectedItemCount++;
    await this.application.syncManager.sync();
    /** Set after sync so that it syncs properly */
    item.errorDecrypting = true;

    const predicate = new SFPredicate("content_type", "=", item.content_type);
    const resolvedItem = await this.application.singletonManager.findOrCreateSingleton({
      predicate: predicate,
      createPayload: payload
    });
    expect(this.application.modelManager.allItems.length).to.equal(this.expectedItemCount);
    expect(resolvedItem.uuid).to.not.equal(item.uuid);
    expect(resolvedItem.errorDecrypting).to.not.be.ok;
  });

  it("alternating the uuid of a singleton should return correct result", async function() {
    const payload = createPrivsPayload();
    const item = await this.application.modelManager.mapPayloadToLocalItem({
      payload: payload
    });
    this.expectedItemCount++;
    await this.application.syncManager.sync();
    const predicate = new SFPredicate("content_type", "=", item.content_type);
    const resolvedItem = await this.application.singletonManager.findOrCreateSingleton({
      predicate: predicate,
      createPayload: payload
    });
    await this.application.syncManager.alternateUuidForItem(resolvedItem);
    await this.application.syncManager.sync();
    const resolvedItem2 = await this.application.singletonManager.findOrCreateSingleton({
      predicate: predicate,
      createPayload: payload
    });
    expect(resolvedItem.uuid).to.equal(item.uuid);
    expect(resolvedItem2.uuid).to.not.equal(resolvedItem.uuid);
    expect(resolvedItem.deleted).to.equal(true);
    expect(this.application.modelManager.allItems.length).to.equal(this.expectedItemCount);
  });
});
