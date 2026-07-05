/// <reference path="../pb_data/types.d.ts" />
// Immutable audit trail of every create/update/delete/payment made through
// the app. update/delete rules are left null so only superusers can alter
// history. Safe to run against a database where the collection already exists.
migrate((app) => {
  let existing = null;
  try {
    existing = app.findCollectionByNameOrId("activity_logs");
  } catch (_) {
    // collection does not exist yet
  }
  if (existing) return null;

  const users = app.findCollectionByNameOrId("users");

  const collection = new Collection({
    name: "activity_logs",
    type: "base",
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.id != ''",
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "user", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "user_email", type: "text" },
      { name: "action", type: "text", required: true },
      { name: "entity", type: "text" },
      { name: "record_id", type: "text" },
      { name: "summary", type: "text" },
      { name: "details", type: "json" },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true }
    ]
  });
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("activity_logs");
  return app.delete(collection);
});
