import '../../node_modules/regenerator-runtime/runtime.js';
import '../../dist/snjs.js';
import '../../node_modules/chai/chai.js';
import './../vendor/chai-as-promised-built.js';
import Factory from '../lib/factory.js';
chai.use(chaiAsPromised);
const expect = chai.expect;

describe("importing", () => {

  const createModelManager = async () => {
    const isolatedApplication = await Factory.createInitAppWithRandNamespace();
    return isolatedApplication.modelManager;
  }

  it('importing existing data should keep relationships valid', async () => {
    const modelManager = await createModelManager();

    const pair = Factory.createRelatedNoteTagPairPayload();
    const notePayload = pair[0];
    const tagPayload = pair[1];

    modelManager.mapPayloadsToLocalItems({payloads: [notePayload, tagPayload]});
    const note = modelManager.allItemsMatchingTypes(["Note"])[0];
    const tag = modelManager.allItemsMatchingTypes(["Tag"])[0];

    expect(tag.content.references.length).to.equal(1);
    expect(tag.notes.length).to.equal(1);

    expect(note.content.references.length).to.equal(0);
    expect(note.tags.length).to.equal(1);

    modelManager.importItemsFromRaw([notePayload, tagPayload]);

    expect(modelManager.allItems.length).to.equal(2);

    expect(tag.content.references.length).to.equal(1);
    expect(tag.notes.length).to.equal(1);

    expect(note.content.references.length).to.equal(0);
    expect(note.referencingItemsCount).to.equal(1);
    expect(note.tags.length).to.equal(1);
  });

  it('importing same conflicting note many times should create 1 duplicate', async () => {
    const modelManager = await createModelManager();
    const notePayload = Factory.createNotePayload();
    await modelManager.mapPayloadsToLocalItems({payloads: [notePayload]});
    const note = modelManager.notes[0];
    const mutatedNote = CreatePayloadFromAnyObject({
      object: notePayload,
      override: { content: { title: `${Math.random()}` } }
    });
    const imported = await modelManager.importItemsFromRaw([
      mutatedNote,
      mutatedNote,
      mutatedNote
    ]);
    expect(imported.length).to.equal(1);
    expect(modelManager.notes.length).to.equal(2);
    expect(imported[0].content.title).to.equal(mutatedNote.content.title);
  });

  it('importing a tag with lesser references should create a duplicate', async () => {
    const modelManager = await createModelManager();
    const pair = Factory.createRelatedNoteTagPairPayload();
    const notePayload = pair[0];
    const tagPayload = pair[1];
    await modelManager.mapPayloadsToLocalItems({payloads: pair});
    const note = modelManager.notes[0];
    const tag = modelManager.tags[0];

    const mutatedTag = CreatePayloadFromAnyObject({
      object: tagPayload,
      override: { content: { references: [] } }
    });
    const imported = await modelManager.importItemsFromRaw([
      mutatedTag
    ]);
    expect(imported.length).to.equal(1);
    expect(modelManager.tags.length).to.equal(2);
    expect(modelManager.findItem(tagPayload.uuid).content.references.length).to.equal(1);
    expect(modelManager.findItem(imported[0].uuid).content.references.length).to.equal(0);
  });

  it('importing data with differing content should create duplicates', async () => {
    const modelManager = await createModelManager();
    const pair = Factory.createRelatedNoteTagPairPayload();
    const notePayload = pair[0];
    const tagPayload = pair[1];
    await modelManager.mapPayloadsToLocalItems({payloads: pair});
    const note = modelManager.notes[0];
    const tag = modelManager.tags[0];
    const mutatedNote = CreatePayloadFromAnyObject({
      object: notePayload,
      override: { content: { title: `${Math.random()}` } }
    });
    const mutatedTag = CreatePayloadFromAnyObject({
      object: tagPayload,
      override: { content: { title: `${Math.random()}` } }
    });
    const imported = await modelManager.importItemsFromRaw([
      mutatedNote,
      mutatedTag
    ]);
    expect(modelManager.allItems.length).to.equal(4);

    const newNote = imported[0];
    const newTag = imported[1];
    expect(newNote.uuid).to.not.equal(note.uuid);
    expect(newTag.uuid).to.not.equal(tag.uuid);

    expect(tag.content.references.length).to.equal(2);
    expect(tag.notes.length).to.equal(2);

    expect(note.content.references.length).to.equal(0);
    expect(note.referencingItemsCount).to.equal(2);
    expect(note.tags.length).to.equal(2);

    expect(newTag.content.references.length).to.equal(1);
    expect(newTag.notes.length).to.equal(1);

    expect(newNote.content.references.length).to.equal(0);
    expect(newNote.referencingItemsCount).to.equal(1);
    expect(newNote.tags.length).to.equal(1);
  });

  it('when importing items, imported values should not be used to determine if changed',
  async function() {
    /**
     * If you have a note and a tag, and the tag has 1 reference to the note,
     * and you import the same two items, except modify the note value so that
     * a duplicate is created, we expect only the note to be duplicated, and the
     * tag not to. However, if only the note changes, and you duplicate the note,
     * which causes the tag's references content to change, then when the incoming
     * tag is being processed, it will also think it has changed, since our local
     * value now doesn't match what's coming in. The solution is to get all values
     * ahead of time before any changes are made.
     */
    const modelManager = this.application.modelManager;
    const note = await Factory.createMappedNote(modelManager);
    const tag = await Factory.createMappedTag(modelManager);

    tag.addItemAsRelationship(note);
    await this.application.saveItem({item: tag});

    const externalNote = Object.assign({},
      {uuid: note.uuid, content: note.getContentCopy(), content_type: note.content_type}
    );
    externalNote.content.text = `${Math.random()}`;

    const externalTag = Object.assign({},
      {uuid: tag.uuid, content: tag.getContentCopy(), content_type: tag.content_type}
    );

    await modelManager.importItemsFromRaw([externalNote, externalTag]);

    // We expect now that the total item count is 3, not 4.
    expect(modelManager.allItems.length).to.equal(3);
    expect(tag.content.references.length).to.equal(2);
  });
});