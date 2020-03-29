/* eslint-disable no-unused-expressions */
/* eslint-disable no-undef */
import * as Factory from './lib/factory.js';
chai.use(chaiAsPromised);
const expect = chai.expect;

describe('basic auth', () => {
  const BASE_ITEM_COUNT = 1; /** Default items key */

  before(async function () {
    localStorage.clear();
  });

  after(async function () {
    localStorage.clear();
  });

  beforeEach(async function() {
    this.expectedItemCount = BASE_ITEM_COUNT;
    this.application = await Factory.createInitAppWithRandNamespace();
    this.email = Uuid.GenerateUuidSynchronously();
    this.password = Uuid.GenerateUuidSynchronously();
  });

  afterEach(async function() {
    this.application.deinit();
  });

  it('successfully register new account',  async function () {
    const response = await this.application.register({
      email: this.email,
      password: this.password
    });
    expect(response).to.be.ok;
    expect(await this.application.protocolService.getRootKey()).to.be.ok;
  }).timeout(5000);

  it('fails register new account with short password', async function () {
    const password = '123456';
    const response = await this.application.register({
      email: this.email,
      password: password
    });
    expect(response.error).to.be.ok;
    expect(await this.application.protocolService.getRootKey()).to.not.be.ok;
  }).timeout(5000);

  it('successfully logs out of account', async function () {
    await this.application.register({
      email: this.email,
      password: this.password
    });

    expect(await this.application.protocolService.getRootKey()).to.be.ok;
    this.application = await Factory.signOutApplicationAndReturnNew(this.application);
    expect(await this.application.protocolService.getRootKey()).to.not.be.ok;
    expect(this.application.protocolService.keyMode).to.equal(KeyMode.RootKeyNone);
    const rawPayloads = await this.application.storageService.getAllRawPayloads();
    expect(rawPayloads.length).to.equal(BASE_ITEM_COUNT);
  });

  it('successfully logins to registered account', async function () {
    await this.application.register({
      email: this.email,
      password: this.password
    });
    this.application = await Factory.signOutApplicationAndReturnNew(this.application);
    const response = await this.application.signIn({
      email: this.email,
      password: this.password,
      awaitSync: true
    });
    expect(response).to.be.ok;
    expect(response.error).to.not.be.ok;
    expect(await this.application.protocolService.getRootKey()).to.be.ok;
  }).timeout(20000);

  it('fails login with wrong password', async function () {
    await this.application.register({
      email: this.email,
      password: this.password
    });
    this.application = await Factory.signOutApplicationAndReturnNew(this.application);
    const response = await this.application.signIn({
      email: this.email,
      password: 'wrongpassword',
      awaitSync: true
    });
    expect(response).to.be.ok;
    expect(response.error).to.be.ok;
    expect(await this.application.protocolService.getRootKey()).to.not.be.ok;
  }).timeout(20000);

  it('fails to change to short password', async function () {
    await this.application.register({
      email: this.email,
      password: this.password
    });
    const newPassword = '123456';
    const response = await this.application.changePassword({
      currentPassword: this.password,
      newPassword: newPassword
    });
    expect(response.error).to.be.ok;
  }).timeout(20000);

  it('successfully changes password', async function () {
    await this.application.register({
      email: this.email,
      password: this.password
    });

    const noteCount = 10;
    await Factory.createManyMappedNotes(this.application, noteCount);
    this.expectedItemCount += noteCount;
    await this.application.syncService.sync();

    expect(this.application.modelManager.allItems.length).to.equal(this.expectedItemCount);

    const newPassword = 'newpassword';
    const response = await this.application.changePassword({
      currentPassword: this.password,
      newPassword: newPassword
    });
    /** New items key */
    this.expectedItemCount++;

    expect(this.application.modelManager.allItems.length).to.equal(this.expectedItemCount);
    
    expect(response.error).to.not.be.ok;
    expect(this.application.modelManager.allItems.length).to.equal(this.expectedItemCount);
    expect(this.application.modelManager.invalidItems().length).to.equal(0);
    
    await this.application.syncService.markAllItemsAsNeedingSync();
    await this.application.syncService.sync();
    
    expect(this.application.modelManager.allItems.length).to.equal(this.expectedItemCount);
    
    /** Create conflict for a note */
    const note = this.application.modelManager.notes[0];
    note.title = `${Math.random()}`;
    note.updated_at = Factory.yesterday();
    await this.application.saveItem({item: note});
    this.expectedItemCount++;
  
    this.application = await Factory.signOutApplicationAndReturnNew(this.application);
    /** Should login with new password */
    const signinResponse = await this.application.signIn({
      email: this.email,
      password: newPassword,
      awaitSync: true
    });

    // await Factory.sleep(0.5);
    expect(signinResponse).to.be.ok;
    expect(signinResponse.error).to.not.be.ok;
    expect(await this.application.protocolService.getRootKey()).to.be.ok;
    expect(this.application.modelManager.allItems.length).to.equal(this.expectedItemCount);
    expect(this.application.modelManager.invalidItems().length).to.equal(0);
  }).timeout(20000);

  it('changes password many times', async function () {
    await this.application.register({
      email: this.email,
      password: this.password
    });

    const noteCount = 10;
    await Factory.createManyMappedNotes(this.application, noteCount);
    this.expectedItemCount += noteCount;
    await this.application.syncService.sync();

    const numTimesToChangePw = 5;
    let newPassword = Factory.randomString();
    let currentPassword = this.password;
    for(let i = 0; i < numTimesToChangePw; i++) {
      await this.application.changePassword({
        currentPassword: currentPassword,
        newPassword: newPassword
      });
      /** New items key */
      this.expectedItemCount++;

      currentPassword = newPassword;
      newPassword = Factory.randomString();

      expect(this.application.modelManager.allItems.length).to.equal(this.expectedItemCount);
      expect(this.application.modelManager.invalidItems().length).to.equal(0);

      await this.application.syncService.markAllItemsAsNeedingSync();
      await this.application.syncService.sync();
      this.application = await Factory.signOutApplicationAndReturnNew(this.application);
      expect(this.application.modelManager.allItems.length).to.equal(BASE_ITEM_COUNT);
      expect(this.application.modelManager.invalidItems().length).to.equal(0);

      /** Should login with new password */
      const signinResponse = await this.application.signIn({
        email: this.email,
        password: currentPassword,
        awaitSync: true
      });
      expect(signinResponse).to.be.ok;
      expect(signinResponse.error).to.not.be.ok;
      expect(await this.application.protocolService.getRootKey()).to.be.ok;
    }
  }).timeout(30000);
});
