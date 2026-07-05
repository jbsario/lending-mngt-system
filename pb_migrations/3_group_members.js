/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const borrowers = app.findCollectionByNameOrId("borrowers");
  const groups = app.findCollectionByNameOrId("borrower_groups");

  const collection = new Collection({
    name: "group_members",
    type: "base",
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.id != ''",
    updateRule: "@request.auth.id != ''",
    deleteRule: "@request.auth.id != ''",
    fields: [
      {
        name: "group",
        type: "relation",
        required: true,
        collectionId: groups.id,
        maxSelect: 1,
        cascadeDelete: true
      },
      {
        name: "borrower",
        type: "relation",
        required: true,
        collectionId: borrowers.id,
        maxSelect: 1,
        cascadeDelete: true
      },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true }
    ]
  });
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("group_members");
  return app.delete(collection);
});
