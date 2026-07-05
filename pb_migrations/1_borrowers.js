/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    name: "borrowers",
    type: "base",
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.id != ''",
    updateRule: "@request.auth.id != ''",
    deleteRule: "@request.auth.id != ''",
    fields: [
      { name: "full_name", type: "text", required: true },
      { name: "contact_number", type: "text" },
      { name: "email", type: "email" },
      { name: "address", type: "text" },
      { name: "id_type", type: "text" },
      { name: "id_number", type: "text" },
      { name: "notes", type: "text" },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true }
    ]
  });
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("borrowers");
  return app.delete(collection);
});
