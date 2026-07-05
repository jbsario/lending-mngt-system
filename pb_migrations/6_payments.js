/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const loans = app.findCollectionByNameOrId("loans");
  const schedule = app.findCollectionByNameOrId("repayment_schedule");

  const collection = new Collection({
    name: "payments",
    type: "base",
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.id != ''",
    updateRule: "@request.auth.id != ''",
    deleteRule: "@request.auth.id != ''",
    fields: [
      { name: "loan", type: "relation", required: true, collectionId: loans.id, maxSelect: 1 },
      { name: "schedule", type: "relation", collectionId: schedule.id, maxSelect: 1 },
      { name: "amount", type: "number", required: true },
      { name: "payment_date", type: "date", required: true },
      { name: "payment_method", type: "text" },
      { name: "received_by", type: "text" },
      { name: "notes", type: "text" },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true }
    ]
  });
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("payments");
  return app.delete(collection);
});
