/* eslint-disable no-unused-expressions */
/* eslint-disable no-undef */
import '../node_modules/regenerator-runtime/runtime.js';
import '../dist/snjs.js';
import '../node_modules/chai/chai.js';
import './vendor/chai-as-promised-built.js';
import Factory from './lib/factory.js';
chai.use(chaiAsPromised);
const expect = chai.expect;

describe('004 protocol operations', () => {
  const _identifier = "hello@test.com";
  const _password = "password";
  let _keyParams;
  let _key;

  const application = Factory.createApplication();
  const protocol004 = new SNProtocolOperator004(new SNWebCrypto());

  before(async () => {
    await Factory.initializeApplication(application);
    const result = await protocol004.createRootKey({
      identifier: _identifier,
      password: _password
    });
    _keyParams = result.keyParams;
    _key = result.key;
  });

  after(() => {
    application.deinit();
  });

  it('cost minimum', () => {
    expect(application.protocolService.costMinimumForVersion("004")).to.equal(5);
  });

  it('generates valid keys for registration', async () => {
    const result = await application.protocolService.createRootKey({
      identifier: _identifier,
      password: _password
    });

    expect(result).to.have.property("key");
    expect(result).to.have.property("keyParams");

    expect(result.key.masterKey).to.be.ok;

    expect(result.key.serverPassword).to.not.be.null;
    expect(result.key.mk).to.not.be.ok;
    expect(result.key.dataAuthenticationKey).to.not.be.ok;

    expect(result.keyParams.seed).to.not.be.null;
    expect(result.keyParams.kdfIterations).to.not.be.null;
    expect(result.keyParams.salt).to.not.be.ok;
    expect(result.keyParams.identifier).to.be.ok;
  });

  it('generates random key', async () => {
    const length = 96;
    const key = await application.protocolService.crypto.generateRandomKey(length);
    expect(key.length).to.equal(length/4);
  });

  it('properly encrypts and decrypts', async () => {
    const text = "hello world";
    const rawKey = _key.masterKey;
    const nonce = await application.protocolService.crypto.generateRandomKey(192);
    const additionalData = {foo: "bar"};
    const encString = await application.protocolService.defaultOperator().encryptString({
      plaintext: text,
      rawKey: rawKey,
      nonce: nonce,
      aad: additionalData
    });
    const decString = await application.protocolService.defaultOperator().decryptString({
      ciphertext: encString,
      rawKey: rawKey,
      nonce: nonce,
      aad: additionalData
    });
    expect(decString).to.equal(text);
  });

  it('fails to decrypt non-matching aad', async () => {
    const text = "hello world";
    const rawKey = _key.masterKey;
    const nonce = await application.protocolService.crypto.generateRandomKey(192);
    const aad = {foo: "bar"};
    const nonmatchingAad = {foo: "rab"};
    const encString = await application.protocolService.defaultOperator().encryptString({
      plaintext: text,
      rawKey: rawKey,
      nonce,
      aad: aad
    });
    const decString = await application.protocolService.defaultOperator().decryptString({
      ciphertext: encString,
      rawKey: rawKey,
      nonce: nonce,
      aad: nonmatchingAad
    });
    expect(decString).to.not.be.ok;
  });

  it('generates existing keys for key params', async () => {
    const key = await application.protocolService.computeRootKey({
      password: _password,
      keyParams: _keyParams
    });
    expect(key.compare(_key)).to.be.true;
  });

  it('can decrypt encrypted params', async () => {
    const payload = Factory.createNotePayload();
    const key = await protocol004.createItemsKey();
    const params = await protocol004.generateEncryptionParameters({
      payload,
      key,
      format: PayloadFormats.EncryptedString
    });
    const decrypted = await protocol004.generateDecryptedParameters({
      encryptedParameters: params,
      key: key
    });
    expect(decrypted.content).to.eql(payload.content);
  });
});
