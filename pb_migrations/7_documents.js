/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const borrowers = app.findCollectionByNameOrId("borrowers");
  const loans = app.findCollectionByNameOrId("loans");

  const collection = new Collection({
    name: "documents",
    type: "base",
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.id != ''",
    updateRule: "@request.auth.id != ''",
    deleteRule: "@request.auth.id != ''",
    fields: [
      { name: "borrower", type: "relation", collectionId: borrowers.id, maxSelect: 1 },
      { name: "loan", type: "relation", collectionId: loans.id, maxSelect: 1 },
      {
        name: "doc_type",
        type: "select",
        maxSelect: 1,
        values: ["ID", "Loan Agreement", "Collateral", "Other"]
      },
      { name: "file_name", type: "text" },
      {
        name: "file",
        type: "file",
        required: true,
        maxSelect: 1,
        maxSize: 15728640
      },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true }
    ]
  });
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("documents");
  return app.delete(collection);
});
