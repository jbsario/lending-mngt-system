/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const loans = app.findCollectionByNameOrId("loans");

  const collection = new Collection({
    name: "repayment_schedule",
    type: "base",
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.id != ''",
    updateRule: "@request.auth.id != ''",
    deleteRule: "@request.auth.id != ''",
    fields: [
      { name: "loan", type: "relation", required: true, collectionId: loans.id, maxSelect: 1, cascadeDelete: true },
      { name: "installment_number", type: "number", required: true },
      { name: "due_date", type: "date", required: true },
      { name: "principal_due", type: "number", required: true },
      { name: "interest_due", type: "number", required: true },
      { name: "total_due", type: "number", required: true },
      { name: "amount_paid", type: "number" },
      {
        name: "status",
        type: "select",
        maxSelect: 1,
        values: ["unpaid", "partial", "paid", "overdue"]
      },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true }
    ]
  });
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("repayment_schedule");
  return app.delete(collection);
});
