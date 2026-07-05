/// <reference path="../pb_data/types.d.ts" />
// Adds a `deleted` flag to loans for soft deletion. Safe to run against a
// database where the field was already added by hand.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("loans");
  if (collection.fields.getByName("deleted")) return null;
  collection.fields.add(new BoolField({ name: "deleted" }));
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("loans");
  if (!collection.fields.getByName("deleted")) return null;
  collection.fields.removeByName("deleted");
  return app.save(collection);
});
